import { authService } from '../../src/cloud/authService';
import type { AuthResponseData } from '../../src/cloud/authService';
import { cloudClient } from '../../src/cloud/cloudClient';
import { userStore } from '../../src/storage/userStore';
import { initDatabase } from '../../src/storage/dbInit';

describe('authService profile refresh', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renews an expired access token before fetching the live role', async () => {
    const refreshedSession: AuthResponseData = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      token_type: 'bearer',
      expires_in: 900,
      user_id: 'cloud-account-id',
      email: 'noel@gmail.com',
      role: 'student_pro',
    };

    jest
      .spyOn(cloudClient, 'request')
      .mockResolvedValueOnce({
        status: 'auth_required',
        error: 'Session expired.',
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: refreshedSession,
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          id: 'cloud-account-id',
          email: 'noel@gmail.com',
          role: 'student_pro',
          is_active: true,
          created_at: '2026-07-23T00:00:00+00:00',
        },
      });
    jest
      .spyOn(cloudClient, 'getEncryptedRefreshToken')
      .mockResolvedValue('existing-refresh-token');
    jest
      .spyOn(userStore, 'getActiveSessionToken')
      .mockReturnValue({ userId: 'local-user-id', accessToken: 'old', refreshToken: 'encrypted' });
    jest
      .spyOn(cloudClient, 'establishSession')
      .mockResolvedValue();

    const result = await authService.getMe();

    expect(result.status).toBe('success');
    expect(result.data?.role).toBe('student_pro');
    expect(cloudClient.request).toHaveBeenNthCalledWith(
      2,
      '/v1/auth/refresh',
      {
        method: 'POST',
        body: JSON.stringify({ refresh_token: 'existing-refresh-token' }),
      },
      false
    );
    expect(cloudClient.request).toHaveBeenNthCalledWith(
      3,
      '/v1/auth/me',
      { method: 'GET' },
      true
    );
  });

  it('returns auth_required when no refresh token exists', async () => {
    jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'auth_required',
      error: 'Authentication required.',
    });
    jest
      .spyOn(cloudClient, 'getEncryptedRefreshToken')
      .mockResolvedValue(null);
    jest.spyOn(cloudClient, 'clearActiveSession').mockImplementation(() => {});

    const result = await authService.getMe();

    expect(result.status).toBe('auth_required');
    expect(cloudClient.request).toHaveBeenCalledTimes(1);
  });
});
