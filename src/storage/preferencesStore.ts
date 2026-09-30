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
import { generateId } from '../utils';
import { db } from './database';
import { buildProfileSyncPayload } from './profileSyncPayload';
import { syncOutboxStore } from './syncOutboxStore';

export type StudyPeakHour =
  | 'morning'
  | 'late_morning'
  | 'afternoon'
  | 'evening'
  | 'night';

export type SnoozeTendency =
  | 'immediate'
  | 'snooze_once'
  | 'snooze_multiple'
  | 'ignore';

export type WeeklyClassCount = '1-3' | '4-6' | '7+';
export type LongestClassGap = 'None' | '30 min' | '1 hour' | '2+ hours';

export interface UserPreferences {
  wakeTime: string;
  sleepTime: string;
  studyPeakHours: StudyPeakHour[];
  busiestDay: string;
  reminderLeadMinutes: number;
  snoozeTendency: SnoozeTendency;
  weeklyClassCount: WeeklyClassCount;
  longestClassGap: LongestClassGap;
}

export interface StoredUserPreferences extends UserPreferences {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

interface UserPreferencesRow {
  id: string;
  user_id: string;
  wake_time: string;
  sleep_time: string;
  study_peak_hours: string;
  busiest_day: string;
  reminder_lead_minutes: number;
  snooze_tendency: string;
  weekly_class_count: string;
  longest_class_gap: string;
  created_at: string;
  updated_at: string;
}

const VALID_STUDY_PEAK_HOURS: StudyPeakHour[] = [
  'morning',
  'late_morning',
  'afternoon',
  'evening',
  'night',
];
const VALID_SNOOZE_TENDENCIES: SnoozeTendency[] = [
  'immediate',
  'snooze_once',
  'snooze_multiple',
  'ignore',
];
const VALID_CLASS_COUNTS: WeeklyClassCount[] = ['1-3', '4-6', '7+'];
const VALID_CLASS_GAPS: LongestClassGap[] = ['None', '30 min', '1 hour', '2+ hours'];
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Returns a new default preference object for skipped onboarding questions.
 */
export const getDefaultUserPreferences = (): UserPreferences => ({
  wakeTime: DEFAULT_WAKE_TIME,
  sleepTime: DEFAULT_SLEEP_TIME,
  studyPeakHours: [...DEFAULT_STUDY_PEAK_HOURS] as StudyPeakHour[],
  busiestDay: DEFAULT_BUSIEST_DAY,
  reminderLeadMinutes: Number.parseInt(DEFAULT_REMINDER_LEAD, 10),
  snoozeTendency: DEFAULT_SNOOZE_TENDENCY as SnoozeTendency,
  weeklyClassCount: DEFAULT_CLASS_COUNT as WeeklyClassCount,
  longestClassGap: DEFAULT_LONGEST_GAP as LongestClassGap,
});

const normalizePreferences = (preferences: UserPreferences): UserPreferences => {
  const defaults = getDefaultUserPreferences();
  const studyPeakHours = preferences.studyPeakHours.filter(
    (value): value is StudyPeakHour => VALID_STUDY_PEAK_HOURS.includes(value)
  );

  return {
    wakeTime: TIME_PATTERN.test(preferences.wakeTime)
      ? preferences.wakeTime
      : defaults.wakeTime,
    sleepTime: TIME_PATTERN.test(preferences.sleepTime)
      ? preferences.sleepTime
      : defaults.sleepTime,
    studyPeakHours,
    busiestDay: preferences.busiestDay.trim() || defaults.busiestDay,
    reminderLeadMinutes:
      Number.isInteger(preferences.reminderLeadMinutes) &&
      preferences.reminderLeadMinutes >= 0 &&
      preferences.reminderLeadMinutes <= 120
        ? preferences.reminderLeadMinutes
        : defaults.reminderLeadMinutes,
    snoozeTendency: VALID_SNOOZE_TENDENCIES.includes(preferences.snoozeTendency)
      ? preferences.snoozeTendency
      : defaults.snoozeTendency,
    weeklyClassCount: VALID_CLASS_COUNTS.includes(preferences.weeklyClassCount)
      ? preferences.weeklyClassCount
      : defaults.weeklyClassCount,
    longestClassGap: VALID_CLASS_GAPS.includes(preferences.longestClassGap)
      ? preferences.longestClassGap
      : defaults.longestClassGap,
  };
};

const parseStudyPeakHours = (value: string): StudyPeakHour[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is StudyPeakHour =>
        typeof entry === 'string' &&
        VALID_STUDY_PEAK_HOURS.includes(entry as StudyPeakHour)
    );
  } catch {
    return [];
  }
};

