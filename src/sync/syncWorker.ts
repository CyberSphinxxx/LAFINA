import { accountLinkService } from '../cloud/accountLinkService';
import { cloudClient } from '../cloud/cloudClient';
import { reconcileReminderAlarms } from '../scheduler';
import { db, DatabaseTransaction } from '../storage/database';
import { remindersStore } from '../storage/remindersStore';
import { syncConflictStore } from '../storage/syncConflictStore';
import { syncMetadataStore } from '../storage/syncMetadataStore';
import { OutboxItem, syncOutboxStore } from '../storage/syncOutboxStore';
import { syncStateStore } from '../storage/syncStateStore';
import type {
  SyncEntityType,
  SyncOperation,
  SyncPayload,
} from '../storage/syncTypes';
import { userStore } from '../storage/userStore';
import {
  AUTHORITATIVE_SYNC_ENTITY_TYPES,
  CLIENT_SYNC_ENTITY_TYPES,
  effectiveSyncEntityTypes,
  LAST_WRITE_WINS_ENTITY_TYPES,
  sameEntityTypeSet,
  SINGLETON_SYNC_ENTITY_TYPES,
} from './syncEntityTypes';
import { syncState } from './syncState';
import { applyStudyToolChange, STUDY_TOOL_TABLES } from './studyToolSync';

export type { SyncEntityType } from '../storage/syncTypes';

interface MutationResult {
  mutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  status: 'accepted' | 'rejected';
  reason?: string;
  serverVersion?: number;
  serverPayload?: Record<string, unknown>;
}

interface SyncChange {
  changeId: number;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  version: number;
  payload: Record<string, unknown>;
  updatedAt: string;
  deletedAt?: string | null;
}

interface SnapshotPosition {
  entityType: SyncEntityType;
  entityId: string;
}

interface SnapshotPrunePolicy {
  preserveOutboxStatuses: Array<'pending' | 'in_progress' | 'failed'>;
  requireExistingSyncMetadata: boolean;
}

interface SnapshotPage {
  boundaryCursor: number;
  items: SyncChange[];
  nextAfter: SnapshotPosition | null;
  hasMore: boolean;
  complete: boolean;
  authoritativeEntityTypes: SyncEntityType[];
  prunePolicy: SnapshotPrunePolicy;
}

interface SnapshotRequestPayload {
  boundaryCursor?: number;
  after?: SnapshotPosition;
}

export interface SyncBatchResponsePayload {
  accepted: MutationResult[];
  rejected: MutationResult[];
  changes: SyncChange[];
  nextCursor: number;
  hasMore: boolean;
  resetRequired: boolean;
  serverTime: string;
  snapshot?: SnapshotPage | null;
  /** Every type the server stores; absent from servers that predate negotiation. */
  supportedEntityTypes?: string[];
}

interface OutboundMutation {
  mutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  clientUpdatedAt: string;
  payload: SyncPayload;
  baseVersion?: number;
}

interface ApplyPageResult {
  reminderTextUpdated: boolean;
}

const ACCOUNT_SCOPE = 'account';
const OUTBOX_BATCH_SIZE = 100;
const MAX_SYNC_REQUESTS = 100;
/**
 * Serialized mutations per request. The server refuses bodies over 1 MiB, so
 * batches stop well short of it; the rest go in the next request.
 */
const MAX_BATCH_BYTES = 768 * 1024;
const OUTBOX_PRESERVE_STATUSES = ['pending', 'in_progress', 'failed'];

/** UTF-8 size of a string, without depending on TextEncoder being present. */
const utf8Length = (value: string): number => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
};

/** The pass currently running, which later callers join rather than skip. */
let inFlightSync: Promise<void> | null = null;
let retryAttempt = 0;
/**
 * Changes made on another device (or the server) applied since the count was
 * last taken. Echoes of this device's own accepted mutations don't count, so a
 * pass triggered by a local edit doesn't make every screen reload.
 */
let remoteChangesApplied = 0;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Sync failed';

const requireString = (
  payload: Record<string, unknown>,
  key: string
): string => {
  const value = payload[key];
  if (typeof value !== 'string') {
    throw new Error(`Sync payload field "${key}" must be a string.`);
  }
  return value;
};

const stringOrDefault = (
  payload: Record<string, unknown>,
  key: string,
  fallback: string
): string => {
  const value = payload[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    throw new Error(`Sync payload field "${key}" must be a string.`);
  }
  return value;
};

const nullableString = (
  payload: Record<string, unknown>,
  key: string
): string | null => {
  const value = payload[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`Sync payload field "${key}" must be a string or null.`);
  }
  return value;
};

