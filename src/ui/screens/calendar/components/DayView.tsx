import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import type { ThemeColors } from '../../../contexts/ThemeContext';
import { Fonts } from '../../../theme';
import { mixColors } from '../../../theme/colorMix';
import {
  HOUR_HEIGHT,
  SHORT_ENTRY_MINUTES,
  buildDayEntries,
  formatLocalDate,
  hourLabel,
  layoutIntervals,
  minutesToPixels,
} from '../utils/timeGridLayout';
import type { DayEntry } from '../utils/timeGridLayout';
import { describeHoliday, getHolidaysOn } from '../utils/philippineHolidays';
import type { Holiday } from '../utils/philippineHolidays';
import type { TimeBlock, Task, Event } from '../../../../storage';

interface DayViewProps {
  targetDate: Date;
  blocks: TimeBlock[];
  allTasks: Task[];
  allEvents: Event[];
  timeFormat24h: boolean;
  onEditTask: (task: Task, type: 'task') => void;
  onEditEvent: (event: Event, type: 'event') => void;
  onEditBlock: (block: TimeBlock) => void;
  onToggleTask: (task: Task) => void;
  onAddBlock: () => void;
  getCategoryColor: (cat: string) => string;
  /** The built-in "Holidays in the Philippines" layer, on unless hidden in My Calendars. */
  showHolidays?: boolean;
}

/** Room above midnight and below the next midnight, so their labels are not cut in half. */
const GRID_PADDING = 10;
const AXIS_WIDTH = 56;
const LABEL_HEIGHT = 14;
const GRID_HEIGHT = 24 * HOUR_HEIGHT;
/** Where the day opens, as on the desktop: most days have nothing before 7 AM. */
const INITIAL_SCROLL_HOUR = 7;

/** Item tint over the card colour, as on the desktop (`color-mix` 14% light, 25% dark). */
const tintFor = (color: string, colors: ThemeColors, isDarkMode: boolean): string =>
  mixColors(color, colors.cardBg, isDarkMode ? 0.25 : 0.14);

/**
 * The day, drawn to scale like the desktop calendar: one hour is always
 * HOUR_HEIGHT tall, so every item starts and ends exactly on its time, and
 * items that overlap sit side by side.
 */
