import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Fonts, Layout, Shadows, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';

interface ProfileStatsProps {
  completedTasksCount: number;
  notesCount: number;
  voiceCommandsCount: number;
}

export const ProfileStats: React.FC<ProfileStatsProps> = ({
  completedTasksCount,
  notesCount,
  voiceCommandsCount,
}) => {
  const themed = useThemedStyles(getThemedStyles);

  return (
    <View style={styles.statsRow}>
      <View style={[styles.statCard, Shadows.card, themed.statCard]}>
        <Text style={[styles.statVal, themed.statVal]}>{completedTasksCount}</Text>
        <Text style={[styles.statLabel, themed.statLabel]}>Tasks Done</Text>
      </View>
      <View style={[styles.statCard, Shadows.card, themed.statCard]}>
        <Text style={[styles.statVal, themed.statVal]}>{notesCount}</Text>
        <Text style={[styles.statLabel, themed.statLabel]}>Notes Saved</Text>
      </View>
      <View style={[styles.statCard, Shadows.card, themed.statCard]}>
        <Text style={[styles.statVal, themed.statVal]}>{voiceCommandsCount}</Text>
        <Text style={[styles.statLabel, themed.statLabel]}>Voice Uses</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    borderRadius: Layout.borderRadiusCard,
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  statVal: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 10,
    marginTop: 4,
    fontFamily: Fonts.body,
  },
});

const getThemedStyles = (colors: ThemeColors) => ({
  statCard: {
    backgroundColor: colors.cardBg,
  },
  statVal: {
    color: colors.textPrimary,
  },
  statLabel: {
    color: colors.textSecondary,
  },
});
