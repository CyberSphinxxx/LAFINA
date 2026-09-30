import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { businessWorkBlocksStore } from '../../src/storage/businessWorkBlocksStore';
import { syncOutboxStore } from '../../src/storage/syncOutboxStore';

describe('businessWorkBlocksStore', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM business_work_blocks');
    db.executeSync('DELETE FROM businesses');
  });

  const setupTestBusiness = (bizId = 'biz_wb_1', ownerId = 'mgr_1') => {
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO businesses (
        id, name, owner_id, timezone, subscription_plan, subscription_status,
        seat_limit, created_at, updated_at
      ) VALUES (?, 'Work Block Test Biz', ?, 'UTC', 'business', 'active', 5, ?, ?)`,
      [bizId, ownerId, now, now]
    );
  };

  it('creates and retrieves work blocks with outbox queuing', () => {
    setupTestBusiness();
    const created = businessWorkBlocksStore.createWorkBlock({
      businessId: 'biz_wb_1',
      userId: 'emp_1',
      title: 'Morning Lab Duty',
      startTime: '2026-08-30T08:00:00Z',
      endTime: '2026-08-30T12:00:00Z',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      createdBy: 'mgr_1',
    });

    expect(created.id).toBeDefined();
    expect(created.title).toBe('Morning Lab Duty');
    expect(created.recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');

    const outbox = syncOutboxStore.getPendingMutations('mgr_1', 100, 'business', 'biz_wb_1');
    expect(outbox.length).toBe(1);
    expect(outbox[0].entityType).toBe('business_work_block');

    const userBlocks = businessWorkBlocksStore.getWorkBlocksForUser('biz_wb_1', 'emp_1');
    expect(userBlocks.length).toBe(1);
    expect(userBlocks[0].title).toBe('Morning Lab Duty');
  });

  it('detects schedule conflicts accurately for overlapping time ranges', () => {
    setupTestBusiness();
    businessWorkBlocksStore.createWorkBlock({
      businessId: 'biz_wb_1',
      userId: 'emp_1',
      title: 'Existing Shift',
      startTime: '2026-08-30T09:00:00Z',
      endTime: '2026-08-30T13:00:00Z',
      createdBy: 'mgr_1',
    });

    // 1. Overlapping window: 10:00 - 14:00 (overlaps with 09:00 - 13:00)
    const conflict1 = businessWorkBlocksStore.checkWorkBlockConflict(
      'biz_wb_1',
      'emp_1',
      '2026-08-30T10:00:00Z',
      '2026-08-30T14:00:00Z'
    );
    expect(conflict1.hasConflict).toBe(true);
    expect(conflict1.conflictingBlocks.length).toBe(1);
    expect(conflict1.conflictingBlocks[0].title).toBe('Existing Shift');

    // 2. Non-overlapping window: 14:00 - 18:00
    const conflict2 = businessWorkBlocksStore.checkWorkBlockConflict(
      'biz_wb_1',
      'emp_1',
      '2026-08-30T14:00:00Z',
      '2026-08-30T18:00:00Z'
    );
    expect(conflict2.hasConflict).toBe(false);
    expect(conflict2.conflictingBlocks.length).toBe(0);

    // 3. Different user: no conflict
    const conflict3 = businessWorkBlocksStore.checkWorkBlockConflict(
      'biz_wb_1',
      'emp_2',
      '2026-08-30T09:00:00Z',
      '2026-08-30T13:00:00Z'
    );
    expect(conflict3.hasConflict).toBe(false);
  });
});
