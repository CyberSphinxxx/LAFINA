import { db, DatabaseTransaction } from './database';
import {
  LocalBusinessMeetingRow,
  LocalBusinessMeetingSegmentRow,
  LocalBusinessActionCandidateRow,
  LocalBusinessMeetingRecipientRow,
} from './syncTypes';
import { generateId } from '../utils';

/**
 * Saves or updates a local business meeting record, including its segments,
 * action candidates, and selective recipients.
 */
export const saveMeeting = (
  meeting: LocalBusinessMeetingRow,
  segments: LocalBusinessMeetingSegmentRow[] = [],
  candidates: LocalBusinessActionCandidateRow[] = [],
  recipientUserIds: string[] = []
): void => {
  db.transactionSync((tx: DatabaseTransaction) => {
    // 1. Upsert meeting record
    tx.executeSync(
      `INSERT INTO business_meetings (
        id, business_id, created_by, title, duration_seconds,
        full_transcript, summary_json, summary_status, keep_audio,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        duration_seconds = excluded.duration_seconds,
        full_transcript = excluded.full_transcript,
        summary_json = excluded.summary_json,
        summary_status = excluded.summary_status,
        keep_audio = excluded.keep_audio,
        updated_at = excluded.updated_at;`,
      [
        meeting.id,
        meeting.business_id,
        meeting.created_by,
        meeting.title,
        meeting.duration_seconds,
        meeting.full_transcript,
        meeting.summary_json,
        meeting.summary_status,
        meeting.keep_audio,
        meeting.created_at,
        meeting.updated_at,
      ]
    );

    // 2. Insert segments if provided
    if (segments.length > 0) {
      for (const seg of segments) {
        tx.executeSync(
          `INSERT INTO business_meeting_segments (
            id, meeting_id, start_ms, end_ms, text, speaker, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            start_ms = excluded.start_ms,
            end_ms = excluded.end_ms,
            text = excluded.text,
            speaker = excluded.speaker;`,
          [
            seg.id || generateId('seg'),
            meeting.id,
            seg.start_ms,
            seg.end_ms,
            seg.text,
            seg.speaker || null,
            seg.created_at || meeting.created_at,
          ]
        );
      }
    }

    // 3. Insert action candidates if provided
    if (candidates.length > 0) {
      for (const cand of candidates) {
        tx.executeSync(
          `INSERT INTO business_action_candidates (
            id, meeting_id, title, instructions,
            suggested_assignee_id, suggested_assignee_name,
            suggested_due_date, status, created_task_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            instructions = excluded.instructions,
            suggested_assignee_id = excluded.suggested_assignee_id,
            suggested_assignee_name = excluded.suggested_assignee_name,
            suggested_due_date = excluded.suggested_due_date,
            status = excluded.status,
            created_task_id = excluded.created_task_id;`,
          [
            cand.id || generateId('cand'),
            meeting.id,
            cand.title,
            cand.instructions,
            cand.suggested_assignee_id || null,
            cand.suggested_assignee_name || null,
            cand.suggested_due_date || null,
            cand.status || 'pending_review',
            cand.created_task_id || null,
            cand.created_at || meeting.created_at,
          ]
        );
      }
    }

    // 4. Update selective sharing recipients if provided
    if (recipientUserIds.length > 0) {
      tx.executeSync(`DELETE FROM business_meeting_recipients WHERE meeting_id = ?;`, [meeting.id]);
      for (const uid of Array.from(new Set(recipientUserIds))) {
        tx.executeSync(
          `INSERT INTO business_meeting_recipients (
            id, meeting_id, business_id, user_id, created_at
          ) VALUES (?, ?, ?, ?, ?);`,
          [generateId('bmr'), meeting.id, meeting.business_id, uid, meeting.created_at]
        );
      }
    }
  });
};

/**
 * Lists all meetings saved for a given business workspace.
 */
export const getMeetingsForBusiness = (businessId: string): LocalBusinessMeetingRow[] => {
  const result = db.executeSync(
    `SELECT * FROM business_meetings WHERE business_id = ? ORDER BY created_at DESC;`,
    [businessId]
  );
  return (result.rows || []) as LocalBusinessMeetingRow[];
};

