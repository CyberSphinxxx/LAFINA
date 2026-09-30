import {
  applyNluScheduleResult,
  createFallbackNluResult,
  parseNluJson,
  processCommand,
  normalizeTranscript,
  resolveRelativeTime,
} from '../../src/ai';
import type { NluResult } from '../../src/ai';
import { db, initDatabase, tasksStore, timeBlocksStore } from '../../src/storage';

const insertUser = (userId: string): void => {
  const now = new Date().toISOString();
  db.executeSync(
    `INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [userId, userId, now, now]
  );
};

// Fixed anchor date for deterministic clock mocking: Monday, July 6th, 2026 at 12:00 PM local
const MOCK_MONDAY_NOON = new Date(2026, 6, 6, 12, 0, 0); // Month is 0-indexed (6 = July)

describe('offline NLU scheduling', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  afterEach(() => {
    db.executeSync('DELETE FROM time_blocks');
    db.executeSync('DELETE FROM tasks');
    db.executeSync('DELETE FROM notes');
    db.executeSync('DELETE FROM users');
  });

  it('parses valid SmolLM2 JSON wrapped in assistant text', () => {
    const parsed = parseNluJson(`
      Sure:
      {
        "intent": "schedule",
        "task": "Study calculus",
        "date": "2026-07-06",
        "time": "09:30",
        "duration_minutes": 90,
        "status": "success",
        "reply": "I blocked calculus study."
      }
    `);

    expect(parsed).toEqual({
      intent: 'schedule',
      task: 'Study calculus',
      date: '2026-07-06',
      time: '09:30',
      duration_minutes: 90,
      status: 'success',
      reply: 'I blocked calculus study.',
    });
  });

  it('rejects invalid NLU time values', () => {
    expect(() =>
      parseNluJson(
        '{"intent":"schedule","task":"Study","date":"2026-07-06","time":"9 PM","duration_minutes":60,"status":"success","reply":"Done"}'
      )
    ).toThrow('Invalid NLU field "time"');
  });

  it('creates a time block when duration_minutes is present', () => {
    const userId = 'voice_user';
    insertUser(userId);

    const nluResult: NluResult = {
      intent: 'schedule',
      task: 'Deep work',
      date: '2026-07-06',
      time: '14:00',
      duration_minutes: 120,
      status: 'success',
      reply: 'I blocked deep work.',
    };

    const result = applyNluScheduleResult(nluResult, userId);
    const blocks = timeBlocksStore.getAll(userId);

    expect(result.didUpdate).toBe(true);
    expect(result.createdItemType).toBe('time_block');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('Deep work');
    expect(blocks[0].startTime).toBe('14:00');
    expect(blocks[0].endTime).toBe('16:00');
  });

  it('parses explicit calendar date "schedule a meeting 9pm on July 8th"', () => {
    const result = createFallbackNluResult('schedule a meeting 9pm on July 8th', MOCK_MONDAY_NOON);

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'meeting',
      date: '2026-07-08',
      time: '21:00',
      duration_minutes: null,
      status: 'success',
    });
  });

  it('parses US MM/DD date "schedule a meeting at 3pm on 7/8"', () => {
    const result = createFallbackNluResult('schedule a meeting at 3pm on 7/8', MOCK_MONDAY_NOON);

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'meeting',
      date: '2026-07-08',
      time: '15:00',
    });
  });

  it('preserves meeting as part of a deterministic schedule title', () => {
    const result = createFallbackNluResult(
      'Set a schedule for meeting with Yohan at 3:30pm',
      MOCK_MONDAY_NOON
    );

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'meeting with Yohan',
      time: '15:30',
    });
  });

  it('parses "next Monday" semantics skipping to following week', () => {
    const result = createFallbackNluResult('schedule a meeting 9pm next Monday', MOCK_MONDAY_NOON);

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'meeting',
      date: '2026-07-13',
      time: '21:00',
    });
  });

  it('parses "on Monday" today for an upcoming evening hour', () => {
    const result = createFallbackNluResult('schedule a meeting 9pm on Monday', MOCK_MONDAY_NOON);

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'meeting',
      date: '2026-07-06',
      time: '21:00',
    });
  });

  it('rolls over passed time today (9am on Monday when today is Monday noon) to next week', () => {
    const result = createFallbackNluResult('schedule a meeting 9am on Monday', MOCK_MONDAY_NOON);

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'meeting',
      date: '2026-07-13',
      time: '09:00',
    });
  });

  it('parses recurrence start date for "remind me calculus every Monday at 9am"', () => {
    const result = createFallbackNluResult('remind me calculus every Monday at 9am', MOCK_MONDAY_NOON);

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'calculus',
      date: '2026-07-06',
      time: '09:00',
    });
  });

  it('handles recurrence + explicit start date "every Monday starting July 20th at 9am"', () => {
    const result = createFallbackNluResult('every Monday starting July 20th at 9am', MOCK_MONDAY_NOON);

    expect(result).toMatchObject({
      intent: 'schedule',
      date: '2026-07-20',
      time: '09:00',
    });
  });

  it('handles stacked title cleaning when date phrase appears BEFORE title', () => {
    const result = createFallbackNluResult('on July 8th schedule a meeting at 9pm', MOCK_MONDAY_NOON);

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'meeting',
      date: '2026-07-08',
      time: '21:00',
    });
  });

  it('handles stacked title cleaning for conversational filler words', () => {
    const result = createFallbackNluResult(
      'Um, so I need to call the dentist about that thing at 3pm on July 8th',
      MOCK_MONDAY_NOON
    );

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'call dentist about that thing',
      date: '2026-07-08',
      time: '15:00',
    });
  });

  it('rolls over past bare month/day dates (March 15th when today is July 6th) to next year', () => {
    const result = createFallbackNluResult('schedule a meeting on March 15th at 2pm', MOCK_MONDAY_NOON);

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'meeting',
      date: '2027-03-15',
      time: '14:00',
    });
  });

  it('defaults to today when no date expression is mentioned at all', () => {
    const result = createFallbackNluResult('add task buy milk', MOCK_MONDAY_NOON);

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'buy milk',
      date: '2026-07-06',
    });
  });

  it('extracts a named event title instead of leaving the time preposition', () => {
    const result = createFallbackNluResult(
      'schedule an event Thesis Defense at 3pm tomorrow',
      MOCK_MONDAY_NOON
    );

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'Thesis Defense',
      date: '2026-07-07',
      time: '15:00',
    });
  });

  it('uses a safe generic title when no event name is provided', () => {
    const result = createFallbackNluResult(
      'schedule an event at 3pm tomorrow',
      MOCK_MONDAY_NOON
    );

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'Scheduled Event',
      time: '15:00',
    });
  });

  it('preserves meaningful numbers and prepositions in task names', () => {
    const result = createFallbackNluResult(
      'add task Review chapter 5 for calculus by 9pm',
      MOCK_MONDAY_NOON
    );

    expect(result).toMatchObject({
      intent: 'schedule',
      task: 'Review chapter 5 for calculus',
      time: '21:00',
    });
  });

  it('schedules a recurring weekly time block for "every monday at 10-11 am schedule a timeblock for studying"', () => {
    const userId = 'studying_user';
    insertUser(userId);

    const reply = processCommand('every monday at 10-11 am schedule a timeblock for studying', userId);
    const blocks = timeBlocksStore.getAll(userId);

    expect(reply).toContain('studying');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('studying');
    expect(blocks[0].startTime).toBe('10:00');
    expect(blocks[0].endTime).toBe('11:00');
    expect(blocks[0].recurrenceRule).toBe('FREQ=WEEKLY');
  });

  it('replies conversationally to greetings like "hey there" without modifying the schedule', () => {
    const userId = 'chat_user';
    insertUser(userId);

    const reply = processCommand('hey there', userId);
    const tasks = tasksStore.getAllTasks(userId);
    const blocks = timeBlocksStore.getAll(userId);

    expect(reply).toContain("Hey there! 👋 I'm LAFINA");
    expect(tasks).toHaveLength(0);
    expect(blocks).toHaveLength(0);
  });

  describe('relative time resolution', () => {
    it('parses "15 minutes from now" to the reference time plus 15 minutes (not the 5pm default)', () => {
      const result = createFallbackNluResult('set a schedule 15 minutes from now', MOCK_MONDAY_NOON);

      expect(result).toMatchObject({
        intent: 'schedule',
        task: 'Scheduled Event',
        date: '2026-07-06',
        time: '12:15',
        duration_minutes: null,
        status: 'success',
      });
      // Regression guard: the original bug resolved this to the 17:00 default.
      expect(result.time).not.toBe('17:00');
    });

    it('parses "in 15 minutes"', () => {
      const result = createFallbackNluResult('in 15 minutes', MOCK_MONDAY_NOON);
      expect(result).toMatchObject({ date: '2026-07-06', time: '12:15' });
    });

    it('parses "half an hour from now"', () => {
      const result = createFallbackNluResult('half an hour from now', MOCK_MONDAY_NOON);
      expect(result).toMatchObject({ date: '2026-07-06', time: '12:30' });
    });

    it('parses "in 2 hours"', () => {
      const result = createFallbackNluResult('in 2 hours', MOCK_MONDAY_NOON);
      expect(result).toMatchObject({ date: '2026-07-06', time: '14:00' });
    });

    it('parses "an hour from now"', () => {
      const result = createFallbackNluResult('an hour from now', MOCK_MONDAY_NOON);
      expect(result).toMatchObject({ date: '2026-07-06', time: '13:00' });
    });

    it('parses "2 hours later"', () => {
      const result = createFallbackNluResult('2 hours later', MOCK_MONDAY_NOON);
      expect(result).toMatchObject({ date: '2026-07-06', time: '14:00' });
    });

    it('keeps the relative phrase out of the task title', () => {
      const result = createFallbackNluResult('schedule a meeting in 15 minutes with Yohan', MOCK_MONDAY_NOON);
      expect(result).toMatchObject({
        intent: 'schedule',
        task: 'meeting with Yohan',
        time: '12:15',
      });
    });

    it('does not treat an unanchored duration ("for 2 hours") as a relative deadline', () => {
      const result = createFallbackNluResult('study for 2 hours', MOCK_MONDAY_NOON);
      expect(result.time).not.toBe('14:00');
    });

    it('rolls over midnight when the offset crosses into the next day', () => {
      const reference = new Date(2026, 6, 6, 23, 50, 0);
      expect(resolveRelativeTime('15 minutes from now', reference)).toEqual({
        date: '2026-07-07',
        time: '00:05',
      });
    });

    it('spans a full day for "in 24 hours" landing on the same wall-clock time', () => {
      const reference = new Date(2026, 6, 6, 12, 30, 0);
      expect(resolveRelativeTime('in 24 hours', reference)).toEqual({
        date: '2026-07-07',
        time: '12:30',
      });
    });

    it('preserves exact elapsed minutes across a DST transition (epoch arithmetic)', () => {
      // 2026-03-08 01:30 sits inside the US "spring forward" window. A naive
      // wall-clock "+N hours" implementation would drift; resolving via epoch
      // millis must always yield exactly the requested real elapsed time. The
      // delta assertion is timezone-agnostic (60 real minutes in every zone).
      const reference = new Date(2026, 2, 8, 1, 30, 0);
      const resolved = resolveRelativeTime('in 60 minutes', reference);
      expect(resolved).not.toBeNull();

      const [year, month, day] = resolved!.date.split('-').map(Number);
      const [hours, minutes] = resolved!.time.split(':').map(Number);
      const target = new Date(year, month - 1, day, hours, minutes, 0, 0);

      expect(target.getTime() - reference.getTime()).toBe(60 * 60 * 1000);
    });
  });

  describe('normalizeTranscript', () => {
    it('normalizes times without colons but with meridiem', () => {
      expect(normalizeTranscript('Set a schedule at 615 pm')).toBe('Set a schedule at 6:15 pm');
      expect(normalizeTranscript('at 6 15 pm')).toBe('at 6:15 pm');
      expect(normalizeTranscript('study at 1030am')).toBe('study at 10:30 am');
      expect(normalizeTranscript('meeting from 230 to 430 pm')).toBe('meeting from 2:30 to 4:30 pm');
      expect(normalizeTranscript('class at 6:15 pm')).toBe('class at 6:15 pm');
    });

    it('successfully parses fallback scheduling commands containing uncoloned times', () => {
      const result = createFallbackNluResult('schedule a meeting 615 pm on July 8th', MOCK_MONDAY_NOON);
      expect(result).toMatchObject({
        intent: 'schedule',
        task: 'meeting',
        date: '2026-07-08',
        time: '18:15',
      });
    });
  });
});
