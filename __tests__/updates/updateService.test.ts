import { createUpdateService } from '../../src/updates/updateService';
import type {
  ApkDownloadRequest,
  DownloadProgress,
  DownloadRequest,
  InstallStatus,
  NativeUpdater,
  UpdaterInfo,
} from '../../src/updates/nativeUpdater';
import type { UpdateConfig } from '../../src/updates/updateConfig';

const CONFIG: UpdateConfig = {
  owner: 'LAFINA-AI',
  repo: 'LAFINA',
  product: 'com.lafina',
  manifestAsset: 'lafina-update-android.json',
  publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE',
};
const MANIFEST_URL = 'https://github.com/LAFINA-AI/LAFINA/releases/latest/download/lafina-update-android.json';
const NOTES_URL = 'https://api.github.com/repos/LAFINA-AI/LAFINA/releases/latest';

const manifestJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema: 1,
    product: 'com.lafina',
    version: '1.0.1',
    platform: 'android',
    nativeVersionCode: 5,
    file: 'lafina-android-bundle-1.0.1.zip',
    size: 2048,
    sha256: 'b'.repeat(64),
    signedAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  });

/** The published asset; the fake native side accepts only the signature "good". */
const published = (overrides: Record<string, unknown> = {}, signature = 'Z29vZA=='): string =>
  JSON.stringify({ payload: Buffer.from(manifestJson(overrides)).toString('base64'), signature });

const response = (status: number, body: string): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
    json: async () => JSON.parse(body),
  }) as unknown as Response;

const fakeFetch = (routes: Record<string, Response | Error>) =>
  jest.fn(async (url: RequestInfo | URL) => {
    const route = routes[String(url)];
    if (!route) return response(404, '{}');
    if (route instanceof Error) throw route;
    return route;
  });

const fakeNative = (info: Partial<UpdaterInfo> = {}) => {
  let progressListener: ((progress: DownloadProgress) => void) | null = null;
  const native: jest.Mocked<NativeUpdater> = {
    getInfo: jest.fn(async () => ({
      nativeVersionCode: 5,
      nativeVersionName: '1.0.0',
      isDebug: false,
      runningVersion: null,
      pendingVersion: null,
      rejectedVersions: [],
      ...info,
    })),
    verifyManifest: jest.fn(async (payload: string, signature: string, _publicKey: string) => {
      if (Buffer.from(signature, 'base64').toString() !== 'good') throw Object.assign(new Error('bad'), { code: 'E_SIGNATURE' });
      return Buffer.from(payload, 'base64').toString('utf8');
    }),
    downloadBundle: jest.fn(async (_request: DownloadRequest) => {
      progressListener?.({ received: 1024, total: 2048 });
      return true;
    }),
    cancelDownload: jest.fn(),
    markLaunchSuccessful: jest.fn(async () => true),
    restart: jest.fn(async () => true),
    onProgress: jest.fn((listener: (progress: DownloadProgress) => void) => {
      progressListener = listener;
      return { remove: jest.fn(() => (progressListener = null)) };
    }),
  };
  return native;
};

const serviceWith = (
  routes: Record<string, Response | Error>,
  native: NativeUpdater | null = fakeNative(),
  config: UpdateConfig = CONFIG,
) => createUpdateService({ config, currentVersion: '1.0.0', native, fetchImpl: fakeFetch(routes) as unknown as typeof fetch });

