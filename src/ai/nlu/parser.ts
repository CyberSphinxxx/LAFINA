import { generateId } from '../../utils';
import { notesStore, tasksStore } from '../../storage';
import { DEFAULT_NOTE_CATEGORY, DEFAULT_NOTE_TITLE } from '../../constants';
import { applyNluScheduleResult } from './scheduler';
import type { NluResult } from './types';

const TIME_24H_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_RANGE_PATTERN =
  /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|to|until)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
const DEFAULT_SCHEDULE_TITLE = 'Scheduled Event';

interface ParsedTimeRange {
  startTime: string;
  durationMinutes: number;
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/**
 * Normalizes transcription errors or shorthand formats, particularly inserting
 * colons for hours and minutes in time expressions (e.g. "615 pm" -> "6:15 pm").
 */
export const normalizeTranscript = (text: string): string => {
  // 1. Standardize a.m. / p.m. or a m / p m to am / pm (e.g., "p.m." -> "pm", "p m" -> "pm")
  let cleaned = text
    .replace(/\b([ap])\s*\.?\s*m\b\.?/gi, '$1m')
    .replace(/\b([01]?\d|2[0-3])\s*\.\s*([0-5]\d)\b/g, '$1:$2')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. Insert colon for the start of a range (e.g. "230 to 4:30 pm" -> "2:30 to 4:30 pm")
  cleaned = cleaned.replace(
    /\b(0?[1-9]|1[0-2])\s*([0-5][0-9])(?=\s*(?:to|until|-|through)\s*(?:0?[1-9]|1[0-2])(?::?[0-5][0-9])?\s*(?:am|pm)\b)/gi,
    '$1:$2'
  );

  // 3. Insert colon for times with a meridiem (e.g. "615 pm" -> "6:15 pm")
  cleaned = cleaned.replace(/\b(0?[1-9]|1[0-2])\s*([0-5][0-9])\s*(am|pm)\b/gi, '$1:$2 $3');

  return cleaned;
};

const normalizeCommandText = (text: string): string => {
  return normalizeTranscript(text);
};

const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeMeridiem = (value: string): 'am' | 'pm' | null => {
  const lowerValue = value.toLowerCase();
  if (lowerValue.includes('am')) {
    return 'am';
  }
  if (lowerValue.includes('pm')) {
    return 'pm';
  }
  return null;
};

const parseFlexibleTime = (timeText: string, inheritedMeridiem: 'am' | 'pm' | null = null): string | null => {
  const compactTime = timeText.trim().toLowerCase().replace(/\s+/g, '');
  if (TIME_24H_PATTERN.test(compactTime)) {
    return compactTime;
  }

  const match = compactTime.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!match) {
    return null;
  }

  const meridiem = match[3] === 'am' || match[3] === 'pm' ? match[3] : inheritedMeridiem;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;

  if (minutes < 0 || minutes > 59 || hours < 0 || hours > 23) {
    return null;
  }

