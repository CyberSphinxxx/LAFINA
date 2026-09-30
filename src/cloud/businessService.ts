import { cloudClient, CloudResult } from './cloudClient';
import { normalizeEmail } from '../storage/authUtils';
import { businessStore } from '../storage/businessStore';
import { userStore } from '../storage/userStore';
import type {
  BusinessMemberRole,
  BusinessSession,
  MembershipStatus,
} from '../storage/syncTypes';

export interface BusinessMemberData {
  user_id: string;
  email: string;
  member_role: BusinessMemberRole;
  membership_status: MembershipStatus;
  joined_at: string;
}

export interface BusinessInvitationData {
  id: string;
  business_id: string;
  business_name: string;
  invited_by: string;
  email: string;
  member_role: BusinessMemberRole;
  status: string;
  expires_at: string;
  created_at: string;
}

export interface BusinessDetailData {
  id: string;
  name: string;
  owner_id: string;
  timezone: string;
  subscription_plan: string;
  subscription_status: string;
  seat_limit: number;
  active_seats: number;
  my_role: BusinessMemberRole;
  my_status: MembershipStatus;
  members: BusinessMemberData[];
  pending_invitations: BusinessInvitationData[];
  created_at: string;
}

export const businessService = {
  /**
   * Creates a new business organization workspace.
   */
  createBusiness: async (
    name: string,
    timezone: string = 'UTC'
  ): Promise<CloudResult<BusinessDetailData>> => {
    const trimmed = name.trim();
    if (!trimmed) {
      return { status: 'validation_error', error: 'Business name cannot be empty.' };
    }
    const res = await cloudClient.request<BusinessDetailData>(
      '/v1/businesses',
      {
        method: 'POST',
        body: JSON.stringify({ name: trimmed, timezone }),
      },
      true
    );

    if (res.status === 'success' && res.data) {
      const activeSession = userStore.getActiveSessionToken();
      if (activeSession.userId) {
        businessStore.saveBusiness({
          id: res.data.id,
          name: res.data.name,
          ownerId: res.data.owner_id,
          timezone: res.data.timezone,
          subscriptionPlan: res.data.subscription_plan,
          subscriptionStatus: res.data.subscription_status,
          seatLimit: res.data.seat_limit,
        });
        businessStore.saveMembership({
          businessId: res.data.id,
          userId: activeSession.userId,
          memberRole: 'manager',
          membershipStatus: 'active',
        });
        const leaseExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        businessStore.saveCachedCapabilities(
          activeSession.userId,
          'business',
          'business',
          {
            business_id: res.data.id,
            business_name: res.data.name,
            member_role: 'manager',
            membership_status: 'active',
            lease_expires_at: leaseExpires,
            capabilities: ['business_core', 'business_chat', 'meeting_summary', 'gmail'],
          }
        );
      }
    }
    return res;
  },

  /**
   * Fetches details and member roster of the current active business.
   */
  getCurrentBusiness: async (): Promise<CloudResult<BusinessDetailData>> => {
    const res = await cloudClient.request<BusinessDetailData>(
      '/v1/businesses/current',
      { method: 'GET' },
      true
    );
    if (res.status === 'success' && res.data) {
      const activeSession = userStore.getActiveSessionToken();
      if (activeSession.userId) {
        businessStore.saveBusiness({
          id: res.data.id,
          name: res.data.name,
          ownerId: res.data.owner_id,
          timezone: res.data.timezone,
          subscriptionPlan: res.data.subscription_plan,
          subscriptionStatus: res.data.subscription_status,
          seatLimit: res.data.seat_limit,
        });
      }
    }
    return res;
  },

  /**
   * Invites a registered user by email to join the business.
   */
  createInvitation: async (
    businessId: string,
    email: string,
    memberRole: BusinessMemberRole = 'employee'
  ): Promise<CloudResult<BusinessInvitationData>> => {
    const normalized = normalizeEmail(email);
    return await cloudClient.request<BusinessInvitationData>(
      `/v1/businesses/${businessId}/invitations`,
      {
        method: 'POST',
        body: JSON.stringify({ email: normalized, member_role: memberRole }),
      },
      true
    );
  },

  /**
   * Lists pending invitations for a specific business (manager view).
   */
  listBusinessInvitations: async (
    businessId: string
  ): Promise<CloudResult<BusinessInvitationData[]>> => {
    return await cloudClient.request<BusinessInvitationData[]>(
      `/v1/businesses/${businessId}/invitations`,
      { method: 'GET' },
      true
    );
  },

  /**
   * Lists pending invitations sent to the authenticated user's email.
   */
  listMyInvitations: async (): Promise<CloudResult<BusinessInvitationData[]>> => {
    return await cloudClient.request<BusinessInvitationData[]>(
      '/v1/businesses/invitations/my',
      { method: 'GET' },
      true
    );
  },

  /**
   * Accepts an invitation to join an organization.
   */
  acceptInvitation: async (
    invitationId: string
  ): Promise<CloudResult<BusinessSession>> => {
    const res = await cloudClient.request<BusinessSession>(
      `/v1/businesses/invitations/${invitationId}/accept`,
      { method: 'POST' },
      true
    );
    if (res.status === 'success' && res.data) {
      const activeSession = userStore.getActiveSessionToken();
      if (activeSession.userId) {
        businessStore.saveCachedCapabilities(
          activeSession.userId,
          'student',
          'business',
          res.data
        );
        businessStore.saveBusiness({
          id: res.data.business_id,
          name: res.data.business_name,
          ownerId: '',
        });
        businessStore.saveMembership({
          businessId: res.data.business_id,
          userId: activeSession.userId,
          memberRole: res.data.member_role,
          membershipStatus: res.data.membership_status,
        });
      }
    }
    return res;
  },

  /**
   * Declines an invitation.
   */
  declineInvitation: async (
    invitationId: string
  ): Promise<CloudResult<{ detail: string }>> => {
    return await cloudClient.request<{ detail: string }>(
      `/v1/businesses/invitations/${invitationId}/decline`,
      { method: 'POST' },
      true
    );
  },

  /**
   * Cancels a pending invitation.
   */
  cancelInvitation: async (
    businessId: string,
    invitationId: string
  ): Promise<CloudResult<{ detail: string }>> => {
    return await cloudClient.request<{ detail: string }>(
      `/v1/businesses/${businessId}/invitations/${invitationId}`,
      { method: 'DELETE' },
      true
    );
  },

  /**
   * Suspends or removes a team member.
   */
  updateMemberStatus: async (
    businessId: string,
    userId: string,
    status: MembershipStatus
  ): Promise<CloudResult<{ detail: string }>> => {
    return await cloudClient.request<{ detail: string }>(
      `/v1/businesses/${businessId}/members/${userId}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
      true
    );
  },

  /**
   * Promotes or demotes a team member (owner only).
   */
  updateMemberRole: async (
    businessId: string,
    userId: string,
    role: BusinessMemberRole
  ): Promise<CloudResult<{ detail: string }>> => {
    return await cloudClient.request<{ detail: string }>(
      `/v1/businesses/${businessId}/members/${userId}/role`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      },
      true
    );
  },
};
