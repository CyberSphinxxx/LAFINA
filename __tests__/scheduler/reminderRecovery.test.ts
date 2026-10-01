/**
 * Chaos tests for interrupted reminder calls.
 *
 * Android can kill the process while a simulated call is ringing or in
 * conversation. Nothing writes a terminal status on the way down, so the row stays
 * `triggered` and every future trigger query ignores it. These tests simulate that
 * process death and prove the next launch hands the reminder back to the scheduler.
 */
import { DeviceEventEmitter, NativeModules } from 'react-native';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { remindersStore } from '../../src/storage/remindersStore';
import {
  checkAndTriggerReminders,
  recoverOrphanedReminderCalls,
  startSchedulerDaemon,
  stopSchedulerDaemon,
} from '../../src/scheduler/reminderScheduler';

jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.NativeModules.LafinaReminder = {
    scheduleExactAlarm: jest.fn().mockResolvedValue(true),
    cancelAlarm: jest.fn().mockResolvedValue(true),
    finishIncomingCall: jest.fn().mockResolvedValue(true),
    startActiveCall: jest.fn().mockResolvedValue(true),
    stopActiveCall: jest.fn().mockResolvedValue(true),
    consumePendingCall: jest.fn().mockResolvedValue(null),
  };
  rn.DeviceEventEmitter.emit = jest.fn();
  return rn;
});

const emitMock = DeviceEventEmitter.emit as jest.MockedFunction<
  typeof DeviceEventEmitter.emit
>;

const iso = (offsetMs = 0): string =>
  new Date(Date.now() + offsetMs).toISOString();

const MINUTE = 60 * 1000;

interface ReminderInput {
  id: string;
  task?: string;
  triggerAt?: string;
  status?: 'pending' | 'triggered' | 'snoozed' | 'acknowledged' | 'missed';
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
    preCastAudioPath: null,
  });
};

const flushPromises = async (): Promise<void> => {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
};

