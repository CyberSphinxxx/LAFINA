import { db } from './database';
import { generateId } from '../utils';
import { syncOutboxStore } from './syncOutboxStore';
import type { BusinessWorkBlockRow } from './syncTypes';

export interface CreateBusinessWorkBlockParams {
  businessId: string;
  userId: string;
  title: string;
  startTime: string;
  endTime: string;
  recurrenceRule?: string | null;
  createdBy: string;
}

export const businessWorkBlocksStore = {
  /**
   * Creates a new business work block and enqueues sync mutation.
   */
  createWorkBlock: (params: CreateBusinessWorkBlockParams): BusinessWorkBlockRow => {
    const blockId = generateId();
    const now = new Date().toISOString();

    db.executeSync(
      `INSERT INTO business_work_blocks (
        id, business_id, user_id, title, start_time, end_time,
        recurrence_rule, created_by, version, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
      [
        blockId,
        params.businessId,
        params.userId,
        params.title,
        params.startTime,
        params.endTime,
        params.recurrenceRule ?? null,
        params.createdBy,
        now,
        now,
      ]
    );

    syncOutboxStore.enqueueMutation(
      params.createdBy,
      'business_work_block',
      blockId,
      'create',
      {
        user_id: params.userId,
        title: params.title,
        start_time: params.startTime,
        end_time: params.endTime,
        recurrence_rule: params.recurrenceRule ?? null,
      },
      'business',
      params.businessId
    );

    return {
      id: blockId,
      business_id: params.businessId,
      user_id: params.userId,
      title: params.title,
      start_time: params.startTime,
      end_time: params.endTime,
      recurrence_rule: params.recurrenceRule ?? null,
      created_by: params.createdBy,
      version: 1,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
  },

  /**
   * Updates an existing work block.
   */
  updateWorkBlock: (
    blockId: string,
    businessId: string,
    actorId: string,
    updates: Partial<{
      title: string;
      startTime: string;
      endTime: string;
      recurrenceRule: string | null;
    }>
  ): BusinessWorkBlockRow | null => {
    const existing = db.executeSync(
      'SELECT * FROM business_work_blocks WHERE id = ? AND deleted_at IS NULL',
      [blockId]
    ).rows?.[0] as BusinessWorkBlockRow | undefined;

    if (!existing) return null;

    const now = new Date().toISOString();
    const newVersion = existing.version + 1;
    const title = updates.title ?? existing.title;
    const startTime = updates.startTime ?? existing.start_time;
    const endTime = updates.endTime ?? existing.end_time;
    const recurrenceRule =
      updates.recurrenceRule !== undefined
        ? updates.recurrenceRule
        : existing.recurrence_rule;

    db.executeSync(
      `UPDATE business_work_blocks SET
        title = ?, start_time = ?, end_time = ?, recurrence_rule = ?,
        version = ?, updated_at = ?
      WHERE id = ?`,
      [title, startTime, endTime, recurrenceRule, newVersion, now, blockId]
    );

    syncOutboxStore.enqueueMutation(
      actorId,
      'business_work_block',
      blockId,
      'update',
      {
        title,
        start_time: startTime,
        end_time: endTime,
        recurrence_rule: recurrenceRule,
      },
      'business',
      businessId
    );

    return {
      ...existing,
      title,
      start_time: startTime,
      end_time: endTime,
      recurrence_rule: recurrenceRule,
      version: newVersion,
      updated_at: now,
    };
  },

  /**
   * Soft deletes a work block.
   */
  deleteWorkBlock: (blockId: string, businessId: string, actorId: string): void => {
    const existing = db.executeSync(
      'SELECT version FROM business_work_blocks WHERE id = ?',
      [blockId]
    ).rows?.[0] as { version: number } | undefined;
    if (!existing) return;

    const now = new Date().toISOString();
    const newVersion = existing.version + 1;

    db.executeSync(
      'UPDATE business_work_blocks SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?',
      [now, newVersion, now, blockId]
    );

    syncOutboxStore.enqueueMutation(
      actorId,
      'business_work_block',
      blockId,
      'delete',
      {},
      'business',
      businessId
    );
  },

  /**
   * Retrieves all active work blocks for a business.
   */
  getWorkBlocksForBusiness: (
    businessId: string,
    startDate?: string,
    endDate?: string
  ): BusinessWorkBlockRow[] => {
    let query =
      'SELECT * FROM business_work_blocks WHERE business_id = ? AND deleted_at IS NULL';
    const params: string[] = [businessId];

    if (startDate) {
      query += ' AND end_time >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND start_time <= ?';
      params.push(endDate);
    }
    query += ' ORDER BY start_time ASC';

    return (db.executeSync(query, params).rows ?? []) as BusinessWorkBlockRow[];
  },

  /**
   * Retrieves active work blocks for a specific user.
   */
  getWorkBlocksForUser: (
    businessId: string,
    userId: string,
    startDate?: string,
    endDate?: string
  ): BusinessWorkBlockRow[] => {
    let query =
      'SELECT * FROM business_work_blocks WHERE business_id = ? AND user_id = ? AND deleted_at IS NULL';
    const params: string[] = [businessId, userId];

    if (startDate) {
      query += ' AND end_time >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND start_time <= ?';
      params.push(endDate);
    }
    query += ' ORDER BY start_time ASC';

    return (db.executeSync(query, params).rows ?? []) as BusinessWorkBlockRow[];
  },

  /**
   * Detects schedule overlaps for a user in a business.
   */
  checkWorkBlockConflict: (
    businessId: string,
    userId: string,
    startTime: string,
    endTime: string,
    excludeId?: string
  ): { hasConflict: boolean; conflictingBlocks: BusinessWorkBlockRow[] } => {
    let query = `
      SELECT * FROM business_work_blocks
      WHERE business_id = ? AND user_id = ? AND deleted_at IS NULL
        AND start_time < ? AND end_time > ?
    `;
    const params: string[] = [businessId, userId, endTime, startTime];

    if (excludeId) {
      query += ' AND id != ?';
      params.push(excludeId);
    }

    const conflicting = (db.executeSync(query, params).rows ?? []) as BusinessWorkBlockRow[];
    return {
      hasConflict: conflicting.length > 0,
      conflictingBlocks: conflicting,
    };
  },

  /**
   * Upserts a work block from cloud sync.
   */
  upsertWorkBlockFromSync: (block: BusinessWorkBlockRow): void => {
    db.executeSync(
      `INSERT INTO business_work_blocks (
        id, business_id, user_id, title, start_time, end_time,
        recurrence_rule, created_by, version, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        business_id = excluded.business_id,
        user_id = excluded.user_id,
        title = excluded.title,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        recurrence_rule = excluded.recurrence_rule,
        created_by = excluded.created_by,
        version = excluded.version,
        deleted_at = excluded.deleted_at,
        updated_at = excluded.updated_at`,
      [
        block.id,
        block.business_id,
        block.user_id,
        block.title,
        block.start_time,
        block.end_time,
        block.recurrence_rule,
        block.created_by,
        block.version,
        block.deleted_at,
        block.created_at,
        block.updated_at,
      ]
    );
  },
};
