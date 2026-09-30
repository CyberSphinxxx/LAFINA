import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { Colors, Fonts, Layout, Shadows } from '../theme';
import { useTheme } from '../contexts/ThemeContext';
import { useThemedStyles } from '../theme/createThemedStyles';
import type { ThemeColors } from '../contexts/ThemeContext';
import { tourTargetRef } from '../tour/tourTargets';
import type { TourAnchor } from '../tour/tourSteps';

import {
  Calendar,
  MessageSquare,
  FileText,
  User,
  Mic,
  LayoutDashboard,
  Briefcase,
  CheckSquare,
  Mail,
} from 'lucide-react-native';

export type ShellMode = 'student' | 'manager' | 'employee';

/** Screens opened from the Mic button's radial menu rather than a tab. */
export type ToolTab = 'pomodoro' | 'flashcards' | 'studynotes' | 'meetings';

export type TabType =
  | 'chat'
  | 'calendar'
  | 'notes'
  | 'profile'
  | 'overview'
  | 'work'
  | 'today'
  | 'inbox'
  | ToolTab;

export const TOOL_TABS: readonly ToolTab[] = ['pomodoro', 'flashcards', 'studynotes', 'meetings'];

export const isToolTab = (tab: TabType): tab is ToolTab =>
  (TOOL_TABS as readonly TabType[]).includes(tab);

/** Tabs the walkthrough points at. */
const TOUR_TABS: Partial<Record<TabType, TourAnchor>> = {
  chat: 'tab-chat',
  calendar: 'tab-calendar',
  notes: 'tab-notes',
  profile: 'tab-profile',
};

/** Gap between the bar and the bottom of the screen. */
const BAR_BOTTOM_OFFSET = 24;
/** The raised Mic button's inset from the bottom of the bar. */
const MIC_BOTTOM_INSET = 12;
/**
 * Height of the Mic button's centre above the bottom of the screen area the
 * bar is laid out in, for anything drawn around it (the radial menu).
 */
export const MIC_CENTER_FROM_BOTTOM =
  BAR_BOTTOM_OFFSET + MIC_BOTTOM_INSET + Layout.micButtonSize / 2;

/** Hold time before the Mic opens its radial menu instead of the voice assistant. */
const MIC_LONG_PRESS_MS = 350;

interface CustomTabBarProps {
  activeTab: TabType;
  onTabPress: (tab: TabType) => void;
  onMicPress: () => void;
  mode?: ShellMode;
  /** Holding the Mic opens the radial menu; the finger can then slide onto an item. */
  onMicLongPress?: () => void;
  /** Finger movement since the press, while the radial menu is open. */
  onMicDrag?: (dx: number, dy: number) => void;
  /** Finger lifted after a long press; null when the touch was cancelled. */
  onMicRelease?: (dx: number | null, dy: number | null) => void;
  /** Short text shown on the Mic, such as a running timer. */
  micBadge?: string | null;
}

