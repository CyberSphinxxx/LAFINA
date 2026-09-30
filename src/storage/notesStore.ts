import { db, DatabaseTransaction } from './database';
import { syncOutboxStore } from './syncOutboxStore';

export interface Note {
  id: string;
  userId: string;
  title: string;
  body: string;
  isPinned: boolean;
  tags: string[]; // JSON serialized array
  category: string;
  isVoiceTranscribed: boolean;
  imageUri?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

const mapRowToNote = (row: any): Note => {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags || '[]');
  } catch {
    tags = row.tags ? row.tags.split(',') : [];
  }

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    body: row.body,
    isPinned: row.is_pinned === 1,
    tags,
    category: row.category,
    isVoiceTranscribed: row.is_voice_transcribed === 1,
    imageUri: row.image_uri || null,
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
};

type StoredNoteRow = Record<string, unknown>;

const notePayload = (row: StoredNoteRow): Record<string, unknown> => ({
  title: row.title,
  body: row.body,
  is_pinned: row.is_pinned === 1,
  tags: row.tags,
  category: row.category,
  is_voice_transcribed: row.is_voice_transcribed === 1,
  sort_order: row.sort_order,
});

const enqueueNoteUpdate = (id: string, tx: DatabaseTransaction): void => {
  const row = tx.executeSync('SELECT * FROM notes WHERE id = ?', [id]).rows?.[0] as StoredNoteRow | undefined;
  if (!row) return;
  const userId = String(row.user_id);
  syncOutboxStore.enqueueMutation(
    userId, 'note', id, 'update', notePayload(row), 'account', userId, tx,
  );
};

