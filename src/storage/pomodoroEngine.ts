/**
 * Pomodoro timing rules, kept free of React, SQLite and the Web Audio API.
 *
 * The timer is driven by an absolute deadline rather than by counting ticks:
 * a background window has its timers throttled, the machine can suspend, and
 * the wall clock can be corrected under us. Every reader derives the remaining
 * time from `Date.now()` instead, so a late or missed tick costs accuracy for
 * one frame rather than losing minutes off the session.
 */

export type PomodoroPhase = 'focus' | 'shortBreak' | 'longBreak';

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Completed focus sessions between long breaks. */
  longBreakInterval: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  soundEnabled: boolean;
  /** 0–1. */
  volume: number;
  /** How long the ringtone keeps ringing if nobody stops it. */
  ringSeconds: number;
  notificationsEnabled: boolean;
  /** `lafina-asset://` URL of an imported sound; null uses the built-in bell. */
  ringSoundUri: string | null;
  /** The imported file's name, so the settings can show what is loaded. */
  ringSoundName: string | null;
}

export interface PomodoroRuntime {
  phase: PomodoroPhase;
  isRunning: boolean;
  /** Wall-clock ms when the phase ends. Null whenever the timer is paused. */
  endsAt: number | null;
  /** Time left when paused; also the seed for the next start. */
  remainingMs: number;
  /**
   * Length this phase was *started* with. Held separately from the settings so
   * editing a duration mid-session cannot stretch or cut the running phase.
   */
  totalMs: number;
  /** Completed focus sessions since the last long break. */
  cyclePosition: number;
  /** Completed focus sessions since the cycle was last reset. */
  completedFocus: number;
}

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;
export const MIN_INTERVAL = 1;
export const MAX_INTERVAL = 12;
export const MIN_RING_SECONDS = 2;
export const MAX_RING_SECONDS = 60;

/**
 * How far past the deadline still counts as "the user was here". Beyond this
 * the machine was almost certainly asleep, so the next phase waits to be
 * started by hand rather than silently burning away while nobody is watching.
 */
export const AWAY_THRESHOLD_MS = 60_000;

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  soundEnabled: true,
  volume: 0.7,
  ringSeconds: 10,
  notificationsEnabled: true,
  ringSoundUri: null,
  ringSoundName: null,
};

/**
 * Numbers only, and never by way of `Number()` on its own: that turns `null`,
 * `undefined` via coercion, `''` and `[]` into 0, which would read a missing
 * volume as silence and a missing duration as the shortest allowed phase.
 */
const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = toNumber(value);
  if (parsed === null) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const clampUnit = (value: unknown, fallback: number): number => {
  const parsed = toNumber(value);
  if (parsed === null) return fallback;
  return Math.min(1, Math.max(0, parsed));
};

/** Only a non-empty string is a usable asset reference. */
const asText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : value === 1 || value === 0 ? value === 1 : fallback;

/**
 * Forces anything read from the database or typed into a field into a usable
 * shape. A zero-minute phase or a zero long-break interval would otherwise
 * complete instantly and spin the cycle forever.
 */
export const clampSettings = (raw: Partial<PomodoroSettings> | null | undefined): PomodoroSettings => {
  const source = raw ?? {};
  const fallback = DEFAULT_POMODORO_SETTINGS;
  return {
    focusMinutes: clampInt(source.focusMinutes, MIN_MINUTES, MAX_MINUTES, fallback.focusMinutes),
    shortBreakMinutes: clampInt(source.shortBreakMinutes, MIN_MINUTES, MAX_MINUTES, fallback.shortBreakMinutes),
    longBreakMinutes: clampInt(source.longBreakMinutes, MIN_MINUTES, MAX_MINUTES, fallback.longBreakMinutes),
    longBreakInterval: clampInt(source.longBreakInterval, MIN_INTERVAL, MAX_INTERVAL, fallback.longBreakInterval),
    autoStartBreaks: asBoolean(source.autoStartBreaks, fallback.autoStartBreaks),
    autoStartFocus: asBoolean(source.autoStartFocus, fallback.autoStartFocus),
    soundEnabled: asBoolean(source.soundEnabled, fallback.soundEnabled),
    volume: clampUnit(source.volume, fallback.volume),
    ringSeconds: clampInt(source.ringSeconds, MIN_RING_SECONDS, MAX_RING_SECONDS, fallback.ringSeconds),
    notificationsEnabled: asBoolean(source.notificationsEnabled, fallback.notificationsEnabled),
    ringSoundUri: asText(source.ringSoundUri),
    // A name without a file is meaningless, so the two travel together.
    ringSoundName: asText(source.ringSoundUri) ? asText(source.ringSoundName) : null,
  };
};

