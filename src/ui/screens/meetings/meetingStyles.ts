import { StyleSheet } from 'react-native';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { Fonts, FontSize, Layout, Spacing } from '../../theme';

/** Theme-dependent styles shared by the meeting screens. */
export const getMeetingThemedStyles = (colors: ThemeColors) => ({
  textPrimary: { color: colors.textPrimary },
  textSecondary: { color: colors.textSecondary },
  textMuted: { color: colors.textMuted },
  onAccent: { color: colors.white },
  accent: { color: colors.red },
  errorText: { color: colors.error },
  card: { backgroundColor: colors.cardBg, borderColor: colors.border },
  input: { backgroundColor: colors.inputBg, borderColor: colors.border, color: colors.textPrimary },
  primaryButton: { backgroundColor: colors.red },
  secondaryButton: { borderColor: colors.border, backgroundColor: colors.cardBg },
  dangerButton: { borderColor: colors.error },
  chip: { backgroundColor: colors.inputBg, borderColor: colors.border },
  chipError: { backgroundColor: colors.bannerBg, borderColor: colors.error },
  banner: { backgroundColor: colors.bannerBg, borderColor: colors.warning },
  bannerError: { backgroundColor: colors.bannerBg, borderColor: colors.error },
  track: { backgroundColor: colors.divider },
  fill: { backgroundColor: colors.red },
  divider: { borderColor: colors.divider },
  tabActive: { borderBottomColor: colors.red },
  recordDot: { backgroundColor: colors.error },
});

export const meetingStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Layout.borderRadiusCard,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  cardTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
    marginBottom: Spacing.sm,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    lineHeight: 21,
  },
  small: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    lineHeight: 17,
  },
  strong: {
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    borderRadius: Layout.borderRadiusButton,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    marginBottom: Spacing.sm,
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Layout.borderRadiusPill,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  primaryLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
    marginLeft: Spacing.sm,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Layout.borderRadiusPill,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  secondaryLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
    fontWeight: '600',
    marginLeft: Spacing.xs,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  disabled: {
    opacity: 0.5,
  },
  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Layout.borderRadiusPill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  chipLabel: {
    fontFamily: Fonts.body,
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  banner: {
    borderWidth: 1,
    borderRadius: Layout.borderRadiusButton,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  bannerTitle: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
    fontWeight: 'bold',
    marginBottom: Spacing.xs,
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: Spacing.sm,
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spread: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
