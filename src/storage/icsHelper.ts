import { Task, Event } from './tasksStore';
import { TimeBlock } from './timeBlocksStore';
import ICalParser from 'ical-js-parser';
import { RRule, RRuleSet, rrulestr } from 'rrule';

/**
 * Escapes special characters for iCalendar format values.
 * RFC 5545 requires escaping backslashes, commas, semicolons, and newlines.
 * 
 * @param text The raw string to escape.
 * @returns The escaped string.
 */
const escapeText = (text: string | null | undefined): string => {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
};

/**
 * Unescapes special characters from iCalendar format values.
 * 
 * @param text The escaped iCalendar string.
 * @returns The unescaped raw string.
 */
const unescapeText = (text: string): string => {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
};

/**
 * Formats a YYYY-MM-DD date and HH:MM time into an iCalendar date-time string (YYYYMMDDThhmmss).
 * If time is not provided, formats as date-only (YYYYMMDD).
 * 
 * @param date YYYY-MM-DD date string.
 * @param time Optional HH:MM time string.
 * @returns iCalendar formatted string.
 */
const formatIcsDateTime = (date: string, time?: string | null): string => {
  const cleanDate = date.replace(/-/g, '');
  if (!time) {
    return cleanDate;
  }
  const cleanTime = time.replace(/:/g, '');
  return `${cleanDate}T${cleanTime}00`;
};

/**
 * Parses an iCalendar date or date-time string into a structured date (YYYY-MM-DD) and time (HH:MM).
 * Handles formats: YYYYMMDD, YYYYMMDDThhmmss, YYYYMMDDThhmmssZ.
 * 
 * @param icsValue The raw iCalendar datetime value.
 * @returns An object with date and optional time.
 */
const parseIcsDateTime = (icsValue: string): { date: string; time?: string } => {
  // Strip any trailing Z (UTC identifier) or extra text
  const clean = icsValue.trim().replace(/Z$/, '');
  
  if (clean.includes('T')) {
    const [datePart, timePart] = clean.split('T');
    if (/^\d{8}$/.test(datePart) && timePart.length >= 4) {
      const year = datePart.substring(0, 4);
      const month = datePart.substring(4, 6);
      const day = datePart.substring(6, 8);
      const hour = timePart.substring(0, 2);
      const minute = timePart.substring(2, 4);
      return {
        date: `${year}-${month}-${day}`,
        time: `${hour}:${minute}`,
      };
    }
  }
  
  if (/^\d{8}$/.test(clean)) {
    const year = clean.substring(0, 4);
    const month = clean.substring(4, 6);
    const day = clean.substring(6, 8);
    return {
      date: `${year}-${month}-${day}`,
    };
  }
  
  // Fallback to today if format is unrecognized
  const todayStr = new Date().toISOString().split('T')[0];
  return { date: todayStr };
};

/**
 * Folds a line to a maximum of 75 octets as specified in RFC 5545.
 * Folds by inserting a CRLF and a single space character.
 * 
 * @param line The line of text to fold.
 * @returns The folded line string.
 */
const foldLine = (line: string): string => {
  if (line.length <= 75) return line;
  
  let result = '';
  let remaining = line;
  
  // First chunk can be up to 75 characters
  result += remaining.substring(0, 75);
  remaining = remaining.substring(75);
  
  // Subsequent chunks can be up to 74 characters (because of the leading space)
  while (remaining.length > 0) {
    result += '\r\n ' + remaining.substring(0, 74);
    remaining = remaining.substring(74);
  }
  
  return result;
};

/**
 * Generates an iCalendar RFC 5545 compliant string for events, time blocks, and tasks.
 * 
 * @param events List of calendar events.
 * @param blocks List of schedule/time blocks.
 * @param tasks List of tasks.
 * @returns iCalendar formatted string.
 */