const booleanOrDefault = (
  payload: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean => {
  const value = payload[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new Error(`Sync payload field "${key}" must be a boolean.`);
  }
  return value;
};

const integerOrDefault = (
  payload: Record<string, unknown>,
  key: string,
  fallback: number
): number => {
  const value = payload[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Sync payload field "${key}" must be an integer.`);
  }
  return value;
};

const normalizeTaskPriority = (
  payload: Record<string, unknown>
): 'High' | 'Medium' | 'Low' => {
  const value = stringOrDefault(payload, 'priority', 'Medium').toLowerCase();
  switch (value) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    default:
      throw new Error('Sync payload field "priority" is not canonical.');
  }
};

const normalizeNoteTags = (payload: Record<string, unknown>): string => {
  const value = stringOrDefault(payload, 'tags', '[]').trim();
  if (!value) return '[]';
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === 'string')
    ) {
      return JSON.stringify(parsed);
    }
  } catch {
    // Legacy comma-delimited cloud data is normalized below.
  }
  return JSON.stringify(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
};

const normalizeStudyPeakHours = (value: string): string => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === 'string')
    ) {
      return JSON.stringify(parsed);
    }
  } catch {
    // The backend also accepts a single value such as "morning".
  }

  return JSON.stringify(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
};

const assertEntityOwnership = (
  tx: DatabaseTransaction,
  table: string,
  entityId: string,
  localUserId: string
): void => {
  const result = tx.executeSync(
    `SELECT user_id FROM ${table} WHERE id = ?`,
    [entityId]
  );
  const owner = result.rows?.[0]?.user_id;
  if (owner === 'cloud') {
    tx.executeSync(
      `UPDATE ${table} SET user_id = ? WHERE id = ? AND user_id = 'cloud'`,
      [localUserId, entityId]
    );
    return;
  }
  if (typeof owner === 'string' && owner !== localUserId) {
    throw new Error(
      `Refusing to apply ${table} change ${entityId} to another local account.`
    );
  }
};

const applyProfile = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: SyncChange
): void => {
  // A cloud profile tombstone must not delete the offline-first local account.
  if (change.operation === 'delete') return;

  const payload = change.payload;
  const username = requireString(payload, 'username');
  const wakeTime = stringOrDefault(payload, 'wake_time', '07:00');
  const sleepTime = stringOrDefault(payload, 'sleep_time', '23:00');
  const studyPeakHours = normalizeStudyPeakHours(
    stringOrDefault(payload, 'study_peak_hours', 'morning')
  );
  const busiestDay = stringOrDefault(payload, 'busiest_day', 'Monday');
  const reminderLeadMinutes = integerOrDefault(
    payload,
    'reminder_lead_minutes',
    15
  );
  const snoozeTendency = stringOrDefault(
    payload,
    'snooze_tendency',
    'snooze_once'
  );
  const weeklyClassCount = stringOrDefault(
    payload,
    'weekly_class_count',
    '4-6'
  );
  const longestClassGap = stringOrDefault(
    payload,
    'longest_class_gap',
    '1 hour'
  );
  const userUpdate = tx.executeSync(
    `UPDATE users
     SET username = ?, time_format_24h = ?, week_starts_monday = ?,
         dark_mode = ?, updated_at = ?
     WHERE id = ?`,
    [
      username,
      booleanOrDefault(payload, 'time_format_24h', false) ? 1 : 0,
      booleanOrDefault(payload, 'week_starts_monday', false) ? 1 : 0,
      booleanOrDefault(payload, 'dark_mode', false) ? 1 : 0,
      change.updatedAt,
      localUserId,
    ]
  );
  if (userUpdate.rowsAffected !== 1) {
    throw new Error('The active local user disappeared during sync.');
  }

  const existingPreferences = tx.executeSync(
    'SELECT id FROM user_preferences WHERE user_id = ?',
    [localUserId]
  ).rows?.[0];
  if (existingPreferences) {
    tx.executeSync(
      `UPDATE user_preferences
       SET wake_time = ?, sleep_time = ?, study_peak_hours = ?, busiest_day = ?,
           reminder_lead_minutes = ?, snooze_tendency = ?, weekly_class_count = ?,
           longest_class_gap = ?, updated_at = ?
       WHERE user_id = ?`,
      [
        wakeTime,
        sleepTime,
        studyPeakHours,
        busiestDay,
        reminderLeadMinutes,
        snoozeTendency,
        weeklyClassCount,
        longestClassGap,
        change.updatedAt,
        localUserId,
      ]
    );
    return;
  }

  tx.executeSync(
    `INSERT INTO user_preferences (
       id, user_id, wake_time, sleep_time, study_peak_hours, busiest_day,
       reminder_lead_minutes, snooze_tendency, weekly_class_count,
       longest_class_gap, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `sync_pref_${localUserId}`,
      localUserId,
      wakeTime,
      sleepTime,
      studyPeakHours,
      busiestDay,
      reminderLeadMinutes,
      snoozeTendency,
      weeklyClassCount,
      longestClassGap,
      change.updatedAt,
      change.updatedAt,
    ]
  );
};

const applyTask = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: SyncChange
): void => {
  assertEntityOwnership(tx, 'tasks', change.entityId, localUserId);
  const payload = change.payload;
  tx.executeSync(
    `INSERT INTO tasks (
       id, user_id, title, due_date, due_time, is_completed, priority,
       category, notes, recurrence_rule, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, due_date = excluded.due_date,
       due_time = excluded.due_time, is_completed = excluded.is_completed,
       priority = excluded.priority, category = excluded.category,
       notes = excluded.notes, recurrence_rule = excluded.recurrence_rule,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      change.entityId,
      localUserId,
      requireString(payload, 'title'),
      nullableString(payload, 'due_date'),
      nullableString(payload, 'due_time'),
      booleanOrDefault(payload, 'is_completed', false) ? 1 : 0,
      normalizeTaskPriority(payload),
      stringOrDefault(payload, 'category', 'General'),
      nullableString(payload, 'notes'),
      nullableString(payload, 'recurrence_rule'),
      change.updatedAt,
      change.updatedAt,
    ]
  );
};

const applyEvent = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: SyncChange
): void => {
  assertEntityOwnership(tx, 'events', change.entityId, localUserId);
  const payload = change.payload;
  tx.executeSync(
    `INSERT INTO events (
       id, user_id, title, date, start_time, end_time, location,
       linked_calendar_block, recurrence_rule, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, date = excluded.date,
       start_time = excluded.start_time, end_time = excluded.end_time,
       location = excluded.location,
       linked_calendar_block = excluded.linked_calendar_block,
       recurrence_rule = excluded.recurrence_rule,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      change.entityId,
      localUserId,
      requireString(payload, 'title'),
      requireString(payload, 'date'),
      requireString(payload, 'start_time'),
      requireString(payload, 'end_time'),
      nullableString(payload, 'location'),
      nullableString(payload, 'linked_calendar_block'),
      nullableString(payload, 'recurrence_rule'),
      change.updatedAt,
      change.updatedAt,
    ]
  );
};

