jest.mock('../../src/scheduler', () => ({
  reconcileReminderAlarms: jest.fn().mockResolvedValue(undefined),
}));

import { accountLinkService } from '../../src/cloud/accountLinkService';
import { authService } from '../../src/cloud/authService';
import { cloudClient } from '../../src/cloud/cloudClient';
import { reconcileReminderAlarms } from '../../src/scheduler';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { syncConflictStore } from '../../src/storage/syncConflictStore';
import { syncMetadataStore } from '../../src/storage/syncMetadataStore';
import { syncOutboxStore } from '../../src/storage/syncOutboxStore';
import { syncStateStore } from '../../src/storage/syncStateStore';
import { userStore } from '../../src/storage/userStore';
import {
  SyncBatchResponsePayload,
  syncWorker,
} from '../../src/sync/syncWorker';
import {
  CLIENT_SYNC_ENTITY_TYPES,
  LEGACY_SYNC_ENTITY_TYPES,
} from '../../src/sync/syncEntityTypes';

interface SyncBatchRequestBody {
  mutations: Array<{
    mutationId: string;
    entityType: SyncBatchResponsePayload['accepted'][number]['entityType'];
    entityId: string;
    operation: 'create' | 'update' | 'delete';
    clientUpdatedAt: string;
    payload: Record<string, unknown>;
    baseVersion?: number;
  }>;
  cursor: number;
  snapshot?: {
    boundaryCursor?: number;
    after?: {
      entityType: SyncBatchResponsePayload['accepted'][number]['entityType'];
      entityId: string;
    };
  };
}

const SERVER_TIME = '2026-08-25T01:00:00.000Z';
const AUTHORITATIVE_ENTITY_TYPES: Array<
  SyncBatchResponsePayload['accepted'][number]['entityType']
> = [
  'task',
  'event',
  'time_block',
  'reminder',
  'note',
  'custom_category',
];

const makeResponse = (
  overrides: Partial<SyncBatchResponsePayload> = {}
): SyncBatchResponsePayload => ({
  accepted: [],
  rejected: [],
  changes: [],
  nextCursor: 0,
  hasMore: false,
  resetRequired: false,
  serverTime: SERVER_TIME,
  ...overrides,
});

const makeSnapshot = (
  overrides: Partial<NonNullable<SyncBatchResponsePayload['snapshot']>> = {}
): NonNullable<SyncBatchResponsePayload['snapshot']> => ({
  boundaryCursor: 10,
  items: [],
  nextAfter: null,
  hasMore: false,
  complete: true,
  authoritativeEntityTypes: AUTHORITATIVE_ENTITY_TYPES,
  prunePolicy: {
    preserveOutboxStatuses: ['pending', 'in_progress', 'failed'],
    requireExistingSyncMetadata: true,
  },
  ...overrides,
});

const createActiveUser = (id: string): void => {
  const now = new Date().toISOString();
  db.executeSync(
    `INSERT INTO users (
       id, username, email, role, is_new_user, time_format_24h,
       week_starts_monday, dark_mode, created_at, updated_at
     ) VALUES (?, ?, ?, 'student', 0, 0, 0, 0, ?, ?)`,
    [id, `User ${id}`, `${id}@example.com`, now, now]
  );
  userStore.setCurrentUser(id);
  userStore.saveSessionTokens(id, 'access-token', 'encrypted-refresh-token');
  // These scripts play a server from before entity-type negotiation, to an
  // install that has already taken its snapshot of the legacy types. A fresh
  // install would open with a snapshot (see studyToolSync.test.ts).
  syncStateStore.saveSnapshotEntityTypes(id, LEGACY_SYNC_ENTITY_TYPES);
};

const readRequestBody = (callIndex: number): SyncBatchRequestBody => {
  const requestMock = cloudClient.request as jest.MockedFunction<
    typeof cloudClient.request
  >;
  const options = requestMock.mock.calls[callIndex]?.[1];
  if (typeof options?.body !== 'string') {
    throw new Error('Expected a JSON sync request body.');
  }
  return JSON.parse(options.body) as SyncBatchRequestBody;
};

const clearSyncTables = (): void => {
  db.executeSync('DELETE FROM sync_conflicts');
  db.executeSync('DELETE FROM sync_outbox');
  db.executeSync('DELETE FROM sync_metadata');
  db.executeSync('DELETE FROM sync_state');
  db.executeSync('DELETE FROM sync_control');
};

