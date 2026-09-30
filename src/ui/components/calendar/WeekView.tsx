import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList } from 'react-native';
import { Colors, Fonts, Shadows, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { Task, Event } from '../../../storage/tasksStore';
import { TimeBlock } from '../../../storage/timeBlocksStore';
import { Check, Users } from 'lucide-react-native';

interface WeekViewProps {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  weekDays: Date[];
  overdueList: Task[];
  feedItems: {
    type: 'task' | 'event' | 'block';
    id: string;
    title: string;
    time: string;
    endTime?: string;
    item: any;
  }[];
  timeFormat24h: boolean;
  onEditScheduleItem: (item: Task | Event, type: 'task' | 'event') => void;
  onToggleTaskCompletion: (task: Task) => void;
  onEditBlock: (block: TimeBlock) => void;
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

export const WeekView: React.FC<WeekViewProps> = ({
  selectedDate,
  setSelectedDate,
  weekDays,
  overdueList,
  feedItems,
  timeFormat24h,
  onEditScheduleItem,
  onToggleTaskCompletion,
  onEditBlock,
}) => {
  const themed = useThemedStyles(getThemedStyles);

  return (
    <View style={[styles.weekViewContainer, themed.weekViewContainer]}>
      {/* Date Pill Scroller */}
      <View style={[styles.scrollerContainer, themed.scrollerContainer]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekScroller}>
          {weekDays.map((day, i) => {
            const isSelected = day.toDateString() === selectedDate.toDateString();
            const isToday = day.toDateString() === new Date().toDateString();
            return (
              <View
                key={i}
                style={[
                  styles.datePill,
                  { backgroundColor: 'transparent' },
                  isSelected && Shadows.card,
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.pillTouchTarget,
                    themed.datePill,
                    isSelected && styles.datePillActive,
                    isToday && !isSelected && styles.datePillToday,
                  ]}
                  onPress={() => setSelectedDate(day)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pillDayName, themed.pillDayName, isSelected && styles.pillTextActive]}>
                    {day.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3)}
                  </Text>
                  <Text style={[
                    styles.pillDayNum, 
                    themed.pillDayNum, 
                    isSelected && styles.pillTextActive, 
                    isToday && !isSelected && styles.pillTodayNum
                  ]}>
                    {day.getDate()}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* Overdue Section */}
      {overdueList.length > 0 && (
        <View style={[styles.overdueBanner, themed.overdueBanner]}>
          <View style={styles.overdueBadge}>
            <Text style={styles.overdueBadgeText}>OVERDUE</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.overdueScroll}>
            {overdueList.map((ot) => (
              <TouchableOpacity
                key={ot.id}
                style={[styles.overdueChip, themed.overdueChip]}
                onPress={() => onEditScheduleItem(ot, 'task')}
              >
                <Text style={[styles.overdueChipText, themed.overdueChipText]} numberOfLines={1}>
                  {ot.title}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Chronological List of Feed Items */}
      {feedItems.length === 0 ? (
        <View style={[styles.emptyState, themed.emptyState]}>
          <Text style={styles.emptyIllustration}>📅</Text>
          <Text style={[styles.emptyTitle, themed.emptyTitle]}>Your schedule is clear</Text>
          <Text style={[styles.emptySubtitle, themed.emptySubtitle]}>
            Tap the float button below to add tasks or time blocks.
          </Text>
        </View>
      ) : (
        <FlatList
          data={feedItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.feedList}
          renderItem={({ item }) => {
            if (item.type === 'task') {
              const t = item.item as Task;
              return (
                <View style={[styles.card, themed.card, Shadows.card]}>
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
                      {t.dueTime ? `Due at ${formatTimeForDisplay(t.dueTime, timeFormat24h)}` : 'All Day'} • {t.priority} Priority
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            } else if (item.type === 'event') {
              const e = item.item as Event;
              return (
                <View style={[styles.card, themed.card, Shadows.card]}>
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
              );
            } else {
              const b = item.item as TimeBlock;
              return (
                <View style={[styles.blockBandCard, themed.blockBandCard, { backgroundColor: b.color + '15', borderColor: b.color }]}>
                  <TouchableOpacity 
                    style={styles.blockBandContent}
                    onPress={() => onEditBlock(b)}
                  >
                    <Text style={[styles.blockBandTitle, themed.blockBandTitle, { color: b.color }]}>
                      Time Block: {b.title}
                    </Text>
                    <Text style={[styles.blockBandTime, themed.blockBandTime]}>
                      {formatTimeForDisplay(b.startTime, timeFormat24h)} - {formatTimeForDisplay(b.endTime, timeFormat24h)} • {b.category}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            }
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  weekViewContainer: {
    flex: 1,
  },
  scrollerContainer: {
    marginBottom: 8,
  },
  weekScroller: {
    paddingVertical: 8,
  },
  datePill: {
    width: 50,
    height: 70,
    borderRadius: 12,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillTouchTarget: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  datePillActive: {
    backgroundColor: Colors.red,
  },
  datePillToday: {
    borderWidth: 1,
  },
  pillDayName: {
    fontSize: 11,
    fontFamily: Fonts.body,
    marginBottom: 4,
  },
  pillDayNum: {
    fontSize: 16,
    fontFamily: Fonts.body,
    fontWeight: 'bold',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  pillTodayNum: {
    color: Colors.red,
  },
  overdueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    marginBottom: 12,
  },
  overdueBadge: {
    backgroundColor: Colors.error,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  overdueBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: 'bold',
  },
  overdueScroll: {
    flex: 1,
  },
  overdueChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 6,
  },
  overdueChipText: {
    fontSize: 11,
    fontFamily: Fonts.body,
    maxWidth: 120,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIllustration: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  feedList: {
    paddingBottom: 120,
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
  eventIconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  blockBandCard: {
    borderRadius: 8,
    borderLeftWidth: 4,
    padding: 10,
    marginBottom: 8,
    ...Shadows.card,
  },
  blockBandContent: {
    flex: 1,
  },
  blockBandTitle: {
    fontSize: 13,
    fontFamily: Fonts.body,
    fontWeight: 'bold',
  },
  blockBandTime: {
    fontSize: 10,
    fontFamily: Fonts.body,
    marginTop: 2,
  },
});

const getThemedStyles = (colors: ThemeColors, isDarkMode: boolean) => ({
  weekViewContainer: {
    backgroundColor: colors.background,
  },
  scrollerContainer: {
    borderBottomColor: colors.border,
  },
  datePill: {
    backgroundColor: colors.cardBg,
  },
  pillDayName: {
    color: colors.textSecondary,
  },
  pillDayNum: {
    color: colors.textPrimary,
  },
  overdueBanner: {
    backgroundColor: isDarkMode ? 'rgba(231, 76, 60, 0.15)' : '#FDEDEC',
  },
  overdueChip: {
    backgroundColor: colors.inputBg,
  },
  overdueChipText: {
    color: colors.textPrimary,
  },
  emptyState: {
    backgroundColor: colors.background,
  },
  emptyTitle: {
    color: colors.textPrimary,
  },
  emptySubtitle: {
    color: colors.textSecondary,
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
  eventIconContainer: {
    backgroundColor: isDarkMode ? 'rgba(52, 152, 219, 0.15)' : '#EBF5FB',
  },
  blockBandCard: {
    backgroundColor: colors.cardBg,
  },
  blockBandTitle: {
    color: colors.textPrimary,
  },
  blockBandTime: {
    color: colors.textSecondary,
  },
});