const mapRow = (row: UserPreferencesRow): StoredUserPreferences => {
  const normalized = normalizePreferences({
    wakeTime: row.wake_time,
    sleepTime: row.sleep_time,
    studyPeakHours: parseStudyPeakHours(row.study_peak_hours),
    busiestDay: row.busiest_day,
    reminderLeadMinutes: row.reminder_lead_minutes,
    snoozeTendency: row.snooze_tendency as SnoozeTendency,
    weeklyClassCount: row.weekly_class_count as WeeklyClassCount,
    longestClassGap: row.longest_class_gap as LongestClassGap,
  });

  return {
    id: row.id,
    userId: row.user_id,
    ...normalized,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const preferencesStore = {
  /**
   * Returns the saved preference row, or null when onboarding has not saved one yet.
   */
  getStored: (userId: string): StoredUserPreferences | null => {
    try {
      const result = db.executeSync(
        'SELECT * FROM user_preferences WHERE user_id = ?',
        [userId]
      );
      if (!result.rows || result.rows.length === 0) {
        return null;
      }
      return mapRow(result.rows[0] as UserPreferencesRow);
    } catch (error) {
      console.error('Error fetching user preferences:', error);
      return null;
    }
  },

  /**
   * Returns saved user preferences with safe defaults when no row exists.
   */
  get: (userId: string): UserPreferences => {
    const stored = preferencesStore.getStored(userId);
    if (!stored) {
      return getDefaultUserPreferences();
    }
    return {
      wakeTime: stored.wakeTime,
      sleepTime: stored.sleepTime,
      studyPeakHours: [...stored.studyPeakHours],
      busiestDay: stored.busiestDay,
      reminderLeadMinutes: stored.reminderLeadMinutes,
      snoozeTendency: stored.snoozeTendency,
      weeklyClassCount: stored.weeklyClassCount,
      longestClassGap: stored.longestClassGap,
    };
  },

  /**
   * Inserts or updates the single SQLite preference row owned by a user.
   */
  save: (userId: string, preferences: UserPreferences): StoredUserPreferences => {
    const normalized = normalizePreferences(preferences);
    const now = new Date().toISOString();

    try {
      db.transactionSync((tx) => {
        const existingResult = tx.executeSync(
          'SELECT id FROM user_preferences WHERE user_id = ?',
          [userId],
        );
        const existingId = existingResult.rows?.[0]?.id;

        if (typeof existingId === 'string') {
          tx.executeSync(
          `UPDATE user_preferences
           SET wake_time = ?, sleep_time = ?, study_peak_hours = ?, busiest_day = ?,
               reminder_lead_minutes = ?, snooze_tendency = ?, weekly_class_count = ?,
               longest_class_gap = ?, updated_at = ?
           WHERE id = ?`,
          [
            normalized.wakeTime,
            normalized.sleepTime,
            JSON.stringify(normalized.studyPeakHours),
            normalized.busiestDay,
            normalized.reminderLeadMinutes,
            normalized.snoozeTendency,
            normalized.weeklyClassCount,
            normalized.longestClassGap,
            now,
            existingId,
          ],
          );
        } else {
          tx.executeSync(
          `INSERT INTO user_preferences (
             id, user_id, wake_time, sleep_time, study_peak_hours, busiest_day,
             reminder_lead_minutes, snooze_tendency, weekly_class_count,
             longest_class_gap, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            generateId('pref'),
            userId,
            normalized.wakeTime,
            normalized.sleepTime,
            JSON.stringify(normalized.studyPeakHours),
            normalized.busiestDay,
            normalized.reminderLeadMinutes,
            normalized.snoozeTendency,
            normalized.weeklyClassCount,
            normalized.longestClassGap,
            now,
            now,
          ],
          );
        }

        syncOutboxStore.enqueueMutation(
          userId,
          'profile',
          'profile',
          'update',
          buildProfileSyncPayload(userId, tx),
          'account',
          userId,
          tx,
        );
      });
    } catch (error) {
      console.error('Error saving user preferences:', error);
      throw error;
    }

    const saved = preferencesStore.getStored(userId);
    if (!saved) {
      throw new Error('User preferences could not be reloaded after saving.');
    }
    return saved;
  },
};
