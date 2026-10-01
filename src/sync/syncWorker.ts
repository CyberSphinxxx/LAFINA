import { db, DatabaseTransaction } from '../storage/database';
import { syncOutboxStore, OutboxItem } from '../storage/syncOutboxStore';
import { cloudClient } from '../cloud/cloudClient';
import { accountLinkService } from '../cloud/accountLinkService';
import { userStore } from '../storage/userStore';
import { syncState } from './syncState';

export interface SyncBatchResponsePayload {
  accepted: Array<{ mutationId: string; entityType: string; entityId: string; status: string }>;
  rejected: Array<{ mutationId: string; entityType: string; entityId: string; status: string; reason?: string }>;
  changes: Array<{
    changeId: number;
    entityType: string;
    entityId: string;
    operation: 'create' | 'update' | 'delete';
    version: number;
    payload: Record<string, any>;
    updatedAt: string;
  }>;
  nextCursor: number;
  hasMore: boolean;
  resetRequired: boolean;
  serverTime: string;
}

let isSyncRunning = false;
let retryAttempt = 0;

export const syncWorker = {
  getRetryAttempt: (): number => retryAttempt,

  /**
   * Executes a bidirectional synchronization pass.
   * Never blocks local storage or reminder actions if offline or server returns error.
   */
  performSync: async (): Promise<void> => {
    if (isSyncRunning) return;
    isSyncRunning = true;

    try {
      const isOnline = await cloudClient.isOnline();
      if (!isOnline) {
        syncState.setStatus('Offline');
        isSyncRunning = false;
        return;
      }

      const accessToken = cloudClient.getAccessToken();
      if (!accessToken) {
        syncState.setStatus('Sign-in required');
        isSyncRunning = false;
        return;
      }

      syncState.setStatus('Syncing');

      // The SQLite owner every pulled row is written to. Cloud account IDs and
      // SQLite user IDs are intentionally independent, so this is resolved from the
      // local session rather than from anything the server sends.
      const currentSession = userStore.getActiveSessionToken();
      const pullOwnerId = currentSession.userId;

      // Refresh the active local user's role from the authenticated cloud account.
      try {
        if (pullOwnerId) {
          await accountLinkService.refreshCloudProfile(pullOwnerId);
        }
      } catch (err) {
        console.warn('[SyncWorker] Profile refresh note:', err);
      }

      // 1. Fetch pending outbox mutations (max 100)
      const pendingMutations = syncOutboxStore.getPendingMutations(100);
      const formattedMutations = pendingMutations.map((item: OutboxItem) => ({
        mutationId: item.id,
        entityType: item.entityType,
        entityId: item.entityId,
        operation: item.operation,
        clientUpdatedAt: item.createdAt,
        payload: item.payload,
      }));

      const currentCursor = syncState.getState().cursor;

      // 2. Transmit batch to FastAPI backend
      const result = await cloudClient.request<SyncBatchResponsePayload>(
        '/v1/sync/batch',
        {
          method: 'POST',
          body: JSON.stringify({
            mutations: formattedMutations,
            cursor: currentCursor,
          }),
        },
        true
      );

      if (result.status === 'offline') {
        syncState.setStatus('Offline');
        isSyncRunning = false;
        return;
      }

      if (result.status === 'auth_required') {
        syncState.setStatus('Sign-in required');
        isSyncRunning = false;
        return;
      }

      if (result.status !== 'success' || !result.data) {
        retryAttempt++;
        syncState.setStatus('Attention required', result.error || 'Sync request failed');
        isSyncRunning = false;
        return;
      }

      const response = result.data;

      // 3. Acknowledge accepted outbox mutations
      const acceptedIds = response.accepted.map((item) => item.mutationId);
      syncOutboxStore.acknowledgeMutations(acceptedIds);

      // Handle rejected items
      if (response.rejected.length > 0) {
        const rejectedIds = response.rejected.map((item) => item.mutationId);
        syncOutboxStore.markMutationsFailed(rejectedIds);
        syncState.setStatus('Attention required', `${response.rejected.length} mutations rejected by server`);
      }

      // 4. Apply pull changes in a single SQLite transaction with triggers suppressed
      let reminderTextUpdated = false;

      // Every pulled row belongs to the student signed in on this device. Without a
      // local owner the writes would be partitioned under nobody and every store,
      // which reads `WHERE user_id = ?`, would never see them again. The cursor is
      // deliberately not advanced so the same changes are replayed after sign-in.
      if (!pullOwnerId && response.changes.length > 0) {
        console.warn(
          '[SyncWorker] Skipping pull: no active local user to own the incoming rows.',
        );
        syncState.setStatus(
          'Sign-in required',
          'Sign in again before cloud changes can be stored on this device.',
        );
        return;
      }

      await db.transaction(async (tx: DatabaseTransaction) => {
        // Suppress local trigger outbox generation during pull
        tx.executeSync('UPDATE sync_control SET suppress = 1 WHERE id = 1');

        try {
          for (const change of response.changes) {
            const table = getTableNameForEntityType(change.entityType);
            if (!table) continue;

            if (change.operation === 'delete') {
              tx.executeSync(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`, [
                change.updatedAt,
                change.entityId,
              ]);
            } else {
              // Apply entity write based on type
              if (change.entityType === 'task') {
                tx.executeSync(
                  `INSERT INTO tasks (id, user_id, title, due_date, due_time, is_completed, priority, category, notes, recurrence_rule, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title, due_date = excluded.due_date, due_time = excluded.due_time,
                   is_completed = excluded.is_completed, priority = excluded.priority, category = excluded.category,
                   notes = excluded.notes, recurrence_rule = excluded.recurrence_rule, updated_at = excluded.updated_at
                   WHERE datetime(excluded.updated_at) IS NOT NULL
                     AND datetime(tasks.updated_at) IS NOT NULL
                     AND excluded.updated_at > tasks.updated_at`,
                  [
                    change.entityId,
                    pullOwnerId,
                    change.payload.title || '',
                    change.payload.due_date || null,
                    change.payload.due_time || null,
                    change.payload.is_completed ? 1 : 0,
                    change.payload.priority || 'medium',
                    change.payload.category || 'General',
                    change.payload.notes || null,
                    change.payload.recurrence_rule || null,
                    change.updatedAt,
                    change.updatedAt,
                  ]
                );
              } else if (change.entityType === 'reminder') {
                tx.executeSync(
                  `INSERT INTO reminders (id, user_id, task, description, scheduled_at, trigger_at, status, snooze_count, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                   task = excluded.task, description = excluded.description, scheduled_at = excluded.scheduled_at,
                   trigger_at = excluded.trigger_at, status = excluded.status, snooze_count = excluded.snooze_count, updated_at = excluded.updated_at
                   WHERE datetime(excluded.updated_at) IS NOT NULL
                     AND datetime(reminders.updated_at) IS NOT NULL
                     AND excluded.updated_at > reminders.updated_at`,
                  [
                    change.entityId,
                    pullOwnerId,
                    change.payload.task || '',
                    change.payload.description || null,
                    change.payload.scheduled_at || '',
                    change.payload.trigger_at || '',
                    change.payload.status || 'pending',
                    change.payload.snooze_count || 0,
                    change.updatedAt,
                    change.updatedAt,
                  ]
                );
                reminderTextUpdated = true;
              }
            }

            // Record metadata
            tx.executeSync(
              `INSERT INTO sync_metadata (entity_type, entity_id, version, change_id, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(entity_type, entity_id) DO UPDATE SET
               version = excluded.version, change_id = excluded.change_id, updated_at = excluded.updated_at`,
              [change.entityType, change.entityId, change.version, change.changeId, change.updatedAt]
            );
          }

          tx.executeSync(`UPDATE sync_state SET cursor = ?, last_synced_at = ?, status = 'Synced' WHERE id = 1`, [
            response.nextCursor,
            response.serverTime,
          ]);
        } finally {
          // Un-suppress outbox triggers
          tx.executeSync('UPDATE sync_control SET suppress = 0 WHERE id = 1');
        }
      });

      syncState.setCursor(response.nextCursor);
      syncState.setStatus('Synced');
      retryAttempt = 0;

      // Post-sync reconciliation if reminders updated
      if (reminderTextUpdated) {
        console.log('[SyncWorker] Synced reminder text changed. Reconciling alarms.');
      }
    } catch (err: any) {
      console.error('[SyncWorker] Error during sync pass:', err);
      syncState.setStatus('Attention required', err.message || 'Sync failed');
    } finally {
      isSyncRunning = false;
    }
  }
};

function getTableNameForEntityType(entityType: string): string | null {
  switch (entityType) {
    case 'task': return 'tasks';
    case 'event': return 'events';
    case 'time_block': return 'time_blocks';
    case 'reminder': return 'reminders';
    case 'note': return 'notes';
    case 'custom_category': return 'custom_categories';
    case 'profile': return 'users';
    default: return null;
  }
}
