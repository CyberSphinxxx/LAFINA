import { db, DatabaseTransaction } from './database';
import { syncMetadataStore } from './syncMetadataStore';
import {
  SyncEntityType,
  SyncOperation,
  SyncPayload,
  SyncScopeType,
} from './syncTypes';
import { generateId } from '../utils';

export interface OutboxItem {
  id: string;
  localUserId: string;
  scopeType: SyncScopeType;
  scopeId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  payload: SyncPayload;
  baseVersion: number | null;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'in_progress' | 'failed';
  attempts: number;
}

interface PendingMutationRow {
  id: string;
  operation: SyncOperation;
  base_version: number | null;
}

const executorFor = (executor?: DatabaseTransaction): DatabaseTransaction => executor ?? db;

/** Called after a mutation is queued, so the app can schedule a sync pass. */
export type OutboxEnqueueListener = (localUserId: string) => void;

const enqueueListeners = new Set<OutboxEnqueueListener>();

const notifyEnqueued = (localUserId: string): void => {
  enqueueListeners.forEach((listener) => {
    try {
      listener(localUserId);
    } catch (error) {
      console.error('Outbox listener failed:', error);
    }
  });
};

const parsePayload = (payloadJson: unknown): SyncPayload => {
  if (typeof payloadJson !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as SyncPayload
      : {};
  } catch {
    return {};
  }
};

