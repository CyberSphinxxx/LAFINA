/**
 * What the app says when LAFINA's server cannot be reached. React Native
 * reports every such failure as "Network request failed", so the cloud client
 * checks the cause itself — most often a network whose DNS has stopped
 * answering while the connection is up, as on an emulator that outlived the
 * network it started on.
 */
import { NativeModules, Platform } from 'react-native';
import { cloudClient } from '../../src/cloud/cloudClient';
import { accountLinkService } from '../../src/cloud/accountLinkService';
import { authService } from '../../src/cloud/authService';
import { initDatabase } from '../../src/storage/dbInit';

const platform = Platform as { OS: string };
const originalOS = platform.OS;
const realFetch = global.fetch;

/** Runs as Android does, with this answer from the native DNS check. */
const onAndroid = (canResolve?: (host: string) => Promise<boolean>) => {
  platform.OS = 'android';
  const module = { isOnline: jest.fn(async () => true), ...(canResolve ? { canResolve: jest.fn(canResolve) } : {}) };
  (NativeModules as Record<string, unknown>).AndroidConnectivityModule = module;
  return module;
};

const failingFetch = () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as typeof fetch;
};

describe('cloud connection errors', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    cloudClient.setBaseUrl('https://lafina.onrender.com');
  });

  afterEach(() => {
    platform.OS = originalOS;
    delete (NativeModules as Record<string, unknown>).AndroidConnectivityModule;
    global.fetch = realFetch;
    cloudClient.resetBaseUrls();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('says the DNS is not answering when the server name cannot be looked up', async () => {
    const module = onAndroid(async () => false);
    failingFetch();

    const result = await cloudClient.request('/v1/auth/login', { method: 'POST' }, false);

    expect(result.status).toBe('server_unavailable');
    expect(result.error).toContain("can't look up lafina.onrender.com");
    expect(result.error).toContain("DNS isn't answering");
    expect(module.canResolve).toHaveBeenCalledWith('lafina.onrender.com');
  });

  it('treats a lookup that never answers as a DNS failure', async () => {
    jest.useFakeTimers();
    onAndroid(() => new Promise<boolean>(() => undefined));
    failingFetch();

    const pending = cloudClient.request('/v1/auth/me', {}, false);
    await jest.advanceTimersByTimeAsync(5_000);

    expect((await pending).error).toContain("DNS isn't answering");
  });

  it('says the server did not answer when the name resolves', async () => {
    onAndroid(async () => true);
    failingFetch();

    const result = await cloudClient.request('/v1/auth/login', { method: 'POST' }, false);

    expect(result).toMatchObject({
      status: 'server_unavailable',
      error: "LAFINA's server at lafina.onrender.com didn't answer (Network request failed).",
    });
  });

  it('still explains itself on an APK without the DNS check', async () => {
    onAndroid();
    failingFetch();

    const result = await cloudClient.request('/v1/auth/login', { method: 'POST' }, false);

    expect(result.error).toBe("LAFINA's server at lafina.onrender.com didn't answer (Network request failed).");
  });

  it('passes on what the server said when it fails', async () => {
    onAndroid(async () => true);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({ detail: 'relation "security_events" does not exist' }),
    }) as unknown as typeof fetch;

    const result = await cloudClient.request('/v1/auth/login', { method: 'POST' }, false);

    expect(result.status).toBe('server_error');
    expect(result.error).toContain('500 on /v1/auth/login');
    expect(result.error).toContain('relation "security_events" does not exist');
  });
});

describe('sign-in message when the server cannot be reached', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  afterEach(() => {
    platform.OS = originalOS;
    delete (NativeModules as Record<string, unknown>).AndroidConnectivityModule;
    jest.restoreAllMocks();
  });

  it('names the cause instead of a bare "could not be reached"', async () => {
    onAndroid(async () => false);
    const cause = "This device can't look up lafina.onrender.com: the connection is up, but its DNS isn't answering.";
    jest.spyOn(authService, 'register').mockResolvedValue({ status: 'server_unavailable', error: cause });

    const result = await accountLinkService.registerCloudFirst({
      username: 'Student',
      email: 'dns-check@ustp.edu.ph',
      password: 'valid-password',
    });

    expect(result.status).toBe('server_unavailable');
    expect(result.message).toBe(`${cause} The cloud account was not linked.`);
    expect(result.detail).toBe(cause);
  });
});
