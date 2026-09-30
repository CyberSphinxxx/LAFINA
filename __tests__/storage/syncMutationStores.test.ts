import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { notesStore } from '../../src/storage/notesStore';
import { preferencesStore, getDefaultUserPreferences } from '../../src/storage/preferencesStore';
import { remindersStore } from '../../src/storage/remindersStore';
import { syncOutboxStore } from '../../src/storage/syncOutboxStore';
import { tasksStore } from '../../src/storage/tasksStore';
import { timeBlocksStore } from '../../src/storage/timeBlocksStore';
import { userStore } from '../../src/storage/userStore';

jest.mock('../../src/scheduler/reminderAlarm', () => ({
  cancelReminderAlarm: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/ai/tts/ttsService', () => ({
  deletePreCachedReminderAudio: jest.fn().mockResolvedValue(undefined),
}));

const USER_ID = 'sync-store-user';
const NOW = '2026-08-24T00:00:00.000Z';

describe('personal store sync mutations', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM sync_metadata');
    db.executeSync('DELETE FROM sync_control');
    db.executeSync('DELETE FROM custom_categories');
    db.executeSync('DELETE FROM notes');
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM events');
    db.executeSync('DELETE FROM tasks');
    db.executeSync('DELETE FROM time_blocks');
    db.executeSync('DELETE FROM user_preferences');
    db.executeSync('DELETE FROM users');
    db.executeSync(
      `INSERT INTO users (
         id, username, role, is_new_user, time_format_24h, week_starts_monday,
         dark_mode, created_at, updated_at
       ) VALUES (?, 'Manager', 'student', 1, 0, 0, 0, ?, ?)`,
      [USER_ID, NOW, NOW],
    );
  });

  it('enqueues complete scoped backend payloads for personal writes', () => {
    tasksStore.insertTask({
      id: 'task-1', userId: USER_ID, title: 'Draft', dueDate: '2026-08-30',
      dueTime: '09:00', isCompleted: false, priority: 'High', category: 'Work',
      notes: 'Details', recurrenceRule: null,
    });
    tasksStore.updateTask({ id: 'task-1', title: 'Final' });
    tasksStore.insertEvent({
      id: 'event-1', userId: USER_ID, title: 'Standup', date: '2026-08-30',
      startTime: '10:00', endTime: '10:30', location: 'Room 1',
      linkedCalendarBlock: null, recurrenceRule: null,
    });
    timeBlocksStore.insert({
      id: 'block-1', userId: USER_ID, title: 'Focus', date: '2026-08-30',
      startTime: '11:00', endTime: '12:00', color: '#123456', category: 'Work',
      notes: 'Plan', recurrenceRule: null,
    });
    remindersStore.insertReminder({
      id: 'reminder-1', userId: USER_ID, task: 'Final', description: 'Do it',
      scheduledAt: '2026-08-30T09:00:00.000Z', triggerAt: '2026-08-30T08:45:00.000Z',
      status: 'pending', preCastAudioPath: null,
    });
    notesStore.insert({
      id: 'note-1', userId: USER_ID, title: 'Notes', body: 'Body', isPinned: true,
      tags: ['work'], category: 'Work', isVoiceTranscribed: false, imageUri: 'local://image',
    });
    notesStore.addCustomCategory(USER_ID, 'Sales', '#abcdef');
    userStore.setDarkModeEnabled(USER_ID, true);
    preferencesStore.save(USER_ID, getDefaultUserPreferences());

    const pending = syncOutboxStore.getPendingMutations(USER_ID);
    expect(pending.every((item) => (
      item.localUserId === USER_ID && item.scopeType === 'account' && item.scopeId === USER_ID
    ))).toBe(true);
    expect(pending.find((item) => item.entityType === 'task')).toMatchObject({
      operation: 'create',
      payload: {
        title: 'Final', due_date: '2026-08-30', due_time: '09:00',
        is_completed: false, priority: 'High', category: 'Work', notes: 'Details',
        recurrence_rule: null,
      },
    });
    expect(pending.find((item) => item.entityType === 'event')?.payload).toMatchObject({
      title: 'Standup', date: '2026-08-30', start_time: '10:00', end_time: '10:30',
      location: 'Room 1', linked_calendar_block: null, recurrence_rule: null,
    });
    expect(pending.find((item) => item.entityType === 'time_block')?.payload).toMatchObject({
      title: 'Focus', date: '2026-08-30', start_time: '11:00', end_time: '12:00',
      color: '#123456', category: 'Work', notes: 'Plan', recurrence_rule: null,
    });
    expect(pending.find((item) => item.entityType === 'reminder')?.payload).toMatchObject({
      task: 'Final', description: 'Do it', status: 'pending', snooze_count: 0,
    });
    const notePayload = pending.find((item) => item.entityType === 'note')?.payload;
    expect(notePayload).toMatchObject({
      title: 'Notes', body: 'Body', is_pinned: true, tags: '["work"]',
      category: 'Work', is_voice_transcribed: false, sort_order: 0,
    });
    expect(notePayload).not.toHaveProperty('image_uri');
    expect(pending.find((item) => item.entityType === 'custom_category')?.payload).toMatchObject({
      name: 'Sales', color: '#abcdef',
    });
    expect(pending.find((item) => item.entityType === 'profile')).toMatchObject({
      entityId: 'profile',
      payload: {
        username: 'Manager', wake_time: '07:00', sleep_time: '22:00',
        study_peak_hours: '[]', busiest_day: 'Monday', reminder_lead_minutes: 15,
        snooze_tendency: 'snooze_once', weekly_class_count: '4-6',
        longest_class_gap: '1 hour', time_format_24h: false,
        week_starts_monday: false, dark_mode: true,
      },
    });
  });

  it('keeps device-only fields local and does not create cloud mutations', () => {
    remindersStore.insertReminder({
      id: 'reminder-local', userId: USER_ID, task: 'Local', description: null,
      scheduledAt: '2026-08-30T09:00:00.000Z', triggerAt: '2026-08-30T08:45:00.000Z',
      status: 'pending', preCastAudioPath: null,
    });
    notesStore.insert({
      id: 'note-local', userId: USER_ID, title: 'Local', body: 'Body', isPinned: false,
      tags: [], category: 'General', isVoiceTranscribed: false,
    });
    db.executeSync('DELETE FROM sync_outbox');

    remindersStore.updatePreCachedAudioPath('reminder-local', 'local://audio');
    notesStore.update({ id: 'note-local', imageUri: 'local://image' });
    userStore.markOnboardingComplete(USER_ID);

    expect(syncOutboxStore.getPendingMutations(USER_ID)).toHaveLength(0);
  });

  it('enqueues tombstones for direct deletes and linked reminders', () => {
    tasksStore.insertTask({
      id: 'task-delete', userId: USER_ID, title: 'Cascade', isCompleted: false,
      priority: 'Medium', category: 'Work',
    });
    remindersStore.insertReminder({
      id: 'reminder-delete', userId: USER_ID, task: 'Cascade', description: null,
      scheduledAt: '2026-08-30T09:00:00.000Z', triggerAt: '2026-08-30T08:45:00.000Z',
      status: 'pending', preCastAudioPath: 'local://audio',
    });
    notesStore.insert({
      id: 'note-delete', userId: USER_ID, title: 'Delete', body: 'Body', isPinned: false,
      tags: [], category: 'General', isVoiceTranscribed: false,
    });
    notesStore.addCustomCategory(USER_ID, 'Delete me', '#000000');
    const categoryId = syncOutboxStore.getPendingMutations(USER_ID).find(
      (item) => item.entityType === 'custom_category',
    )?.entityId;
    db.executeSync('DELETE FROM sync_outbox');

    tasksStore.deleteTask('task-delete');
    notesStore.delete('note-delete');
    notesStore.deleteCustomCategory(USER_ID, 'Delete me');

    const deletes = syncOutboxStore.getPendingMutations(USER_ID);
    expect(deletes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: 'task', entityId: 'task-delete', operation: 'delete' }),
      expect.objectContaining({ entityType: 'reminder', entityId: 'reminder-delete', operation: 'delete' }),
      expect.objectContaining({ entityType: 'note', entityId: 'note-delete', operation: 'delete' }),
      expect.objectContaining({ entityType: 'custom_category', entityId: categoryId, operation: 'delete' }),
    ]));
    expect(deletes.every((item) => Object.keys(item.payload).length === 0)).toBe(true);
  });

  it('rolls back the domain row when enqueueing fails', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const enqueueSpy = jest.spyOn(syncOutboxStore, 'enqueueMutation')
      .mockImplementationOnce(() => {
        throw new Error('forced outbox failure');
      });

    expect(() => tasksStore.insertTask({
      id: 'task-rollback', userId: USER_ID, title: 'Rollback', isCompleted: false,
      priority: 'Low', category: 'General',
    })).toThrow('forced outbox failure');
    enqueueSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    expect(db.executeSync('SELECT id FROM tasks WHERE id = ?', ['task-rollback']).rows).toHaveLength(0);
  });
});
