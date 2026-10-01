/**
 * Custom RRULE Helper
 * Implements a lightweight RFC 5545 compliant parser and occurrence expander.
 * Zero external dependencies.
 */

export interface ParsedRrule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byday?: string[]; // e.g. ['MO', 'WE', 'FR']
  until?: string;   // YYYY-MM-DD
  count?: number;   // Max occurrences
}

const VALID_FREQUENCIES: readonly ParsedRrule['freq'][] = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
];

/**
 * Parses a strictly positive base-10 integer, rejecting junk, signs, and decimals.
 *
 * @param value Raw RRULE part value.
 * @returns The parsed integer, or null when the value is not a positive integer.
 */
const parsePositiveInt = (value: string): number | null => {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

/**
 * Parses an iCalendar RRULE string into a ParsedRrule object.
 * Returns null if the rule is invalid or empty.
 *
 * Numeric parts are validated rather than coerced: `parseInt` would turn
 * `INTERVAL=abc` into NaN and `COUNT=abc` into NaN, which silently expanded a
 * rule to zero occurrences instead of falling back to sensible defaults.
 */
export const parseRrule = (ruleStr: string | null | undefined): ParsedRrule | null => {
  if (!ruleStr) return null;

  try {
    const parts = ruleStr.replace(/^RRULE:/i, '').split(';');
    let freq: ParsedRrule['freq'] | undefined;
    let interval: number | null = null;
    let byday: string[] | undefined;
    let until: string | undefined;
    let count: number | null = null;

    parts.forEach((part) => {
      const [key, val] = part.split('=');
      if (!key || !val) return;

      const upperKey = key.toUpperCase();
      const upperVal = val.toUpperCase();

      switch (upperKey) {
        case 'FREQ':
          freq = VALID_FREQUENCIES.find(candidate => candidate === upperVal);
          break;
        case 'INTERVAL':
          interval = parsePositiveInt(upperVal);
          break;
        case 'BYDAY':
          byday = upperVal.split(',').map(code => code.trim());
          break;
        case 'UNTIL': {
          // Extract date part (handles YYYYMMDD and YYYYMMDDThhmmssZ)
          const datePart = upperVal.split('T')[0];
          if (/^\d{8}$/.test(datePart)) {
            const year = datePart.substring(0, 4);
            const month = datePart.substring(4, 6);
            const day = datePart.substring(6, 8);
            until = `${year}-${month}-${day}`;
          }
          break;
        }
        case 'COUNT':
          count = parsePositiveInt(upperVal);
          break;
      }
    });

    if (!freq) return null;

    const parsedRule: ParsedRrule = {
      freq,
      interval: interval !== null && interval > 0 ? interval : 1,
    };
    if (byday) parsedRule.byday = byday;
    if (until) parsedRule.until = until;
    // An unparseable COUNT is treated as unbounded rather than as zero occurrences.
    if (count !== null) parsedRule.count = count;

    return parsedRule;
  } catch (error) {
    console.error('Error parsing RRULE:', ruleStr, error);
    return null;
  }
};

/**
 * Helper to safely parse a YYYY-MM-DD string into a local Date object at midnight.
 */
const parseLocalDate = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

/**
 * Helper to format a local Date object into a YYYY-MM-DD string.
 */
const formatLocalDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Helper to get the Sunday of the week at midnight.
 */
const getSunday = (d: Date): Date => {
  const res = new Date(d);
  const day = res.getDay();
  res.setDate(res.getDate() - day);
  res.setHours(0, 0, 0, 0);
  return res;
};

// Map day codes to JS getDay() values: 0=Sunday, 1=Monday, etc.
const DAY_CODES: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6
};

/**
 * Expands a recurring event starting on `startDateStr` into a list of YYYY-MM-DD dates
 * that fall within the range `rangeStart` to `rangeEnd`.
 */
