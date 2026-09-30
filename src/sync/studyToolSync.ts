/**
 * Applies synced study-tool changes (Pomodoro, flashcards, study notes,
 * meetings) to local tables.
 *
 * Keep this file identical in LAFINA mobile (`src/sync/studyToolSync.ts`) and
 * LAFINA desktop (`src/renderer/src/sync/studyToolSync.ts`).
 *
 * Payloads were validated by the server, but a malformed one still throws: the
 * sync worker rolls the whole page back rather than store half of it.
 */
import type { DatabaseTransaction } from '../storage/database';
import { clampSettings, DEFAULT_POMODORO_SETTINGS } from '../storage/pomodoroEngine';
import { localDayKey } from '../storage/pomodoroStore';
import { SYNCED_MEETING_STATUSES } from '../storage/recordedMeetingStore';
import type { SyncEntityType, SyncOperation } from '../storage/syncTypes';
import { normalizeNotes } from '../meetings/meetingNotes';
import type { MeetingStatus } from '../meetings/meetingState';

export interface StudyToolChange {
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  updatedAt: string;
}

/** Local tables of the list-shaped study-tool types (the settings singleton has none). */
export const STUDY_TOOL_TABLES: Partial<Record<SyncEntityType, string>> = {
  pomodoro_session: 'pomodoro_sessions',
  flashcard_deck: 'flashcard_decks',
  study_summary: 'study_summaries',
  recorded_meeting: 'recorded_meetings',
};

/** Pipeline states owned by the device running them; an incoming copy must not overwrite them. */
const ACTIVE_MEETING_STATUSES: readonly string[] = [
  'recording',
  'paused',
  'importing',
  'transcribing',
  'generating_notes',
];

const POMODORO_PHASES = ['focus', 'shortBreak', 'longBreak'];

const fail = (entityType: string, key: string, expected: string): never => {
  throw new Error(`Sync ${entityType} field "${key}" must be ${expected}.`);
};

const text = (entityType: string, payload: Record<string, unknown>, key: string): string => {
  const value = payload[key];
  return typeof value === 'string' ? value : fail(entityType, key, 'a string');
};

const textOr = (
  entityType: string,
  payload: Record<string, unknown>,
  key: string,
  fallback: string
): string => {
  const value = payload[key];
  if (value === undefined || value === null) return fallback;
  return typeof value === 'string' ? value : fail(entityType, key, 'a string');
};

const nullableText = (
  entityType: string,
  payload: Record<string, unknown>,
  key: string
): string | null => {
  const value = payload[key];
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : fail(entityType, key, 'a string or null');
};

const numberOr = (
  entityType: string,
  payload: Record<string, unknown>,
  key: string,
  fallback: number
): number => {
  const value = payload[key];
  if (value === undefined || value === null) return fallback;
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fail(entityType, key, 'a number');
};