export const DayView: React.FC<DayViewProps> = ({
  targetDate,
  blocks,
  allTasks,
  allEvents,
  timeFormat24h,
  onEditTask,
  onEditEvent,
  onEditBlock,
  onToggleTask,
  onAddBlock,
  getCategoryColor,
  showHolidays = true,
}) => {
  const { colors, isDarkMode } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const dateStr = formatLocalDate(targetDate);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Open each day at the start of a normal day rather than at midnight.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y: minutesToPixels(INITIAL_SCROLL_HOUR * 60), animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [dateStr]);

  const isToday = dateStr === formatLocalDate(now);
  const allDayTasks = allTasks.filter((task) => task.dueDate === dateStr && !task.dueTime);
  const holidays = showHolidays ? getHolidaysOn(dateStr) : [];

  const entries = useMemo(
    () =>
      layoutIntervals(
        buildDayEntries({
          date: targetDate,
          blocks,
          events: allEvents,
          tasks: allTasks,
          timeFormat24h,
          eventColor: colors.blue,
          taskColor: (task) => getCategoryColor(task.category),
        }),
      ),
    [targetDate, blocks, allEvents, allTasks, timeFormat24h, colors.blue, getCategoryColor],
  );

  const openEntry = (entry: DayEntry): void => {
    if (entry.block) onEditBlock(entry.block);
    else if (entry.event) onEditEvent(entry.event, 'event');
    else if (entry.task) onEditTask(entry.task, 'task');
  };

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <ScrollView ref={scrollRef} style={styles.container} testID="day-view">
      {(holidays.length > 0 || allDayTasks.length > 0) && (
        <View style={[styles.allDay, { borderBottomColor: colors.border }]}>
          <Text style={[styles.allDayLabel, { color: colors.textSecondary }]}>All-day</Text>
          <View style={styles.allDayList}>
            {holidays.map((holiday) => (
              <HolidayChip key={holiday.name} holiday={holiday} colors={colors} isDarkMode={isDarkMode} />
            ))}
            {allDayTasks.map((task) => {
              const color = getCategoryColor(task.category);
              return (
                <View
                  key={task.id}
                  style={[
                    styles.allDayTask,
                    { borderLeftColor: color, backgroundColor: tintFor(color, colors, isDarkMode) },
                  ]}
                >
                  <TaskCheckbox task={task} colors={colors} onToggle={onToggleTask} compact />
                  <TouchableOpacity style={styles.allDayTitleButton} onPress={() => onEditTask(task, 'task')}>
                    <Text
                      style={[styles.entryTitle, { color: colors.textPrimary }, task.isCompleted && styles.done]}
                      numberOfLines={1}
                    >
                      {task.title}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
      )}

      <View style={[styles.grid, { height: GRID_HEIGHT + GRID_PADDING * 2 }]}>
        {/* Hour labels, each centred on its hour line */}
        <View style={styles.axis} pointerEvents="none">
          {Array.from({ length: 25 }, (_, hour) => (
            <Text
              key={hour}
              style={[
                styles.hourLabel,
                { color: colors.textSecondary, top: GRID_PADDING + hour * HOUR_HEIGHT - LABEL_HEIGHT / 2 },
              ]}
            >
              {hourLabel(hour, timeFormat24h)}
            </Text>
          ))}
        </View>

        <View
          style={[
            styles.column,
            { borderLeftColor: colors.border, borderBottomColor: colors.border },
            isToday && { backgroundColor: mixColors(colors.red, colors.background, 0.03) },
          ]}
        >
          {/* Hour lines, with an empty slot under each hour for adding a block */}
          {Array.from({ length: 24 }, (_, hour) => (
            <TouchableOpacity
              key={hour}
              style={[styles.slot, { top: hour * HOUR_HEIGHT, borderTopColor: colors.border }]}
              onPress={onAddBlock}
              accessibilityRole="button"
              accessibilityLabel={`Add a time block at ${hourLabel(hour, timeFormat24h)}`}
            />
          ))}

          {entries.map((entry) => {
            const short = entry.end - entry.start < SHORT_ENTRY_MINUTES;
            return (
              <View
                key={entry.id}
                style={[
                  styles.entryFrame,
                  {
                    top: minutesToPixels(entry.start),
                    height: minutesToPixels(entry.end - entry.start),
                    left: `${(entry.column / entry.columns) * 100}%`,
                    width: `${100 / entry.columns}%`,
                  },
                ]}
              >
                <View
                  style={[
                    styles.entry,
                    { borderLeftColor: entry.color, backgroundColor: tintFor(entry.color, colors, isDarkMode) },
                  ]}
                >
                  {entry.task && (
                    <TaskCheckbox task={entry.task} colors={colors} onToggle={onToggleTask} compact={short} />
                  )}
                  <TouchableOpacity
                    style={[styles.entryBody, short && styles.entryBodyShort]}
                    onPress={() => openEntry(entry)}
                    accessibilityRole="button"
                    accessibilityLabel={`${entry.title}, ${entry.time}`}
                  >
                    <Text
                      style={[
                        styles.entryTitle,
                        { color: colors.textPrimary },
                        entry.task?.isCompleted && styles.done,
                      ]}
                      numberOfLines={short ? 1 : undefined}
                    >
                      {entry.title}
                    </Text>
                    {!short && <Text style={[styles.entryDetail, { color: colors.textSecondary }]}>{entry.time}</Text>}
                    {!short && entry.location ? (
                      <Text style={[styles.entryDetail, { color: colors.textSecondary }]}>{entry.location}</Text>
                    ) : null}
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {isToday && (
            <View
              pointerEvents="none"
              style={[styles.nowLine, { top: minutesToPixels(nowMinutes) - 1, backgroundColor: colors.red }]}
              testID="day-view-now"
            >
              <View style={[styles.nowDot, { backgroundColor: colors.red }]} />
            </View>
          )}
        </View>
      </View>
      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
};

/**
 * A holiday in the all-day row, as on the desktop: solid green, or a dashed
 * outline while the date is only an estimate. Tapping it says what kind of
 * holiday it is.
 */
const HolidayChip: React.FC<{ holiday: Holiday; colors: ThemeColors; isDarkMode: boolean }> = ({
  holiday,
  colors,
  isDarkMode,
}) => {
  const [name, ...rest] = describeHoliday(holiday).split('\n');
  return (
    <TouchableOpacity
      style={[
        styles.holiday,
        holiday.tentative
          ? {
              backgroundColor: mixColors(colors.holiday, colors.cardBg, isDarkMode ? 0.28 : 0.14),
              borderColor: colors.holiday,
            }
          : { backgroundColor: colors.holiday, borderColor: colors.holiday },
        holiday.tentative && styles.holidayTentative,
      ]}
      onPress={() => Alert.alert(name, rest.join('\n'))}
      accessibilityRole="button"
      accessibilityLabel={describeHoliday(holiday).replace('\n', ', ')}
      testID="holiday-chip"
    >
      <Text style={[styles.holidayText, { color: holiday.tentative ? colors.textPrimary : colors.white }]}>
        {holiday.name}
      </Text>
    </TouchableOpacity>
  );
};

const TaskCheckbox: React.FC<{
  task: Task;
  colors: ThemeColors;
  onToggle: (task: Task) => void;
  compact?: boolean;
}> = ({ task, colors, onToggle, compact = false }) => (
  <TouchableOpacity
    onPress={() => onToggle(task)}
    style={[styles.checkboxHit, compact && styles.checkboxHitCompact]}
    accessibilityRole="checkbox"
    accessibilityState={{ checked: task.isCompleted }}
    accessibilityLabel={`Complete ${task.title}`}
  >
    <View
      style={[
        styles.checkbox,
        { borderColor: colors.textSecondary },
        task.isCompleted && { backgroundColor: colors.success, borderColor: colors.success },
      ]}
    >
      {task.isCompleted && <Check size={10} color={colors.white} strokeWidth={3} />}
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  grid: {
    flexDirection: 'row',
  },
  axis: {
    width: AXIS_WIDTH,
    position: 'relative',
  },
  hourLabel: {
    position: 'absolute',
    right: 8,
    height: LABEL_HEIGHT,
    lineHeight: LABEL_HEIGHT,
    fontSize: 10,
    fontFamily: Fonts.body,
  },
  column: {
    flex: 1,
    position: 'relative',
    marginTop: GRID_PADDING,
    height: GRID_HEIGHT,
    marginRight: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  slot: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: HOUR_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  entryFrame: {
    position: 'absolute',
    paddingHorizontal: 3,
    zIndex: 2,
  },
  entry: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    overflow: 'hidden',
    borderRadius: 7,
    borderLeftWidth: 3,
  },
  entryBody: {
    flex: 1,
    alignSelf: 'stretch',
    paddingHorizontal: 8,
    paddingVertical: 7,
    gap: 3,
  },
  entryBodyShort: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    gap: 0,
    justifyContent: 'center',
  },
  entryTitle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 'bold',
  },
  entryDetail: {
    fontFamily: Fonts.body,
    fontSize: 10,
    lineHeight: 14,
  },
  done: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  checkboxHit: {
    paddingLeft: 7,
    paddingTop: 8,
    paddingRight: 1,
  },
  checkboxHitCompact: {
    paddingTop: 0,
    alignSelf: 'center',
  },
  checkbox: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    zIndex: 5,
  },
  nowDot: {
    position: 'absolute',
    left: -4,
    top: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  allDay: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  allDayLabel: {
    width: AXIS_WIDTH,
    paddingRight: 8,
    paddingTop: 6,
    textAlign: 'right',
    fontSize: 10,
    fontFamily: Fonts.body,
  },
  allDayList: {
    flex: 1,
    gap: 4,
  },
  allDayTask: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 7,
    borderLeftWidth: 3,
    minHeight: 28,
  },
  holiday: {
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  holidayTentative: {
    borderStyle: 'dashed',
  },
  holidayText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  allDayTitleButton: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  bottomSpacer: { height: 100 },
});
