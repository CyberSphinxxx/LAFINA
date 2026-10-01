import { DeviceEventEmitter, NativeModules } from 'react-native';
import { remindersStore, businessTasksStore } from '../storage';
import { getReminderPreferences } from './userPreferences';
import { autoSnoozeReminderAction } from './reminderActions';

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let activeUserId: string | null = null;
let isChecking = false;

const POLL_INTERVAL_MS = 15_000;
/** A reminder may ring up to 30 seconds early so the call is ready on the minute. */
const TRIGGER_LEAD_MS = 30 * 1000;
/**
 * A reminder left in `triggered` this long after its own trigger time cannot belong
 * to a live call: the JS session state dies with the process, so a freshly booted
 * app can always recover it. The window keeps a warm restart (which still holds the
 * live session in memory) from rearming a call the student is currently answering.
 */
const ORPHANED_CALL_GRACE_MS = 60 * 1000;

/**
 * True when Android's exact-alarm bridge is linked in this build.
 *
 * When it is present the native `AlarmManager` alarms are the single source of
 * truth for reminder delivery: they fire while the app is closed, they own the
 * full-screen call intent, and they hold the audio-focus contract. A JavaScript
 * interval polling the same rows on top of them would double-ring a reminder and
 * race the native call for the microphone.
 */
const hasNativeAlarmScheduler = (): boolean => {
  const reminderModule = NativeModules.LafinaReminder as
    | { scheduleExactAlarm?: unknown }
    | undefined;
  return typeof reminderModule?.scheduleExactAlarm === 'function';
};

/**
 * Reconciles reminder alarms for assigned business tasks.
 * Only schedules reminders for active employee assignments on the assigned employee's device.
 */
export const reconcileBusinessAssignmentReminders = (
  userId: string,
  businessId: string
): void => {
  try {
    const assigned = businessTasksStore.getAssignedTasksForEmployee(businessId, userId);
    for (const { task, assignment } of assigned) {
      const isEnded =
        task.is_cancelled === 1 ||
        assignment.status === 'completed' ||
        task.deleted_at !== null ||
        assignment.deleted_at !== null;

      if (isEnded || !task.due_date) {
        // Cancel/delete reminder if exists
        const existing = remindersStore.getReminderById(assignment.id);
        if (existing && !existing.deletedAt) {
          remindersStore.deleteReminder(assignment.id);
        }
        continue;
      }

      // Calculate trigger time = due_date - lead_minutes
      const dueMillis = new Date(task.due_date).getTime();
      if (Number.isNaN(dueMillis)) continue;

      const userPrefs = getReminderPreferences(userId);
      const effectiveLead = typeof task.reminder_lead_minutes === 'number'
        ? task.reminder_lead_minutes
        : userPrefs.leadTimeMinutes;
      const leadMillis = effectiveLead * 60 * 1000;
      const triggerMillis = dueMillis - leadMillis;
      const triggerAt = new Date(triggerMillis).toISOString();

      const existing = remindersStore.getReminderById(assignment.id);
      if (!existing) {
        remindersStore.insertReminder({
          id: assignment.id,
          userId,
          task: task.title,
          description: task.instructions || null,
          scheduledAt: task.due_date,
          triggerAt,
          status: 'pending',
          preCastAudioPath: null,
        });
      } else if (
        existing.triggerAt !== triggerAt ||
        existing.task !== task.title ||
        existing.scheduledAt !== task.due_date
      ) {
        remindersStore.deleteReminder(assignment.id);
        remindersStore.insertReminder({
          id: assignment.id,
          userId,
          task: task.title,
          description: task.instructions || null,
          scheduledAt: task.due_date,
          triggerAt,
          status: 'pending',
          preCastAudioPath: null,
        });
      }
    }
  } catch (error) {
    console.error('[Scheduler] Failed to reconcile business assignment reminders:', error);
  }
};

/**
 * Checks for due reminders and dispatches the call trigger if any are found.
 * Compares triggerAt with the current time (checks if triggerAt is <= current time).
 */