const applyTimeBlock = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: SyncChange
): void => {
  assertEntityOwnership(tx, 'time_blocks', change.entityId, localUserId);
  const payload = change.payload;
  tx.executeSync(
    `INSERT INTO time_blocks (
       id, user_id, title, date, start_time, end_time, color, category,
       notes, recurrence_rule, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, date = excluded.date,
       start_time = excluded.start_time, end_time = excluded.end_time,
       color = excluded.color, category = excluded.category,
       notes = excluded.notes, recurrence_rule = excluded.recurrence_rule,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      change.entityId,
      localUserId,
      requireString(payload, 'title'),
      requireString(payload, 'date'),
      requireString(payload, 'start_time'),
      requireString(payload, 'end_time'),
      requireString(payload, 'color'),
      requireString(payload, 'category'),
      nullableString(payload, 'notes'),
      nullableString(payload, 'recurrence_rule'),
      change.updatedAt,
      change.updatedAt,
    ]
  );
};

const applyReminder = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: SyncChange
): void => {
  assertEntityOwnership(tx, 'reminders', change.entityId, localUserId);
  const payload = change.payload;
  tx.executeSync(
    `INSERT INTO reminders (
       id, user_id, task, description, scheduled_at, trigger_at, status,
       snooze_count, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       task = excluded.task, description = excluded.description,
       scheduled_at = excluded.scheduled_at, trigger_at = excluded.trigger_at,
       status = excluded.status, snooze_count = excluded.snooze_count,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      change.entityId,
      localUserId,
      requireString(payload, 'task'),
      nullableString(payload, 'description'),
      requireString(payload, 'scheduled_at'),
      requireString(payload, 'trigger_at'),
      stringOrDefault(payload, 'status', 'pending'),
      integerOrDefault(payload, 'snooze_count', 0),
      change.updatedAt,
      change.updatedAt,
    ]
  );
};

const applyNote = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: SyncChange
): void => {
  assertEntityOwnership(tx, 'notes', change.entityId, localUserId);
  const payload = change.payload;
  tx.executeSync(
    `INSERT INTO notes (
       id, user_id, title, body, is_pinned, tags, category,
       is_voice_transcribed, sort_order, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, body = excluded.body,
       is_pinned = excluded.is_pinned, tags = excluded.tags,
       category = excluded.category,
       is_voice_transcribed = excluded.is_voice_transcribed,
       sort_order = excluded.sort_order, updated_at = excluded.updated_at,
       deleted_at = NULL`,
    [
      change.entityId,
      localUserId,
      requireString(payload, 'title'),
      requireString(payload, 'body'),
      booleanOrDefault(payload, 'is_pinned', false) ? 1 : 0,
      normalizeNoteTags(payload),
      stringOrDefault(payload, 'category', 'General'),
      booleanOrDefault(payload, 'is_voice_transcribed', false) ? 1 : 0,
      integerOrDefault(payload, 'sort_order', 0),
      change.updatedAt,
      change.updatedAt,
    ]
  );
};

const applyCustomCategory = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: SyncChange
): void => {
  assertEntityOwnership(tx, 'custom_categories', change.entityId, localUserId);
  const payload = change.payload;
  tx.executeSync(
    `INSERT INTO custom_categories (
       id, user_id, name, color, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, color = excluded.color,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      change.entityId,
      localUserId,
      requireString(payload, 'name'),
      requireString(payload, 'color'),
      change.updatedAt,
      change.updatedAt,
    ]
  );
};

const getPersonalEntityTable = (entityType: SyncEntityType): string | null => {
  switch (entityType) {
    case 'task':
      return 'tasks';
    case 'event':
      return 'events';
    case 'time_block':
      return 'time_blocks';
    case 'reminder':
      return 'reminders';
    case 'note':
      return 'notes';
    case 'custom_category':
      return 'custom_categories';
    case 'business_task':
      return 'business_tasks';
    case 'business_task_assignment':
      return 'business_task_assignments';
    case 'business_work_block':
      return 'business_work_blocks';
    case 'profile':
    default:
      return STUDY_TOOL_TABLES[entityType] ?? null;
  }
};

const applyDelete = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: SyncChange
): void => {
  if (SINGLETON_SYNC_ENTITY_TYPES.includes(change.entityType)) {
    throw new Error(
      `Cloud ${change.entityType} deletion cannot be applied to an offline local account.`
    );
  }

  const table = getPersonalEntityTable(change.entityType);
  if (!table) {
    throw new Error(`Unsupported sync entity type: ${change.entityType}`);
  }
  assertEntityOwnership(tx, table, change.entityId, localUserId);
  const deletedAt = change.deletedAt ?? change.updatedAt;
  tx.executeSync(
    `UPDATE ${table}
     SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [deletedAt, change.updatedAt, change.entityId, localUserId]
  );
};

const applyChange = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: SyncChange
): boolean => {
  if (change.operation === 'delete') {
    applyDelete(tx, localUserId, change);
    return change.entityType === 'reminder';
  }

  switch (change.entityType) {
    case 'profile':
      applyProfile(tx, localUserId, change);
      break;
    case 'task':
      applyTask(tx, localUserId, change);
      break;
    case 'event':
      applyEvent(tx, localUserId, change);
      break;
    case 'time_block':
      applyTimeBlock(tx, localUserId, change);
      break;
    case 'reminder':
      applyReminder(tx, localUserId, change);
      return true;
    case 'note':
      applyNote(tx, localUserId, change);
      break;
    case 'custom_category':
      applyCustomCategory(tx, localUserId, change);
      break;
    default:
      if (!applyStudyToolChange(tx, localUserId, change)) {
        throw new Error(
          `Unsupported sync entity type: ${String(change.entityType)}`
        );
      }
  }
  return false;
};

