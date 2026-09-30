import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { businessStore } from '../../src/storage/businessStore';
import type { BusinessSession } from '../../src/storage/syncTypes';

describe('businessStore', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM business_capabilities_cache');
    db.executeSync('DELETE FROM business_invitations');
    db.executeSync('DELETE FROM business_memberships');
    db.executeSync('DELETE FROM businesses');
    db.executeSync('DELETE FROM sync_outbox');
    db.executeSync('DELETE FROM sync_metadata');
    db.executeSync('DELETE FROM sync_conflicts');
    db.executeSync('DELETE FROM sync_state');
  });

  describe('Capabilities and 24h Offline Lease', () => {
    it('saves and retrieves cached capabilities accurately', () => {
      const session: BusinessSession = {
        business_id: 'biz_123',
        business_name: 'Acme University Lab',
        member_role: 'manager',
        membership_status: 'active',
        lease_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        capabilities: ['business_core', 'business_chat', 'meeting_summary'],
      };

      businessStore.saveCachedCapabilities('user_1', 'business', 'business', session);

      const cached = businessStore.getCachedCapabilities('user_1');
      expect(cached).not.toBeNull();
      expect(cached?.userId).toBe('user_1');
      expect(cached?.businessId).toBe('biz_123');
      expect(cached?.businessName).toBe('Acme University Lab');
      expect(cached?.memberRole).toBe('manager');
      expect(cached?.membershipStatus).toBe('active');
      expect(cached?.subscriptionPlan).toBe('business');
      expect(cached?.effectivePlan).toBe('business');
      expect(cached?.capabilities).toEqual(['business_core', 'business_chat', 'meeting_summary']);
    });

    it('determines 24-hour offline business lease validity correctly', () => {
      const futureExpiry = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      const pastExpiry = new Date(Date.now() - 1000).toISOString();

      // Active lease
      businessStore.saveCachedCapabilities('user_active', 'business', 'business', {
        business_id: 'biz_1',
        business_name: 'Biz 1',
        member_role: 'employee',
        membership_status: 'active',
        lease_expires_at: futureExpiry,
        capabilities: ['business_core'],
      });
      expect(businessStore.isBusinessLeaseActive('user_active')).toBe(true);

      // Expired lease
      businessStore.saveCachedCapabilities('user_expired', 'business', 'business', {
        business_id: 'biz_2',
        business_name: 'Biz 2',
        member_role: 'employee',
        membership_status: 'active',
        lease_expires_at: pastExpiry,
        capabilities: ['business_core'],
      });
      expect(businessStore.isBusinessLeaseActive('user_expired')).toBe(false);

      // Student plan (no business lease)
      businessStore.saveCachedCapabilities('user_student', 'student', 'student', null);
      expect(businessStore.isBusinessLeaseActive('user_student')).toBe(false);
    });

    it('returns business session when valid', () => {
      const futureExpiry = new Date(Date.now() + 100000).toISOString();
      businessStore.saveCachedCapabilities('user_mgr', 'student', 'business', {
        business_id: 'biz_99',
        business_name: 'Tech Corp',
        member_role: 'manager',
        membership_status: 'active',
        lease_expires_at: futureExpiry,
        capabilities: ['business_core'],
      });

      const session = businessStore.getBusinessSession('user_mgr');
      expect(session).toEqual({
        business_id: 'biz_99',
        business_name: 'Tech Corp',
        member_role: 'manager',
        membership_status: 'active',
        lease_expires_at: futureExpiry,
        capabilities: ['business_core'],
      });
    });
  });

  describe('Local Business & Membership Storage', () => {
    it('saves and upserts business and membership records', () => {
      businessStore.saveBusiness({
        id: 'biz_org1',
        name: 'USTP Innovation Hub',
        ownerId: 'user_owner',
        seatLimit: 10,
      });

      businessStore.saveMembership({
        id: 'mem_1',
        businessId: 'biz_org1',
        userId: 'user_emp1',
        memberRole: 'employee',
        membershipStatus: 'active',
      });

      const bizRows = db.executeSync('SELECT * FROM businesses WHERE id = ?', ['biz_org1']).rows;
      expect(bizRows.length).toBe(1);
      expect(bizRows[0].name).toBe('USTP Innovation Hub');
      expect(bizRows[0].seat_limit).toBe(10);

      const memRows = db.executeSync('SELECT * FROM business_memberships WHERE id = ?', ['mem_1']).rows;
      expect(memRows.length).toBe(1);
      expect(memRows[0].member_role).toBe('employee');
    });
  });

  describe('Purge Business Cache', () => {
    it('purges all scoped sync items, memberships, and clears cached capability for removed business', () => {
      const bizId = 'biz_purge_target';
      businessStore.saveBusiness({ id: bizId, name: 'Target Biz', ownerId: 'user_owner' });
      businessStore.saveMembership({
        id: 'mem_purge',
        businessId: bizId,
        userId: 'user_purged',
        memberRole: 'employee',
        membershipStatus: 'active',
      });
      businessStore.saveCachedCapabilities('user_purged', 'student', 'business', {
        business_id: bizId,
        business_name: 'Target Biz',
        member_role: 'employee',
        membership_status: 'active',
        lease_expires_at: new Date(Date.now() + 100000).toISOString(),
        capabilities: ['business_core'],
      });

      // Insert scoped outbox mutation
      const now = new Date().toISOString();
      db.executeSync(
        `INSERT INTO sync_outbox (
          id, user_id, scope_type, scope_id, entity_type, entity_id, operation, payload, base_version, created_at, updated_at, status, attempts
        ) VALUES ('ob_1', 'user_purged', 'business', ?, 'task', 'task_1', 'create', '{}', 0, ?, ?, 'pending', 0)`,
        [bizId, now, now]
      );

      // Perform purge
      businessStore.purgeBusinessCache(bizId);

      // Verify outbox purged
      const outboxRows = db.executeSync(
        "SELECT * FROM sync_outbox WHERE scope_type = 'business' AND scope_id = ?",
        [bizId]
      ).rows;
      expect(outboxRows.length).toBe(0);

      // Verify business & membership purged
      const bizCheck = db.executeSync('SELECT * FROM businesses WHERE id = ?', [bizId]).rows;
      expect(bizCheck.length).toBe(0);

      // Verify cached capabilities reset
      const cached = businessStore.getCachedCapabilities('user_purged');
      expect(cached?.businessId).toBeNull();
      expect(cached?.effectivePlan).toBe('student');
      expect(cached?.capabilities).toEqual([]);
    });
  });
});
