import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { syncOutboxStore } from '../../src/storage/syncOutboxStore';
import { importedBatchesStore } from '../../src/storage/importedBatchesStore';
import { cancelReminderAlarm } from '../../src/scheduler/reminderAlarm';
import { deletePreCachedReminderAudio } from '../../src/ai/tts/ttsService';
import {
  persistImportedCalendarBatch,
  persistImportedCalendarItems,
  removeImportedCalendarBatch,
  removeImportedCalendarItems,
} from '../../src/ui/screens/calendar/hooks/calendarImportPersistence';

jest.mock('../../src/scheduler/reminderAlarm', () => ({
  cancelReminderAlarm: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/ai/tts/ttsService', () => ({
  deletePreCachedReminderAudio: jest.fn().mockResolvedValue(undefined),
}));

const USER_ID = 'calendar-import-user';
const OTHER_USER_ID = 'calendar-other-user';
const NOW = '2026-08-25T00:00:00.000Z';

const parsedItems = {
  events: [{
    id: 'source-event',
    title: 'Imported event',
    date: '2026-09-01',
    startTime: '09:00',
    endTime: '10:00',
    location: 'Room A',
    recurrenceRule: null,
  }],
  blocks: [{
    id: 'source-block',
    title: 'Imported focus',
    date: '2026-09-01',
    startTime: '10:00',
    endTime: '11:00',
    color: '#123456',
    category: 'Imported',
    notes: 'Focus',
    recurrenceRule: null,
  }],
  tasks: [{
    id: 'source-task',
    title: 'Imported task',
    dueDate: '2026-09-01',
    dueTime: '12:00',
    isCompleted: false,
    priority: 'High' as const,
    category: 'Imported',
    notes: 'Finish',
    recurrenceRule: null,
  }],
};

