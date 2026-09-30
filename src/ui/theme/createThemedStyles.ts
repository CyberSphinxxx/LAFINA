import { useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import type { ThemeColors } from '../contexts/ThemeContext';

/**
 * Builds the colour-dependent half of a component's styles, once per theme.
 *
 * Everything that does not depend on the theme — sizes, spacing, radii —
 * belongs in a module-level `StyleSheet.create`, which React Native registers
 * once. Only what changes with light and dark comes through here.
 *
 * **The factory must be defined at module level.** The result is memoised on
 * the colours *and the factory*, so a new function on every render — an inline
 * arrow, or a hook declared inside the component — rebuilds the styles every
 * render and the memo never holds.
 *
 * @example
 * const getThemedStyles = (colors: ThemeColors) => ({
 *   container: { backgroundColor: colors.background },
 *   title: { color: colors.textPrimary },
 * });
 *
 * // inside the component:
 * const themed = useThemedStyles(getThemedStyles);
 */
export const useThemedStyles = <T extends Record<string, object>>(
  styleFactory: (colors: ThemeColors, isDarkMode: boolean) => T,
): T => {
  const { colors, isDarkMode } = useTheme();
  return useMemo(() => styleFactory(colors, isDarkMode), [colors, isDarkMode, styleFactory]);
};

/** Re-export for backwards compatibility */
export { useThemedStyles as createThemedStyles };
