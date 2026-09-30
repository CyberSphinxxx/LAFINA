/**
 * What an update is, and whether to believe it.
 *
 * Every release carries a small manifest — the bundle zip's file name, size,
 * SHA-256, version, and the APK build it was made for — signed with the LAFINA
 * release key. Only the public half of that key ships inside the app; the
 * private half never leaves the machine that cuts releases. So nobody who can
 * change a GitHub release, or anything on the network, can get the app to run
 * JavaScript it did not sign: a manifest whose signature fails is refused
 * before a byte of the bundle is downloaded, and the bundle is refused unless
 * it matches the signed size and hash exactly.
 *
 * The signature itself is checked natively (`LafinaUpdaterModule`); this file
 * reads what it signed. Nothing here touches React Native.
 */

export const UPDATE_MANIFEST_SCHEMA = 1;
/** Far above a real bundle, low enough that a hostile size cannot fill the phone. */
export const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;
/** GitHub's limit for one release asset; the app APK (with its models) is well under it. */
export const MAX_APK_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_NOTES_CHARS = 4_000;
const MAX_MANIFEST_CHARS = 16 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Bundle names are used in download URLs, so only plain ones are accepted. */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.zip$/;
const SAFE_APK_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.apk$/;

export type UpdateErrorCode =
  | 'not_configured'
  | 'network_unavailable'
  | 'server_error'
  | 'verification_failed'
  | 'insufficient_storage'
  | 'download_failed'
  | 'cancelled'
  | 'restart_failed';

export class UpdateError extends Error {
  constructor(
    readonly code: UpdateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UpdateError';
  }
}

/**
 * The new APK a release carries when it changes native code, so phones on an
 * older build can install it from inside the app instead of by hand.
 */
export interface ApkAsset {
  file: string;
  size: number;
  sha256: string;
  /** The APK's `versionCode`; always the manifest's `nativeVersionCode`. */
  versionCode: number;
}

/** The signed facts about one bundle. */
export interface UpdateManifest {
  schema: typeof UPDATE_MANIFEST_SCHEMA;
  product: string;
  version: string;
  platform: 'android';
  /** The APK `versionCode` the bundle was built against; it runs on that build only. */
  nativeVersionCode: number;
  file: string;
  size: number;
  sha256: string;
  signedAt: string;
  /** Present when the release changes native code and ships its APK. */
  apk?: ApkAsset;
}

/** The release asset as published: the manifest's exact bytes and a signature over them. */
export interface SignedManifest {
  /** Base64 of the manifest's JSON bytes — the bytes the signature covers. */
  payload: string;
  /** Base64 DER ECDSA P-256 / SHA-256 signature over those bytes. */
  signature: string;
}

// ── Versions ───────────────────────────────────────────────────────────────

interface ParsedVersion {
  core: [number, number, number];
  pre: string[];
}

export const parseVersion = (value: string): ParsedVersion | null => {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    value.trim(),
  );
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
};

/** Semantic-version order: negative when `a` is older than `b`. Invalid versions sort lowest. */
export const compareVersions = (a: string, b: string): number => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i];
  }
  // A release outranks every pre-release of the same number.
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i += 1) {
    const x = left.pre[i];
    const y = right.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
};

// ── Configuration ──────────────────────────────────────────────────────────

/** A release key looks like base64 SPKI DER. Whether it is a real P-256 key is checked natively. */
export const isReleaseKey = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.length > 0 && BASE64.test(trimmed);
};

// ── Release assets ─────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const unreadable = (): never => {
  throw new UpdateError('server_error', 'The update on GitHub could not be read. Try again later.');
};

/** Checks the shape of the published manifest asset. Nothing in it is trusted until the signature holds. */
export const parseSignedManifest = (body: string): SignedManifest => {
  if (body.length > MAX_MANIFEST_CHARS) return unreadable();
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return unreadable();
  }
  if (!isRecord(data)) return unreadable();
  const { payload, signature } = data as Record<string, unknown>;
  if (typeof payload !== 'string' || typeof signature !== 'string') return unreadable();
  if (!BASE64.test(payload) || !BASE64.test(signature)) return unreadable();
  return { payload, signature };
};

const refuse = (detail: string): never => {
  throw new UpdateError(
    'verification_failed',
    `The update could not be verified (${detail}), so it was not downloaded.`,
  );
};

/**
 * Reads a manifest whose signature has already been checked. Every field the
 * app acts on is checked too, so a manifest signed for another app or
 * platform cannot be replayed here.
 */
export const readVerifiedManifest = (json: string, expected: { product: string }): UpdateManifest => {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return refuse('unreadable manifest');
  }
  if (!isRecord(data)) return refuse('unreadable manifest');

  if (data.schema !== UPDATE_MANIFEST_SCHEMA) refuse('unknown manifest version');
  if (data.product !== expected.product) refuse('signed for another app');
  if (data.platform !== 'android') refuse('built for another system');
  if (typeof data.version !== 'string' || !parseVersion(data.version)) refuse('invalid version');
  if (
    typeof data.nativeVersionCode !== 'number' ||
    !Number.isSafeInteger(data.nativeVersionCode) ||
    data.nativeVersionCode <= 0
  ) {
    refuse('invalid app build');
  }
  if (typeof data.file !== 'string' || !SAFE_FILE_NAME.test(data.file)) refuse('invalid file name');
  if (
    typeof data.size !== 'number' ||
    !Number.isSafeInteger(data.size) ||
    data.size <= 0 ||
    data.size > MAX_BUNDLE_BYTES
  ) {
    refuse('invalid size');
  }
  if (typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) refuse('invalid checksum');

  // Older builds ignore this field, so adding it never breaks them.
  let apk: ApkAsset | undefined;
  if (data.apk !== undefined) {
    const entry = data.apk;
    if (
      !isRecord(entry) ||
      typeof entry.file !== 'string' ||
      !SAFE_APK_NAME.test(entry.file) ||
      typeof entry.size !== 'number' ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0 ||
      entry.size > MAX_APK_BYTES ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      entry.versionCode !== data.nativeVersionCode
    ) {
      return refuse('invalid app package');
    }
    apk = { file: entry.file, size: entry.size, sha256: entry.sha256, versionCode: entry.versionCode as number };
  }

  return {
    schema: UPDATE_MANIFEST_SCHEMA,
    product: data.product as string,
    version: data.version as string,
    platform: 'android',
    nativeVersionCode: data.nativeVersionCode as number,
    file: data.file as string,
    size: data.size as number,
    sha256: data.sha256 as string,
    signedAt: typeof data.signedAt === 'string' ? data.signedAt : '',
    ...(apk ? { apk } : {}),
  };
};
