/**
 * In-app updates: check, download, verify, then restart or install.
 *
 * A release on GitHub carries the app's JavaScript bundle and images as a
 * zip, next to a manifest signed with the LAFINA release key. Checking reads
 * that manifest and verifies its signature with the public key built into
 * this app; downloading brings the file down and checks it against the signed
 * size and SHA-256.
 *
 * A bundle only runs on the APK build it was made for. A release for this
 * build is applied by restarting into its bundle. A release that changes
 * native code carries its APK too: that is downloaded the same way and handed
 * to Android's installer, which asks the person to confirm — the in-app
 * counterpart of the desktop app running its installer. Only a release
 * without an APK, or a phone on a build too old to install one, is sent to
 * the release page.
 *
 * The state lives here, outside any screen, so a download carries on while
 * the person moves around the app, and screens subscribe to it.
 */

import { APP_VERSION } from '../appVersion';
import { getNativeUpdater, type NativeUpdater } from './nativeUpdater';
import {
  latestAssetUrl,
  latestReleaseApiUrl,
  latestReleasePageUrl,
  UPDATE_CONFIG,
  type UpdateConfig,
} from './updateConfig';
import {
  compareVersions,
  isReleaseKey,
  MAX_NOTES_CHARS,
  parseSignedManifest,
  readVerifiedManifest,
  UpdateError,
  type SignedManifest,
  type UpdateManifest,
} from './updateManifest';

export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  /** The newest release changes native code, so it comes as a new APK. */
  | 'needs-install'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateState {
  phase: UpdatePhase;
  /** The version this launch is running — the APK's own or a downloaded one. */
  currentVersion: string;
  /** The version on offer, once one is found. */
  version: string | null;
  notes: string | null;
  /** Download progress, 0–100. */
  percent: number | null;
  /** Why updates are unavailable or what went wrong, in words for the person. */
  message: string | null;
  /** Where to get a new APK, for `needs-install`. */
  releaseUrl: string;
  /** What the update is: a JS bundle applied by restarting, or a new APK to install. */
  kind: 'bundle' | 'apk' | null;
  /** How much will be downloaded, in bytes. */
  size: number | null;
}

/** What asking to install a downloaded APK came to. */
export type InstallOutcome = 'installing' | 'needs-permission' | 'failed';

type Fetch = typeof fetch;

interface UpdateServiceDeps {
  config?: UpdateConfig;
  currentVersion?: string;
  native?: NativeUpdater | null;
  fetchImpl?: Fetch;
}

const MANIFEST_TIMEOUT_MS = 20_000;
const NOTES_TIMEOUT_MS = 10_000;

/** Native rejection codes, from `OtaBundles.OtaException` and `LafinaUpdaterModule`. */
const NATIVE_ERRORS: Record<string, UpdateError['code']> = {
  E_CANCELLED: 'cancelled',
  E_NETWORK: 'network_unavailable',
  E_STORAGE: 'insufficient_storage',
  E_VERIFY: 'verification_failed',
  E_INCOMPATIBLE: 'verification_failed',
  E_RESTART: 'restart_failed',
};

const fromNativeError = (error: unknown): UpdateError => {
  if (error instanceof UpdateError) return error;
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const mapped = typeof code === 'string' ? NATIVE_ERRORS[code] : undefined;
  if (mapped && typeof message === 'string' && message) return new UpdateError(mapped, message);
  return new UpdateError('download_failed', 'The update could not be downloaded. Try again.');
};

const messageOf = (error: unknown): string =>
  error instanceof UpdateError ? error.message : 'Something went wrong while updating. Try again.';

