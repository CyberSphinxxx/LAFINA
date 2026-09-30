/**
 * What the walkthrough says, and what it points at.
 *
 * The mobile counterpart of the desktop app's `tourSteps.ts`, rewritten for
 * this app's navigation: four tabs and a Mic that opens the study tools when
 * held. Kept apart from the overlay so the wording, the order and the anchors
 * can be checked without rendering anything.
 */

import type { TabType } from '../components/CustomTabBar';

/** Something on screen a step can spotlight; see `tourTargets.ts`. */
export type TourAnchor = 'tab-chat' | 'tab-calendar' | 'tab-notes' | 'tab-profile' | 'mic';

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** What to spotlight; the card sits in the middle when absent. */
  anchor?: TourAnchor;
  /** Screen to show behind the overlay while this step is up. */
  tab?: TabType;
}

export interface TourAudience {
  isGuest: boolean;
  isPro: boolean;
}

/** The line about the paid tools, which depends on who is reading. */
export const proNote = (isPro: boolean): string =>
  isPro
    ? 'Flashcards, Study Notes and Meetings are included with your plan.'
    : 'Flashcards, Study Notes and Meetings need Student Pro; the Pomodoro works on every account.';

/**
 * Builds the walkthrough for one account. The paid tools are described, never
 * opened: landing on one would raise its paywall over the tour.
 */
export const buildTourSteps = ({ isGuest, isPro }: TourAudience): TourStep[] => [
  {
    id: 'welcome',
    title: 'Welcome to LAFINA',
    body: isGuest
      ? 'You are using LAFINA as a guest, so everything you do stays on this phone. Here is a quick look around — it takes about a minute.'
      : 'Your account is ready. Here is a quick look around — it takes about a minute, and you can skip it at any point.',
  },
  {
    id: 'calendar',
    title: 'Calendar',
    body: 'Your classes, deadlines and study blocks in one place. Tap a day in the week strip to see it hour by hour, tap an empty hour or the + button to add something, and use Import to bring in a class schedule.',
    anchor: 'tab-calendar',
    tab: 'calendar',
  },
  {
    id: 'notes',
    title: 'Notes',
    body: 'Lecture notes with headings, checklists and images. Pin the ones you keep coming back to, and search or filter by category to find the rest.',
    anchor: 'tab-notes',
    tab: 'notes',
  },
  {
    id: 'assistant',
    title: 'Chat',
    body: 'Ask in plain language — "block 2 to 4 pm for thesis writing tomorrow" — and LAFINA schedules it. Scheduling runs on this phone, so it works with no connection.',
    anchor: 'tab-chat',
    tab: 'chat',
  },
  {
    id: 'voice',
    title: 'Talk to it',
    body: 'Tap the mic to speak instead of typing: dictate a note, or say what you want scheduled. Your voice is transcribed on this phone and never uploaded.',
    anchor: 'mic',
  },
  {
    id: 'tools',
    title: 'Your study tools',
    body: `Hold the mic and slide to a tool: the Pomodoro focus timer, Flashcards and Study Notes written from your PDFs and slides, and Meetings recorded and transcribed on this phone. ${proNote(isPro)}`,
    anchor: 'mic',
  },
  {
    id: 'account',
    title: isGuest ? 'Your guest session' : 'Profile & settings',
    body: isGuest
      ? 'Guest data lives on this phone. Create an account from here when you want it on your other devices — nothing you have made is lost in the swap.'
      : 'Reminder preferences, time format, dark mode and your photo all live here. Your data syncs when you are signed in and online.',
    anchor: 'tab-profile',
    tab: 'profile',
  },
  {
    id: 'done',
    title: 'That is the tour',
    body: 'Everything is stored on this phone first, so LAFINA works with no connection. You can run this walkthrough again any time from Profile.',
  },
];