export const generateIcsString = (
  events: Event[],
  blocks: TimeBlock[],
  tasks: Task[]
): string => {
  const nowFormatted = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LAFINA//NONSGML Calendar//EN',
    'CALSCALE:GREGORIAN',
  ];

  // 1. Export Events
  events.forEach((event) => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.id}`);
    lines.push(`DTSTAMP:${nowFormatted}`);
    lines.push(`DTSTART:${formatIcsDateTime(event.date, event.startTime)}`);
    lines.push(`DTEND:${formatIcsDateTime(event.date, event.endTime)}`);
    lines.push(foldLine(`SUMMARY:${escapeText(event.title)}`));
    if (event.location) {
      lines.push(foldLine(`LOCATION:${escapeText(event.location)}`));
    }
    if (event.recurrenceRule) {
      lines.push(`RRULE:${event.recurrenceRule}`);
    }
    lines.push('X-LAFINA-TYPE:event');
    lines.push('END:VEVENT');
  });

  // 2. Export Time Blocks
  blocks.forEach((block) => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${block.id}`);
    lines.push(`DTSTAMP:${nowFormatted}`);
    lines.push(`DTSTART:${formatIcsDateTime(block.date, block.startTime)}`);
    lines.push(`DTEND:${formatIcsDateTime(block.date, block.endTime)}`);
    lines.push(foldLine(`SUMMARY:${escapeText(block.title)}`));
    if (block.notes) {
      lines.push(foldLine(`DESCRIPTION:${escapeText(block.notes)}`));
    }
    lines.push(foldLine(`CATEGORIES:${escapeText(block.category)}`));
    lines.push(`X-LAFINA-COLOR:${block.color}`);
    if (block.recurrenceRule) {
      lines.push(`RRULE:${block.recurrenceRule}`);
    }
    lines.push('X-LAFINA-TYPE:time_block');
    lines.push('END:VEVENT');
  });

  // 3. Export Tasks
  tasks.forEach((task) => {
    lines.push('BEGIN:VTODO');
    lines.push(`UID:${task.id}`);
    lines.push(`DTSTAMP:${nowFormatted}`);
    if (task.dueDate) {
      const dt = formatIcsDateTime(task.dueDate, task.dueTime);
      if (task.dueTime) {
        lines.push(`DUE:${dt}`);
      } else {
        lines.push(`DUE;VALUE=DATE:${dt}`);
      }
    }
    lines.push(foldLine(`SUMMARY:${escapeText(task.title)}`));
    if (task.notes) {
      lines.push(foldLine(`DESCRIPTION:${escapeText(task.notes)}`));
    }
    lines.push(foldLine(`CATEGORIES:${escapeText(task.category)}`));
    lines.push(`STATUS:${task.isCompleted ? 'COMPLETED' : 'NEEDS-ACTION'}`);
    
    // Priority mapping: High -> 1, Medium -> 5, Low -> 9
    const priorityNum = task.priority === 'High' ? 1 : task.priority === 'Medium' ? 5 : 9;
    lines.push(`PRIORITY:${priorityNum}`);
    if (task.recurrenceRule) {
      lines.push(`RRULE:${task.recurrenceRule}`);
    }
    lines.push('X-LAFINA-TYPE:task');
    lines.push('END:VTODO');
  });

  lines.push('END:VCALENDAR');
  
  // Join lines with CRLF as required by RFC 5545
  return lines.join('\r\n') + '\r\n';
};

// Helper to parse duration string (e.g. PT1H30M or P1W) to milliseconds
const parseDuration = (iso: string): number => {
  const clean = iso.trim().toUpperCase();
  const weekMatch = clean.match(/^P(\d+)W$/);
  if (weekMatch) {
    return parseInt(weekMatch[1], 10) * 7 * 24 * 60 * 60 * 1000;
  }
  const match = clean.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 3600000; // default 1 hour
  const d = match[1] ? parseInt(match[1], 10) : 0;
  const h = match[2] ? parseInt(match[2], 10) : 0;
  const m = match[3] ? parseInt(match[3], 10) : 0;
  const s = match[4] ? parseInt(match[4], 10) : 0;
  return ((d * 24 + h) * 60 + m) * 60000 + s * 1000;
};