const assertActiveLocalUser = (localUserId: string): void => {
  const session = userStore.getActiveSessionToken();
  if (session.userId !== localUserId || !userStore.getUserById(localUserId)) {
    throw new Error('The active local account changed during sync.');
  }
};

const formatMutation = (
  localUserId: string,
  item: OutboxItem
): OutboundMutation => {
  const resolvedBaseVersion = LAST_WRITE_WINS_ENTITY_TYPES.includes(item.entityType)
    ? null
    : item.operation === 'create'
      ? 0
      : item.baseVersion ??
        syncMetadataStore.getVersion(
          localUserId,
          item.entityType,
          item.entityId,
          item.scopeType,
          item.scopeId
        );
  return {
    mutationId: item.id,
    entityType: item.entityType,
    entityId: item.entityId,
    operation: item.operation,
    clientUpdatedAt: item.updatedAt,
    payload: item.payload,
    ...(resolvedBaseVersion === null
      ? {}
      : { baseVersion: resolvedBaseVersion }),
  };
};

const validateMutationResults = (
  response: SyncBatchResponsePayload,
  sentMutations: OutboundMutation[]
): void => {
  const sentById = new Map(
    sentMutations.map((mutation) => [mutation.mutationId, mutation])
  );
  const seen = new Set<string>();
  for (const result of response.accepted) {
    if (result.status !== 'accepted') {
      throw new Error('Server put a non-accepted result in the accepted list.');
    }
  }
  for (const result of response.rejected) {
    if (result.status !== 'rejected') {
      throw new Error('Server put a non-rejected result in the rejected list.');
    }
  }
  for (const result of [...response.accepted, ...response.rejected]) {
    const sent = sentById.get(result.mutationId);
    if (!sent) {
      throw new Error(
        `Server returned an unknown mutation result: ${result.mutationId}`
      );
    }
    if (
      result.entityType !== sent.entityType ||
      result.entityId !== sent.entityId
    ) {
      throw new Error(
        `Server returned mismatched entity details for mutation ${result.mutationId}.`
      );
    }
    if (seen.has(result.mutationId)) {
      throw new Error(
        `Server returned duplicate mutation results for: ${result.mutationId}`
      );
    }
    seen.add(result.mutationId);
  }
  if (seen.size !== sentById.size) {
    const missingIds = [...sentById.keys()].filter((id) => !seen.has(id));
    throw new Error(
      `Server omitted mutation results for: ${missingIds.join(', ')}`
    );
  }
};

const validatePage = (
  response: SyncBatchResponsePayload,
  requestCursor: number
): void => {
  if (!Number.isInteger(response.nextCursor) || response.nextCursor < requestCursor) {
    throw new Error('Server returned an invalid or regressing sync cursor.');
  }
  let greatestChangeId = requestCursor;
  for (const change of response.changes) {
    if (!Number.isInteger(change.changeId) || change.changeId <= requestCursor) {
      throw new Error('Server returned a change at or behind the requested cursor.');
    }
    if (change.changeId <= greatestChangeId) {
      throw new Error('Server returned changes out of order.');
    }
    greatestChangeId = change.changeId;
  }
  if (response.changes.length === 0 && response.nextCursor !== requestCursor) {
    throw new Error('Server advanced the cursor without returning changes.');
  }
  if (
    response.changes.length > 0 &&
    response.nextCursor !== greatestChangeId
  ) {
    throw new Error('Server cursor does not match the last returned change.');
  }
  if (response.hasMore && response.nextCursor === requestCursor) {
    throw new Error('Server pagination made no cursor progress.');
  }
  for (const change of response.changes) {
    if (!Number.isInteger(change.version) || change.version <= 0) {
      throw new Error('Server returned a non-positive entity version.');
    }
  }
};

const sameStringSet = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return leftSet.size === right.length && right.every((item) => leftSet.has(item));
};

/**
 * Validates one snapshot page. `effectiveTypes` are the types this client and
 * the answering server share: the snapshot must be authoritative for exactly
 * those, and may carry nothing else.
 */
