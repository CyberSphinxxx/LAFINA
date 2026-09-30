import {
  compareVersions,
  isReleaseKey,
  MAX_BUNDLE_BYTES,
  parseSignedManifest,
  readVerifiedManifest,
  UpdateError,
} from '../../src/updates/updateManifest';

const manifest = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema: 1,
    product: 'com.lafina',
    version: '1.0.1',
    platform: 'android',
    nativeVersionCode: 5,
    file: 'lafina-android-bundle-1.0.1.zip',
    size: 1234,
    sha256: 'a'.repeat(64),
    signedAt: '2026-09-23T00:00:00.000Z',
    ...overrides,
  });

const refusal = (json: string): string => {
  try {
    readVerifiedManifest(json, { product: 'com.lafina' });
  } catch (error) {
    expect(error).toBeInstanceOf(UpdateError);
    expect((error as UpdateError).code).toBe('verification_failed');
    return (error as UpdateError).message;
  }
  throw new Error('expected the manifest to be refused');
};

describe('update versions', () => {
  it('orders semantic versions', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
  });

  it('ranks a release above its pre-releases', () => {
    expect(compareVersions('1.1.0', '1.1.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.1.0-beta.10', '1.1.0-beta.2')).toBeGreaterThan(0);
  });

  it('sorts an invalid version lowest', () => {
    expect(compareVersions('nonsense', '0.0.1')).toBeLessThan(0);
  });
});

describe('release key', () => {
  it('needs base64', () => {
    expect(isReleaseKey('')).toBe(false);
    expect(isReleaseKey('not base64!')).toBe(false);
    expect(isReleaseKey('MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE')).toBe(true);
  });
});

describe('published manifest', () => {
  it('reads the payload and signature', () => {
    expect(parseSignedManifest(JSON.stringify({ payload: 'eyJ9', signature: 'MEUC' }))).toEqual({
      payload: 'eyJ9',
      signature: 'MEUC',
    });
  });

  it.each([
    ['not JSON', 'nope'],
    ['a list', '[]'],
    ['a missing signature', JSON.stringify({ payload: 'eyJ9' })],
    ['a non-base64 payload', JSON.stringify({ payload: '{"a":1}', signature: 'MEUC' })],
    ['an oversized body', 'x'.repeat(17 * 1024)],
  ])('refuses %s', (_label, body) => {
    expect(() => parseSignedManifest(body)).toThrow(UpdateError);
  });
});

describe('verified manifest', () => {
  it('reads a well-formed manifest', () => {
    expect(readVerifiedManifest(manifest(), { product: 'com.lafina' })).toMatchObject({
      version: '1.0.1',
      nativeVersionCode: 5,
      file: 'lafina-android-bundle-1.0.1.zip',
      size: 1234,
    });
  });

  it.each([
    ['another app', { product: 'com.lafina.personal' }, 'signed for another app'],
    ['another platform', { platform: 'win32' }, 'built for another system'],
    ['an unknown schema', { schema: 2 }, 'unknown manifest version'],
    ['a bad version', { version: 'latest' }, 'invalid version'],
    ['no app build', { nativeVersionCode: 0 }, 'invalid app build'],
    ['a path in the file name', { file: '../evil.zip' }, 'invalid file name'],
    ['a file that is not a zip', { file: 'bundle.exe' }, 'invalid file name'],
    ['a hostile size', { size: MAX_BUNDLE_BYTES + 1 }, 'invalid size'],
    ['a bad checksum', { sha256: 'xyz' }, 'invalid checksum'],
  ])('refuses %s', (_label, overrides, detail) => {
    expect(refusal(manifest(overrides))).toContain(detail);
  });
});

describe('the APK a native release carries', () => {
  const apk = { file: 'lafina-android-1.4.0.apk', size: 673_354_212, sha256: 'c'.repeat(64), versionCode: 5 };

  it('reads it when it is for the release build', () => {
    expect(readVerifiedManifest(manifest({ apk }), { product: 'com.lafina' }).apk).toEqual(apk);
  });

  it('leaves it out of a release that has none', () => {
    expect(readVerifiedManifest(manifest(), { product: 'com.lafina' }).apk).toBeUndefined();
  });

  it.each([
    ['for another build', { ...apk, versionCode: 6 }],
    ['with a path in its name', { ...apk, file: '../lafina.apk' }],
    ['that is not an APK', { ...apk, file: 'lafina.exe' }],
    ['with a hostile size', { ...apk, size: 3 * 1024 * 1024 * 1024 }],
    ['with a bad checksum', { ...apk, sha256: 'nope' }],
  ])('refuses one %s', (_label, entry) => {
    expect(refusal(manifest({ apk: entry }))).toContain('invalid app package');
  });
});