const booleanOr = (
  entityType: string,
  payload: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean => {
  const value = payload[key];
  if (value === undefined || value === null) return fallback;
  return typeof value === 'boolean' ? value : fail(entityType, key, 'a boolean');
};

const list = (entityType: string, payload: Record<string, unknown>, key: string): unknown[] => {
  const value = payload[key];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : fail(entityType, key, 'a list');
};

const record = (entityType: string, key: string, value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(entityType, key, 'an object');

const textList = (entityType: string, payload: Record<string, unknown>, key: string): string[] =>
  list(entityType, payload, key).map((item) =>
    typeof item === 'string' ? item : fail(entityType, key, 'a list of strings')
  );

/** Refuses to overwrite a row another local account owns. */
const assertOwnership = (
  tx: DatabaseTransaction,
  table: string,
  entityId: string,
  localUserId: string
): void => {
  const owner = tx.executeSync(`SELECT user_id FROM ${table} WHERE id = ?`, [entityId]).rows?.[0]
    ?.user_id;
  if (typeof owner === 'string' && owner !== localUserId) {
    throw new Error(`Refusing to apply ${table} change ${entityId} to another local account.`);
  }
};

const applyPomodoroSettings = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: StudyToolChange
): void => {
  const type = change.entityType;
  const payload = change.payload;
  const defaults = DEFAULT_POMODORO_SETTINGS;
  const settings = clampSettings({
    ...defaults,
    focusMinutes: numberOr(type, payload, 'focus_minutes', defaults.focusMinutes),
    shortBreakMinutes: numberOr(type, payload, 'short_break_minutes', defaults.shortBreakMinutes),
    longBreakMinutes: numberOr(type, payload, 'long_break_minutes', defaults.longBreakMinutes),
    longBreakInterval: numberOr(type, payload, 'long_break_interval', defaults.longBreakInterval),
    autoStartBreaks: booleanOr(type, payload, 'auto_start_breaks', defaults.autoStartBreaks),
    autoStartFocus: booleanOr(type, payload, 'auto_start_focus', defaults.autoStartFocus),
    soundEnabled: booleanOr(type, payload, 'sound_enabled', defaults.soundEnabled),
    volume: numberOr(type, payload, 'volume', defaults.volume),
    ringSeconds: numberOr(type, payload, 'ring_seconds', defaults.ringSeconds),
    notificationsEnabled: booleanOr(
      type,
      payload,
      'notifications_enabled',
      defaults.notificationsEnabled
    ),
  });
  // The ring sound is a file on the device that chose it, so the local one is kept.
  tx.executeSync(
    `INSERT INTO pomodoro_settings (
       user_id, focus_minutes, short_break_minutes, long_break_minutes, long_break_interval,
       auto_start_breaks, auto_start_focus, sound_enabled, volume, ring_seconds,
       notifications_enabled, ring_sound_uri, ring_sound_name, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       focus_minutes = excluded.focus_minutes,
       short_break_minutes = excluded.short_break_minutes,
       long_break_minutes = excluded.long_break_minutes,
       long_break_interval = excluded.long_break_interval,
       auto_start_breaks = excluded.auto_start_breaks,
       auto_start_focus = excluded.auto_start_focus,
       sound_enabled = excluded.sound_enabled,
       volume = excluded.volume,
       ring_seconds = excluded.ring_seconds,
       notifications_enabled = excluded.notifications_enabled,
       updated_at = excluded.updated_at`,
    [
      localUserId,
      settings.focusMinutes,
      settings.shortBreakMinutes,
      settings.longBreakMinutes,
      settings.longBreakInterval,
      settings.autoStartBreaks ? 1 : 0,
      settings.autoStartFocus ? 1 : 0,
      settings.soundEnabled ? 1 : 0,
      settings.volume,
      settings.ringSeconds,
      settings.notificationsEnabled ? 1 : 0,
      change.updatedAt,
    ]
  );
};

const applyPomodoroSession = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: StudyToolChange
): void => {
  const type = change.entityType;
  const payload = change.payload;
  assertOwnership(tx, 'pomodoro_sessions', change.entityId, localUserId);
  const phase = text(type, payload, 'phase');
  if (!POMODORO_PHASES.includes(phase)) fail(type, 'phase', 'a Pomodoro phase');
  const finishedAt = text(type, payload, 'finished_at');
  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(finishedMs)) fail(type, 'finished_at', 'a timestamp');
  const task = textOr(type, payload, 'task', '').trim();
  tx.executeSync(
    `INSERT INTO pomodoro_sessions (
       id, user_id, phase, task, duration_ms, started_at, finished_at, day_key, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       phase = excluded.phase, task = excluded.task, duration_ms = excluded.duration_ms,
       started_at = excluded.started_at, finished_at = excluded.finished_at,
       day_key = excluded.day_key, updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      change.entityId,
      localUserId,
      phase,
      task || null,
      Math.max(0, Math.round(numberOr(type, payload, 'duration_ms', 0))),
      nullableText(type, payload, 'started_at'),
      finishedAt,
      // The day in this device's timezone, so "today" means today here.
      localDayKey(finishedMs),
      change.updatedAt,
    ]
  );
};

const applyFlashcardDeck = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: StudyToolChange
): void => {
  const type = change.entityType;
  const payload = change.payload;
  assertOwnership(tx, 'flashcard_decks', change.entityId, localUserId);
  const cards = list(type, payload, 'cards').map((entry) => {
    const card = record(type, 'cards', entry);
    return { question: text(type, card, 'question'), answer: text(type, card, 'answer') };
  });
  tx.executeSync(
    `INSERT INTO flashcard_decks (
       id, user_id, title, source_name, card_count, cards_json,
       page_count, ocr_page_count, warnings_json, created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, source_name = excluded.source_name,
       card_count = excluded.card_count, cards_json = excluded.cards_json,
       page_count = excluded.page_count, ocr_page_count = excluded.ocr_page_count,
       warnings_json = excluded.warnings_json, created_at = excluded.created_at,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      change.entityId,
      localUserId,
      text(type, payload, 'title'),
      nullableText(type, payload, 'source_name'),
      cards.length,
      JSON.stringify(cards),
      Math.max(0, Math.round(numberOr(type, payload, 'page_count', 0))),
      Math.max(0, Math.round(numberOr(type, payload, 'ocr_page_count', 0))),
      JSON.stringify(textList(type, payload, 'warnings')),
      textOr(type, payload, 'created_at', change.updatedAt),
      change.updatedAt,
    ]
  );
};