/** `fetch` with a deadline; React Native has no `AbortSignal.timeout`. */
const fetchWithin = async (fetchImpl: Fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const createUpdateService = (deps: UpdateServiceDeps = {}) => {
  const config = deps.config ?? UPDATE_CONFIG;
  const currentVersion = deps.currentVersion ?? APP_VERSION;
  const native = deps.native === undefined ? getNativeUpdater() : deps.native;
  const fetchImpl: Fetch = deps.fetchImpl ?? ((...args) => fetch(...args));

  /** Why this build cannot update itself, or null when it can. */
  const unsupportedReason = ((): string | null => {
    if (!native) return 'In-app updates are not available in this build.';
    if (!isReleaseKey(config.publicKey)) return 'Updates are not set up for this build.';
    return null;
  })();

  let state: UpdateState = {
    phase: unsupportedReason ? 'unsupported' : 'idle',
    currentVersion,
    version: null,
    notes: null,
    percent: null,
    message: unsupportedReason,
    releaseUrl: latestReleasePageUrl(config),
    kind: null,
    size: null,
  };
  let offer: UpdateManifest | null = null;
  const listeners = new Set<(next: UpdateState) => void>();

  const setState = (patch: Partial<UpdateState>): UpdateState => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener(state));
    return state;
  };

  const getState = (): UpdateState => state;

  // Android's installer reports back after the confirmation; success ends this process.
  native?.onInstallStatus?.(({ status, message }) => {
    if (state.kind !== 'apk') return;
    if (status === 'failure') setState({ message: message ?? 'The update could not be installed. Try again.' });
    else if (status === 'cancelled') setState({ message: null });
  });

  const subscribe = (listener: (next: UpdateState) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  /** The signed manifest of the latest release, or null when there is none. */
  const fetchSignedManifest = async (): Promise<SignedManifest | null> => {
    let response: Response;
    try {
      response = await fetchWithin(
        fetchImpl,
        latestAssetUrl(config, config.manifestAsset),
        { method: 'GET', headers: { Accept: 'application/json' } },
        MANIFEST_TIMEOUT_MS,
      );
    } catch {
      throw new UpdateError('network_unavailable', 'Could not reach GitHub. Check the connection and try again.');
    }
    // No release yet, or the latest one has no manifest: nothing to offer.
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new UpdateError('server_error', `GitHub answered ${response.status}. Try again later.`);
    }
    return parseSignedManifest(await response.text());
  };

  /** The release notes, if GitHub will say. Never fails the check: notes are a courtesy. */
  const fetchNotes = async (file: string): Promise<string | null> => {
    try {
      const response = await fetchWithin(
        fetchImpl,
        latestReleaseApiUrl(config),
        { method: 'GET', headers: { Accept: 'application/vnd.github+json' } },
        NOTES_TIMEOUT_MS,
      );
      if (!response.ok) return null;
      const data = (await response.json()) as { body?: unknown; assets?: unknown };
      // Only when it is the same release the manifest came from.
      const assets = Array.isArray(data.assets) ? data.assets : [];
      if (!assets.some((asset) => (asset as { name?: unknown })?.name === file)) return null;
      const body = typeof data.body === 'string' ? data.body.trim() : '';
      return body ? body.slice(0, MAX_NOTES_CHARS) : null;
    } catch {
      return null;
    }
  };

  const check = async (request: { quiet?: boolean } = {}): Promise<UpdateState> => {
    if (unsupportedReason || !native) return state;
    // Never throw away a download in progress or one waiting for a restart.
    if (state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'ready') return state;
    const before = state;
    setState({ phase: 'checking', message: null });
    try {
      const signed = await fetchSignedManifest();
      const info = await native.getInfo();
      const nothingNew = (message: string | null = null): UpdateState => {
        offer = null;
        return setState({
          phase: request.quiet ? 'idle' : 'up-to-date',
          version: null,
          notes: null,
          percent: null,
          message: request.quiet ? null : message,
          kind: null,
          size: null,
        });
      };
      if (!signed) return nothingNew();

      const payload = await native
        .verifyManifest(signed.payload, signed.signature, config.publicKey)
        .catch(() => {
          throw new UpdateError('verification_failed', 'The update could not be verified (bad signature), so it was not downloaded.');
        });
      const manifest = readVerifiedManifest(payload, { product: config.product });

      // Only strictly newer: an older signed bundle can never be replayed as an "update".
      if (compareVersions(manifest.version, currentVersion) <= 0) return nothingNew();
      if (info.rejectedVersions.includes(manifest.version)) {
        return nothingNew(`LAFINA ${manifest.version} did not start properly on this phone, so it was undone and is not offered again.`);
      }
      if (manifest.nativeVersionCode < info.nativeVersionCode) return nothingNew();
      if (manifest.nativeVersionCode > info.nativeVersionCode) {
        // A newer native build: installed from inside the app when the release
        // carries its APK and this build knows how to install one.
        if (manifest.apk && native.downloadApk && native.installApk) {
          offer = manifest;
          if (info.readyApkVersionCode === manifest.apk.versionCode) {
            return setState({
              phase: 'ready',
              kind: 'apk',
              size: manifest.apk.size,
              version: manifest.version,
              notes: null,
              percent: 100,
            });
          }
          return setState({
            phase: 'available',
            kind: 'apk',
            size: manifest.apk.size,
            version: manifest.version,
            notes: await fetchNotes(manifest.file),
            percent: null,
          });
        }
        offer = null;
        return setState({
          phase: 'needs-install',
          kind: null,
          size: manifest.apk?.size ?? null,
          version: manifest.version,
          notes: await fetchNotes(manifest.file),
          percent: null,
        });
      }

      offer = manifest;
      // Downloaded earlier and still waiting for a restart.
      if (info.pendingVersion === manifest.version) {
        return setState({
          phase: 'ready',
          kind: 'bundle',
          size: manifest.size,
          version: manifest.version,
          notes: null,
          percent: 100,
        });
      }
      return setState({
        phase: 'available',
        kind: 'bundle',
        size: manifest.size,
        version: manifest.version,
        notes: await fetchNotes(manifest.file),
        percent: null,
      });
    } catch (error) {
      // A background check that fails says nothing (offline is normal); the button still works.
      if (request.quiet) {
        console.log(`[updates] Background check skipped: ${messageOf(error)}`);
        return setState({ ...before, phase: before.phase === 'checking' ? 'idle' : before.phase });
      }
      console.warn(`[updates] Check failed: ${messageOf(error)}`);
      return setState({ phase: 'error', message: messageOf(error) });
    }
  };

  const download = async (): Promise<UpdateState> => {
    if (!native || state.phase !== 'available' || !offer) return state;
    const manifest = offer;
    setState({ phase: 'downloading', percent: 0, message: null });
    const progress = native.onProgress(({ received, total }) => {
      if (total > 0) setState({ percent: Math.min(100, Math.floor((received / total) * 100)) });
    });
    try {
      if (state.kind === 'apk' && manifest.apk && native.downloadApk) {
        await native.downloadApk({
          url: latestAssetUrl(config, manifest.apk.file),
          versionCode: manifest.apk.versionCode,
          size: manifest.apk.size,
          sha256: manifest.apk.sha256,
        });
      } else {
        await native.downloadBundle({
          url: latestAssetUrl(config, manifest.file),
          version: manifest.version,
          nativeVersionCode: manifest.nativeVersionCode,
          size: manifest.size,
          sha256: manifest.sha256,
        });
      }
      return setState({ phase: 'ready', percent: 100 });
    } catch (error) {
      const failure = fromNativeError(error);
      if (failure.code === 'cancelled') return setState({ phase: 'available', percent: null });
      console.warn(`[updates] Download failed: ${failure.message}`);
      return setState({ phase: 'error', percent: null, message: failure.message });
    } finally {
      progress.remove();
    }
  };

  const cancel = (): void => {
    if (state.phase === 'downloading') native?.cancelDownload();
  };

  /** Restarts into the downloaded version. Resolves only if the restart did not happen. */
  const restart = async (): Promise<UpdateState> => {
    if (!native || state.phase !== 'ready') return state;
    const info = await native.getInfo().catch(() => null);
    if (info?.isDebug) {
      return setState({
        message: 'Development builds load JavaScript from Metro, so updates apply only to release builds.',
      });
    }
    try {
      await native.restart();
      return state;
    } catch (error) {
      return setState({ message: fromNativeError(error).message });
    }
  };

  /**
   * Hands a downloaded APK to Android's installer, which shows its own
   * confirmation. Android asks once whether LAFINA may install apps at all;
   * until that is allowed this answers `needs-permission`, and
   * `openInstallPermissionSettings` takes the person there.
   */
  const install = async (): Promise<InstallOutcome> => {
    const apk = offer?.apk;
    if (!native?.installApk || state.phase !== 'ready' || state.kind !== 'apk' || !apk) return 'failed';
    if (native.canInstallApks && !(await native.canInstallApks().catch(() => false))) return 'needs-permission';
    try {
      setState({ message: null });
      await native.installApk({ versionCode: apk.versionCode, sha256: apk.sha256 });
      return 'installing';
    } catch (error) {
      const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
      if (code === 'E_PERMISSION') return 'needs-permission';
      setState({
        message: typeof message === 'string' && message ? message : 'The update could not be installed. Try again.',
      });
      return 'failed';
    }
  };

  /** Opens Android's "Install unknown apps" setting for LAFINA. */
  const openInstallPermissionSettings = async (): Promise<void> => {
    await native?.openInstallPermissionSettings?.().catch(() => undefined);
  };

  /**
   * Tells the native side this launch started properly, so a downloaded
   * version is kept. One that never gets here is undone on the next start.
   */
  const markLaunchSuccessful = async (): Promise<void> => {
    await native?.markLaunchSuccessful().catch(() => undefined);
  };

  return {
    getState,
    subscribe,
    check,
    download,
    cancel,
    restart,
    install,
    openInstallPermissionSettings,
    markLaunchSuccessful,
  };
};

export type UpdateService = ReturnType<typeof createUpdateService>;

/** The app's one update service. */
export const appUpdater: UpdateService = createUpdateService();
