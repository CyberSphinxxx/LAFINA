import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { syncMetadataStore } from '../../src/storage/syncMetadataStore';
import { syncOutboxStore } from '../../src/storage/syncOutboxStore';
import { syncStateStore } from '../../src/storage/syncStateStore';

describe('scoped sync storage', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM sync_metadata');
    db.executeSync('DELETE FROM sync_state');
    db.executeSync('DELETE FROM sync_control');
  });

  it('isolates pending mutations and suppression by account', () => {
    syncOutboxStore.setSuppression('user-b', true);
    syncOutboxStore.enqueueMutation('user-a', 'task', 'task-1', 'create', { title: 'A' });
    syncOutboxStore.enqueueMutation('user-b', 'task', 'task-1', 'create', { title: 'B' });

    expect(syncOutboxStore.getPendingMutations('user-a')).toHaveLength(1);
    expect(syncOutboxStore.getPendingMutations('user-a')[0].localUserId).toBe('user-a');
    expect(syncOutboxStore.getPendingMutations('user-b')).toHaveLength(0);
    expect(syncOutboxStore.isSuppressed('user-a')).toBe(false);
    expect(syncOutboxStore.isSuppressed('user-b')).toBe(true);
  });

  it('compacts create+update and update+update without changing mutation IDs', () => {
    syncOutboxStore.enqueueMutation('user-a', 'task', 'task-new', 'create', { title: 'First' });
    const createId = syncOutboxStore.getPendingMutations('user-a')[0].id;
    syncOutboxStore.enqueueMutation('user-a', 'task', 'task-new', 'update', { title: 'Latest' });

    let pending = syncOutboxStore.getPendingMutations('user-a');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: createId, operation: 'create', baseVersion: 0 });
    expect(pending[0].payload.title).toBe('Latest');

    syncMetadataStore.upsert('user-a', {
      entityType: 'task',
      entityId: 'task-existing',
      version: 7,
      changeId: 12,
      updatedAt: '2026-08-24T00:00:00.000Z',
    });
    syncOutboxStore.enqueueMutation('user-a', 'task', 'task-existing', 'update', { title: 'One' });
    const updateId = syncOutboxStore.getPendingMutations('user-a').find(
      (item) => item.entityId === 'task-existing',
    )?.id;
    syncOutboxStore.enqueueMutation('user-a', 'task', 'task-existing', 'update', { title: 'Two' });

    pending = syncOutboxStore.getPendingMutations('user-a');
    const update = pending.find((item) => item.entityId === 'task-existing');
    expect(update).toMatchObject({ id: updateId, operation: 'update', baseVersion: 7 });
    expect(update?.payload.title).toBe('Two');
  });

  it('compacts update+delete while preserving its base version', () => {
    syncMetadataStore.upsert('user-a', {
      entityType: 'note',
      entityId: 'note-1',
      version: 4,
      changeId: 20,
      updatedAt: '2026-08-24T00:00:00.000Z',
    });
    syncOutboxStore.enqueueMutation('user-a', 'note', 'note-1', 'update', { title: 'Changed' });
    const id = syncOutboxStore.getPendingMutations('user-a')[0].id;
    syncOutboxStore.enqueueMutation('user-a', 'note', 'note-1', 'delete', {});

    expect(syncOutboxStore.getPendingMutations('user-a')).toEqual([
      expect.objectContaining({ id, operation: 'delete', payload: {}, baseVersion: 4 }),
    ]);
  });

  it('keeps create+delete as distinct IDs to avoid a post-crash server ghost', () => {
    syncOutboxStore.enqueueMutation('user-a', 'task', 'task-ghost', 'create', { title: 'Ghost' });
    syncOutboxStore.enqueueMutation('user-a', 'task', 'task-ghost', 'delete', {});

    const pending = syncOutboxStore.getPendingMutations('user-a');
    expect(pending.map((item) => item.operation)).toEqual(['create', 'delete']);
    expect(new Set(pending.map((item) => item.id)).size).toBe(2);
    expect(pending[0].baseVersion).toBe(0);
    expect(pending[1].baseVersion).toBeNull();
  });

  it('never rewrites an attempted mutation and appends later edits', () => {
    syncOutboxStore.enqueueMutation('user-a', 'task', 'task-1', 'update', { title: 'Sent once' });
    const first = syncOutboxStore.getPendingMutations('user-a')[0];

    expect(syncOutboxStore.markMutationsInProgress('user-a', [first.id])).toBe(1);
    syncOutboxStore.requeueMutations('user-a', [first.id]);
    expect(syncOutboxStore.getPendingMutations('user-a')[0].updatedAt).toBe(
      first.updatedAt
    );
    syncOutboxStore.enqueueMutation('user-a', 'task', 'task-1', 'update', { title: 'Later edit' });

    const pending = syncOutboxStore.getPendingMutations('user-a');
    expect(pending).toHaveLength(2);
    expect(pending[0]).toMatchObject({ id: first.id, attempts: 1 });
    expect(pending[1].id).not.toBe(first.id);
    expect(pending[1].baseVersion).toBeNull();
  });

  it('claims, recovers, fails, and acknowledges only IDs in the requested account', () => {
    syncOutboxStore.enqueueMutation('user-a', 'task', 'shared-id', 'update', { title: 'A' });
    syncOutboxStore.enqueueMutation('user-b', 'task', 'shared-id', 'update', { title: 'B' });
    const aId = syncOutboxStore.getPendingMutations('user-a')[0].id;
    const aUpdatedAt = syncOutboxStore.getPendingMutations('user-a')[0].updatedAt;
    const bId = syncOutboxStore.getPendingMutations('user-b')[0].id;

    expect(syncOutboxStore.markMutationsInProgress('user-a', [aId, bId])).toBe(1);
    syncOutboxStore.recoverInProgressMutations('user-a');
    expect(syncOutboxStore.getPendingMutations('user-a')[0].attempts).toBe(1);

    syncOutboxStore.markMutationsFailed('user-a', [aId, bId]);
    expect(syncOutboxStore.getPendingMutations('user-a')).toHaveLength(0);
    expect(syncOutboxStore.getPendingMutations('user-b')).toHaveLength(1);
    const failed = db.executeSync(
      'SELECT status, attempts, updated_at FROM sync_outbox WHERE id = ?',
      [aId],
    ).rows[0];
    expect(failed).toMatchObject({
      status: 'failed',
      attempts: 1,
      updated_at: aUpdatedAt,
    });

    syncOutboxStore.acknowledgeMutations('user-a', [bId]);
    expect(syncOutboxStore.getPendingMutations('user-b')).toHaveLength(1);
    syncOutboxStore.acknowledgeMutations('user-b', [bId]);
    expect(syncOutboxStore.getPendingMutations('user-b')).toHaveLength(0);
  });

  it('persists state and metadata independently by scope', () => {
    syncStateStore.save('user-a', {
      cursor: 9,
      lastSyncedAt: '2026-08-24T01:00:00.000Z',
      status: 'Synced',
      errorMessage: null,
    });
    syncStateStore.save('user-a', {
      cursor: 2,
      lastSyncedAt: null,
      status: 'Offline',
      errorMessage: 'offline',
    }, 'business', 'business-1');

    expect(syncStateStore.load('user-a').cursor).toBe(9);
    expect(syncStateStore.load('user-a', 'business', 'business-1')).toMatchObject({
      cursor: 2,
      status: 'Offline',
    });
  });

  it('idempotently backfills untracked v7 personal rows with canonical creates', async () => {
    for (const table of [
      'tasks',
      'events',
      'time_blocks',
      'reminders',
      'notes',
      'custom_categories',
      'user_preferences',
    ]) {
      db.executeSync(`DELETE FROM ${table}`);
    }
    db.executeSync('DELETE FROM users');
    const oldTime = '2026-08-24T00:00:00.000Z';
    const newerTime = '2026-08-25T00:00:00.000Z';
    db.executeSync(
      `INSERT INTO users (id, username, created_at, updated_at) VALUES
       ('user-a', 'A', ?, ?), ('cloud', 'Legacy cloud', ?, ?)`,
      [oldTime, oldTime, oldTime, oldTime],
    );
    db.executeSync(
      `INSERT INTO tasks (
         id, user_id, title, priority, category, created_at, updated_at, deleted_at
       ) VALUES
       ('orphan-task', 'user-a', 'Orphan task', 'high', 'General', ?, ?, NULL),
       ('tracked-task', 'user-a', 'Tracked task', 'Medium', 'General', ?, ?, NULL),
       ('edited-task', 'user-a', 'Edited after sync', 'low', 'General', ?, ?, NULL),
       ('deleted-task', 'user-a', 'Deleted task', 'Medium', 'General', ?, ?, ?),
       ('cloud-task', 'cloud', 'Ambiguous task', 'Medium', 'General', ?, ?, NULL)`,
      [
        oldTime,
        oldTime,
        oldTime,
        oldTime,
        oldTime,
        newerTime,
        oldTime,
        oldTime,
        newerTime,
        oldTime,
        oldTime,
      ],
    );
    db.executeSync(
      `INSERT INTO events (
         id, user_id, title, date, start_time, end_time, created_at, updated_at
       ) VALUES ('orphan-event', 'user-a', 'Event', '2026-08-26',
         '08:00', '09:00', ?, ?)`,
      [oldTime, oldTime],
    );
    db.executeSync(
      `INSERT INTO time_blocks (
         id, user_id, title, date, start_time, end_time, color, category,
         created_at, updated_at
       ) VALUES ('orphan-block', 'user-a', 'Block', '2026-08-26',
         '09:00', '10:00', '#123456', 'Study', ?, ?)`,
      [oldTime, oldTime],
    );
    db.executeSync(
      `INSERT INTO reminders (
         id, user_id, task, scheduled_at, trigger_at, status,
         created_at, updated_at
       ) VALUES ('orphan-reminder', 'user-a', 'Remember', ?, ?, 'pending', ?, ?)`,
      [oldTime, oldTime, oldTime, oldTime],
    );
    db.executeSync(
      `INSERT INTO notes (
         id, user_id, title, body, is_pinned, tags, category,
         is_voice_transcribed, sort_order, created_at, updated_at, deleted_at
       ) VALUES
       ('orphan-note', 'user-a', 'Note', 'Body', 0, 'sales, q3',
         'General', 0, 0, ?, ?, NULL),
       ('metadata-note', 'user-a', 'Tracked note', 'Body', 0, '[]',
         'General', 0, 0, ?, ?, NULL),
       ('synced-deleted-note', 'user-a', 'Deleted note', 'Body', 0, '[]',
         'General', 0, 0, ?, ?, ?)`,
      [oldTime, oldTime, oldTime, oldTime, oldTime, newerTime, newerTime],
    );
    db.executeSync(
      `INSERT INTO custom_categories (
         id, user_id, name, color, created_at, updated_at
       ) VALUES ('orphan-category', 'user-a', 'Category', '#abcdef', ?, ?)`,
      [oldTime, oldTime],
    );
    syncOutboxStore.enqueueMutation(
      'user-a',
      'task',
      'tracked-task',
      'create',
      { title: 'Tracked task', priority: 'Medium', category: 'General' },
    );
    syncMetadataStore.upsert('user-a', {
      entityType: 'note',
      entityId: 'metadata-note',
      version: 2,
      changeId: 2,
      updatedAt: oldTime,
    });
    syncMetadataStore.upsert('user-a', {
      entityType: 'task',
      entityId: 'edited-task',
      version: 5,
      changeId: 5,
      updatedAt: oldTime,
    });
    syncMetadataStore.upsert('user-a', {
      entityType: 'note',
      entityId: 'synced-deleted-note',
      version: 6,
      changeId: 6,
      updatedAt: oldTime,
    });
    db.executeSync('PRAGMA user_version = 7');

    await initDatabase();

    const pending = syncOutboxStore.getPendingMutations('user-a', 100);
    const expectedBackfillIds = [
      'profile',
      'orphan-task',
      'orphan-event',
      'orphan-block',
      'orphan-reminder',
      'orphan-note',
      'orphan-category',
    ];
    expect(pending.filter((item) => expectedBackfillIds.includes(item.entityId)))
      .toHaveLength(expectedBackfillIds.length);
    for (const entityId of expectedBackfillIds) {
      expect(pending.find((item) => item.entityId === entityId)).toMatchObject({
        operation: 'create',
        baseVersion: 0,
      });
    }
    expect(pending.filter((item) => item.entityId === 'tracked-task')).toHaveLength(1);
    expect(pending.find((item) => item.entityId === 'metadata-note')).toBeUndefined();
    expect(pending.find((item) => item.entityId === 'deleted-task')).toBeUndefined();
    expect(pending.find((item) => item.entityId === 'edited-task')).toMatchObject({
      operation: 'update',
      baseVersion: 5,
      payload: expect.objectContaining({ priority: 'Low' }),
    });
    expect(pending.find((item) => item.entityId === 'synced-deleted-note'))
      .toMatchObject({ operation: 'delete', baseVersion: 6, payload: {} });
    expect(syncOutboxStore.getPendingMutations('cloud')).toHaveLength(0);
    expect(pending.find((item) => item.entityId === 'orphan-task')?.payload.priority)
      .toBe('High');
    expect(pending.find((item) => item.entityId === 'orphan-note')?.payload.tags)
      .toBe('["sales","q3"]');

    const firstCount = pending.length;
    db.executeSync('PRAGMA user_version = 8');
    await initDatabase();
    expect(syncOutboxStore.getPendingMutations('user-a', 100)).toHaveLength(firstCount);
  });

  it('safely upgrades v7 global sync rows without cross-account cursor or ownership leaks', async () => {
    db.executeSync('DELETE FROM users');
    const now = '2026-08-24T00:00:00.000Z';
    db.executeSync(
      `INSERT INTO users (id, username, created_at, updated_at) VALUES
       ('user-a', 'A', ?, ?), ('user-b', 'B', ?, ?)`,
      [now, now, now, now],
    );
    db.executeSync(
      `INSERT INTO tasks (id, user_id, title, priority, category, created_at, updated_at)
       VALUES ('owned-task', 'user-a', 'Owned', 'Medium', 'General', ?, ?)`,
      [now, now],
    );
    db.executeSync('DROP TABLE sync_outbox');
    db.executeSync('DROP TABLE sync_metadata');
    db.executeSync('DROP TABLE sync_state');
    db.executeSync('DROP TABLE sync_control');
    db.executeSync(`CREATE TABLE sync_outbox (
      id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      operation TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0
    )`);
    db.executeSync(`CREATE TABLE sync_metadata (
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL,
      change_id INTEGER, updated_at TEXT NOT NULL, PRIMARY KEY (entity_type, entity_id)
    )`);
    db.executeSync(`CREATE TABLE sync_state (
      id INTEGER PRIMARY KEY, cursor INTEGER NOT NULL, last_synced_at TEXT,
      status TEXT NOT NULL, error_message TEXT
    )`);
    db.executeSync('CREATE TABLE sync_control (id INTEGER PRIMARY KEY, suppress INTEGER NOT NULL)');
    db.executeSync(
      `INSERT INTO sync_outbox VALUES
       ('owned', 'task', 'owned-task', 'update', '{}', ?, 'pending', 0),
       ('legacy-create', 'task', 'owned-task', 'create', '{}', ?, 'pending', 0),
       ('ambiguous', 'note', 'missing-note', 'update', '{}', ?, 'pending', 0),
       ('profile-old', 'profile', 'user-a', 'update', '{}', ?, 'pending', 0)`,
      [now, now, now, now],
    );
    db.executeSync(
      `INSERT INTO sync_metadata VALUES ('task', 'owned-task', 5, 10, ?)`,
      [now],
    );
    db.executeSync(`INSERT INTO sync_state VALUES (1, 99, ?, 'Synced', NULL)`, [now]);
    db.executeSync('INSERT INTO sync_control VALUES (1, 1)');
    db.executeSync('PRAGMA user_version = 7');

    await initDatabase();

    const rows = db.executeSync(
      'SELECT id, user_id, scope_id, entity_id, base_version FROM sync_outbox ORDER BY id',
    ).rows;
    expect(rows.find((row) => row.id === 'owned')).toMatchObject({ user_id: 'user-a', scope_id: 'user-a' });
    expect(rows.find((row) => row.id === 'ambiguous')).toMatchObject({ user_id: 'legacy', scope_id: 'legacy' });
    expect(rows.find((row) => row.id === 'legacy-create')?.base_version).toBe(0);
    expect(rows.find((row) => row.id === 'profile-old')).toMatchObject({
      user_id: 'user-a', scope_id: 'user-a', entity_id: 'profile',
    });
    expect(syncStateStore.load('user-a')).toMatchObject({ cursor: 0, status: 'Local only' });
    expect(syncStateStore.load('user-b')).toMatchObject({ cursor: 0, status: 'Local only' });
    expect(syncOutboxStore.isSuppressed('user-a')).toBe(false);
    expect(syncOutboxStore.isSuppressed('user-b')).toBe(false);
    expect(syncMetadataStore.getVersion('user-a', 'task', 'owned-task')).toBe(5);
    expect(syncMetadataStore.getVersion('user-b', 'task', 'owned-task')).toBeNull();
  });
});
