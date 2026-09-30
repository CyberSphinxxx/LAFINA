import { version } from '../package.json';

/**
 * The app's version, taken from `package.json` rather than written out again
 * here — the desktop app reads the same field through `app.getVersion()`, and
 * a number typed into a screen only ever drifts from the one that shipped.
 *
 * Note this is not the same as the Play Store's `versionName` in
 * `android/app/build.gradle`; a release should move both together.
 */
export const APP_VERSION: string = version;
