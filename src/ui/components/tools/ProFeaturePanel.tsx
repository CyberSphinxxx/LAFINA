import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Layout, Shadows, Spacing } from '../../theme';

interface ProFeaturePanelProps {
  feature: string;
  description: string;
}

/**
 * Shown in place of a tool that needs Student Pro. The server checks the plan
 * again on every request; this only saves an upload that would be refused.
 */
export const ProFeaturePanel: React.FC<ProFeaturePanelProps> = ({ feature, description }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  return (
    <View style={[styles.card, Shadows.card, themed.card]} accessibilityRole="summary">
      <View style={[styles.iconCircle, themed.iconCircle]}>
        <Lock size={22} color={colors.white} />
      </View>
      <Text style={[styles.title, themed.title]}>{feature} is a Student Pro feature</Text>
      <Text style={[styles.body, themed.body]}>{description}</Text>
      <Text style={[styles.hint, themed.hint]}>
        Ask your LAFINA administrator to enable Student Pro on your account, then sign in again
        while online.
      </Text>
    </View>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  card: { backgroundColor: colors.cardBg, borderColor: colors.border },
  iconCircle: { backgroundColor: colors.red },
  title: { color: colors.textPrimary },
  body: { color: colors.textSecondary },
  hint: { color: colors.textMuted },
});

const styles = StyleSheet.create({
  card: {
    borderRadius: Layout.borderRadiusCard,
    borderWidth: 1,
    padding: Spacing.xl,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.subtitle,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
});
