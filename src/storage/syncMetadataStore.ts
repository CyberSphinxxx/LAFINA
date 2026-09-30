import { db, DatabaseTransaction } from './database';
import { SyncEntityType, SyncScopeType } from './syncTypes';

export interface SyncMetadataInput {
  entityType: SyncEntityType;
  entityId: string;
  version: number;
  changeId: number | null;
  updatedAt: string;
}

const executorFor = (executor?: DatabaseTransaction): DatabaseTransaction => executor ?? db;

export const syncMetadataStore = {
  /** Returns the last server version observed for an entity in a synchronization scope. */
  getVersion: (
    localUserId: string,
    entityType: SyncEntityType,
    entityId: string,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): number | null => {
    const result = executorFor(executor).executeSync(
      `SELECT version FROM sync_metadata
       WHERE user_id = ? AND scope_type = ? AND scope_id = ?
         AND entity_type = ? AND entity_id = ?`,
      [localUserId, scopeType, scopeId, entityType, entityId],
    );
    const version = result.rows?.[0]?.version;
    return typeof version === 'number' ? version : null;
  },

  /** Inserts or replaces server metadata for one entity in a synchronization scope. */
  upsert: (
    localUserId: string,
    metadata: SyncMetadataInput,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => {
    const now = new Date().toISOString();
    executorFor(executor).executeSync(
      `INSERT INTO sync_metadata (
         user_id, scope_type, scope_id, entity_type, entity_id,
         version, change_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, scope_type, scope_id, entity_type, entity_id)
       DO UPDATE SET version = excluded.version, change_id = excluded.change_id,
         updated_at = excluded.updated_at`,
      [
        localUserId,
        scopeType,
        scopeId,
        metadata.entityType,
        metadata.entityId,
        metadata.version,
        metadata.changeId,
        now,
        metadata.updatedAt,
      ],
    );
  },

  /** Removes all server metadata for one local user and synchronization scope. */
  clearScope: (
    localUserId: string,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => {
    executorFor(executor).executeSync(
      'DELETE FROM sync_metadata WHERE user_id = ? AND scope_type = ? AND scope_id = ?',
      [localUserId, scopeType, scopeId],
    );
  },
};

