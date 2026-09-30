import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import {
  applySettingsToRuntime,
  completePhase,
  DEFAULT_POMODORO_SETTINGS,
  idleRuntime,
  pauseRuntime,
  PHASE_LABELS,
  pomodoroStore,
  remainingMs as remainingMsOf,
  resetCycle,
  resetRuntime,
  restoreRuntime,
  startRuntime,
  switchPhase,
} from '../../storage';
import type {
  PomodoroPhase,
  PomodoroRuntime,
  PomodoroSessionRow,
  PomodoroSettings,
} from '../../storage';
import {
  cancelTimerAlarm,
  scheduleTimerAlarm,
  startTimerRing,
  stopTimerRing,
} from '../../scheduler';

/** Fast enough that the seconds digit never visibly stalls. */
const TICK_MS = 250;
/** One alarm slot for the Pomodoro; rescheduling replaces it. */
const ALARM_ID = 'pomodoro';

interface PomodoroContextValue {
  settings: PomodoroSettings;
  runtime: PomodoroRuntime;
  /** Recomputed every tick from the deadline, not accumulated. */
  remainingMs: number;
  isRinging: boolean;
  focusToday: number;
  focusMinutesToday: number;
  /** What the current session is for; logged with it when it completes. */
  task: string;
  setTask: (task: string) => void;
  history: PomodoroSessionRow[];
  refreshHistory: () => void;
  clearHistory: () => void;
  /** Set when a phase ran out while the app was closed. */
  missedPhase: PomodoroPhase | null;
  start: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  skip: () => void;
  resetAll: () => void;
  selectPhase: (phase: PomodoroPhase) => void;
  saveSettings: (next: PomodoroSettings) => void;
  silence: () => void;
  previewSound: () => void;
  dismissMissed: () => void;
}

const PomodoroContext = createContext<PomodoroContextValue | undefined>(undefined);

const nextPhaseLine = (next: PomodoroPhase): string =>
  next === 'focus' ? 'Break over — back to it.' : `Time for a ${PHASE_LABELS[next].toLowerCase()}.`;

/**
 * Owns the running timer for the whole app.
 *
 * It lives above the screens on purpose: a pomodoro has to keep counting while
 * the user is in Calendar or Notes, and the app shell mounts one screen at a
 * time. The timer is a deadline, not a tick counter, so it survives the app
 * being backgrounded or closed; an exact alarm covers the moment it ends.
 *
 * `syncRevision` changes when a sync pass brought in changes from another
 * device, so settings and today's tally follow what was done there.
 */
