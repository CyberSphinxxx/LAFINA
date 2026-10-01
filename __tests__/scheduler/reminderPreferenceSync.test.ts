import { NativeModules } from 'react-native';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { remindersStore } from '../../src/storage/remindersStore';
import { refreshPendingReminderLeadTimes } from '../../src/scheduler/reminderPreferenceSync';

jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.NativeModules.LafinaReminder = {
    scheduleExactAlarm: jest.fn().mockResolvedValue(true),
  };
  return rn;
});

const nativeReminder = NativeModules.LafinaReminder;
const userId = 'preference_sync_user';

describe('reminder preference synchronization', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T10:00:00.000Z'));
    jest.clearAllMocks();
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM users');
    const now = new Date().toISOString();
    db.executeSync(
      'INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [userId, 'Preference Student', now, now]
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('updates future pending reminder alarms when lead time changes', async () => {
    remindersStore.insertReminder({
      id: 'pending_reminder',
      userId,
      task: 'Submit thesis draft',
      description: null,
      scheduledAt: '2026-07-17T12:00:00.000Z',
      triggerAt: '2026-07-17T11:45:00.000Z',
      status: 'pending',
      preCastAudioPath: null,
    });
    remindersStore.insertReminder({
      id: 'completed_reminder',
      userId,
      task: 'Completed task',
      description: null,
      scheduledAt: '2026-07-17T13:00:00.000Z',
      triggerAt: '2026-07-17T12:45:00.000Z',
      status: 'acknowledged',
      preCastAudioPath: null,
    });

    await expect(refreshPendingReminderLeadTimes(userId, 60)).resolves.toEqual({
      updatedCount: 1,
      failedCount: 0,
    });

    expect(remindersStore.getReminderById('pending_reminder')?.triggerAt).toBe(
      '2026-07-17T11:00:00.000Z'
    );
    expect(nativeReminder.scheduleExactAlarm).toHaveBeenCalledTimes(1);
    expect(nativeReminder.scheduleExactAlarm).toHaveBeenCalledWith({
      reminderId: 'pending_reminder',
      task: 'Submit thesis draft',
      triggerAtMs: new Date('2026-07-17T11:00:00.000Z').getTime(),
    });
  });

  it('rejects lead times outside the 0-120 minute range', async () => {
    for (const invalid of [-1, 121, 1.5, Number.NaN]) {
      await expect(refreshPendingReminderLeadTimes(userId, invalid)).rejects.toThrow(
        'Reminder lead time must be between 0 and 120 minutes.'
      );
    }
  });

  it('counts a reminder as failed when the native alarm cannot be scheduled', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (nativeReminder.scheduleExactAlarm as jest.Mock).mockResolvedValueOnce(false);
    remindersStore.insertReminder({
      id: 'unreachable_reminder',
      userId,
      task: 'Submit thesis draft',
      description: null,
      scheduledAt: '2026-07-17T12:00:00.000Z',
      triggerAt: '2026-07-17T11:45:00.000Z',
      status: 'pending',
      preCastAudioPath: null,
    });

    await expect(refreshPendingReminderLeadTimes(userId, 60)).resolves.toEqual({
      updatedCount: 0,
      failedCount: 1,
    });

    expect(remindersStore.getReminderById('unreachable_reminder')?.triggerAt).toBe(
      '2026-07-17T11:45:00.000Z'
    );
    expect(console.error).toHaveBeenCalledWith(
      '[ReminderPreferences] Failed to apply updated lead time:',
      'unreachable_reminder',
      expect.any(Error)
    );
  });

  it('restores the original alarm when the database rejects the new trigger time', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(remindersStore, 'updateReminderTriggerAt').mockImplementation(() => {
      throw new Error('database is locked');
    });
    remindersStore.insertReminder({
      id: 'rollback_reminder',
      userId,
      task: 'Submit thesis draft',
      description: null,
      scheduledAt: '2026-07-17T12:00:00.000Z',
      triggerAt: '2026-07-17T11:45:00.000Z',
      status: 'pending',
      preCastAudioPath: null,
    });

    await expect(refreshPendingReminderLeadTimes(userId, 60)).resolves.toEqual({
      updatedCount: 0,
      failedCount: 1,
    });

    // First the requested lead time, then the original alarm restored.
    expect(nativeReminder.scheduleExactAlarm).toHaveBeenNthCalledWith(1, {
      reminderId: 'rollback_reminder',
      task: 'Submit thesis draft',
      triggerAtMs: new Date('2026-07-17T11:00:00.000Z').getTime(),
    });
    expect(nativeReminder.scheduleExactAlarm).toHaveBeenNthCalledWith(2, {
      reminderId: 'rollback_reminder',
      task: 'Submit thesis draft',
      triggerAtMs: new Date('2026-07-17T11:45:00.000Z').getTime(),
    });
  });
});
