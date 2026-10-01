/**
 * Regression tests for stored-timestamp display.
 *
 * A partially written or interrupted-sync row can hold an empty or malformed
 * timestamp. Rendering those literally printed "Invalid Date" inside note cards,
 * calendar headers, and import lists.
 */
import { formatStoredDate } from '../../src/utils/dateFormat';

const SHORT_DATE = { month: 'short', day: 'numeric' } as const;

describe('formatStoredDate', () => {
  it('formats a valid ISO timestamp', () => {
    expect(formatStoredDate('2026-07-24T10:05:00.000Z', SHORT_DATE)).toBe(
      new Date('2026-07-24T10:05:00.000Z').toLocaleDateString(
        'en-US',
        SHORT_DATE,
      ),
    );
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['garbage', 'not-a-date'],
    ['partial timestamp', '2026-13-45T99:99:99.000Z'],
    ['undefined', undefined],
    ['null', null],
  ])('falls back to a readable label for %s', (_label, value) => {
    expect(formatStoredDate(value, SHORT_DATE)).toBe('No Date');
  });

  it('never renders the literal "Invalid Date"', () => {
    ['', 'x', '2026-99-99'].forEach(value => {
      expect(formatStoredDate(value, SHORT_DATE)).not.toContain('Invalid');
    });
  });

  it('accepts a caller supplied fallback label', () => {
    expect(formatStoredDate('', SHORT_DATE, 'Unscheduled')).toBe('Unscheduled');
  });

  it('keeps time components for import batch labels', () => {
    const label = formatStoredDate('2026-07-24T10:05:00.000Z', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(label).not.toBe('No Date');
    expect(label.length).toBeGreaterThan(0);
  });
});
