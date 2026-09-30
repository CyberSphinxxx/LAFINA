import { db } from './database';

/**
 * Small per-device preferences that never sync, keyed per account — the
 * mobile counterpart of the desktop app's localStorage keys (for example
 * whether chat answers may draw on the USTP Student Handbook).
 */
export const localSettingsStore = {
  /** Returns the stored value, or `fallback` when unset or unreadable. */
  get: (userId: string, key: string, fallback: string | null = null): string | null => {
    try {
      const row = db.executeSync(
        'SELECT value FROM local_settings WHERE user_id = ? AND key = ?',
        [userId, key],
      ).rows?.[0];
      return typeof row?.value === 'string' ? row.value : fallback;
    } catch (error) {
      console.error('Error reading local setting:', error);
      return fallback;
    }
  },

  /** Stores a value for one account on this device. */
  set: (userId: string, key: string, value: string): void => {
    try {
      db.executeSync(
        `INSERT INTO local_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [userId, key, value, new Date().toISOString()],
      );
    } catch (error) {
      console.error('Error saving local setting:', error);
    }
  },
};
