import { db, DatabaseTransaction } from './database';
import { seedLocalDemoAccounts } from './demoSeed';
import { buildProfileSyncPayload } from './profileSyncPayload';
import type {
  SyncEntityType,
  SyncOperation,
  SyncPayload,
} from './syncTypes';
import { generateId } from '../utils';

/**
 * SQLite `user_version` this build migrates to.
 * 16: study tools (Pomodoro, flashcards, study notes, meetings) and
 * entity-type negotiation for sync.
 */
const SCHEMA_VERSION = 17;

type LegacySyncRow = Record<string, unknown>;

const asString = (value: unknown, fallback: string = ''): string =>
  typeof value === 'string' ? value : fallback;

const asNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const normalizePriority = (value: unknown): 'High' | 'Medium' | 'Low' => {
  const normalized = asString(value, 'Medium').trim().toLowerCase();
  if (normalized === 'high') return 'High';
  if (normalized === 'low') return 'Low';
  return 'Medium';
};

const normalizeTags = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim() === '') return '[]';
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === 'string')
    ) {
      return JSON.stringify(parsed);
    }
  } catch {
    // Legacy comma-delimited tags are canonicalized below.
  }
  return JSON.stringify(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
};

const utcAuditTimestamp = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    ? value
    : `${value.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
};

const timestampMillis = (value: unknown): number | null => {
  const normalized = utcAuditTimestamp(value, '');
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
};

const enqueueLegacyMutationIfNeeded = (
  tx: DatabaseTransaction,
  localUserId: string,
  entityType: SyncEntityType,
  entityId: string,
  payload: SyncPayload,
  sourceUpdatedAt: unknown,
  deletedAt: unknown,
  migrationTime: string
): void => {
  if (!localUserId || !entityId) return;
  const metadata = tx.executeSync(
    `SELECT version, updated_at FROM sync_metadata
     WHERE user_id = ? AND scope_type = 'account' AND scope_id = ?
       AND entity_type = ? AND entity_id = ?
     LIMIT 1`,
    [localUserId, localUserId, entityType, entityId]
  ).rows?.[0];
  const hasOutbox = tx.executeSync(
    `SELECT 1 FROM sync_outbox
     WHERE user_id = ? AND scope_type = 'account' AND scope_id = ?
       AND entity_type = ? AND entity_id = ?
     LIMIT 1`,
    [localUserId, localUserId, entityType, entityId]
  ).rows?.[0];
  if (hasOutbox) return;

  let operation: SyncOperation;
  let baseVersion: number;
  if (metadata) {
    const version = metadata.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      return;
    }
    baseVersion = version;
    if (deletedAt !== null && deletedAt !== undefined) {
      operation = 'delete';
    } else {
      const localUpdatedAt = timestampMillis(sourceUpdatedAt);
      const metadataUpdatedAt = timestampMillis(metadata.updated_at);
      if (
        localUpdatedAt !== null &&
        metadataUpdatedAt !== null &&
        localUpdatedAt <= metadataUpdatedAt
      ) {
        return;
      }
      operation = 'update';
    }
  } else {
    if (deletedAt !== null && deletedAt !== undefined) return;
    operation = 'create';
    baseVersion = 0;
  }

  tx.executeSync(
    `INSERT INTO sync_outbox (
       id, user_id, scope_type, scope_id, entity_type, entity_id, operation,
       payload, base_version, created_at, updated_at, status, attempts
     ) VALUES (?, ?, 'account', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
    [
      generateId(),
      localUserId,
      localUserId,
      entityType,
      entityId,
      operation,
      JSON.stringify(operation === 'delete' ? {} : payload),
      baseVersion,
      migrationTime,
      utcAuditTimestamp(sourceUpdatedAt, migrationTime),
    ]
  );
};

