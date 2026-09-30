import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useColorScheme } from 'react-native';
import { userStore } from '../../storage';
import { Colors } from '../theme/colors';
import { captureForReveal, isThemeRevealAvailable, revealNewTheme } from '../theme/themeReveal';
import type { ThemeRevealOrigin } from '../theme/themeReveal';

export interface ThemeColors {
  // Core surfaces
  background: string;
  cardBg: string;
  inputBg: string;
  divider: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // Borders
  border: string;

  // Status bar
  statusBarStyle: 'dark-content' | 'light-content';

  // Brand / semantic colors
  red: string;
  blue: string;
  yellow: string;
  success: string;
  warning: string;
  error: string;

  // Additional semantic colors that were previously hardcoded
  white: string;
  black: string;
  overlay: string;
  chipActiveText: string;

  // Switch / toggle
  switchTrackOff: string;
  switchThumb: string;

  // Placeholder text
  placeholder: string;

  // Icon / minor element tints
  iconMuted: string;

  // Event icon backgrounds
  eventIconBg: string;

  // Overdue / warning banner backgrounds
  bannerBg: string;

  // Highlighted words inside a note, matching the desktop editor's marker pen
  noteHighlightBg: string;
  noteHighlightText: string;

  // The brand gradient behind the Student Pro tag, the same in both themes
  proGradientStart: string;
  proGradientMid: string;
  proGradientEnd: string;

  // The sign-in backdrop: the logo's own colours (yellow, crimson, blue), as on
  // the desktop app, deepened for dark mode, and a veil that tames the extremes
  authGradientYellow: string;
  authGradientCrimson: string;
  authGradientBlue: string;
  authVeil: string;

  // Philippine holidays in the calendar's all-day row, the desktop's green
  holiday: string;
}

const lightColors: ThemeColors = {
  background: '#FAF9F6',
  cardBg: Colors.cardBg,
  inputBg: '#FAF9F6',
  divider: '#F0F0F0',
  textPrimary: Colors.textDark,
  textSecondary: Colors.textMuted,
  textMuted: Colors.textMutedLight,
  border: Colors.border,
  statusBarStyle: 'dark-content',
  red: Colors.red,
  blue: Colors.blue,
  yellow: Colors.yellow,
  success: Colors.success,
  warning: Colors.warning,
  error: Colors.error,
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(0,0,0,0.5)',
  chipActiveText: '#FFFFFF',
  switchTrackOff: '#767577',
  switchThumb: '#FFF',
  placeholder: '#888',
  iconMuted: '#AAA',
  eventIconBg: '#F0F0FF',
  bannerBg: '#FCE4D6',
  noteHighlightBg: '#FFF3A3',
  noteHighlightText: Colors.textDark,
  proGradientStart: Colors.gradientRed,
  proGradientMid: Colors.gradientMagenta,
  proGradientEnd: Colors.gradientPurple,
  authGradientYellow: '#F8E81C',
  authGradientCrimson: '#D8163F',
  authGradientBlue: '#2A10F0',
  authVeil: 'rgba(255, 255, 255, 0.12)',
  holiday: '#0B8043',
};

const darkColors: ThemeColors = {
  background: '#121212',
  cardBg: Colors.cardBgDark,
  inputBg: '#2C2C2E',
  divider: '#3A3A3C',
  textPrimary: Colors.textLight,
  textSecondary: Colors.textMutedLight,
  textMuted: '#666666',
  border: Colors.borderDark,
  statusBarStyle: 'light-content',
  red: Colors.red,
  blue: Colors.blue,
  yellow: Colors.yellow,
  success: Colors.success,
  warning: Colors.warning,
  error: Colors.error,
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(0,0,0,0.5)',
  chipActiveText: '#FFFFFF',
  switchTrackOff: '#767577',
  switchThumb: '#FFF',
  placeholder: '#666',
  iconMuted: '#666',
  eventIconBg: '#1E1E3F',
  bannerBg: '#2C1B18',
  noteHighlightBg: '#6B5D1F',
  noteHighlightText: Colors.textLight,
  proGradientStart: Colors.gradientRed,
  proGradientMid: Colors.gradientMagenta,
  proGradientEnd: Colors.gradientPurple,
  // Plain yellow turns olive when darkened, so gold stands in for it.
  authGradientYellow: '#E8A812',
  authGradientCrimson: '#B80E36',
  authGradientBlue: '#2410C8',
  authVeil: 'rgba(10, 6, 28, 0.22)',
  holiday: '#0B8043',
};

interface ThemeContextType {
  isDarkMode: boolean;
  colors: ThemeColors;
  /** Switches light and dark, revealing the new theme in a circle from `origin` (a touch's pageX/pageY). */
  toggleTheme: (origin?: ThemeRevealOrigin | null) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ userId: string | null; children: React.ReactNode }> = ({
  userId,
  children,
}) => {
  const systemScheme = useColorScheme();

  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (userId) {
      return userStore.getDarkModeEnabled(userId);
    }
    return systemScheme === 'dark';
  });

  useEffect(() => {
    if (userId) {
      setIsDarkMode(userStore.getDarkModeEnabled(userId));
    } else {
      setIsDarkMode(systemScheme === 'dark');
    }
  }, [userId, systemScheme]);

  const colors = useMemo<ThemeColors>(
    () => (isDarkMode ? darkColors : lightColors),
    [isDarkMode]
  );

  /** Set while the old theme is being captured, and when the new one is waiting to be revealed. */
  const capturingRef = useRef(false);
  const revealPendingRef = useRef(false);

  const toggleTheme = useCallback((origin?: ThemeRevealOrigin | null) => {
    const flip = (): void =>
      setIsDarkMode((prev) => {
        const next = !prev;
        if (userId) {
          userStore.setDarkModeEnabled(userId, next);
        }
        return next;
      });

    if (!isThemeRevealAvailable()) {
      flip();
      return;
    }
    // A second toggle while the picture is being taken would change the theme under it twice.
    if (capturingRef.current) return;
    capturingRef.current = true;
    void captureForReveal(origin).then((captured) => {
      capturingRef.current = false;
      revealPendingRef.current = captured;
      flip();
    });
  }, [userId]);

  // The new theme has committed; the native side waits two more frames before opening the circle.
  useEffect(() => {
    if (!revealPendingRef.current) return;
    revealPendingRef.current = false;
    revealNewTheme();
  }, [isDarkMode]);

  const contextValue = useMemo(
    () => ({ isDarkMode, colors, toggleTheme }),
    [isDarkMode, colors, toggleTheme]
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextType => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
};
