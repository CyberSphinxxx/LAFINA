/**
 * Unit tests for `src/storage/remindersStore.ts`.
 *
 * Covers every CRUD path plus the validation boundaries that keep a reminder
 * from being scheduled in the past, and the error paths that surface instead of
 * silently losing a reminder.
 */
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { remindersStore } from '../../src/storage/remindersStore';

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const MINUTE = 60 * 1000;

interface ReminderInput {
  id: string;
  userId?: string;
  task?: string;
  description?: string | null;
  scheduledAt?: string;
  triggerAt?: string;
  status?: 'pending' | 'triggered' | 'snoozed' | 'acknowledged' | 'missed';
  preCastAudioPath?: string | null;
}

const insertReminder = (input: ReminderInput): void => {
  remindersStore.insertReminder({
    id: input.id,
    userId: input.userId ?? 'user1',
    task: input.task ?? 'Task',
    description: input.description ?? null,
    scheduledAt: input.scheduledAt ?? iso(),
    triggerAt: input.triggerAt ?? iso(),
    status: input.status ?? 'pending',
    preCastAudioPath: input.preCastAudioPath ?? null,
  });
};

describe('remindersStore', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM users');

    // Insert test user
    db.executeSync(
      `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ['user1', 'testuser', iso(), iso()]
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inserts and retrieves reminders correctly', () => {
    insertReminder({
      id: 'rem_1',
      task: 'Finish Sprint 5',
      description: 'TTS and reminders loop',
    });

    const fetched = remindersStore.getReminderById('rem_1');
    expect(fetched).not.toBeNull();
    expect(fetched?.task).toBe('Finish Sprint 5');
    expect(fetched?.status).toBe('pending');
    expect(fetched?.snoozeCount).toBe(0);
  });

  it('returns null for a reminder id that does not exist', () => {
    expect(remindersStore.getReminderById('missing')).toBeNull();
  });

  it('lists only non-deleted reminders for the requested user in trigger order', () => {
    db.executeSync(
      `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ['user2', 'other', iso(), iso()]
    );
    insertReminder({ id: 'rem_later', triggerAt: iso(2 * MINUTE) });
    insertReminder({ id: 'rem_sooner', triggerAt: iso(1 * MINUTE) });
    insertReminder({ id: 'rem_other_user', userId: 'user2', triggerAt: iso(3 * MINUTE) });
    insertReminder({ id: 'rem_deleted' });
    remindersStore.deleteReminder('rem_deleted');

    expect(remindersStore.getAllReminders('user1').map((reminder) => reminder.id)).toEqual([
      'rem_sooner',
      'rem_later',
    ]);
  });

  it('lists pending reminders and excludes finalized ones', () => {
    insertReminder({ id: 'rem_pending', status: 'pending' });
    insertReminder({ id: 'rem_snoozed', status: 'snoozed' });
    insertReminder({ id: 'rem_triggered', status: 'triggered' });
    insertReminder({ id: 'rem_acknowledged', status: 'acknowledged' });
    insertReminder({ id: 'rem_missed', status: 'missed' });

    expect(remindersStore.getPendingReminders('user1').map((reminder) => reminder.id).sort()).toEqual(
      ['rem_pending', 'rem_snoozed', 'rem_triggered']
    );
  });

  it('filters upcoming reminders correctly by trigger time', () => {
    insertReminder({ id: 'rem_past', task: 'Past task', triggerAt: iso(-10000) });
    insertReminder({ id: 'rem_future', task: 'Future task', triggerAt: iso(2 * MINUTE) });
    insertReminder({ id: 'rem_wrong_status', triggerAt: iso(-10000), status: 'triggered' });
    insertReminder({ id: 'rem_deleted', triggerAt: iso(-10000) });
    remindersStore.deleteReminder('rem_deleted');

    const upcoming = remindersStore.getUpcomingReminders('user1', 1); // 1 min window
    expect(upcoming.map((reminder) => reminder.id)).toEqual(['rem_past']);
  });

  it('includes snoozed reminders that fall inside the window and widens with the window argument', () => {
    insertReminder({ id: 'rem_snoozed', triggerAt: iso(30 * 1000), status: 'snoozed' });
    insertReminder({ id: 'rem_ten_minutes', triggerAt: iso(10 * MINUTE) });

    expect(remindersStore.getUpcomingReminders('user1', 1).map((reminder) => reminder.id)).toEqual([
      'rem_snoozed',
    ]);
    expect(
      remindersStore.getUpcomingReminders('user1', 15).map((reminder) => reminder.id)
    ).toEqual(['rem_snoozed', 'rem_ten_minutes']);
  });

  it('replaces a pending reminder trigger time', () => {
    const newTrigger = iso(5 * MINUTE);
    insertReminder({ id: 'rem_reschedule', triggerAt: iso(MINUTE) });

    remindersStore.updateReminderTriggerAt('rem_reschedule', newTrigger);

    expect(remindersStore.getReminderById('rem_reschedule')?.triggerAt).toBe(newTrigger);
  });

  it('refuses to move a reminder trigger into the past or to an invalid date', () => {
    insertReminder({ id: 'rem_reschedule' });

    expect(() => remindersStore.updateReminderTriggerAt('rem_reschedule', iso(-MINUTE))).toThrow(
      'Reminder trigger must be a valid future time.'
    );
    expect(() => remindersStore.updateReminderTriggerAt('rem_reschedule', 'not-a-date')).toThrow(
      'Reminder trigger must be a valid future time.'
    );
  });

  it('updates the reminder status', () => {
    insertReminder({ id: 'rem_status' });

    remindersStore.updateReminderStatus('rem_status', 'missed');

    expect(remindersStore.getReminderById('rem_status')?.status).toBe('missed');
  });

  it('snoozes a reminder correctly', () => {
    insertReminder({ id: 'rem_snooze', triggerAt: iso() });

    remindersStore.snoozeReminder('rem_snooze', 10);

    const updated = remindersStore.getReminderById('rem_snooze');
    expect(updated?.status).toBe('snoozed');
    expect(updated?.snoozeCount).toBe(1);
    expect(new Date(updated?.triggerAt || '').getTime()).toBeGreaterThan(Date.now());
  });

  it('accepts the snooze boundaries but rejects anything outside 1-120 minutes', () => {
    insertReminder({ id: 'rem_boundary' });

    expect(() => remindersStore.snoozeReminder('rem_boundary', 1)).not.toThrow();
    expect(() => remindersStore.snoozeReminder('rem_boundary', 120)).not.toThrow();
    expect(remindersStore.getReminderById('rem_boundary')?.snoozeCount).toBe(2);

    for (const invalid of [0, -5, 121, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => remindersStore.snoozeReminder('rem_boundary', invalid)).toThrow(
        'Snooze duration must be between 1 and 120 minutes.'
      );
    }
  });

  it('snoozes to an exact future trigger time and bumps the snooze count', () => {
    insertReminder({ id: 'rem_exact' });
    const exactTrigger = iso(3 * MINUTE);

    remindersStore.snoozeReminderAt('rem_exact', exactTrigger);

    const updated = remindersStore.getReminderById('rem_exact');
    expect(updated?.status).toBe('snoozed');
    expect(updated?.triggerAt).toBe(exactTrigger);
    expect(updated?.snoozeCount).toBe(1);
  });

  it('refuses an exact snooze time that is not in the future', () => {
    insertReminder({ id: 'rem_exact' });

    expect(() => remindersStore.snoozeReminderAt('rem_exact', iso(-MINUTE))).toThrow(
      'Snooze trigger must be a valid future time.'
    );
    expect(() => remindersStore.snoozeReminderAt('rem_exact', 'definitely-not-a-date')).toThrow(
      'Snooze trigger must be a valid future time.'
    );
  });

  it('acknowledges a reminder correctly', () => {
    insertReminder({ id: 'rem_ack' });

    remindersStore.acknowledgeReminder('rem_ack');

    expect(remindersStore.getReminderById('rem_ack')?.status).toBe('acknowledged');
  });

  it('stores the precached audio path', () => {
    insertReminder({ id: 'rem_audio' });

    remindersStore.updatePreCachedAudioPath('rem_audio', '/cache/rem_audio.wav');

    expect(remindersStore.getReminderById('rem_audio')?.preCastAudioPath).toBe(
      '/cache/rem_audio.wav'
    );
  });

  it('soft deletes a reminder so it disappears from every read path', () => {
    insertReminder({ id: 'rem_delete' });

    remindersStore.deleteReminder('rem_delete');

    expect(remindersStore.getReminderById('rem_delete')).toBeNull();
    expect(remindersStore.getAllReminders('user1')).toEqual([]);
    expect(remindersStore.getPendingReminders('user1')).toEqual([]);
    const raw = db.executeSync('SELECT deleted_at FROM reminders WHERE id = ?', ['rem_delete']);
    expect(raw.rows[0].deleted_at).not.toBeNull();
  });

  describe('failure handling', () => {
    const failingQuery = () => {
      jest.spyOn(db, 'executeSync').mockImplementation(() => {
        throw new Error('database is locked');
      });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    };

    it('returns empty lists when reads fail', () => {
      failingQuery();

      expect(remindersStore.getAllReminders('user1')).toEqual([]);
      expect(remindersStore.getPendingReminders('user1')).toEqual([]);
      expect(remindersStore.getUpcomingReminders('user1')).toEqual([]);
      expect(remindersStore.getReminderById('rem_1')).toBeNull();
      expect(console.error).toHaveBeenCalledTimes(4);
    });

    const writePaths: Array<[string, () => void]> = [
      ['insertReminder', () => insertReminder({ id: 'rem_1' })],
      ['updateReminderTriggerAt', () => remindersStore.updateReminderTriggerAt('rem_1', iso(MINUTE))],
      ['updateReminderStatus', () => remindersStore.updateReminderStatus('rem_1', 'missed')],
      ['snoozeReminderAt', () => remindersStore.snoozeReminderAt('rem_1', iso(MINUTE))],
      ['acknowledgeReminder', () => remindersStore.acknowledgeReminder('rem_1')],
      ['updatePreCachedAudioPath', () =>
        remindersStore.updatePreCachedAudioPath('rem_1', '/tmp/a.wav')],
      ['deleteReminder', () => remindersStore.deleteReminder('rem_1')],
    ];

    for (const [name, action] of writePaths) {
      it(`rethrows when ${name} fails so callers know the write was lost`, () => {
        failingQuery();

        expect(action).toThrow('database is locked');
      });
    }
  });
});