export const phaseDurationMs = (settings: PomodoroSettings, phase: PomodoroPhase): number => {
  const minutes =
    phase === 'focus'
      ? settings.focusMinutes
      : phase === 'shortBreak'
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes;
  return minutes * 60_000;
};

export const PHASE_LABELS: Record<PomodoroPhase, string> = {
  focus: 'Focus',
  shortBreak: 'Short break',
  longBreak: 'Long break',
};

/** A fresh, paused runtime sitting at the start of `phase`. */
export const idleRuntime = (
  settings: PomodoroSettings,
  phase: PomodoroPhase = 'focus',
  carry?: Pick<PomodoroRuntime, 'cyclePosition' | 'completedFocus'>,
): PomodoroRuntime => {
  const total = phaseDurationMs(settings, phase);
  return {
    phase,
    isRunning: false,
    endsAt: null,
    remainingMs: total,
    totalMs: total,
    cyclePosition: carry?.cyclePosition ?? 0,
    completedFocus: carry?.completedFocus ?? 0,
  };
};

/**
 * Time left on the clock. Clamped to the phase length at the top so a clock
 * correction that moves time backwards cannot inflate the timer, and to zero
 * at the bottom so an overshoot never renders as a negative countdown.
 */
export const remainingMs = (runtime: PomodoroRuntime, now: number): number => {
  const ceiling = Math.max(0, runtime.totalMs);
  const raw =
    runtime.isRunning && runtime.endsAt !== null ? runtime.endsAt - now : runtime.remainingMs;
  return Math.min(ceiling, Math.max(0, raw));
};

/**
 * Re-points a *paused* runtime at freshly edited durations. A running phase is
 * left alone: shortening the focus length mid-session should apply from the
 * next session, not end the one in progress.
 */
export const applySettingsToRuntime = (
  settings: PomodoroSettings,
  runtime: PomodoroRuntime,
): PomodoroRuntime => {
  if (runtime.isRunning) return runtime;
  const total = phaseDurationMs(settings, runtime.phase);
  // An untouched phase adopts the new length outright; a partly-spent one only
  // gets clamped, so pausing at 20:00 and setting 10 minutes leaves 10:00.
  const untouched = runtime.remainingMs >= runtime.totalMs;
  return {
    ...runtime,
    totalMs: total,
    remainingMs: untouched ? total : Math.min(runtime.remainingMs, total),
  };
};

/**
 * What follows the current phase. A focus session only advances the cycle when
 * it was actually seen through — skipping one must not earn a long break.
 */
export const nextPhaseAfter = (
  settings: PomodoroSettings,
  runtime: PomodoroRuntime,
  counted: boolean,
): { phase: PomodoroPhase; cyclePosition: number } => {
  if (runtime.phase !== 'focus') {
    return { phase: 'focus', cyclePosition: runtime.cyclePosition };
  }
  if (!counted) return { phase: 'shortBreak', cyclePosition: runtime.cyclePosition };
  const position = runtime.cyclePosition + 1;
  const isLong = position >= settings.longBreakInterval;
  return { phase: isLong ? 'longBreak' : 'shortBreak', cyclePosition: isLong ? 0 : position };
};

export interface PhaseCompletion {
  runtime: PomodoroRuntime;
  /** The phase that just ended. */
  finished: PomodoroPhase;
  /** True when a focus session ran to the end, so it counts towards the cycle. */
  counted: boolean;
  /** Whether the next phase started on its own. */
  autoStarted: boolean;
  /** How far past the deadline this was noticed. */
  overshootMs: number;
}

/**
 * Ends the current phase and sets up the next one. Called both when the clock
 * runs out and when the user skips ahead.
 */
export const completePhase = (
  settings: PomodoroSettings,
  runtime: PomodoroRuntime,
  now: number,
  options: { skipped?: boolean } = {},
): PhaseCompletion => {
  const skipped = options.skipped ?? false;
  const counted = !skipped && runtime.phase === 'focus';
  const { phase, cyclePosition } = nextPhaseAfter(settings, runtime, counted);
  const total = phaseDurationMs(settings, phase);
  const overshootMs =
    runtime.endsAt === null || skipped ? 0 : Math.max(0, now - runtime.endsAt);

  const wantsAuto = phase === 'focus' ? settings.autoStartFocus : settings.autoStartBreaks;
  // Skipping is a deliberate stop, and a deadline missed by a long way means
  // the machine was asleep — neither should silently launch the next phase.
  const autoStarted = !skipped && wantsAuto && overshootMs <= AWAY_THRESHOLD_MS;

  return {
    finished: runtime.phase,
    counted,
    overshootMs,
    autoStarted,
    runtime: {
      phase,
      cyclePosition,
      completedFocus: runtime.completedFocus + (counted ? 1 : 0),
      totalMs: total,
      remainingMs: total,
      isRunning: autoStarted,
      endsAt: autoStarted ? now + total : null,
    },
  };
};

