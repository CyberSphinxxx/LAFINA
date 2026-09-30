import { DeviceEventEmitter } from 'react-native';
import { remindersStore, businessTasksStore } from '../storage';
import { getReminderPreferences } from './userPreferences';

let pollingInterval: any = null;
let activeUserId: string | null = null;

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
  try {
    // Look for reminders due in the next 1 minute (and also past due if missed)
    const upcoming = remindersStore.getUpcomingReminders(userId, 1);
    const now = new Date();

    for (const reminder of upcoming) {
      const triggerTime = new Date(reminder.triggerAt);
      
      // Only trigger if triggerTime has passed or is within 30s
      if (triggerTime.getTime() <= now.getTime() + 30 * 1000) {
        console.log(`[Scheduler] Triggering reminder: ${reminder.id} - ${reminder.task}`);
        
        // 1. Mark status as triggered immediately to avoid double-triggers
        remindersStore.updateReminderStatus(reminder.id, 'triggered');

        // 2. Emit call event for UI and Call Dispatcher
        DeviceEventEmitter.emit('LAFINA_CALL_TRIGGER', {
          reminderId: reminder.id,
          task: reminder.task,
          audioPath: reminder.preCastAudioPath,
        });
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error checking reminders:', error);
  }
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

  // Run immediately on start
  checkAndTriggerReminders(userId);

  // Poll every 15 seconds
  pollingInterval = setInterval(() => {
    if (activeUserId) {
      checkAndTriggerReminders(activeUserId);
    }
  }, 15000);
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
