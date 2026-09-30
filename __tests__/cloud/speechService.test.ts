import { createCallSpeechProvider } from '../../src/cloud/speechService';
import { cloudClient } from '../../src/cloud/cloudClient';
import { accountLinkService } from '../../src/cloud/accountLinkService';
import { userStore } from '../../src/storage/userStore';
import { businessStore } from '../../src/storage/businessStore';
import * as ttsService from '../../src/ai/tts/ttsService';
import RNFS from 'react-native-fs';

jest.mock('../../src/cloud/cloudClient');
jest.mock('../../src/cloud/accountLinkService');
jest.mock('../../src/storage/userStore');
jest.mock('../../src/storage/businessStore');
jest.mock('../../src/ai/tts/ttsService');
jest.mock('react-native-fs', () => ({
  CachesDirectoryPath: '/mock/cache/path',
  mkdir: jest.fn().mockResolvedValue(true),
  writeFile: jest.fn().mockResolvedValue(true),
  unlink: jest.fn().mockResolvedValue(true),
  exists: jest.fn().mockResolvedValue(true),
}));

describe('speechService (Cloud CallSpeechProvider)', () => {
  const userId = 'user_pro_123';

  beforeEach(() => {
    jest.clearAllMocks();

    (userStore.getActiveSessionToken as jest.Mock).mockReturnValue({
      userId,
      accessToken: 'valid_access_token',
    });

    (userStore.getUserById as jest.Mock).mockReturnValue({
      id: userId,
      role: 'student_pro',
    });

    (cloudClient.getAccessToken as jest.Mock).mockReturnValue(
      'valid_access_token',
    );
    (cloudClient.isOnline as jest.Mock).mockResolvedValue(true);
    (accountLinkService.refreshCloudProfile as jest.Mock).mockResolvedValue({
      status: 'auth_required',
      message: 'No valid cloud session for refresh.',
    });
    (accountLinkService.completeDeferredCloudLink as jest.Mock).mockResolvedValue({
      status: 'auth_required',
      message: 'No queued cloud link.',
    });
    (ttsService.playSpeechFile as jest.Mock).mockResolvedValue(true);
    (ttsService.speakTextWithTts as jest.Mock).mockResolvedValue(undefined);
  });

  it('plays Gemini Aoede audio when user is eligible, online, and request succeeds', async () => {
    (cloudClient.request as jest.Mock).mockResolvedValue({
      status: 'success',
      data: {
        requestId: 'req_1',
        audioBase64:
          'UklGRgAAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        mimeType: 'audio/wav',
        model: 'gemini-3.1-flash-tts-preview',
        voice: 'Aoede',
        createdAt: '2026-07-28T00:00:00Z',
      },
    });

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello Gemini!');

    expect(cloudClient.request).toHaveBeenCalledWith(
      '/v1/ai/tts',
      expect.objectContaining({
        method: 'POST',
      }),
      true,
    );
    expect(RNFS.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(
        '/mock/cache/path/gemini_tts/gemini_user_pro_123_',
      ),
      expect.any(String),
      'base64',
    );
    expect(ttsService.playSpeechFile).toHaveBeenCalled();
    expect(RNFS.unlink).toHaveBeenCalled();
    expect(result).toEqual({ source: 'gemini' });
  });

  it('prepares Aoede audio once and reuses it after current playback is stopped', async () => {
    let resolveRequest!: (value: unknown) => void;
    const requestPromise = new Promise(resolve => {
      resolveRequest = resolve;
    });
    (cloudClient.request as jest.Mock).mockReturnValue(requestPromise);

    const provider = createCallSpeechProvider(userId);
    const preparation = provider.prepareText?.(
      'Great! Task acknowledged. Have a productive day.',
    );
    await Promise.resolve();
    await Promise.resolve();

    await provider.stopSpeech?.();
    resolveRequest({
      status: 'success',
      data: {
        requestId: 'req_prepared',
        audioBase64:
          'UklGRgAAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        mimeType: 'audio/wav',
        model: 'gemini-3.1-flash-tts-preview',
        voice: 'Aoede',
        createdAt: '2026-07-31T00:00:00Z',
      },
    });
    await preparation;

    const result = await provider.speakText(
      'Great! Task acknowledged. Have a productive day.',
    );

    expect(cloudClient.request).toHaveBeenCalledTimes(1);
    expect(ttsService.playSpeechFile).toHaveBeenCalledWith(
      expect.stringContaining('/mock/cache/path/gemini_tts/'),
    );
    expect(ttsService.speakTextWithTts).not.toHaveBeenCalled();
    expect(RNFS.unlink).not.toHaveBeenCalled();
    expect(result).toEqual({ source: 'gemini' });

    await provider.dispose?.();
    expect(RNFS.unlink).toHaveBeenCalledWith(
      expect.stringContaining('/mock/cache/path/gemini_tts/'),
    );
  });

  it('allows Gemini TTS for a business plan employee', async () => {
    (userStore.getUserById as jest.Mock).mockReturnValue({
      id: userId,
      role: 'student',
    });
    (businessStore.getCachedCapabilities as jest.Mock).mockReturnValue({
      userId,
      effectivePlan: 'business',
      memberRole: 'employee',
    });
    (cloudClient.request as jest.Mock).mockResolvedValue({
      status: 'success',
      data: {
        requestId: 'req_biz',
        audioBase64: 'UklGRgAAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        mimeType: 'audio/wav',
        model: 'gemini-3.1-flash-tts-preview',
        voice: 'Aoede',
        createdAt: '2026-07-28T00:00:00Z',
      },
    });

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello Business Employee!');

    expect(cloudClient.request).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ source: 'gemini' });
  });

  it('falls back to Kokoro when user role is not student_pro', async () => {
    (userStore.getUserById as jest.Mock).mockReturnValue({
      id: userId,
      role: 'student',
    });
    (businessStore.getCachedCapabilities as jest.Mock).mockReturnValue(null);

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello standard user');

    expect(cloudClient.request).not.toHaveBeenCalled();
    expect(ttsService.speakTextWithTts).toHaveBeenCalledWith(
      'Hello standard user',
    );
    expect(result).toEqual({ source: 'kokoro' });
  });

  it('falls back to Kokoro when device is offline', async () => {
    (cloudClient.isOnline as jest.Mock).mockResolvedValue(false);

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello offline');

    expect(cloudClient.request).not.toHaveBeenCalled();
    expect(ttsService.speakTextWithTts).toHaveBeenCalledWith('Hello offline');
    expect(result).toEqual({ source: 'kokoro' });
  });

  it('falls back to pre-cached Kokoro path when cloud request fails', async () => {
    (cloudClient.request as jest.Mock).mockResolvedValue({
      status: 'server_error',
      error: 'FastAPI error',
    });
    (RNFS.exists as jest.Mock).mockResolvedValue(true);

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello server error', {
      fallbackAudioPath: '/mock/cached/path.wav',
    });

    expect(ttsService.playSpeechFile).toHaveBeenCalledWith(
      '/mock/cached/path.wav',
    );
    expect(result).toEqual({ source: 'kokoro' });
  });

  it('does not trigger Kokoro fallback when stopSpeech is called (intentional cancellation)', async () => {
    (cloudClient.request as jest.Mock).mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, 500)),
    );

    const provider = createCallSpeechProvider(userId);
    const speakPromise = provider.speakText('Slow request');

    // Cancel in-flight request
    await provider.stopSpeech!();
    const result = await speakPromise;

    expect(ttsService.speakTextWithTts).not.toHaveBeenCalled();
    expect(result).toEqual({ source: 'gemini' });
  });

  it('checks connectivity first and short-circuits offline before reading token or role', async () => {
    (cloudClient.isOnline as jest.Mock).mockResolvedValue(false);

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello offline short-circuit');

    expect(cloudClient.isOnline).toHaveBeenCalled();
    expect(cloudClient.request).not.toHaveBeenCalled();
    // Connectivity-first: offline must not even consult the token/role stores.
    expect(userStore.getActiveSessionToken).not.toHaveBeenCalled();
    expect(userStore.getUserById).not.toHaveBeenCalled();
    expect(ttsService.speakTextWithTts).toHaveBeenCalledWith(
      'Hello offline short-circuit',
    );
    expect(result).toEqual({ source: 'kokoro' });
  });

  it('does not attempt Gemini for an admin role (backend /v1/ai/tts excludes admin)', async () => {
    (userStore.getUserById as jest.Mock).mockReturnValue({
      id: userId,
      role: 'admin',
    });
    (businessStore.getCachedCapabilities as jest.Mock).mockReturnValue(null);

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello admin');

    expect(cloudClient.request).not.toHaveBeenCalled();
    expect(ttsService.speakTextWithTts).toHaveBeenCalledWith('Hello admin');
    expect(result).toEqual({ source: 'kokoro' });
  });

  it('refreshes a stale local role from the backend before requesting Gemini', async () => {
    let role = 'student';
    (userStore.getUserById as jest.Mock).mockImplementation(() => ({
      id: userId,
      role,
    }));
    (businessStore.getCachedCapabilities as jest.Mock).mockReturnValue(null);
    (accountLinkService.refreshCloudProfile as jest.Mock).mockImplementation(
      async () => {
        role = 'student_pro';
        return { status: 'success', role: 'student_pro', message: 'synced' };
      },
    );
    (cloudClient.request as jest.Mock).mockResolvedValue({
      status: 'success',
      data: {
        requestId: 'req_refresh',
        audioBase64: 'UklGRgAAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        mimeType: 'audio/wav',
        model: 'gemini-3.1-flash-tts-preview',
        voice: 'Aoede',
        createdAt: '2026-07-28T00:00:00Z',
      },
    });

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello upgraded account!');

    expect(accountLinkService.refreshCloudProfile).toHaveBeenCalledWith(userId);
    expect(cloudClient.request).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ source: 'gemini' });
  });

  it('stays on Kokoro when the refreshed profile is still not entitled', async () => {
    (userStore.getUserById as jest.Mock).mockReturnValue({
      id: userId,
      role: 'student',
    });
    (businessStore.getCachedCapabilities as jest.Mock).mockReturnValue(null);
    (accountLinkService.refreshCloudProfile as jest.Mock).mockResolvedValue({
      status: 'success',
      role: 'student',
      message: 'synced',
    });

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello plain student');

    expect(cloudClient.request).not.toHaveBeenCalled();
    expect(ttsService.speakTextWithTts).toHaveBeenCalledWith(
      'Hello plain student',
    );
    expect(result).toEqual({ source: 'kokoro' });
  });

  it('attempts a deferred FastAPI link before falling back without a session token', async () => {
    (userStore.getActiveSessionToken as jest.Mock).mockReturnValue({
      userId,
      accessToken: null,
    });
    (cloudClient.getAccessToken as jest.Mock).mockReturnValue(null);
    (userStore.getUserById as jest.Mock).mockReturnValue({
      id: userId,
      role: 'student',
    });

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello unauthenticated');

    expect(accountLinkService.completeDeferredCloudLink).toHaveBeenCalledWith(
      userId,
    );
    expect(accountLinkService.refreshCloudProfile).not.toHaveBeenCalled();
    expect(ttsService.speakTextWithTts).toHaveBeenCalledWith(
      'Hello unauthenticated',
    );
    expect(result).toEqual({ source: 'kokoro' });
  });

  it('uses Gemini when deferred FastAPI linking restores the session token', async () => {
    let accessToken: string | null = null;
    (userStore.getActiveSessionToken as jest.Mock).mockImplementation(() => ({
      userId,
      accessToken,
    }));
    (cloudClient.getAccessToken as jest.Mock).mockImplementation(
      () => accessToken,
    );
    (accountLinkService.completeDeferredCloudLink as jest.Mock).mockImplementation(
      async () => {
        accessToken = 'restored-access-token';
        return {
          status: 'success',
          localUserId: userId,
          role: 'student_pro',
          message: 'FastAPI link restored.',
        };
      },
    );
    (cloudClient.request as jest.Mock).mockResolvedValue({
      status: 'success',
      data: {
        requestId: 'req_relinked',
        audioBase64:
          'UklGRgAAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
        mimeType: 'audio/wav',
        model: 'gemini-3.1-flash-tts-preview',
        voice: 'Aoede',
        createdAt: '2026-08-26T00:00:00Z',
      },
    });

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello after reconnect');

    expect(accountLinkService.completeDeferredCloudLink).toHaveBeenCalledWith(
      userId,
    );
    expect(cloudClient.request).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ source: 'gemini' });
  });

  it('does not use a cloud token that belongs to a different local user', async () => {
    (userStore.getActiveSessionToken as jest.Mock).mockReturnValue({
      userId: 'different_user',
      accessToken: 'different_user_token',
    });
    (cloudClient.getAccessToken as jest.Mock).mockReturnValue(
      'different_user_token',
    );

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello wrong session');

    expect(cloudClient.getAccessToken).not.toHaveBeenCalled();
    expect(accountLinkService.refreshCloudProfile).not.toHaveBeenCalled();
    expect(cloudClient.request).not.toHaveBeenCalled();
    expect(ttsService.speakTextWithTts).toHaveBeenCalledWith(
      'Hello wrong session',
    );
    expect(result).toEqual({ source: 'kokoro' });
  });

  it('falls back to Kokoro when disconnected regardless of role', async () => {
    (cloudClient.isOnline as jest.Mock).mockResolvedValue(false);
    (userStore.getUserById as jest.Mock).mockReturnValue({
      id: userId,
      role: 'student',
    });

    const provider = createCallSpeechProvider(userId);
    const result = await provider.speakText('Hello offline student');

    expect(cloudClient.request).not.toHaveBeenCalled();
    expect(result).toEqual({ source: 'kokoro' });
  });
});