export const startRuntime = (runtime: PomodoroRuntime, now: number): PomodoroRuntime => {
  if (runtime.isRunning) return runtime;
  // Starting a spent phase restarts it rather than completing instantly.
  const remaining = runtime.remainingMs > 0 ? runtime.remainingMs : runtime.totalMs;
  return { ...runtime, isRunning: true, remainingMs: remaining, endsAt: now + remaining };
};

export const pauseRuntime = (runtime: PomodoroRuntime, now: number): PomodoroRuntime => {
  if (!runtime.isRunning) return runtime;
  return {
    ...runtime,
    isRunning: false,
    endsAt: null,
    remainingMs: remainingMs(runtime, now),
  };
};

/** Puts the current phase back to full, still paused. */
export const resetRuntime = (
  settings: PomodoroSettings,
  runtime: PomodoroRuntime,
): PomodoroRuntime =>
  idleRuntime(settings, runtime.phase, {
    cyclePosition: runtime.cyclePosition,
    completedFocus: runtime.completedFocus,
  });

/** Drops back to the first focus session and clears the counters. */
export const resetCycle = (settings: PomodoroSettings): PomodoroRuntime =>
  idleRuntime(settings, 'focus');

/** Jumps straight to a phase, paused, without counting anything. */
export const switchPhase = (
  settings: PomodoroSettings,
  runtime: PomodoroRuntime,
  phase: PomodoroPhase,
): PomodoroRuntime =>
  idleRuntime(settings, phase, {
    cyclePosition: runtime.cyclePosition,
    completedFocus: runtime.completedFocus,
  });

export interface RestoredRuntime {
  runtime: PomodoroRuntime;
  /** Set when a phase ran out while the app was closed. */
  missed: PomodoroPhase | null;
}

/**
 * Rebuilds the timer from whatever was persisted last time.
 *
 * A session that expired while the app was shut is credited but never rung for
 * — a bell for something that finished hours ago is noise — and the next phase
 * waits, paused, so reopening the app does not start a break nobody asked for.
 */
export const restoreRuntime = (
  settings: PomodoroSettings,
  stored: PomodoroRuntime | null,
  now: number,
): RestoredRuntime => {
  if (!stored) return { runtime: idleRuntime(settings), missed: null };

  if (!stored.isRunning || stored.endsAt === null) {
    return { runtime: applySettingsToRuntime(settings, stored), missed: null };
  }

  if (now < stored.endsAt) return { runtime: stored, missed: null };

  const completion = completePhase(settings, stored, now);
  return {
    runtime: {
      ...completion.runtime,
      isRunning: false,
      endsAt: null,
      remainingMs: completion.runtime.totalMs,
    },
    missed: completion.finished,
  };
};

/**
 * Minutes covered by one full turn of the dial.
 *
 * Longer phases are still reachable by typing a value in settings; spreading
 * the whole 1–180 range around the ring would make a default 25-minute session
 * a thin sliver and put every useful length within a few degrees of the next.
 */
export const DIAL_SWEEP_MINUTES = 60;

/** Degrees clockwise from twelve o'clock for a duration on the dial. */
export const minutesToAngle = (minutes: number): number =>
  (Math.min(DIAL_SWEEP_MINUTES, Math.max(0, minutes)) / DIAL_SWEEP_MINUTES) * 360;

/**
 * Turns a pointer offset from the dial centre into whole minutes.
 *
 * `previous` is where the drag currently sits. Without it, dragging up past
 * twelve o'clock would snap 59 minutes round to 1 (and back again) as the angle
 * wraps; comparing against the last value instead pins the drag at whichever
 * end it ran into, which is how a real dial behaves.
 */
export const pointToMinutes = (dx: number, dy: number, previous: number): number => {
  // Screen y grows downwards, so it is negated to put 0 at the top.
  const degrees = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const raw = Math.round((degrees / 360) * DIAL_SWEEP_MINUTES);
  const half = DIAL_SWEEP_MINUTES / 2;
  if (previous - raw > half) return DIAL_SWEEP_MINUTES;
  if (raw - previous > half) return MIN_MINUTES;
  return Math.min(DIAL_SWEEP_MINUTES, Math.max(MIN_MINUTES, raw));
};

/** `mm:ss`, or `h:mm:ss` once a phase is an hour or longer. */
export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};
