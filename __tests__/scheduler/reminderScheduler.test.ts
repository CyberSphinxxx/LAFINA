import { DeviceEventEmitter } from 'react-native';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { remindersStore } from '../../src/storage/remindersStore';
import { checkAndTriggerReminders, startSchedulerDaemon, stopSchedulerDaemon } from '../../src/scheduler/reminderScheduler';

jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.DeviceEventEmitter.emit = jest.fn();
  return rn;
});

describe('reminderScheduler daemon', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM users');
    jest.clearAllMocks();

    db.executeSync(
      `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ['user1', 'testuser', new Date().toISOString(), new Date().toISOString()]
    );
  });

  afterEach(() => {
    stopSchedulerDaemon();
  });

  it('triggers a due reminder and updates its status', async () => {
    const now = new Date();
    
    const reminder = {
      id: 'rem_due',
      userId: 'user1',
      task: 'Due task',
      description: null,
      scheduledAt: now.toISOString(),
      triggerAt: new Date(now.getTime() - 5000).toISOString(), // 5s ago (due)
      status: 'pending' as const,
      preCastAudioPath: '/cache/audio.wav',
    };

    remindersStore.insertReminder(reminder);

    await checkAndTriggerReminders('user1');

    // Verify it updated the status in DB to triggered so it won't fire again
    const updated = remindersStore.getReminderById('rem_due');
    expect(updated?.status).toBe('triggered');

    // Verify event was emitted to trigger incoming call UI
    expect(DeviceEventEmitter.emit).toHaveBeenCalledWith('LAFINA_CALL_TRIGGER', {
      reminderId: 'rem_due',
      task: 'Due task',
      audioPath: '/cache/audio.wav',
    });
  });

  it('does not trigger a reminder that is scheduled in the future', async () => {
    const now = new Date();

    const reminderFuture = {
      id: 'rem_future',
      userId: 'user1',
      task: 'Future task',
      description: null,
      scheduledAt: now.toISOString(),
      triggerAt: new Date(now.getTime() + 120000).toISOString(), // 2 min future
      status: 'pending' as const,
      preCastAudioPath: null,
    };

    remindersStore.insertReminder(reminderFuture);

    await checkAndTriggerReminders('user1');

    const updated = remindersStore.getReminderById('rem_future');
    expect(updated?.status).toBe('pending');
    expect(DeviceEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('restarts, polls, and stops the daemon without leaving an old interval active', async () => {
    jest.useFakeTimers();
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    startSchedulerDaemon('user1');
    startSchedulerDaemon('user1');
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(15000);
    await Promise.resolve();
    stopSchedulerDaemon();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    clearIntervalSpy.mockRestore();
    jest.useRealTimers();
  });
});
