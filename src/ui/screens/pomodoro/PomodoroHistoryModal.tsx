import React, { useEffect, useMemo } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import { formatDuration, PHASE_LABELS } from '../../../storage';
import type { PomodoroSessionRow } from '../../../storage';
import { usePomodoro } from '../../contexts/PomodoroContext';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Layout, Spacing } from '../../theme';
import { ToolSheet } from '../../components/tools';
import { phaseAccent } from './pomodoroColors';

const pad = (value: number): string => String(value).padStart(2, '0');

const clockTime = (iso: string): string => {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Today` / `Yesterday`, else a short written date. */
export const dayLabel = (dayKey: string, now: Date = new Date()): string => {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  const midnight = (value: Date): number =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
};

interface DayGroup {
  dayKey: string;
  rows: PomodoroSessionRow[];
  focusCount: number;
  focusMs: number;
}

/** Everything completed — on any device — newest first and grouped by day. */
export const PomodoroHistoryModal: React.FC<{ visible: boolean; onClose: () => void }> = ({
  visible,
  onClose,
}) => {
  const pomodoro = usePomodoro();
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const { refreshHistory } = pomodoro;

  // The list is cached in the provider; re-read whenever the sheet opens.
  useEffect(() => {
    if (visible) refreshHistory();
  }, [visible, refreshHistory]);

  const groups = useMemo<DayGroup[]>(() => {
    const byDay = new Map<string, DayGroup>();
    pomodoro.history.forEach((row) => {
      const group = byDay.get(row.dayKey) ?? { dayKey: row.dayKey, rows: [], focusCount: 0, focusMs: 0 };
      group.rows.push(row);
      if (row.phase === 'focus') {
        group.focusCount += 1;
        group.focusMs += row.durationMs;
      }
      byDay.set(row.dayKey, group);
    });
    return [...byDay.values()].sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  }, [pomodoro.history]);

  const confirmClear = (): void => {
    Alert.alert(
      'Clear history',
      'Every logged session will be removed, here and on your other devices.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: pomodoro.clearHistory },
      ]
    );
  };

  return (
    <ToolSheet
      visible={visible}
      title="Session history"
      onClose={onClose}
      footer={
        groups.length > 0 ? (
          <TouchableOpacity style={styles.clear} onPress={confirmClear} accessibilityRole="button">
            <Trash2 size={15} color={colors.error} />
            <Text style={[styles.clearLabel, themed.danger]}>Clear history</Text>
          </TouchableOpacity>
        ) : undefined
      }
    >
      {groups.length === 0 ? (
        <Text style={[styles.empty, themed.textSecondary]}>
          Finished sessions appear here, including ones from your other devices.
        </Text>
      ) : (
        groups.map((group) => (
          <View key={group.dayKey} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={[styles.groupTitle, themed.textPrimary]}>{dayLabel(group.dayKey)}</Text>
              <Text style={[styles.groupSummary, themed.textSecondary]}>
                {group.focusCount} focus · {Math.round(group.focusMs / 60_000)} min
              </Text>
            </View>
            {group.rows.map((row) => (
              <View key={row.id} style={[styles.row, themed.row]}>
                <View style={[styles.dot, { backgroundColor: phaseAccent(colors, row.phase) }]} />
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, themed.textPrimary]} numberOfLines={1}>
                    {row.task || PHASE_LABELS[row.phase]}
                  </Text>
                  {row.task ? (
                    <Text style={[styles.rowMeta, themed.textSecondary]}>{PHASE_LABELS[row.phase]}</Text>
                  ) : null}
                </View>
                <View style={styles.rowRight}>
                  <Text style={[styles.rowDuration, themed.textPrimary]}>
                    {formatDuration(row.durationMs)}
                  </Text>
                  <Text style={[styles.rowMeta, themed.textSecondary]}>{clockTime(row.finishedAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        ))
      )}
    </ToolSheet>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  textPrimary: { color: colors.textPrimary },
  textSecondary: { color: colors.textSecondary },
  danger: { color: colors.error },
  row: { backgroundColor: colors.cardBg, borderColor: colors.border },
});

const styles = StyleSheet.create({
  empty: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    textAlign: 'center',
    marginVertical: Spacing.xxl,
  },
  group: {
    marginTop: Spacing.md,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: Spacing.sm,
  },
  groupTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
  },
  groupSummary: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Layout.borderRadiusButton,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xs + 2,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: Spacing.md,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
  },
  rowMeta: {
    fontFamily: Fonts.body,
    fontSize: FontSize.caption + 1,
    marginTop: 1,
  },
  rowRight: {
    alignItems: 'flex-end',
    marginLeft: Spacing.sm,
  },
  rowDuration: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
    fontVariant: ['tabular-nums'],
  },
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  clearLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
    marginLeft: Spacing.xs + 2,
  },
});