export const checkAndTriggerReminders = async (userId: string): Promise<void> => {
  // The 15s poll can still be running when the next tick fires (or when a manual
  // check overlaps it). Two passes racing on the same row would both read it as
  // pending and both emit a call trigger, so only one pass may run at a time.
  if (isChecking) return;
  isChecking = true;

  try {
    // Look for reminders due in the next 1 minute (and also past due if missed)
    const upcoming = remindersStore.getUpcomingReminders(userId, 1);
    const now = Date.now();

    for (const reminder of upcoming) {
      const triggerTime = new Date(reminder.triggerAt).getTime();

      // Only trigger if triggerTime has passed or is within the lead window
      if (triggerTime <= now + TRIGGER_LEAD_MS) {
        console.log(
          `[Scheduler] Triggering reminder: ${reminder.id} - ${reminder.task}`,
        );

        try {
          // 1. Mark status as triggered immediately to avoid double-triggers
          remindersStore.updateReminderStatus(reminder.id, 'triggered');

          // 2. Emit call event for UI and Call Dispatcher
          DeviceEventEmitter.emit('LAFINA_CALL_TRIGGER', {
            reminderId: reminder.id,
            task: reminder.task,
            audioPath: reminder.preCastAudioPath,
          });
        } catch (error) {
          // One unwritable row must not hide every other reminder that is due.
          console.error(
            `[Scheduler] Could not trigger reminder ${reminder.id}:`,
            error,
          );
        }
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error checking reminders:', error);
  } finally {
    isChecking = false;
  }
};

/**
 * Rearms reminder calls that were interrupted by a process death.
 *
 * Android's low-memory killer can end the process while a simulated call is
 * ringing or in conversation. Nothing writes a terminal status on the way down,
 * so the row stays `triggered` forever and is excluded from every future trigger
 * query. Recovery hands each orphaned reminder back through the same automatic
 * snooze policy a missed call would use, which either reschedules it inside the
 * auto-snooze window or marks it missed once the snooze limit is reached.
 *
 * @param userId Owner of the reminders to recover.
 * @returns How many orphaned reminders were handed back to the scheduler.
 */
export const recoverOrphanedReminderCalls = async (
  userId: string,
): Promise<number> => {
  const now = Date.now();
  let recovered = 0;

  for (const reminder of remindersStore.getAllReminders(userId)) {
    if (reminder.status !== 'triggered') continue;
    const triggerTime = new Date(reminder.triggerAt).getTime();
    if (!Number.isFinite(triggerTime)) continue;
    if (now - triggerTime < ORPHANED_CALL_GRACE_MS) continue;

    try {
      const action = await autoSnoozeReminderAction(reminder.id, userId);
      if (action.ok) {
        recovered += 1;
        console.warn(
          `[Scheduler] Recovered interrupted reminder call ${reminder.id} as ${action.outcome}.`,
        );
      } else {
        // Alarm scheduling can be refused (access revoked mid-session). Keep the
        // row for the next launch instead of losing the reminder outright.
        console.warn(
          `[Scheduler] Could not recover reminder call ${reminder.id}: ${action.message}`,
        );
      }
    } catch (error) {
      console.error(
        `[Scheduler] Recovery failed for reminder ${reminder.id}:`,
        error,
      );
    }
  }

  return recovered;
};

/**
 * Starts the foreground scheduler daemon polling loop (checks every 15 seconds).
 */
export const startSchedulerDaemon = (userId: string): void => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }

  activeUserId = userId;
  console.log(`[Scheduler] Daemon started for user ${userId}`);

  // Run immediately on start, recovering anything the previous process left behind.
  void recoverOrphanedReminderCalls(userId).catch((error: unknown) => {
    console.error('[Scheduler] Orphaned call recovery failed:', error);
  });

  if (hasNativeAlarmScheduler()) {
    console.log(
      '[Scheduler] Native exact alarms are active; the JavaScript poller stays disabled.',
    );
    return;
  }

  void checkAndTriggerReminders(userId);

  // Poll every 15 seconds
  pollingInterval = setInterval(() => {
    if (activeUserId) {
      void checkAndTriggerReminders(activeUserId);
    }
  }, POLL_INTERVAL_MS);
};

/**
 * Stops the scheduler daemon polling loop.
 */
export const stopSchedulerDaemon = (): void => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[Scheduler] Daemon stopped');
  }
  activeUserId = null;
};
