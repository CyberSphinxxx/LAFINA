import { db, DatabaseTransaction } from './database';
import {
  clampSettings,
  DEFAULT_POMODORO_SETTINGS,
  MAX_MINUTES,
  type PomodoroPhase,
  type PomodoroRuntime,
  type PomodoroSettings,
} from './pomodoroEngine';
import { syncOutboxStore } from './syncOutboxStore';
import { POMODORO_SETTINGS_ENTITY_ID, type SyncPayload } from './syncTypes';
import { generateId } from '../utils/id';

export interface PomodoroSessionRow {
  id: string;
  phase: PomodoroPhase;
  /** Empty when the session was run without a label. */
  task: string;
  durationMs: number;
  startedAt: string | null;
  finishedAt: string;
  dayKey: string;
}

const bool = (value: unknown): boolean => value === 1 || value === true || value === '1';
const flag = (value: boolean): number => (value ? 1 : 0);

/** The local calendar day of a timestamp, as YYYY-MM-DD. */
export const localDayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Settings from a stored `pomodoro_settings` row, clamped to the engine's limits. */
export const pomodoroSettingsFromRow = (row: Record<string, unknown>): PomodoroSettings =>
  clampSettings({
    focusMinutes: Number(row.focus_minutes),
    shortBreakMinutes: Number(row.short_break_minutes),
    longBreakMinutes: Number(row.long_break_minutes),
    longBreakInterval: Number(row.long_break_interval),
    autoStartBreaks: bool(row.auto_start_breaks),
    autoStartFocus: bool(row.auto_start_focus),
    soundEnabled: bool(row.sound_enabled),
    volume: Number(row.volume),
    ringSeconds: Number(row.ring_seconds),
    notificationsEnabled: bool(row.notifications_enabled),
    ringSoundUri: row.ring_sound_uri == null ? null : String(row.ring_sound_uri),
    ringSoundName: row.ring_sound_name == null ? null : String(row.ring_sound_name),
  });

/** The settings every device shares. The ring sound is a file on one device, so it stays there. */
export const pomodoroSettingsPayload = (settings: PomodoroSettings): SyncPayload => ({
  focus_minutes: settings.focusMinutes,
  short_break_minutes: settings.shortBreakMinutes,
  long_break_minutes: settings.longBreakMinutes,
  long_break_interval: settings.longBreakInterval,
  auto_start_breaks: settings.autoStartBreaks,
  auto_start_focus: settings.autoStartFocus,
  sound_enabled: settings.soundEnabled,
  volume: settings.volume,
  ring_seconds: settings.ringSeconds,
  notifications_enabled: settings.notificationsEnabled,
});

/** The sync payload for one stored session row. */
export const pomodoroSessionPayload = (row: Record<string, unknown>): SyncPayload => ({
  phase: String(row.phase),
  task: row.task == null ? '' : String(row.task).slice(0, 120),
  duration_ms: Math.max(0, Math.min(MAX_MINUTES * 60_000, Math.round(Number(row.duration_ms) || 0))),
  started_at: row.started_at == null ? null : String(row.started_at),
  finished_at: String(row.finished_at),
});

/**
 * Pomodoro settings, the live timer and the session log.
 *
 * Settings and finished sessions sync, so a focus session on one device
 * counts on the other. The live timer stays on the device running it: two
 * devices ringing for one session would be worse than none.
 */
