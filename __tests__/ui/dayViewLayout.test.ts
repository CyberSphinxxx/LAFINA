import {
  HOUR_HEIGHT,
  buildDayEntries,
  hourLabel,
  layoutIntervals,
  minutesToPixels,
  timeToMinutes,
} from '../../src/ui/screens/calendar/utils/timeGridLayout';
import { mixColors } from '../../src/ui/theme/colorMix';
import type { Event, Task, TimeBlock } from '../../src/storage';

const DAY = new Date(2026, 8, 23);

const block = (id: string, date: string, startTime: string, endTime: string): TimeBlock =>
  ({ id, title: id, date, startTime, endTime, color: '#E6003A', category: 'study' }) as TimeBlock;

const event = (id: string, date: string, startTime: string, endTime: string, location?: string): Event =>
  ({ id, title: id, date, startTime, endTime, location }) as Event;

const task = (id: string, dueTime: string | null): Task =>
  ({ id, title: id, dueDate: '2026-09-23', dueTime, isCompleted: false, category: 'study', priority: 'Low' }) as Task;

const entriesFor = (input: { blocks?: TimeBlock[]; events?: Event[]; tasks?: Task[] }) =>
  buildDayEntries({
    date: DAY,
    blocks: input.blocks ?? [],
    events: input.events ?? [],
    tasks: input.tasks ?? [],
    timeFormat24h: false,
    eventColor: '#E6003A',
    taskColor: () => '#3B82F6',
  });

describe('day view scale', () => {
  it('puts an item exactly on its hour lines', () => {
    // GYM 08:00–10:00 is two full hours tall and starts on the 8 AM line.
    expect(minutesToPixels(timeToMinutes('08:00'))).toBe(8 * HOUR_HEIGHT);
    expect(minutesToPixels(timeToMinutes('10:00') - timeToMinutes('08:00'))).toBe(2 * HOUR_HEIGHT);
    expect(minutesToPixels(timeToMinutes('10:30'))).toBe(10.5 * HOUR_HEIGHT);
  });

  it('labels hours as the desktop does', () => {
    expect(hourLabel(0, false)).toBe('12 AM');
    expect(hourLabel(13, false)).toBe('1 PM');
    expect(hourLabel(24, false)).toBe('12 AM');
    expect(hourLabel(7, true)).toBe('07:00');
  });

  it('reads the times of every kind of item', () => {
    const entries = entriesFor({
      events: [event('gym', '2026-09-23', '08:00', '10:00', 'Gym hall')],
      blocks: [block('study', '2026-09-23', '10:00', '11:00')],
      tasks: [task('essay', '14:15'), task('all-day', null)],
    });
    expect(entries.map((e) => [e.kind, e.start, e.end])).toEqual([
      ['event', 480, 600],
      ['block', 600, 660],
      ['task', 855, 885],
    ]);
    expect(entries[0]).toMatchObject({ time: '08:00 AM – 10:00 AM', location: 'Gym hall' });
    expect(entries[2].time).toBe('Due 02:15 PM');
  });

  it('cuts an overnight item at midnight and shows its tail the next day', () => {
    const late = [block('late', '2026-09-22', '23:00', '01:30')];
    expect(entriesFor({ blocks: late }).map((e) => [e.start, e.end])).toEqual([[0, 90]]);
    const tonight = [block('tonight', '2026-09-23', '23:00', '01:30')];
    expect(entriesFor({ blocks: tonight }).map((e) => [e.start, e.end])).toEqual([[1380, 1440]]);
  });

  it('ignores items on other days and unreadable times', () => {
    expect(
      entriesFor({
        blocks: [block('other', '2026-09-25', '09:00', '10:00'), block('bad', '2026-09-23', 'soon', '10:00')],
      }),
    ).toEqual([]);
  });
});

describe('overlapping items', () => {
  it('sits overlapping items side by side and lets touching ones share the full width', () => {
    const laid = layoutIntervals([
      { id: 'a', start: 480, end: 600 },
      { id: 'b', start: 540, end: 660 },
      { id: 'c', start: 660, end: 720 },
    ]);
    const byId = Object.fromEntries(laid.map((item) => [item.id, item]));
    expect(byId.a).toMatchObject({ column: 0, columns: 2 });
    expect(byId.b).toMatchObject({ column: 1, columns: 2 });
    expect(byId.c).toMatchObject({ column: 0, columns: 1 });
  });
});

describe('item tint', () => {
  it('mixes like CSS color-mix in srgb', () => {
    expect(mixColors('#E6003A', '#FFFFFF', 0.14)).toBe('#fcdbe3');
    expect(mixColors('#E6003A', '#1C1C1E', 0.25)).toBe('#4f1525');
    expect(mixColors('#fff', '#000000', 0.5)).toBe('#808080');
  });

  it('falls back to the base colour for anything it cannot read', () => {
    expect(mixColors('crimson', '#1C1C1E', 0.25)).toBe('#1C1C1E');
  });
});
