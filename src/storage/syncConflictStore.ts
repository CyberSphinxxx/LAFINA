import { db, DatabaseTransaction } from './database';
import {
  SyncEntityType,
  SyncOperation,
  SyncPayload,
  SyncScopeType,
} from './syncTypes';

export interface SyncConflictInput {
  mutationId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  reason: string;
  localPayload: SyncPayload;
  baseVersion: number | null;
  serverVersion: number | null;
  serverPayload: SyncPayload | null;
}

export interface SyncConflict extends SyncConflictInput {
  localUserId: string;
  scopeType: SyncScopeType;
  scopeId: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

const executorFor = (
  executor?: DatabaseTransaction
): DatabaseTransaction => executor ?? db;

const parsePayload = (value: unknown): SyncPayload | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as SyncPayload)
      : {};
  } catch {
    return {};
  }
};

export const syncConflictStore = {
  /** Persists both sides of a version conflict for review or a future rebase. */
  record: (
    localUserId: string,
    conflict: SyncConflictInput,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction
  ): void => {
    if (db.isFallback()) return;
    const now = new Date().toISOString();
    executorFor(executor).executeSync(
      `INSERT INTO sync_conflicts (
         user_id, scope_type, scope_id, mutation_id, entity_type, entity_id,
         operation, reason, local_payload, base_version, server_version,
         server_payload, created_at, updated_at, resolved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(user_id, scope_type, scope_id, mutation_id)
       DO UPDATE SET entity_type = excluded.entity_type,
         entity_id = excluded.entity_id, operation = excluded.operation,
         reason = excluded.reason, local_payload = excluded.local_payload,
         base_version = excluded.base_version,
         server_version = excluded.server_version,
         server_payload = excluded.server_payload,
         updated_at = excluded.updated_at, resolved_at = NULL`,
      [
        localUserId,
        scopeType,
        scopeId,
        conflict.mutationId,
        conflict.entityType,
        conflict.entityId,
        conflict.operation,
        conflict.reason,
        JSON.stringify(conflict.localPayload),
        conflict.baseVersion,
        conflict.serverVersion,
        conflict.serverPayload === null
          ? null
          : JSON.stringify(conflict.serverPayload),
        now,
        now,
      ]
    );
  },

  /** Returns unresolved conflicts for exactly one local account and scope. */
  getUnresolved: (
    localUserId: string,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction
  ): SyncConflict[] => {
    if (db.isFallback()) return [];
    const result = executorFor(executor).executeSync(
      `SELECT * FROM sync_conflicts
       WHERE user_id = ? AND scope_type = ? AND scope_id = ?
         AND resolved_at IS NULL
       ORDER BY updated_at DESC, mutation_id ASC`,
      [localUserId, scopeType, scopeId]
    );
    return (result.rows ?? []).map((row) => ({
      localUserId: String(row.user_id),
      scopeType: row.scope_type as SyncScopeType,
      scopeId: String(row.scope_id),
      mutationId: String(row.mutation_id),
      entityType: row.entity_type as SyncEntityType,
      entityId: String(row.entity_id),
      operation: row.operation as SyncOperation,
      reason: String(row.reason),
      localPayload: parsePayload(row.local_payload) ?? {},
      baseVersion:
        typeof row.base_version === 'number' ? row.base_version : null,
      serverVersion:
        typeof row.server_version === 'number' ? row.server_version : null,
      serverPayload: parsePayload(row.server_payload),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      resolvedAt:
        typeof row.resolved_at === 'string' ? row.resolved_at : null,
    }));
  },

  /** Marks one reviewed conflict resolved without deleting its audit details. */
  resolve: (
    localUserId: string,
    mutationId: string,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction
  ): void => {
    if (db.isFallback()) return;
    const now = new Date().toISOString();
    executorFor(executor).executeSync(
      `UPDATE sync_conflicts
       SET resolved_at = ?, updated_at = ?
       WHERE user_id = ? AND scope_type = ? AND scope_id = ?
         AND mutation_id = ?`,
      [now, now, localUserId, scopeType, scopeId, mutationId]
    );
  },
};