describe('calendar import persistence', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM sync_metadata');
    db.executeSync('DELETE FROM sync_control');
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM events');
    db.executeSync('DELETE FROM time_blocks');
    db.executeSync('DELETE FROM tasks');
    db.executeSync('DELETE FROM users');
    db.executeSync(
      `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, 'Importer', ?, ?)`,
      [USER_ID, NOW, NOW],
    );
  });

  it('writes imported events, blocks, and tasks with scoped outbox creates', () => {
    const ids = persistImportedCalendarItems(USER_ID, parsedItems);

    expect(db.executeSync('SELECT id FROM events WHERE id = ?', [ids.eventIds[0]]).rows).toHaveLength(1);
    expect(db.executeSync('SELECT id FROM time_blocks WHERE id = ?', [ids.blockIds[0]]).rows).toHaveLength(1);
    expect(db.executeSync('SELECT id FROM tasks WHERE id = ?', [ids.taskIds[0]]).rows).toHaveLength(1);

    const pending = syncOutboxStore.getPendingMutations(USER_ID);
    expect(pending).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'event', entityId: ids.eventIds[0], operation: 'create',
        localUserId: USER_ID, scopeType: 'account', scopeId: USER_ID,
      }),
      expect.objectContaining({
        entityType: 'time_block', entityId: ids.blockIds[0], operation: 'create',
        localUserId: USER_ID, scopeType: 'account', scopeId: USER_ID,
      }),
      expect.objectContaining({
        entityType: 'task', entityId: ids.taskIds[0], operation: 'create',
        localUserId: USER_ID, scopeType: 'account', scopeId: USER_ID,
      }),
    ]));
    expect(pending.find((item) => item.entityType === 'event')?.payload).toMatchObject({
      title: 'Imported event', date: '2026-09-01', start_time: '09:00', end_time: '10:00',
    });
    expect(pending.find((item) => item.entityType === 'time_block')?.payload).toMatchObject({
      title: 'Imported focus', color: '#123456', category: 'Imported',
    });
    expect(pending.find((item) => item.entityType === 'task')?.payload).toMatchObject({
      title: 'Imported task', priority: 'High', is_completed: false,
    });
  });

  it('rolls back every imported row when a later outbox create fails', () => {
    const originalEnqueue = syncOutboxStore.enqueueMutation;
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const enqueueSpy = jest.spyOn(syncOutboxStore, 'enqueueMutation')
      .mockImplementationOnce(originalEnqueue)
      .mockImplementationOnce(() => {
        throw new Error('forced import outbox failure');
      });

    expect(() => persistImportedCalendarItems(USER_ID, parsedItems))
      .toThrow('forced import outbox failure');
    enqueueSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    expect(db.executeSync('SELECT id FROM events').rows).toHaveLength(0);
    expect(db.executeSync('SELECT id FROM time_blocks').rows).toHaveLength(0);
    expect(db.executeSync('SELECT id FROM tasks').rows).toHaveLength(0);
    expect(syncOutboxStore.getPendingMutations(USER_ID)).toHaveLength(0);
  });

  it('rolls back earlier batch deletes when a later tombstone fails', () => {
    const ids = persistImportedCalendarItems(USER_ID, parsedItems);
    db.executeSync(
      `INSERT INTO reminders (
         id, user_id, task, scheduled_at, trigger_at, status, precast_audio_path,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        'linked-reminder',
        USER_ID,
        'Imported event',
        '2026-09-01T09:00:00.000Z',
        '2026-09-01T08:45:00.000Z',
        'local://linked-audio',
        NOW,
        NOW,
      ],
    );
    db.executeSync('DELETE FROM sync_outbox');
    const originalEnqueue = syncOutboxStore.enqueueMutation;
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const enqueueSpy = jest.spyOn(syncOutboxStore, 'enqueueMutation')
      .mockImplementationOnce(originalEnqueue)
      .mockImplementationOnce(originalEnqueue)
      .mockImplementationOnce(() => {
        throw new Error('forced removal outbox failure');
      });

    const batch = {
      id: 'batch-1',
      userId: USER_ID,
      timestamp: NOW,
      fileName: 'calendar.ics',
      events: ids.eventIds,
      blocks: ids.blockIds,
      tasks: ids.taskIds,
    };
    expect(() => removeImportedCalendarItems(USER_ID, batch))
      .toThrow('forced removal outbox failure');
    enqueueSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    expect(db.executeSync('SELECT deleted_at FROM events WHERE id = ?', [ids.eventIds[0]]).rows[0].deleted_at).toBeNull();
    expect(db.executeSync('SELECT deleted_at FROM time_blocks WHERE id = ?', [ids.blockIds[0]]).rows[0].deleted_at).toBeNull();
    expect(db.executeSync('SELECT deleted_at FROM tasks WHERE id = ?', [ids.taskIds[0]]).rows[0].deleted_at).toBeNull();
    expect(db.executeSync('SELECT deleted_at FROM reminders WHERE id = ?', ['linked-reminder']).rows[0].deleted_at).toBeNull();
    expect(syncOutboxStore.getPendingMutations(USER_ID)).toHaveLength(0);
    expect(cancelReminderAlarm).not.toHaveBeenCalled();
    expect(deletePreCachedReminderAudio).not.toHaveBeenCalled();

    removeImportedCalendarItems(USER_ID, batch);
    expect(cancelReminderAlarm).toHaveBeenCalledWith('linked-reminder');
    expect(deletePreCachedReminderAudio).toHaveBeenCalledWith('local://linked-audio');
  });

  it('rejects a batch containing another user entity before deleting anything', () => {
    db.executeSync(
      `INSERT INTO users (id, username, created_at, updated_at)
       VALUES (?, 'Other', ?, ?)`,
      [OTHER_USER_ID, NOW, NOW],
    );
    db.executeSync(
      `INSERT INTO events (
         id, user_id, title, date, start_time, end_time, created_at, updated_at
       ) VALUES ('other-event', ?, 'Private event', '2026-09-01', '09:00', '10:00', ?, ?)`,
      [OTHER_USER_ID, NOW, NOW],
    );

    expect(() => removeImportedCalendarItems(USER_ID, {
      id: 'malicious-batch',
      userId: USER_ID,
      timestamp: NOW,
      fileName: 'other.ics',
      events: ['other-event'],
      blocks: [],
      tasks: [],
    })).toThrow(`Imported events entity other-event is not owned by user ${USER_ID}.`);

    expect(db.executeSync(
      'SELECT deleted_at FROM events WHERE id = ?',
      ['other-event'],
    ).rows[0].deleted_at).toBeNull();
    expect(syncOutboxStore.getPendingMutations(USER_ID)).toHaveLength(0);
    expect(syncOutboxStore.getPendingMutations(OTHER_USER_ID)).toHaveLength(0);
  });

  it('compensates active imported entities when RNFS batch tracking fails', async () => {
    const saveSpy = jest.spyOn(importedBatchesStore, 'saveImportedBatch')
      .mockRejectedValueOnce(new Error('forced RNFS save failure'));

    await expect(persistImportedCalendarBatch(USER_ID, 'failed.ics', parsedItems))
      .rejects.toThrow('forced RNFS save failure');
    saveSpy.mockRestore();

    expect(db.executeSync('SELECT id FROM events WHERE deleted_at IS NULL').rows).toHaveLength(0);
    expect(db.executeSync('SELECT id FROM time_blocks WHERE deleted_at IS NULL').rows).toHaveLength(0);
    expect(db.executeSync('SELECT id FROM tasks WHERE deleted_at IS NULL').rows).toHaveLength(0);
    const pending = syncOutboxStore.getPendingMutations(USER_ID);
    expect(pending.filter((item) => item.operation === 'create')).toHaveLength(3);
    expect(pending.filter((item) => item.operation === 'delete')).toHaveLength(3);
  });

  it('keeps a failed RNFS removal retryable after SQLite tombstones commit', async () => {
    const ids = persistImportedCalendarItems(USER_ID, parsedItems);
    db.executeSync('DELETE FROM sync_outbox');
    const batch = {
      id: 'retry-batch',
      userId: USER_ID,
      timestamp: NOW,
      fileName: 'retry.ics',
      events: ids.eventIds,
      blocks: ids.blockIds,
      tasks: ids.taskIds,
    };
    const deleteSpy = jest.spyOn(importedBatchesStore, 'deleteImportedBatch')
      .mockRejectedValueOnce(new Error('forced RNFS delete failure'))
      .mockResolvedValueOnce(batch);

    await expect(removeImportedCalendarBatch(USER_ID, batch))
      .rejects.toThrow('forced RNFS delete failure');
    await expect(removeImportedCalendarBatch(USER_ID, batch)).resolves.toBeUndefined();
    expect(deleteSpy).toHaveBeenCalledTimes(2);
    deleteSpy.mockRestore();
  });
});
