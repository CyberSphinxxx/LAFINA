/**
 * Which paid features this account may use.
 *
 * The server decides for real — every gated endpoint checks the account again
 * before it does any work. This is the client's copy of the same rule, used to
 * show a paywall instead of letting someone upload a document only to be
 * refused a minute later.
 */

import { businessStore } from '../storage/businessStore';
import { userStore } from '../storage/userStore';
import { GUEST_USER_ID } from '../constants';

const PRO_PLANS = ['student_pro', 'business'];

/** True when the account's plan unlocks the cloud AI features. */
export const hasProEntitlement = (userId: string): boolean => {
  if (!userId || userId === GUEST_USER_ID) return false;
  const localUser = userStore.getUserById(userId);
  const cached = businessStore.getCachedCapabilities(userId);
  return (
    localUser?.role === 'student_pro' ||
    localUser?.role === 'admin' ||
    localUser?.role === 'business' ||
    PRO_PLANS.includes(cached?.effectivePlan ?? '') ||
    PRO_PLANS.includes(cached?.subscriptionPlan ?? '')
  );
};

/**
 * True only for the `student_pro` role — the Student Pro badge. Narrower than
 * `hasProEntitlement`: admins and business accounts get the features, not the badge.
 */
export const isStudentProRole = (role: string | null | undefined): boolean => role === 'student_pro';

/**
 * True for a Student Pro account specifically — the plan, not the perk.
 *
 * `hasProEntitlement` also covers admin and business accounts, which is right
 * for gating paid features. This one is for what is promised to Student Pro
 * alone, such as the cloud reminder voice. The cached plan counts too: a fresh
 * install carries the local role `student` until the next cloud sign-in.
 */
export const isStudentProAccount = (userId: string): boolean => {
  if (!userId || userId === GUEST_USER_ID) return false;
  const localUser = userStore.getUserById(userId);
  const cached = businessStore.getCachedCapabilities(userId);
  return (
    localUser?.role === 'student_pro' ||
    cached?.effectivePlan === 'student_pro' ||
    cached?.subscriptionPlan === 'student_pro'
  );
};

/** True for the offline guest session, which has no cloud account at all. */
export const isGuestAccount = (userId: string): boolean =>
  userId === GUEST_USER_ID || userStore.isGuest(userId);
