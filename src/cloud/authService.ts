import { cloudClient, CloudResult } from './cloudClient';
import { normalizeEmail, validatePassword } from '../storage/authUtils';
import { userStore } from '../storage/userStore';
import { businessStore } from '../storage/businessStore';
import type {
  BusinessSession,
  SubscriptionPlan,
  SystemRole,
} from '../storage/syncTypes';

export interface AuthResponseData {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
  email: string;
  role: string;
  system_role?: SystemRole;
  subscription_plan?: SubscriptionPlan;
  recovery_codes?: string[];
}

export interface UserProfileData {
  id: string;
  email: string;
  role: string;
  system_role?: SystemRole;
  subscription_plan?: SubscriptionPlan;
  effective_subscription_plan?: SubscriptionPlan;
  business_session?: BusinessSession | null;
  is_active: boolean;
  created_at: string;
}

export const authService = {
  /** Registers a normalized FastAPI account without creating a local account. */
  register: async (email: string, password: string): Promise<CloudResult<AuthResponseData>> => {
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return {
        status: 'validation_error',
        error: passwordValidation.error || 'Password validation failed.',
      };
    }
    const res = await cloudClient.request<AuthResponseData>(
      '/v1/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email: normalizeEmail(email), password }),
      },
      false
    );
    return res;
  },

  /** Authenticates a normalized FastAPI account without changing the local password hash. */
  login: async (email: string, password: string, deviceInfo?: string): Promise<CloudResult<AuthResponseData>> => {
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return {
        status: 'validation_error',
        error: passwordValidation.error || 'Password validation failed.',
      };
    }
    const res = await cloudClient.request<AuthResponseData>(
      '/v1/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email: normalizeEmail(email), password, device_info: deviceInfo || 'Android Client' }),
      },
      false
    );
    return res;
  },

  /** Rotates the active FastAPI session and re-encrypts its refresh token. */
  refresh: async (refreshToken: string): Promise<CloudResult<AuthResponseData>> => {
    const res = await cloudClient.request<AuthResponseData>(
      '/v1/auth/refresh',
      {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
      false
    );
    if (res.status === 'success' && res.data) {
      const activeSession = userStore.getActiveSessionToken();
      if (!activeSession.userId) {
        return { status: 'auth_required', error: 'No active local account is available.' };
      }
      await cloudClient.establishSession(
        activeSession.userId, res.data.access_token, res.data.refresh_token
      );
    }
    return res;
  },

  /** Revokes the remote session when possible and always clears local cloud tokens. */
  logout: async (): Promise<CloudResult<null>> => {
    try {
      return await cloudClient.request<null>('/v1/auth/logout', { method: 'POST' }, true);
    } finally {
      cloudClient.clearActiveSession();
    }
  },

  /** Fetches the live FastAPI profile, renewing an expired access token once. */
  getMe: async (): Promise<CloudResult<UserProfileData>> => {
    const requestProfile = (): Promise<CloudResult<UserProfileData>> =>
      cloudClient.request<UserProfileData>('/v1/auth/me', { method: 'GET' }, true);

    const handleProfileSuccess = (result: CloudResult<UserProfileData>): CloudResult<UserProfileData> => {
      if (result.status === 'success' && result.data) {
        const activeSession = userStore.getActiveSessionToken();
        if (activeSession.userId) {
          businessStore.saveCachedCapabilities(
            activeSession.userId,
            result.data.subscription_plan || 'student',
            result.data.effective_subscription_plan || 'student',
            result.data.business_session || null
          );
          if (result.data.business_session) {
            businessStore.saveBusiness({
              id: result.data.business_session.business_id,
              name: result.data.business_session.business_name,
              ownerId: result.data.id,
            });
            businessStore.saveMembership({
              businessId: result.data.business_session.business_id,
              userId: activeSession.userId,
              memberRole: result.data.business_session.member_role,
              membershipStatus: result.data.business_session.membership_status,
            });
          }
        }
      }
      return result;
    };

    const initialResult = await requestProfile();
    if (initialResult.status !== 'auth_required') {
      return handleProfileSuccess(initialResult);
    }

    let refreshToken: string | null = null;
    try {
      refreshToken = await cloudClient.getEncryptedRefreshToken();
    } catch {
      cloudClient.clearActiveSession();
      return {
        status: 'auth_required',
        error: 'Refresh-token renewal failed. Sign in again while online.',
      };
    }
    if (!refreshToken) {
      cloudClient.clearActiveSession();
      return initialResult;
    }

    let refreshResult: CloudResult<AuthResponseData>;
    try {
      refreshResult = await authService.refresh(refreshToken);
    } catch {
      cloudClient.clearActiveSession();
      return {
        status: 'auth_required',
        error: 'Refresh-token renewal failed. Sign in again while online.',
      };
    }
    if (refreshResult.status !== 'success') {
      cloudClient.clearActiveSession();
      return {
        status: 'auth_required',
        error: 'Refresh-token renewal failed. Sign in again while online.',
      };
    }

    const renewedProfile = await requestProfile();
    if (renewedProfile.status === 'auth_required') {
      cloudClient.clearActiveSession();
      return {
        status: 'auth_required',
        error: 'Cloud authentication expired. Sign in again while online.',
      };
    }
    return handleProfileSuccess(renewedProfile);
  },
};