export const PomodoroProvider: React.FC<{
  userId: string | null;
  syncRevision?: number;
  children: React.ReactNode;
}> = ({ userId, syncRevision = 0, children }) => {
  const [settings, setSettings] = useState<PomodoroSettings>(DEFAULT_POMODORO_SETTINGS);
  const [runtime, setRuntime] = useState<PomodoroRuntime>(() =>
    idleRuntime(DEFAULT_POMODORO_SETTINGS)
  );
  const [remaining, setRemaining] = useState<number>(() =>
    remainingMsOf(idleRuntime(DEFAULT_POMODORO_SETTINGS), Date.now())
  );
  const [ringing, setRinging] = useState(false);
  const [missedPhase, setMissedPhase] = useState<PomodoroPhase | null>(null);
  const [stats, setStats] = useState({ sessions: 0, minutes: 0 });
  const [task, setTaskState] = useState('');
  const [history, setHistory] = useState<PomodoroSessionRow[]>([]);

  // Read inside the tick without making the interval depend on them.
  const settingsRef = useRef(settings);
  const runtimeRef = useRef(runtime);
  const userIdRef = useRef(userId);
  const taskRef = useRef(task);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  settingsRef.current = settings;
  runtimeRef.current = runtime;
  userIdRef.current = userId;
  taskRef.current = task;

  const refreshStats = useCallback((id: string | null) => {
    if (!id) {
      setStats({ sessions: 0, minutes: 0 });
      return;
    }
    setStats({
      sessions: pomodoroStore.countFocusToday(id),
      minutes: pomodoroStore.focusMinutesToday(id),
    });
  }, []);

  /** Points the background alert at the running phase's deadline, or clears it. */
  const syncAlarm = useCallback((next: PomodoroRuntime) => {
    const current = settingsRef.current;
    const alerts = current.notificationsEnabled || current.soundEnabled;
    if (!next.isRunning || next.endsAt === null || !alerts) {
      void cancelTimerAlarm(ALARM_ID);
      return;
    }
    const label = taskRef.current.trim();
    const upcoming = completePhase(current, next, next.endsAt).runtime.phase;
    void scheduleTimerAlarm({
      id: ALARM_ID,
      triggerAtMs: next.endsAt,
      title: label
        ? `${PHASE_LABELS[next.phase]} complete — ${label}`
        : `${PHASE_LABELS[next.phase]} complete`,
      body: nextPhaseLine(upcoming),
    });
  }, []);

  const persist = useCallback((next: PomodoroRuntime) => {
    const id = userIdRef.current;
    if (id) pomodoroStore.saveRuntime(id, next, taskRef.current);
  }, []);

  const refreshHistory = useCallback(() => {
    const id = userIdRef.current;
    setHistory(id ? pomodoroStore.listSessions(id) : []);
  }, []);

  /** Applies a runtime change everywhere: state, the ref, the database and the alarm. */
  const commit = useCallback(
    (next: PomodoroRuntime) => {
      runtimeRef.current = next;
      setRuntime(next);
      setRemaining(remainingMsOf(next, Date.now()));
      persist(next);
      syncAlarm(next);
    },
    [persist, syncAlarm]
  );

  const silence = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    stopTimerRing();
    setRinging(false);
  }, []);

  // Load this user's settings and pick up a session left running.
  useEffect(() => {
    silence();
    setMissedPhase(null);

    if (!userId) {
      const fresh = DEFAULT_POMODORO_SETTINGS;
      setSettings(fresh);
      runtimeRef.current = idleRuntime(fresh);
      setRuntime(runtimeRef.current);
      setRemaining(runtimeRef.current.remainingMs);
      setStats({ sessions: 0, minutes: 0 });
      taskRef.current = '';
      setTaskState('');
      setHistory([]);
      return;
    }

    const stored = pomodoroStore.getSettings(userId);
    const storedTask = pomodoroStore.getTask(userId);
    const restored = restoreRuntime(stored, pomodoroStore.getRuntime(userId), Date.now());
    setSettings(stored);
    settingsRef.current = stored;
    taskRef.current = storedTask;
    setTaskState(storedTask);
    runtimeRef.current = restored.runtime;
    setRuntime(restored.runtime);
    setRemaining(remainingMsOf(restored.runtime, Date.now()));
    setMissedPhase(restored.missed);
    // A phase that expired while the app was shut is still worth crediting.
    if (restored.missed === 'focus') {
      pomodoroStore.logSession(userId, 'focus', restored.runtime.totalMs, Date.now(), storedTask);
    }
    pomodoroStore.saveRuntime(userId, restored.runtime, storedTask);
    syncAlarm(restored.runtime);
    refreshStats(userId);
    setHistory(pomodoroStore.listSessions(userId));
  }, [userId, refreshStats, silence, syncAlarm]);

  // Settings and finished sessions from another device. A phase already
  // running keeps its length; only a paused or idle timer takes the new one.
  useEffect(() => {
    const id = userIdRef.current;
    if (!id || syncRevision === 0) return;
    const stored = pomodoroStore.getSettings(id);
    setSettings(stored);
    settingsRef.current = stored;
    commit(applySettingsToRuntime(stored, runtimeRef.current));
    refreshStats(id);
    setHistory(pomodoroStore.listSessions(id));
  }, [syncRevision, commit, refreshStats]);

  const announce = useCallback(() => {
    const current = settingsRef.current;
    if (!current.soundEnabled && !current.notificationsEnabled) return;
    startTimerRing(current.ringSeconds, current.soundEnabled);
    setRinging(true);
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    ringTimerRef.current = setTimeout(() => {
      ringTimerRef.current = null;
      setRinging(false);
    }, current.ringSeconds * 1000 + 300);
  }, []);

  /** Ends the phase whose clock ran out and moves on. */
  const finishPhase = useCallback(
    (now: number) => {
      const current = settingsRef.current;
      const before = runtimeRef.current;
      const completion = completePhase(current, before, now);
      commit(completion.runtime);

      const id = userIdRef.current;
      if (id && completion.counted) {
        pomodoroStore.logSession(id, before.phase, before.totalMs, now, taskRef.current);
        refreshStats(id);
        setHistory(pomodoroStore.listSessions(id));
      }
      // Only ring for a deadline reached while watching; a long-missed one
      // was already announced by the notification.
      if (completion.overshootMs < 60_000) announce();
    },
    [announce, commit, refreshStats]
  );

  // One interval for the life of the provider; it reads the refs each tick.
  useEffect(() => {
    const tick = (): void => {
      const current = runtimeRef.current;
      if (!current.isRunning) return;
      const now = Date.now();
      const left = remainingMsOf(current, now);
      setRemaining(left);
      if (left <= 0) finishPhase(now);
    };
    const handle = setInterval(tick, TICK_MS);
    // Coming back to the app gets its first check immediately.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(handle);
      subscription.remove();
    };
  }, [finishPhase]);

  useEffect(() => () => stopTimerRing(), []);

  const start = useCallback(() => {
    setMissedPhase(null);
    commit(startRuntime(runtimeRef.current, Date.now()));
  }, [commit]);

  const pause = useCallback(() => {
    commit(pauseRuntime(runtimeRef.current, Date.now()));
  }, [commit]);

  const toggle = useCallback(() => {
    if (runtimeRef.current.isRunning) pause();
    else start();
  }, [pause, start]);

  const reset = useCallback(() => {
    silence();
    commit(resetRuntime(settingsRef.current, runtimeRef.current));
  }, [commit, silence]);

  const skip = useCallback(() => {
    silence();
    setMissedPhase(null);
    // Skipping is silent and earns nothing towards the long break.
    commit(
      completePhase(settingsRef.current, runtimeRef.current, Date.now(), { skipped: true }).runtime
    );
  }, [commit, silence]);

  const resetAll = useCallback(() => {
    silence();
    setMissedPhase(null);
    commit(resetCycle(settingsRef.current));
  }, [commit, silence]);

  const selectPhase = useCallback(
    (phase: PomodoroPhase) => {
      silence();
      commit(switchPhase(settingsRef.current, runtimeRef.current, phase));
    },
    [commit, silence]
  );

  const saveSettings = useCallback(
    (next: PomodoroSettings) => {
      const id = userIdRef.current;
      const saved = id ? pomodoroStore.saveSettings(id, next) : next;
      setSettings(saved);
      settingsRef.current = saved;
      // Only a paused timer is re-pointed; a live phase keeps its own length.
      commit(applySettingsToRuntime(saved, runtimeRef.current));
    },
    [commit]
  );

  const previewSound = useCallback(() => {
    // Short preview: the point is the tone, not the full cadence.
    startTimerRing(Math.min(settingsRef.current.ringSeconds, 3));
  }, []);

  const setTask = useCallback((next: string) => {
    taskRef.current = next;
    setTaskState(next);
    const id = userIdRef.current;
    if (id) pomodoroStore.saveTask(id, next);
  }, []);

  const clearHistory = useCallback(() => {
    const id = userIdRef.current;
    if (!id) return;
    pomodoroStore.clearHistory(id);
    setHistory([]);
    refreshStats(id);
  }, [refreshStats]);

  const dismissMissed = useCallback(() => setMissedPhase(null), []);

  const value = useMemo<PomodoroContextValue>(
    () => ({
      settings,
      runtime,
      remainingMs: remaining,
      isRinging: ringing,
      focusToday: stats.sessions,
      focusMinutesToday: stats.minutes,
      task,
      setTask,
      history,
      refreshHistory,
      clearHistory,
      missedPhase,
      start,
      pause,
      toggle,
      reset,
      skip,
      resetAll,
      selectPhase,
      saveSettings,
      silence,
      previewSound,
      dismissMissed,
    }),
    [
      settings, runtime, remaining, ringing, stats, missedPhase,
      task, setTask, history, refreshHistory, clearHistory,
      start, pause, toggle, reset, skip, resetAll, selectPhase, saveSettings,
      silence, previewSound, dismissMissed,
    ]
  );

  return <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>;
};

export const usePomodoro = (): PomodoroContextValue => {
  const ctx = useContext(PomodoroContext);
  if (!ctx) throw new Error('usePomodoro must be used within a PomodoroProvider');
  return ctx;
};

/** The running timer, or null outside a provider — for chrome such as the tab bar. */
export const useOptionalPomodoro = (): PomodoroContextValue | null =>
  useContext(PomodoroContext) ?? null;
