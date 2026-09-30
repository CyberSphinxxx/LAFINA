import { extractActionCandidates } from '../../src/ai/meeting/actionCandidateExtractor';
import { MeetingSegment } from '../../src/ai/native/meetingRecorder';

describe('actionCandidateExtractor - Spoken Action Detection', () => {
  const roster = [
    { id: 'user_1', name: 'Alice Guo', email: 'alice@ustp.edu.ph' },
    { id: 'user_2', name: 'Bob Vance', email: 'bob@ustp.edu.ph' },
  ];

  it('detects whole-word triggers Set, Create, Schedule and extracts candidate', () => {
    const segments: MeetingSegment[] = [
      {
        id: 's1',
        start_ms: 0,
        end_ms: 3000,
        text: 'Welcome everyone to the morning standup.',
      },
      {
        id: 's2',
        start_ms: 3500,
        end_ms: 7000,
        text: 'Let us schedule the database migration for Alice tomorrow.',
      },
      {
        id: 's3',
        start_ms: 7500,
        end_ms: 10000,
        text: 'Also create a calibration report by Friday.',
      },
    ];

    const candidates = extractActionCandidates('meet_1', segments, roster);

    expect(candidates.length).toBe(2);

    // First candidate
    expect(candidates[0].instructions).toBe(
      'Let us schedule the database migration for Alice tomorrow.'
    );
    expect(candidates[0].suggested_assignee_id).toBe('user_1');
    expect(candidates[0].suggested_assignee_name).toBe('Alice Guo');
    expect(candidates[0].suggested_due_date).not.toBeNull();
    expect(candidates[0].status).toBe('pending_review');

    // Second candidate
    expect(candidates[1].instructions).toBe('Also create a calibration report by Friday.');
    expect(candidates[1].suggested_assignee_id).toBeNull();
    expect(candidates[1].suggested_due_date).not.toBeNull();
  });

  it('does not trigger on sentences without action commands', () => {
    const segments: MeetingSegment[] = [
      {
        id: 's1',
        start_ms: 0,
        end_ms: 2000,
        text: 'The weather in Cagayan de Oro is sunny today.',
      },
      {
        id: 's2',
        start_ms: 2500,
        end_ms: 4500,
        text: 'Thank you all for attending.',
      },
    ];

    const candidates = extractActionCandidates('meet_2', segments, roster);
    expect(candidates.length).toBe(0);
  });
});
