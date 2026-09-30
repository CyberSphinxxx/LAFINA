import { db, DatabaseTransaction } from './database';
import { GUEST_USER_ID } from '../constants';
import { syncOutboxStore } from './syncOutboxStore';
import { buildProfileSyncPayload } from './profileSyncPayload';
import {
  pomodoroSessionPayload,
  pomodoroSettingsFromRow,
  pomodoroSettingsPayload,
} from './pomodoroStore';
import { POMODORO_SETTINGS_ENTITY_ID } from './syncTypes';

export interface GuestDataSummary {
  taskCount: number;
  eventCount: number;
  timeBlockCount: number;
  reminderCount: number;
  noteCount: number;
  categoryCount: number;
}

export const guestMigration = {
  /**
   * Retrieves summary count of local guest records.
   */
  getGuestDataSummary: (): GuestDataSummary => {
    const taskRes = db.executeSync('SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND deleted_at IS NULL', [GUEST_USER_ID]);
    const eventRes = db.executeSync('SELECT COUNT(*) as count FROM events WHERE user_id = ? AND deleted_at IS NULL', [GUEST_USER_ID]);
    const timeBlockRes = db.executeSync('SELECT COUNT(*) as count FROM time_blocks WHERE user_id = ? AND deleted_at IS NULL', [GUEST_USER_ID]);
    const reminderRes = db.executeSync('SELECT COUNT(*) as count FROM reminders WHERE user_id = ? AND deleted_at IS NULL', [GUEST_USER_ID]);
    const noteRes = db.executeSync('SELECT COUNT(*) as count FROM notes WHERE user_id = ? AND deleted_at IS NULL', [GUEST_USER_ID]);
    const catRes = db.executeSync('SELECT COUNT(*) as count FROM custom_categories WHERE user_id = ? AND deleted_at IS NULL', [GUEST_USER_ID]);

    return {
      taskCount: taskRes.rows?.[0]?.count ?? 0,
      eventCount: eventRes.rows?.[0]?.count ?? 0,
      timeBlockCount: timeBlockRes.rows?.[0]?.count ?? 0,
      reminderCount: reminderRes.rows?.[0]?.count ?? 0,
      noteCount: noteRes.rows?.[0]?.count ?? 0,
      categoryCount: catRes.rows?.[0]?.count ?? 0,
    };
  },

  /**
   * Re-keys all guest records to cloudUserId, enqueues outbox sync entries,
   * and clears local password hash upon cloud authentication confirmation.
   */
  linkGuestToCloudAccount: async (cloudUserId: string, cloudEmail: string): Promise<void> => {
    db.transactionSync((tx: DatabaseTransaction) => {
      const now = new Date().toISOString();

      // 1. Insert or ignore new user entry for cloudUserId
      tx.executeSync(
        `INSERT OR IGNORE INTO users (id, username, email, password_hash, role, is_new_user, time_format_24h, week_starts_monday, dark_mode, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'student', 0, 0, 0, 0, ?, ?)`,
        [cloudUserId, cloudEmail.split('@')[0], cloudEmail, now, now]
      );

      // 2. Re-key child entity tables
      tx.executeSync(`UPDATE tasks SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
      tx.executeSync(`UPDATE events SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
      tx.executeSync(`UPDATE time_blocks SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
      tx.executeSync(`UPDATE reminders SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
      tx.executeSync(`UPDATE notes SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
      tx.executeSync(`UPDATE custom_categories SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
      tx.executeSync(`UPDATE user_preferences SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
      tx.executeSync(`UPDATE job_queue_items SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
      tx.executeSync(`UPDATE chat_sessions SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
      tx.executeSync(`UPDATE user_behavior_logs SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
      tx.executeSync(`UPDATE ml_feature_snapshots SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);

      // 2b. Study tools. The Pomodoro log moves with the guest; one-row-per-user
      // tables keep the account's own row when it already has one here.
      if (cloudUserId !== GUEST_USER_ID) {
        tx.executeSync(`UPDATE pomodoro_sessions SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
        ['pomodoro_settings', 'pomodoro_state'].forEach((table) => {
          tx.executeSync(`UPDATE OR IGNORE ${table} SET user_id = ? WHERE user_id = ?`, [cloudUserId, GUEST_USER_ID]);
          tx.executeSync(`DELETE FROM ${table} WHERE user_id = ?`, [GUEST_USER_ID]);
        });
      }

      // 3. Remove old guest record if different
      if (cloudUserId !== GUEST_USER_ID) {
        tx.executeSync(`DELETE FROM users WHERE id = ?`, [GUEST_USER_ID]);
      }

      tx.executeSync('DELETE FROM active_session');
      tx.executeSync(
        `INSERT INTO active_session (user_id, created_at, updated_at) VALUES (?, ?, ?)`,
        [cloudUserId, now, now],
      );

      // Guest-scoped mutations cannot be sent under the new account token. Rebuild them below.
      tx.executeSync(`DELETE FROM sync_outbox WHERE user_id = ?`, [GUEST_USER_ID]);
      tx.executeSync(`DELETE FROM sync_metadata WHERE user_id = ?`, [GUEST_USER_ID]);
      tx.executeSync(`DELETE FROM sync_state WHERE user_id = ?`, [GUEST_USER_ID]);
      tx.executeSync(`DELETE FROM sync_control WHERE user_id = ?`, [GUEST_USER_ID]);

      // 4. Enqueue a complete snapshot atomically with the ownership migration.
      const tasks = tx.executeSync(
        'SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NULL',
        [cloudUserId],
      );
      tasks.rows?.forEach((row) => syncOutboxStore.enqueueMutation(cloudUserId, 'task', String(row.id), 'create', {
        title: row.title,
        due_date: row.due_date,
        due_time: row.due_time,
        is_completed: row.is_completed === 1,
        priority: row.priority,
        category: row.category,
        notes: row.notes,
        recurrence_rule: row.recurrence_rule,
      }, 'account', cloudUserId, tx));

      const events = tx.executeSync(
        'SELECT * FROM events WHERE user_id = ? AND deleted_at IS NULL',
        [cloudUserId],
      );
      events.rows?.forEach((row) => syncOutboxStore.enqueueMutation(cloudUserId, 'event', String(row.id), 'create', {
        title: row.title,
        date: row.date,
        start_time: row.start_time,
        end_time: row.end_time,
        location: row.location,
        linked_calendar_block: row.linked_calendar_block,
        recurrence_rule: row.recurrence_rule,
      }, 'account', cloudUserId, tx));

      const timeBlocks = tx.executeSync(
        'SELECT * FROM time_blocks WHERE user_id = ? AND deleted_at IS NULL',
        [cloudUserId],
      );
      timeBlocks.rows?.forEach((row) => syncOutboxStore.enqueueMutation(cloudUserId, 'time_block', String(row.id), 'create', {
        title: row.title,
        date: row.date,
        start_time: row.start_time,
        end_time: row.end_time,
        color: row.color,
        category: row.category,
        notes: row.notes,
        recurrence_rule: row.recurrence_rule,
      }, 'account', cloudUserId, tx));

      const reminders = tx.executeSync(
        'SELECT * FROM reminders WHERE user_id = ? AND deleted_at IS NULL',
        [cloudUserId],
      );
      reminders.rows?.forEach((row) => syncOutboxStore.enqueueMutation(cloudUserId, 'reminder', String(row.id), 'create', {
        task: row.task,
        description: row.description,
        scheduled_at: row.scheduled_at,
        trigger_at: row.trigger_at,
        status: row.status,
        snooze_count: row.snooze_count,
      }, 'account', cloudUserId, tx));

      const notes = tx.executeSync(
        'SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL',
        [cloudUserId],
      );
      notes.rows?.forEach((row) => syncOutboxStore.enqueueMutation(cloudUserId, 'note', String(row.id), 'create', {
        title: row.title,
        body: row.body,
        is_pinned: row.is_pinned === 1,
        tags: row.tags,
        category: row.category,
        is_voice_transcribed: row.is_voice_transcribed === 1,
        sort_order: row.sort_order,
      }, 'account', cloudUserId, tx));

      const categories = tx.executeSync(
        'SELECT * FROM custom_categories WHERE user_id = ? AND deleted_at IS NULL',
        [cloudUserId],
      );
      categories.rows?.forEach((row) => syncOutboxStore.enqueueMutation(cloudUserId, 'custom_category', String(row.id), 'create', {
        name: row.name,
        color: row.color,
      }, 'account', cloudUserId, tx));

      // Study tools: the Pomodoro log and settings. Decks, study notes and
      // meetings need Student Pro, which a guest never has.
      const pomodoroSessions = tx.executeSync(
        'SELECT * FROM pomodoro_sessions WHERE user_id = ? AND deleted_at IS NULL',
        [cloudUserId],
      );
      pomodoroSessions.rows?.forEach((row) => syncOutboxStore.enqueueMutation(
        cloudUserId, 'pomodoro_session', String(row.id), 'create', pomodoroSessionPayload(row),
        'account', cloudUserId, tx,
      ));
      const pomodoroSettings = tx.executeSync(
        'SELECT * FROM pomodoro_settings WHERE user_id = ?',
        [cloudUserId],
      ).rows?.[0];
      if (pomodoroSettings) {
        syncOutboxStore.enqueueMutation(
          cloudUserId, 'pomodoro_settings', POMODORO_SETTINGS_ENTITY_ID, 'update',
          pomodoroSettingsPayload(pomodoroSettingsFromRow(pomodoroSettings)), 'account', cloudUserId, tx,
        );
      }

      syncOutboxStore.enqueueMutation(
        cloudUserId,
        'profile',
        'profile',
        'create',
        buildProfileSyncPayload(cloudUserId, tx),
        'account',
        cloudUserId,
        tx,
      );
    });
  }
};
