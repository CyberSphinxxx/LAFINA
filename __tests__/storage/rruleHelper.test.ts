import { parseRrule, getOccurrences } from '../../src/storage/rruleHelper';

describe('rruleHelper', () => {
  describe('parseRrule', () => {
    it('should parse basic daily rule', () => {
      const parsed = parseRrule('FREQ=DAILY;INTERVAL=2;COUNT=5');
      expect(parsed).toEqual({
        freq: 'DAILY',
        interval: 2,
        count: 5,
      });
    });

    it('should parse weekly rule with byday and until', () => {
      const parsed = parseRrule('FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260815T000000Z');
      expect(parsed).toEqual({
        freq: 'WEEKLY',
        interval: 1,
        byday: ['MO', 'WE', 'FR'],
        until: '2026-08-15',
      });
    });

    it('should return null for invalid rule', () => {
      expect(parseRrule(null)).toBeNull();
      expect(parseRrule('')).toBeNull();
      expect(parseRrule('INVALID_RULE')).toBeNull();
    });
  });

  describe('getOccurrences', () => {
    const rangeStart = new Date(2026, 5, 1); // June 1, 2026
    const rangeEnd = new Date(2026, 5, 30);  // June 30, 2026

    it('should return start date only if no rule is provided', () => {
      const dates = getOccurrences('2026-06-15', null, rangeStart, rangeEnd);
      expect(dates).toEqual(['2026-06-15']);
    });

    it('should return empty list if start date is out of range and no rule is provided', () => {
      const dates = getOccurrences('2026-07-01', null, rangeStart, rangeEnd);
      expect(dates).toEqual([]);
    });

    it('should expand daily recurrence with interval 2', () => {
      const dates = getOccurrences(
        '2026-06-10',
        'FREQ=DAILY;INTERVAL=2',
        rangeStart,
        rangeEnd
      );
      expect(dates).toEqual([
        '2026-06-10',
        '2026-06-12',
        '2026-06-14',
        '2026-06-16',
        '2026-06-18',
        '2026-06-20',
        '2026-06-22',
        '2026-06-24',
        '2026-06-26',
        '2026-06-28',
        '2026-06-30',
      ]);
    });

    it('should respect UNTIL constraint', () => {
      const dates = getOccurrences(
        '2026-06-10',
        'FREQ=DAILY;INTERVAL=2;UNTIL=20260620T000000Z',
        rangeStart,
        rangeEnd
      );
      expect(dates).toEqual([
        '2026-06-10',
        '2026-06-12',
        '2026-06-14',
        '2026-06-16',
        '2026-06-18',
        '2026-06-20',
      ]);
    });

    it('should respect COUNT constraint', () => {
      const dates = getOccurrences(
        '2026-06-10',
        'FREQ=DAILY;INTERVAL=2;COUNT=4',
        rangeStart,
        rangeEnd
      );
      expect(dates).toEqual([
        '2026-06-10',
        '2026-06-12',
        '2026-06-14',
        '2026-06-16',
      ]);
    });

    it('should expand weekly recurrence on specific days', () => {
      // 2026-06-10 is a Wednesday.
      // We want to repeat Mon/Wed/Fri (MO, WE, FR)
      // Mon = June 8, Wed = June 10, Fri = June 12, Mon = June 15, etc.
      const dates = getOccurrences(
        '2026-06-10',
        'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        rangeStart,
        rangeEnd
      );
      
      // Wednesday is the start date. Standard behaviour starting on D_start:
      // Mon (June 8) is skipped because it's before D_start (June 10).
      expect(dates).toEqual([
        '2026-06-10', // Wed
        '2026-06-12', // Fri
        '2026-06-15', // Mon
        '2026-06-17', // Wed
        '2026-06-19', // Fri
        '2026-06-22', // Mon
        '2026-06-24', // Wed
        '2026-06-26', // Fri
        '2026-06-29', // Mon
      ]);
    });

    it('should expand monthly recurrence', () => {
      const start = new Date(2026, 0, 1); // Jan 1, 2026
      const end = new Date(2026, 5, 1);   // June 1, 2026
      const dates = getOccurrences(
        '2026-01-15',
        'FREQ=MONTHLY;INTERVAL=2',
        start,
        end
      );
      expect(dates).toEqual([
        '2026-01-15',
        '2026-03-15',
        '2026-05-15',
      ]);
    });

    it('should expand yearly recurrence', () => {
      const start = new Date(2026, 0, 1);
      const end = new Date(2030, 0, 1);
      const dates = getOccurrences(
        '2026-06-15',
        'FREQ=YEARLY;INTERVAL=1',
        start,
        end
      );
      expect(dates).toEqual([
        '2026-06-15',
        '2027-06-15',
        '2028-06-15',
        '2029-06-15',
      ]);
    });

    it('still expands a long-running daily series viewed years later', () => {
      const start = new Date(2026, 8, 1); // September 2026
      const end = new Date(2026, 8, 8);
      const dates = getOccurrences(
        '2019-01-07',
        'FREQ=DAILY;INTERVAL=1',
        start,
        end
      );

      // Without fast-forwarding into the window the safety budget is exhausted
      // by history and a valid month silently renders empty.
      expect(dates).toEqual([
        '2026-09-01',
        '2026-09-02',
        '2026-09-03',
        '2026-09-04',
        '2026-09-05',
        '2026-09-06',
        '2026-09-07',
        '2026-09-08',
      ]);
    });

    it('keeps COUNT relative to the series start when fast-forwarding', () => {
      const start = new Date(2026, 8, 1);
      const end = new Date(2026, 8, 30);
      // A 30-occurrence series that started in 2019 is already exhausted.
      const dates = getOccurrences(
        '2019-01-01',
        'FREQ=DAILY;COUNT=30',
        start,
        end
      );

      expect(dates).toEqual([]);
    });
  });

  describe('malformed numeric parts', () => {
    it('treats an unparseable COUNT as unbounded instead of zero occurrences', () => {
      const parsed = parseRrule('FREQ=DAILY;COUNT=abc');
      expect(parsed?.count).toBeUndefined();

      const dates = getOccurrences(
        '2026-06-15',
        'FREQ=DAILY;COUNT=abc',
        new Date(2026, 5, 15),
        new Date(2026, 5, 17)
      );
      expect(dates).toEqual(['2026-06-15', '2026-06-16', '2026-06-17']);
    });

    it('falls back to an interval of 1 when INTERVAL is not a positive integer', () => {
      expect(parseRrule('FREQ=DAILY;INTERVAL=0')?.interval).toBe(1);
      expect(parseRrule('FREQ=DAILY;INTERVAL=-2')?.interval).toBe(1);
      expect(parseRrule('FREQ=DAILY;INTERVAL=1.5')?.interval).toBe(1);
      expect(parseRrule('FREQ=DAILY;INTERVAL=abc')?.interval).toBe(1);
      expect(parseRrule('FREQ=DAILY;INTERVAL=3')?.interval).toBe(3);
    });

    it('ignores an unsupported FREQ value without using an unsafe cast', () => {
      expect(parseRrule('FREQ=SECONDLY')).toBeNull();
      expect(parseRrule('FREQ=HOURLY')).toBeNull();
    });
  });
});
