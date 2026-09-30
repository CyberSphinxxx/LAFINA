import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { businessTasksStore } from '../../src/storage/businessTasksStore';
import { remindersStore } from '../../src/storage/remindersStore';
import { reconcileBusinessAssignmentReminders } from '../../src/scheduler/reminderScheduler';

describe('reconcileBusinessAssignmentReminders', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM business_task_assignments');
    db.executeSync('DELETE FROM business_tasks');
    db.executeSync('DELETE FROM businesses');
    db.executeSync('DELETE FROM users');
  });

  const setupTestBusiness = (
    bizId = 'biz_rem_1',
    ownerId = 'mgr_1',
    employeeId = 'emp_rem_1'
  ) => {
    const now = new Date().toISOString();
    // Insert manager and employee accounts
    db.executeSync(
      `INSERT INTO users (id, username, email, role, is_new_user, created_at, updated_at)
       VALUES (?, 'Manager', 'mgr@example.com', 'student', 0, ?, ?)`,
      [ownerId, now, now]
    );
    db.executeSync(
      `INSERT INTO users (id, username, email, role, is_new_user, created_at, updated_at)
       VALUES (?, 'Employee', 'emp@example.com', 'student', 0, ?, ?)`,
      [employeeId, now, now]
    );

    db.executeSync(
      `INSERT INTO businesses (
        id, name, owner_id, timezone, subscription_plan, subscription_status,
        seat_limit, created_at, updated_at
      ) VALUES (?, 'Reminder Sync Biz', ?, 'UTC', 'business', 'active', 5, ?, ?)`,
      [bizId, ownerId, now, now]
    );
  };

  it('schedules local reminder for employee assigned task with due date', () => {
    setupTestBusiness();
    const created = businessTasksStore.createTask({
      businessId: 'biz_rem_1',
      createdBy: 'mgr_1',
      title: 'Prepare Server Room Audit',
      dueDate: '2026-08-30T15:00:00Z',
      reminderLeadMinutes: 30,
      assigneeUserIds: ['emp_rem_1'],
    });

    const assignmentId = created.assignments[0].id;

    // Run reconciliation on employee device
    reconcileBusinessAssignmentReminders('emp_rem_1', 'biz_rem_1');

    const reminder = remindersStore.getReminderById(assignmentId);
    expect(reminder).not.toBeNull();
    expect(reminder!.task).toBe('Prepare Server Room Audit');
    expect(reminder!.scheduledAt).toBe('2026-08-30T15:00:00Z');
    // Trigger should be 30 minutes earlier: 14:30:00Z
    expect(new Date(reminder!.triggerAt).getTime()).toBe(
      new Date('2026-08-30T15:00:00Z').getTime() - 30 * 60 * 1000
    );
  });

  it('removes reminder when task is completed or cancelled', () => {
    setupTestBusiness();
    const created = businessTasksStore.createTask({
      businessId: 'biz_rem_1',
      createdBy: 'mgr_1',
      title: 'Check UPS Battery',
      dueDate: '2026-08-30T12:00:00Z',
      reminderLeadMinutes: 15,
      assigneeUserIds: ['emp_rem_1'],
    });

    const assignmentId = created.assignments[0].id;
    reconcileBusinessAssignmentReminders('emp_rem_1', 'biz_rem_1');
    expect(remindersStore.getReminderById(assignmentId)).not.toBeNull();

    // Mark completed
    businessTasksStore.reviewAssignment(assignmentId, 'biz_rem_1', 'mgr_1', 'approved');
    reconcileBusinessAssignmentReminders('emp_rem_1', 'biz_rem_1');

    const deleted = remindersStore.getReminderById(assignmentId);
    expect(deleted?.deletedAt).not.toBeNull();
  });
});
