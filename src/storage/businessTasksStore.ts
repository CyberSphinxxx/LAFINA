import { db } from './database';
import { generateId } from '../utils';
import { syncOutboxStore } from './syncOutboxStore';
import type {
  BusinessTaskRow,
  BusinessTaskAssignmentRow,
  BusinessTaskWithAssignments,
  TaskPriority,
  TaskAssignmentStatus,
  ManagerReviewStatus,
} from './syncTypes';

export interface CreateBusinessTaskParams {
  businessId: string;
  createdBy: string;
  title: string;
  instructions?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  scheduledAt?: string | null;
  recurrenceRule?: string | null;
  reminderLeadMinutes?: number;
  assigneeUserIds: string[];
}

export const businessTasksStore = {
  /**
   * Creates a new business task and atomic assignments for specified employees.
   */
  createTask: (params: CreateBusinessTaskParams): BusinessTaskWithAssignments => {
    const taskId = generateId();
    const now = new Date().toISOString();
    const instructions = params.instructions ?? '';
    const priority = params.priority ?? 'medium';
    const reminderLeadMinutes = params.reminderLeadMinutes ?? 15;

    db.executeSync(
      `INSERT INTO business_tasks (
        id, business_id, created_by, title, instructions, priority,
        due_date, scheduled_at, recurrence_rule, reminder_lead_minutes,
        is_cancelled, version, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, NULL, ?, ?)`,
      [
        taskId,
        params.businessId,
        params.createdBy,
        params.title,
        instructions,
        priority,
        params.dueDate ?? null,
        params.scheduledAt ?? null,
        params.recurrenceRule ?? null,
        reminderLeadMinutes,
        now,
        now,
      ]
    );

    // Enqueue task mutation to outbox
    syncOutboxStore.enqueueMutation(
      params.createdBy,
      'business_task',
      taskId,
      'create',
      {
        title: params.title,
        instructions,
        priority,
        due_date: params.dueDate ?? null,
        scheduled_at: params.scheduledAt ?? null,
        recurrence_rule: params.recurrenceRule ?? null,
        reminder_lead_minutes: reminderLeadMinutes,
      },
      'business',
      params.businessId
    );

    const assignments: BusinessTaskAssignmentRow[] = [];

    // Create assignments for all assigned users
    for (const userId of params.assigneeUserIds) {
      const assignmentId = generateId();
      db.executeSync(
        `INSERT INTO business_task_assignments (
          id, business_task_id, business_id, user_id, status,
          manager_review_status, reopened_reason, submitted_at, approved_at,
          version, deleted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'todo', 'pending', NULL, NULL, NULL, 1, NULL, ?, ?)`,
        [assignmentId, taskId, params.businessId, userId, now, now]
      );

      syncOutboxStore.enqueueMutation(
        params.createdBy,
        'business_task_assignment',
        assignmentId,
        'create',
        {
          business_task_id: taskId,
          user_id: userId,
          status: 'todo',
          manager_review_status: 'pending',
        },
        'business',
        params.businessId
      );

      assignments.push({
        id: assignmentId,
        business_task_id: taskId,
        business_id: params.businessId,
        user_id: userId,
        status: 'todo',
        manager_review_status: 'pending',
        reopened_reason: null,
        submitted_at: null,
        approved_at: null,
        version: 1,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      });
    }

    return {
      id: taskId,
      business_id: params.businessId,
      created_by: params.createdBy,
      title: params.title,
      instructions,
      priority,
      due_date: params.dueDate ?? null,
      scheduled_at: params.scheduledAt ?? null,
      recurrence_rule: params.recurrenceRule ?? null,
      reminder_lead_minutes: reminderLeadMinutes,
      is_cancelled: 0,
      version: 1,
      deleted_at: null,
      created_at: now,
      updated_at: now,
      assignments,
    };
  },

  /**
   * Updates manager-owned task fields and enqueues sync mutation.
   */
  updateTask: (
    taskId: string,
    businessId: string,
    actorId: string,
    updates: Partial<{
      title: string;
      instructions: string;
      priority: TaskPriority;
      dueDate: string | null;
      scheduledAt: string | null;
      recurrenceRule: string | null;
      reminderLeadMinutes: number;
    }>
  ): BusinessTaskRow | null => {
    const existing = db.executeSync(
      'SELECT * FROM business_tasks WHERE id = ? AND deleted_at IS NULL',
      [taskId]
    ).rows?.[0] as BusinessTaskRow | undefined;

    if (!existing) return null;

    const now = new Date().toISOString();
    const newVersion = existing.version + 1;
    const title = updates.title ?? existing.title;
    const instructions = updates.instructions ?? existing.instructions;
    const priority = updates.priority ?? existing.priority;
    const dueDate = updates.dueDate !== undefined ? updates.dueDate : existing.due_date;
    const scheduledAt =
      updates.scheduledAt !== undefined ? updates.scheduledAt : existing.scheduled_at;
    const recurrenceRule =
      updates.recurrenceRule !== undefined ? updates.recurrenceRule : existing.recurrence_rule;
    const reminderLeadMinutes =
      updates.reminderLeadMinutes ?? existing.reminder_lead_minutes;

    db.executeSync(
      `UPDATE business_tasks SET
        title = ?, instructions = ?, priority = ?, due_date = ?,
        scheduled_at = ?, recurrence_rule = ?, reminder_lead_minutes = ?,
        version = ?, updated_at = ?
      WHERE id = ?`,
      [
        title,
        instructions,
        priority,
        dueDate,
        scheduledAt,
        recurrenceRule,
        reminderLeadMinutes,
        newVersion,
        now,
        taskId,
      ]
    );

    syncOutboxStore.enqueueMutation(
      actorId,
      'business_task',
      taskId,
      'update',
      {
        title,
        instructions,
        priority,
        due_date: dueDate,
        scheduled_at: scheduledAt,
        recurrence_rule: recurrenceRule,
        reminder_lead_minutes: reminderLeadMinutes,
      },
      'business',
      businessId
    );

    return {
      ...existing,
      title,
      instructions,
      priority,
      due_date: dueDate,
      scheduled_at: scheduledAt,
      recurrence_rule: recurrenceRule,
      reminder_lead_minutes: reminderLeadMinutes,
      version: newVersion,
      updated_at: now,
    };
  },

  /**
   * Cancels a business task and marks is_cancelled = 1.
   */
  cancelTask: (taskId: string, businessId: string, actorId: string): void => {
    const existing = db.executeSync(
      'SELECT version FROM business_tasks WHERE id = ?',
      [taskId]
    ).rows?.[0] as { version: number } | undefined;
    if (!existing) return;

    const now = new Date().toISOString();
    const newVersion = existing.version + 1;

    db.executeSync(
      'UPDATE business_tasks SET is_cancelled = 1, version = ?, updated_at = ? WHERE id = ?',
      [newVersion, now, taskId]
    );

    syncOutboxStore.enqueueMutation(
      actorId,
      'business_task',
      taskId,
      'update',
      { is_cancelled: true },
      'business',
      businessId
    );
  },

  /**
   * Soft deletes a business task.
   */
  deleteTask: (taskId: string, businessId: string, actorId: string): void => {
    const existing = db.executeSync(
      'SELECT version FROM business_tasks WHERE id = ?',
      [taskId]
    ).rows?.[0] as { version: number } | undefined;
    if (!existing) return;

    const now = new Date().toISOString();
    const newVersion = existing.version + 1;

    db.executeSync(
      'UPDATE business_tasks SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?',
      [now, newVersion, now, taskId]
    );

    syncOutboxStore.enqueueMutation(
      actorId,
      'business_task',
      taskId,
      'delete',
      {},
      'business',
      businessId
    );
  },

  /**
   * Updates employee assignment status (e.g. todo -> in_progress -> pending_review).
   */
  updateAssignmentStatus: (
    assignmentId: string,
    businessId: string,
    actorId: string,
    status: TaskAssignmentStatus
  ): BusinessTaskAssignmentRow | null => {
    const existing = db.executeSync(
      'SELECT * FROM business_task_assignments WHERE id = ? AND deleted_at IS NULL',
      [assignmentId]
    ).rows?.[0] as BusinessTaskAssignmentRow | undefined;

    if (!existing) return null;

    const now = new Date().toISOString();
    const newVersion = existing.version + 1;
    let submittedAt = existing.submitted_at;
    let reviewStatus: ManagerReviewStatus = existing.manager_review_status;

    if (status === 'pending_review') {
      submittedAt = now;
      reviewStatus = 'pending';
    }

    db.executeSync(
      `UPDATE business_task_assignments SET
        status = ?, manager_review_status = ?, submitted_at = ?,
        version = ?, updated_at = ?
      WHERE id = ?`,
      [status, reviewStatus, submittedAt, newVersion, now, assignmentId]
    );

    syncOutboxStore.enqueueMutation(
      actorId,
      'business_task_assignment',
      assignmentId,
      'update',
      { status, manager_review_status: reviewStatus, submitted_at: submittedAt },
      'business',
      businessId
    );

    return {
      ...existing,
      status,
      manager_review_status: reviewStatus,
      submitted_at: submittedAt,
      version: newVersion,
      updated_at: now,
    };
  },

  /**
   * Manager reviews and approves or reopens an employee assignment.
   */
  reviewAssignment: (
    assignmentId: string,
    businessId: string,
    actorId: string,
    decision: 'approved' | 'reopened',
    reason?: string
  ): BusinessTaskAssignmentRow | null => {
    const existing = db.executeSync(
      'SELECT * FROM business_task_assignments WHERE id = ? AND deleted_at IS NULL',
      [assignmentId]
    ).rows?.[0] as BusinessTaskAssignmentRow | undefined;

    if (!existing) return null;

    const now = new Date().toISOString();
    const newVersion = existing.version + 1;
    let status: TaskAssignmentStatus = existing.status;
    let approvedAt = existing.approved_at;
    let reopenedReason = existing.reopened_reason;

    if (decision === 'approved') {
      status = 'completed';
      approvedAt = now;
    } else if (decision === 'reopened') {
      status = 'in_progress';
      reopenedReason = reason ?? null;
    }

    db.executeSync(
      `UPDATE business_task_assignments SET
        status = ?, manager_review_status = ?, approved_at = ?,
        reopened_reason = ?, version = ?, updated_at = ?
      WHERE id = ?`,
      [status, decision, approvedAt, reopenedReason, newVersion, now, assignmentId]
    );

    syncOutboxStore.enqueueMutation(
      actorId,
      'business_task_assignment',
      assignmentId,
      'update',
      {
        status,
        manager_review_status: decision,
        approved_at: approvedAt,
        reopened_reason: reopenedReason,
      },
      'business',
      businessId
    );

    return {
      ...existing,
      status,
      manager_review_status: decision,
      approved_at: approvedAt,
      reopened_reason: reopenedReason,
      version: newVersion,
      updated_at: now,
    };
  },

  /**
   * Unassigns an employee from a task.
   */
  unassignEmployee: (
    assignmentId: string,
    businessId: string,
    actorId: string
  ): void => {
    const existing = db.executeSync(
      'SELECT version FROM business_task_assignments WHERE id = ?',
      [assignmentId]
    ).rows?.[0] as { version: number } | undefined;
    if (!existing) return;

    const now = new Date().toISOString();
    const newVersion = existing.version + 1;

    db.executeSync(
      'UPDATE business_task_assignments SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?',
      [now, newVersion, now, assignmentId]
    );

    syncOutboxStore.enqueueMutation(
      actorId,
      'business_task_assignment',
      assignmentId,
      'delete',
      {},
      'business',
      businessId
    );
  },

  /**
   * Retrieves all tasks with their associated active assignments for a business.
   */
  getTasksForBusiness: (
    businessId: string,
    filter?: {
      status?: TaskAssignmentStatus;
      priority?: TaskPriority;
      search?: string;
    }
  ): BusinessTaskWithAssignments[] => {
    const taskQuery =
      'SELECT * FROM business_tasks WHERE business_id = ? AND deleted_at IS NULL ORDER BY created_at DESC';
    const params: (string | number)[] = [businessId];

    const taskRows = (db.executeSync(taskQuery, params).rows ?? []) as BusinessTaskRow[];
    if (taskRows.length === 0) return [];

    const assignmentsQuery =
      'SELECT * FROM business_task_assignments WHERE business_id = ? AND deleted_at IS NULL';
    const assignmentRows = (db.executeSync(assignmentsQuery, [businessId]).rows ??
      []) as BusinessTaskAssignmentRow[];

    const assignmentMap = new Map<string, BusinessTaskAssignmentRow[]>();
    for (const a of assignmentRows) {
      const list = assignmentMap.get(a.business_task_id) ?? [];
      list.push(a);
      assignmentMap.set(a.business_task_id, list);
    }

    let results: BusinessTaskWithAssignments[] = taskRows.map((t) => ({
      ...t,
      assignments: assignmentMap.get(t.id) ?? [],
    }));

    if (filter?.priority) {
      results = results.filter((t) => t.priority === filter.priority);
    }

    if (filter?.status) {
      results = results.filter((t) =>
        t.assignments.some((a) => a.status === filter.status)
      );
    }

    if (filter?.search) {
      const term = filter.search.toLowerCase();
      results = results.filter(
        (t) =>
          t.title.toLowerCase().includes(term) ||
          t.instructions.toLowerCase().includes(term)
      );
    }

    return results;
  },

  /**
   * Retrieves tasks assigned to a specific employee.
   */
  getAssignedTasksForEmployee: (
    businessId: string,
    userId: string
  ): Array<{ task: BusinessTaskRow; assignment: BusinessTaskAssignmentRow }> => {
    const query = `
      SELECT
        t.id as t_id, t.business_id as t_business_id, t.created_by as t_created_by,
        t.title as t_title, t.instructions as t_instructions, t.priority as t_priority,
        t.due_date as t_due_date, t.scheduled_at as t_scheduled_at,
        t.recurrence_rule as t_recurrence_rule, t.reminder_lead_minutes as t_reminder_lead_minutes,
        t.is_cancelled as t_is_cancelled, t.version as t_version, t.deleted_at as t_deleted_at,
        t.created_at as t_created_at, t.updated_at as t_updated_at,
        a.id as a_id, a.business_task_id as a_business_task_id, a.business_id as a_business_id,
        a.user_id as a_user_id, a.status as a_status, a.manager_review_status as a_manager_review_status,
        a.reopened_reason as a_reopened_reason, a.submitted_at as a_submitted_at,
        a.approved_at as a_approved_at, a.version as a_version, a.deleted_at as a_deleted_at,
        a.created_at as a_created_at, a.updated_at as a_updated_at
      FROM business_task_assignments a
      JOIN business_tasks t ON t.id = a.business_task_id
      WHERE a.business_id = ? AND a.user_id = ? AND a.deleted_at IS NULL AND t.deleted_at IS NULL
      ORDER BY t.due_date ASC, t.created_at DESC
    `;

    const rawRows = (db.executeSync(query, [businessId, userId]).rows ?? []) as Record<
      string,
      unknown
    >[];

    return rawRows.map((r) => ({
      task: {
        id: r.t_id as string,
        business_id: r.t_business_id as string,
        created_by: r.t_created_by as string,
        title: r.t_title as string,
        instructions: r.t_instructions as string,
        priority: r.t_priority as TaskPriority,
        due_date: r.t_due_date as string | null,
        scheduled_at: r.t_scheduled_at as string | null,
        recurrence_rule: r.t_recurrence_rule as string | null,
        reminder_lead_minutes: r.t_reminder_lead_minutes as number,
        is_cancelled: r.t_is_cancelled as number,
        version: r.t_version as number,
        deleted_at: r.t_deleted_at as string | null,
        created_at: r.t_created_at as string,
        updated_at: r.t_updated_at as string,
      },
      assignment: {
        id: r.a_id as string,
        business_task_id: r.a_business_task_id as string,
        business_id: r.a_business_id as string,
        user_id: r.a_user_id as string,
        status: r.a_status as TaskAssignmentStatus,
        manager_review_status: r.a_manager_review_status as ManagerReviewStatus,
        reopened_reason: r.a_reopened_reason as string | null,
        submitted_at: r.a_submitted_at as string | null,
        approved_at: r.a_approved_at as string | null,
        version: r.a_version as number,
        deleted_at: r.a_deleted_at as string | null,
        created_at: r.a_created_at as string,
        updated_at: r.a_updated_at as string,
      },
    }));
  },

  /**
   * Retrieves tasks with 0 active assignees ("Needs assignee").
   */
  getNeedsAssigneeTasks: (businessId: string): BusinessTaskWithAssignments[] => {
    const all = businessTasksStore.getTasksForBusiness(businessId);
    return all.filter((t) => t.assignments.length === 0 && !t.is_cancelled);
  },

  /**
   * Upserts a task received from cloud sync.
   */
  upsertTaskFromSync: (task: BusinessTaskRow): void => {
    db.executeSync(
      `INSERT INTO business_tasks (
        id, business_id, created_by, title, instructions, priority,
        due_date, scheduled_at, recurrence_rule, reminder_lead_minutes,
        is_cancelled, version, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        business_id = excluded.business_id,
        created_by = excluded.created_by,
        title = excluded.title,
        instructions = excluded.instructions,
        priority = excluded.priority,
        due_date = excluded.due_date,
        scheduled_at = excluded.scheduled_at,
        recurrence_rule = excluded.recurrence_rule,
        reminder_lead_minutes = excluded.reminder_lead_minutes,
        is_cancelled = excluded.is_cancelled,
        version = excluded.version,
        deleted_at = excluded.deleted_at,
        updated_at = excluded.updated_at`,
      [
        task.id,
        task.business_id,
        task.created_by,
        task.title,
        task.instructions,
        task.priority,
        task.due_date,
        task.scheduled_at,
        task.recurrence_rule,
        task.reminder_lead_minutes,
        task.is_cancelled,
        task.version,
        task.deleted_at,
        task.created_at,
        task.updated_at,
      ]
    );
  },

  /**
   * Upserts an assignment received from cloud sync.
   */
  upsertAssignmentFromSync: (assignment: BusinessTaskAssignmentRow): void => {
    db.executeSync(
      `INSERT INTO business_task_assignments (
        id, business_task_id, business_id, user_id, status,
        manager_review_status, reopened_reason, submitted_at, approved_at,
        version, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        business_task_id = excluded.business_task_id,
        business_id = excluded.business_id,
        user_id = excluded.user_id,
        status = excluded.status,
        manager_review_status = excluded.manager_review_status,
        reopened_reason = excluded.reopened_reason,
        submitted_at = excluded.submitted_at,
        approved_at = excluded.approved_at,
        version = excluded.version,
        deleted_at = excluded.deleted_at,
        updated_at = excluded.updated_at`,
      [
        assignment.id,
        assignment.business_task_id,
        assignment.business_id,
        assignment.user_id,
        assignment.status,
        assignment.manager_review_status,
        assignment.reopened_reason,
        assignment.submitted_at,
        assignment.approved_at,
        assignment.version,
        assignment.deleted_at,
        assignment.created_at,
        assignment.updated_at,
      ]
    );
  },
};
