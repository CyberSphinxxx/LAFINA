/**
 * Centralized constants for LAFINA — replace magic numbers and strings.
 * All parts of the app should import from here instead of hardcoding values.
 */

// ═══════════════════════════════════════════════════════════
// Timing Constants
// ═══════════════════════════════════════════════════════════


/** Artificial processing delay (ms) for AI action feedback in UI */
export const AI_PROCESSING_DELAY_MS = 600;

/** Delay (ms) before auto-closing the voice success state */
export const VOICE_SUCCESS_DELAY_MS = 2000;

/** Delay (ms) before closing a resolved reminder call result state */
export const CALL_RESULT_DELAY_MS = 1500;

/** NLU parser processing delay (ms) */
export const NLU_PARSER_DELAY_MS = 1500;

// ═══════════════════════════════════════════════════════════
// Identity Constants
// ═══════════════════════════════════════════════════════════

/** Default user ID used when no authenticated user exists */
export const DEFAULT_USER_ID = 'user1';

/** Guest user ID for offline-first skip-account flow */
export const GUEST_USER_ID = 'guest';

/** Display name assigned to guest users */
export const GUEST_USERNAME = 'Guest';

// ═══════════════════════════════════════════════════════════
// NLU Parser Defaults
// ═══════════════════════════════════════════════════════════

/** Default due time for voice-created tasks */
export const DEFAULT_TASK_DUE_TIME = '17:00';

/** Default start time for voice-created time blocks */
export const DEFAULT_BLOCK_START_TIME = '14:00';

/** Default end time for voice-created time blocks */
export const DEFAULT_BLOCK_END_TIME = '16:00';

/** Default title for voice-created time blocks */
export const DEFAULT_BLOCK_TITLE = 'Deep Work';

/** Default title for voice-created notes */
export const DEFAULT_NOTE_TITLE = 'Quick Note';

/** Default task priority for voice-created tasks */
export const DEFAULT_TASK_PRIORITY = 'Medium';

/** Default task category for voice-created tasks */
export const DEFAULT_TASK_CATEGORY = 'Work';

/** Default block category for voice-created time blocks */
export const DEFAULT_BLOCK_CATEGORY = 'Work';

/** Default note category for voice-created notes */
export const DEFAULT_NOTE_CATEGORY = 'Personal';

// ═══════════════════════════════════════════════════════════
// Pagination & Limits
// ═══════════════════════════════════════════════════════════

/** Maximum items shown in month view preview items */
export const MONTH_PREVIEW_MAX = 3;

/** Rendered window size for FlatList performance */
export const FLATLIST_WINDOW_SIZE = 21;

// ═══════════════════════════════════════════════════════════
// Onboarding Defaults
// ═══════════════════════════════════════════════════════════

export const ONBOARDING_TOTAL_STEPS = 5;
export const DEFAULT_WAKE_TIME = '07:00';
export const DEFAULT_SLEEP_TIME = '22:00';
export const DEFAULT_STUDY_PEAK_HOURS: string[] = [];
export const DEFAULT_BUSIEST_DAY = 'Monday';
export const DEFAULT_REMINDER_LEAD = '15';
export const DEFAULT_SNOOZE_TENDENCY = 'snooze_once';
export const DEFAULT_CLASS_COUNT = '4-6';
export const DEFAULT_LONGEST_GAP = '1 hour';