/**
 * Gets a single meeting by its ID.
 */
export const getMeetingById = (meetingId: string): LocalBusinessMeetingRow | null => {
  const result = db.executeSync(`SELECT * FROM business_meetings WHERE id = ? LIMIT 1;`, [meetingId]);
  const rows = result.rows || [];
  if (rows.length === 0) return null;
  return rows[0] as LocalBusinessMeetingRow;
};

/**
 * Gets all segments for a meeting ordered chronologically.
 */
export const getMeetingSegments = (meetingId: string): LocalBusinessMeetingSegmentRow[] => {
  const result = db.executeSync(
    `SELECT * FROM business_meeting_segments WHERE meeting_id = ? ORDER BY start_ms ASC;`,
    [meetingId]
  );
  return (result.rows || []) as LocalBusinessMeetingSegmentRow[];
};

/**
 * Gets action candidates extracted from a meeting.
 */
export const getActionCandidates = (meetingId: string): LocalBusinessActionCandidateRow[] => {
  const result = db.executeSync(
    `SELECT * FROM business_action_candidates WHERE meeting_id = ? ORDER BY created_at ASC;`,
    [meetingId]
  );
  return (result.rows || []) as LocalBusinessActionCandidateRow[];
};

/**
 * Updates an action candidate's status or created task linkage.
 */
export const updateActionCandidate = (
  candidateId: string,
  updates: Partial<LocalBusinessActionCandidateRow>
): void => {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { sets.push('title = ?'); values.push(updates.title); }
  if (updates.instructions !== undefined) { sets.push('instructions = ?'); values.push(updates.instructions); }
  if (updates.suggested_assignee_id !== undefined) { sets.push('suggested_assignee_id = ?'); values.push(updates.suggested_assignee_id); }
  if (updates.suggested_assignee_name !== undefined) { sets.push('suggested_assignee_name = ?'); values.push(updates.suggested_assignee_name); }
  if (updates.suggested_due_date !== undefined) { sets.push('suggested_due_date = ?'); values.push(updates.suggested_due_date); }
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.created_task_id !== undefined) { sets.push('created_task_id = ?'); values.push(updates.created_task_id); }

  if (sets.length === 0) return;
  values.push(candidateId);

  db.executeSync(`UPDATE business_action_candidates SET ${sets.join(', ')} WHERE id = ?;`, values);
};

/**
 * Gets designated recipients for a meeting.
 */
export const getMeetingRecipients = (meetingId: string): LocalBusinessMeetingRecipientRow[] => {
  const result = db.executeSync(
    `SELECT * FROM business_meeting_recipients WHERE meeting_id = ?;`,
    [meetingId]
  );
  return (result.rows || []) as LocalBusinessMeetingRecipientRow[];
};

/**
 * Deletes local meeting data (purges local copy when revoked or deleted).
 */
export const deleteMeetingLocal = (meetingId: string): void => {
  db.transactionSync((tx: DatabaseTransaction) => {
    tx.executeSync(`DELETE FROM business_meeting_recipients WHERE meeting_id = ?;`, [meetingId]);
    tx.executeSync(`DELETE FROM business_action_candidates WHERE meeting_id = ?;`, [meetingId]);
    tx.executeSync(`DELETE FROM business_meeting_segments WHERE meeting_id = ?;`, [meetingId]);
    tx.executeSync(`DELETE FROM business_meetings WHERE id = ?;`, [meetingId]);
  });
};

/**
 * Updates meeting summary JSON and status in local storage.
 */
export const updateMeetingSummary = (
  meetingId: string,
  summaryJson: string,
  status: 'summary_pending' | 'completed' | 'failed'
): void => {
  const now = new Date().toISOString();
  db.executeSync(
    `UPDATE business_meetings SET summary_json = ?, summary_status = ?, updated_at = ? WHERE id = ?;`,
    [summaryJson, status, now, meetingId]
  );
};

export const meetingStore = {
  saveMeeting,
  getMeetingsForBusiness,
  getMeetingById,
  getMeetingSegments,
  getActionCandidates,
  updateActionCandidate,
  getMeetingRecipients,
  deleteMeetingLocal,
  updateMeetingSummary,
};
