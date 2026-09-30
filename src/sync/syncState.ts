import { DatabaseTransaction } from '../storage/database';
import { syncStateStore } from '../storage/syncStateStore';
import { PersistedSyncStatus } from '../storage/syncTypes';

export type SyncStatusState = PersistedSyncStatus;

export interface SyncStateData {
  status: SyncStatusState;
  cursor: number;
  lastSyncedAt: string | null;
  errorMessage: string | null;
}

type SyncStateListener = (state: SyncStateData) => void;

const localOnlyState = (
  status: SyncStatusState = 'Local only',
  errorMessage: string | null = null
): SyncStateData => ({
  status,
  cursor: 0,
  lastSyncedAt: null,
  errorMessage,
});

let activeLocalUserId: string | null = null;
let currentState: SyncStateData = localOnlyState();
const listeners: Set<SyncStateListener> = new Set();

const publish = (state: SyncStateData): SyncStateData => {
  currentState = { ...state };
  const snapshot = { ...currentState };
  listeners.forEach((listener) => listener(snapshot));
  return snapshot;
};

const loadPersisted = (localUserId: string): SyncStateData => {
  const persisted = syncStateStore.load(localUserId);
  return {
    status: persisted.status,
    cursor: persisted.cursor,
    lastSyncedAt: persisted.lastSyncedAt,
    errorMessage: persisted.errorMessage,
  };
};

export const syncState = {
  /** Loads and publishes the persisted account-scoped state for a local user. */
  activate: (localUserId: string): SyncStateData => {
    activeLocalUserId = localUserId;
    return publish(loadPersisted(localUserId));
  },

  /** Reloads state after a transaction has committed. */
  reload: (localUserId: string): SyncStateData => {
    activeLocalUserId = localUserId;
    return publish(loadPersisted(localUserId));
  },

  /** Clears account-specific state so a signed-out user cannot leak sync UI state. */
  deactivate: (
    status: SyncStatusState = 'Local only',
    errorMessage: string | null = null
  ): void => {
    activeLocalUserId = null;
    publish(localOnlyState(status, errorMessage));
  },

  /** Returns an immutable snapshot of the currently active sync state. */
  getState: (): SyncStateData => ({ ...currentState }),

  /** Persists and publishes a status change without changing cursor progress. */
  setStatus: (
    localUserId: string,
    status: SyncStatusState,
    errorMessage: string | null = null
  ): void => {
    const previous =
      activeLocalUserId === localUserId
        ? currentState
        : loadPersisted(localUserId);
    const next: SyncStateData = {
      ...previous,
      status,
      errorMessage,
    };
    syncStateStore.save(localUserId, next);
    activeLocalUserId = localUserId;
    publish(next);
  },

  /**
   * Saves cursor progress together with its status and server timestamp.
   * When an executor is supplied, callers should reload after the transaction commits.
   */
  saveProgress: (
    localUserId: string,
    cursor: number,
    lastSyncedAt: string | null,
    status: SyncStatusState,
    errorMessage: string | null,
    executor?: DatabaseTransaction
  ): void => {
    const next: SyncStateData = {
      cursor,
      lastSyncedAt,
      status,
      errorMessage,
    };
    syncStateStore.save(
      localUserId,
      next,
      'account',
      localUserId,
      executor
    );
    if (!executor) {
      activeLocalUserId = localUserId;
      publish(next);
    }
  },

  /** Registers a listener and returns an unsubscribe callback. */
  subscribe: (listener: SyncStateListener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
