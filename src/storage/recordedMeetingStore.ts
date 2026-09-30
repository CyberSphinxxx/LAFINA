/**
 * Recorded meetings.
 *
 * The row is the index; the audio itself is a file on the device that
 * recorded it and never leaves it. Once a meeting has a transcript
 * (`transcription_complete` or `completed`) its text — transcript and notes —
 * syncs, so it can be read and summarised on another device. A meeting that
 * arrived by sync has no audio there (`hasAudio` false).
 *
 * A meeting's row is written at every step — started, stopped, transcribed,
 * summarised — so whatever the app is doing when it closes, the next launch
 * finds the meeting in a state it can pick up from.
 */

import { db, DatabaseTransaction } from './database';
import { syncOutboxStore } from './syncOutboxStore';
import type { SyncPayload } from './syncTypes';
import type { MeetingStatus } from '../meetings/meetingState';
import type { MeetingErrorCode } from '../meetings/meetingErrors';
import type { TranscriptSegment } from '../meetings/transcript';
import { normalizeNotes, type MeetingNotes } from '../meetings/meetingNotes';

/** Statuses whose text is final enough to sync. */
export const SYNCED_MEETING_STATUSES: readonly MeetingStatus[] = [
  'transcription_complete',
  'completed',
];

/** Limits the sync API enforces; the builder trims to them so a meeting always syncs. */
const SYNC_LIMITS = {
  title: 200,
  language: 16,
  segments: 20_000,
  segmentText: 10_000,
  transcriptText: 600_000,
  notesTitle: 200,
  summary: 20_000,
  listItems: 200,
  item: 5000,
  short: 500,
};

export interface RecordedMeeting {
  id: string;
  userId: string;
  title: string;
  status: MeetingStatus;
  errorCode: MeetingErrorCode | null;
  errorDetail: string | null;
  startedAt: string;
  durationSeconds: number;
  audioBytes: number;
  microphoneLabel: string | null;
  whisperModel: string | null;
  transcriptionDevice: 'cpu' | 'gpu' | null;
  language: string | null;
  transcript: TranscriptSegment[] | null;
  notes: MeetingNotes | null;
  notesEdited: boolean;
  /** Section notes from a notes run that did not finish, so a retry reuses them. */
  sectionCache: Record<string, MeetingNotes>;
  /** Set when the recording was rescued after LAFINA closed mid-meeting. */
  recovered: boolean;
  /** Recorded in LAFINA, or imported from an audio or video file. */
  source: 'recording' | 'upload';
  /** The imported file's name, for uploads. */
  sourceFileName: string | null;
  /** False when the meeting arrived by sync: its audio is on another device. */
  hasAudio: boolean;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    // A damaged row still opens; it just shows what could be read.
    return fallback;
  }
};

const mapRow = (row: Row): RecordedMeeting => {
  const transcript = parseJson<unknown>(row.transcript_json, null);
  const notes = parseJson<unknown>(row.notes_json, null);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title ?? 'Meeting'),
    status: String(row.status) as MeetingStatus,
    errorCode: typeof row.error_code === 'string' ? (row.error_code as MeetingErrorCode) : null,
    errorDetail: typeof row.error_detail === 'string' ? row.error_detail : null,
    startedAt: String(row.started_at),
    durationSeconds: Number(row.duration_seconds) || 0,
    audioBytes: Number(row.audio_bytes) || 0,
    microphoneLabel: typeof row.microphone_label === 'string' ? row.microphone_label : null,
    whisperModel: typeof row.whisper_model === 'string' ? row.whisper_model : null,
    transcriptionDevice: row.transcription_device === 'gpu' ? 'gpu' : row.transcription_device === 'cpu' ? 'cpu' : null,
    language: typeof row.language === 'string' ? row.language : null,
    transcript: Array.isArray(transcript)
      ? (transcript as TranscriptSegment[]).filter((segment) => segment && typeof segment.text === 'string')
      : null,
    notes: notes && typeof notes === 'object' ? normalizeNotes(notes) : null,
    notesEdited: row.notes_edited === 1,
    sectionCache: parseJson<Record<string, MeetingNotes>>(row.section_cache_json, {}),
    recovered: row.recovered === 1,
    source: row.source === 'upload' ? 'upload' : 'recording',
    sourceFileName: typeof row.source_file_name === 'string' ? row.source_file_name : null,
    hasAudio: row.has_audio !== 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
};