const applyStudySummary = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: StudyToolChange
): void => {
  const type = change.entityType;
  const payload = change.payload;
  assertOwnership(tx, 'study_summaries', change.entityId, localUserId);
  const sections = list(type, payload, 'sections').map((entry) => {
    const section = record(type, 'sections', entry);
    return { heading: text(type, section, 'heading'), points: textList(type, section, 'points') };
  });
  const keyTerms = list(type, payload, 'key_terms').map((entry) => {
    const term = record(type, 'key_terms', entry);
    return { term: text(type, term, 'term'), meaning: text(type, term, 'meaning') };
  });
  tx.executeSync(
    `INSERT INTO study_summaries (
       id, user_id, title, source_name, source_kind, overview,
       sections_json, key_terms_json, markdown, page_count, warnings_json,
       created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, source_name = excluded.source_name,
       source_kind = excluded.source_kind, overview = excluded.overview,
       sections_json = excluded.sections_json, key_terms_json = excluded.key_terms_json,
       markdown = excluded.markdown, page_count = excluded.page_count,
       warnings_json = excluded.warnings_json, created_at = excluded.created_at,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      change.entityId,
      localUserId,
      text(type, payload, 'title'),
      nullableText(type, payload, 'source_name'),
      textOr(type, payload, 'source_kind', '') || 'pdf',
      textOr(type, payload, 'overview', ''),
      JSON.stringify(sections),
      JSON.stringify(keyTerms),
      textOr(type, payload, 'markdown', ''),
      Math.max(0, Math.round(numberOr(type, payload, 'page_count', 0))),
      JSON.stringify(textList(type, payload, 'warnings')),
      textOr(type, payload, 'created_at', change.updatedAt),
      change.updatedAt,
    ]
  );
};

const applyRecordedMeeting = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: StudyToolChange
): void => {
  const type = change.entityType;
  const payload = change.payload;
  assertOwnership(tx, 'recorded_meetings', change.entityId, localUserId);

  const local = tx.executeSync('SELECT status FROM recorded_meetings WHERE id = ?', [
    change.entityId,
  ]).rows?.[0];
  if (local && ACTIVE_MEETING_STATUSES.includes(String(local.status))) {
    // This device is recording or processing the meeting right now. Its own
    // result will sync when it finishes; an older copy must not undo the work.
    return;
  }

  const status = text(type, payload, 'status');
  if (!SYNCED_MEETING_STATUSES.includes(status as MeetingStatus)) {
    fail(type, 'status', 'a finished meeting status');
  }
  const transcript =
    payload.transcript === null || payload.transcript === undefined
      ? null
      : list(type, payload, 'transcript').map((entry) => {
          const segment = record(type, 'transcript', entry);
          return {
            startMs: numberOr(type, segment, 'start_ms', 0),
            endMs: numberOr(type, segment, 'end_ms', 0),
            text: text(type, segment, 'text'),
          };
        });
  const notes =
    payload.notes === null || payload.notes === undefined
      ? null
      : normalizeNotes(record(type, 'notes', payload.notes));
  const source = textOr(type, payload, 'source', 'recording') === 'upload' ? 'upload' : 'recording';

  // A meeting new to this device has no audio here; one this device recorded keeps its own.
  tx.executeSync(
    `INSERT INTO recorded_meetings (
       id, user_id, title, status, started_at, duration_seconds, language,
       transcript_json, notes_json, notes_edited, source, has_audio,
       created_at, updated_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, status = excluded.status, started_at = excluded.started_at,
       duration_seconds = excluded.duration_seconds, language = excluded.language,
       transcript_json = excluded.transcript_json, notes_json = excluded.notes_json,
       notes_edited = excluded.notes_edited, source = excluded.source,
       error_code = NULL, error_detail = NULL,
       updated_at = excluded.updated_at, deleted_at = NULL`,
    [
      change.entityId,
      localUserId,
      text(type, payload, 'title'),
      status,
      text(type, payload, 'started_at'),
      Math.max(0, numberOr(type, payload, 'duration_seconds', 0)),
      nullableText(type, payload, 'language'),
      transcript ? JSON.stringify(transcript) : null,
      notes ? JSON.stringify(notes) : null,
      booleanOr(type, payload, 'notes_edited', false) ? 1 : 0,
      source,
      change.updatedAt,
      change.updatedAt,
    ]
  );
};

/**
 * Applies a create or update of a study-tool type. Returns false for any
 * other type, so the caller can reject it. Deletes go through the caller's
 * generic tombstone path (see `STUDY_TOOL_TABLES`).
 */
export const applyStudyToolChange = (
  tx: DatabaseTransaction,
  localUserId: string,
  change: StudyToolChange
): boolean => {
  switch (change.entityType) {
    case 'pomodoro_settings':
      applyPomodoroSettings(tx, localUserId, change);
      return true;
    case 'pomodoro_session':
      applyPomodoroSession(tx, localUserId, change);
      return true;
    case 'flashcard_deck':
      applyFlashcardDeck(tx, localUserId, change);
      return true;
    case 'study_summary':
      applyStudySummary(tx, localUserId, change);
      return true;
    case 'recorded_meeting':
      applyRecordedMeeting(tx, localUserId, change);
      return true;
    default:
      return false;
  }
};
