import {
  DEFAULT_BUSIEST_DAY,
  DEFAULT_CLASS_COUNT,
  DEFAULT_LONGEST_GAP,
  DEFAULT_REMINDER_LEAD,
  DEFAULT_SLEEP_TIME,
  DEFAULT_SNOOZE_TENDENCY,
  DEFAULT_STUDY_PEAK_HOURS,
  DEFAULT_WAKE_TIME,
} from '../constants';
import { db, DatabaseTransaction } from './database';
import { SyncPayload } from './syncTypes';

/** Builds the complete backend profile payload using stored values and safe defaults. */
export const buildProfileSyncPayload = (
  localUserId: string,
  executor: DatabaseTransaction = db,
): SyncPayload => {
  const user = executor.executeSync(
    `SELECT username, time_format_24h, week_starts_monday, dark_mode
     FROM users WHERE id = ?`,
    [localUserId],
  ).rows?.[0];
  const preferences = executor.executeSync(
    `SELECT wake_time, sleep_time, study_peak_hours, busiest_day,
            reminder_lead_minutes, snooze_tendency, weekly_class_count,
            longest_class_gap
     FROM user_preferences WHERE user_id = ?`,
    [localUserId],
  ).rows?.[0];

  return {
    username: typeof user?.username === 'string' ? user.username : '',
    wake_time: typeof preferences?.wake_time === 'string'
      ? preferences.wake_time
      : DEFAULT_WAKE_TIME,
    sleep_time: typeof preferences?.sleep_time === 'string'
      ? preferences.sleep_time
      : DEFAULT_SLEEP_TIME,
    study_peak_hours: typeof preferences?.study_peak_hours === 'string'
      ? preferences.study_peak_hours
      : JSON.stringify(DEFAULT_STUDY_PEAK_HOURS),
    busiest_day: typeof preferences?.busiest_day === 'string'
      ? preferences.busiest_day
      : DEFAULT_BUSIEST_DAY,
    reminder_lead_minutes: typeof preferences?.reminder_lead_minutes === 'number'
      ? preferences.reminder_lead_minutes
      : Number.parseInt(DEFAULT_REMINDER_LEAD, 10),
    snooze_tendency: typeof preferences?.snooze_tendency === 'string'
      ? preferences.snooze_tendency
      : DEFAULT_SNOOZE_TENDENCY,
    weekly_class_count: typeof preferences?.weekly_class_count === 'string'
      ? preferences.weekly_class_count
      : DEFAULT_CLASS_COUNT,
    longest_class_gap: typeof preferences?.longest_class_gap === 'string'
      ? preferences.longest_class_gap
      : DEFAULT_LONGEST_GAP,
    time_format_24h: user?.time_format_24h === 1,
    week_starts_monday: user?.week_starts_monday === 1,
    dark_mode: user?.dark_mode === 1,
  };
};