const trimList = (items: unknown, limit = SYNC_LIMITS.item): string[] =>
  (Array.isArray(items) ? items : [])
    .filter((item): item is string => typeof item === 'string')
    .slice(0, SYNC_LIMITS.listItems)
    .map((item) => item.slice(0, limit));

const notesPayload = (notes: MeetingNotes): SyncPayload => ({
  title: notes.title.slice(0, SYNC_LIMITS.notesTitle),
  summary: notes.summary.slice(0, SYNC_LIMITS.summary),
  key_topics: notes.key_topics.slice(0, SYNC_LIMITS.listItems).map((topic) => ({
    topic: topic.topic.slice(0, SYNC_LIMITS.item),
    discussion: topic.discussion.slice(0, SYNC_LIMITS.item),
  })),
  decisions: trimList(notes.decisions),
  action_items: notes.action_items.slice(0, SYNC_LIMITS.listItems).map((item) => ({
    task: item.task.slice(0, SYNC_LIMITS.item),
    assignee: item.assignee.slice(0, SYNC_LIMITS.short),
    deadline: item.deadline.slice(0, SYNC_LIMITS.short),
    status: item.status === 'done' ? 'done' : 'pending',
  })),
  important_dates: trimList(notes.important_dates),
  issues: trimList(notes.issues),
  unresolved_questions: trimList(notes.unresolved_questions),
  key_points: trimList(notes.key_points),
});

/**
 * The sync payload for one stored meeting row, or null while it has nothing
 * final to share (still recording, transcribing, or failed before a transcript).
 */
export const recordedMeetingPayload = (row: Row): SyncPayload | null => {
  const meeting = mapRow(row);
  if (!SYNCED_MEETING_STATUSES.includes(meeting.status) || !meeting.transcript) return null;

  const transcript: SyncPayload[] = [];
  let textBudget = SYNC_LIMITS.transcriptText;
  for (const segment of meeting.transcript.slice(0, SYNC_LIMITS.segments)) {
    const text = segment.text.slice(0, Math.min(SYNC_LIMITS.segmentText, textBudget));
    if (!text) break;
    textBudget -= text.length;
    transcript.push({
      start_ms: Math.max(0, Math.round(Number(segment.startMs) || 0)),
      end_ms: Math.max(0, Math.round(Number(segment.endMs) || 0)),
      text,
    });
  }

  return {
    title: meeting.title.slice(0, SYNC_LIMITS.title) || 'Meeting',
    started_at: meeting.startedAt,
    duration_seconds: Math.max(0, meeting.durationSeconds),
    source: meeting.source,
    language: meeting.language ? meeting.language.slice(0, SYNC_LIMITS.language) : null,
    status: meeting.status,
    transcript,
    notes: meeting.notes ? notesPayload(meeting.notes) : null,
    notes_edited: meeting.notesEdited,
  };
};

/** Queues the meeting's text if it has reached a status worth sharing. */
const enqueueIfFinal = (id: string, tx: DatabaseTransaction): void => {
  const row = tx.executeSync('SELECT * FROM recorded_meetings WHERE id = ? AND deleted_at IS NULL', [id])
    .rows?.[0];
  if (!row) return;
  const payload = recordedMeetingPayload(row);
  if (!payload) return;
  const userId = String(row.user_id);
  syncOutboxStore.enqueueMutation(userId, 'recorded_meeting', id, 'update', payload, 'account', userId, tx);
};

export interface MeetingPatch {
  title?: string;
  status?: MeetingStatus;
  errorCode?: MeetingErrorCode | null;
  errorDetail?: string | null;
  durationSeconds?: number;
  audioBytes?: number;
  whisperModel?: string | null;
  transcriptionDevice?: 'cpu' | 'gpu' | null;
  language?: string | null;
  transcript?: TranscriptSegment[] | null;
  notes?: MeetingNotes | null;
  notesEdited?: boolean;
  sectionCache?: Record<string, MeetingNotes>;
  recovered?: boolean;
}