// Timezone-independent Date parser
const parseIcsToUtcDate = (icsValue: string): Date => {
  try {
    const clean = icsValue.trim().replace(/Z$/, '');
    if (clean.includes('T')) {
      const [datePart, timePart] = clean.split('T');
      if (!/^\d{8}$/.test(datePart) || timePart.length < 4) {
        return new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 0, 0, 0));
      }
      const year = parseInt(datePart.substring(0, 4), 10);
      const month = parseInt(datePart.substring(4, 6), 10) - 1;
      const day = parseInt(datePart.substring(6, 8), 10);
      const hour = parseInt(timePart.substring(0, 2), 10);
      const minute = parseInt(timePart.substring(2, 4), 10);
      const second = timePart.length >= 6 ? parseInt(timePart.substring(4, 6), 10) : 0;
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    } else {
      if (!/^\d{8}$/.test(clean)) {
        return new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 0, 0, 0));
      }
      const year = parseInt(clean.substring(0, 4), 10);
      const month = parseInt(clean.substring(4, 6), 10) - 1;
      const day = parseInt(clean.substring(6, 8), 10);
      return new Date(Date.UTC(year, month, day, 0, 0, 0));
    }
  } catch {
    return new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 0, 0, 0));
  }
};

const cleanIcsValue = (val: string): string => {
  const parts = val.split(':');
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    if (/\d+/.test(lastPart)) {
      return lastPart;
    }
  }
  return val;
};

// Alignment helper for exdate/rdate
const parseIcsDateWithValueTime = (icsValue: string, referenceTime: Date): Date => {
  const parsed = parseIcsToUtcDate(icsValue);
  const clean = icsValue.trim().replace(/Z$/, '');
  if (!clean.includes('T')) {
    parsed.setUTCHours(referenceTime.getUTCHours());
    parsed.setUTCMinutes(referenceTime.getUTCMinutes());
    parsed.setUTCSeconds(referenceTime.getUTCSeconds());
    parsed.setUTCMilliseconds(referenceTime.getUTCMilliseconds());
  }
  return parsed;
};

const formatDateForRRule = (date: Date): string => {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
};

const formatUtcDate = (date: Date): string => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatUtcTime = (date: Date): string => {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};

/**
 * What a VEVENT becomes on import.
 *
 * LAFINA labels everything it exports with `X-LAFINA-TYPE`, so a file from
 * this app round-trips exactly. Nothing else does: a calendar subscribed from
 * Google, Outlook or a university timetable is all unlabelled VEVENTs, and
 * those are blocks of time on a schedule — a class, a shift, a meeting — not
 * the dateless "Event" an unlabelled import used to produce.
 */
const veventType = (xLafinaType: string | null | undefined): 'event' | 'time_block' =>
  (xLafinaType ?? '').trim().toLowerCase() === 'event' ? 'event' : 'time_block';

/** True when the file said what this is, rather than leaving it to be guessed. */
const isLafinaLabelled = (xLafinaType: string | null | undefined): boolean =>
  ['event', 'time_block'].includes((xLafinaType ?? '').trim().toLowerCase());

const resolveDtend = (vevent: any, dtstart: Date): Date => {
  if (vevent.dtend && vevent.dtend.value) {
    return parseIcsToUtcDate(vevent.dtend.value);
  }
  if (vevent.duration) {
    const durationMs = parseDuration(vevent.duration);
    return new Date(dtstart.getTime() + durationMs);
  }
  return new Date(dtstart.getTime() + 60 * 60 * 1000); // default: 1 hour
};

/**
 * RRULE frequencies LAFINA expands at import time.
 *
 * Sub-daily frequencies (SECONDLY, MINUTELY, HOURLY) are deliberately excluded:
 * expanding one over the import horizon produces millions of rows and freezes or
 * kills the JS thread, so an untrusted `.ics` file could brick the app.
 */
const SUPPORTED_RRULE_FREQUENCIES: ReadonlySet<string> = new Set([
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
]);

/** Hard ceiling on occurrences materialised from a single RRULE. */
export const MAX_OCCURRENCES_PER_RULE = 1000;

/** Hard ceiling on total rows produced by a single imported calendar file. */
export const MAX_IMPORTED_ITEMS = 5000;

/** Longest recurrence horizon expanded when importing a recurring event. */
const RECURRENCE_HORIZON_YEARS = 2;

