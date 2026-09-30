import { ViewMode } from '../types';

/** Convert an "HH:MM" string into a Date object (today, at that time). */
export const timeStringToDate = (timeStr: string): Date => {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(isNaN(h) ? 0 : h, isNaN(m) ? 0 : m, 0, 0);
  return d;
};

/** Format a Date object back to "HH:MM" (24-hour). */
export const dateToTimeString = (d: Date): string => {
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};

/** Format a "HH:MM" 24-hour string for display based on format setting. */
export const formatTimeForDisplay = (timeStr: string, is24Hour: boolean): string => {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return timeStr;

  if (is24Hour) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  } else {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    const displayMin = m.toString().padStart(2, '0');
    return `${displayHour.toString().padStart(2, '0')}:${displayMin} ${ampm}`;
  }
};

/** Get header title for the calendar based on view mode and selected date. */
export const getHeaderTitle = (
  viewMode: ViewMode,
  selectedDate: Date,
  currentDate: Date,
  weekDays: Date[],
): string => {
  if (viewMode === 'week') {
    if (weekDays.length === 0) return '';
    const start = weekDays[0];
    const end = weekDays[weekDays.length - 1];
    if (start.getFullYear() !== end.getFullYear()) {
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${start.getFullYear()}`;
  }
  return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

/** Get days in month with the index of the first day. */
export const getDaysInMonth = (date: Date, weekStartsMonday: boolean) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const rawDay = new Date(year, month, 1).getDay(); // 0=Sunday
  const firstDayIndex = weekStartsMonday ? (rawDay + 6) % 7 : rawDay;
  const totalDays = new Date(year, month + 1, 0).getDate();
  return { firstDayIndex, totalDays };
};