const backfillLegacyPersonalOutbox = (
  tx: DatabaseTransaction,
  migrationTime: string
): void => {
  const personalRows = (table: string): LegacySyncRow[] =>
    (tx.executeSync(
      `SELECT local_row.* FROM ${table} AS local_row
       INNER JOIN users AS owner ON owner.id = local_row.user_id
       WHERE local_row.user_id NOT IN ('cloud', 'legacy')`
    ).rows ?? []) as LegacySyncRow[];

  const profiles = (tx.executeSync(
    `SELECT id, updated_at FROM users
     WHERE id NOT IN ('cloud', 'legacy')`
  ).rows ?? []) as LegacySyncRow[];
  for (const row of profiles) {
    const localUserId = asString(row.id);
    if (!localUserId) continue;
    enqueueLegacyMutationIfNeeded(
      tx,
      localUserId,
      'profile',
      'profile',
      buildProfileSyncPayload(localUserId, tx),
      row.updated_at,
      null,
      migrationTime
    );
  }

  for (const row of personalRows('tasks')) {
    const localUserId = asString(row.user_id);
    const entityId = asString(row.id);
    enqueueLegacyMutationIfNeeded(tx, localUserId, 'task', entityId, {
      title: asString(row.title),
      due_date: asNullableString(row.due_date),
      due_time: asNullableString(row.due_time),
      is_completed: row.is_completed === 1,
      priority: normalizePriority(row.priority),
      category: asString(row.category, 'General'),
      notes: asNullableString(row.notes),
      recurrence_rule: asNullableString(row.recurrence_rule),
    }, row.updated_at, row.deleted_at, migrationTime);
  }

  for (const row of personalRows('events')) {
    enqueueLegacyMutationIfNeeded(tx, asString(row.user_id), 'event', asString(row.id), {
      title: asString(row.title),
      date: asString(row.date),
      start_time: asString(row.start_time),
      end_time: asString(row.end_time),
      location: asNullableString(row.location),
      linked_calendar_block: asNullableString(row.linked_calendar_block),
      recurrence_rule: asNullableString(row.recurrence_rule),
    }, row.updated_at, row.deleted_at, migrationTime);
  }

  for (const row of personalRows('time_blocks')) {
    enqueueLegacyMutationIfNeeded(tx, asString(row.user_id), 'time_block', asString(row.id), {
      title: asString(row.title),
      date: asString(row.date),
      start_time: asString(row.start_time),
      end_time: asString(row.end_time),
      color: asString(row.color),
      category: asString(row.category, 'General'),
      notes: asNullableString(row.notes),
      recurrence_rule: asNullableString(row.recurrence_rule),
    }, row.updated_at, row.deleted_at, migrationTime);
  }

  for (const row of personalRows('reminders')) {
    enqueueLegacyMutationIfNeeded(tx, asString(row.user_id), 'reminder', asString(row.id), {
      task: asString(row.task),
      description: asNullableString(row.description),
      scheduled_at: asString(row.scheduled_at),
      trigger_at: asString(row.trigger_at),
      status: asString(row.status, 'pending'),
      snooze_count: typeof row.snooze_count === 'number' ? row.snooze_count : 0,
    }, row.updated_at, row.deleted_at, migrationTime);
  }

  for (const row of personalRows('notes')) {
    enqueueLegacyMutationIfNeeded(tx, asString(row.user_id), 'note', asString(row.id), {
      title: asString(row.title),
      body: asString(row.body),
      is_pinned: row.is_pinned === 1,
      tags: normalizeTags(row.tags),
      category: asString(row.category, 'General'),
      is_voice_transcribed: row.is_voice_transcribed === 1,
      sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
    }, row.updated_at, row.deleted_at, migrationTime);
  }

  for (const row of personalRows('custom_categories')) {
    enqueueLegacyMutationIfNeeded(
      tx,
      asString(row.user_id),
      'custom_category',
      asString(row.id),
      { name: asString(row.name), color: asString(row.color) },
      row.updated_at,
      row.deleted_at,
      migrationTime
    );
  }
};

/**
 * Initializes the SQLite database schema using non-destructive migrations.
 * Core operational tables and sync outbox structures are set up atomically inside a transaction.
 */
