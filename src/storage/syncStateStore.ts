import { db, DatabaseTransaction } from './database';
import { PersistedSyncStatus, SyncScopeType } from './syncTypes';

export interface PersistedSyncState {
  localUserId: string;
  scopeType: SyncScopeType;
  scopeId: string;
  cursor: number;
  lastSyncedAt: string | null;
  status: PersistedSyncStatus;
  errorMessage: string | null;
}

export interface SyncStateUpdate {
  cursor: number;
  lastSyncedAt: string | null;
  status: PersistedSyncStatus;
  errorMessage: string | null;
}

/** What was negotiated with the server, for one local user and scope. */
export interface PersistedEntityTypes {
  /** The server's `supportedEntityTypes`, or null before a negotiating server answered. */
  serverEntityTypes: string[] | null;
  /** The effective types the last complete snapshot covered, or null if none has. */
  snapshotEntityTypes: string[] | null;
}

const executorFor = (executor?: DatabaseTransaction): DatabaseTransaction => executor ?? db;

const parseTypeList = (value: unknown): string[] | null => {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
};

const saveTypeList = (
  column: 'server_entity_types' | 'snapshot_entity_types',
  localUserId: string,
  entityTypes: readonly string[],
  scopeType: SyncScopeType,
  scopeId: string,
  executor?: DatabaseTransaction,
): void => {
  const now = new Date().toISOString();
  executorFor(executor).executeSync(
    `INSERT INTO sync_state (
       user_id, scope_type, scope_id, cursor, last_synced_at, status,
       error_message, ${column}, created_at, updated_at
     ) VALUES (?, ?, ?, 0, NULL, 'Local only', NULL, ?, ?, ?)
     ON CONFLICT(user_id, scope_type, scope_id)
     DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at`,
    [localUserId, scopeType, scopeId, JSON.stringify([...entityTypes].sort()), now, now],
  );
};

export const syncStateStore = {
  /** Loads the persisted state for one local user and synchronization scope. */
  load: (
    localUserId: string,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): PersistedSyncState => {
    const result = executorFor(executor).executeSync(
      `SELECT cursor, last_synced_at, status, error_message FROM sync_state
       WHERE user_id = ? AND scope_type = ? AND scope_id = ?`,
      [localUserId, scopeType, scopeId],
    );
    const row = result.rows?.[0];
    return {
      localUserId,
      scopeType,
      scopeId,
      cursor: typeof row?.cursor === 'number' ? row.cursor : 0,
      lastSyncedAt: typeof row?.last_synced_at === 'string' ? row.last_synced_at : null,
      status: (row?.status as PersistedSyncStatus | undefined) ?? 'Local only',
      errorMessage: typeof row?.error_message === 'string' ? row.error_message : null,
    };
  },

  /** Persists the complete state for one local user and synchronization scope. */
  save: (
    localUserId: string,
    state: SyncStateUpdate,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => {
    const now = new Date().toISOString();
    executorFor(executor).executeSync(
      `INSERT INTO sync_state (
         user_id, scope_type, scope_id, cursor, last_synced_at, status,
         error_message, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, scope_type, scope_id)
       DO UPDATE SET cursor = excluded.cursor, last_synced_at = excluded.last_synced_at,
         status = excluded.status, error_message = excluded.error_message,
         updated_at = excluded.updated_at`,
      [
        localUserId,
        scopeType,
        scopeId,
        state.cursor,
        state.lastSyncedAt,
        state.status,
        state.errorMessage,
        now,
        now,
      ],
    );
  },

  /** Loads the negotiated entity-type lists. */
  loadEntityTypes: (
    localUserId: string,
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): PersistedEntityTypes => {
    const row = executorFor(executor).executeSync(
      `SELECT server_entity_types, snapshot_entity_types FROM sync_state
       WHERE user_id = ? AND scope_type = ? AND scope_id = ?`,
      [localUserId, scopeType, scopeId],
    ).rows?.[0];
    return {
      serverEntityTypes: parseTypeList(row?.server_entity_types),
      snapshotEntityTypes: parseTypeList(row?.snapshot_entity_types),
    };
  },

  /** Records the server's advertised entity types. */
  saveServerEntityTypes: (
    localUserId: string,
    entityTypes: readonly string[],
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => saveTypeList(
    'server_entity_types', localUserId, entityTypes, scopeType, scopeId, executor,
  ),

  /** Records which effective types the last complete snapshot covered. */
  saveSnapshotEntityTypes: (
    localUserId: string,
    entityTypes: readonly string[],
    scopeType: SyncScopeType = 'account',
    scopeId: string = localUserId,
    executor?: DatabaseTransaction,
  ): void => saveTypeList(
    'snapshot_entity_types', localUserId, entityTypes, scopeType, scopeId, executor,
  ),
};