const validateSnapshotResponse = (
  response: SyncBatchResponsePayload,
  requestCursor: number,
  request: SnapshotRequestPayload,
  effectiveTypes: readonly SyncEntityType[]
): SnapshotPage => {
  const authoritativeTypes = AUTHORITATIVE_SYNC_ENTITY_TYPES.filter((entityType) =>
    effectiveTypes.includes(entityType)
  );
  const snapshot = response.snapshot;
  if (!snapshot) {
    throw new Error('Server omitted the requested current-state snapshot page.');
  }
  if (
    response.resetRequired ||
    response.changes.length > 0 ||
    response.hasMore ||
    response.nextCursor !== requestCursor
  ) {
    throw new Error('Server mixed delta progress into a snapshot response.');
  }
  if (
    !Number.isInteger(snapshot.boundaryCursor) ||
    snapshot.boundaryCursor < 0 ||
    (request.boundaryCursor !== undefined &&
      snapshot.boundaryCursor !== request.boundaryCursor)
  ) {
    throw new Error('Server returned an invalid or changing snapshot boundary.');
  }
  if (snapshot.hasMore === snapshot.complete) {
    throw new Error('Server returned inconsistent snapshot pagination flags.');
  }
  if (
    (snapshot.hasMore && !snapshot.nextAfter) ||
    (snapshot.complete && snapshot.nextAfter)
  ) {
    throw new Error('Server returned an invalid snapshot continuation position.');
  }
  if (snapshot.hasMore && snapshot.items.length === 0) {
    throw new Error('Server snapshot pagination made no item progress.');
  }
  if (
    request.after &&
    snapshot.nextAfter &&
    request.after.entityType === snapshot.nextAfter.entityType &&
    request.after.entityId === snapshot.nextAfter.entityId
  ) {
    throw new Error('Server repeated the same snapshot continuation position.');
  }
  if (!sameStringSet(snapshot.authoritativeEntityTypes, authoritativeTypes)) {
    throw new Error('Server snapshot did not cover every personal entity type.');
  }
  if (
    !snapshot.prunePolicy.requireExistingSyncMetadata ||
    !sameStringSet(
      snapshot.prunePolicy.preserveOutboxStatuses,
      OUTBOX_PRESERVE_STATUSES
    )
  ) {
    throw new Error('Server returned an unsafe snapshot prune policy.');
  }

  for (const change of snapshot.items) {
    if (
      !Number.isInteger(change.changeId) ||
      change.changeId <= 0 ||
      change.changeId > snapshot.boundaryCursor ||
      !Number.isInteger(change.version) ||
      change.version <= 0
    ) {
      throw new Error('Server returned invalid snapshot entity metadata.');
    }
    if (change.operation !== 'update' && change.operation !== 'delete') {
      throw new Error('Server returned a non-current-state snapshot operation.');
    }
    if (!effectiveTypes.includes(change.entityType)) {
      throw new Error(`Unsupported snapshot entity type: ${String(change.entityType)}`);
    }
  }
  return snapshot;
};