describe('in-app updates', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('setup', () => {
    it('is unsupported without the native updater', async () => {
      const service = serviceWith({}, null);
      expect(service.getState().phase).toBe('unsupported');
      expect((await service.check()).phase).toBe('unsupported');
    });

    it('is unsupported without a release key', () => {
      const service = serviceWith({}, fakeNative(), { ...CONFIG, publicKey: '' });
      expect(service.getState()).toMatchObject({ phase: 'unsupported', message: 'Updates are not set up for this build.' });
    });
  });

  describe('checking', () => {
    it('offers a newer bundle for this APK build, with its notes', async () => {
      const service = serviceWith({
        [MANIFEST_URL]: response(200, published()),
        [NOTES_URL]: response(200, JSON.stringify({ body: 'Faster calendar', assets: [{ name: 'lafina-android-bundle-1.0.1.zip' }] })),
      });
      expect(await service.check()).toMatchObject({ phase: 'available', version: '1.0.1', notes: 'Faster calendar' });
    });

    it('leaves out notes that belong to a different release', async () => {
      const service = serviceWith({
        [MANIFEST_URL]: response(200, published()),
        [NOTES_URL]: response(200, JSON.stringify({ body: 'Other', assets: [{ name: 'something-else.zip' }] })),
      });
      expect(await service.check()).toMatchObject({ phase: 'available', notes: null });
    });

    it('still offers the update when the notes cannot be read', async () => {
      const service = serviceWith({ [MANIFEST_URL]: response(200, published()), [NOTES_URL]: response(403, '{}') });
      expect(await service.check()).toMatchObject({ phase: 'available', notes: null });
    });

    it('is up to date when there is no release', async () => {
      expect((await serviceWith({}).check()).phase).toBe('up-to-date');
    });

    it('never offers the same or an older version', async () => {
      const service = serviceWith({ [MANIFEST_URL]: response(200, published({ version: '1.0.0' })) });
      expect((await service.check()).phase).toBe('up-to-date');
    });

    it('refuses a manifest whose signature fails', async () => {
      const service = serviceWith({ [MANIFEST_URL]: response(200, published({}, Buffer.from('forged').toString('base64'))) });
      const state = await service.check();
      expect(state.phase).toBe('error');
      expect(state.message).toContain('bad signature');
    });

    it('refuses a manifest signed for another app', async () => {
      const service = serviceWith({ [MANIFEST_URL]: response(200, published({ product: 'com.lafina.personal' })) });
      expect((await service.check()).message).toContain('signed for another app');
    });

    it('sends a release for a newer APK build to the release page', async () => {
      const service = serviceWith({ [MANIFEST_URL]: response(200, published({ nativeVersionCode: 6 })) });
      expect(await service.check()).toMatchObject({
        phase: 'needs-install',
        version: '1.0.1',
        releaseUrl: 'https://github.com/LAFINA-AI/LAFINA/releases/latest',
      });
    });

    it('ignores a bundle made for an older APK build', async () => {
      const service = serviceWith({ [MANIFEST_URL]: response(200, published({ nativeVersionCode: 4 })) });
      expect((await service.check()).phase).toBe('up-to-date');
    });

    it('does not offer a version that was rolled back, and says why', async () => {
      const service = serviceWith(
        { [MANIFEST_URL]: response(200, published()) },
        fakeNative({ rejectedVersions: ['1.0.1'] }),
      );
      const state = await service.check();
      expect(state.phase).toBe('up-to-date');
      expect(state.message).toContain('did not start properly');
    });

    it('picks up a download that is already waiting for a restart', async () => {
      const service = serviceWith({ [MANIFEST_URL]: response(200, published()) }, fakeNative({ pendingVersion: '1.0.1' }));
      expect((await service.check()).phase).toBe('ready');
    });

    it('reports a network failure on a manual check', async () => {
      const service = serviceWith({ [MANIFEST_URL]: new Error('offline') });
      expect(await service.check()).toMatchObject({ phase: 'error', message: expect.stringContaining('Could not reach GitHub') });
    });

    it('stays quiet when a background check fails or finds nothing', async () => {
      expect((await serviceWith({ [MANIFEST_URL]: new Error('offline') }).check({ quiet: true })).phase).toBe('idle');
      expect((await serviceWith({}).check({ quiet: true })).phase).toBe('idle');
    });
  });

  describe('downloading and restarting', () => {
    const available = async (native = fakeNative()) => {
      const service = serviceWith({ [MANIFEST_URL]: response(200, published()) }, native);
      await service.check();
      return service;
    };

    it('downloads the signed file with its signed size and hash, reporting progress', async () => {
      const native = fakeNative();
      const service = await available(native);
      const seen: Array<number | null> = [];
      service.subscribe((state) => seen.push(state.percent));

      expect((await service.download()).phase).toBe('ready');
      expect(native.downloadBundle).toHaveBeenCalledWith({
        url: 'https://github.com/LAFINA-AI/LAFINA/releases/latest/download/lafina-android-bundle-1.0.1.zip',
        version: '1.0.1',
        nativeVersionCode: 5,
        size: 2048,
        sha256: 'b'.repeat(64),
      });
      expect(seen).toContain(50);
      expect(native.onProgress.mock.results[0].value.remove).toHaveBeenCalled();
    });

    it('goes back to the offer when the download is cancelled', async () => {
      const native = fakeNative();
      native.downloadBundle.mockRejectedValueOnce(Object.assign(new Error('The update was cancelled.'), { code: 'E_CANCELLED' }));
      const service = await available(native);
      expect((await service.download()).phase).toBe('available');
    });

    it('says why a download was discarded', async () => {
      const native = fakeNative();
      native.downloadBundle.mockRejectedValueOnce(
        Object.assign(new Error('The update did not match its signed checksum, so it was discarded.'), { code: 'E_VERIFY' }),
      );
      const service = await available(native);
      expect(await service.download()).toMatchObject({ phase: 'error', message: expect.stringContaining('signed checksum') });
    });

    it('restarts into the downloaded version', async () => {
      const native = fakeNative();
      const service = await available(native);
      await service.download();
      await service.restart();
      expect(native.restart).toHaveBeenCalled();
    });

    it('does not restart a development build, which runs from Metro', async () => {
      const native = fakeNative({ isDebug: true });
      const service = await available(native);
      await service.download();
      expect((await service.restart()).message).toContain('release builds');
      expect(native.restart).not.toHaveBeenCalled();
    });

    it('confirms a launch with the native side', async () => {
      const native = fakeNative();
      await serviceWith({}, native).markLaunchSuccessful();
      expect(native.markLaunchSuccessful).toHaveBeenCalled();
    });
  });
});

