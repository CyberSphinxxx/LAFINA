import { DeviceEventEmitter, NativeModules } from 'react-native';

/** What the installed APK knows about updates. */
export interface UpdaterInfo {
  /** `versionCode` of the installed APK; a bundle runs only on the build it was made for. */
  nativeVersionCode: number;
  nativeVersionName: string;
  /** Development builds load JavaScript from Metro, so a downloaded bundle never starts. */
  isDebug: boolean;
  /** The downloaded version this launch is running, or null for the APK's own bundle. */
  runningVersion: string | null;
  /** Downloaded and waiting for the next start. */
  pendingVersion: string | null;
  /** Versions rolled back after they failed to start; never offered again. */
  rejectedVersions: string[];
  /** The build of a new APK already downloaded and waiting to be installed. */
  readyApkVersionCode?: number;
}

export interface ApkDownloadRequest {
  url: string;
  versionCode: number;
  size: number;
  sha256: string;
}

/** What Android's package installer reported about an APK update. */
export interface InstallStatus {
  status: 'confirming' | 'success' | 'cancelled' | 'failure';
  message: string | null;
}

export interface DownloadRequest {
  url: string;
  version: string;
  nativeVersionCode: number;
  size: number;
  sha256: string;
}

export interface DownloadProgress {
  received: number;
  total: number;
}

export interface NativeUpdater {
  getInfo: () => Promise<UpdaterInfo>;
  /** Resolves with the payload's text only when the signature holds; rejects otherwise. */
  verifyManifest: (payload: string, signature: string, publicKey: string) => Promise<string>;
  downloadBundle: (request: DownloadRequest) => Promise<boolean>;
  cancelDownload: () => void;
  markLaunchSuccessful: () => Promise<boolean>;
  restart: () => Promise<boolean>;
  onProgress: (listener: (progress: DownloadProgress) => void) => { remove: () => void };
  /** APK updates; absent in builds before in-app APK installs. */
  downloadApk?: (request: ApkDownloadRequest) => Promise<boolean>;
  installApk?: (request: { versionCode: number; sha256: string }) => Promise<boolean>;
  canInstallApks?: () => Promise<boolean>;
  openInstallPermissionSettings?: () => Promise<boolean>;
  onInstallStatus?: (listener: (status: InstallStatus) => void) => { remove: () => void };
}

type LafinaUpdaterNativeModule = Omit<NativeUpdater, 'onProgress' | 'onInstallStatus'>;

const PROGRESS_EVENT = 'LafinaUpdaterProgress';
const INSTALL_STATUS_EVENT = 'LafinaUpdaterInstallStatus';

/** The native updater, or null in a build without it (tests, an older APK). */
export const getNativeUpdater = (): NativeUpdater | null => {
  const module = NativeModules.LafinaUpdater as LafinaUpdaterNativeModule | undefined;
  if (!module?.verifyManifest || !module.downloadBundle) return null;
  return {
    getInfo: () => module.getInfo(),
    verifyManifest: (payload, signature, publicKey) => module.verifyManifest(payload, signature, publicKey),
    downloadBundle: (request) => module.downloadBundle(request),
    cancelDownload: () => module.cancelDownload(),
    markLaunchSuccessful: () => module.markLaunchSuccessful(),
    restart: () => module.restart(),
    onProgress: (listener) => DeviceEventEmitter.addListener(PROGRESS_EVENT, listener),
    ...(module.downloadApk && module.installApk
      ? {
          downloadApk: (request: ApkDownloadRequest) => module.downloadApk!(request),
          installApk: (request: { versionCode: number; sha256: string }) => module.installApk!(request),
          canInstallApks: () => module.canInstallApks?.() ?? Promise.resolve(true),
          openInstallPermissionSettings: () => module.openInstallPermissionSettings?.() ?? Promise.resolve(false),
          onInstallStatus: (listener: (status: InstallStatus) => void) =>
            DeviceEventEmitter.addListener(INSTALL_STATUS_EVENT, listener),
        }
      : {}),
  };
};
