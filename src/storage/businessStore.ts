import { db, DatabaseTransaction } from './database';
import { generateId } from '../utils';
import type {
  BusinessMemberRole,
  BusinessSession,
  MembershipStatus,
  SubscriptionPlan,
} from './syncTypes';

export interface LocalBusiness {
  id: string;
  name: string;
  ownerId: string;
  timezone: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  seatLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalBusinessMembership {
  id: string;
  businessId: string;
  userId: string;
  memberRole: BusinessMemberRole;
  membershipStatus: MembershipStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LocalBusinessInvitation {
  id: string;
  businessId: string;
  invitedBy: string;
  email: string;
  memberRole: BusinessMemberRole;
  status: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CachedCapabilities {
  userId: string;
  businessId: string | null;
  businessName: string | null;
  memberRole: BusinessMemberRole | null;
  membershipStatus: MembershipStatus | null;
  subscriptionPlan: SubscriptionPlan;
  effectivePlan: SubscriptionPlan;
  capabilities: string[];
  leaseExpiresAt: string | null;
  updatedAt: string;
}

export const businessStore = {
  /**
   * Saves or updates the local cached business session and 24-hour lease.
   */
  saveCachedCapabilities: (
    userId: string,
    subscriptionPlan: SubscriptionPlan,
    effectivePlan: SubscriptionPlan,
    session: BusinessSession | null,
    tx?: DatabaseTransaction
  ): void => {
    const now = new Date().toISOString();
    const sql = `
      INSERT INTO business_capabilities_cache (
        user_id, business_id, business_name, member_role, membership_status,
        subscription_plan, effective_plan, capabilities, lease_expires_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        business_id = excluded.business_id,
        business_name = excluded.business_name,
        member_role = excluded.member_role,
        membership_status = excluded.membership_status,
        subscription_plan = excluded.subscription_plan,
        effective_plan = excluded.effective_plan,
        capabilities = excluded.capabilities,
        lease_expires_at = excluded.lease_expires_at,
        updated_at = excluded.updated_at
    `;
    const params = [
      userId,
      session?.business_id ?? null,
      session?.business_name ?? null,
      session?.member_role ?? null,
      session?.membership_status ?? null,
      subscriptionPlan,
      effectivePlan,
      JSON.stringify(session?.capabilities ?? []),
      session?.lease_expires_at ?? null,
      now,
    ];

    if (tx) {
      tx.executeSync(sql, params);
    } else {
      db.executeSync(sql, params);
    }
  },

  /**
   * Retrieves the cached business capabilities and lease info for a user.
   */
  getCachedCapabilities: (userId: string): CachedCapabilities | null => {
    try {
      const res = db.executeSync(
        'SELECT * FROM business_capabilities_cache WHERE user_id = ? LIMIT 1',
        [userId]
      );
      const row = res.rows?.[0];
      if (!row) return null;

      let capabilities: string[] = [];
      try {
        capabilities = JSON.parse(String(row.capabilities ?? '[]'));
      } catch {
        capabilities = [];
      }

      return {
        userId: String(row.user_id),
        businessId: row.business_id ? String(row.business_id) : null,
        businessName: row.business_name ? String(row.business_name) : null,
        memberRole: row.member_role ? (String(row.member_role) as BusinessMemberRole) : null,
        membershipStatus: row.membership_status ? (String(row.membership_status) as MembershipStatus) : null,
        subscriptionPlan: String(row.subscription_plan || 'student') as SubscriptionPlan,
        effectivePlan: String(row.effective_plan || 'student') as SubscriptionPlan,
        capabilities,
        leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null,
        updatedAt: String(row.updated_at),
      };
    } catch (error) {
      console.error('[businessStore] Failed to get cached capabilities:', error);
      return null;
    }
  },

  /**
   * Checks if the 24-hour offline Business lease is currently valid.
   */
  isBusinessLeaseActive: (userId: string): boolean => {
    const cached = businessStore.getCachedCapabilities(userId);
    if (!cached || cached.effectivePlan !== 'business' || !cached.leaseExpiresAt) {
      return false;
    }
    const leaseExpiryMs = Date.parse(cached.leaseExpiresAt);
    if (Number.isNaN(leaseExpiryMs)) return false;
    return leaseExpiryMs > Date.now();
  },

  /**
   * Gets the active business session if lease is valid or online.
   */
  getBusinessSession: (userId: string): BusinessSession | null => {
    const cached = businessStore.getCachedCapabilities(userId);
    if (!cached || !cached.businessId || !cached.businessName || !cached.memberRole || !cached.membershipStatus || !cached.leaseExpiresAt) {
      return null;
    }
    return {
      business_id: cached.businessId,
      business_name: cached.businessName,
      member_role: cached.memberRole,
      membership_status: cached.membershipStatus,
      lease_expires_at: cached.leaseExpiresAt,
      capabilities: cached.capabilities,
    };
  },

  /**
   * Saves local business record.
   */
  saveBusiness: (
    business: {
      id: string;
      name: string;
      ownerId: string;
      timezone?: string;
      subscriptionPlan?: string;
      subscriptionStatus?: string;
      seatLimit?: number;
    },
    tx?: DatabaseTransaction
  ): void => {
    const now = new Date().toISOString();
    const sql = `
      INSERT INTO businesses (
        id, name, owner_id, timezone, subscription_plan, subscription_status, seat_limit, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        timezone = excluded.timezone,
        subscription_plan = excluded.subscription_plan,
        subscription_status = excluded.subscription_status,
        seat_limit = excluded.seat_limit,
        updated_at = excluded.updated_at
    `;
    const params = [
      business.id,
      business.name,
      business.ownerId,
      business.timezone || 'UTC',
      business.subscriptionPlan || 'business',
      business.subscriptionStatus || 'active',
      business.seatLimit ?? 5,
      now,
      now,
    ];
    if (tx) {
      tx.executeSync(sql, params);
    } else {
      db.executeSync(sql, params);
    }
  },

  /**
   * Saves or updates a business membership record locally.
   */
  saveMembership: (
    membership: {
      id?: string;
      businessId: string;
      userId: string;
      memberRole: BusinessMemberRole;
      membershipStatus: MembershipStatus;
    },
    tx?: DatabaseTransaction
  ): void => {
    const now = new Date().toISOString();
    const id = membership.id || generateId('mem');
    const sql = `
      INSERT INTO business_memberships (
        id, business_id, user_id, member_role, membership_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        member_role = excluded.member_role,
        membership_status = excluded.membership_status,
        updated_at = excluded.updated_at
    `;
    const params = [
      id,
      membership.businessId,
      membership.userId,
      membership.memberRole,
      membership.membershipStatus,
      now,
      now,
    ];
    if (tx) {
      tx.executeSync(sql, params);
    } else {
      db.executeSync(sql, params);
    }
  },

  /**
   * Retrieves the active business record for a user.
   */
  getBusinessForUser: (userId: string): LocalBusiness | null => {
    const row = db.executeSync(
      `SELECT b.* FROM businesses b
       JOIN business_memberships m ON m.business_id = b.id
       WHERE m.user_id = ? AND m.membership_status = 'active'
       LIMIT 1`,
      [userId]
    ).rows?.[0] as {
      id: string;
      name: string;
      owner_id: string;
      timezone: string;
      subscription_plan: string;
      subscription_status: string;
      seat_limit: number;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      ownerId: row.owner_id,
      timezone: row.timezone,
      subscriptionPlan: row.subscription_plan,
      subscriptionStatus: row.subscription_status,
      seatLimit: row.seat_limit,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  /**
   * Retrieves all active memberships and user emails for a business workspace.
   */
  getMembers: (businessId: string): Array<{
    id: string;
    business_id: string;
    user_id: string;
    email: string;
    member_role: BusinessMemberRole;
    membership_status: MembershipStatus;
  }> => {
    const result = db.executeSync(
      `SELECT m.id, m.business_id, m.user_id, COALESCE(u.email, m.user_id) as email,
              m.member_role, m.membership_status
       FROM business_memberships m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.business_id = ? AND m.membership_status = 'active'`,
      [businessId]
    );
    const rows = result.rows || [];
    return rows.map((r: any) => ({
      id: r.id,
      business_id: r.business_id,
      user_id: r.user_id,
      email: r.email,
      member_role: r.member_role as BusinessMemberRole,
      membership_status: r.membership_status as MembershipStatus,
    }));
  },

  /**
   * Purges all cached data and unsent outbox mutations for a specified business upon confirmed removal.
   */
  purgeBusinessCache: (businessId: string): void => {
    db.transactionSync((tx) => {
      // Purge business-scoped outbox mutations
      tx.executeSync(
        "DELETE FROM sync_outbox WHERE scope_type = 'business' AND scope_id = ?",
        [businessId]
      );
      // Purge business-scoped sync metadata and state
      tx.executeSync(
        "DELETE FROM sync_metadata WHERE scope_type = 'business' AND scope_id = ?",
        [businessId]
      );
      tx.executeSync(
        "DELETE FROM sync_state WHERE scope_type = 'business' AND scope_id = ?",
        [businessId]
      );
      tx.executeSync(
        "DELETE FROM sync_conflicts WHERE scope_type = 'business' AND scope_id = ?",
        [businessId]
      );
      // Purge local memberships and business record
      tx.executeSync(
        'DELETE FROM business_memberships WHERE business_id = ?',
        [businessId]
      );
      tx.executeSync(
        'DELETE FROM business_invitations WHERE business_id = ?',
        [businessId]
      );
      tx.executeSync('DELETE FROM businesses WHERE id = ?', [businessId]);
      // Reset capabilities cache referencing this business
      tx.executeSync(
        `UPDATE business_capabilities_cache SET
           business_id = NULL,
           business_name = NULL,
           member_role = NULL,
           membership_status = NULL,
           effective_plan = 'student',
           capabilities = '[]',
           lease_expires_at = NULL,
           updated_at = ?
         WHERE business_id = ?`,
        [new Date().toISOString(), businessId]
      );
    });
  },
};