  if (meridiem === 'pm' && hours < 12) {
    hours += 12;
  } else if (meridiem === 'am' && hours === 12) {
    hours = 0;
  }

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

/**
 * Resolves calendar dates using local device timezone (anchorDate).
 */
const resolveCommandDate = (
  command: string,
  referenceDate: Date,
  parsedTime: string | null = null
): string => {
  const norm = normalizeCommandText(command);
  const anchor = new Date(referenceDate);
  const currentYear = anchor.getFullYear();
  const currentMonth = anchor.getMonth();
  const currentDate = anchor.getDate();

  // 1. Explicit Month + Day (e.g. "July 8th", "July 8", "Jul 8", "July 8, 2026")
  const monthRegex =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i;
  const monthMatch = norm.match(monthRegex);
  if (monthMatch) {
    const monthKey = monthMatch[1].toLowerCase();
    const targetMonth = MONTH_MAP[monthKey] ?? currentMonth;
    const targetDay = Number(monthMatch[2]);
    let targetYear = monthMatch[3] ? Number(monthMatch[3]) : currentYear;

    if (!monthMatch[3]) {
      if (targetMonth < currentMonth || (targetMonth === currentMonth && targetDay < currentDate)) {
        targetYear += 1;
      }
    }

    const resolved = new Date(targetYear, targetMonth, targetDay);
    return formatLocalDate(resolved);
  }

  // 2. US MM/DD Format (e.g. "7/8", "07/08/2026")
  const mmddRegex = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/;
  const mmddMatch = norm.match(mmddRegex);
  if (mmddMatch) {
    const targetMonth = Number(mmddMatch[1]) - 1;
    const targetDay = Number(mmddMatch[2]);
    let targetYear = currentYear;

    if (mmddMatch[3]) {
      targetYear = mmddMatch[3].length === 2 ? 2000 + Number(mmddMatch[3]) : Number(mmddMatch[3]);
    } else {
      if (targetMonth < currentMonth || (targetMonth === currentMonth && targetDay < currentDate)) {
        targetYear += 1;
      }
    }

    const resolved = new Date(targetYear, targetMonth, targetDay);
    return formatLocalDate(resolved);
  }

  // 3. Relative Weekday (e.g. "on Monday", "this Friday", "next Wednesday")
  const weekdayRegex =
    /\b(this|next|on)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i;
  const weekdayMatch = norm.match(weekdayRegex);

  if (weekdayMatch) {
    const prefix = (weekdayMatch[1] || '').toLowerCase();
    const dayName = weekdayMatch[2].toLowerCase();
    const targetDayOfWeek = WEEKDAY_MAP[dayName];

    if (targetDayOfWeek !== undefined) {
      const currentDayOfWeek = anchor.getDay();
      let diff = (targetDayOfWeek - currentDayOfWeek + 7) % 7;

      const isRecurrence = /\bevery\b/i.test(norm);

      if (prefix === 'next') {
        diff = diff === 0 ? 7 : diff + 7;
      } else if (!isRecurrence) {
        if (diff === 0 && parsedTime) {
          const currentHours = anchor.getHours();
          const currentMins = anchor.getMinutes();
          const [targetHours, targetMins] = parsedTime.split(':').map(Number);

          if (currentHours > targetHours || (currentHours === targetHours && currentMins >= targetMins)) {
            diff = 7;
          }
        }
      }

      const resolved = new Date(anchor);
      resolved.setDate(anchor.getDate() + diff);
      return formatLocalDate(resolved);
    }
  }

  // 4. Tomorrow / Today
  if (/\btomorrow\b/i.test(norm)) {
    const resolved = new Date(anchor);
    resolved.setDate(anchor.getDate() + 1);
    return formatLocalDate(resolved);
  }

  // 5. Default: Today (with past-time rollover if time already passed)
  if (parsedTime && !/\btoday\b/i.test(norm)) {
    const currentHours = anchor.getHours();
    const currentMins = anchor.getMinutes();
    const [targetHours, targetMins] = parsedTime.split(':').map(Number);

    if (currentHours > targetHours || (currentHours === targetHours && currentMins >= targetMins)) {
      const resolved = new Date(anchor);
      resolved.setDate(anchor.getDate() + 1);
      return formatLocalDate(resolved);
    }
  }

  return formatLocalDate(anchor);
};

const extractRecurrencePattern = (command: string): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' => {
  const norm = command.toLowerCase();
  if (/\b(every\s+day|daily)\b/.test(norm)) {
    return 'daily';
  }
  if (/\b(weekly|every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat))\b/.test(norm)) {
    return 'weekly';
  }
  if (/\b(monthly|every\s+month)\b/.test(norm)) {
    return 'monthly';
  }
  if (/\b(yearly|annually|every\s+year)\b/.test(norm)) {
    return 'yearly';
  }
  return 'none';
};

const parseTimeRange = (command: string): ParsedTimeRange | null => {
  const normalized = normalizeCommandText(command);
  const match = normalized.match(TIME_RANGE_PATTERN);
  if (!match) {
    return null;
  }

  const rawStart = match[1];
  const rawEnd = match[2];

  const endMeridiem = normalizeMeridiem(rawEnd);
  const explicitStartMeridiem = normalizeMeridiem(rawStart);

  let startTime = parseFlexibleTime(rawStart, explicitStartMeridiem ?? endMeridiem);
  const endTime = parseFlexibleTime(rawEnd, endMeridiem);

  if (!startTime || !endTime) {
    return null;
  }

  if (!explicitStartMeridiem && endMeridiem === 'pm') {
    const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
    const endMinutes = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5));
    if (startMinutes > endMinutes) {
      const amStart = parseFlexibleTime(rawStart, 'am');
      if (amStart) {
        startTime = amStart;
      }
    }
  }

  const startMinutes = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
  const endMinutes = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5));
  const durationMinutes =
    endMinutes > startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes;

  return {
    startTime,
    durationMinutes,
  };
};