describe('in-app APK updates', () => {
  const APK = { file: 'lafina-android-1.1.0.apk', size: 600 * 1024 * 1024, sha256: 'd'.repeat(64), versionCode: 6 };
  const APK_URL = 'https://github.com/LAFINA-AI/LAFINA/releases/latest/download/lafina-android-1.1.0.apk';
  /** A native release: the bundle is for build 6, and the phone is on build 5. */
  const nativeRelease = () => ({ [MANIFEST_URL]: response(200, published({ version: '1.1.0', nativeVersionCode: 6, apk: APK })) });

  /** A build that can install APKs, with the install permission as given. */
  const withApkSupport = (native: jest.Mocked<NativeUpdater>, canInstall = true) => {
    let statusListener: ((status: InstallStatus) => void) | null = null;
    native.downloadApk = jest.fn(async (_request: ApkDownloadRequest) => true);
    native.installApk = jest.fn(async (_request: { versionCode: number; sha256: string }) => true);
    native.canInstallApks = jest.fn(async () => canInstall);
    native.openInstallPermissionSettings = jest.fn(async () => true);
    native.onInstallStatus = jest.fn((listener: (status: InstallStatus) => void) => {
      statusListener = listener;
      return { remove: jest.fn() };
    });
    return { native, report: (status: InstallStatus) => statusListener?.(status) };
  };

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('offers the new APK, with its size, instead of sending people to the release page', async () => {
    const { native } = withApkSupport(fakeNative());
    const service = serviceWith(nativeRelease(), native);
    expect(await service.check()).toMatchObject({ phase: 'available', kind: 'apk', size: APK.size, version: '1.1.0' });
  });

  it('still sends a build that cannot install APKs to the release page', async () => {
    const service = serviceWith(nativeRelease(), fakeNative());
    expect(await service.check()).toMatchObject({ phase: 'needs-install', kind: null });
  });

  it('still sends people to the release page for a native release without an APK', async () => {
    const { native } = withApkSupport(fakeNative());
    const service = serviceWith({ [MANIFEST_URL]: response(200, published({ nativeVersionCode: 6 })) }, native);
    expect((await service.check()).phase).toBe('needs-install');
  });

  it('downloads the signed APK, then offers to install it', async () => {
    const { native } = withApkSupport(fakeNative());
    const service = serviceWith(nativeRelease(), native);
    await service.check();
    expect(await service.download()).toMatchObject({ phase: 'ready', kind: 'apk' });
    expect(native.downloadApk).toHaveBeenCalledWith({ url: APK_URL, versionCode: 6, size: APK.size, sha256: APK.sha256 });
    expect(native.downloadBundle).not.toHaveBeenCalled();
  });

  it('picks up an APK already downloaded', async () => {
    const { native } = withApkSupport(fakeNative({ readyApkVersionCode: 6 }));
    const service = serviceWith(nativeRelease(), native);
    expect(await service.check()).toMatchObject({ phase: 'ready', kind: 'apk' });
  });

  it('asks for the install permission first, then installs the checked APK', async () => {
    const { native } = withApkSupport(fakeNative(), false);
    const service = serviceWith(nativeRelease(), native);
    await service.check();
    await service.download();

    expect(await service.install()).toBe('needs-permission');
    expect(native.installApk).not.toHaveBeenCalled();
    await service.openInstallPermissionSettings();
    expect(native.openInstallPermissionSettings).toHaveBeenCalled();

    (native.canInstallApks as jest.Mock).mockResolvedValue(true);
    expect(await service.install()).toBe('installing');
    expect(native.installApk).toHaveBeenCalledWith({ versionCode: 6, sha256: APK.sha256 });
  });

  it('says why when Android refuses the APK', async () => {
    const { native, report } = withApkSupport(fakeNative());
    const service = serviceWith(nativeRelease(), native);
    await service.check();
    await service.download();
    await service.install();

    report({ status: 'failure', message: 'The update is signed differently from the installed app.' });
    expect(service.getState()).toMatchObject({ phase: 'ready', message: 'The update is signed differently from the installed app.' });
  });

  it('keeps restarting as the way to apply a JavaScript update', async () => {
    const { native } = withApkSupport(fakeNative());
    const service = serviceWith({ [MANIFEST_URL]: response(200, published()) }, native);
    expect(await service.check()).toMatchObject({ phase: 'available', kind: 'bundle' });
    await service.download();
    expect(await service.install()).toBe('failed');
    await service.restart();
    expect(native.restart).toHaveBeenCalled();
    expect(native.installApk).not.toHaveBeenCalled();
  });
});