describe('interrupted reminder call recovery', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM users');
    db.executeSync(
      'INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['user1', 'testuser', iso(), iso()],
    );
    jest.clearAllMocks();
    emitMock.mockImplementation(() => undefined);
  });

  afterEach(() => {
    stopSchedulerDaemon();
    jest.restoreAllMocks();
  });

  it('re-arms a call that a process death left in triggered', async () => {
    insertReminder({
      id: 'rem-orphan',
      triggerAt: iso(-5 * MINUTE),
      status: 'triggered',
    });

    const recovered = await recoverOrphanedReminderCalls('user1');

    expect(recovered).toBe(1);
    const reminder = remindersStore.getReminderById('rem-orphan');
    expect(reminder?.status).toBe('snoozed');
    expect(reminder?.snoozeCount).toBe(1);
    expect(new Date(reminder?.triggerAt ?? '').getTime()).toBeGreaterThan(
      Date.now(),
    );
    // The replacement alarm is registered, not just the row rewritten.
    expect(NativeModules.LafinaReminder.scheduleExactAlarm).toHaveBeenCalled();
  });

  it('leaves a reminder alone while its call is inside the grace window', async () => {
    insertReminder({
      id: 'rem-live',
      triggerAt: iso(-10 * 1000),
      status: 'triggered',
    });

    const recovered = await recoverOrphanedReminderCalls('user1');

    expect(recovered).toBe(0);
    expect(remindersStore.getReminderById('rem-live')?.status).toBe('triggered');
  });

  it('marks the reminder missed when the snooze limit is already reached', async () => {
    insertReminder({
      id: 'rem-exhausted',
      triggerAt: iso(-20 * MINUTE),
      status: 'triggered',
    });
    // One snooze is the configured limit, so the automatic policy must give up.
    // The counter is seeded directly: snoozing through the store would move the
    // trigger time into the future and hide the row from the recovery window.
    db.executeSync(
      `UPDATE reminders SET snooze_count = 1 WHERE id = 'rem-exhausted'`,
    );

    const recovered = await recoverOrphanedReminderCalls('user1');

    expect(recovered).toBe(1);
    expect(remindersStore.getReminderById('rem-exhausted')?.status).toBe(
      'missed',
    );
  });

  it('ignores reminders that never started a call', async () => {
    insertReminder({
      id: 'rem-pending',
      triggerAt: iso(-30 * MINUTE),
      status: 'pending',
    });
    insertReminder({
      id: 'rem-done',
      triggerAt: iso(-30 * MINUTE),
      status: 'acknowledged',
    });
    insertReminder({
      id: 'rem-missed',
      triggerAt: iso(-30 * MINUTE),
      status: 'missed',
    });

    const recovered = await recoverOrphanedReminderCalls('user1');

    expect(recovered).toBe(0);
    expect(remindersStore.getReminderById('rem-pending')?.status).toBe(
      'pending',
    );
    expect(remindersStore.getReminderById('rem-done')?.status).toBe(
      'acknowledged',
    );
    expect(remindersStore.getReminderById('rem-missed')?.status).toBe('missed');
  });

  it('keeps the reminder for the next launch when the write fails', async () => {
    insertReminder({
      id: 'rem-locked',
      triggerAt: iso(-5 * MINUTE),
      status: 'triggered',
    });
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const original = db.executeSync.bind(db);
    jest.spyOn(db, 'executeSync').mockImplementation((query, params) => {
      if (query.startsWith('UPDATE reminders SET status')) {
        throw new Error('database is locked');
      }
      return original(query, params);
    });

    const recovered = await recoverOrphanedReminderCalls('user1');

    expect(recovered).toBe(0);
    expect(remindersStore.getReminderById('rem-locked')?.status).toBe(
      'triggered',
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not recover reminder call rem-locked'),
    );
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('recovers interrupted calls as soon as the daemon starts', async () => {
    insertReminder({
      id: 'rem-boot',
      triggerAt: iso(-15 * MINUTE),
      status: 'triggered',
    });

    startSchedulerDaemon('user1');
    await flushPromises();

    expect(remindersStore.getReminderById('rem-boot')?.status).toBe('snoozed');
  });

  it('keeps the JavaScript poller off while native exact alarms are linked', async () => {
    insertReminder({ id: 'rem-native-owned', triggerAt: iso() });
    jest.useFakeTimers();

    startSchedulerDaemon('user1');
    await jest.advanceTimersByTimeAsync(60_000);

    const triggers = emitMock.mock.calls.filter(
      call => call[0] === 'LAFINA_CALL_TRIGGER',
    );
    expect(triggers).toHaveLength(0);
    expect(remindersStore.getReminderById('rem-native-owned')?.status).toBe(
      'pending',
    );
  });

  // The complementary case (no native alarm module linked, so the JavaScript poller
  // still fires) is covered by `__tests__/scheduler/reminderScheduler.test.ts`, whose
  // react-native mock never registers `LafinaReminder`.

  it('does not fire the same reminder twice when the poll ticks twice', async () => {
    insertReminder({ id: 'rem-double', triggerAt: iso(-30 * 1000) });

    await checkAndTriggerReminders('user1');
    await checkAndTriggerReminders('user1');

    const triggers = emitMock.mock.calls.filter(
      call => call[0] === 'LAFINA_CALL_TRIGGER',
    );
    expect(triggers).toHaveLength(1);
    expect(remindersStore.getReminderById('rem-double')?.status).toBe(
      'triggered',
    );
  });

  it('still triggers other due reminders when one row cannot be written', async () => {
    insertReminder({ id: 'rem-broken', triggerAt: iso(-30 * 1000) });
    insertReminder({ id: 'rem-healthy', triggerAt: iso(-20 * 1000) });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const original = db.executeSync.bind(db);
    jest.spyOn(db, 'executeSync').mockImplementation((query, params) => {
      // The reminder id is always the trailing bound parameter of these updates.
      if (query.includes('WHERE id = ?') && params?.[2] === 'rem-broken') {
        throw new Error('database is locked');
      }
      return original(query, params);
    });

    await checkAndTriggerReminders('user1');

    expect(remindersStore.getReminderById('rem-healthy')?.status).toBe(
      'triggered',
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Scheduler] Could not trigger reminder rem-broken:',
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });
});
