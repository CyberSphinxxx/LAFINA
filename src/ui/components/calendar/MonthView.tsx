import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Fonts, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { TimeBlock } from '../../../storage/timeBlocksStore';
import { Task, Event } from '../../../storage/tasksStore';

interface MonthViewProps {
  currentDate: Date;
  blocks: TimeBlock[];
  allTasks: Task[];
  allEvents: Event[];
  weekStartsMonday: boolean;
  onDayTap: (dayNum: number) => void;
}

const getCategoryColor = (cat: string) => {
  switch (cat?.toLowerCase()) {
    case 'work': return Colors.blue;
    case 'personal': return Colors.yellow;
    case 'health': return Colors.success;
    case 'learning': return '#9B59B6';
    default: return '#9E9E9E';
  }
};

export const MonthView: React.FC<MonthViewProps> = ({
  currentDate,
  blocks,
  allTasks,
  allEvents,
  weekStartsMonday,
  onDayTap,
}) => {
  const themed = useThemedStyles(getThemedStyles);

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const rawDay = new Date(year, month, 1).getDay(); // 0=Sunday
    const firstDayIndex = weekStartsMonday ? (rawDay + 6) % 7 : rawDay;
    const totalDays = new Date(year, month + 1, 0).getDate();
    return { firstDayIndex, totalDays };
  };

  const { firstDayIndex, totalDays } = getDaysInMonth(currentDate);
  const cells: React.ReactNode[] = [];

  // Empty cells for offset
  for (let i = 0; i < firstDayIndex; i++) {
    cells.push(<View key={`empty-${i}`} style={styles.calendarCellEmpty} />);
  }

  // Days cells
  const today = new Date();
  const isCurrentMonth = today.getMonth() === currentDate.getMonth() && today.getFullYear() === currentDate.getFullYear();

  for (let day = 1; day <= totalDays; day++) {
    const isToday = isCurrentMonth && today.getDate() === day;
    const cellDateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Get all blocks, tasks, events for this day
    const cellBlocks = blocks.filter((b) => b.date === cellDateStr);
    const cellTasks = allTasks.filter((t) => t.dueDate === cellDateStr);
    const cellEvents = allEvents.filter((e) => e.date === cellDateStr);

    const combined: { title: string; time: string; color: string }[] = [];

    cellBlocks.forEach((b) => {
      combined.push({
        title: b.title,
        time: b.startTime,
        color: b.color,
      });
    });

    cellTasks.forEach((t) => {
      combined.push({
        title: t.title,
        time: t.dueTime || '00:00',
        color: getCategoryColor(t.category),
      });
    });

    cellEvents.forEach((e) => {
      combined.push({
        title: e.title,
        time: e.startTime,
        color: Colors.blue,
      });
    });

    // Sort by time
    combined.sort((a, b) => a.time.localeCompare(b.time));

    const displayItems = combined.slice(0, 3);
    const remainingCount = combined.length - 3;

    cells.push(
      <TouchableOpacity
        key={`day-${day}`}
        style={[styles.calendarCell, themed.calendarCell]}
        onPress={() => onDayTap(day)}
      >
        <View style={[styles.dayContainer, themed.dayContainer, isToday && styles.todayContainer]}>
          <Text style={[styles.dayText, themed.dayText, isToday && styles.todayText]}>
            {day}
          </Text>
        </View>
        <View style={styles.monthItemsWrapper}>
          {displayItems.map((item, idx) => (
            <View key={idx} style={[styles.monthItemPreview, themed.monthItemPreview, { borderLeftColor: item.color }]}>
              <Text style={[styles.monthItemText, themed.monthItemText]} numberOfLines={1}>
                {item.title}
              </Text>
            </View>
          ))}
          {remainingCount > 0 && (
            <Text style={[styles.monthItemMore, themed.monthItemMore]}>
              +{remainingCount} more
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  const weekdayLabels = weekStartsMonday
    ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <View style={[styles.monthGridContainer, themed.monthGridContainer]}>
      {/* Weekday headers */}
      <View style={[styles.weekdayHeaderRow, themed.weekdayHeaderRow]}>
        {weekdayLabels.map((wd, i) => (
          <Text key={i} style={[styles.weekdayLabel, themed.weekdayLabel]}>
            {wd}
          </Text>
        ))}
      </View>
      <View style={styles.monthCellsGrid}>{cells}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  monthGridContainer: {
    flex: 1,
  },
  weekdayHeaderRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontWeight: 'bold',
    fontSize: 12,
  },
  monthCellsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: '14.28%',
    minHeight: 85,
    padding: 2,
    borderWidth: 0.5,
    borderColor: '#E0E0E0',
    alignItems: 'stretch',
  },
  calendarCellEmpty: {
    width: '14.28%',
    minHeight: 85,
    borderWidth: 0.5,
    borderColor: 'transparent',
  },
  dayContainer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 2,
  },
  todayContainer: {
    backgroundColor: Colors.red,
  },
  dayText: {
    fontFamily: Fonts.body,
    fontSize: 11,
  },
  todayText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  monthItemsWrapper: {
    flex: 1,
    width: '100%',
  },
  monthItemPreview: {
    borderLeftWidth: 2,
    paddingLeft: 3,
    marginVertical: 1,
    marginHorizontal: 1,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  monthItemText: {
    fontSize: 8,
    fontFamily: Fonts.body,
    lineHeight: 10,
  },
  monthItemMore: {
    fontSize: 8,
    fontFamily: Fonts.body,
    color: Colors.red,
    textAlign: 'center',
    marginTop: 1,
  },
});

const getThemedStyles = (colors: ThemeColors) => ({
  monthGridContainer: {
    backgroundColor: colors.background,
  },
  weekdayHeaderRow: {
    borderBottomColor: colors.border,
  },
  weekdayLabel: {
    color: colors.textSecondary,
  },
  calendarCell: {
    borderColor: colors.border,
  },
  dayContainer: {
    backgroundColor: 'transparent',
  },
  dayText: {
    color: colors.textPrimary,
  },
  monthItemPreview: {
    backgroundColor: colors.inputBg,
  },
  monthItemText: {
    color: colors.textPrimary,
  },
  monthItemMore: {
    color: colors.red,
  },
});
