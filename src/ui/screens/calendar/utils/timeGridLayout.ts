/**
 * Minute-accurate placement for the day view, ported from the desktop app's
 * `timeGridLayout.ts`. One scale drives the hour lines, the hour labels, every
 * item's top and height, and the current-time line, so they always line up.
 */

import type { Event, Task, TimeBlock } from '../../../../storage';
import { formatTimeForDisplay } from './calendarHelpers';

/** Height of one hour, in dp. The desktop uses the same 64. */
export const HOUR_HEIGHT = 64;
export const MINUTES_PER_DAY = 1440;
/** A timed task has no end; it gets this much room, enough to tap on a phone. */
export const TASK_SLOT_MINUTES = 30;
/** Items shorter than this show their title only, on one line. */
export const SHORT_ENTRY_MINUTES = 40;

export const minutesToPixels = (minutes: number): number => (minutes * HOUR_HEIGHT) / 60;

/** "HH:MM" to minutes after midnight; NaN for anything else. */
export const timeToMinutes = (time: string): number => {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
};

export const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const hourLabel = (hour: number, timeFormat24h: boolean): string =>
  timeFormat24h
    ? `${String(hour % 24).padStart(2, '0')}:00`
    : `${hour % 12 || 12} ${hour >= 12 && hour < 24 ? 'PM' : 'AM'}`;

export interface TimedInterval {
  id: string;
  start: number;
  end: number;
}

/** Packs overlapping intervals into side-by-side columns; touching endpoints do not overlap. */
export function layoutIntervals<T extends TimedInterval>(items: T[]): (T & { column: number; columns: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  const result: (T & { column: number; columns: number })[] = [];
  let group: (T & { column: number; columns: number })[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const flush = (): void => {
    group.forEach((item) => {
      item.columns = ends.length;
      result.push(item);
    });
    group = [];
    ends = [];
    groupEnd = -1;
  };
  for (const item of sorted) {
    if (item.start >= groupEnd) flush();
    let column = ends.findIndex((end) => end <= item.start);
    if (column < 0) column = ends.length;
    ends[column] = item.end;
    group.push({ ...item, column, columns: 1 });
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return result;
}

export interface DayEntry extends TimedInterval {
  kind: 'block' | 'event' | 'task';
  title: string;
  color: string;
  /** "08:00 AM – 10:00 AM", or "Due 10:00 AM" for a task. */
  time: string;
  location?: string | null;
  block?: TimeBlock;
  event?: Event;
  task?: Task;
}

interface DayEntryInput {
  date: Date;
  blocks: TimeBlock[];
  events: Event[];
  tasks: Task[];
  timeFormat24h: boolean;
  /** Events carry no colour of their own; they take the brand colour, as on the desktop. */
  eventColor: string;
  taskColor: (task: Task) => string;
}

/**
 * Everything timed on one day, in minutes. An item that runs past midnight is
 * cut at the end of its day, and its tail shows at the top of the next day.
 */
export const buildDayEntries = ({
  date,
  blocks,
  events,
  tasks,
  timeFormat24h,
  eventColor,
  taskColor,
}: DayEntryInput): DayEntry[] => {
  const day = formatLocalDate(date);
  const before = new Date(date);
  before.setDate(date.getDate() - 1);
  const previousDay = formatLocalDate(before);
  const range = (start: string, end: string): string =>
    `${formatTimeForDisplay(start, timeFormat24h)} – ${formatTimeForDisplay(end, timeFormat24h)}`;

  const entries: DayEntry[] = [];
  const add = (entry: Omit<DayEntry, 'start' | 'end'>, itemDate: string, startTime: string, endTime: string): void => {
    const start = timeToMinutes(startTime);
    let end = timeToMinutes(endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end <= start) end += MINUTES_PER_DAY;
    const offset = itemDate === day ? 0 : itemDate === previousDay ? -MINUTES_PER_DAY : null;
    if (offset === null) return;
    const from = Math.max(0, start + offset);
    const to = Math.min(MINUTES_PER_DAY, end + offset);
    if (to > from) entries.push({ ...entry, start: from, end: to });
  };

  events.forEach((event) =>
    add(
      {
        id: `event:${event.id}:${event.date}`,
        kind: 'event',
        title: event.title,
        color: eventColor,
        time: range(event.startTime, event.endTime),
        location: event.location,
        event,
      },
      event.date,
      event.startTime,
      event.endTime,
    ),
  );
  blocks.forEach((block) =>
    add(
      {
        id: `block:${block.id}:${block.date}`,
        kind: 'block',
        title: block.title,
        color: block.color,
        time: range(block.startTime, block.endTime),
        block,
      },
      block.date,
      block.startTime,
      block.endTime,
    ),
  );
  tasks
    .filter((task) => task.dueDate === day && task.dueTime)
    .forEach((task) => {
      const start = timeToMinutes(task.dueTime!);
      if (!Number.isFinite(start)) return;
      entries.push({
        id: `task:${task.id}`,
        kind: 'task',
        title: task.title,
        start,
        end: Math.min(MINUTES_PER_DAY, start + TASK_SLOT_MINUTES),
        color: taskColor(task),
        time: `Due ${formatTimeForDisplay(task.dueTime!, timeFormat24h)}`,
        task,
      });
    });
  return entries;
};
