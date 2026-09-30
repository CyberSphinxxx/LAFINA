/**
 * Whether an account still has the walkthrough coming.
 *
 * Local only and never synced, as on the desktop app: the tour explains this
 * phone's app. Kept in `local_settings`, so it needs no table of its own.
 *
 * The tour is queued when an account first finishes onboarding — a new
 * account, or a new guest — so people who already use LAFINA are not stopped
 * by it after an update. Anyone can run it again from Profile.
 */

import { localSettingsStore } from './localSettingsStore';

const KEY = 'product_tour';
const PENDING = 'pending';

/**
 * Raise this when the tour gains a screen worth going back for; it is saved
 * with each finished tour so a later version can tell who saw what.
 */
export const PRODUCT_TOUR_VERSION = 1;

export const productTourStore = {
  /** Marks the walkthrough as due for this account, the first time it reaches the app. */
  queue: (userId: string): void => {
    if (!userId) return;
    // An account that has already seen or skipped the tour is not asked again.
    if (localSettingsStore.get(userId, KEY) !== null) return;
    localSettingsStore.set(userId, KEY, PENDING);
  },

  /** True when the walkthrough was queued and has not been finished or skipped. */
  isPending: (userId: string): boolean =>
    Boolean(userId) && localSettingsStore.get(userId, KEY) === PENDING,

  /** Records that the walkthrough is done with, whether finished or skipped. */
  markSeen: (userId: string, completed: boolean): void => {
    if (!userId) return;
    localSettingsStore.set(
      userId,
      KEY,
      JSON.stringify({ version: PRODUCT_TOUR_VERSION, completed, seenAt: new Date().toISOString() }),
    );
  },
};
