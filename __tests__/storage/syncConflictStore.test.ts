import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { syncConflictStore } from '../../src/storage/syncConflictStore';

describe('syncConflictStore', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM sync_conflicts');
  });

  it('preserves both conflict payloads by account and can resolve the review item', () => {
    syncConflictStore.record('user-a', {
      mutationId: 'mutation-1',
      entityType: 'task',
      entityId: 'task-1',
      operation: 'update',
      reason: 'version_conflict',
      localPayload: { title: 'Local edit', priority: 'High' },
      baseVersion: 3,
      serverVersion: 4,
      serverPayload: { title: 'Server edit', priority: 'Medium' },
    });
    syncConflictStore.record('user-b', {
      mutationId: 'mutation-1',
      entityType: 'task',
      entityId: 'task-1',
      operation: 'update',
      reason: 'version_conflict',
      localPayload: { title: 'Other local edit' },
      baseVersion: 1,
      serverVersion: 2,
      serverPayload: { title: 'Other server edit' },
    });

    expect(syncConflictStore.getUnresolved('user-a')).toEqual([
      expect.objectContaining({
        mutationId: 'mutation-1',
        reason: 'version_conflict',
        localPayload: { title: 'Local edit', priority: 'High' },
        baseVersion: 3,
        serverVersion: 4,
        serverPayload: { title: 'Server edit', priority: 'Medium' },
      }),
    ]);
    expect(syncConflictStore.getUnresolved('user-b')).toHaveLength(1);

    syncConflictStore.resolve('user-a', 'mutation-1');

    expect(syncConflictStore.getUnresolved('user-a')).toHaveLength(0);
    expect(syncConflictStore.getUnresolved('user-b')).toHaveLength(1);
  });
});