const pruneServerMissingEntities = (
  tx: DatabaseTransaction,
  localUserId: string,
  items: SyncChange[],
  serverTime: string,
  authoritativeTypes: readonly SyncEntityType[]
): boolean => {
  const snapshotIds = new Map<SyncEntityType, Set<string>>();
  for (const entityType of authoritativeTypes) {
    snapshotIds.set(entityType, new Set());
  }
  for (const item of items) {
    snapshotIds.get(item.entityType)?.add(item.entityId);
  }

  let reminderTextUpdated = false;
  for (const entityType of authoritativeTypes) {
    const table = getPersonalEntityTable(entityType);
    if (!table) continue;
    const syncedRows = tx.executeSync(
      `SELECT entity_id AS id
       FROM sync_metadata
       WHERE user_id = ? AND scope_type = ? AND scope_id = ?
         AND entity_type = ?`,
      [localUserId, ACCOUNT_SCOPE, localUserId, entityType]
    ).rows ?? [];

    for (const row of syncedRows) {
      const entityId = String(row.id);
      if (snapshotIds.get(entityType)?.has(entityId)) continue;
      const protectedMutation = tx.executeSync(
        `SELECT id FROM sync_outbox
         WHERE user_id = ? AND scope_type = ? AND scope_id = ?
           AND entity_type = ? AND entity_id = ?
           AND status IN ('pending', 'in_progress', 'failed')
         LIMIT 1`,
        [localUserId, ACCOUNT_SCOPE, localUserId, entityType, entityId]
      ).rows?.[0];
      if (protectedMutation) continue;

      const result = tx.executeSync(
        `UPDATE ${table}
         SET deleted_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [serverTime, serverTime, entityId, localUserId]
      );
      if ((result.rowsAffected ?? 0) > 0) {
        remoteChangesApplied += 1;
        if (entityType === 'reminder') reminderTextUpdated = true;
      }
      tx.executeSync(
        `DELETE FROM sync_metadata
         WHERE user_id = ? AND scope_type = ? AND scope_id = ?
           AND entity_type = ? AND entity_id = ?`,
        [localUserId, ACCOUNT_SCOPE, localUserId, entityType, entityId]
      );
    }
  }
  return reminderTextUpdated;
};

const applyAuthoritativeSnapshot = (
  localUserId: string,
  items: SyncChange[],
  boundaryCursor: number,
  serverTime: string,
  effectiveTypes: readonly SyncEntityType[]
): ApplyPageResult => {
  let reminderTextUpdated = false;
  db.transactionSync((tx: DatabaseTransaction) => {
    syncOutboxStore.setSuppression(
      localUserId,
      true,
      ACCOUNT_SCOPE,
      localUserId,
      tx
    );
    try {
      reminderTextUpdated = pruneServerMissingEntities(
        tx,
        localUserId,
        items,
        serverTime,
        AUTHORITATIVE_SYNC_ENTITY_TYPES.filter((entityType) =>
          effectiveTypes.includes(entityType)
        )
      );
      for (const change of items) {
        const knownVersion = syncMetadataStore.getVersion(
          localUserId,
          change.entityType,
          change.entityId,
          ACCOUNT_SCOPE,
          localUserId,
          tx
        );
        if (knownVersion !== change.version) remoteChangesApplied += 1;
        reminderTextUpdated =
          applyChange(tx, localUserId, change) || reminderTextUpdated;
        syncMetadataStore.upsert(
          localUserId,
          {
            entityType: change.entityType,
            entityId: change.entityId,
            version: change.version,
            changeId: change.changeId,
            updatedAt: change.updatedAt,
          },
          ACCOUNT_SCOPE,
          localUserId,
          tx
        );
      }
      syncState.saveProgress(
        localUserId,
        boundaryCursor,
        serverTime,
        'Syncing',
        null,
        tx
      );
      // Rows of these types now match the server, so a later pass needs a new
      // snapshot only if the shared set changes.
      syncStateStore.saveSnapshotEntityTypes(
        localUserId,
        effectiveTypes,
        ACCOUNT_SCOPE,
        localUserId,
        tx
      );
    } finally {
      syncOutboxStore.setSuppression(
        localUserId,
        false,
        ACCOUNT_SCOPE,
        localUserId,
        tx
      );
    }
  });
  syncState.reload(localUserId);
  return { reminderTextUpdated };
};

const applyPage = (
  localUserId: string,
  response: SyncBatchResponsePayload,
  finalStatus: 'Syncing' | 'Synced' | 'Attention required',
  finalError: string | null
): ApplyPageResult => {
  let reminderTextUpdated = false;
  const ownEchoes = new Set(
    response.accepted.map(
      (result) => `${result.entityType}:${result.entityId}:${result.serverVersion}`
    )
  );

  db.transactionSync((tx: DatabaseTransaction) => {
    syncOutboxStore.setSuppression(
      localUserId,
      true,
      ACCOUNT_SCOPE,
      localUserId,
      tx
    );
    try {
      for (const change of response.changes) {
        if (!ownEchoes.has(`${change.entityType}:${change.entityId}:${change.version}`)) {
          remoteChangesApplied += 1;
        }
        reminderTextUpdated =
          applyChange(tx, localUserId, change) || reminderTextUpdated;
        syncMetadataStore.upsert(
          localUserId,
          {
            entityType: change.entityType,
            entityId: change.entityId,
            version: change.version,
            changeId: change.changeId,
            updatedAt: change.updatedAt,
          },
          ACCOUNT_SCOPE,
          localUserId,
          tx
        );
      }

      syncState.saveProgress(
        localUserId,
        response.nextCursor,
        response.serverTime,
        finalStatus,
        finalError,
        tx
      );
    } finally {
      syncOutboxStore.setSuppression(
        localUserId,
        false,
        ACCOUNT_SCOPE,
        localUserId,
        tx
      );
    }
  });

  syncState.reload(localUserId);
  return { reminderTextUpdated };
};

const settleMutationResults = (
  localUserId: string,
  response: SyncBatchResponsePayload,
  inFlightMutations: OutboundMutation[]
): number => {
  const sentById = new Map(
    inFlightMutations.map((mutation) => [mutation.mutationId, mutation])
  );
  db.transactionSync((tx) => {
    for (const result of response.rejected) {
      const sent = sentById.get(result.mutationId);
      if (!sent) {
        throw new Error(
          `Cannot persist rejection for unknown mutation ${result.mutationId}.`
        );
      }
      syncConflictStore.record(
        localUserId,
        {
          mutationId: result.mutationId,
          entityType: result.entityType,
          entityId: result.entityId,
          operation: sent.operation,
          reason: result.reason ?? 'server_rejected',
          localPayload: sent.payload,
          baseVersion: sent.baseVersion ?? null,
          serverVersion: result.serverVersion ?? null,
          serverPayload: result.serverPayload ?? null,
        },
        ACCOUNT_SCOPE,
        localUserId,
        tx
      );
    }
    syncOutboxStore.acknowledgeMutations(
      localUserId,
      response.accepted.map((item) => item.mutationId),
      ACCOUNT_SCOPE,
      localUserId,
      tx
    );
    syncOutboxStore.markMutationsFailed(
      localUserId,
      response.rejected.map((item) => item.mutationId),
      ACCOUNT_SCOPE,
      localUserId,
      tx
    );
  });
  return response.rejected.length;
};

interface PreparedOutboxBatch {
  mutations: OutboundMutation[];
  ids: string[];
}

/**
 * Parks a mutation too large for any request as a conflict, so it stops
 * blocking the queue and the account shows it needs attention.
 */
const failOversizedMutations = (
  localUserId: string,
  oversized: OutboundMutation[]
): void => {
  if (oversized.length === 0) return;
  db.transactionSync((tx) => {
    for (const mutation of oversized) {
      syncConflictStore.record(
        localUserId,
        {
          mutationId: mutation.mutationId,
          entityType: mutation.entityType,
          entityId: mutation.entityId,
          operation: mutation.operation,
          reason: 'payload_too_large',
          localPayload: {},
          baseVersion: mutation.baseVersion ?? null,
          serverVersion: null,
          serverPayload: null,
        },
        ACCOUNT_SCOPE,
        localUserId,
        tx
      );
    }
    syncOutboxStore.markMutationsFailed(
      localUserId,
      oversized.map((mutation) => mutation.mutationId),
      ACCOUNT_SCOPE,
      localUserId,
      tx
    );
  });
};

/**
 * Claims the next batch: one mutation per entity, only of types the server
 * accepts (`effectiveTypes`), and no more than fits in one request body.
 */
const prepareOutboxBatch = (
  localUserId: string,
  effectiveTypes: readonly SyncEntityType[]
): PreparedOutboxBatch => {
  for (let claimAttempt = 0; claimAttempt < 2; claimAttempt += 1) {
    const pending = syncOutboxStore.getPendingMutations(
      localUserId,
      OUTBOX_BATCH_SIZE,
      ACCOUNT_SCOPE,
      localUserId,
      undefined,
      effectiveTypes
    );
    const seenEntities = new Set<string>();
    const mutations: OutboundMutation[] = [];
    const oversized: OutboundMutation[] = [];
    let batchBytes = 0;
    for (const item of pending) {
      const key = `${item.entityType}:${item.entityId}`;
      if (seenEntities.has(key)) continue;
      seenEntities.add(key);
      const mutation = formatMutation(localUserId, item);
      const size = utf8Length(JSON.stringify(mutation));
      if (size > MAX_BATCH_BYTES) {
        oversized.push(mutation);
        continue;
      }
      if (batchBytes + size > MAX_BATCH_BYTES) break;
      batchBytes += size;
      mutations.push(mutation);
    }
    failOversizedMutations(localUserId, oversized);
    const ids = mutations.map((mutation) => mutation.mutationId);
    const claimed = syncOutboxStore.markMutationsInProgress(
      localUserId,
      ids,
      ACCOUNT_SCOPE,
      localUserId
    );
    if (claimed === ids.length) {
      return { mutations, ids };
    }

    syncOutboxStore.requeueMutations(
      localUserId,
      ids,
      ACCOUNT_SCOPE,
      localUserId
    );
  }

  throw new Error('Could not claim a stable account-scoped outbox batch.');
};

export const syncWorker = {
  /** Returns the count of consecutive retryable sync failures. */
  getRetryAttempt: (): number => retryAttempt,

  /**
   * Returns how many changes from elsewhere were applied since the last call,
   * and resets the count. Callers refresh screens only when it is non-zero.
   */
  takeRemoteChangeCount: (): number => {
    const count = remoteChangesApplied;
    remoteChangesApplied = 0;
    return count;
  },

  /**
   * Executes a bidirectional account-scoped synchronization pass.
   * Local scheduling remains available when the network or cloud service fails.
   */
  /**
   * Runs one push-then-pull pass, or joins the one already running.
   *
   * Returning straight away when a pass is in flight — as this used to — let a
   * caller that refreshes the screen when the promise settles do so before the
   * data it was waiting for had arrived. Right after an account is restored
   * from the cloud, that meant opening onto an empty calendar.
   */
  performSync: (): Promise<void> => {
    if (inFlightSync) return inFlightSync;
    inFlightSync = syncWorker.runSyncPass().finally(() => {
      inFlightSync = null;
    });
    return inFlightSync;
  },

  /** One pass of the sync protocol. Call `performSync`, which serialises passes. */
  runSyncPass: async (): Promise<void> => {

    let localUserId: string | null = null;
    let inFlightMutationIds: string[] = [];
    let inFlightMutations: OutboundMutation[] = [];
    try {
      const session = userStore.getActiveSessionToken();
      localUserId = session.userId;
      if (!localUserId || !userStore.getUserById(localUserId)) {
        syncState.deactivate('Sign-in required');
        return;
      }
      if (db.isFallback()) {
        syncState.deactivate('Local only');
        return;
      }

      const persistedState = syncState.activate(localUserId);
      const isOnline = await cloudClient.isOnline();
      if (!isOnline) {
        syncState.setStatus(localUserId, 'Offline');
        return;
      }

      if (!cloudClient.getAccessToken()) {
        const linkResult = await accountLinkService.completeDeferredCloudLink(
          localUserId
        );
        if (linkResult.status !== 'success' || !cloudClient.getAccessToken()) {
          syncState.setStatus(
            localUserId,
            linkResult.status === 'offline' ? 'Offline' : 'Sign-in required',
            linkResult.message
          );
          return;
        }
      }

      syncState.setStatus(localUserId, 'Syncing');

      try {
        await accountLinkService.refreshCloudProfile(localUserId);
      } catch (error: unknown) {
        console.warn('[SyncWorker] Profile refresh note:', error);
      }
      assertActiveLocalUser(localUserId);

      syncOutboxStore.recoverInProgressMutations(
        localUserId,
        ACCOUNT_SCOPE,
        localUserId
      );
      const negotiated = syncStateStore.loadEntityTypes(localUserId);
      let knownServerTypes = negotiated.serverEntityTypes;
      let effectiveTypes = effectiveSyncEntityTypes(knownServerTypes);
      // When the types this client and the server share have changed since the
      // last snapshot — either side was upgraded — changes to a newly shared
      // type may already be behind the cursor. Start from a fresh snapshot.
      const snapshotFirst =
        negotiated.snapshotEntityTypes === null ||
        !sameEntityTypeSet(negotiated.snapshotEntityTypes, effectiveTypes);
      let preparedBatch: PreparedOutboxBatch = snapshotFirst
        ? { mutations: [], ids: [] }
        : prepareOutboxBatch(localUserId, effectiveTypes);
      let outboundMutations = preparedBatch.mutations;
      inFlightMutationIds = preparedBatch.ids;
      inFlightMutations = preparedBatch.mutations;
      let requestCursor = snapshotFirst ? 0 : persistedState.cursor;
      let resetHandled = false;
      let snapshotRequest: SnapshotRequestPayload | null = snapshotFirst ? {} : null;
      let snapshotItems: SyncChange[] = [];
      const snapshotItemKeys = new Set<string>();
      let rejectedCount = 0;
      let reminderTextUpdated = false;

      for (
        let requestNumber = 1;
        requestNumber <= MAX_SYNC_REQUESTS;
        requestNumber += 1
      ) {
        assertActiveLocalUser(localUserId);
        const result = await cloudClient.request<SyncBatchResponsePayload>(
          '/v1/sync/batch',
          {
            method: 'POST',
            body: JSON.stringify({
              mutations: outboundMutations,
              cursor: requestCursor,
              entityTypes: CLIENT_SYNC_ENTITY_TYPES,
              ...(snapshotRequest === null
                ? {}
                : { snapshot: snapshotRequest }),
            }),
          },
          true
        );

        if (result.status === 'offline') {
          syncOutboxStore.requeueMutations(
            localUserId,
            inFlightMutationIds,
            ACCOUNT_SCOPE,
            localUserId
          );
          inFlightMutationIds = [];
          inFlightMutations = [];
          syncState.setStatus(localUserId, 'Offline');
          return;
        }
        if (result.status === 'auth_required') {
          syncOutboxStore.requeueMutations(
            localUserId,
            inFlightMutationIds,
            ACCOUNT_SCOPE,
            localUserId
          );
          inFlightMutationIds = [];
          inFlightMutations = [];
          syncState.setStatus(localUserId, 'Sign-in required');
          return;
        }
        if (result.status !== 'success' || !result.data) {
          syncOutboxStore.requeueMutations(
            localUserId,
            inFlightMutationIds,
            ACCOUNT_SCOPE,
            localUserId
          );
          inFlightMutationIds = [];
          inFlightMutations = [];
          retryAttempt += 1;
          syncState.setStatus(
            localUserId,
            'Attention required',
            result.error || 'Sync request failed'
          );
          return;
        }

        const response = result.data;
        validateMutationResults(response, inFlightMutations);
        assertActiveLocalUser(localUserId);

        // What this server shares with the client decides what is pushed next
        // and what a snapshot must cover. A change is remembered for the next
        // pass, which then starts from a snapshot.
        effectiveTypes = effectiveSyncEntityTypes(response.supportedEntityTypes);
        if (
          response.supportedEntityTypes &&
          (knownServerTypes === null ||
            !sameEntityTypeSet(knownServerTypes, response.supportedEntityTypes))
        ) {
          knownServerTypes = [...response.supportedEntityTypes];
          syncStateStore.saveServerEntityTypes(localUserId, knownServerTypes);
        }

        if (snapshotRequest !== null) {
          const snapshot = validateSnapshotResponse(
            response,
            requestCursor,
            snapshotRequest,
            effectiveTypes
          );
          for (const item of snapshot.items) {
            const key = `${item.entityType}:${item.entityId}`;
            if (snapshotItemKeys.has(key)) {
              throw new Error(`Server repeated snapshot entity ${key}.`);
            }
            snapshotItemKeys.add(key);
            snapshotItems.push(item);
          }

          if (!snapshot.complete) {
            if (!snapshot.nextAfter) {
              throw new Error('Server omitted the next snapshot position.');
            }
            snapshotRequest = {
              boundaryCursor: snapshot.boundaryCursor,
              after: snapshot.nextAfter,
            };
            continue;
          }

          const snapshotResult = applyAuthoritativeSnapshot(
            localUserId,
            snapshotItems,
            snapshot.boundaryCursor,
            response.serverTime,
            effectiveTypes
          );
          reminderTextUpdated =
            reminderTextUpdated || snapshotResult.reminderTextUpdated;
          requestCursor = snapshot.boundaryCursor;
          snapshotRequest = null;
          snapshotItems = [];
          snapshotItemKeys.clear();
          continue;
        }

        if (response.snapshot) {
          throw new Error('Server returned an unsolicited current-state snapshot.');
        }
        validatePage(response, requestCursor);
        if (response.resetRequired) {
          if (
            resetHandled ||
            response.changes.length > 0 ||
            response.hasMore ||
            response.nextCursor !== requestCursor
          ) {
            throw new Error('Server repeatedly requested a sync cursor reset.');
          }
          rejectedCount += settleMutationResults(
            localUserId,
            response,
            inFlightMutations
          );
          inFlightMutationIds = [];
          inFlightMutations = [];
          resetHandled = true;
          requestCursor = 0;
          snapshotRequest = {};
          snapshotItems = [];
          snapshotItemKeys.clear();
          outboundMutations = [];
          continue;
        }

        const pageResult = applyPage(
          localUserId,
          response,
          'Syncing',
          null
        );
        reminderTextUpdated =
          reminderTextUpdated || pageResult.reminderTextUpdated;
        rejectedCount += settleMutationResults(
          localUserId,
          response,
          inFlightMutations
        );
        inFlightMutationIds = [];
        inFlightMutations = [];
        requestCursor = response.nextCursor;

        if (response.hasMore) {
          outboundMutations = [];
          continue;
        }

        preparedBatch = prepareOutboxBatch(localUserId, effectiveTypes);
        outboundMutations = preparedBatch.mutations;
        inFlightMutationIds = preparedBatch.ids;
        inFlightMutations = preparedBatch.mutations;
        if (outboundMutations.length > 0) {
          continue;
        }

        const rejectedMessage =
          rejectedCount > 0
            ? `${rejectedCount} mutation${
                rejectedCount === 1 ? '' : 's'
              } rejected by server`
            : null;
        syncState.setStatus(
          localUserId,
          rejectedCount > 0 ? 'Attention required' : 'Synced',
          rejectedMessage
        );
        retryAttempt = 0;
        if (reminderTextUpdated) {
          await reconcileReminderAlarms(
            remindersStore.getPendingReminders(localUserId)
          );
        }
        return;
      }

      throw new Error(
        `Sync exceeded the ${MAX_SYNC_REQUESTS}-request safety limit.`
      );
    } catch (error: unknown) {
      if (localUserId) {
        syncOutboxStore.requeueMutations(
          localUserId,
          inFlightMutationIds,
          ACCOUNT_SCOPE,
          localUserId
        );
        inFlightMutationIds = [];
        inFlightMutations = [];
      }
      retryAttempt += 1;
      console.error('[SyncWorker] Error during sync pass:', error);
      if (
        localUserId &&
        userStore.getActiveSessionToken().userId === localUserId
      ) {
        syncState.setStatus(
          localUserId,
          'Attention required',
          getErrorMessage(error)
        );
      } else {
        syncState.deactivate(
          localUserId ? 'Local only' : 'Attention required',
          localUserId ? null : getErrorMessage(error)
        );
      }
    }
  },
};
