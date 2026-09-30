import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Spacing } from '../../theme';

export interface ToolHeaderAction {
  key: string;
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  onPress: () => void;
}

interface ToolScreenHeaderProps {
  title: string;
  subtitle?: string | null;
  onBack: () => void;
  actions?: ToolHeaderAction[];
}

/**
 * Header for the screens the Mic's radial menu opens. They are not tabs, so
 * each has a way back to the tab it was opened from (hardware Back works too).
 */
export const ToolScreenHeader: React.FC<ToolScreenHeaderProps> = ({
  title,
  subtitle,
  onBack,
  actions = [],
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  return (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.iconButton}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
      >
        <ChevronLeft size={26} color={colors.textPrimary} />
      </TouchableOpacity>
      <View style={styles.titles}>
        <Text style={[styles.title, themed.title]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, themed.subtitle]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <TouchableOpacity
            key={action.key}
            style={styles.iconButton}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            hitSlop={6}
          >
            <Icon size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  title: { color: colors.textPrimary },
  subtitle: { color: colors.textSecondary },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    marginBottom: Spacing.md,
  },
  iconButton: {
    padding: Spacing.sm,
  },
  titles: {
    flex: 1,
    marginLeft: Spacing.xs,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.heading,
    fontWeight: 'bold',
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    marginTop: 1,
  },
});