/** Matches a strictly positive base-10 integer with no sign or decimal part. */
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

/**
 * Parses an RRULE value into its `KEY=VALUE` parts, ignoring a leading `RRULE:`.
 */
const splitRruleParts = (
  rule: string | null | undefined,
): { key: string; value: string }[] => {
  if (!rule) return [];
  return rule
    .replace(/^RRULE:/i, '')
    .split(';')
    .map(part => {
      const separator = part.indexOf('=');
      if (separator === -1) return { key: part.trim().toUpperCase(), value: '' };
      return {
        key: part.slice(0, separator).trim().toUpperCase(),
        value: part.slice(separator + 1).trim(),
      };
    });
};

/**
 * Rejects RRULE values that make the upstream `rrule` expander spin forever.
 *
 * `RRuleSet.between` iterates by adding INTERVAL to a cursor. A non-integer,
 * zero, or negative INTERVAL never advances that cursor, so `between` blocks the
 * JS thread indefinitely and the app must be force-stopped. Untrusted syllabus
 * files must never be able to reach that code path.
 *
 * @param rule Raw RRULE string from a parsed VEVENT/VTODO.
 * @returns True only when the numeric parts are safe to expand.
 */
export const isExpandableRrule = (
  rule: string | null | undefined,
): boolean => {
  const parts = splitRruleParts(rule);
  if (parts.length === 0) return false;

  for (const { key, value } of parts) {
    if (key === 'INTERVAL' || key === 'COUNT') {
      if (!POSITIVE_INTEGER_PATTERN.test(value)) return false;
    }
  }

  return true;
};

/**
 * Extracts the FREQ component of an RRULE value, tolerating a leading `RRULE:`.
 *
 * @param rule Raw RRULE string from a parsed VEVENT/VTODO.
 * @returns The upper-cased frequency token, or null when it cannot be determined.
 */
