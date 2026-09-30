import { UPDATE_PUBLIC_KEY } from './releaseKey';

/**
 * Where in-app updates come from, and who may sign them.
 *
 * The repository is public, so the app reads releases straight from GitHub —
 * the `releases/latest/download/<asset>` links, which are not subject to the
 * API's 60-requests-an-hour limit that a campus network shares. See "In-app
 * updates" in RELEASE.md for how a release is cut.
 */
export interface UpdateConfig {
  owner: string;
  repo: string;
  product: string;
  manifestAsset: string;
  publicKey: string;
}

export const UPDATE_CONFIG: UpdateConfig = {
  owner: 'LAFINA-AI',
  repo: 'LAFINA',
  /** Must match `applicationId` in android/app/build.gradle; manifests signed for anything else are refused. */
  product: 'com.lafina',
  /** The signed manifest every release carries, written by `npm run release:ota`. */
  manifestAsset: 'lafina-update-android.json',
  publicKey: UPDATE_PUBLIC_KEY,
};

const repoUrl = (config: UpdateConfig): string => `https://github.com/${config.owner}/${config.repo}`;

export const latestAssetUrl = (config: UpdateConfig, asset: string): string =>
  `${repoUrl(config)}/releases/latest/download/${asset}`;

export const latestReleasePageUrl = (config: UpdateConfig): string => `${repoUrl(config)}/releases/latest`;

export const latestReleaseApiUrl = (config: UpdateConfig): string =>
  `https://api.github.com/repos/${config.owner}/${config.repo}/releases/latest`;
