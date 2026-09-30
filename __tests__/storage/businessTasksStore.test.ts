import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { businessTasksStore } from '../../src/storage/businessTasksStore';
import { syncOutboxStore } from '../../src/storage/syncOutboxStore';

describe('businessTasksStore', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM business_task_assignments');
    db.executeSync('DELETE FROM business_tasks');
    db.executeSync('DELETE FROM businesses');
  });

  const setupTestBusiness = (bizId = 'biz_test_1', ownerId = 'mgr_1') => {
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO businesses (
        id, name, owner_id, timezone, subscription_plan, subscription_status,
        seat_limit, created_at, updated_at
      ) VALUES (?, 'Test Business', ?, 'UTC', 'business', 'active', 5, ?, ?)`,
      [bizId, ownerId, now, now]
    );
  };

  it('creates a task with atomic multi-assignee assignment rows and outbox mutations', () => {
    setupTestBusiness();
    const created = businessTasksStore.createTask({
      businessId: 'biz_test_1',
      createdBy: 'mgr_1',
      title: 'Deploy Production Firewall',
      instructions: 'Configure security groups and open port 443.',
      priority: 'high',
      dueDate: '2026-08-31T18:00:00Z',
      reminderLeadMinutes: 30,
      assigneeUserIds: ['emp_1', 'emp_2'],
    });

    expect(created.id).toBeDefined();
    expect(created.title).toBe('Deploy Production Firewall');
    expect(created.priority).toBe('high');
    expect(created.assignments.length).toBe(2);
    expect(created.assignments[0].status).toBe('todo');
    expect(created.assignments[1].status).toBe('todo');

    // Verify sync outbox entries
    const outboxRows = syncOutboxStore.getPendingMutations('mgr_1', 100, 'business', 'biz_test_1');
    expect(outboxRows.length).toBe(3); // 1 task + 2 assignments
    expect(outboxRows[0].entityType).toBe('business_task');
    expect(outboxRows[1].entityType).toBe('business_task_assignment');
    expect(outboxRows[2].entityType).toBe('business_task_assignment');
  });

  it('updates manager-owned task fields and increments version', () => {
    setupTestBusiness();
    const created = businessTasksStore.createTask({
      businessId: 'biz_test_1',
      createdBy: 'mgr_1',
      title: 'Initial Title',
      assigneeUserIds: ['emp_1'],
    });

    const updated = businessTasksStore.updateTask(
      created.id,
      'biz_test_1',
      'mgr_1',
      {
        title: 'Revised Firewall Config',
        priority: 'high',
        reminderLeadMinutes: 45,
      }
    );

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('Revised Firewall Config');
    expect(updated!.priority).toBe('high');
    expect(updated!.reminder_lead_minutes).toBe(45);
    expect(updated!.version).toBe(2);
  });

  it('handles employee status transitions and manager review approvals', () => {
    setupTestBusiness();
    const created = businessTasksStore.createTask({
      businessId: 'biz_test_1',
      createdBy: 'mgr_1',
      title: 'QA Smoke Testing',
      assigneeUserIds: ['emp_1'],
    });

    const assignmentId = created.assignments[0].id;

    // 1. Employee starts working
    const inProgress = businessTasksStore.updateAssignmentStatus(
      assignmentId,
      'biz_test_1',
      'emp_1',
      'in_progress'
    );
    expect(inProgress?.status).toBe('in_progress');

    // 2. Employee submits for review
    const pendingReview = businessTasksStore.updateAssignmentStatus(
      assignmentId,
      'biz_test_1',
      'emp_1',
      'pending_review'
    );
    expect(pendingReview?.status).toBe('pending_review');
    expect(pendingReview?.manager_review_status).toBe('pending');
    expect(pendingReview?.submitted_at).not.toBeNull();

    // 3. Manager reviews and approves
    const approved = businessTasksStore.reviewAssignment(
      assignmentId,
      'biz_test_1',
      'mgr_1',
      'approved'
    );
    expect(approved?.status).toBe('completed');
    expect(approved?.manager_review_status).toBe('approved');
    expect(approved?.approved_at).not.toBeNull();
  });

  it('handles manager reopen with feedback reason', () => {
    setupTestBusiness();
    const created = businessTasksStore.createTask({
      businessId: 'biz_test_1',
      createdBy: 'mgr_1',
      title: 'Database Backup Verification',
      assigneeUserIds: ['emp_1'],
    });

    const assignmentId = created.assignments[0].id;
    businessTasksStore.updateAssignmentStatus(
      assignmentId,
      'biz_test_1',
      'emp_1',
      'pending_review'
    );

    const reopened = businessTasksStore.reviewAssignment(
      assignmentId,
      'biz_test_1',
      'mgr_1',
      'reopened',
      'Please also test point-in-time recovery logs.'
    );

    expect(reopened?.status).toBe('in_progress');
    expect(reopened?.manager_review_status).toBe('reopened');
    expect(reopened?.reopened_reason).toBe('Please also test point-in-time recovery logs.');
  });

  it('cancels a task and marks is_cancelled = 1', () => {
    setupTestBusiness();
    const created = businessTasksStore.createTask({
      businessId: 'biz_test_1',
      createdBy: 'mgr_1',
      title: 'Deprecated Migration Script',
      assigneeUserIds: ['emp_1'],
    });

    businessTasksStore.cancelTask(created.id, 'biz_test_1', 'mgr_1');
    const tasks = businessTasksStore.getTasksForBusiness('biz_test_1');
    expect(tasks[0].is_cancelled).toBe(1);
  });

  it('filters tasks by business and retrieves assigned tasks for employee', () => {
    setupTestBusiness();
    businessTasksStore.createTask({
      businessId: 'biz_test_1',
      createdBy: 'mgr_1',
      title: 'Assigned Task 1',
      priority: 'high',
      dueDate: '2026-08-30T10:00:00Z',
      assigneeUserIds: ['emp_target'],
    });
    businessTasksStore.createTask({
      businessId: 'biz_test_1',
      createdBy: 'mgr_1',
      title: 'Unassigned Task',
      priority: 'low',
      assigneeUserIds: [],
    });

    const assigned = businessTasksStore.getAssignedTasksForEmployee('biz_test_1', 'emp_target');
    expect(assigned.length).toBe(1);
    expect(assigned[0].task.title).toBe('Assigned Task 1');

    const unassigned = businessTasksStore.getNeedsAssigneeTasks('biz_test_1');
    expect(unassigned.length).toBe(1);
    expect(unassigned[0].title).toBe('Unassigned Task');
  });
});
