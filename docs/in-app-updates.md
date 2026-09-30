# In-app updates (Android)

**Profile → About → Check for Updates** downloads a new version of LAFINA from
the latest GitHub release and restarts into it. No new APK is installed. The
app also checks quietly once per launch, and the row is highlighted when a
newer version is out.

## What an update is

Most of LAFINA is JavaScript: screens, storage, sync, the voice pipeline's
logic. A release APK carries that as one Hermes bytecode file,
`index.android.bundle`, plus its images. An in-app update replaces just that
bundle.

```
GitHub release (public repo)
├── lafina-android-bundle-<version>.zip   the bundle + images, as a release APK carries them
└── lafina-update-android.json            manifest signed with the release key
```

The app reads `releases/latest/download/<asset>`. Those are plain download
links, so they don't count against the GitHub API's limit of 60 requests an
hour per IP address, which a whole campus network would share. Release notes
are the one thing read from the API, and if that request fails the update is
still offered, just without notes.

### When a release changes native code

A bundle only runs on the APK build it was made for, meaning the
`versionCode` in `android/app/build.gradle`. A new APK is needed when a release changes:

- Kotlin/Java code, `AndroidManifest.xml`, permissions, or Gradle dependencies
- a package with native code (anything under `node_modules` with an `android/` folder)
- the React Native version

For those, bump `versionCode` and publish with `npm run release:ota -- --apk`.
The release then carries the new APK, listed in the signed manifest with its
size and SHA-256, and phones on the older build update **from inside the app**,
as the desktop app does with its installer:

1. **Update to <version>** offers the new app package and its size.
2. LAFINA downloads it and checks it against the signed size and SHA-256.
3. **Install update** hands it to Android's installer, which asks the person to
   confirm, installs it over the app (data is kept), and LAFINA opens again on
   the new version.

Android never lets an app replace itself silently. The first time, it also asks
the person to allow LAFINA to install apps ("Install unknown apps" → "Allow
from this source"); the app explains this and opens that setting. Android also
refuses any APK not signed with the same key as the installed app.

Phones on a build from before in-app APK installs (build 7 and earlier) can't
do this yet: they still see **"<version> needs a new install"**, which opens the
release page. After installing one APK from there, they update in-app.

## Safeguards

1. **Signed releases.** Every manifest is signed with an ECDSA P-256 key
   that stays on the release machine. The app holds only the public key
   (`src/updates/releaseKey.ts`). It verifies the signature before it
   downloads anything, and keeps the zip only if its size and SHA-256 match the
   manifest. Manifests for another app or platform are refused, and so is any
   version that isn't strictly newer (no downgrades). Anyone who can edit the
   GitHub release, but doesn't have the private key, can't get code onto a phone.
2. **Rollback.** A downloaded version has to finish starting (the database
   opens and the splash hands over) before it is kept. If it crashes before that,
   the next launch goes back to the previous version and that version is
   never offered again.
3. **New APK wins.** Installing any APK throws away downloaded bundles,
   because the APK brings its own.
4. **Same signing key.** An APK update must be signed with the key of the app
   already installed (`my-upload-key.keystore`), or Android refuses it.

Restarting and installing ask first, and refuse while a meeting is being
recorded, because either would end the recording.

## One-time setup (done)

The signing key was created with `npm run release:keygen`:

- **Private key:** `~/.lafina/lafina-android-update-key.pem`. **Back it up**
  (password manager). If it's lost, installed copies can't be updated in place
  any more. Never commit it.
- **Public key:** `src/updates/releaseKey.ts`. Commit it.

Only APKs built **after** the key was added can update themselves. Build a
release APK now and hand it out the usual way. Updates after that are in-app.

## Publishing an update (JavaScript-only change)

```bash
npm run preflight
```

```bash
npm version patch
```

```bash
git push --follow-tags
```

```bash
npm run release:ota
```

```bash
gh release create v1.0.1 "release/lafina-android-bundle-1.0.1.zip" "release/lafina-update-android.json" --title "v1.0.1" --notes "What changed"
```

`release:ota` prints the exact `gh` command. Publish a **normal release**. Drafts
and pre-releases are skipped, because the app reads `releases/latest`. The
release notes appear in the update prompt.

`npm version` moves `package.json`, which is the version the app shows and
compares. Leave `versionCode`/`versionName` alone for a JavaScript-only
update. `release:ota` checks the latest published release and refuses a
raised `versionCode` without `--apk`, since phones on the old build would have
nothing to install.

## Publishing a release that changes native code

1. Bump `versionCode` (and `versionName`) in `android/app/build.gradle`, plus
   `npm version minor`, then `git push --follow-tags`.
2. Build, sign and collect everything, APK included (this builds the release APK, so it takes a while):

   ```bash
   npm run release:ota -- --apk
   ```

3. Publish the three files it prints, for example:

   ```bash
   gh release create v1.4.0 "release/lafina-android-bundle-1.4.0.zip" "release/lafina-android-1.4.0.apk" "release/lafina-update-android.json" --title "v1.4.0" --notes "…"
   ```

The APK is large (it carries the on-device models), so people are told its
size before they download, and Wi-Fi is suggested.

## If something goes wrong

| Symptom | Cause and fix |
| --- | --- |
| "Updates are not set up for this build" | The APK was built before `src/updates/releaseKey.ts` had a key. Install a newer APK. |
| Always "Up to date" | The latest release is a draft or pre-release, lacks `lafina-update-android.json`, its version isn't newer than the phone's, or it was built for an older `versionCode`. |
| "…could not be verified (bad signature)" | Signed with a different key than the app was built with. Sign with `~/.lafina/lafina-android-update-key.pem`. |
| "…did not start properly on this phone, so it was undone" | The version crashed during startup and was rolled back. Fix it and publish a higher version. |
| "Update not applied yet … development builds" | Debug builds load JavaScript from Metro. Test updates with a release APK. |
| "…signed differently from the installed app, so Android refused it" | The phone has a debug build, or an APK signed with another keystore. Install the release APK by hand once. |
| "…needs a new install" on a native release | The phone's build predates in-app APK installs, or the release has no APK (published without `--apk`). |

If the **private key** leaks, anyone holding it can sign an update that phones
will run. Create a new key (delete the old line in `releaseKey.ts` first),
ship an APK built with it, and have everyone install that APK by hand.