const extractSingleTimeMatch = (command: string): string | null => {
  const normalized = normalizeCommandText(command);
  const timeRegex = /(?:\b(?:at|by|for)\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/gi;
  let timeMatch: RegExpExecArray | null = timeRegex.exec(normalized);

  if (!timeMatch) {
    const fallbackRegex = /\b(?:at|by|from)\s+(\d{1,2}(?::\d{2})?)\b|\b((?:[01]?\d|2[0-3]):[0-5]\d)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = fallbackRegex.exec(normalized)) !== null) {
      const candidate = parseFlexibleTime(m[1] ?? m[2]);
      if (candidate) {
        timeMatch = m;
        break;
      }
    }
  }

  let parsedTime: string | null = null;
  if (timeMatch) {
    parsedTime = parseFlexibleTime(timeMatch[1] ?? timeMatch[2]);
  }

  return parsedTime;
};

// --- Relative time resolution ("in 15 minutes", "half an hour from now") ---

const RELATIVE_QUANTITY = '(\\d+|an?|one|half|quarter)';
const RELATIVE_UNIT = '(seconds?|secs?|minutes?|mins?|hours?|hrs?)';

// "<quantity> <unit> from now|later" e.g. "15 minutes from now", "2 hours later"
const RELATIVE_FROM_NOW = new RegExp(
  `\\b${RELATIVE_QUANTITY}\\s+(?:an?\\s+)?${RELATIVE_UNIT}\\s+(?:from\\s+now|later)\\b`,
  'i',
);

// "in <quantity> <unit>" e.g. "in 15 minutes", "in half an hour"
const RELATIVE_IN_DURATION = new RegExp(
  `\\bin\\s+${RELATIVE_QUANTITY}\\s+(?:an?\\s+)?${RELATIVE_UNIT}\\b`,
  'i',
);

// Non-capturing phrase matcher for stripping relative times from task titles.
// Matches only anchored phrasings so "study for 2 hours" (a duration, not a
// relative deadline) is left untouched.
const RELATIVE_TIME_TEXT_PATTERN = new RegExp(
  `\\bin\\s+(?:\\d+|an?|one|half|quarter)\\s+(?:an?\\s+)?(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)\\b|\\b(?:\\d+|an?|one|half|quarter)\\s+(?:an?\\s+)?(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)\\s+(?:from\\s+now|later)\\b`,
  'gi',
);

const quantityToValue = (quantity: string): number => {
  const lower = quantity.toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  if (lower === 'half') return 0.5;
  if (lower === 'quarter') return 0.25;
  return 1; // a / an / one
};

const unitToMinutes = (unit: string): number => {
  const lower = unit.toLowerCase();
  if (lower.startsWith('sec')) return 1 / 60;
  if (lower.startsWith('min')) return 1;
  return 60; // hour(s)
};

const extractRelativeTimeMinutes = (normalized: string): number | null => {
  const match =
    normalized.match(RELATIVE_FROM_NOW) ?? normalized.match(RELATIVE_IN_DURATION);
  if (!match) return null;
  const offsetMinutes = quantityToValue(match[1]) * unitToMinutes(match[2]);
  // Sub-minute offsets (seconds) are rounded to the nearest whole minute.
  return Math.round(offsetMinutes);
};

/**
 * Resolves an anchored relative-time phrase to a concrete date + time.
 *
 * Supports "15 minutes from now", "in 15 minutes", "half an hour from now",
 * "2 hours later", "an hour from now", etc. Uses epoch-millis arithmetic so
 * the result stays correct across midnight rollovers and DST transitions
 * (naive wall-clock "+N hours" math drifts when the clock shifts).
 */
export const resolveRelativeTime = (
  command: string,
  referenceDate: Date,
): { date: string; time: string } | null => {
  const normalized = normalizeCommandText(command).toLowerCase();
  const offsetMinutes = extractRelativeTimeMinutes(normalized);
  if (offsetMinutes === null) return null;

  const target = new Date(referenceDate.getTime() + offsetMinutes * 60 * 1000);
  const hours = `${target.getHours()}`.padStart(2, '0');
  const minutes = `${target.getMinutes()}`.padStart(2, '0');
  return {
    date: formatLocalDate(target),
    time: `${hours}:${minutes}`,
  };
};