const COLUMNS: Record<keyof MeetingPatch, { column: string; encode: (value: never) => unknown }> = {
  title: { column: 'title', encode: (value: string) => value.slice(0, 160) || 'Meeting' },
  status: { column: 'status', encode: (value: string) => value },
  errorCode: { column: 'error_code', encode: (value: string | null) => value },
  errorDetail: { column: 'error_detail', encode: (value: string | null) => (value ? value.slice(0, 1_000) : null) },
  durationSeconds: { column: 'duration_seconds', encode: (value: number) => value },
  audioBytes: { column: 'audio_bytes', encode: (value: number) => value },
  whisperModel: { column: 'whisper_model', encode: (value: string | null) => value },
  transcriptionDevice: { column: 'transcription_device', encode: (value: string | null) => value },
  language: { column: 'language', encode: (value: string | null) => value },
  transcript: { column: 'transcript_json', encode: (value: unknown) => (value ? JSON.stringify(value) : null) },
  notes: { column: 'notes_json', encode: (value: unknown) => (value ? JSON.stringify(value) : null) },
  notesEdited: { column: 'notes_edited', encode: (value: boolean) => (value ? 1 : 0) },
  sectionCache: { column: 'section_cache_json', encode: (value: unknown) => JSON.stringify(value ?? {}) },
  recovered: { column: 'recovered', encode: (value: boolean) => (value ? 1 : 0) },
};

export const recordedMeetingStore = {
  create: (input: {
    id: string;
    userId: string;
    title: string;
    microphoneLabel?: string | null;
    /** An upload starts out importing rather than recording. */
    upload?: { fileName: string };
  }): void => {
    const now = new Date().toISOString();
    db.executeSync(
      `INSERT INTO recorded_meetings (
         id, user_id, title, status, started_at, microphone_label, source, source_file_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.title.slice(0, 160) || 'Meeting',
        input.upload ? 'importing' : 'recording',
        now,
        input.microphoneLabel ?? null,
        input.upload ? 'upload' : 'recording',
        input.upload ? input.upload.fileName.slice(0, 260) : null,
        now,
        now,
      ],
    );
  },

  get: (id: string): RecordedMeeting | null => {
    try {
      const row = db.executeSync(
        'SELECT * FROM recorded_meetings WHERE id = ? AND deleted_at IS NULL',
        [id],
      ).rows?.[0];
      return row ? mapRow(row) : null;
    } catch (error) {
      console.error('Error loading meeting:', error);
      return null;
    }
  },

  /** Newest first. */
  list: (userId: string): RecordedMeeting[] => {
    try {
      return (
        db.executeSync(
          `SELECT * FROM recorded_meetings WHERE user_id = ? AND deleted_at IS NULL
            ORDER BY started_at DESC, rowid DESC`,
          [userId],
        ).rows ?? []
      ).map(mapRow);
    } catch (error) {
      console.error('Error loading meetings:', error);
      return [];
    }
  },

  update: (id: string, patch: MeetingPatch): void => {
    const sets: string[] = [];
    const values: unknown[] = [];
    (Object.keys(patch) as Array<keyof MeetingPatch>).forEach((key) => {
      const spec = COLUMNS[key];
      // `undefined` means "leave as it is"; `null` clears.
      if (!spec || patch[key] === undefined) return;
      sets.push(`${spec.column} = ?`);
      values.push(spec.encode(patch[key] as never));
    });
    if (!sets.length) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString(), id);
    db.transactionSync((tx: DatabaseTransaction) => {
      tx.executeSync(`UPDATE recorded_meetings SET ${sets.join(', ')} WHERE id = ?`, values);
      enqueueIfFinal(id, tx);
    });
  },

  /**
   * Tombstones a meeting and drops its text. The deletion syncs if the
   * meeting ever had a transcript, which is when it could have synced.
   */
  remove: (id: string): void => {
    db.transactionSync((tx: DatabaseTransaction) => {
      const row = tx.executeSync(
        'SELECT user_id, transcript_json FROM recorded_meetings WHERE id = ? AND deleted_at IS NULL',
        [id],
      ).rows?.[0];
      if (!row) return;
      const now = new Date().toISOString();
      tx.executeSync(
        `UPDATE recorded_meetings
            SET deleted_at = ?, updated_at = ?, transcript_json = NULL, notes_json = NULL,
                section_cache_json = NULL
          WHERE id = ?`,
        [now, now, id],
      );
      if (row.transcript_json != null) {
        const userId = String(row.user_id);
        syncOutboxStore.enqueueMutation(userId, 'recorded_meeting', id, 'delete', {}, 'account', userId, tx);
      }
    });
  },

  /** Meetings left mid-way by a closed or crashed app. */
  findInterrupted: (userId: string): RecordedMeeting[] =>
    recordedMeetingStore
      .list(userId)
      .filter((meeting) => ['recording', 'paused', 'importing', 'transcribing', 'generating_notes'].includes(meeting.status)),
};
