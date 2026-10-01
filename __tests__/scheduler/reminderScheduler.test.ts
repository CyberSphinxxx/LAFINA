/**
 * Unit tests for `src/scheduler/reminderScheduler.ts`.
 *
 * Covers the one-shot trigger check (due window, status update, event emit),
 * the 15-second foreground daemon lifecycle, and the guard that keeps a failing
 * poll from taking the scheduler down.
 */
import { DeviceEventEmitter } from 'react-native';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { remindersStore } from '../../src/storage/remindersStore';
import {
  checkAndTriggerReminders,
  startSchedulerDaemon,
  stopSchedulerDaemon,
} from '../../src/scheduler/reminderScheduler';

jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.DeviceEventEmitter.emit = jest.fn();
  return rn;
});

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

interface ReminderInput {
  id: string;
  task?: string;
  triggerAt?: string;
  status?: 'pending' | 'triggered' | 'snoozed' | 'acknowledged' | 'missed';
  preCastAudioPath?: string | null;
}

const insertReminder = (input: ReminderInput): void => {
  remindersStore.insertReminder({
    id: input.id,
    userId: 'user1',
    task: input.task ?? 'Task',
    description: null,
    scheduledAt: iso(),
    triggerAt: input.triggerAt ?? iso(),
    status: input.status ?? 'pending',
    preCastAudioPath: input.preCastAudioPath ?? null,
  });
};

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
      ['user1', 'testuser', iso(), iso()]
    );
  });

  afterEach(() => {
    stopSchedulerDaemon();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('triggers a due reminder and updates its status', async () => {
    insertReminder({
      id: 'rem_due',
      task: 'Due task',
      triggerAt: iso(-5000), // 5s ago (due)
      preCastAudioPath: '/cache/audio.wav',
    });

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
    insertReminder({ id: 'rem_future', task: 'Future task', triggerAt: iso(120000) });

    await checkAndTriggerReminders('user1');

    expect(remindersStore.getReminderById('rem_future')?.status).toBe('pending');
    expect(DeviceEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('triggers a reminder that is inside the 30-second lead window', async () => {
    insertReminder({ id: 'rem_soon', triggerAt: iso(20000) });

    await checkAndTriggerReminders('user1');

    expect(remindersStore.getReminderById('rem_soon')?.status).toBe('triggered');
    expect(DeviceEventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('leaves a reminder alone while it is still more than 30 seconds away', async () => {
    insertReminder({ id: 'rem_later', triggerAt: iso(45000) });

    await checkAndTriggerReminders('user1');

    expect(remindersStore.getReminderById('rem_later')?.status).toBe('pending');
    expect(DeviceEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('logs instead of throwing when the reminder lookup fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(remindersStore, 'getUpcomingReminders').mockImplementation(() => {
      throw new Error('database is locked');
    });

    await expect(checkAndTriggerReminders('user1')).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      '[Scheduler] Error checking reminders:',
      expect.any(Error)
    );
    expect(DeviceEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('checks immediately when the daemon starts', () => {
    insertReminder({ id: 'rem_start', triggerAt: iso(-5000) });

    startSchedulerDaemon('user1');

    expect(remindersStore.getReminderById('rem_start')?.status).toBe('triggered');
    expect(DeviceEventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('re-checks due reminders on every 15-second poll', () => {
    jest.useFakeTimers();
    startSchedulerDaemon('user1');
    expect(DeviceEventEmitter.emit).not.toHaveBeenCalled();

    insertReminder({ id: 'rem_tick', triggerAt: iso(-5000) });
    jest.advanceTimersByTime(15000);

    expect(remindersStore.getReminderById('rem_tick')?.status).toBe('triggered');
    expect(DeviceEventEmitter.emit).toHaveBeenCalledTimes(1);

    // The next tick finds nothing left to trigger.
    jest.advanceTimersByTime(15000);
    expect(DeviceEventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('keeps only one polling loop when the daemon is restarted', () => {
    jest.useFakeTimers();
    const lookupSpy = jest.spyOn(remindersStore, 'getUpcomingReminders');

    startSchedulerDaemon('user1');
    startSchedulerDaemon('user1'); // restarts and clears the previous interval
    expect(lookupSpy).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(15000);

    // One live interval: a leaked second interval would double the poll count.
    expect(lookupSpy).toHaveBeenCalledTimes(3);
  });

  it('stops polling once the daemon is stopped', () => {
    jest.useFakeTimers();
    const lookupSpy = jest.spyOn(remindersStore, 'getUpcomingReminders');

    startSchedulerDaemon('user1');
    stopSchedulerDaemon();
    jest.advanceTimersByTime(60000);

    expect(lookupSpy).toHaveBeenCalledTimes(1);
  });
});
