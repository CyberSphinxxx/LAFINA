import { db, DatabaseTransaction } from './database';
import { syncOutboxStore } from './syncOutboxStore';

export interface TimeBlock {
  id: string;
  userId: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  color: string;
  category: string;
  notes?: string;
  recurrenceRule?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

const mapRowToBlock = (row: any): TimeBlock => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  date: row.date,
  startTime: row.start_time,
  endTime: row.end_time,
  color: row.color,
  category: row.category,
  notes: row.notes,
  recurrenceRule: row.recurrence_rule,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
});

type StoredSyncRow = Record<string, unknown>;

interface ReminderCleanupRow {
  id: string;
  preCastAudioPath: string | null;
}

const scheduleReminderCleanup = (
  executor: DatabaseTransaction,
  reminders: ReminderCleanupRow[],
): void => {
  if (reminders.length === 0) return;
  const cleanupRows = [...reminders];
  const cleanup = (): void => {
    for (const reminder of cleanupRows) {
      try {
        const { cancelReminderAlarm } = require('../scheduler/reminderAlarm');
        const { deletePreCachedReminderAudio } = require('../ai/tts/ttsService');
        cancelReminderAlarm(reminder.id).catch((error: unknown) =>
          console.error(`[deleteTimeBlock] Failed to cancel alarm for reminder ${reminder.id}:`, error)
        );
        if (reminder.preCastAudioPath) {
          deletePreCachedReminderAudio(reminder.preCastAudioPath).catch((error: unknown) =>
            console.error(`[deleteTimeBlock] Failed to delete audio for reminder ${reminder.id}:`, error)
          );
        }
      } catch (error) {
        console.error('[deleteTimeBlock] Failed to import modules for reminder cleanup:', error);
      }
    }
  };

  if (executor.afterCommit) executor.afterCommit(cleanup);
  else cleanup();
};

const timeBlockPayload = (row: StoredSyncRow): Record<string, unknown> => ({
  title: row.title,
  date: row.date,
  start_time: row.start_time,
  end_time: row.end_time,
  color: row.color,
  category: row.category,
  notes: row.notes,
  recurrence_rule: row.recurrence_rule,
});

export const timeBlocksStore = {
  /**
   * Retrieves all non-deleted time blocks for a user.
   */
  getAll: (userId: string): TimeBlock[] => {
    try {
      const result = db.executeSync(
        `SELECT * FROM time_blocks WHERE user_id = ? AND deleted_at IS NULL ORDER BY date ASC, start_time ASC`,
        [userId]
      );
      return result.rows.map(mapRowToBlock);
    } catch (error) {
      console.error('Error fetching time blocks:', error);
      return [];
    }
  },

  /**
   * Inserts a new time block.
   */
  insert: (
    block: Omit<TimeBlock, 'createdAt' | 'updatedAt' | 'deletedAt'>,
    executor?: DatabaseTransaction,
  ): void => {
    const now = new Date().toISOString();
    const applyInsert = (tx: DatabaseTransaction): void => {
      tx.executeSync(
        `INSERT INTO time_blocks (id, user_id, title, date, start_time, end_time, color, category, notes, recurrence_rule, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          block.id,
          block.userId,
          block.title,
          block.date,
          block.startTime,
          block.endTime,
          block.color,
          block.category,
          block.notes || null,
          block.recurrenceRule || null,
          now,
          now,
        ],
      );
      syncOutboxStore.enqueueMutation(block.userId, 'time_block', block.id, 'create', {
        title: block.title,
        date: block.date,
        start_time: block.startTime,
        end_time: block.endTime,
        color: block.color,
        category: block.category,
        notes: block.notes || null,
        recurrence_rule: block.recurrenceRule || null,
      }, 'account', block.userId, tx);
    };
    try {
      if (executor) applyInsert(executor);
      else db.transactionSync(applyInsert);
    } catch (error) {
      console.error('Error inserting time block:', error);
      throw error;
    }
  },

  /**
   * Updates an existing time block.
   */
  update: (block: Partial<TimeBlock> & { id: string }): void => {
    const now = new Date().toISOString();
    const sets: string[] = [];
    const params: any[] = [];

    const fields: { key: keyof TimeBlock; col: string }[] = [
      { key: 'title', col: 'title' },
      { key: 'date', col: 'date' },
      { key: 'startTime', col: 'start_time' },
      { key: 'endTime', col: 'end_time' },
      { key: 'color', col: 'color' },
      { key: 'category', col: 'category' },
      { key: 'notes', col: 'notes' },
      { key: 'recurrenceRule', col: 'recurrence_rule' },
    ];

    fields.forEach(({ key, col }) => {
      if (block[key] !== undefined) {
        sets.push(`${col} = ?`);
        params.push(block[key] === null ? null : block[key]);
      }
    });

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    params.push(now);

    params.push(block.id);

    try {
      db.transactionSync((tx) => {
        tx.executeSync(`UPDATE time_blocks SET ${sets.join(', ')} WHERE id = ?`, params);
        const row = tx.executeSync('SELECT * FROM time_blocks WHERE id = ?', [block.id]).rows?.[0] as StoredSyncRow | undefined;
        if (row) {
          const userId = String(row.user_id);
          syncOutboxStore.enqueueMutation(
            userId, 'time_block', block.id, 'update', timeBlockPayload(row),
            'account', userId, tx,
          );
        }
      });
    } catch (error) {
      console.error('Error updating time block:', error);
      throw error;
    }
  },

  /**
   * Soft deletes a time block by setting deleted_at.
   */
  delete: (id: string, tx?: DatabaseTransaction): void => {
    const now = new Date().toISOString();
    const cleanupRows: ReminderCleanupRow[] = [];
    const applyDelete = (executor: DatabaseTransaction): void => {
      const blockRow = executor.executeSync(
        `SELECT user_id, title FROM time_blocks WHERE id = ?`,
        [id]
      ).rows?.[0];
      if (!blockRow) return;

      executor.executeSync(
        `UPDATE time_blocks SET deleted_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, id]
      );
      const userId = String(blockRow.user_id);
      syncOutboxStore.enqueueMutation(
        userId, 'time_block', id, 'delete', {}, 'account', userId, executor,
      );

      const reminders = executor.executeSync(
        `SELECT id, precast_audio_path FROM reminders WHERE user_id = ? AND task = ? AND deleted_at IS NULL AND status IN ('pending', 'snoozed')`,
        [userId, blockRow.title]
      ).rows || [];
      for (const reminder of reminders) {
        executor.executeSync(
          `UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE id = ?`,
          [now, now, reminder.id]
        );
        syncOutboxStore.enqueueMutation(
          userId, 'reminder', String(reminder.id), 'delete', {}, 'account', userId, executor,
        );
        cleanupRows.push({
          id: String(reminder.id),
          preCastAudioPath: typeof reminder.precast_audio_path === 'string'
            ? reminder.precast_audio_path
            : null,
        });
      }
      scheduleReminderCleanup(executor, cleanupRows);
    };
    try {
      if (tx) applyDelete(tx);
      else db.transactionSync(applyDelete);
    } catch (error) {
      console.error('Error deleting time block:', error);
      throw error;
    }
  },
};
