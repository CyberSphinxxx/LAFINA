/**
 * Boundary and rejection tests for `src/ai/nlu/jsonParser.ts`.
 *
 * The parser is the gate between a small quantised model's raw text and the
 * scheduling pipeline, so every malformed field must be rejected with a clear
 * error instead of leaking a half-valid NLU result downstream.
 */
import { parseNluJson } from '../../src/ai/nlu/jsonParser';

const basePayload = {
  intent: 'schedule',
  task: 'Study',
  date: '2026-07-20',
  time: '14:30',
  duration_minutes: 60,
  status: 'success',
  reply: 'Scheduled.',
};

const raw = (payload: unknown): string => JSON.stringify(payload);

describe('parseNluJson', () => {
  it('parses a well-formed NLU payload', () => {
    expect(parseNluJson(raw(basePayload))).toEqual(basePayload);
  });

  it('extracts the JSON object out of surrounding assistant chatter', () => {
    const output = `Sure, here is the result:\n${raw(basePayload)}\nHope that helps!`;

    expect(parseNluJson(output)).toEqual(basePayload);
  });

  it('normalises blank strings, nulls and fractional durations', () => {
    const result = parseNluJson(
      raw({
        ...basePayload,
        task: '  Review notes  ',
        date: null,
        time: null,
        duration_minutes: 45.6,
        reply: '   ',
      })
    );

    expect(result.task).toBe('Review notes');
    expect(result.date).toBeNull();
    expect(result.time).toBeNull();
    expect(result.duration_minutes).toBe(46);
    expect(result.reply).toBe('');
  });

  it('treats an empty task string as an absent task', () => {
    expect(parseNluJson(raw({ ...basePayload, task: '   ' })).task).toBeNull();
  });

  it('accepts a date-only ISO string without a time component', () => {
    expect(parseNluJson(raw({ ...basePayload, date: '2026-07-20' })).date).toBe('2026-07-20');
  });

  it('rejects an unknown intent', () => {
    expect(() => parseNluJson(raw({ ...basePayload, intent: 'reschedule' }))).toThrow(
      'Invalid NLU field "intent".'
    );
  });

  it('rejects a non-string intent', () => {
    expect(() => parseNluJson(raw({ ...basePayload, intent: 7 }))).toThrow(
      'Invalid NLU field "intent".'
    );
  });

  it('rejects an unknown status', () => {
    expect(() => parseNluJson(raw({ ...basePayload, status: 'maybe' }))).toThrow(
      'Invalid NLU field "status".'
    );
  });

  it('rejects non-string text fields and names the offending field', () => {
    expect(() => parseNluJson(raw({ ...basePayload, task: 42 }))).toThrow(
      'Invalid NLU field "task". Expected string or null.'
    );
    expect(() => parseNluJson(raw({ ...basePayload, reply: { text: 'hi' } }))).toThrow(
      'Invalid NLU field "reply". Expected string or null.'
    );
  });

  it('rejects missing duration values other than null', () => {
    expect(() => parseNluJson(raw({ ...basePayload, duration_minutes: 0 }))).toThrow(
      'Invalid NLU field "duration_minutes". Expected positive number or null.'
    );
    expect(() => parseNluJson(raw({ ...basePayload, duration_minutes: '60' }))).toThrow(
      'Invalid NLU field "duration_minutes". Expected positive number or null.'
    );
  });

  it('rejects an unparseable date', () => {
    expect(() => parseNluJson(raw({ ...basePayload, date: 'next Tuesday' }))).toThrow(
      'Invalid NLU field "date". Expected ISO 8601 date string or null.'
    );
  });

  it('rejects a time that is not HH:MM in 24-hour format', () => {
    expect(() => parseNluJson(raw({ ...basePayload, time: '9:30' }))).toThrow(
      'Invalid NLU field "time". Expected HH:MM 24-hour format or null.'
    );
    expect(() => parseNluJson(raw({ ...basePayload, time: '25:00' }))).toThrow(
      'Invalid NLU field "time". Expected HH:MM 24-hour format or null.'
    );
  });

  it('rejects output that contains no JSON object at all', () => {
    expect(() => parseNluJson('I could not understand that.')).toThrow(
      'Invalid NLU JSON: The NLU model did not return a JSON object.'
    );
  });

  it('rejects malformed JSON inside braces', () => {
    expect(() => parseNluJson('{ intent: schedule }')).toThrow('Invalid NLU JSON:');
  });
});