export const syncOutboxStore = {
  /**
   * Enqueues or compacts a pending mutation in its account/business scope.
   * Suppressed scopes ignore writes so cloud pull application cannot echo changes.
   */
  enqueueMutation: (
    localUserId: string,
    entityType: SyncEntityType,
    entityId: string,
    operation: SyncOperation,
    payload: SyncPayload,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => {
    if (db.isFallback()) return;
    const scopedDb = executorFor(executor);
    if (syncOutboxStore.isSuppressed(localUserId, scopeType, scopeId, scopedDb)) {
      return;
    }

    const queuedResult = scopedDb.executeSync(
      `SELECT id, operation, base_version, status, attempts FROM sync_outbox
       WHERE user_id = ? AND scope_type = ? AND scope_id = ?
         AND entity_type = ? AND entity_id = ?
         AND status IN ('pending', 'in_progress', 'failed')
       ORDER BY created_at ASC, rowid ASC`,
      [localUserId, scopeType, scopeId, entityType, entityId],
    );
    const queued = (queuedResult.rows ?? []) as Array<PendingMutationRow & {
      status: OutboxItem['status'];
      attempts: number;
    }>;
    const compactable = queued.length === 1
      && queued[0].status === 'pending'
      && queued[0].attempts === 0
      ? queued[0]
      : undefined;
    const now = new Date().toISOString();

    if (compactable && !(compactable.operation === 'create' && operation === 'delete')) {
      const compactedOperation: SyncOperation = compactable.operation === 'create'
        ? 'create'
        : operation === 'delete' ? 'delete' : 'update';
      const compactedPayload = compactedOperation === 'delete' ? {} : payload;
      const compactedBaseVersion = compactedOperation === 'create'
        ? 0
        : compactable.base_version;

      scopedDb.executeSync(
        `UPDATE sync_outbox
         SET operation = ?, payload = ?, base_version = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND scope_type = ? AND scope_id = ?`,
        [
          compactedOperation,
          JSON.stringify(compactedPayload),
          compactedBaseVersion,
          now,
          compactable.id,
          localUserId,
          scopeType,
          scopeId,
        ],
      );
      notifyEnqueued(localUserId);
      return;
    }

    const baseVersion = operation === 'create'
      ? 0
      : queued.length > 0
        ? null
        : syncMetadataStore.getVersion(
            localUserId,
            entityType,
            entityId,
            scopeType,
            scopeId,
            scopedDb,
          );

    scopedDb.executeSync(
      `INSERT INTO sync_outbox (
         id, user_id, scope_type, scope_id, entity_type, entity_id, operation,
         payload, base_version, created_at, updated_at, status, attempts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
      [
        generateId(),
        localUserId,
        scopeType,
        scopeId,
        entityType,
        entityId,
        operation,
        JSON.stringify(operation === 'delete' ? {} : payload),
        baseVersion,
        now,
        now,
      ],
    );
    notifyEnqueued(localUserId);
  },

  /**
   * Registers a listener for newly queued mutations and returns an unsubscribe
   * callback. Writes made while applying a pull are suppressed and never notify.
   */
  onEnqueue: (listener: OutboxEnqueueListener): (() => void) => {
    enqueueListeners.add(listener);
    return () => {
      enqueueListeners.delete(listener);
    };
  },

  /** Marks selected pending mutations in progress and records the network attempt. */
  markMutationsInProgress: (
    localUserId: string,
    ids: string[],
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): number => {
    if (db.isFallback()) return 0;
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const result = executorFor(executor).executeSync(
      `UPDATE sync_outbox
       SET status = 'in_progress', attempts = attempts + 1
       WHERE user_id = ? AND scope_type = ? AND scope_id = ?
         AND status = 'pending' AND id IN (${placeholders})`,
      [localUserId, scopeType, scopeId, ...ids],
    );
    return result.rowsAffected ?? 0;
  },

  /** Requeues selected in-progress mutations after a transport failure. */
  requeueMutations: (
    localUserId: string,
    ids: string[],
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => {
    if (db.isFallback()) return;
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    executorFor(executor).executeSync(
      `UPDATE sync_outbox
       SET status = 'pending'
       WHERE user_id = ? AND scope_type = ? AND scope_id = ?
         AND status = 'in_progress' AND id IN (${placeholders})`,
      [localUserId, scopeType, scopeId, ...ids],
    );
  },

  /** Recovers all mutations stranded in progress by a previous process crash. */
  recoverInProgressMutations: (
    localUserId: string,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => {
    if (db.isFallback()) return;
    executorFor(executor).executeSync(
      `UPDATE sync_outbox
       SET status = 'pending'
       WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND status = 'in_progress'`,
      [localUserId, scopeType, scopeId],
    );
  },

  /**
   * Fetches pending mutations for exactly one local user and synchronization scope.
   * `entityTypes`, when given, restricts the result to those types, so mutations
   * the server cannot accept yet wait without holding up the rest.
   */
  getPendingMutations: (
    localUserId: string,
    limit: number = 100,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
    entityTypes?: readonly SyncEntityType[],
  ): OutboxItem[] => {
    if (db.isFallback()) return [];
    if (entityTypes && entityTypes.length === 0) return [];
    const typeFilter = entityTypes
      ? ` AND entity_type IN (${entityTypes.map(() => '?').join(',')})`
      : '';
    const result = executorFor(executor).executeSync(
      `SELECT * FROM sync_outbox
       WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND status = 'pending'${typeFilter}
       ORDER BY created_at ASC, rowid ASC LIMIT ?`,
      [localUserId, scopeType, scopeId, ...(entityTypes ?? []), limit],
    );

    return (result.rows ?? []).map((row) => ({
      id: String(row.id),
      localUserId: String(row.user_id),
      scopeType: row.scope_type as SyncScopeType,
      scopeId: String(row.scope_id),
      entityType: row.entity_type as SyncEntityType,
      entityId: String(row.entity_id),
      operation: row.operation as SyncOperation,
      payload: parsePayload(row.payload),
      baseVersion: typeof row.base_version === 'number' ? row.base_version : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      status: row.status as OutboxItem['status'],
      attempts: Number(row.attempts ?? 0),
    }));
  },

  /** Permanently removes acknowledged mutations in exactly one scope. */
  acknowledgeMutations: (
    localUserId: string,
    ids: string[],
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => {
    if (db.isFallback()) return;
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    executorFor(executor).executeSync(
      `DELETE FROM sync_outbox
       WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND id IN (${placeholders})`,
      [localUserId, scopeType, scopeId, ...ids],
    );
  },

  /** Marks rejected mutations terminally failed so they are not selected again. */
  markMutationsFailed: (
    localUserId: string,
    ids: string[],
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => {
    if (db.isFallback()) return;
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    executorFor(executor).executeSync(
      `UPDATE sync_outbox
       SET status = 'failed'
       WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND id IN (${placeholders})`,
      [localUserId, scopeType, scopeId, ...ids],
    );
  },

  /** Enables or disables pull-echo suppression for one user and scope. */
  setSuppression: (
    localUserId: string,
    suppress: boolean,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => {
    if (db.isFallback()) return;
    const now = new Date().toISOString();
    executorFor(executor).executeSync(
      `INSERT INTO sync_control (
         user_id, scope_type, scope_id, suppress, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, scope_type, scope_id)
       DO UPDATE SET suppress = excluded.suppress, updated_at = excluded.updated_at`,
      [localUserId, scopeType, scopeId, suppress ? 1 : 0, now, now],
    );
  },

  /** Returns whether pull-echo suppression is active for one user and scope. */
  isSuppressed: (
    localUserId: string,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): boolean => {
    if (db.isFallback()) return true;
    const result = executorFor(executor).executeSync(
      `SELECT suppress FROM sync_control
       WHERE user_id = ? AND scope_type = ? AND scope_id = ?`,
      [localUserId, scopeType, scopeId],
    );
    return result.rows?.[0]?.suppress === 1;
  },
};
