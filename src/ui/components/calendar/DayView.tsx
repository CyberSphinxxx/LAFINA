import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Colors, Fonts, Shadows, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { Task, Event } from '../../../storage/tasksStore';
import { TimeBlock } from '../../../storage/timeBlocksStore';
import { Check, Users } from 'lucide-react-native';

interface DayViewProps {
  targetDate: Date;
  blocks: TimeBlock[];
  allTasks: Task[];
  allEvents: Event[];
  timeFormat24h: boolean;
  onToggleTaskCompletion: (task: Task) => void;
  onEditScheduleItem: (item: Task | Event, type: 'task' | 'event') => void;
  onEditBlock: (block: TimeBlock) => void;
  onAddBlock: () => void;
}

const formatTimeForDisplay = (timeStr: string, is24Hour: boolean): string => {
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

const getCategoryColor = (cat: string) => {
  switch (cat?.toLowerCase()) {
    case 'work': return Colors.blue;
    case 'personal': return Colors.yellow;
    case 'health': return Colors.success;
    case 'learning': return '#9B59B6';
    default: return '#9E9E9E';
  }
};

export const DayView: React.FC<DayViewProps> = ({
  targetDate,
  blocks,
  allTasks,
  allEvents,
  timeFormat24h,
  onToggleTaskCompletion,
  onEditScheduleItem,
  onEditBlock,
  onAddBlock,
}) => {
  const themed = useThemedStyles(getThemedStyles);

  const dateStr = targetDate.toISOString().split('T')[0];
  const dayBlocks = blocks.filter((b) => b.date === dateStr);
  const dayTasks = allTasks.filter((t) => t.dueDate === dateStr);
  const dayEvents = allEvents.filter((e) => e.date === dateStr);

  const allDayTasks = dayTasks.filter((t) => !t.dueTime);
  const timedTasks = dayTasks.filter((t) => t.dueTime);

  const hours = Array.from({ length: 24 }).map((_, i) => i);

  return (
    <ScrollView style={[styles.hourlyContainer, themed.hourlyContainer]}>
      {allDayTasks.length > 0 && (
        <View style={[styles.allDayContainer, themed.allDayContainer]}>
          <Text style={[styles.allDayTitle, themed.allDayTitle]}>All Day Tasks</Text>
          {allDayTasks.map((t) => (
            <View key={t.id} style={[styles.card, themed.card, Shadows.card]}>
              <View style={[styles.categoryBar, { backgroundColor: getCategoryColor(t.category) }]} />
              <TouchableOpacity
                style={styles.checkboxContainer}
                onPress={() => onToggleTaskCompletion(t)}
              >
                <View style={[styles.checkbox, themed.checkbox, t.isCompleted && styles.checkboxChecked, t.isCompleted && themed.checkboxChecked]}>
                  {t.isCompleted && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cardContent}
                onPress={() => onEditScheduleItem(t, 'task')}
              >
                <Text style={[styles.cardTitle, themed.cardTitle, t.isCompleted && styles.cardTitleCompleted]}>
                  {t.title}
                </Text>
                <Text style={[styles.cardTime, themed.cardTime]}>
                  All Day • {t.priority} Priority
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {hours.map((hour) => {
        const hourStr = String(hour).padStart(2, '0');
        
        const slotBlocks = dayBlocks.filter((b) => b.startTime.startsWith(hourStr));
        const slotTasks = timedTasks.filter((t) => t.dueTime && t.dueTime.startsWith(hourStr));
        const slotEvents = dayEvents.filter((e) => e.startTime.startsWith(hourStr));

        const hasItems = slotBlocks.length > 0 || slotTasks.length > 0 || slotEvents.length > 0;

        return (
          <View key={hour} style={[styles.hourRow, themed.hourRow]}>
            <Text style={[styles.hourLabel, themed.hourLabel]}>
              {timeFormat24h 
                ? `${hourStr}:00` 
                : `${hour === 0 ? 12 : hour > 12 ? hour - 12 : hour} ${hour >= 12 ? 'PM' : 'AM'}`}
            </Text>
            <View style={[styles.hourTimelineCell, themed.hourTimelineCell]}>
              {hasItems ? (
                <View style={styles.hourlyItemsContainer}>
                  {/* Render blocks */}
                  {slotBlocks.map((b) => (
                    <TouchableOpacity
                      key={b.id}
                      style={[styles.hourlyBlockCard, themed.hourlyBlockCard, { borderLeftColor: b.color }]}
                      onPress={() => onEditBlock(b)}
                    >
                      <Text style={[styles.hourlyBlockTitle, themed.hourlyBlockTitle]}>{b.title}</Text>
                      <Text style={[styles.hourlyBlockTime, themed.hourlyBlockTime]}>
                        {formatTimeForDisplay(b.startTime, timeFormat24h)} - {formatTimeForDisplay(b.endTime, timeFormat24h)} • {b.category}
                      </Text>
                    </TouchableOpacity>
                  ))}

                  {/* Render tasks */}
                  {slotTasks.map((t) => (
                    <View key={t.id} style={[styles.card, themed.card, Shadows.card, styles.timelineCard]}>
                      <View style={[styles.categoryBar, { backgroundColor: getCategoryColor(t.category) }]} />
                      <TouchableOpacity
                        style={styles.checkboxContainer}
                        onPress={() => onToggleTaskCompletion(t)}
                      >
                        <View style={[styles.checkbox, themed.checkbox, t.isCompleted && styles.checkboxChecked, t.isCompleted && themed.checkboxChecked]}>
                          {t.isCompleted && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.cardContent}
                        onPress={() => onEditScheduleItem(t, 'task')}
                      >
                        <Text style={[styles.cardTitle, themed.cardTitle, t.isCompleted && styles.cardTitleCompleted]}>
                          {t.title}
                        </Text>
                        <Text style={[styles.cardTime, themed.cardTime]}>
                          Due at {formatTimeForDisplay(t.dueTime!, timeFormat24h)} • {t.priority} Priority
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))}

                  {/* Render events */}
                  {slotEvents.map((e) => (
                    <View key={e.id} style={[styles.card, themed.card, Shadows.card, styles.timelineCard]}>
                      <View style={[styles.categoryBar, { backgroundColor: Colors.blue }]} />
                      <View style={[styles.eventIconContainer, themed.eventIconContainer]}>
                        <Users size={16} color={Colors.blue} />
                      </View>
                      <TouchableOpacity
                        style={styles.cardContent}
                        onPress={() => onEditScheduleItem(e, 'event')}
                      >
                        <Text style={[styles.cardTitle, themed.cardTitle]}>{e.title}</Text>
                        <Text style={[styles.cardTime, themed.cardTime]}>
                          {formatTimeForDisplay(e.startTime, timeFormat24h)} - {formatTimeForDisplay(e.endTime, timeFormat24h)} {e.location ? `• ${e.location}` : ''}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.emptyHourSlot, themed.emptyHourSlot]}
                  onLongPress={onAddBlock}
                  onPress={onAddBlock}
                />
              )}
            </View>
          </View>
        );
      })}
      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  hourlyContainer: {
    flex: 1,
  },
  allDayContainer: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  allDayTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: Fonts.heading,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
    overflow: 'hidden',
  },
  categoryBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  checkboxContainer: {
    marginRight: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontFamily: Fonts.body,
    fontWeight: 'bold',
  },
  cardTitleCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  cardTime: {
    fontSize: 11,
    fontFamily: Fonts.body,
    marginTop: 4,
  },
  hourRow: {
    flexDirection: 'row',
    minHeight: 70,
  },
  hourLabel: {
    width: 50,
    fontSize: 11,
    fontFamily: Fonts.body,
    paddingTop: 4,
    textAlign: 'right',
    paddingRight: 8,
  },
  hourTimelineCell: {
    flex: 1,
    borderTopWidth: 1,
    paddingLeft: 8,
    justifyContent: 'center',
  },
  hourlyItemsContainer: {
    flex: 1,
    width: '100%',
    paddingVertical: 4,
  },
  hourlyBlockCard: {
    flex: 1,
    borderRadius: 8,
    borderLeftWidth: 4,
    padding: 8,
    marginVertical: 4,
    justifyContent: 'center',
    ...Shadows.card,
  },
  hourlyBlockTitle: {
    fontSize: 13,
    fontFamily: Fonts.body,
    fontWeight: 'bold',
  },
  hourlyBlockTime: {
    fontSize: 10,
    fontFamily: Fonts.body,
    marginTop: 2,
  },
  timelineCard: {
    marginVertical: 4,
    marginBottom: 4,
  },
  eventIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  emptyHourSlot: {
    flex: 1,
    height: '100%',
    minHeight: 40,
  },
  bottomSpacer: {
    height: 100,
  },
});

const getThemedStyles = (colors: ThemeColors, isDarkMode: boolean) => ({
  hourlyContainer: {
    backgroundColor: colors.background,
  },
  allDayContainer: {
    backgroundColor: colors.cardBg,
  },
  allDayTitle: {
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.cardBg,
  },
  checkbox: {
    borderColor: colors.border,
  },
  checkboxChecked: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  cardTitle: {
    color: colors.textPrimary,
  },
  cardTime: {
    color: colors.textSecondary,
  },
  hourRow: {
    borderBottomColor: 'transparent',
  },
  hourLabel: {
    color: colors.textSecondary,
  },
  hourTimelineCell: {
    borderTopColor: colors.border,
  },
  hourlyBlockCard: {
    backgroundColor: colors.cardBg,
  },
  hourlyBlockTitle: {
    color: colors.textPrimary,
  },
  hourlyBlockTime: {
    color: colors.textSecondary,
  },
  eventIconContainer: {
    backgroundColor: isDarkMode ? 'rgba(52, 152, 219, 0.15)' : '#EBF5FB',
  },
  emptyHourSlot: {
    backgroundColor: 'transparent',
  },
});