export const notesStore = {
  getAll: (userId: string): Note[] => {
    try {
      const result = db.executeSync(
        `SELECT * FROM notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY is_pinned DESC, sort_order ASC, updated_at DESC`,
        [userId]
      );
      return result.rows.map(mapRowToNote);
    } catch (error) {
      console.error('Error fetching notes:', error);
      return [];
    }
  },

  insert: (note: Omit<Note, 'createdAt' | 'updatedAt' | 'deletedAt' | 'sortOrder'> & { sortOrder?: number }): void => {
    const now = new Date().toISOString();
    const tagsJson = JSON.stringify(note.tags);
    try {
      db.transactionSync((tx) => {
        let finalSortOrder = note.sortOrder;
        if (finalSortOrder === undefined) {
          const maxOrder = tx.executeSync(
            `SELECT MAX(sort_order) as max_order FROM notes WHERE user_id = ? AND deleted_at IS NULL`,
            [note.userId],
          ).rows?.[0]?.max_order;
          finalSortOrder = typeof maxOrder === 'number' ? maxOrder + 1 : 0;
        }

        tx.executeSync(
          `INSERT INTO notes (id, user_id, title, body, is_pinned, tags, category, is_voice_transcribed, image_uri, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            note.id,
            note.userId,
            note.title,
            note.body,
            note.isPinned ? 1 : 0,
            tagsJson,
            note.category,
            note.isVoiceTranscribed ? 1 : 0,
            note.imageUri || null,
            finalSortOrder,
            now,
            now,
          ],
        );
        syncOutboxStore.enqueueMutation(note.userId, 'note', note.id, 'create', {
          title: note.title,
          body: note.body,
          is_pinned: note.isPinned,
          tags: tagsJson,
          category: note.category,
          is_voice_transcribed: note.isVoiceTranscribed,
          sort_order: finalSortOrder,
        }, 'account', note.userId, tx);
      });
    } catch (error) {
      console.error('Error inserting note:', error);
      throw error;
    }
  },

  update: (note: Partial<Note> & { id: string }): void => {
    const now = new Date().toISOString();
    const sets: string[] = [];
    const params: any[] = [];

    const fields: { key: keyof Note; col: string; type?: string }[] = [
      { key: 'title', col: 'title' },
      { key: 'body', col: 'body' },
      { key: 'isPinned', col: 'is_pinned', type: 'boolean' },
      { key: 'tags', col: 'tags', type: 'json' },
      { key: 'category', col: 'category' },
      { key: 'isVoiceTranscribed', col: 'is_voice_transcribed', type: 'boolean' },
      { key: 'imageUri', col: 'image_uri' },
      { key: 'sortOrder', col: 'sort_order' },
    ];

    fields.forEach(({ key, col, type }) => {
      if (note[key] !== undefined) {
        sets.push(`${col} = ?`);
        if (type === 'boolean') {
          params.push(note[key] ? 1 : 0);
        } else if (type === 'json') {
          params.push(JSON.stringify(note[key]));
        } else {
          params.push(note[key] === null ? null : note[key]);
        }
      }
    });

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    params.push(now);

    params.push(note.id);
    const hasCloudChange = Object.keys(note).some((key) => key !== 'id' && key !== 'imageUri');

    try {
      db.transactionSync((tx) => {
        tx.executeSync(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`, params);
        if (hasCloudChange) enqueueNoteUpdate(note.id, tx);
      });
    } catch (error) {
      console.error('Error updating note:', error);
      throw error;
    }
  },

  updateOrder: (notesOrder: { id: string; sortOrder: number }[]): void => {
    try {
      const now = new Date().toISOString();
      db.transactionSync((tx) => {
        notesOrder.forEach((item) => {
          tx.executeSync(
            `UPDATE notes SET sort_order = ?, updated_at = ? WHERE id = ?`,
            [item.sortOrder, now, item.id],
          );
          enqueueNoteUpdate(item.id, tx);
        });
      });
    } catch (error) {
      console.error('Error batch updating notes order:', error);
    }
  },

  delete: (id: string, tx?: DatabaseTransaction): void => {
    const now = new Date().toISOString();
    const applyDelete = (executor: DatabaseTransaction): void => {
      const row = executor.executeSync(
        'SELECT user_id FROM notes WHERE id = ?',
        [id],
      ).rows?.[0];
      if (!row) return;
      executor.executeSync(
        `UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, id]
      );
      const userId = String(row.user_id);
      syncOutboxStore.enqueueMutation(
        userId, 'note', id, 'delete', {}, 'account', userId, executor,
      );
    };
    try {
      if (tx) applyDelete(tx);
      else db.transactionSync(applyDelete);
    } catch (error) {
      console.error('Error deleting note:', error);
      throw error;
    }
  },

  getCustomCategories: (userId: string): { name: string; color: string }[] => {
    try {
      const result = db.executeSync(
        `SELECT name, color FROM custom_categories
         WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
        [userId]
      );
      return result.rows ? result.rows.map((row: any) => ({ name: row.name, color: row.color })) : [];
    } catch (error) {
      console.error('Error fetching custom categories:', error);
      return [];
    }
  },

  addCustomCategory: (userId: string, name: string, color: string): void => {
    const id = 'cat_' + Math.random().toString(36).substr(2, 9);
    const now = new Date().toISOString();
    try {
      db.transactionSync((tx) => {
        tx.executeSync(
          `INSERT INTO custom_categories (id, user_id, name, color, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, userId, name, color, now, now],
        );
        syncOutboxStore.enqueueMutation(
          userId, 'custom_category', id, 'create', { name, color }, 'account', userId, tx,
        );
      });
    } catch (error) {
      console.error('Error inserting custom category:', error);
      throw error;
    }
  },

  deleteCustomCategory: (userId: string, name: string): void => {
    try {
      db.transactionSync((tx) => {
        const rows = tx.executeSync(
          `SELECT id FROM custom_categories
           WHERE user_id = ? AND name = ? AND deleted_at IS NULL`,
          [userId, name],
        ).rows ?? [];
        const now = new Date().toISOString();
        rows.forEach((row) => {
          const id = String(row.id);
          tx.executeSync(
            `UPDATE custom_categories SET deleted_at = ?, updated_at = ? WHERE id = ?`,
            [now, now, id],
          );
          syncOutboxStore.enqueueMutation(
            userId, 'custom_category', id, 'delete', {}, 'account', userId, tx,
          );
        });
      });
    } catch (error) {
      console.error('Error deleting custom category:', error);
      throw error;
    }
  },

  updateCustomCategory: (userId: string, oldName: string, newName: string, color: string): void => {
    try {
      db.transactionSync((tx) => {
        const categoryRows = tx.executeSync(
          `SELECT id FROM custom_categories
           WHERE user_id = ? AND name = ? AND deleted_at IS NULL`,
          [userId, oldName],
        ).rows ?? [];
        const affectedNotes = tx.executeSync(
          `SELECT id FROM notes
           WHERE user_id = ? AND category = ? AND deleted_at IS NULL`,
          [userId, oldName],
        ).rows ?? [];
        const now = new Date().toISOString();
        tx.executeSync(
          `UPDATE custom_categories SET name = ?, color = ?, updated_at = ?
           WHERE user_id = ? AND name = ? AND deleted_at IS NULL`,
          [newName, color, now, userId, oldName]
        );
        tx.executeSync(
          `UPDATE notes SET category = ?, updated_at = ?
           WHERE user_id = ? AND category = ? AND deleted_at IS NULL`,
          [newName, now, userId, oldName]
        );
        categoryRows.forEach((row) => syncOutboxStore.enqueueMutation(
          userId,
          'custom_category',
          String(row.id),
          'update',
          { name: newName, color },
          'account',
          userId,
          tx,
        ));
        affectedNotes.forEach((row) => enqueueNoteUpdate(String(row.id), tx));
      });
    } catch (error) {
      console.error('Error updating custom category:', error);
      throw error;
    }
  },
};