export const getRruleFrequency = (
  rule: string | null | undefined,
): string | null => {
  if (!rule) return null;
  const match = rule.replace(/^RRULE:/i, '').match(/(?:^|;)FREQ=([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : null;
};

/**
 * Builds the single-occurrence fallback used when a recurrence rule cannot be expanded.
 */
const buildSingleOccurrence = (
  dtstart: Date,
  durationMs: number,
): { date: string; startTime: string; endTime: string }[] => {
  const occurrenceEnd = new Date(dtstart.getTime() + durationMs);
  return [
    {
      date: formatUtcDate(dtstart),
      startTime: formatUtcTime(dtstart),
      endTime: formatUtcTime(occurrenceEnd),
    },
  ];
};

const expandRecurringEvent = (
  vevent: any,
  dtstart: Date,
  dtend: Date,
  rdates: string[],
): { date: string; startTime: string; endTime: string }[] => {
  const duration = dtend.getTime() - dtstart.getTime();

  const frequency = getRruleFrequency(vevent.rrule);
  if (!frequency || !SUPPORTED_RRULE_FREQUENCIES.has(frequency)) {
    console.warn(
      `[icsHelper] Unsupported RRULE frequency "${frequency ?? 'unknown'}"; importing the first occurrence only.`,
    );
    return buildSingleOccurrence(dtstart, duration);
  }

  if (!isExpandableRrule(vevent.rrule)) {
    console.warn(
      '[icsHelper] RRULE has unsafe INTERVAL/COUNT values; importing the first occurrence only.',
    );
    return buildSingleOccurrence(dtstart, duration);
  }

  try {
    const ruleSet = new RRuleSet();

    const rruleString = `DTSTART:${formatDateForRRule(dtstart)}\nRRULE:${vevent.rrule}`;
    const rule = rrulestr(rruleString, { forceset: false });
    const primaryRule =
      rule instanceof RRule ? rule : (rule as RRuleSet).rrules()[0];
    if (!primaryRule) {
      return buildSingleOccurrence(dtstart, duration);
    }
    ruleSet.rrule(primaryRule);

    if (vevent.exdate) {
      for (const ex of vevent.exdate) {
        if (ex && ex.value) {
          const cleanEx = cleanIcsValue(ex.value);
          ruleSet.exdate(parseIcsDateWithValueTime(cleanEx, dtstart));
        }
      }
    }

    for (const rd of rdates) {
      ruleSet.rdate(parseIcsDateWithValueTime(rd, dtstart));
    }

    const expansionEnd = new Date(dtstart);
    expansionEnd.setFullYear(
      expansionEnd.getFullYear() + RECURRENCE_HORIZON_YEARS,
    );

    const occurrences = ruleSet.between(dtstart, expansionEnd, true).slice(0, MAX_OCCURRENCES_PER_RULE);

    return occurrences.map(occurrenceStart => {
      const occurrenceEnd = new Date(occurrenceStart.getTime() + duration);
      return {
        date: formatUtcDate(occurrenceStart),
        startTime: formatUtcTime(occurrenceStart),
        endTime: formatUtcTime(occurrenceEnd),
      };
    });
  } catch (error) {
    console.warn(
      '[icsHelper] Could not expand RRULE; importing the first occurrence only.',
      error,
    );
    return buildSingleOccurrence(dtstart, duration);
  }
};

// Normalize CRLF to LF, unfold lines, and sanitize invalid dates so ical-js-parser doesn't drop events
const sanitizeIcsContent = (icsContent: string): string => {
  const normalized = icsContent.replace(/\r\n/g, '\n');
  const unfoldedLines: string[] = [];
  const rawLines = normalized.split('\n');
  
  for (const line of rawLines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (unfoldedLines.length > 0) {
        unfoldedLines[unfoldedLines.length - 1] += line.substring(1);
      }
    } else if (line.trim().length > 0) {
      unfoldedLines.push(line);
    }
  }

  const todayFormatted = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const sanitizedLines = unfoldedLines.map(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) return line;
    const fullKey = line.substring(0, colonIndex);
    const value = line.substring(colonIndex + 1).trim();
    const baseKey = fullKey.split(';')[0].toUpperCase();

    if (['DTSTART', 'DTEND', 'DUE', 'EXDATE', 'RDATE', 'RECURRENCE-ID'].includes(baseKey)) {
      const cleanValue = cleanIcsValue(value).replace(/Z$/, '');
      const parts = cleanValue.split('T');
      const datePart = parts[0];
      if (!/^\d{8}$/.test(datePart)) {
        return `${fullKey}:${todayFormatted}`;
      }
    }
    return line;
  });

  return sanitizedLines.join('\n');
};

/** Result of importing a single iCalendar document. */
export interface ParsedIcsResult {
  events: Omit<Event, 'userId' | 'createdAt' | 'updatedAt'>[];
  blocks: Omit<TimeBlock, 'userId' | 'createdAt' | 'updatedAt'>[];
  tasks: Omit<Task, 'userId' | 'createdAt' | 'updatedAt'>[];
}

/**
 * Parses an iCalendar string back into LAFINA tasks, events, and time blocks.
 * Supports unfolding lines and parsing custom properties.
 *
 * A malformed or hostile file must never throw into the calendar screen, so a
 * failed import degrades to an empty result.
 *
 * @param icsContent The iCalendar file content string.
 * @returns Parsed events, time blocks, and tasks.
 */
export const parseIcsString = (icsContent: string): ParsedIcsResult => {
  try {
    return parseIcsStringInternal(icsContent);
  } catch (error) {
    console.error(
      '[icsHelper] iCalendar import failed; no items were imported.',
      error,
    );
    return { events: [], blocks: [], tasks: [] };
  }
};