export const initDatabase = async (): Promise<void> => {
  try {
    await db.transaction(async (tx: DatabaseTransaction) => {
      // Create users table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          email TEXT,
          password_hash TEXT,
          role TEXT NOT NULL DEFAULT 'student',
          is_new_user INTEGER NOT NULL DEFAULT 1,
          time_format_24h INTEGER NOT NULL DEFAULT 0,
          week_starts_monday INTEGER NOT NULL DEFAULT 0,
          dark_mode INTEGER NOT NULL DEFAULT 0,
          cloud_account_id TEXT,
          cloud_linked INTEGER NOT NULL DEFAULT 0,
          cloud_linked_at TEXT,
          avatar_uri TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      // Create editable onboarding and reminder preferences table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE,
          wake_time TEXT NOT NULL,
          sleep_time TEXT NOT NULL,
          study_peak_hours TEXT NOT NULL,
          busiest_day TEXT NOT NULL,
          reminder_lead_minutes INTEGER NOT NULL,
          snooze_tendency TEXT NOT NULL,
          weekly_class_count TEXT NOT NULL,
          longest_class_gap TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create remember_me table (timestamp compliant)
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS remember_me (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          enabled INTEGER NOT NULL DEFAULT 0,
          email TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL
        )
      `);

      // Create active_session table (timestamp compliant)
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS active_session (
          user_id TEXT PRIMARY KEY,
          access_token TEXT,
          refresh_token TEXT,
          pending_cloud_credential TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create reminders table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS reminders (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          task TEXT NOT NULL,
          description TEXT,
          scheduled_at TEXT NOT NULL,
          trigger_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          precast_audio_path TEXT,
          snooze_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create job_queue_items table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS job_queue_items (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          reminder_id TEXT,
          job_type TEXT NOT NULL,
          payload TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (reminder_id) REFERENCES reminders (id) ON DELETE SET NULL
        )
      `);

      // Create time_blocks table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS time_blocks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          date TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          color TEXT NOT NULL,
          category TEXT NOT NULL,
          notes TEXT,
          recurrence_rule TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create tasks table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          due_date TEXT,
          due_time TEXT,
          is_completed INTEGER NOT NULL DEFAULT 0,
          priority TEXT NOT NULL,
          category TEXT NOT NULL,
          notes TEXT,
          recurrence_rule TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create events table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          date TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          location TEXT,
          linked_calendar_block TEXT,
          recurrence_rule TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create notes table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          is_pinned INTEGER NOT NULL DEFAULT 0,
          tags TEXT NOT NULL,
          category TEXT NOT NULL,
          is_voice_transcribed INTEGER NOT NULL DEFAULT 0,
          image_uri TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create chat_sessions table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create messages table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          sender TEXT NOT NULL,
          content TEXT NOT NULL,
          attachment_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (session_id) REFERENCES chat_sessions (id) ON DELETE CASCADE
        )
      `);

      // Create user_behavior_logs table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS user_behavior_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          event_key TEXT NOT NULL,
          event_value TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create ml_feature_snapshots table
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS ml_feature_snapshots (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          feature_type TEXT NOT NULL,
          feature_vector TEXT NOT NULL,
          computed_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create custom_categories table (timestamp compliant + soft delete)
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS custom_categories (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      // Create sync outbox & infrastructure tables
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS sync_outbox (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          scope_type TEXT NOT NULL DEFAULT 'account',
          scope_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          payload TEXT NOT NULL,
          base_version INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0
        )
      `);
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS sync_metadata (
          user_id TEXT NOT NULL,
          scope_type TEXT NOT NULL DEFAULT 'account',
          scope_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          change_id INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, scope_type, scope_id, entity_type, entity_id)
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS sync_state (
          user_id TEXT NOT NULL,
          scope_type TEXT NOT NULL DEFAULT 'account',
          scope_id TEXT NOT NULL,
          cursor INTEGER NOT NULL DEFAULT 0,
          last_synced_at TEXT,
          status TEXT NOT NULL DEFAULT 'Local only',
          error_message TEXT,
          server_entity_types TEXT,
          snapshot_entity_types TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, scope_type, scope_id)
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS sync_control (
          user_id TEXT NOT NULL,
          scope_type TEXT NOT NULL DEFAULT 'account',
          scope_id TEXT NOT NULL,
          suppress INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, scope_type, scope_id)
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS sync_conflicts (
          user_id TEXT NOT NULL,
          scope_type TEXT NOT NULL DEFAULT 'account',
          scope_id TEXT NOT NULL,
          mutation_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          reason TEXT NOT NULL,
          local_payload TEXT NOT NULL,
          base_version INTEGER,
          server_version INTEGER,
          server_payload TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          resolved_at TEXT,
          PRIMARY KEY (user_id, scope_type, scope_id, mutation_id)
        )
      `);
      // Create business tables
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS businesses (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          owner_id TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          subscription_plan TEXT NOT NULL DEFAULT 'business',
          subscription_status TEXT NOT NULL DEFAULT 'active',
          seat_limit INTEGER NOT NULL DEFAULT 5,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS business_memberships (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          member_role TEXT NOT NULL DEFAULT 'employee',
          membership_status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS business_invitations (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL,
          invited_by TEXT NOT NULL,
          email TEXT NOT NULL,
          member_role TEXT NOT NULL DEFAULT 'employee',
          status TEXT NOT NULL DEFAULT 'pending',
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS business_capabilities_cache (
          user_id TEXT PRIMARY KEY,
          business_id TEXT,
          business_name TEXT,
          member_role TEXT,
          membership_status TEXT,
          subscription_plan TEXT NOT NULL DEFAULT 'student',
          effective_plan TEXT NOT NULL DEFAULT 'student',
          capabilities TEXT NOT NULL DEFAULT '[]',
          lease_expires_at TEXT,
          updated_at TEXT NOT NULL
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS business_tasks (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL,
          created_by TEXT NOT NULL,
          title TEXT NOT NULL,
          instructions TEXT NOT NULL DEFAULT '',
          priority TEXT NOT NULL DEFAULT 'medium',
          due_date TEXT,
          scheduled_at TEXT,
          recurrence_rule TEXT,
          reminder_lead_minutes INTEGER NOT NULL DEFAULT 15,
          is_cancelled INTEGER NOT NULL DEFAULT 0,
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS business_task_assignments (
          id TEXT PRIMARY KEY,
          business_task_id TEXT NOT NULL,
          business_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'todo',
          manager_review_status TEXT NOT NULL DEFAULT 'pending',
          reopened_reason TEXT,
          submitted_at TEXT,
          approved_at TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (business_task_id) REFERENCES business_tasks (id) ON DELETE CASCADE,
          FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE,
          UNIQUE (business_task_id, user_id)
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS business_work_blocks (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          recurrence_rule TEXT,
          created_by TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          deleted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS gmail_connections (
          user_id TEXT PRIMARY KEY,
          email_address TEXT NOT NULL,
          is_connected INTEGER NOT NULL DEFAULT 1,
          last_synced_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS gmail_threads_cache (
          user_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          history_id TEXT NOT NULL DEFAULT '',
          snippet TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          from_address TEXT NOT NULL DEFAULT '',
          to_address TEXT NOT NULL DEFAULT '',
          date TEXT NOT NULL DEFAULT '',
          unread INTEGER NOT NULL DEFAULT 0,
          message_count INTEGER NOT NULL DEFAULT 1,
          has_attachments INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, thread_id),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS gmail_messages_cache (
          user_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          subject TEXT NOT NULL DEFAULT '',
          from_address TEXT NOT NULL DEFAULT '',
          to_address TEXT NOT NULL DEFAULT '',
          cc_address TEXT,
          bcc_address TEXT,
          date TEXT NOT NULL DEFAULT '',
          snippet TEXT NOT NULL DEFAULT '',
          body_plain TEXT NOT NULL DEFAULT '',
          body_html TEXT,
          attachments_json TEXT,
          is_read INTEGER NOT NULL DEFAULT 0,
          cached_at TEXT NOT NULL,
          PRIMARY KEY (user_id, message_id),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS gmail_local_drafts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          remote_draft_id TEXT,
          thread_id TEXT,
          to_address TEXT NOT NULL DEFAULT '',
          cc_address TEXT,
          bcc_address TEXT,
          subject TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          updated_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
      `);

      tx.executeSync(`
        CREATE INDEX IF NOT EXISTS idx_sync_conflicts_scope_unresolved
        ON sync_conflicts (user_id, scope_type, scope_id, resolved_at, updated_at)
      `);

      // Study tools (schema 16), shared with LAFINA desktop: Pomodoro, flashcard
      // decks, study notes and recorded meetings. Everything but the live timer
      // and the device-local settings syncs.
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS pomodoro_settings (
          user_id TEXT PRIMARY KEY,
          focus_minutes INTEGER NOT NULL,
          short_break_minutes INTEGER NOT NULL,
          long_break_minutes INTEGER NOT NULL,
          long_break_interval INTEGER NOT NULL,
          auto_start_breaks INTEGER NOT NULL DEFAULT 1,
          auto_start_focus INTEGER NOT NULL DEFAULT 0,
          sound_enabled INTEGER NOT NULL DEFAULT 1,
          volume REAL NOT NULL DEFAULT 0.7,
          ring_seconds INTEGER NOT NULL DEFAULT 10,
          notifications_enabled INTEGER NOT NULL DEFAULT 1,
          ring_sound_uri TEXT,
          ring_sound_name TEXT,
          updated_at TEXT NOT NULL
        )
      `);
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS pomodoro_state (
          user_id TEXT PRIMARY KEY,
          phase TEXT NOT NULL,
          is_running INTEGER NOT NULL DEFAULT 0,
          ends_at INTEGER,
          remaining_ms INTEGER NOT NULL,
          total_ms INTEGER NOT NULL,
          cycle_position INTEGER NOT NULL DEFAULT 0,
          completed_focus INTEGER NOT NULL DEFAULT 0,
          task TEXT,
          updated_at TEXT NOT NULL
        )
      `);
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS pomodoro_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          phase TEXT NOT NULL,
          task TEXT,
          duration_ms INTEGER NOT NULL,
          started_at TEXT,
          finished_at TEXT NOT NULL,
          day_key TEXT NOT NULL,
          updated_at TEXT,
          deleted_at TEXT
        )
      `);
      tx.executeSync(`
        CREATE INDEX IF NOT EXISTS idx_pomodoro_sessions_day
        ON pomodoro_sessions (user_id, day_key, phase)
      `);
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS flashcard_decks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          source_name TEXT,
          card_count INTEGER NOT NULL DEFAULT 0,
          cards_json TEXT NOT NULL,
          page_count INTEGER NOT NULL DEFAULT 0,
          ocr_page_count INTEGER NOT NULL DEFAULT 0,
          warnings_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          deleted_at TEXT
        )
      `);
      tx.executeSync(`
        CREATE INDEX IF NOT EXISTS idx_flashcard_decks_user
        ON flashcard_decks (user_id, created_at)
      `);
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS study_summaries (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          source_name TEXT,
          source_kind TEXT,
          overview TEXT,
          sections_json TEXT NOT NULL,
          key_terms_json TEXT NOT NULL,
          markdown TEXT NOT NULL,
          page_count INTEGER NOT NULL DEFAULT 0,
          warnings_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          deleted_at TEXT
        )
      `);
      tx.executeSync(`
        CREATE INDEX IF NOT EXISTS idx_study_summaries_user
        ON study_summaries (user_id, created_at)
      `);
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS recorded_meetings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          error_code TEXT,
          error_detail TEXT,
          started_at TEXT NOT NULL,
          duration_seconds REAL NOT NULL DEFAULT 0,
          audio_bytes INTEGER NOT NULL DEFAULT 0,
          microphone_label TEXT,
          whisper_model TEXT,
          transcription_device TEXT,
          language TEXT,
          transcript_json TEXT,
          notes_json TEXT,
          notes_edited INTEGER NOT NULL DEFAULT 0,
          section_cache_json TEXT,
          recovered INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'recording',
          source_file_name TEXT,
          has_audio INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        )
      `);
      tx.executeSync(`
        CREATE INDEX IF NOT EXISTS idx_recorded_meetings_user
        ON recorded_meetings (user_id, started_at)
      `);
      // Per-device preferences that never sync, such as the handbook toggle.
      tx.executeSync(`
        CREATE TABLE IF NOT EXISTS local_settings (
          user_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, key)
        )
      `);

      // The compatibility engine is schema-less and cannot execute SQLite DDL
      // migrations safely. Fresh CREATE statements above are sufficient for it.
      if (!db.isFallback()) {
        // Versioned schema migrations
        const versionResult = tx.executeSync('PRAGMA user_version');
        const currentVersion = versionResult.rows?.[0]?.user_version ?? 0;
        const TARGET_VERSION = SCHEMA_VERSION;

        if (currentVersion < TARGET_VERSION) {
        if (currentVersion < 1) {
          try { tx.executeSync('ALTER TABLE users ADD COLUMN time_format_24h INTEGER NOT NULL DEFAULT 0'); } catch {}
        }
        if (currentVersion < 2) {
          try { tx.executeSync('ALTER TABLE users ADD COLUMN week_starts_monday INTEGER NOT NULL DEFAULT 0'); } catch {}
          try { tx.executeSync('ALTER TABLE users ADD COLUMN dark_mode INTEGER NOT NULL DEFAULT 0'); } catch {}
        }
        if (currentVersion < 3) {
          try { tx.executeSync('ALTER TABLE time_blocks ADD COLUMN recurrence_rule TEXT'); } catch {}
          try { tx.executeSync('ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT'); } catch {}
          try { tx.executeSync('ALTER TABLE events ADD COLUMN recurrence_rule TEXT'); } catch {}
        }
        if (currentVersion < 4) {
          try { tx.executeSync('ALTER TABLE reminders ADD COLUMN snooze_count INTEGER NOT NULL DEFAULT 0'); } catch {}
        }
        if (currentVersion < 5) {
          try { tx.executeSync('ALTER TABLE custom_categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP'); } catch {}
          try { tx.executeSync('ALTER TABLE custom_categories ADD COLUMN deleted_at TEXT'); } catch {}
        }
        if (currentVersion < 6) {
          try { tx.executeSync('ALTER TABLE active_session ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP'); } catch {}
          try { tx.executeSync('ALTER TABLE active_session ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP'); } catch {}
        }
        if (currentVersion < 7) {
          try { tx.executeSync('ALTER TABLE users ADD COLUMN cloud_linked INTEGER NOT NULL DEFAULT 0'); } catch {}
          try { tx.executeSync('ALTER TABLE users ADD COLUMN cloud_linked_at TEXT'); } catch {}
          try { tx.executeSync('ALTER TABLE active_session ADD COLUMN access_token TEXT'); } catch {}
          try { tx.executeSync('ALTER TABLE active_session ADD COLUMN refresh_token TEXT'); } catch {}
        }

        if (currentVersion < 15) {
          try { tx.executeSync('ALTER TABLE active_session ADD COLUMN pending_cloud_credential TEXT'); } catch {}
        }

        if (currentVersion < 8) {
          const now = new Date().toISOString();
          const outboxColumns = tx.executeSync('PRAGMA table_info(sync_outbox)').rows ?? [];
          const hasScopedOutbox = outboxColumns.some((column) => column.name === 'user_id');

          if (!hasScopedOutbox) {
            const inferredUserSql = `COALESCE(
              CASE sync_outbox_legacy.entity_type
                WHEN 'task' THEN (SELECT user_id FROM tasks WHERE id = sync_outbox_legacy.entity_id)
                WHEN 'event' THEN (SELECT user_id FROM events WHERE id = sync_outbox_legacy.entity_id)
                WHEN 'time_block' THEN (SELECT user_id FROM time_blocks WHERE id = sync_outbox_legacy.entity_id)
                WHEN 'reminder' THEN (SELECT user_id FROM reminders WHERE id = sync_outbox_legacy.entity_id)
                WHEN 'note' THEN (SELECT user_id FROM notes WHERE id = sync_outbox_legacy.entity_id)
                WHEN 'custom_category' THEN (SELECT user_id FROM custom_categories WHERE id = sync_outbox_legacy.entity_id)
                WHEN 'profile' THEN (SELECT id FROM users WHERE id = sync_outbox_legacy.entity_id)
              END,
              'legacy'
            )`;

            tx.executeSync('DROP INDEX IF EXISTS idx_sync_outbox_scope_pending');
            tx.executeSync('ALTER TABLE sync_outbox RENAME TO sync_outbox_legacy');
            tx.executeSync(`
              CREATE TABLE sync_outbox (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                scope_type TEXT NOT NULL DEFAULT 'account',
                scope_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                payload TEXT NOT NULL,
                base_version INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0
              )
            `);
            tx.executeSync(`
              INSERT INTO sync_outbox (
                id, user_id, scope_type, scope_id, entity_type, entity_id, operation,
                payload, base_version, created_at, updated_at, status, attempts
              )
              SELECT id, ${inferredUserSql}, 'account', ${inferredUserSql}, entity_type,
                CASE WHEN entity_type = 'profile' THEN 'profile' ELSE entity_id END,
                operation, payload,
                CASE WHEN operation = 'create' THEN 0 ELSE NULL END,
                created_at, created_at, status, attempts
              FROM sync_outbox_legacy
            `);
            tx.executeSync('DROP TABLE sync_outbox_legacy');
          }

          const metadataColumns = tx.executeSync('PRAGMA table_info(sync_metadata)').rows ?? [];
          const hasScopedMetadata = metadataColumns.some((column) => column.name === 'user_id');
          if (!hasScopedMetadata) {
            tx.executeSync('ALTER TABLE sync_metadata RENAME TO sync_metadata_legacy');
            tx.executeSync(`
              CREATE TABLE sync_metadata (
                user_id TEXT NOT NULL,
                scope_type TEXT NOT NULL DEFAULT 'account',
                scope_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                change_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, scope_type, scope_id, entity_type, entity_id)
              )
            `);
            tx.executeSync(`
              INSERT INTO sync_metadata (
                user_id, scope_type, scope_id, entity_type, entity_id,
                version, change_id, created_at, updated_at
              )
              SELECT COALESCE(
                  CASE legacy.entity_type
                    WHEN 'task' THEN (SELECT user_id FROM tasks WHERE id = legacy.entity_id)
                    WHEN 'event' THEN (SELECT user_id FROM events WHERE id = legacy.entity_id)
                    WHEN 'time_block' THEN (SELECT user_id FROM time_blocks WHERE id = legacy.entity_id)
                    WHEN 'reminder' THEN (SELECT user_id FROM reminders WHERE id = legacy.entity_id)
                    WHEN 'note' THEN (SELECT user_id FROM notes WHERE id = legacy.entity_id)
                    WHEN 'custom_category' THEN (SELECT user_id FROM custom_categories WHERE id = legacy.entity_id)
                    WHEN 'profile' THEN (SELECT id FROM users WHERE id = legacy.entity_id)
                  END,
                  'legacy'
                ),
                'account',
                COALESCE(
                  CASE legacy.entity_type
                    WHEN 'task' THEN (SELECT user_id FROM tasks WHERE id = legacy.entity_id)
                    WHEN 'event' THEN (SELECT user_id FROM events WHERE id = legacy.entity_id)
                    WHEN 'time_block' THEN (SELECT user_id FROM time_blocks WHERE id = legacy.entity_id)
                    WHEN 'reminder' THEN (SELECT user_id FROM reminders WHERE id = legacy.entity_id)
                    WHEN 'note' THEN (SELECT user_id FROM notes WHERE id = legacy.entity_id)
                    WHEN 'custom_category' THEN (SELECT user_id FROM custom_categories WHERE id = legacy.entity_id)
                    WHEN 'profile' THEN (SELECT id FROM users WHERE id = legacy.entity_id)
                  END,
                  'legacy'
                ),
                legacy.entity_type,
                CASE WHEN legacy.entity_type = 'profile' THEN 'profile' ELSE legacy.entity_id END,
                legacy.version, legacy.change_id, legacy.updated_at, legacy.updated_at
              FROM sync_metadata_legacy AS legacy
            `);
            tx.executeSync('DROP TABLE sync_metadata_legacy');
          }

          const stateColumns = tx.executeSync('PRAGMA table_info(sync_state)').rows ?? [];
          const hasScopedState = stateColumns.some((column) => column.name === 'user_id');
          if (!hasScopedState) {
            tx.executeSync('ALTER TABLE sync_state RENAME TO sync_state_legacy');
            tx.executeSync(`
              CREATE TABLE sync_state (
                user_id TEXT NOT NULL,
                scope_type TEXT NOT NULL DEFAULT 'account',
                scope_id TEXT NOT NULL,
                cursor INTEGER NOT NULL DEFAULT 0,
                last_synced_at TEXT,
                status TEXT NOT NULL DEFAULT 'Local only',
                error_message TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, scope_type, scope_id)
              )
            `);
            tx.executeSync(`
              INSERT INTO sync_state (
                user_id, scope_type, scope_id, cursor, last_synced_at, status,
                error_message, created_at, updated_at
              )
              SELECT users.id, 'account', users.id, 0, NULL, 'Local only', NULL, ?, ?
              FROM users
            `, [now, now]);
            tx.executeSync('DROP TABLE sync_state_legacy');
          }

          const controlColumns = tx.executeSync('PRAGMA table_info(sync_control)').rows ?? [];
          const hasScopedControl = controlColumns.some((column) => column.name === 'user_id');
          if (!hasScopedControl) {
            tx.executeSync('ALTER TABLE sync_control RENAME TO sync_control_legacy');
            tx.executeSync(`
              CREATE TABLE sync_control (
                user_id TEXT NOT NULL,
                scope_type TEXT NOT NULL DEFAULT 'account',
                scope_id TEXT NOT NULL,
                suppress INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, scope_type, scope_id)
              )
            `);
            tx.executeSync(`
              INSERT INTO sync_control (
                user_id, scope_type, scope_id, suppress, created_at, updated_at
              )
              SELECT users.id, 'account', users.id, 0, ?, ?
              FROM users
            `, [now, now]);
            tx.executeSync('DROP TABLE sync_control_legacy');
          }

          tx.executeSync(`
            CREATE INDEX IF NOT EXISTS idx_sync_outbox_scope_pending
            ON sync_outbox (user_id, scope_type, scope_id, status, created_at)
          `);
        }

        if (currentVersion < 9) {
          tx.executeSync(
            `UPDATE sync_outbox SET base_version = 0
             WHERE operation = 'create' AND base_version IS NULL`
          );
          backfillLegacyPersonalOutbox(tx, new Date().toISOString());
        }

        if (currentVersion < 10) {
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS businesses (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              owner_id TEXT NOT NULL,
              timezone TEXT NOT NULL DEFAULT 'UTC',
              subscription_plan TEXT NOT NULL DEFAULT 'business',
              subscription_status TEXT NOT NULL DEFAULT 'active',
              seat_limit INTEGER NOT NULL DEFAULT 5,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
          `);

          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_memberships (
              id TEXT PRIMARY KEY,
              business_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              member_role TEXT NOT NULL DEFAULT 'employee',
              membership_status TEXT NOT NULL DEFAULT 'active',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
            )
          `);

          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_invitations (
              id TEXT PRIMARY KEY,
              business_id TEXT NOT NULL,
              invited_by TEXT NOT NULL,
              email TEXT NOT NULL,
              member_role TEXT NOT NULL DEFAULT 'employee',
              status TEXT NOT NULL DEFAULT 'pending',
              expires_at TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
            )
          `);

          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_capabilities_cache (
              user_id TEXT PRIMARY KEY,
              business_id TEXT,
              business_name TEXT,
              member_role TEXT,
              membership_status TEXT,
              subscription_plan TEXT NOT NULL DEFAULT 'student',
              effective_plan TEXT NOT NULL DEFAULT 'student',
              capabilities TEXT NOT NULL DEFAULT '[]',
              lease_expires_at TEXT,
              updated_at TEXT NOT NULL
            )
          `);
        }

        if (currentVersion < 11) {
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_tasks (
              id TEXT PRIMARY KEY,
              business_id TEXT NOT NULL,
              created_by TEXT NOT NULL,
              title TEXT NOT NULL,
              instructions TEXT NOT NULL DEFAULT '',
              priority TEXT NOT NULL DEFAULT 'medium',
              due_date TEXT,
              scheduled_at TEXT,
              recurrence_rule TEXT,
              reminder_lead_minutes INTEGER NOT NULL DEFAULT 15,
              is_cancelled INTEGER NOT NULL DEFAULT 0,
              version INTEGER NOT NULL DEFAULT 1,
              deleted_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
            )
          `);

          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_task_assignments (
              id TEXT PRIMARY KEY,
              business_task_id TEXT NOT NULL,
              business_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'todo',
              manager_review_status TEXT NOT NULL DEFAULT 'pending',
              reopened_reason TEXT,
              submitted_at TEXT,
              approved_at TEXT,
              version INTEGER NOT NULL DEFAULT 1,
              deleted_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (business_task_id) REFERENCES business_tasks (id) ON DELETE CASCADE,
              FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE,
              UNIQUE (business_task_id, user_id)
            )
          `);

          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_work_blocks (
              id TEXT PRIMARY KEY,
              business_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              title TEXT NOT NULL,
              start_time TEXT NOT NULL,
              end_time TEXT NOT NULL,
              recurrence_rule TEXT,
              created_by TEXT NOT NULL,
              version INTEGER NOT NULL DEFAULT 1,
              deleted_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
            )
          `);
        }

        if (currentVersion < 12) {
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_chat_channels (
              id TEXT PRIMARY KEY,
              business_id TEXT NOT NULL,
              name TEXT NOT NULL DEFAULT 'general',
              channel_type TEXT NOT NULL DEFAULT 'general',
              is_archived INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE,
              UNIQUE (business_id, name)
            )
          `);

          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_chat_messages (
              id TEXT PRIMARY KEY,
              channel_id TEXT NOT NULL,
              business_id TEXT NOT NULL,
              sender_id TEXT NOT NULL,
              sender_name TEXT,
              client_message_id TEXT NOT NULL,
              content TEXT NOT NULL,
              task_link_id TEXT,
              task_title TEXT,
              delivery_status TEXT NOT NULL DEFAULT 'sent',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (channel_id) REFERENCES business_chat_channels (id) ON DELETE CASCADE,
              FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE,
              UNIQUE (business_id, client_message_id)
            )
          `);

          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_task_comments (
              id TEXT PRIMARY KEY,
              task_id TEXT NOT NULL,
              business_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              user_name TEXT,
              client_comment_id TEXT NOT NULL,
              content TEXT NOT NULL,
              delivery_status TEXT NOT NULL DEFAULT 'sent',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (task_id) REFERENCES business_tasks (id) ON DELETE CASCADE,
              FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE,
              UNIQUE (task_id, client_comment_id)
            )
          `);
        }
        if (currentVersion < 13) {
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_meetings (
              id TEXT PRIMARY KEY,
              business_id TEXT NOT NULL,
              created_by TEXT NOT NULL,
              title TEXT NOT NULL DEFAULT 'Untitled Meeting',
              duration_seconds INTEGER NOT NULL DEFAULT 0,
              full_transcript TEXT NOT NULL DEFAULT '',
              summary_json TEXT,
              summary_status TEXT NOT NULL DEFAULT 'not_requested',
              keep_audio INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE
            )
          `);
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_meeting_segments (
              id TEXT PRIMARY KEY,
              meeting_id TEXT NOT NULL,
              start_ms INTEGER NOT NULL DEFAULT 0,
              end_ms INTEGER NOT NULL DEFAULT 0,
              text TEXT NOT NULL,
              speaker TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (meeting_id) REFERENCES business_meetings (id) ON DELETE CASCADE
            )
          `);
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_action_candidates (
              id TEXT PRIMARY KEY,
              meeting_id TEXT NOT NULL,
              title TEXT NOT NULL,
              instructions TEXT NOT NULL,
              suggested_assignee_id TEXT,
              suggested_assignee_name TEXT,
              suggested_due_date TEXT,
              status TEXT NOT NULL DEFAULT 'pending_review',
              created_task_id TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (meeting_id) REFERENCES business_meetings (id) ON DELETE CASCADE
            )
          `);
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS business_meeting_recipients (
              id TEXT PRIMARY KEY,
              meeting_id TEXT NOT NULL,
              business_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (meeting_id) REFERENCES business_meetings (id) ON DELETE CASCADE,
              FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE CASCADE,
              UNIQUE (meeting_id, user_id)
            )
          `);
        }
        if (currentVersion < 14) {
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS gmail_connections (
              user_id TEXT PRIMARY KEY,
              email_address TEXT NOT NULL,
              is_connected INTEGER NOT NULL DEFAULT 1,
              last_synced_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
          `);
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS gmail_threads_cache (
              user_id TEXT NOT NULL,
              thread_id TEXT NOT NULL,
              history_id TEXT NOT NULL DEFAULT '',
              snippet TEXT NOT NULL DEFAULT '',
              subject TEXT NOT NULL DEFAULT '',
              from_address TEXT NOT NULL DEFAULT '',
              to_address TEXT NOT NULL DEFAULT '',
              date TEXT NOT NULL DEFAULT '',
              unread INTEGER NOT NULL DEFAULT 0,
              message_count INTEGER NOT NULL DEFAULT 1,
              has_attachments INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (user_id, thread_id),
              FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
          `);
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS gmail_messages_cache (
              user_id TEXT NOT NULL,
              message_id TEXT NOT NULL,
              thread_id TEXT NOT NULL,
              subject TEXT NOT NULL DEFAULT '',
              from_address TEXT NOT NULL DEFAULT '',
              to_address TEXT NOT NULL DEFAULT '',
              cc_address TEXT,
              bcc_address TEXT,
              date TEXT NOT NULL DEFAULT '',
              snippet TEXT NOT NULL DEFAULT '',
              body_plain TEXT NOT NULL DEFAULT '',
              body_html TEXT,
              attachments_json TEXT,
              is_read INTEGER NOT NULL DEFAULT 0,
              cached_at TEXT NOT NULL,
              PRIMARY KEY (user_id, message_id),
              FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
          `);
          tx.executeSync(`
            CREATE TABLE IF NOT EXISTS gmail_local_drafts (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              remote_draft_id TEXT,
              thread_id TEXT,
              to_address TEXT NOT NULL DEFAULT '',
              cc_address TEXT,
              bcc_address TEXT,
              subject TEXT NOT NULL DEFAULT '',
              body TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'draft',
              updated_at TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
          `);
        }

        if (currentVersion < 16) {
          // The study-tool tables are created above; existing tables gain the
          // entity types negotiated with the server and chat attachments.
          try { tx.executeSync('ALTER TABLE sync_state ADD COLUMN server_entity_types TEXT'); } catch {}
          try { tx.executeSync('ALTER TABLE sync_state ADD COLUMN snapshot_entity_types TEXT'); } catch {}
          try { tx.executeSync('ALTER TABLE messages ADD COLUMN attachment_json TEXT'); } catch {}
        }

        if (currentVersion < 17) {
          // Profile photo: a path under the app's own storage, not the
          // picker's temporary one, so it survives a restart.
          try { tx.executeSync('ALTER TABLE users ADD COLUMN avatar_uri TEXT'); } catch {}
        }

          tx.executeSync(`PRAGMA user_version = ${TARGET_VERSION}`);
        }
      }
    });
    console.log(`Database schema initialized successfully (version ${SCHEMA_VERSION}).`);
    await seedLocalDemoAccounts();
  } catch (error) {
    console.error('Failed to initialize database schema:', error);
    throw error;
  }
};
