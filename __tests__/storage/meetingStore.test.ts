import { initDatabase, meetingStore, seedLocalDemoAccounts, DEMO_IDS } from '../../src/storage';
import {
  LocalBusinessMeetingRow,
  LocalBusinessMeetingSegmentRow,
  LocalBusinessActionCandidateRow,
} from '../../src/storage/syncTypes';

describe('meetingStore - SQLite Local Meeting Storage', () => {
  beforeEach(async () => {
    await initDatabase();
    await seedLocalDemoAccounts();
  });

  it('saves and retrieves a meeting with segments and action candidates', () => {
    const meetingId = 'meet_test_1';
    const bizId = DEMO_IDS.BIZ_ID;
    const userId = DEMO_IDS.MANAGER_ID;
    const now = new Date().toISOString();

    const meetingRow: LocalBusinessMeetingRow = {
      id: meetingId,
      business_id: bizId,
      created_by: userId,
      title: 'Sprint Planning',
      duration_seconds: 1800,
      full_transcript: 'Let us schedule firmware testing by Friday.',
      summary_json: null,
      summary_status: 'not_requested',
      keep_audio: 0,
      created_at: now,
      updated_at: now,
    };

    const segments: LocalBusinessMeetingSegmentRow[] = [
      {
        id: 'seg_1',
        meeting_id: meetingId,
        start_ms: 0,
        end_ms: 5000,
        text: 'Let us schedule firmware testing',
        speaker: 'Dr. Vance',
        created_at: now,
      },
      {
        id: 'seg_2',
        meeting_id: meetingId,
        start_ms: 5000,
        end_ms: 9000,
        text: 'by Friday.',
        speaker: 'Dr. Vance',
        created_at: now,
      },
    ];

    const candidates: LocalBusinessActionCandidateRow[] = [
      {
        id: 'cand_1',
        meeting_id: meetingId,
        title: 'Schedule firmware testing',
        instructions: 'Let us schedule firmware testing by Friday.',
        suggested_assignee_id: DEMO_IDS.ALICE_ID,
        suggested_assignee_name: 'Alice',
        suggested_due_date: '2026-08-28T17:00:00.000Z',
        status: 'pending_review',
        created_task_id: null,
        created_at: now,
      },
    ];

    meetingStore.saveMeeting(meetingRow, segments, candidates, [DEMO_IDS.ALICE_ID]);

    // Retrieve meeting
    const retrieved = meetingStore.getMeetingById(meetingId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe('Sprint Planning');
    expect(retrieved?.duration_seconds).toBe(1800);

    // Retrieve segments
    const retrievedSegments = meetingStore.getMeetingSegments(meetingId);
    expect(retrievedSegments.length).toBe(2);
    expect(retrievedSegments[0].text).toBe('Let us schedule firmware testing');
    expect(retrievedSegments[1].start_ms).toBe(5000);

    // Retrieve candidates
    const retrievedCandidates = meetingStore.getActionCandidates(meetingId);
    expect(retrievedCandidates.length).toBe(1);
    expect(retrievedCandidates[0].title).toBe('Schedule firmware testing');
    expect(retrievedCandidates[0].status).toBe('pending_review');

    // Update candidate status and link task
    meetingStore.updateActionCandidate('cand_1', {
      status: 'confirmed',
      created_task_id: 'btask_123',
    });
    const updatedCandidates = meetingStore.getActionCandidates(meetingId);
    expect(updatedCandidates[0].status).toBe('confirmed');
    expect(updatedCandidates[0].created_task_id).toBe('btask_123');

    // Retrieve recipients
    const recipients = meetingStore.getMeetingRecipients(meetingId);
    expect(recipients.length).toBe(1);
    expect(recipients[0].user_id).toBe(DEMO_IDS.ALICE_ID);

    // Update summary
    const summaryJson = JSON.stringify({ key_points: ['Discussed testing'] });
    meetingStore.updateMeetingSummary(meetingId, summaryJson, 'completed');
    const updatedMeeting = meetingStore.getMeetingById(meetingId);
    expect(updatedMeeting?.summary_status).toBe('completed');
    expect(updatedMeeting?.summary_json).toBe(summaryJson);

    // Delete local meeting data
    meetingStore.deleteMeetingLocal(meetingId);
    expect(meetingStore.getMeetingById(meetingId)).toBeNull();
    expect(meetingStore.getMeetingSegments(meetingId).length).toBe(0);
    expect(meetingStore.getActionCandidates(meetingId).length).toBe(0);
    expect(meetingStore.getMeetingRecipients(meetingId).length).toBe(0);
  });
});