const parseIcsStringInternal = (icsContent: string): ParsedIcsResult => {
  const events: Omit<Event, 'userId' | 'createdAt' | 'updatedAt'>[] = [];
  const blocks: Omit<TimeBlock, 'userId' | 'createdAt' | 'updatedAt'>[] = [];
  const tasks: Omit<Task, 'userId' | 'createdAt' | 'updatedAt'>[] = [];

  const sanitized = sanitizeIcsContent(icsContent);
  const unfoldedLines = sanitized.split('\n');

  // Step 2: Scan unfolded lines to collect all RDATEs by UID (needed because ical-js-parser only keeps last RDATE)
  const rdatesByUid: { [uid: string]: string[] } = {};
  let scanUid: string | null = null;
  for (const line of unfoldedLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const fullKey = line.substring(0, colonIndex);
    const value = line.substring(colonIndex + 1);
    const baseKey = fullKey.split(';')[0].toUpperCase();

    if (baseKey === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      scanUid = null;
    } else if (baseKey === 'UID') {
      scanUid = value.trim();
    } else if (baseKey === 'RDATE' && scanUid) {
      if (!rdatesByUid[scanUid]) {
        rdatesByUid[scanUid] = [];
      }
      const cleanVal = cleanIcsValue(value);
      const parts = cleanVal.split(',');
      for (const part of parts) {
        if (part.trim()) {
          rdatesByUid[scanUid].push(part.trim());
        }
      }
    }
  }

  // Step 3: Parse with ical-js-parser. An unparseable file must degrade to an
  // empty import rather than throw into the calendar screen.
  let rawEvents: any[] = [];
  let rawTodos: any[] = [];
  try {
    const parsed = ICalParser.toJSON(sanitized);
    rawEvents = parsed.events || [];
    rawTodos = parsed.todos || [];
  } catch (error) {
    console.error('[icsHelper] Could not parse iCalendar content:', error);
    return { events, blocks, tasks };
  }

  const nonOverrides = rawEvents.filter(e => !e.recurrenceId);
  const overrides = rawEvents.filter(e => e.recurrenceId);

  const importedItemCount = (): number =>
    events.length + blocks.length + tasks.length;

  // Process VEVENTs
  for (const vevent of nonOverrides) {
    if (importedItemCount() >= MAX_IMPORTED_ITEMS) {
      console.warn(
        `[icsHelper] Import stopped at the ${MAX_IMPORTED_ITEMS}-item ceiling.`,
      );
      break;
    }
    const type = veventType(vevent.xLafinaType);
    const uid = vevent.uid || 'imported_' + Math.random().toString(36).substring(2, 9);
    const summary = unescapeText(vevent.summary || 'Untitled');
    const location = vevent.location ? unescapeText(vevent.location) : null;
    const color = vevent.xLafinaColor || '#2196F3';
    // A LAFINA block with no CATEGORIES was a "Work" block. A foreign entry
    // gets no category here, so the import files it under "Imported" instead
    // of quietly claiming it as work.
    const categoryDefault =
      type === 'time_block' && isLafinaLabelled(vevent.xLafinaType) ? 'Work' : '';
    const category = unescapeText(vevent.categories || categoryDefault);
    const notes = vevent.description ? unescapeText(vevent.description) : undefined;
    const rrule = vevent.rrule || null;

    if (!vevent.dtstart || !vevent.dtstart.value) continue;

    const dtstart = parseIcsToUtcDate(vevent.dtstart.value);
    const dtend = resolveDtend(vevent, dtstart);

    if (!rrule) {
      const parsedStart = parseIcsDateTime(vevent.dtstart.value);
      const parsedEnd = vevent.dtend ? parseIcsDateTime(vevent.dtend.value) : null;

      if (type === 'time_block') {
        blocks.push({
          id: uid,
          title: summary,
          date: parsedStart.date,
          startTime: parsedStart.time || '09:00',
          endTime: parsedEnd?.time || '10:00',
          color,
          category,
          notes,
          recurrenceRule: null,
        });
      } else {
        events.push({
          id: uid,
          title: summary,
          date: parsedStart.date,
          startTime: parsedStart.time || '12:00',
          endTime: parsedEnd?.time || '13:00',
          location,
          recurrenceRule: null,
        });
      }
    } else {
      const rdates = rdatesByUid[uid] || [];
      const expanded = expandRecurringEvent(vevent, dtstart, dtend, rdates);

      expanded.forEach((occurrence, idx) => {
        if (importedItemCount() >= MAX_IMPORTED_ITEMS) return;
        const occurrenceId = `${uid}_${idx}`;
        if (type === 'time_block') {
          blocks.push({
            id: occurrenceId,
            title: summary,
            date: occurrence.date,
            startTime: occurrence.startTime,
            endTime: occurrence.endTime,
            color,
            category,
            notes,
            recurrenceRule: null,
          });
        } else {
          events.push({
            id: occurrenceId,
            title: summary,
            date: occurrence.date,
            startTime: occurrence.startTime,
            endTime: occurrence.endTime,
            location,
            recurrenceRule: null,
          });
        }
      });
    }
  }

  // Apply RECURRENCE-ID overrides
  for (const override of overrides) {
    const overrideUid = override.uid;
    if (!overrideUid || !override.recurrenceId || !override.recurrenceId.value) continue;
    const overrideDate = parseIcsToUtcDate(override.recurrenceId.value);
    const type = veventType(override.xLafinaType);

    if (type === 'time_block') {
      const idx = blocks.findIndex(
        ev => {
          if (!ev.id.startsWith(overrideUid)) return false;
          const occurrenceStart = parseIcsToUtcDate(formatIcsDateTime(ev.date, ev.startTime));
          return Math.abs(occurrenceStart.getTime() - overrideDate.getTime()) < 86400000;
        }
      );
      if (idx !== -1) {
        const dtstart = parseIcsToUtcDate(override.dtstart.value);
        const dtend = resolveDtend(override, dtstart);
        blocks[idx] = {
          id: blocks[idx].id,
          title: override.summary || blocks[idx].title,
          date: formatUtcDate(dtstart),
          startTime: formatUtcTime(dtstart),
          endTime: formatUtcTime(dtend),
          color: override.xLafinaColor || blocks[idx].color,
          category: override.categories || blocks[idx].category,
          notes: override.description ? unescapeText(override.description) : blocks[idx].notes,
          recurrenceRule: blocks[idx].recurrenceRule,
        };
      }
    } else {
      const idx = events.findIndex(
        ev => {
          if (!ev.id.startsWith(overrideUid)) return false;
          const occurrenceStart = parseIcsToUtcDate(formatIcsDateTime(ev.date, ev.startTime));
          return Math.abs(occurrenceStart.getTime() - overrideDate.getTime()) < 86400000;
        }
      );
      if (idx !== -1) {
        const dtstart = parseIcsToUtcDate(override.dtstart.value);
        const dtend = resolveDtend(override, dtstart);
        events[idx] = {
          id: events[idx].id,
          title: override.summary || events[idx].title,
          date: formatUtcDate(dtstart),
          startTime: formatUtcTime(dtstart),
          endTime: formatUtcTime(dtend),
          location: override.location !== undefined ? override.location : events[idx].location,
          recurrenceRule: events[idx].recurrenceRule,
        };
      }
    }
  }

  // Process VTODOs
  for (const todo of rawTodos) {
    if (importedItemCount() >= MAX_IMPORTED_ITEMS) break;
    const uid = todo.uid || 'imported_' + Math.random().toString(36).substring(2, 9);
    const summary = unescapeText(todo.summary || 'Untitled Task');
    const description = todo.description ? unescapeText(todo.description) : null;
    const categories = unescapeText(todo.categories || 'General');
    const status = todo.status || 'NEEDS-ACTION';
    const priorityVal = parseInt(todo.priority || '5', 10);
    const dueVal = cleanIcsValue(todo.due || '');
    const rrule = todo.rrule || null;

    let priority: 'High' | 'Medium' | 'Low' = 'Medium';
    if (priorityVal > 0 && priorityVal <= 4) priority = 'High';
    else if (priorityVal >= 5 && priorityVal <= 8) priority = 'Medium';
    else if (priorityVal >= 9) priority = 'Low';

    let dueDate: string | null = null;
    let dueTime: string | null = null;
    if (dueVal) {
      const dueParsed = parseIcsDateTime(dueVal);
      dueDate = dueParsed.date;
      dueTime = dueParsed.time || null;
    }

    tasks.push({
      id: uid,
      title: summary,
      dueDate,
      dueTime,
      isCompleted: status.toUpperCase() === 'COMPLETED',
      priority,
      category: categories,
      notes: description,
      recurrenceRule: rrule,
    });
  }

  return { events, blocks, tasks };
};