const cleanTaskTitle = (command: string): string => {
  let title = normalizeCommandText(command);

  // 1. Remove conversational intros & action keywords
  title = title
    .replace(/\b(um|uh|so|like|i\s+need\s+to|remember\s+to|need\s+to|have\s+to)\b/gi, '')
    .replace(/\b(schedule|set(?:\s+up)?|add|create|remind\s+me(?:\s+to)?|remind)\s*(a|an|the)?\b/gi, '')
    .replace(/\b(task|timeblock|time\s+block|block|event)\s*(a|an|the)?\b/gi, '');

  // 2. Remove date expressions
  const monthPattern =
    /\b(?:on\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?\b/gi;
  const mmddPattern = /\b(?:on\s+)?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi;
  const weekdayPattern =
    /\b(?:on|this|next)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/gi;
  const relativeDatePattern = /\b(today|tomorrow|starting\s+[^\s]+)\b/gi;

  title = title
    .replace(monthPattern, '')
    .replace(mmddPattern, '')
    .replace(weekdayPattern, '')
    .replace(relativeDatePattern, '');

  // 3. Remove time expressions
  const meridiemTimePattern = /(?:\b(?:at|by|from)\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi;
  const clockTimePattern = /(?:\b(?:at|by|from)\s+)?(?:[01]?\d|2[0-3]):[0-5]\d\b/gi;
  title = title
    .replace(TIME_RANGE_PATTERN, '')
    .replace(meridiemTimePattern, '')
    .replace(clockTimePattern, '')
    .replace(RELATIVE_TIME_TEXT_PATTERN, '');

  // 4. Remove recurrence phrases
  const recurrencePattern =
    /\b(every\s+(day|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat)|every|daily|weekly|monthly)\b/gi;
  title = title.replace(recurrencePattern, '');

  // 5. Remove only dangling prepositions so meaningful phrases such as
  // "study for calculus" remain intact.
  title = title
    .replace(/\bthe\b/gi, '')
    .replace(/^[\s,:-]*(?:(?:on|at|by|for|starting)\b[\s,:-]*)+/i, '')
    .replace(/(?:[\s,:-]*(?:on|at|by|for|starting)\b)+[\s,:-]*$/i, '');

  // 6. Strip punctuation & whitespace
  title = title.replace(/^[.\s,]+|[.\s,]+$/g, '').replace(/\s+/g, ' ').trim();

  const titleWords = title.match(/[a-z]+(?:['-][a-z]+)*/gi) ?? [];
  const hasUsefulTitle = titleWords.some(word => word.length >= 2);

  if (!hasUsefulTitle) {
    if (/\bmeeting\b/i.test(command)) title = 'meeting';
    else if (/\bclass\b/i.test(command)) title = 'class';
    else title = DEFAULT_SCHEDULE_TITLE;
  }

  return title;
};

/**
 * Creates an NLU-shaped result for typed chat messages and voice command parsing.
 *
 * @param command User input text command.
 * @param referenceDate Date used to resolve today/tomorrow in fallback parsing.
 * @returns An NLU result matching the SmolLM2 output schema.
 */
export const createFallbackNluResult = (
  command: string,
  referenceDate: Date = new Date()
): NluResult => {
  const trimmedCommand = command.trim();
  const lowercaseCommand = trimmedCommand.toLowerCase();

  const relativeTime = resolveRelativeTime(trimmedCommand, referenceDate);
  const singleTime = extractSingleTimeMatch(trimmedCommand);
  const date = relativeTime
    ? relativeTime.date
    : resolveCommandDate(trimmedCommand, referenceDate, singleTime);
  const range = parseTimeRange(trimmedCommand);
  const recurrence = extractRecurrencePattern(trimmedCommand);

  // 1. Greetings & Casual Chatbot Responses
  if (/^(hey|hi|hello|greetings|good morning|good afternoon|good evening|sup|howdy|what'?s up)\b/i.test(lowercaseCommand)) {
    return {
      intent: 'acknowledge',
      task: null,
      date: null,
      time: null,
      duration_minutes: null,
      status: 'success',
      reply: "Hey there! 👋 I'm LAFINA, your offline AI scheduling assistant. How can I help you organize your day?",
    };
  }

  if (/^(who are you|what can you do|help|how are you|what is lafina)\b/i.test(lowercaseCommand)) {
    return {
      intent: 'acknowledge',
      task: null,
      date: null,
      time: null,
      duration_minutes: null,
      status: 'success',
      reply: "I'm LAFINA, your voice-first offline AI academic scheduler! You can chat with me, ask me to add tasks, block study time, save notes, or check your schedule.",
    };
  }

  // 2. Time block with explicit range (e.g. "schedule a meeting for 10 - 12pm today", "block 2-4pm today")
  if (range !== null) {
    const title = cleanTaskTitle(trimmedCommand);
    return {
      intent: 'schedule',
      task: title,
      date,
      time: range.startTime,
      duration_minutes: range.durationMinutes,
      recurrence: recurrence !== 'none' ? recurrence : null,
      status: 'success',
      reply: `I blocked time for "${title}".`,
    };
  }

  // 3. Single-time scheduling commands (e.g. "schedule a meeting 10 p.m. today", "add task submit report by 5pm", "on July 8th schedule a meeting")
  const isExplicitScheduling =
    /\b(set|schedule|add|create|remind|block|meeting|class)\b/i.test(lowercaseCommand) ||
    lowercaseCommand.includes('time block') ||
    lowercaseCommand.includes('remind me') ||
    lowercaseCommand.includes('need to') ||
    singleTime !== null ||
    relativeTime !== null;

  if (isExplicitScheduling) {
    const title = cleanTaskTitle(trimmedCommand);
    return {
      intent: 'schedule',
      task: title,
      date,
      time: relativeTime ? relativeTime.time : singleTime,
      duration_minutes: null,
      recurrence: recurrence !== 'none' ? recurrence : null,
      status: 'success',
      reply: `Task "${title}" has been added to your schedule for ${date}.`,
    };
  }

  // 4. Conversational Chatbot Fallback for general text
  return {
    intent: 'out_of_scope',
    task: null,
    date: null,
    time: null,
    duration_minutes: null,
    status: 'rejected',
    reply: "I'm here to chat or help organize your schedule! To add an event, tell me explicitly like 'schedule a meeting 10 p.m. today' or 'schedule a meeting for 10 - 12pm today'.",
  };
};

const processNoteCommand = (command: string, userId: string): string | null => {
  if (!/^note:?(\s|$)/i.test(command)) {
    return null;
  }

  const noteBody = command.replace(/^note:?\s*/i, '').trim();
  notesStore.insert({
    id: generateId('note'),
    userId,
    title: DEFAULT_NOTE_TITLE,
    body: noteBody || 'Empty note contents.',
    isPinned: false,
    tags: ['AI Transcribed'],
    category: DEFAULT_NOTE_CATEGORY,
    isVoiceTranscribed: true,
  });

  return "I've captured that note for you.";
};

const processCompletionCommand = (command: string, userId: string): string | null => {
  if (!command.toLowerCase().startsWith('complete')) {
    return null;
  }

  const searchTitle = command.replace(/^complete\s*/i, '').trim().toLowerCase();
  const allTasks = tasksStore.getAllTasks(userId);
  const matchingTask = allTasks.find((task) => task.title.toLowerCase().includes(searchTitle));

  if (!matchingTask) {
    return `I couldn't find a task matching "${searchTitle}".`;
  }

  tasksStore.updateTask({
    id: matchingTask.id,
    isCompleted: true,
  });

  return `Marked "${matchingTask.title}" as completed.`;
};

/**
 * Parses typed command text, performs local schedule writes, and returns a spoken reply.
 *
 * @param command User input text command.
 * @param userId The active local user executing the command.
 * @returns Assistant reply text.
 */
export const processCommand = (command: string, userId: string): string => {
  const trimmedCommand = command.trim();
  if (trimmedCommand.length === 0) {
    return 'What would you like me to schedule?';
  }

  try {
    const noteReply = processNoteCommand(trimmedCommand, userId);
    if (noteReply !== null) {
      return noteReply;
    }

    const completionReply = processCompletionCommand(trimmedCommand, userId);
    if (completionReply !== null) {
      return completionReply;
    }

    const nluResult = createFallbackNluResult(trimmedCommand);
    return applyNluScheduleResult(nluResult, userId).reply;
  } catch (error) {
    console.error('Error processing command in NLU parser:', error);
    return 'Sorry, I encountered an error while processing that request.';
  }
};
