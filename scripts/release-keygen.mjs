/**
 * Creates the release signing key for in-app updates — once, ever, for this app.
 *
 *   npm run release:keygen                   # key saved to ~/.lafina/lafina-android-update-key.pem
 *   npm run release:keygen -- --out <path>   # somewhere else, outside this repository
 *
 * The private key signs every release and must stay private: anyone holding it
 * can publish an "update" that installed copies will run. It is written
 * outside the repository, and this script refuses a path inside it. The public
 * key is written into src/updates/releaseKey.ts, where it is safe to commit.
 *
 * Losing the private key means installed copies can no longer be updated in
 * place (they only trust the key they were built with), so back it up
 * somewhere safe — a password manager, not a shared drive.
 *
 * ECDSA P-256 rather than the desktop app's Ed25519: Android verifies it with
 * the platform's own crypto on every supported version (minSdk 30), while
 * Ed25519 arrived only in Android 13.
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keyFile = resolve(repoRoot, 'src', 'updates', 'releaseKey.ts');
const KEY_LINE = /export const UPDATE_PUBLIC_KEY: string = '([^']*)';/;

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const outIndex = process.argv.indexOf('--out');
const target = resolve(
  outIndex > -1 && process.argv[outIndex + 1]
    ? process.argv[outIndex + 1]
    : resolve(homedir(), '.lafina', 'lafina-android-update-key.pem'),
);

const insideRepo = (() => {
  const rel = relative(repoRoot, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
})();
if (insideRepo) fail('Refusing to write the private key inside the repository. Choose a path outside it.');
if (existsSync(target)) {
  fail(
    `A key already exists at ${target}. It was left untouched.\n` +
      'Replacing it would stop every installed copy from accepting new updates.',
  );
}

const source = readFileSync(keyFile, 'utf8');
const current = KEY_LINE.exec(source);
if (!current) fail(`Could not find UPDATE_PUBLIC_KEY in ${keyFile}.`);
if (current[1]) {
  fail(
    `${keyFile} already holds a release key. Installed copies trust that one;\n` +
      'sign with its private key instead of creating a new one.',
  );
}

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const publicBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
writeFileSync(keyFile, source.replace(KEY_LINE, `export const UPDATE_PUBLIC_KEY: string = '${publicBase64}';`));

console.log(`Private key written to ${target}`);
console.log('Back it up somewhere safe. Never commit it or share it.\n');
console.log(`Public key written to ${relative(repoRoot, keyFile)} (safe to commit):\n`);
console.log(`${publicBase64}\n`);
console.log('Build and hand out one APK with this key; from then on, `npm run release:ota` publishes updates.');