export const CustomTabBar: React.FC<CustomTabBarProps> = ({
  activeTab,
  onTabPress,
  onMicPress,
  mode = 'student',
  onMicLongPress,
  onMicDrag,
  onMicRelease,
  micBadge,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getTabThemedStyles);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const tracking = useRef(false);

  // Pressable owns tap and long press; these raw touch events, which it passes
  // through untouched, follow the finger after the long press so it can slide
  // onto a radial item.
  const offsetOf = (event: GestureResponderEvent): { dx: number; dy: number } | null => {
    const start = touchStart.current;
    if (!start) return null;
    return { dx: event.nativeEvent.pageX - start.x, dy: event.nativeEvent.pageY - start.y };
  };

  const handleLongPress = (): void => {
    if (!onMicLongPress) return;
    tracking.current = true;
    onMicLongPress();
  };

  const handleTouchEnd = (event: GestureResponderEvent): void => {
    if (!tracking.current) return;
    tracking.current = false;
    const offset = offsetOf(event);
    onMicRelease?.(offset?.dx ?? null, offset?.dy ?? null);
  };

  const renderTab = (
    tab: TabType,
    label: string,
    IconComponent: React.ComponentType<{ size: number; color: string }>
  ) => {
    const isActive = activeTab === tab;
    const anchor = mode === 'student' ? TOUR_TABS[tab] : undefined;
    return (
      <TouchableOpacity
        key={tab}
        ref={anchor ? tourTargetRef(anchor) : undefined}
        style={styles.tab}
        onPress={() => onTabPress(tab)}
        activeOpacity={0.8}
        accessible={true}
        accessibilityRole="tab"
        accessibilityLabel={`${label} tab`}
        accessibilityState={{ selected: isActive }}
      >
        <IconComponent
          size={22}
          color={isActive ? colors.red : colors.textMuted}
        />
        {isActive && (
          <Text
            style={[
              styles.label,
              themed.label,
              styles.activeLabel,
              themed.activeLabel,
            ]}
          >
            {label}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderLeftTabs = () => {
    if (mode === 'manager') {
      return (
        <>
          {renderTab('overview', 'Overview', LayoutDashboard)}
          {renderTab('work', 'Work', Briefcase)}
        </>
      );
    }
    if (mode === 'employee') {
      return (
        <>
          {renderTab('today', 'Today', CheckSquare)}
          {renderTab('work', 'Work', Briefcase)}
        </>
      );
    }
    // Student / personal shell
    return (
      <>
        {renderTab('chat', 'Chat', MessageSquare)}
        {renderTab('calendar', 'Calendar', Calendar)}
      </>
    );
  };

  const renderRightTabs = () => {
    if (mode === 'manager' || mode === 'employee') {
      return (
        <>
          {renderTab('chat', 'Chat', MessageSquare)}
          {renderTab('inbox', 'Inbox', Mail)}
        </>
      );
    }
    // Student / personal shell
    return (
      <>
        {renderTab('notes', 'Notes', FileText)}
        {renderTab('profile', 'Profile', User)}
      </>
    );
  };

  return (
    <View style={styles.outerContainer} accessible={false}>
      <View
        style={[styles.container, themed.container]}
        accessibilityRole="tablist"
      >
        {renderLeftTabs()}

        {/* Central Raised Mic Button: tap to talk, hold for the radial menu */}
        <View style={styles.micContainer}>
          <Pressable
            ref={tourTargetRef('mic')}
            style={({ pressed }) => [
              styles.micButton,
              Shadows.micButton,
              pressed && styles.micPressed,
            ]}
            onPress={onMicPress}
            onLongPress={onMicLongPress ? handleLongPress : undefined}
            delayLongPress={MIC_LONG_PRESS_MS}
            onTouchStart={(event) => {
              tracking.current = false;
              touchStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
            }}
            onTouchMove={(event) => {
              if (!tracking.current) return;
              const offset = offsetOf(event);
              if (offset) onMicDrag?.(offset.dx, offset.dy);
            }}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={() => {
              if (!tracking.current) return;
              tracking.current = false;
              onMicRelease?.(null, null);
            }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Voice Action button"
            accessibilityHint={
              onMicLongPress
                ? 'Double tap to talk to LAFINA. Double tap and hold for Pomodoro and study tools.'
                : 'Double tap to open speech and reminder assistant'
            }
            accessibilityActions={
              onMicLongPress
                ? [{ name: 'activate' }, { name: 'longpress', label: 'Open study tools' }]
                : undefined
            }
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'longpress') onMicLongPress?.();
              else if (event.nativeEvent.actionName === 'activate') onMicPress();
            }}
          >
            <Mic size={28} color={colors.white} />
            {micBadge ? (
              <View style={[styles.micBadge, themed.micBadge]} pointerEvents="none">
                <Text style={[styles.micBadgeText, themed.micBadgeText]} numberOfLines={1}>
                  {micBadge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {renderRightTabs()}
      </View>
    </View>
  );
};

const getTabThemedStyles = (colors: ThemeColors) => ({
  container: { backgroundColor: colors.cardBg, borderColor: colors.border },
  label: { color: colors.textMuted },
  activeLabel: { color: colors.red },
  micBadge: { backgroundColor: colors.cardBg, borderColor: colors.blue },
  micBadgeText: { color: colors.textPrimary },
});

const styles = StyleSheet.create({
  outerContainer: {
    position: 'absolute',
    bottom: BAR_BOTTOM_OFFSET,
    left: 16,
    right: 16,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 36,
    height: Layout.navbarHeight,
    width: '100%',
    paddingHorizontal: 12,
    borderWidth: 1,
    ...Shadows.navbar,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    paddingVertical: 8,
  },
  label: {
    fontSize: 10,
    fontFamily: Fonts.body,
    marginTop: 4,
  },
  activeLabel: {
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  micContainer: {
    width: Layout.micButtonSize + 8,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    position: 'absolute',
    bottom: MIC_BOTTOM_INSET,
    width: Layout.micButtonSize,
    height: Layout.micButtonSize,
    borderRadius: Layout.micButtonSize / 2,
    backgroundColor: Colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micPressed: {
    opacity: 0.9,
  },
  micBadge: {
    position: 'absolute',
    top: -10,
    minWidth: 40,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Layout.borderRadiusPill,
    borderWidth: 1,
    alignItems: 'center',
  },
  micBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
});
