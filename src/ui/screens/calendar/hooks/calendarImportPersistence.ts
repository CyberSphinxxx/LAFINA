import { Colors } from '../../../theme';
import { db, DatabaseTransaction } from '../../../../storage/database';
import { parseIcsString } from '../../../../storage/icsHelper';
import {
  importedBatchesStore,
  ImportBatch,
} from '../../../../storage/importedBatchesStore';
import { tasksStore } from '../../../../storage/tasksStore';
import { timeBlocksStore } from '../../../../storage/timeBlocksStore';
import { generateId } from '../../../../utils';

type ParsedCalendarItems = ReturnType<typeof parseIcsString>;

export interface PersistedCalendarImportIds {
  eventIds: string[];
  blockIds: string[];
  taskIds: string[];
}

type ImportedEntityTable = 'events' | 'time_blocks' | 'tasks';

const getExistingOwnedIds = (
  tx: DatabaseTransaction,
  table: ImportedEntityTable,
  ids: string[],
  userId: string,
): string[] => ids.filter((id) => {
  const row = tx.executeSync(
    `SELECT user_id FROM ${table} WHERE id = ? AND deleted_at IS NULL`,
    [id],
  ).rows?.[0];
  if (!row) return false;
  if (row.user_id !== userId) {
    throw new Error(`Imported ${table} entity ${id} is not owned by user ${userId}.`);
  }
  return true;
});

/**
 * Persists every parsed calendar item and its cloud outbox create in one SQLite transaction.
 */
export const persistImportedCalendarItems = (
  userId: string,
  items: ParsedCalendarItems,
): PersistedCalendarImportIds => {
  const eventIds: string[] = [];
  const blockIds: string[] = [];
  const taskIds: string[] = [];

  db.transactionSync((tx) => {
    items.events.forEach((item) => {
      const id = generateId('event');
      tasksStore.insertEvent({
        id,
        userId,
        title: item.title,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        location: item.location || null,
        linkedCalendarBlock: null,
        recurrenceRule: item.recurrenceRule || null,
      }, tx);
      eventIds.push(id);
    });

    items.blocks.forEach((item) => {
      const id = generateId('block');
      timeBlocksStore.insert({
        id,
        userId,
        title: item.title,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        color: item.color || Colors.blue,
        category: item.category || 'Imported',
        notes: item.notes || undefined,
        recurrenceRule: item.recurrenceRule || null,
      }, tx);
      blockIds.push(id);
    });

    items.tasks.forEach((item) => {
      const id = generateId('task');
      tasksStore.insertTask({
        id,
        userId,
        title: item.title,
        dueDate: item.dueDate || null,
        dueTime: item.dueTime || null,
        isCompleted: false,
        priority: item.priority || 'Medium',
        category: item.category || 'Imported',
        notes: item.notes || null,
        recurrenceRule: item.recurrenceRule || null,
      }, tx);
      taskIds.push(id);
    });
  });

  return { eventIds, blockIds, taskIds };
};

/**
 * Persists imported entities and records their account-scoped RNFS batch metadata.
 * If the RNFS write fails, compensating tombstones prevent active untracked imports.
 */
export const persistImportedCalendarBatch = async (
  userId: string,
  fileName: string,
  items: ParsedCalendarItems,
): Promise<PersistedCalendarImportIds> => {
  const ids = persistImportedCalendarItems(userId, items);
  try {
    await importedBatchesStore.saveImportedBatch(
      userId,
      fileName,
      ids.eventIds,
      ids.blockIds,
      ids.taskIds,
    );
    return ids;
  } catch (error) {
    try {
      removeImportedCalendarItems(userId, {
        id: 'failed-import-compensation',
        userId,
        timestamp: new Date().toISOString(),
        fileName,
        events: ids.eventIds,
        blocks: ids.blockIds,
        tasks: ids.taskIds,
      });
    } catch (compensationError) {
      console.error('Failed to compensate imported calendar items:', compensationError);
    }
    throw error;
  }
};

/**
 * Soft-deletes every entity in an imported batch together with its outbox tombstone.
 * Any item failure escapes the callback so SQLite rolls back the whole batch.
 */
export const removeImportedCalendarItems = (userId: string, batch: ImportBatch): void => {
  if (batch.userId !== userId) {
    throw new Error(`Imported batch ${batch.id} is not owned by user ${userId}.`);
  }

  db.transactionSync((tx) => {
    const eventIds = getExistingOwnedIds(tx, 'events', batch.events, userId);
    const blockIds = getExistingOwnedIds(tx, 'time_blocks', batch.blocks, userId);
    const taskIds = getExistingOwnedIds(tx, 'tasks', batch.tasks, userId);

    eventIds.forEach((id) => tasksStore.deleteEvent(id, tx));
    blockIds.forEach((id) => timeBlocksStore.delete(id, tx));
    taskIds.forEach((id) => tasksStore.deleteTask(id, tx));
  });
};

/**
 * Removes an account-owned imported batch from SQLite before deleting its RNFS metadata.
 * A metadata failure is safe to retry because already-deleted entities are skipped.
 */
export const removeImportedCalendarBatch = async (
  userId: string,
  batch: ImportBatch,
): Promise<void> => {
  removeImportedCalendarItems(userId, batch);
  await importedBatchesStore.deleteImportedBatch(userId, batch.id);
};
