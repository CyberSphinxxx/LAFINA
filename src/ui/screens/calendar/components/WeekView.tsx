import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import { Colors } from '../../../theme';
import type { TimeBlock, Task, Event } from '../../../../storage';
import { useCalendarData } from '../hooks/useCalendarData';
import { DayView } from './DayView';
import { HOLIDAY_CALENDAR_ID } from '../utils/philippineHolidays';

interface WeekViewProps {
  calendar: ReturnType<typeof useCalendarData>;
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  weekDays: Date[];
  timeFormat24h: boolean;
  onEditTask: (task: Task, type: 'task') => void;
  onEditEvent: (event: Event, type: 'event') => void;
  onEditBlock: (block: TimeBlock) => void;
  onToggleTask: (task: Task) => void;
  onAddBlock: () => void;
  getCategoryColor: (category: string) => string;
}

/**
 * The week strip with the chosen day's timeline under it. Week and Day used
 * to be separate views; picking a day in the strip now shows it to scale right
 * here, one tap instead of a trip through the view switcher.
 */
export const WeekView: React.FC<WeekViewProps> = ({
  calendar,
  selectedDate,
  setSelectedDate,
  weekDays,
  timeFormat24h,
  onEditTask,
  onEditEvent,
  onEditBlock,
  onToggleTask,
  onAddBlock,
  getCategoryColor,
}) => {
  const { colors, isDarkMode } = useTheme();
  const overdueList = calendar.getOverdueTasks();

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      {/* Date Pill Scroller */}
      <View style={styles.scrollerContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekScroller}>
          {weekDays.map((day, i) => {
            const isSelected = day.toDateString() === selectedDate.toDateString();
            const isToday = day.toDateString() === new Date().toDateString();
            return (
              <View
                key={i}
                style={[
                  styles.datePill,
                  isSelected && { elevation: 6 },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.pillTouchTarget,
                    isSelected
                      ? [styles.pillSelected, { backgroundColor: colors.cardBg }]
                      : [styles.pillUnselected, { borderColor: colors.border }],
                    isToday && !isSelected && { borderColor: colors.red, borderWidth: 1.5 },
                  ]}
                  onPress={() => setSelectedDate(day)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.pillDayName,
                    { color: colors.textSecondary },
                    isSelected && { color: colors.textPrimary },
                  ]}>
                    {day.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3)}
                  </Text>
                  <Text style={[
                    styles.pillDayNum,
                    { color: colors.textSecondary },
                    isSelected && { color: colors.textPrimary },
                    isToday && !isSelected && { color: colors.red },
                  ]}>
                    {day.getDate()}
                  </Text>
                  {isSelected && (
                    <View style={styles.selectedPillUnderline} />
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* Overdue Section */}
      {overdueList.length > 0 && (
        <View style={[styles.overdueBanner, { backgroundColor: colors.bannerBg }]}>
          <View style={[styles.overdueBadge, { backgroundColor: Colors.error }]}>
            <Text style={[styles.overdueBadgeText, { color: colors.white }]}>OVERDUE</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.overdueScroll}>
            {overdueList.map((ot) => (
              <TouchableOpacity
                key={ot.id}
                style={[styles.overdueChip, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.7)' }]}
                onPress={() => onEditTask(ot, 'task')}
              >
                <Text style={[{ color: colors.textPrimary }, styles.overdueChipText]} numberOfLines={1}>
                  {ot.title}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* The selected day, to scale */}
      <DayView
        targetDate={selectedDate}
        blocks={calendar.blocks}
        allTasks={calendar.allTasks}
        allEvents={calendar.allEvents}
        timeFormat24h={timeFormat24h}
        onEditTask={onEditTask}
        onEditEvent={onEditEvent}
        onEditBlock={onEditBlock}
        onToggleTask={onToggleTask}
        onAddBlock={onAddBlock}
        getCategoryColor={getCategoryColor}
        showHolidays={calendar.visibilityMap[HOLIDAY_CALENDAR_ID] !== false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollerContainer: { marginBottom: 12 },
  weekScroller: { paddingVertical: 4 },
  datePill: { width: 56, height: 74, borderRadius: 16, marginRight: 8 },
  pillTouchTarget: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
  },
  pillSelected: {
    borderWidth: 0,
  },
  pillUnselected: {
    backgroundColor: 'transparent',
  },
  pillDayName: { fontSize: 12, fontFamily: 'sans-serif', fontWeight: 'normal' },
  pillDayNum: { fontSize: 28, fontFamily: 'sans-serif', fontWeight: 'bold', marginTop: 2 },
  selectedPillUnderline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    borderWidth: 5,
    borderColor: 'transparent',
    borderBottomColor: Colors.blue,
  },
  overdueBanner: { borderRadius: 12, padding: 8, flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  overdueBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 8 },
  overdueBadgeText: { fontSize: 10, fontWeight: 'bold' },
  overdueScroll: { flex: 1 },
  overdueChip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, maxWidth: 120 },
  overdueChipText: { fontSize: 11 },
});