export const getOccurrences = (
  startDateStr: string,
  recurrenceRule: string | null | undefined,
  rangeStart: Date,
  rangeEnd: Date
): string[] => {
  if (!startDateStr) return [];
  
  const rule = parseRrule(recurrenceRule);
  if (!rule) {
    // If no recurrence, only return the start date if it falls inside the range
    const startDt = parseLocalDate(startDateStr);
    if (startDt >= rangeStart && startDt <= rangeEnd) {
      return [startDateStr];
    }
    return [];
  }

  const occurrences: string[] = [];
  const startDt = parseLocalDate(startDateStr);
  const untilDt = rule.until ? parseLocalDate(rule.until) : null;
  const count = rule.count ?? Infinity;
  const interval = rule.interval;

  let occurrencesCount = 0;
  const maxSafetyIterations = 1000; // Cap to avoid memory/perf issues or infinite loops
  // Loop passes, kept separate from occurrencesCount so fast-forwarding past a
  // long history cannot consume the safety budget or corrupt the COUNT cursor.
  let iterations = 0;

  // 1. DAILY Frequency
  if (rule.freq === 'DAILY') {
    let current = new Date(startDt);

    // Fast-forward into the requested window. Without this, a daily series that
    // started years ago burns the whole safety budget on history, every
    // `current >= rangeStart` check fails, and a valid month renders empty.
    if (current < rangeStart) {
      const msPerDay = 24 * 60 * 60 * 1000;
      const daysBeforeWindow = Math.floor(
        (rangeStart.getTime() - current.getTime()) / msPerDay
      );
      const stepsToSkip = Math.floor(daysBeforeWindow / interval);

      if (stepsToSkip > 0) {
        current.setDate(current.getDate() + stepsToSkip * interval);
        // COUNT is relative to the series start, so seed the cursor with the
        // occurrences that already elapsed. Round to stay exact across DST.
        occurrencesCount = Math.floor(
          Math.round((current.getTime() - startDt.getTime()) / msPerDay) / interval
        );
      }
    }

    while (
      current <= rangeEnd &&
      (!untilDt || current <= untilDt) &&
      occurrencesCount < count &&
      iterations < maxSafetyIterations
    ) {
      if (current >= rangeStart) {
        occurrences.push(formatLocalDate(current));
      }
      occurrencesCount++;
      iterations++;
      // Increment by interval days
      current.setDate(current.getDate() + interval);
    }
  }

  // 2. WEEKLY Frequency
  else if (rule.freq === 'WEEKLY') {
    const byday = rule.byday && rule.byday.length > 0 ? rule.byday : null;
    const targetDays = byday
      ? byday.map(code => DAY_CODES[code.toUpperCase()]).filter(dayVal => dayVal !== undefined)
      : [startDt.getDay()];

    // Sort targetDays so we process days within a week in order
    targetDays.sort((a, b) => a - b);

    const baseSunday = getSunday(startDt);
    let currentWeekSunday = new Date(baseSunday);

    while (
      currentWeekSunday <= rangeEnd &&
      (!untilDt || currentWeekSunday <= untilDt || getSunday(untilDt).getTime() === currentWeekSunday.getTime()) &&
      occurrencesCount < count &&
      iterations < maxSafetyIterations
    ) {
      iterations++;
      // Check if this week is active according to the interval
      const weekDiff = Math.round((currentWeekSunday.getTime() - baseSunday.getTime()) / (7 * 24 * 3600 * 1000));
      if (weekDiff % interval === 0) {
        // Evaluate each specified day of the week
        for (const dayOfWeek of targetDays) {
          const dayDate = new Date(currentWeekSunday);
          dayDate.setDate(dayDate.getDate() + dayOfWeek);

          if (dayDate < startDt) continue;
          if (untilDt && dayDate > untilDt) break;
          if (dayDate > rangeEnd) break;

          if (dayDate >= rangeStart) {
            occurrences.push(formatLocalDate(dayDate));
          }
          occurrencesCount++;
          if (occurrencesCount >= count) break;
        }
      }

      // Step to next week sunday
      currentWeekSunday.setDate(currentWeekSunday.getDate() + 7);
    }
  }

  // 3. MONTHLY Frequency
  else if (rule.freq === 'MONTHLY') {
    const targetDay = startDt.getDate();
    let current = new Date(startDt);

    while (
      current <= rangeEnd &&
      (!untilDt || current <= untilDt) &&
      occurrencesCount < count &&
      iterations < maxSafetyIterations
    ) {
      if (current >= rangeStart) {
        occurrences.push(formatLocalDate(current));
      }
      occurrencesCount++;
      iterations++;

      // Advance by interval months
      const nextMonth = current.getMonth() + interval;
      const nextYear = current.getFullYear() + Math.floor((current.getMonth() + interval) / 12);
      const actualMonth = ((nextMonth % 12) + 12) % 12;
      
      // Determine correct end of month day (cap if targetDay is e.g. 31)
      const daysInNextMonth = new Date(nextYear, actualMonth + 1, 0).getDate();
      const actualDay = Math.min(targetDay, daysInNextMonth);
      current = new Date(nextYear, actualMonth, actualDay, 0, 0, 0, 0);
    }
  }

  // 4. YEARLY Frequency
  else if (rule.freq === 'YEARLY') {
    const targetMonth = startDt.getMonth();
    const targetDay = startDt.getDate();
    let current = new Date(startDt);

    while (
      current <= rangeEnd &&
      (!untilDt || current <= untilDt) &&
      occurrencesCount < count &&
      iterations < maxSafetyIterations
    ) {
      if (current >= rangeStart) {
        occurrences.push(formatLocalDate(current));
      }
      occurrencesCount++;
      iterations++;

      // Advance by interval years
      const nextYear = current.getFullYear() + interval;
      const daysInFeb = new Date(nextYear, 2, 0).getDate();
      const actualDay = (targetMonth === 1 && targetDay === 29) ? Math.min(29, daysInFeb) : targetDay;
      current = new Date(nextYear, targetMonth, actualDay, 0, 0, 0, 0);
    }
  }

  return occurrences;
};
