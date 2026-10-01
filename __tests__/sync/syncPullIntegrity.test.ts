/**
 * Data-integrity tests for the cloud pull path.
 *
 * Two defects are pinned here:
 *  1. Pulled rows used to be inserted with `user_id = 'cloud'`, which every store
 *     filters out, so cloud-created tasks and reminders were invisible on device.
 *  2. The upsert overwrote local rows unconditionally, so a stale cloud payload
 *     silently clobbered a newer offline edit.
 */
import { authService } from '../../src/cloud/authService';
import { cloudClient } from '../../src/cloud/cloudClient';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { remindersStore } from '../../src/storage/remindersStore';
import { tasksStore } from '../../src/storage/tasksStore';
import { userStore } from '../../src/storage/userStore';
import { syncStateStore } from '../../src/storage/syncStateStore';
import { syncState } from '../../src/sync/syncState';
import { syncWorker, SyncBatchResponsePayload, SyncEntityType } from '../../src/sync/syncWorker';

const LOCAL_EDIT_AT = '2026-07-24T10:00:00.000Z';
const STALE_CLOUD_AT = '2026-07-24T09:55:00.000Z';
const NEWER_CLOUD_AT = '2026-07-24T10:05:00.000Z';

const change = (
  entityType: SyncEntityType,
  entityId: string,
  payload: Record<string, unknown>,
  updatedAt: string,
  changeId = 1,
): SyncBatchResponsePayload['changes'][number] => ({
  changeId,
  entityType,
  entityId,
  operation: 'create',
  version: 1,
  payload,
  updatedAt,
});

const mockCloudPull = (
  changes: SyncBatchResponsePayload['changes'],
  nextCursor?: number,
) => {
  const computedCursor =
    nextCursor !== undefined
      ? nextCursor
      : changes.length > 0
        ? Math.max(...changes.map((c) => c.changeId))
        : 0;
  jest.spyOn(cloudClient, 'request').mockImplementation(async (_endpoint, options) => {
    let accepted: SyncBatchResponsePayload['accepted'] = [];
    if (typeof options?.body === 'string') {
      try {
        const body = JSON.parse(options.body);
        if (Array.isArray(body.mutations)) {
          accepted = body.mutations.map((m: any) => ({
            mutationId: m.mutationId,
            status: 'accepted' as const,
            entityType: m.entityType,
            entityId: m.entityId,
            version: 1,
          }));
        }
      } catch {}
    }
    return {
      status: 'success',
      data: {
        accepted,
        rejected: [],
        changes,
        nextCursor: computedCursor,
        hasMore: false,
        resetRequired: false,
        serverTime: '2026-07-24T10:10:00.000Z',
      },
    };
  });
};

const signedInUserId = (): string => {
  const session = userStore.getActiveSessionToken();
  if (!session.userId) throw new Error('Test expected a signed-in local user.');
  return session.userId;
};

