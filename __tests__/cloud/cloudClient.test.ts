import {
  CLOUD_API_BASE_URL,
  LOCAL_API_BASE_URL,
  cloudClient,
  setMockOnlineState,
} from '../../src/cloud/cloudClient';
import { userStore } from '../../src/storage/userStore';
import { secureKeystore } from '../../src/utils/keystore';

describe('cloudClient', () => {
  afterEach(() => {
    cloudClient.resetBaseUrls();
    jest.restoreAllMocks();
  });

  it('uses the deployed Render API as the primary endpoint', () => {
    expect(cloudClient.getBaseUrl()).toBe(CLOUD_API_BASE_URL);
  });

  it('falls back to the local FastAPI server when Render is unreachable', async () => {
    setMockOnlineState(true);
    const mockFetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Render unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ status: 'ok' }),
      });
    global.fetch = mockFetch as typeof fetch;

    const result = await cloudClient.request<{ status: string }>('/healthz', {}, false);

    expect(result).toEqual({
      status: 'success',
      data: { status: 'ok' },
      httpStatus: 200,
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      `${CLOUD_API_BASE_URL}/healthz`,
      expect.any(Object)
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      `${LOCAL_API_BASE_URL}/healthz`,
      expect.any(Object)
    );
  });

  it('returns offline status when device is offline', async () => {
    setMockOnlineState(false);
    const result = await cloudClient.request('/v1/me', {}, false);
    expect(result.status).toBe('offline');
    expect(result.error).toContain('offline');
  });

  it('returns auth_required when token is missing for protected endpoints', async () => {
    setMockOnlineState(true);
    cloudClient.setAccessToken(null);
    const result = await cloudClient.request('/v1/me', {}, true);
    expect(result.status).toBe('auth_required');
  });

  it('handles 403 response as subscription_required status', async () => {
    setMockOnlineState(true);
    cloudClient.setAccessToken('mock_token');
    const mockFetch = jest.fn().mockResolvedValue({
      status: 403,
      json: jest.fn().mockResolvedValue({ detail: 'Online AI requires a student_pro subscription.' }),
    });
    global.fetch = mockFetch as any;

    const result = await cloudClient.request('/v1/ai/chat', { method: 'POST' }, true);
    expect(result.status).toBe('subscription_required');
    expect(result.error).toContain('student_pro');
  });

  it('encrypts a refresh token at rest and decrypts it for renewal', async () => {
    jest.spyOn(userStore, 'getActiveSessionToken').mockReturnValue({
      userId: 'local-user-id',
      accessToken: 'access-token',
      refreshToken: 'encrypted-refresh-token',
    });
    const saveSessionTokens = jest
      .spyOn(userStore, 'saveSessionTokens')
      .mockImplementation(() => {});
    jest
      .spyOn(secureKeystore, 'encryptString')
      .mockResolvedValue('encrypted-refresh-token');
    jest
      .spyOn(secureKeystore, 'decryptString')
      .mockResolvedValue('plain-refresh-token');

    await cloudClient.storeEncryptedRefreshToken('plain-refresh-token');
    const restoredToken = await cloudClient.getEncryptedRefreshToken();

    expect(saveSessionTokens).toHaveBeenCalledWith(
      'local-user-id', expect.anything(), 'encrypted-refresh-token'
    );
    expect(restoredToken).toBe('plain-refresh-token');
  });
});
