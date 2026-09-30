import { NativeModules, Vibration } from 'react-native';

/**
 * Alerts for app timers such as the Pomodoro.
 *
 * While LAFINA is in front, the timer rings through the device ringtone for
 * the configured number of seconds. For the background — screen off, another
 * app open, LAFINA closed — an exact Android alarm posts a notification at the
 * phase's deadline. The native side skips that notification while the app is
 * in front, so a phase never alerts twice.
 */

interface TimerAlarmOptions {
  id: string;
  triggerAtMs: number;
  title: string;
  body: string;
}

interface LafinaTimerNativeModule {
  scheduleTimerAlarm?: (options: TimerAlarmOptions) => Promise<boolean>;
  cancelTimerAlarm?: (id: string) => Promise<boolean>;
  startRingtone?: () => Promise<boolean>;
  stopRingtone?: () => Promise<boolean>;
}

const nativeModule = (): LafinaTimerNativeModule =>
  (NativeModules.LafinaReminder as LafinaTimerNativeModule | undefined) ?? {};

const RING_VIBRATION = [0, 500, 300, 500];

let ringTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedules (or replaces) the background alert for one timer. */
export const scheduleTimerAlarm = async (options: TimerAlarmOptions): Promise<void> => {
  if (options.triggerAtMs <= Date.now()) return;
  try {
    await nativeModule().scheduleTimerAlarm?.(options);
  } catch (error) {
    console.warn('[TimerAlarm] Could not schedule the timer alarm:', error);
  }
};

/** Cancels a timer's background alert and removes one already shown. */
export const cancelTimerAlarm = async (id: string): Promise<void> => {
  try {
    await nativeModule().cancelTimerAlarm?.(id);
  } catch (error) {
    console.warn('[TimerAlarm] Could not cancel the timer alarm:', error);
  }
};

/** Stops an in-app ring early. */
export const stopTimerRing = (): void => {
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
  Vibration.cancel();
  nativeModule().stopRingtone?.().catch(() => undefined);
};

/** Rings in the app for `seconds`, with a vibration, unless `sound` is off. */
export const startTimerRing = (seconds: number, sound = true): void => {
  stopTimerRing();
  Vibration.vibrate(RING_VIBRATION);
  if (!sound) return;
  nativeModule().startRingtone?.().catch(() => undefined);
  ringTimer = setTimeout(() => {
    ringTimer = null;
    nativeModule().stopRingtone?.().catch(() => undefined);
  }, Math.max(1, seconds) * 1000);
};