describe('syncWorker pull integrity', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(async () => {
    db.executeSync('DELETE FROM tasks');
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM sync_metadata');
    db.executeSync('DELETE FROM sync_state');
    db.executeSync('DELETE FROM users');

    const localUserId = await userStore.register(
      'Local Student',
      'local-student@ustp.edu.ph',
      'securepass',
    );
    userStore.setCurrentUser(localUserId);
    userStore.saveSessionTokens(localUserId, 'access-token', 'refresh-token');
    db.executeSync('DELETE FROM sync_outbox');

    syncStateStore.save(localUserId, {
      cursor: 0,
      status: 'Local only',
      lastSyncedAt: null,
      errorMessage: null,
    });
    syncStateStore.saveSnapshotEntityTypes(localUserId, [
      'profile',
      'task',
      'event',
      'time_block',
      'reminder',
      'note',
      'custom_category',
    ]);
    syncState.activate(localUserId);
    syncState.setStatus(localUserId, 'Local only');

    jest.spyOn(cloudClient, 'isOnline').mockResolvedValue(true);
    jest.spyOn(cloudClient, 'getAccessToken').mockReturnValue('access-token');
    jest.spyOn(authService, 'getMe').mockResolvedValue({
      status: 'success',
      data: {
        id: 'cloud-account-1',
        email: 'local-student@ustp.edu.ph',
        role: 'student',
        is_active: true,
        created_at: '2026-07-24T00:00:00+00:00',
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    userStore.logout();
  });

  it('stores a pulled task under the signed-in student', async () => {
    const userId = signedInUserId();
    mockCloudPull([
      change(
        'task',
        'task_remote',
        {
          title: 'Cloud task',
          due_date: '2026-07-30',
          due_time: '09:00',
          is_completed: false,
          priority: 'high',
          category: 'Study',
        },
        NEWER_CLOUD_AT,
      ),
    ]);

    await syncWorker.performSync();

    // The student can see it...
    const visible = tasksStore.getAllTasks(userId);
    expect(visible.map(task => task.id)).toContain('task_remote');
    expect(visible[0].title).toBe('Cloud task');
    // ...and it is not partitioned under the placeholder cloud owner.
    const owner = db.executeSync(
      `SELECT user_id FROM tasks WHERE id = 'task_remote'`,
    );
    expect(owner.rows[0].user_id).toBe(userId);
  });

  it('stores a pulled reminder under the signed-in student', async () => {
    const userId = signedInUserId();
    mockCloudPull([
      change(
        'reminder',
        'rem_remote',
        {
          task: 'Cloud reminder',
          description: null,
          scheduled_at: NEWER_CLOUD_AT,
          trigger_at: NEWER_CLOUD_AT,
          status: 'pending',
          snooze_count: 0,
        },
        NEWER_CLOUD_AT,
      ),
    ]);

    await syncWorker.performSync();

    const reminder = remindersStore.getReminderById('rem_remote');
    expect(reminder?.task).toBe('Cloud reminder');
    expect(reminder?.userId).toBe(userId);
    // The offline scheduler must be able to act on it, not just the UI.
    expect(
      remindersStore.getUpcomingReminders(userId, 1).map(item => item.id),
    ).toContain('rem_remote');
  });

  it('does not let a stale cloud payload overwrite a newer local edit', async () => {
    const userId = signedInUserId();
    tasksStore.insertTask({
      id: 'task_local',
      userId,
      title: 'Placeholder',
      dueDate: null,
      dueTime: null,
      isCompleted: false,
      priority: 'Medium',
      category: 'General',
      notes: null,
      recurrenceRule: null,
    });
    db.executeSync(
      `UPDATE tasks SET title = 'My offline edit', updated_at = ? WHERE id = 'task_local'`,
      [LOCAL_EDIT_AT],
    );

    mockCloudPull([
      change('task', 'task_local', { title: 'Stale cloud title' }, STALE_CLOUD_AT),
    ]);

    await syncWorker.performSync();

    const row = db.executeSync(
      `SELECT title, updated_at FROM tasks WHERE id = 'task_local'`,
    );
    expect(row.rows[0].title).toBe('My offline edit');
    expect(row.rows[0].updated_at).toBe(LOCAL_EDIT_AT);
  });

  it('applies a newer cloud payload without changing the local owner', async () => {
    const userId = signedInUserId();
    tasksStore.insertTask({
      id: 'task_local',
      userId,
      title: 'Placeholder',
      dueDate: null,
      dueTime: null,
      isCompleted: false,
      priority: 'Medium',
      category: 'General',
      notes: null,
      recurrenceRule: null,
    });
    db.executeSync(
      `UPDATE tasks SET title = 'My offline edit', updated_at = ? WHERE id = 'task_local'`,
      [LOCAL_EDIT_AT],
    );
    db.executeSync(`UPDATE tasks SET user_id = ? WHERE id = 'task_local'`, [
      userId,
    ]);

    mockCloudPull([
      change('task', 'task_local', { title: 'Newer cloud title' }, NEWER_CLOUD_AT),
    ]);

    await syncWorker.performSync();

    const row = db.executeSync(
      `SELECT title, updated_at, user_id FROM tasks WHERE id = 'task_local'`,
    );
    expect(row.rows[0].title).toBe('Newer cloud title');
    expect(row.rows[0].updated_at).toBe(NEWER_CLOUD_AT);
    expect(row.rows[0].user_id).toBe(userId);
  });

  it('refuses a payload whose timestamp is not a real date', async () => {
    const userId = signedInUserId();
    tasksStore.insertTask({
      id: 'task_local',
      userId,
      title: 'My offline edit',
      dueDate: null,
      dueTime: null,
      isCompleted: false,
      priority: 'Medium',
      category: 'General',
      notes: null,
      recurrenceRule: null,
    });
    db.executeSync(`UPDATE tasks SET updated_at = ? WHERE id = 'task_local'`, [
      LOCAL_EDIT_AT,
    ]);

    mockCloudPull([
      change('task', 'task_local', { title: 'Corrupt payload' }, 'not-a-date'),
    ]);

    await syncWorker.performSync();

    const row = db.executeSync(
      `SELECT title, updated_at FROM tasks WHERE id = 'task_local'`,
    );
    expect(row.rows[0].title).toBe('My offline edit');
    expect(row.rows[0].updated_at).toBe(LOCAL_EDIT_AT);
  });

  it('skips the pull and the cursor when no local user is signed in', async () => {
    userStore.logout();
    mockCloudPull([
      change('task', 'task_orphan', { title: 'Nobody owns me' }, NEWER_CLOUD_AT),
    ]);

    await syncWorker.performSync();

    expect(tasksStore.getAllTasks('cloud')).toEqual([]);
    expect(
      db.executeSync(`SELECT COUNT(*) AS total FROM tasks`).rows[0].total,
    ).toBe(0);
    expect(syncState.getState().cursor).toBe(0);
    expect(syncState.getState().status).toBe('Sign-in required');
  });

  it('proves a placeholder owner could never have been written at all', () => {
    // The old pull path inserted `user_id = 'cloud'`. Foreign keys are enforced on
    // the device connection, so that insert raised instead of merely hiding the
    // row, which rolled the whole pull transaction back on every change.
    expect(() =>
      db.executeSync(
        `INSERT INTO tasks (id, user_id, title, priority, category, created_at, updated_at)
         VALUES ('task_placeholder', 'cloud', 'Ghost', 'Medium', 'General', ?, ?)`,
        [NEWER_CLOUD_AT, NEWER_CLOUD_AT],
      ),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('advances the cursor once the pull is applied', async () => {
    mockCloudPull(
      [change('task', 'task_remote', { title: 'Cloud task' }, NEWER_CLOUD_AT, 77)],
      77,
    );

    await syncWorker.performSync();

    expect(syncState.getState().cursor).toBe(77);
    expect(syncState.getState().status).toBe('Synced');
  });
});