describe('syncWorker account-scoped synchronization', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    db.executeSync('DELETE FROM active_session');
    clearSyncTables();
    db.executeSync('DELETE FROM user_preferences');
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM time_blocks');
    db.executeSync('DELETE FROM tasks');
    db.executeSync('DELETE FROM events');
    db.executeSync('DELETE FROM notes');
    db.executeSync('DELETE FROM custom_categories');
    db.executeSync('DELETE FROM users');

    jest.spyOn(cloudClient, 'isOnline').mockResolvedValue(true);
    jest.spyOn(cloudClient, 'getAccessToken').mockReturnValue('access-token');
    jest
      .spyOn(accountLinkService, 'refreshCloudProfile')
      .mockImplementation(async (localUserId) => ({
        status: 'success',
        localUserId,
        role: 'student',
        message: 'Profile refreshed.',
      }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not touch cloud sync infrastructure when the JS fallback is active', async () => {
    const localUserId = 'fallback-local-user';
    createActiveUser(localUserId);
    const syncStateBefore = db.executeSync('SELECT * FROM sync_state').rows;
    jest.spyOn(db, 'isFallback').mockReturnValue(true);
    const requestSpy = jest.spyOn(cloudClient, 'request');

    await syncWorker.performSync();

    expect(requestSpy).not.toHaveBeenCalled();
    expect(cloudClient.isOnline).not.toHaveBeenCalled();
    expect(db.executeSync('SELECT * FROM sync_state').rows).toEqual(syncStateBefore);
  });

  it('completes deferred FastAPI linking before syncing after reconnect', async () => {
    const localUserId = 'deferred-link-user';
    createActiveUser(localUserId);
    userStore.clearSessionTokens(localUserId);
    jest
      .mocked(cloudClient.getAccessToken)
      .mockReturnValueOnce(null)
      .mockReturnValue('access-token');
    const linkSpy = jest
      .spyOn(accountLinkService, 'completeDeferredCloudLink')
      .mockResolvedValue({
        status: 'success',
        localUserId,
        role: 'student',
        message: 'FastAPI link completed.',
      });
    const requestSpy = jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: makeResponse(),
    });

    await syncWorker.performSync();

    expect(linkSpy).toHaveBeenCalledWith(localUserId);
    expect(requestSpy).toHaveBeenCalled();
  });

  it('applies a cloud role to the active local user without creating a cloud-ID row', async () => {
    const localUserId = 'local-role-user';
    const cloudAccountId = '3ce7cc43-e4da-4b82-b4cd-070dbf7b8369';
    createActiveUser(localUserId);
    jest
      .mocked(accountLinkService.refreshCloudProfile)
      .mockRestore();
    jest.spyOn(authService, 'getMe').mockResolvedValue({
      status: 'success',
      data: {
        id: cloudAccountId,
        email: `${localUserId}@example.com`,
        role: 'student_pro',
        is_active: true,
        created_at: SERVER_TIME,
      },
    });
    jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: makeResponse(),
    });

    await syncWorker.performSync();

    expect(userStore.getUserById(localUserId)?.role).toBe('student_pro');
    expect(userStore.getUserById(cloudAccountId)).toBeNull();
  });

  it('applies every personal entity type to the active local user across pull pages', async () => {
    const localUserId = 'local-user-all-entities';
    createActiveUser(localUserId);
    const updatedAt = '2026-08-25T00:30:00.000Z';
    const futureTrigger = new Date(Date.now() + 60_000).toISOString();
    const changes: SyncBatchResponsePayload['changes'] = [
      {
        changeId: 1,
        entityType: 'profile',
        entityId: 'profile',
        operation: 'update',
        version: 2,
        payload: {
          username: 'Cloud Name',
          wake_time: '06:30',
          sleep_time: '22:30',
          study_peak_hours: 'morning,evening',
          busiest_day: 'Tuesday',
          reminder_lead_minutes: 20,
          snooze_tendency: 'snooze_once',
          weekly_class_count: '4-6',
          longest_class_gap: '1 hour',
          time_format_24h: true,
          week_starts_monday: true,
          dark_mode: true,
        },
        updatedAt,
      },
      {
        changeId: 2,
        entityType: 'task',
        entityId: 'cloud-task',
        operation: 'create',
        version: 1,
        payload: {
          title: 'Prepare report',
          due_date: '2026-08-26',
          due_time: '09:00',
          is_completed: false,
          priority: 'high',
          category: 'School',
          notes: 'Bring charts',
          recurrence_rule: null,
        },
        updatedAt,
      },
      {
        changeId: 3,
        entityType: 'event',
        entityId: 'cloud-event',
        operation: 'create',
        version: 1,
        payload: {
          title: 'Advising',
          date: '2026-08-26',
          start_time: '10:00',
          end_time: '11:00',
          location: 'Room 1',
          linked_calendar_block: null,
          recurrence_rule: null,
        },
        updatedAt,
      },
      {
        changeId: 4,
        entityType: 'time_block',
        entityId: 'cloud-block',
        operation: 'create',
        version: 1,
        payload: {
          title: 'Focus block',
          date: '2026-08-26',
          start_time: '13:00',
          end_time: '14:00',
          color: '#123456',
          category: 'Study',
          notes: null,
          recurrence_rule: null,
        },
        updatedAt,
      },
      {
        changeId: 5,
        entityType: 'reminder',
        entityId: 'cloud-reminder',
        operation: 'create',
        version: 1,
        payload: {
          task: 'Submit report',
          description: 'Upload PDF',
          scheduled_at: futureTrigger,
          trigger_at: futureTrigger,
          status: 'pending',
          snooze_count: 0,
        },
        updatedAt,
      },
      {
        changeId: 6,
        entityType: 'note',
        entityId: 'cloud-note',
        operation: 'create',
        version: 1,
        payload: {
          title: 'Meeting notes',
          body: 'Follow up tomorrow.',
          is_pinned: true,
          category: 'General',
          is_voice_transcribed: true,
          sort_order: 2,
        },
        updatedAt,
      },
      {
        changeId: 7,
        entityType: 'custom_category',
        entityId: 'cloud-category',
        operation: 'create',
        version: 1,
        payload: { name: 'Capstone', color: '#abcdef' },
        updatedAt,
      },
    ];
    jest
      .spyOn(cloudClient, 'request')
      .mockResolvedValueOnce({
        status: 'success',
        data: makeResponse({
          changes: changes.slice(0, 4),
          nextCursor: 4,
          hasMore: true,
        }),
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: makeResponse({ changes: changes.slice(4), nextCursor: 7 }),
      });

    await syncWorker.performSync();

    expect(readRequestBody(0)).toMatchObject({ cursor: 0, mutations: [] });
    expect(readRequestBody(1)).toMatchObject({ cursor: 4, mutations: [] });
    expect(userStore.getUserById(localUserId)?.username).toBe('Cloud Name');
    expect(
      db.executeSync('SELECT user_id FROM user_preferences').rows[0]?.user_id
    ).toBe(localUserId);
    for (const table of [
      'tasks',
      'events',
      'time_blocks',
      'reminders',
      'notes',
      'custom_categories',
    ]) {
      expect(
        db.executeSync(`SELECT user_id FROM ${table}`).rows[0]?.user_id
      ).toBe(localUserId);
    }
    expect(
      db.executeSync('SELECT priority FROM tasks WHERE id = ?', ['cloud-task'])
        .rows[0]?.priority
    ).toBe('High');
    expect(db.executeSync('SELECT tags FROM notes').rows[0]?.tags).toBe('[]');
    expect(
      db.executeSync(
        `SELECT COUNT(*) AS count FROM sync_metadata
         WHERE user_id = ? AND scope_type = 'account' AND scope_id = ?`,
        [localUserId, localUserId]
      ).rows[0]?.count
    ).toBe(7);
    expect(syncStateStore.load(localUserId)).toMatchObject({
      cursor: 7,
      status: 'Synced',
      lastSyncedAt: SERVER_TIME,
    });
    expect(reconcileReminderAlarms).toHaveBeenCalledTimes(1);
  });

  it('drains multiple scoped outbox batches and leaves another user untouched', async () => {
    const localUserId = 'local-user-batches';
    const otherUserId = 'other-local-user';
    createActiveUser(localUserId);
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO users (
         id, username, email, role, is_new_user, time_format_24h,
         week_starts_monday, dark_mode, created_at, updated_at
       ) VALUES (?, 'Other', ?, 'student', 0, 0, 0, 0, ?, ?)`,
      [otherUserId, `${otherUserId}@example.com`, now, now]
    );
    for (let index = 0; index < 101; index += 1) {
      const mutationId = `mutation-${String(index).padStart(3, '0')}`;
      db.executeSync(
        `INSERT INTO sync_outbox (
           id, user_id, scope_type, scope_id, entity_type, entity_id,
           operation, payload, base_version, created_at, updated_at,
           status, attempts
         ) VALUES (?, ?, 'account', ?, 'task', ?, 'update', ?, ?, ?, ?, 'pending', 0)`,
        [
          mutationId,
          localUserId,
          localUserId,
          `task-${index}`,
          JSON.stringify({ title: `Task ${index}` }),
          index === 0 ? 5 : null,
          now,
          now,
        ]
      );
    }
    syncOutboxStore.enqueueMutation(
      otherUserId,
      'task',
      'other-task',
      'create',
      { title: 'Do not send me' }
    );

    const requestSpy = jest
      .spyOn(cloudClient, 'request')
      .mockImplementation(async (_endpoint, options) => {
        const requestBody = options?.body;
        if (typeof requestBody !== 'string') {
          throw new Error('Expected JSON request body.');
        }
        const body = JSON.parse(requestBody) as SyncBatchRequestBody;
        return {
          status: 'success',
          data: makeResponse({
            accepted: body.mutations.map((mutation) => ({
              mutationId: mutation.mutationId,
              entityType: mutation.entityType,
              entityId: mutation.entityId,
              status: 'accepted',
              serverVersion: 6,
            })),
            nextCursor: body.cursor,
          }),
        };
      });

    await syncWorker.performSync();

    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(readRequestBody(0).mutations).toHaveLength(100);
    expect(readRequestBody(1).mutations).toHaveLength(1);
    expect(readRequestBody(0).mutations[0].baseVersion).toBe(5);
    expect(readRequestBody(0).mutations[1]).not.toHaveProperty('baseVersion');
    expect(
      db.executeSync('SELECT COUNT(*) AS count FROM sync_outbox WHERE user_id = ?', [
        localUserId,
      ]).rows[0]?.count
    ).toBe(0);
    expect(
      db.executeSync('SELECT status FROM sync_outbox WHERE user_id = ?', [
        otherUserId,
      ]).rows[0]?.status
    ).toBe('pending');
  });

  it('sends create at version zero and resolves a queued successor from pulled metadata', async () => {
    const localUserId = 'local-user-create-delete';
    createActiveUser(localUserId);
    syncOutboxStore.enqueueMutation(
      localUserId,
      'task',
      'create-then-delete',
      'create',
      { title: 'Short-lived task' }
    );
    syncOutboxStore.enqueueMutation(
      localUserId,
      'task',
      'create-then-delete',
      'delete',
      {}
    );
    const requestSpy = jest
      .spyOn(cloudClient, 'request')
      .mockImplementation(async (_endpoint, options) => {
        if (typeof options?.body !== 'string') {
          throw new Error('Expected JSON request body.');
        }
        const body = JSON.parse(options.body) as SyncBatchRequestBody;
        const mutation = body.mutations[0];
        if (!mutation) {
          return { status: 'success', data: makeResponse({ nextCursor: body.cursor }) };
        }
        const isCreate = mutation.operation === 'create';
        const changeId = isCreate ? 1 : 2;
        return {
          status: 'success',
          data: makeResponse({
            accepted: [
              {
                mutationId: mutation.mutationId,
                entityType: mutation.entityType,
                entityId: mutation.entityId,
                status: 'accepted',
                serverVersion: changeId,
              },
            ],
            changes: [
              {
                changeId,
                entityType: 'task',
                entityId: 'create-then-delete',
                operation: isCreate ? 'create' : 'delete',
                version: changeId,
                payload: isCreate ? { title: 'Short-lived task' } : {},
                updatedAt: SERVER_TIME,
                ...(isCreate ? {} : { deletedAt: SERVER_TIME }),
              },
            ],
            nextCursor: changeId,
          }),
        };
      });

    await syncWorker.performSync();

    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(readRequestBody(0).mutations).toEqual([
      expect.objectContaining({ operation: 'create', baseVersion: 0 }),
    ]);
    expect(readRequestBody(1).mutations).toEqual([
      expect.objectContaining({ operation: 'delete', baseVersion: 1 }),
    ]);
    expect(syncOutboxStore.getPendingMutations(localUserId)).toHaveLength(0);
    expect(
      db.executeSync('SELECT deleted_at FROM tasks WHERE id = ?', [
        'create-then-delete',
      ]).rows[0]?.deleted_at
    ).toBe(SERVER_TIME);
  });

  it('upgrades a legacy null-version create to optimistic version zero at send time', async () => {
    const localUserId = 'legacy-null-create-owner';
    createActiveUser(localUserId);
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO sync_outbox (
         id, user_id, scope_type, scope_id, entity_type, entity_id,
         operation, payload, base_version, created_at, updated_at,
         status, attempts
       ) VALUES ('legacy-null-create', ?, 'account', ?, 'task',
         'legacy-create-task', 'create', ?, NULL, ?, ?, 'pending', 0)`,
      [localUserId, localUserId, JSON.stringify({ title: 'Legacy create' }), now, now]
    );
    jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: makeResponse({
        accepted: [
          {
            mutationId: 'legacy-null-create',
            entityType: 'task',
            entityId: 'legacy-create-task',
            status: 'accepted',
            serverVersion: 1,
          },
        ],
      }),
    });

    await syncWorker.performSync();

    expect(readRequestBody(0).mutations[0]).toMatchObject({
      mutationId: 'legacy-null-create',
      operation: 'create',
      baseVersion: 0,
    });
  });

  it('atomically reconciles a paged snapshot without pruning local or conflicted work', async () => {
    const localUserId = 'local-user-reset';
    createActiveUser(localUserId);
    const oldTime = '2026-08-24T01:00:00.000Z';
    syncStateStore.save(localUserId, {
      cursor: 42,
      lastSyncedAt: oldTime,
      status: 'Synced',
      errorMessage: null,
    });
    db.executeSync(
      `INSERT INTO tasks (
         id, user_id, title, is_completed, priority, category,
         created_at, updated_at
       ) VALUES ('stale-synced-task', ?, 'No longer on server', 0,
         'Medium', 'General', ?, ?)`,
      [localUserId, oldTime, oldTime]
    );
    db.executeSync(
      `INSERT INTO notes (
         id, user_id, title, body, is_pinned, tags, category,
         is_voice_transcribed, sort_order, created_at, updated_at
       ) VALUES ('protected-note', ?, 'Keep local conflict', 'Local body',
         0, '[]', 'General', 0, 0, ?, ?)`,
      [localUserId, oldTime, oldTime]
    );
    db.executeSync(
      `INSERT INTO events (
         id, user_id, title, date, start_time, end_time, created_at, updated_at
       ) VALUES ('local-only-event', ?, 'Never uploaded', '2026-08-26',
         '08:00', '09:00', ?, ?)`,
      [localUserId, oldTime, oldTime]
    );
    syncMetadataStore.upsert(localUserId, {
      entityType: 'task',
      entityId: 'stale-synced-task',
      version: 3,
      changeId: 42,
      updatedAt: oldTime,
    });
    syncMetadataStore.upsert(localUserId, {
      entityType: 'note',
      entityId: 'protected-note',
      version: 4,
      changeId: 41,
      updatedAt: oldTime,
    });
    syncOutboxStore.enqueueMutation(
      localUserId,
      'note',
      'protected-note',
      'update',
      { title: 'Keep local conflict', body: 'Local body' }
    );
    const protectedMutation = syncOutboxStore.getPendingMutations(localUserId)[0];
    syncOutboxStore.markMutationsInProgress(localUserId, [protectedMutation.id]);
    syncOutboxStore.markMutationsFailed(localUserId, [protectedMutation.id]);

    const otherUserId = 'metadata-other-user';
    syncMetadataStore.upsert(otherUserId, {
      entityType: 'task',
      entityId: 'other-metadata',
      version: 9,
      changeId: 99,
      updatedAt: oldTime,
    });
    const snapshotTask: SyncBatchResponsePayload['changes'][number] = {
      changeId: 8,
      entityType: 'task',
      entityId: 'snapshot-task',
      operation: 'update',
      version: 2,
      payload: { title: 'Current server task' },
      updatedAt: SERVER_TIME,
    };
    const snapshotNote: SyncBatchResponsePayload['changes'][number] = {
      changeId: 9,
      entityType: 'note',
      entityId: 'snapshot-note',
      operation: 'update',
      version: 1,
      payload: { title: 'Current server note', body: 'Snapshot body' },
      updatedAt: SERVER_TIME,
    };
    jest
      .spyOn(cloudClient, 'request')
      .mockResolvedValueOnce({
        status: 'success',
        data: makeResponse({ nextCursor: 42, resetRequired: true }),
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: makeResponse({
          snapshot: makeSnapshot({
            items: [snapshotTask],
            nextAfter: { entityType: 'task', entityId: 'snapshot-task' },
            hasMore: true,
            complete: false,
          }),
        }),
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: makeResponse({
          snapshot: makeSnapshot({ items: [snapshotNote] }),
        }),
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: makeResponse({ nextCursor: 10 }),
      });

    await syncWorker.performSync();

    expect(readRequestBody(0)).toMatchObject({ cursor: 42, mutations: [] });
    expect(readRequestBody(0)).not.toHaveProperty('snapshot');
    expect(readRequestBody(1)).toEqual({
      cursor: 0,
      mutations: [],
      entityTypes: CLIENT_SYNC_ENTITY_TYPES,
      snapshot: {},
    });
    expect(readRequestBody(2)).toEqual({
      cursor: 0,
      mutations: [],
      entityTypes: CLIENT_SYNC_ENTITY_TYPES,
      snapshot: {
        boundaryCursor: 10,
        after: { entityType: 'task', entityId: 'snapshot-task' },
      },
    });
    expect(readRequestBody(3)).toEqual({
      cursor: 10,
      mutations: [],
      entityTypes: CLIENT_SYNC_ENTITY_TYPES,
    });
    expect(
      db.executeSync(
        'SELECT deleted_at FROM tasks WHERE id = ?',
        ['stale-synced-task']
      ).rows[0]?.deleted_at
    ).toBe(SERVER_TIME);
    expect(
      db.executeSync(
        'SELECT deleted_at FROM notes WHERE id = ?',
        ['protected-note']
      ).rows[0]?.deleted_at
    ).toBeNull();
    expect(
      db.executeSync(
        'SELECT deleted_at FROM events WHERE id = ?',
        ['local-only-event']
      ).rows[0]?.deleted_at
    ).toBeNull();
    expect(
      db.executeSync('SELECT priority FROM tasks WHERE id = ?', ['snapshot-task'])
        .rows[0]?.priority
    ).toBe('Medium');
    expect(
      db.executeSync('SELECT tags FROM notes WHERE id = ?', ['snapshot-note'])
        .rows[0]?.tags
    ).toBe('[]');
    expect(
      db.executeSync(
        'SELECT entity_id FROM sync_metadata WHERE user_id = ? ORDER BY entity_id',
        [localUserId]
      ).rows.map((row) => row.entity_id)
    ).toEqual(['protected-note', 'snapshot-note', 'snapshot-task']);
    expect(
      syncMetadataStore.getVersion(localUserId, 'note', 'protected-note')
    ).toBe(4);
    expect(
      db.executeSync(
        'SELECT entity_id FROM sync_metadata WHERE user_id = ?',
        [otherUserId]
      ).rows[0]?.entity_id
    ).toBe('other-metadata');
    expect(
      db.executeSync('SELECT status FROM sync_outbox WHERE id = ?', [
        protectedMutation.id,
      ]).rows[0]?.status
    ).toBe('failed');
    expect(syncStateStore.load(localUserId)).toMatchObject({
      cursor: 10,
      status: 'Synced',
    });
  });

  it('rolls back the whole page and cursor when a change cannot be applied', async () => {
    const localUserId = 'local-user-rollback';
    createActiveUser(localUserId);
    syncStateStore.save(localUserId, {
      cursor: 5,
      lastSyncedAt: '2026-08-24T01:00:00.000Z',
      status: 'Synced',
      errorMessage: null,
    });
    syncMetadataStore.upsert(localUserId, {
      entityType: 'note',
      entityId: 'existing-metadata',
      version: 1,
      changeId: 5,
      updatedAt: '2026-08-24T01:00:00.000Z',
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: makeResponse({
        changes: [
          {
            changeId: 6,
            entityType: 'task',
            entityId: 'rolled-back-task',
            operation: 'create',
            version: 1,
            payload: {
              title: 'Must roll back',
              is_completed: false,
              priority: 'medium',
              category: 'General',
            },
            updatedAt: SERVER_TIME,
          },
          {
            changeId: 7,
            entityType: 'profile',
            entityId: 'profile',
            operation: 'delete',
            version: 2,
            payload: {},
            updatedAt: SERVER_TIME,
            deletedAt: SERVER_TIME,
          },
        ],
        nextCursor: 7,
      }),
    });

    await syncWorker.performSync();

    expect(
      db.executeSync('SELECT COUNT(*) AS count FROM tasks').rows[0]?.count
    ).toBe(0);
    expect(
      db.executeSync(
        'SELECT entity_id FROM sync_metadata WHERE user_id = ?',
        [localUserId]
      ).rows.map((row) => row.entity_id)
    ).toEqual(['existing-metadata']);
    expect(syncStateStore.load(localUserId)).toMatchObject({
      cursor: 5,
      status: 'Attention required',
    });
  });

  it('rejects a pulled entity ID owned by another local user', async () => {
    const localUserId = 'active-owner';
    const otherUserId = 'existing-owner';
    createActiveUser(localUserId);
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO users (
         id, username, email, role, is_new_user, time_format_24h,
         week_starts_monday, dark_mode, created_at, updated_at
       ) VALUES (?, 'Existing Owner', ?, 'student', 0, 0, 0, 0, ?, ?)`,
      [otherUserId, `${otherUserId}@example.com`, now, now]
    );
    db.executeSync(
      `INSERT INTO tasks (
         id, user_id, title, is_completed, priority, category,
         created_at, updated_at
       ) VALUES ('shared-task-id', ?, 'Other user task', 0, 'medium',
         'General', ?, ?)`,
      [otherUserId, now, now]
    );
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: makeResponse({
        changes: [
          {
            changeId: 1,
            entityType: 'task',
            entityId: 'shared-task-id',
            operation: 'update',
            version: 2,
            payload: {
              title: 'Active user overwrite',
              due_date: null,
              due_time: null,
              is_completed: false,
              priority: 'high',
              category: 'General',
              notes: null,
              recurrence_rule: null,
            },
            updatedAt: SERVER_TIME,
          },
        ],
        nextCursor: 1,
      }),
    });

    await syncWorker.performSync();

    expect(
      db.executeSync(
        'SELECT user_id, title, updated_at FROM tasks WHERE id = ?',
        ['shared-task-id']
      ).rows[0]
    ).toMatchObject({
      user_id: otherUserId,
      title: 'Other user task',
      updated_at: now,
    });
    expect(
      db.executeSync(
        'SELECT COUNT(*) AS count FROM sync_metadata WHERE user_id = ?',
        [localUserId]
      ).rows[0]?.count
    ).toBe(0);
    expect(syncStateStore.load(localUserId)).toMatchObject({
      cursor: 0,
      status: 'Attention required',
    });
  });

  it('reclaims a v7 cloud placeholder row for its authenticated local owner', async () => {
    const localUserId = 'v7-replay-owner';
    createActiveUser(localUserId);
    const oldTime = '2026-08-20T01:00:00.000Z';
    db.executeSync(
      `INSERT INTO users (
         id, username, role, is_new_user, time_format_24h,
         week_starts_monday, dark_mode, created_at, updated_at
       ) VALUES ('cloud', 'Legacy placeholder', 'student', 0, 0, 0, 0, ?, ?)`,
      [oldTime, oldTime]
    );
    db.executeSync(
      `INSERT INTO tasks (
         id, user_id, title, is_completed, priority, category,
         created_at, updated_at
       ) VALUES ('legacy-cloud-task', 'cloud', 'Legacy title', 0,
         'medium', 'General', ?, ?)`,
      [oldTime, oldTime]
    );
    db.executeSync('PRAGMA user_version = 7');
    await initDatabase();
    db.executeSync('DELETE FROM sync_outbox WHERE user_id = ?', [localUserId]);
    jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: makeResponse({
        changes: [
          {
            changeId: 1,
            entityType: 'task',
            entityId: 'legacy-cloud-task',
            operation: 'update',
            version: 2,
            payload: {
              title: 'Reclaimed from authenticated cloud state',
              priority: 'high',
            },
            updatedAt: SERVER_TIME,
          },
        ],
        nextCursor: 1,
      }),
    });

    await syncWorker.performSync();

    expect(
      db.executeSync(
        'SELECT user_id, title, priority FROM tasks WHERE id = ?',
        ['legacy-cloud-task']
      ).rows[0]
    ).toMatchObject({
      user_id: localUserId,
      title: 'Reclaimed from authenticated cloud state',
      priority: 'High',
    });
    expect(syncStateStore.load(localUserId).cursor).toBe(1);
  });

  it('marks a rejected mutation terminally failed and preserves its version context', async () => {
    const localUserId = 'local-user-rejection';
    createActiveUser(localUserId);
    syncMetadataStore.upsert(localUserId, {
      entityType: 'task',
      entityId: 'conflicting-task',
      version: 3,
      changeId: 3,
      updatedAt: '2026-08-24T01:00:00.000Z',
    });
    syncOutboxStore.enqueueMutation(
      localUserId,
      'task',
      'conflicting-task',
      'update',
      { title: 'My edit' }
    );
    const queuedMutation = syncOutboxStore.getPendingMutations(localUserId)[0];
    const mutationId = queuedMutation.id;
    jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: makeResponse({
        rejected: [
          {
            mutationId,
            entityType: 'task',
            entityId: 'conflicting-task',
            status: 'rejected',
            reason: 'version_conflict',
            serverVersion: 4,
            serverPayload: { title: 'Server edit' },
          },
        ],
      }),
    });

    await syncWorker.performSync();

    expect(readRequestBody(0).mutations[0]).toMatchObject({
      mutationId,
      baseVersion: 3,
    });
    expect(
      db.executeSync(
        'SELECT status, attempts FROM sync_outbox WHERE id = ?',
        [mutationId]
      ).rows[0]
    ).toMatchObject({ status: 'failed', attempts: 1 });
    expect(syncStateStore.load(localUserId)).toMatchObject({
      status: 'Attention required',
      errorMessage: '1 mutation rejected by server',
    });
    expect(syncConflictStore.getUnresolved(localUserId)).toEqual([
      expect.objectContaining({
        mutationId,
        entityType: 'task',
        entityId: 'conflicting-task',
        operation: 'update',
        reason: 'version_conflict',
        localPayload: { title: 'My edit' },
        baseVersion: 3,
        serverVersion: 4,
        serverPayload: { title: 'Server edit' },
      }),
    ]);
  });

  it('persists a non-version server rejection with its local payload and reason', async () => {
    const localUserId = 'local-user-validation-rejection';
    createActiveUser(localUserId);
    syncOutboxStore.enqueueMutation(
      localUserId,
      'task',
      'invalid-task',
      'create',
      { title: '' }
    );
    const mutationId = syncOutboxStore.getPendingMutations(localUserId)[0].id;
    jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: makeResponse({
        rejected: [
          {
            mutationId,
            entityType: 'task',
            entityId: 'invalid-task',
            status: 'rejected',
            reason: 'Payload validation failed: title is required',
          },
        ],
      }),
    });

    await syncWorker.performSync();

    expect(syncConflictStore.getUnresolved(localUserId)).toEqual([
      expect.objectContaining({
        mutationId,
        reason: 'Payload validation failed: title is required',
        localPayload: { title: '' },
        baseVersion: 0,
        serverVersion: null,
        serverPayload: null,
      }),
    ]);
    expect(
      db.executeSync('SELECT status FROM sync_outbox WHERE id = ?', [mutationId])
        .rows[0]?.status
    ).toBe('failed');
  });

  it('requeues without settlement when a mutation result names the wrong entity', async () => {
    const localUserId = 'local-user-result-mismatch';
    createActiveUser(localUserId);
    syncOutboxStore.enqueueMutation(
      localUserId,
      'task',
      'expected-task',
      'create',
      { title: 'Expected entity' }
    );
    const mutationId = syncOutboxStore.getPendingMutations(localUserId)[0].id;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: makeResponse({
        accepted: [
          {
            mutationId,
            entityType: 'task',
            entityId: 'different-task',
            status: 'accepted',
          },
        ],
      }),
    });

    await syncWorker.performSync();

    expect(
      db.executeSync(
        'SELECT status, attempts FROM sync_outbox WHERE id = ?',
        [mutationId]
      ).rows[0]
    ).toMatchObject({ status: 'pending', attempts: 1 });
    expect(syncConflictStore.getUnresolved(localUserId)).toEqual([]);
    expect(syncStateStore.load(localUserId)).toMatchObject({
      cursor: 0,
      status: 'Attention required',
    });
  });

  it.each([
    ['offline', 'Offline'],
    ['auth_required', 'Sign-in required'],
    ['server_error', 'Attention required'],
  ] as const)(
    'requeues in-progress mutations after a %s response',
    async (resultStatus, expectedSyncStatus) => {
      const localUserId = `local-user-${resultStatus}`;
      createActiveUser(localUserId);
      syncOutboxStore.enqueueMutation(
        localUserId,
        'task',
        `task-${resultStatus}`,
        'create',
        { title: 'Keep the same mutation id' }
      );
      const mutationId = syncOutboxStore.getPendingMutations(localUserId)[0].id;
      jest.spyOn(cloudClient, 'request').mockResolvedValue({
        status: resultStatus,
        error: 'Cloud request interrupted.',
      });

      await syncWorker.performSync();

      expect(
        db.executeSync(
          'SELECT status, attempts FROM sync_outbox WHERE id = ?',
          [mutationId]
        ).rows[0]
      ).toMatchObject({ status: 'pending', attempts: 1 });
      expect(syncStateStore.load(localUserId).status).toBe(expectedSyncStatus);
    }
  );

  it('requeues the same idempotency key when a result is omitted', async () => {
    const localUserId = 'local-user-requeue';
    createActiveUser(localUserId);
    syncOutboxStore.enqueueMutation(
      localUserId,
      'task',
      'retry-task',
      'create',
      { title: 'Retry me' }
    );
    const queuedMutation = syncOutboxStore.getPendingMutations(localUserId)[0];
    const mutationId = queuedMutation.id;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const requestSpy = jest
      .spyOn(cloudClient, 'request')
      .mockResolvedValueOnce({ status: 'success', data: makeResponse() })
      .mockResolvedValueOnce({
        status: 'success',
        data: makeResponse({
          accepted: [
            {
              mutationId,
              entityType: 'task',
              entityId: 'retry-task',
              status: 'accepted',
            },
          ],
        }),
      });

    await syncWorker.performSync();

    expect(
      db.executeSync(
        'SELECT status, attempts, updated_at FROM sync_outbox WHERE id = ?',
        [mutationId]
      ).rows[0]
    ).toMatchObject({
      status: 'pending',
      attempts: 1,
      updated_at: queuedMutation.updatedAt,
    });

    await syncWorker.performSync();

    expect(requestSpy).toHaveBeenCalledTimes(2);
    const firstMutationId = readRequestBody(0).mutations[0].mutationId;
    const secondMutationId = readRequestBody(1).mutations[0].mutationId;
    expect(firstMutationId).toBe(mutationId);
    expect(secondMutationId).toBe(mutationId);
    expect(readRequestBody(0).mutations[0].clientUpdatedAt).toBe(
      queuedMutation.updatedAt
    );
    expect(readRequestBody(1).mutations[0].clientUpdatedAt).toBe(
      queuedMutation.updatedAt
    );
    expect(
      db.executeSync(
        'SELECT COUNT(*) AS count FROM sync_outbox WHERE id = ?',
        [mutationId]
      ).rows[0]?.count
    ).toBe(0);
  });
});
