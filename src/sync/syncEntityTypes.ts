/**
 * Which personal entity types this client syncs, and how that is negotiated.
 *
 * Keep this file identical in LAFINA mobile (`src/sync/syncEntityTypes.ts`) and
 * LAFINA desktop (`src/renderer/src/sync/syncEntityTypes.ts`).
 *
 * The server only sends a request the types it declares in `entityTypes`, and
 * says which types it stores in `supportedEntityTypes`. A server from before
 * negotiation sends neither, and only knows the legacy seven. The types both
 * sides understand are the "effective" set: only those are pushed, expected in
 * snapshots, or pruned. Whenever the effective set changes — this app or the
 * server was upgraded — the next pass takes a full snapshot, because deltas
 * for newly understood types may already be behind the cursor.
 */
import type { SyncEntityType } from '../storage/syncTypes';

export { POMODORO_SETTINGS_ENTITY_ID } from '../storage/syncTypes';

/** Types every server supports, including ones from before negotiation. */
export const LEGACY_SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  'profile',
  'task',
  'event',
  'time_block',
  'reminder',
  'note',
  'custom_category',
];

/** Every personal type this client can apply. */
export const CLIENT_SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  ...LEGACY_SYNC_ENTITY_TYPES,
  'pomodoro_settings',
  'pomodoro_session',
  'flashcard_deck',
  'study_summary',
  'recorded_meeting',
];

/**
 * Types a complete snapshot lists in full, so a synced row the snapshot omits
 * was deleted on the server and may be pruned locally.
 */
export const AUTHORITATIVE_SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  'task',
  'event',
  'time_block',
  'reminder',
  'note',
  'custom_category',
  'pomodoro_session',
  'flashcard_deck',
  'study_summary',
  'recorded_meeting',
];

/** One row per account: updated in place, never deleted or pruned. */
export const SINGLETON_SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  'profile',
  'pomodoro_settings',
];

/**
 * Types pushed without a base version, so the latest write wins instead of
 * raising a conflict. Settings are rewritten whole on every change; a
 * conflict prompt over a timer length would be noise.
 */
export const LAST_WRITE_WINS_ENTITY_TYPES: readonly SyncEntityType[] = [
  'pomodoro_settings',
];

/** The client types the server also supports; a missing list means a pre-negotiation server. */
export const effectiveSyncEntityTypes = (
  serverSupported: readonly string[] | null | undefined
): SyncEntityType[] => {
  const server = new Set<string>(serverSupported ?? LEGACY_SYNC_ENTITY_TYPES);
  return CLIENT_SYNC_ENTITY_TYPES.filter((entityType) => server.has(entityType));
};

/** Order-insensitive comparison of two type lists. */
export const sameEntityTypeSet = (
  left: readonly string[],
  right: readonly string[]
): boolean => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((entityType) => rightSet.has(entityType))
  );
};