export const pomodoroStore = {
  getSettings(userId: string): PomodoroSettings {
    try {
      const row = db.executeSync('SELECT * FROM pomodoro_settings WHERE user_id = ?', [userId])
        .rows?.[0];
      if (!row) return { ...DEFAULT_POMODORO_SETTINGS };
      return pomodoroSettingsFromRow(row);
    } catch (error) {
      console.error('Error reading pomodoro settings:', error);
      return { ...DEFAULT_POMODORO_SETTINGS };
    }
  },

  saveSettings(userId: string, raw: PomodoroSettings): PomodoroSettings {
    const settings = clampSettings(raw);
    try {
      db.transactionSync((tx: DatabaseTransaction) => {
        tx.executeSync(
          `INSERT INTO pomodoro_settings (
             user_id, focus_minutes, short_break_minutes, long_break_minutes, long_break_interval,
             auto_start_breaks, auto_start_focus, sound_enabled, volume, ring_seconds,
             notifications_enabled, ring_sound_uri, ring_sound_name, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             focus_minutes = excluded.focus_minutes,
             short_break_minutes = excluded.short_break_minutes,
             long_break_minutes = excluded.long_break_minutes,
             long_break_interval = excluded.long_break_interval,
             auto_start_breaks = excluded.auto_start_breaks,
             auto_start_focus = excluded.auto_start_focus,
             sound_enabled = excluded.sound_enabled,
             volume = excluded.volume,
             ring_seconds = excluded.ring_seconds,
             notifications_enabled = excluded.notifications_enabled,
             ring_sound_uri = excluded.ring_sound_uri,
             ring_sound_name = excluded.ring_sound_name,
             updated_at = excluded.updated_at`,
          [
            userId,
            settings.focusMinutes,
            settings.shortBreakMinutes,
            settings.longBreakMinutes,
            settings.longBreakInterval,
            flag(settings.autoStartBreaks),
            flag(settings.autoStartFocus),
            flag(settings.soundEnabled),
            settings.volume,
            settings.ringSeconds,
            flag(settings.notificationsEnabled),
            settings.ringSoundUri,
            settings.ringSoundName,
            new Date().toISOString(),
          ],
        );
        syncOutboxStore.enqueueMutation(
          userId, 'pomodoro_settings', POMODORO_SETTINGS_ENTITY_ID, 'update',
          pomodoroSettingsPayload(settings), 'account', userId, tx,
        );
      });
    } catch (error) {
      console.error('Error saving pomodoro settings:', error);
    }
    return settings;
  },

  /** The task label attached to the session in progress. */
  getTask(userId: string): string {
    try {
      const row = db.executeSync('SELECT task FROM pomodoro_state WHERE user_id = ?', [userId])
        .rows?.[0];
      return row?.task == null ? '' : String(row.task);
    } catch (error) {
      console.error('Error reading pomodoro task:', error);
      return '';
    }
  },

  saveTask(userId: string, task: string): void {
    try {
      // The row may not exist yet if the timer has never been touched.
      const changed = db.executeSync('UPDATE pomodoro_state SET task = ? WHERE user_id = ?', [
        task || null,
        userId,
      ]);
      if (!changed.rowsAffected) {
        db.executeSync(
          `INSERT OR IGNORE INTO pomodoro_state
             (user_id, phase, is_running, ends_at, remaining_ms, total_ms,
              cycle_position, completed_focus, task, updated_at)
           VALUES (?, 'focus', 0, NULL, 0, 0, 0, 0, ?, ?)`,
          [userId, task || null, new Date().toISOString()],
        );
      }
    } catch (error) {
      console.error('Error saving pomodoro task:', error);
    }
  },

  /** The timer as it stood at the last write, or null if it was never started. */
  getRuntime(userId: string): PomodoroRuntime | null {
    try {
      const row = db.executeSync('SELECT * FROM pomodoro_state WHERE user_id = ?', [userId])
        .rows?.[0];
      if (!row) return null;
      const endsAt = row.ends_at === null || row.ends_at === undefined ? null : Number(row.ends_at);
      return {
        phase: String(row.phase) as PomodoroPhase,
        isRunning: bool(row.is_running),
        endsAt: endsAt !== null && Number.isFinite(endsAt) ? endsAt : null,
        remainingMs: Number(row.remaining_ms) || 0,
        totalMs: Number(row.total_ms) || 0,
        cyclePosition: Number(row.cycle_position) || 0,
        completedFocus: Number(row.completed_focus) || 0,
      };
    } catch (error) {
      console.error('Error reading pomodoro state:', error);
      return null;
    }
  },

  saveRuntime(userId: string, runtime: PomodoroRuntime, task = ''): void {
    try {
      db.executeSync(
        `INSERT INTO pomodoro_state (
           user_id, phase, is_running, ends_at, remaining_ms, total_ms,
           cycle_position, completed_focus, task, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           phase = excluded.phase,
           is_running = excluded.is_running,
           ends_at = excluded.ends_at,
           remaining_ms = excluded.remaining_ms,
           total_ms = excluded.total_ms,
           cycle_position = excluded.cycle_position,
           completed_focus = excluded.completed_focus,
           task = excluded.task,
           updated_at = excluded.updated_at`,
        [
          userId,
          runtime.phase,
          flag(runtime.isRunning),
          runtime.endsAt,
          Math.round(runtime.remainingMs),
          Math.round(runtime.totalMs),
          runtime.cyclePosition,
          runtime.completedFocus,
          task || null,
          new Date().toISOString(),
        ],
      );
    } catch (error) {
      console.error('Error saving pomodoro state:', error);
    }
  },

  /** Records a phase that ran to the end, for the tally and the history. */
  logSession(
    userId: string,
    phase: PomodoroPhase,
    durationMs: number,
    finishedAt: number,
    task = '',
  ): void {
    try {
      const duration = Math.round(durationMs);
      const id = generateId('pomodoro');
      const finishedIso = new Date(finishedAt).toISOString();
      db.transactionSync((tx: DatabaseTransaction) => {
        tx.executeSync(
          `INSERT INTO pomodoro_sessions (
             id, user_id, phase, task, duration_ms, started_at, finished_at, day_key, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            id,
            userId,
            phase,
            task.trim() || null,
            duration,
            // Derived rather than tracked: the phase ran its full length to be logged.
            new Date(finishedAt - duration).toISOString(),
            finishedIso,
            localDayKey(finishedAt),
            finishedIso,
          ],
        );
        const row = tx.executeSync('SELECT * FROM pomodoro_sessions WHERE id = ?', [id]).rows?.[0];
        if (row) {
          syncOutboxStore.enqueueMutation(
            userId, 'pomodoro_session', id, 'create', pomodoroSessionPayload(row), 'account', userId, tx,
          );
        }
      });
    } catch (error) {
      console.error('Error logging pomodoro session:', error);
    }
  },

  /** Most recent sessions first, for the history panel. */
  listSessions(userId: string, limit = 200): PomodoroSessionRow[] {
    try {
      const result = db.executeSync(
        `SELECT id, phase, task, duration_ms, started_at, finished_at, day_key
           FROM pomodoro_sessions
          WHERE user_id = ? AND deleted_at IS NULL
          ORDER BY finished_at DESC, rowid DESC
          LIMIT ?`,
        [userId, Math.max(1, Math.min(1000, Math.round(limit)))],
      );
      return (result.rows ?? []).map((row) => ({
        id: String(row.id),
        phase: String(row.phase) as PomodoroPhase,
        task: row.task == null ? '' : String(row.task),
        durationMs: Number(row.duration_ms) || 0,
        startedAt: row.started_at == null ? null : String(row.started_at),
        finishedAt: String(row.finished_at),
        dayKey: String(row.day_key),
      }));
    } catch (error) {
      console.error('Error reading pomodoro history:', error);
      return [];
    }
  },

  clearHistory(userId: string): void {
    try {
      db.transactionSync((tx: DatabaseTransaction) => {
        const now = new Date().toISOString();
        const live = tx.executeSync(
          'SELECT id FROM pomodoro_sessions WHERE user_id = ? AND deleted_at IS NULL',
          [userId],
        ).rows ?? [];
        tx.executeSync(
          'UPDATE pomodoro_sessions SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND deleted_at IS NULL',
          [now, now, userId],
        );
        live.forEach((row) => {
          syncOutboxStore.enqueueMutation(
            userId, 'pomodoro_session', String(row.id), 'delete', {}, 'account', userId, tx,
          );
        });
      });
    } catch (error) {
      console.error('Error clearing pomodoro history:', error);
    }
  },

  /** Focus sessions finished today, in the user's own timezone. */
  countFocusToday(userId: string, now: number = Date.now()): number {
    try {
      const row = db.executeSync(
        `SELECT COUNT(*) AS total FROM pomodoro_sessions
         WHERE user_id = ? AND phase = 'focus' AND day_key = ? AND deleted_at IS NULL`,
        [userId, localDayKey(now)],
      ).rows?.[0];
      return Number(row?.total) || 0;
    } catch (error) {
      console.error('Error counting pomodoro sessions:', error);
      return 0;
    }
  },

  /** Total focus minutes logged today. */
  focusMinutesToday(userId: string, now: number = Date.now()): number {
    try {
      const row = db.executeSync(
        `SELECT SUM(duration_ms) AS total FROM pomodoro_sessions
         WHERE user_id = ? AND phase = 'focus' AND day_key = ? AND deleted_at IS NULL`,
        [userId, localDayKey(now)],
      ).rows?.[0];
      return Math.round((Number(row?.total) || 0) / 60_000);
    } catch (error) {
      console.error('Error summing pomodoro sessions:', error);
      return 0;
    }
  },
};
