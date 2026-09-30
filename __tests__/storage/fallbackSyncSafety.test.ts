jest.mock('@op-engineering/op-sqlite', () => {
  throw new Error('Force the compatibility database.');
});

import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { syncOutboxStore } from '../../src/storage/syncOutboxStore';
import { tasksStore } from '../../src/storage/tasksStore';

describe('fallback sync safety', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM tasks');
    db.executeSync('DELETE FROM users');
    const now = new Date().toISOString();
    db.executeSync(
      'INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['fallback-user', 'Fallback User', now, now],
    );
  });

  it('keeps local writes available while disabling unsupported cloud sync tables', () => {
    expect(db.isFallback()).toBe(true);

    tasksStore.insertTask({
      id: 'fallback-task',
      userId: 'fallback-user',
      title: 'Offline task',
      dueDate: null,
      dueTime: null,
      isCompleted: false,
      priority: 'Medium',
      category: 'General',
      notes: null,
      recurrenceRule: null,
    });

    expect(tasksStore.getAllTasks('fallback-user')).toHaveLength(1);
    expect(syncOutboxStore.getPendingMutations('fallback-user')).toEqual([]);
    expect(syncOutboxStore.isSuppressed('fallback-user')).toBe(true);
  });
});
