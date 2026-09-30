/**
 * Runs sync passes between the explicit ones (startup, sign-in, returning to
 * the app): shortly after a local change is queued, and on a slow interval
 * while the app is in front. Platform wiring — window focus and `online`
 * events on desktop, AppState and NetInfo on mobile — stays in the app.
 *
 * Keep this file identical in LAFINA mobile (`src/sync/syncScheduler.ts`) and
 * LAFINA desktop (`src/renderer/src/sync/syncScheduler.ts`).
 */

export interface SyncSchedulerOptions {
  /** Runs one pass and resolves to whether it applied changes made elsewhere. */
  runPass: () => Promise<boolean>;
  /** Called after a pass that applied changes made elsewhere. */
  onRemoteChanges: () => void;
  /** Quiet period after a local change before pushing it. */
  debounceMs?: number;
  /** Interval between background passes while running. */
  intervalMs?: number;
}

export interface SyncScheduler {
  /** Asks for a pass soon, collapsing bursts of changes into one. */
  schedule: () => void;
  /** Runs a pass now, cancelling any scheduled one. */
  runNow: () => Promise<void>;
  /** Starts the background interval (the app came to the front). */
  start: () => void;
  /**
   * Stops the background interval (the app went to the back). A pass already
   * scheduled for a local change still runs, so the change isn't held back.
   */
  stop: () => void;
  /** Stops everything, for teardown. */
  dispose: () => void;
}

export const DEFAULT_SYNC_DEBOUNCE_MS = 3000;
export const DEFAULT_SYNC_INTERVAL_MS = 2 * 60 * 1000;

export const createSyncScheduler = (options: SyncSchedulerOptions): SyncScheduler => {
  const debounceMs = options.debounceMs ?? DEFAULT_SYNC_DEBOUNCE_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  const clearDebounce = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const stopInterval = (): void => {
    if (intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  };

  const runNow = async (): Promise<void> => {
    clearDebounce();
    try {
      if (await options.runPass()) options.onRemoteChanges();
    } catch {
      // The sync worker records its own failures in the sync state.
    }
  };

  return {
    schedule: () => {
      clearDebounce();
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void runNow();
      }, debounceMs);
    },
    runNow,
    start: () => {
      if (intervalTimer !== null) return;
      intervalTimer = setInterval(() => {
        void runNow();
      }, intervalMs);
    },
    stop: stopInterval,
    dispose: () => {
      clearDebounce();
      stopInterval();
    },
  };
};
