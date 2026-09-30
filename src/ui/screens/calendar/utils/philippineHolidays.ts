/**
 * Philippine holidays, built into every calendar the way Google Calendar's
 * "Holidays in the Philippines" layer is — no import needed, never a time block.
 *
 * Days fixed by law and Holy Week are computed for any year. Chinese New Year
 * and the two Eids follow lunar calendars, and the Palace adds a few special
 * days each year, so those come from the proclamations in `PROCLAIMED`. Any
 * other year falls back to an ICU lunar estimate, flagged `tentative`.
 *
 * The same table as the desktop app's; update both together.
 */

/** Calendar-layer id for the built-in holidays in the shared visibility map. */
export const HOLIDAY_CALENDAR_ID = 'holidays-ph';
export const HOLIDAY_CALENDAR_NAME = 'Holidays in the Philippines';

export type HolidayKind = 'regular' | 'special' | 'observance';

export interface Holiday {
  /** Local YYYY-MM-DD key, the same shape `formatLocalDate` produces. */
  date: string;
  name: string;
  kind: HolidayKind;
  /** Estimated from the lunar calendar; the official date is not proclaimed yet. */
  tentative?: boolean;
}

interface ProclaimedYear {
  /** Month-day keys ("MM-DD"). An Eid left out is still to be proclaimed. */
  chineseNewYear: string;
  eidlFitr?: string;
  eidlAdha?: string;
  /** Additional special (non-working) days that change from year to year. */
  extra: { date: string; name: string }[];
}

const ALL_SAINTS_EVE = "All Saints' Day Eve";
const ALL_SOULS = "All Souls' Day";

/** Update this table when Malacañang releases the next year's list. */
const PROCLAIMED: Record<number, ProclaimedYear> = {
  // Proc. 727 (s. 2024); Eid'l Fitr Proc. 839; Eid'l Adha Proc. 911.
  2025: { chineseNewYear: '01-29', eidlFitr: '04-01', eidlAdha: '06-06', extra: [{ date: '10-31', name: ALL_SAINTS_EVE }] },
  // Proc. 1006 (s. 2025); Eid'l Fitr Proc. 1189; Eid'l Adha Proc. 1264.
  2026: { chineseNewYear: '02-17', eidlFitr: '03-20', eidlAdha: '05-27', extra: [{ date: '11-02', name: ALL_SOULS }] },
  // Proc. 1427 (s. 2026). The Eids are proclaimed closer to the day.
  2027: { chineseNewYear: '02-06', extra: [{ date: '11-02', name: ALL_SOULS }] },
};

const pad = (value: number): string => String(value).padStart(2, '0');
const dateKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Easter Sunday by the anonymous Gregorian computus (Meeus/Jones/Butcher). */
export const easterSunday = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(year, Math.floor(n / 31) - 1, (n % 31) + 1);
};

/** National Heroes Day falls on the last Monday of August. */
const lastMondayOfAugust = (year: number): Date => {
  const date = new Date(year, 8, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
};

/**
 * Every date in `year` that is `month`/`day` in an ICU calendar. A Hijri year
 * is ~11 days shorter, so an Eid can land twice in one Gregorian year.
 */
const lunarDates = (year: number, calendar: string, month: number, day: number): string[] => {
  try {
    const format = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
    if (format.resolvedOptions().calendar !== calendar) return [];
    const found: string[] = [];
    for (let time = Date.UTC(year, 0, 1, 12); time < Date.UTC(year + 1, 0, 1); time += 86_400_000) {
      const parts = format.formatToParts(new Date(time));
      const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
      if (part('month') === month && part('day') === day) found.push(new Date(time).toISOString().slice(0, 10));
    }
    return found;
  } catch {
    return [];
  }
};

const buildYear = (year: number): Holiday[] => {
  const proclaimed = PROCLAIMED[year];
  const holidays: Holiday[] = [];
  const add = (date: string | Date, name: string, kind: HolidayKind, tentative = false): void => {
    const key = typeof date === 'string' ? (date.length === 5 ? `${year}-${date}` : date) : dateKey(date);
    holidays.push(tentative ? { date: key, name, kind, tentative } : { date: key, name, kind });
  };
  const fromEaster = (days: number): Date => {
    const date = easterSunday(year);
    date.setDate(date.getDate() + days);
    return date;
  };

  // Regular holidays (Labor Code art. 94, as amended by RA 9492).
  add('01-01', "New Year's Day", 'regular');
  add(fromEaster(-3), 'Maundy Thursday', 'regular');
  add(fromEaster(-2), 'Good Friday', 'regular');
  add('04-09', 'Araw ng Kagitingan', 'regular');
  add('05-01', 'Labor Day', 'regular');
  add('06-12', 'Independence Day', 'regular');
  add(lastMondayOfAugust(year), 'National Heroes Day', 'regular');
  add('11-30', 'Bonifacio Day', 'regular');
  add('12-25', 'Christmas Day', 'regular');
  add('12-30', 'Rizal Day', 'regular');

  // Eid'l Fitr (1 Shawwal) and Eid'l Adha (10 Dhu al-Hijjah), RA 9177 and RA 9849.
  const eid = (proclaimedDate: string | undefined, name: string, month: number, day: number): void => {
    if (proclaimedDate) add(proclaimedDate, name, 'regular');
    else lunarDates(year, 'islamic-umalqura', month, day).forEach((date) => add(date, name, 'regular', true));
  };
  eid(proclaimed?.eidlFitr, "Eid'l Fitr", 10, 1);
  eid(proclaimed?.eidlAdha, "Eid'l Adha", 12, 10);

  // Special (non-working) days.
  if (proclaimed) add(proclaimed.chineseNewYear, 'Chinese New Year', 'special');
  else lunarDates(year, 'chinese', 1, 1).forEach((date) => add(date, 'Chinese New Year', 'special', true));
  add(fromEaster(-1), 'Black Saturday', 'special');
  add('08-21', 'Ninoy Aquino Day', 'special');
  add('11-01', "All Saints' Day", 'special');
  add('12-08', 'Feast of the Immaculate Conception of Mary', 'special');
  add('12-24', 'Christmas Eve', 'special');
  add('12-31', 'Last Day of the Year', 'special');
  proclaimed?.extra.forEach(({ date, name }) => add(date, name, 'special'));

  // Commemorated, but proclaimed a special working day in recent years.
  add('02-25', 'EDSA People Power Revolution Anniversary', 'observance');

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
};

const byYear = new Map<number, Map<string, Holiday[]>>();

const indexYear = (year: number): Map<string, Holiday[]> => {
  let index = byYear.get(year);
  if (!index) {
    index = new Map();
    for (const holiday of buildYear(year)) index.set(holiday.date, [...(index.get(holiday.date) ?? []), holiday]);
    byYear.set(year, index);
  }
  return index;
};

/** All holidays in a year, in date order. */
export const getPhilippineHolidays = (year: number): Holiday[] => [...indexYear(year).values()].flat();

/** The holidays falling on a local YYYY-MM-DD date (usually none, at most a couple). */
export const getHolidaysOn = (date: string): Holiday[] => {
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? (indexYear(year).get(date) ?? []) : [];
};

const KIND_LABEL: Record<HolidayKind, string> = {
  regular: 'Regular holiday',
  special: 'Special non-working day',
  observance: 'Observance',
};

/** Detail text: the name, its kind, and whether the date is still an estimate. */
export const describeHoliday = (holiday: Holiday): string =>
  `${holiday.name}\n${KIND_LABEL[holiday.kind]}${holiday.tentative ? ' · estimated date, awaiting proclamation' : ''}`;
