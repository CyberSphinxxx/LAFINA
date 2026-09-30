import React, { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { BellOff, History, Pause, Play, RotateCcw, Settings, SkipForward } from 'lucide-react-native';
import {
  DIAL_SWEEP_MINUTES,
  formatDuration,
  MIN_MINUTES,
  minutesToAngle,
  PHASE_LABELS,
  phaseDurationMs,
  pointToMinutes,
} from '../../../storage';
import type { PomodoroPhase, PomodoroSettings } from '../../../storage';
import { usePomodoro } from '../../contexts/PomodoroContext';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Layout, Spacing } from '../../theme';
import { ToolScreenHeader } from '../../components/tools';
import { PomodoroSettingsModal } from './PomodoroSettingsModal';
import { PomodoroHistoryModal } from './PomodoroHistoryModal';
import { phaseAccent } from './pomodoroColors';

const PHASES: PomodoroPhase[] = ['focus', 'shortBreak', 'longBreak'];

const DURATION_KEY: Record<PomodoroPhase, keyof PomodoroSettings> = {
  focus: 'focusMinutes',
  shortBreak: 'shortBreakMinutes',
  longBreak: 'longBreakMinutes',
};

const STROKE = 14;
/** How far from the ring a touch may start and still grab it. */
const GRAB_BAND = 44;

interface PomodoroScreenProps {
  onBack: () => void;
}

/**
 * The pomodoro workspace: a countdown, the task it is being spent on, and the
 * cycle it belongs to. The timer itself lives in `PomodoroProvider`, so it
 * keeps running on other screens; settings and history open as sheets.
 */
export const PomodoroScreen: React.FC<PomodoroScreenProps> = ({ onBack }) => {
  const pomodoro = usePomodoro();
  const { settings, runtime, remainingMs } = pomodoro;
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const { width } = useWindowDimensions();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Minutes being dragged, held locally so the database is written once. */
  const [draftMinutes, setDraftMinutes] = useState<number | null>(null);

  const dialSize = Math.min(width - Spacing.xxxl * 2, 300);
  const center = dialSize / 2;
  const radius = center - STROKE;
  const circumference = 2 * Math.PI * radius;

  const total = Math.max(1, runtime.totalMs);
  const accent = phaseAccent(colors, runtime.phase);
  /**
   * The ring is a duration picker while the phase sits untouched, and a
   * progress bar once it starts. Adjusting a session under way would be
   * ambiguous on both counts.
   */
  const adjustable = !runtime.isRunning && remainingMs >= total;
  const setMinutes = Math.round(total / 60_000);
  const shownMinutes = draftMinutes ?? setMinutes;
  const isDragging = draftMinutes !== null;
  const progress = adjustable
    ? Math.min(1, minutesToAngle(shownMinutes) / 360)
    : Math.min(1, Math.max(0, 1 - remainingMs / total));

  const commitMinutes = (minutes: number): void => {
    const key = DURATION_KEY[runtime.phase];
    if (settings[key] === minutes) return;
    pomodoro.saveSettings({ ...settings, [key]: minutes });
  };

  const nudge = (delta: number): void => {
    if (!adjustable) return;
    commitMinutes(Math.min(DIAL_SWEEP_MINUTES, Math.max(MIN_MINUTES, shownMinutes + delta)));
  };

  // Refs, so the responder created once always sees the current values.
  const live = useRef({ adjustable, setMinutes, draft: null as number | null, center, radius });
  live.current = { ...live.current, adjustable, setMinutes, center, radius };
  const commitRef = useRef(commitMinutes);
  commitRef.current = commitMinutes;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) => {
          const state = live.current;
          if (!state.adjustable) return false;
          const dx = event.nativeEvent.locationX - state.center;
          const dy = event.nativeEvent.locationY - state.center;
          return Math.abs(Math.hypot(dx, dy) - state.radius) <= GRAB_BAND;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          live.current.draft = live.current.setMinutes;
          setDraftMinutes(live.current.setMinutes);
        },
        onPanResponderMove: (event) => {
          const state = live.current;
          if (state.draft === null) return;
          const next = pointToMinutes(
            event.nativeEvent.locationX - state.center,
            event.nativeEvent.locationY - state.center,
            state.draft
          );
          state.draft = next;
          setDraftMinutes(next);
        },
        onPanResponderRelease: () => {
          const minutes = live.current.draft;
          live.current.draft = null;
          setDraftMinutes(null);
          if (minutes !== null) commitRef.current(minutes);
        },
        onPanResponderTerminate: () => {
          live.current.draft = null;
          setDraftMinutes(null);
        },
      }),
    []
  );

  const handleAngle = (minutesToAngle(shownMinutes) * Math.PI) / 180;
  const handleX = center + radius * Math.sin(handleAngle);
  const handleY = center - radius * Math.cos(handleAngle);
  const dots = Array.from({ length: settings.longBreakInterval }, (_, index) => index);
  const subtitle = `${pomodoro.focusToday} focus session${pomodoro.focusToday === 1 ? '' : 's'} today${
    pomodoro.focusMinutesToday > 0 ? ` · ${pomodoro.focusMinutesToday} min` : ''
  }`;

  return (
    <View style={styles.container}>
      <ToolScreenHeader
        title="Pomodoro"
        subtitle={subtitle}
        onBack={onBack}
        actions={[
          { key: 'history', label: 'Session history', icon: History, onPress: () => setHistoryOpen(true) },
          { key: 'settings', label: 'Pomodoro settings', icon: Settings, onPress: () => setSettingsOpen(true) },
        ]}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!isDragging}
      >
        {pomodoro.missedPhase && (
          <View style={[styles.banner, themed.banner]} accessibilityRole="alert">
            <Text style={[styles.bannerText, themed.textPrimary]}>
              Your {PHASE_LABELS[pomodoro.missedPhase].toLowerCase()} finished while LAFINA was
              closed. It has been counted — the next one is waiting for you.
            </Text>
            <TouchableOpacity onPress={pomodoro.dismissMissed} accessibilityRole="button">
              <Text style={[styles.bannerAction, { color: accent }]}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.phases} accessibilityRole="tablist">
          {PHASES.map((phase) => {
            const active = runtime.phase === phase;
            const phaseColor = phaseAccent(colors, phase);
            return (
              <TouchableOpacity
                key={phase}
                style={[
                  styles.phaseChip,
                  themed.phaseChip,
                  active && { backgroundColor: phaseColor, borderColor: phaseColor },
                ]}
                onPress={() => pomodoro.selectPhase(phase)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.phaseLabel, active ? themed.onAccent : themed.textPrimary]}>
                  {PHASE_LABELS[phase]}
                </Text>
                <Text style={[styles.phaseLength, active ? themed.onAccent : themed.textSecondary]}>
                  {Math.round(phaseDurationMs(settings, phase) / 60_000)}m
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View
          style={[styles.dial, { width: dialSize, height: dialSize }]}
          {...responder.panHandlers}
          accessible
          accessibilityRole={adjustable ? 'adjustable' : 'timer'}
          accessibilityLabel={
            adjustable
              ? `${PHASE_LABELS[runtime.phase]} length`
              : `${formatDuration(remainingMs)} remaining`
          }
          accessibilityValue={
            adjustable
              ? { min: MIN_MINUTES, max: DIAL_SWEEP_MINUTES, now: shownMinutes, text: `${shownMinutes} minutes` }
              : undefined
          }
          accessibilityActions={
            adjustable ? [{ name: 'increment' }, { name: 'decrement' }] : undefined
          }
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') nudge(1);
            else if (event.nativeEvent.actionName === 'decrement') nudge(-1);
          }}
        >
          <Svg width={dialSize} height={dialSize} pointerEvents="none">
            <Circle
              cx={center}
              cy={center}
              r={radius}
              stroke={colors.divider}
              strokeWidth={STROKE}
              fill="none"
            />
            <Circle
              cx={center}
              cy={center}
              r={radius}
              stroke={accent}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={circumference * (1 - progress)}
              rotation={-90}
              origin={`${center}, ${center}`}
              opacity={isDragging ? 0.85 : 1}
            />
            {adjustable && (
              <Circle
                cx={handleX}
                cy={handleY}
                r={isDragging ? 15 : 12}
                fill={accent}
                stroke={colors.cardBg}
                strokeWidth={3}
              />
            )}
          </Svg>
          <View style={styles.readout} pointerEvents="none">
            <Text style={[styles.time, themed.textPrimary]}>
              {isDragging ? formatDuration(shownMinutes * 60_000) : formatDuration(remainingMs)}
            </Text>
            <Text style={[styles.phaseName, themed.textSecondary]}>
              {isDragging ? `${PHASE_LABELS[runtime.phase]} length` : PHASE_LABELS[runtime.phase]}
            </Text>
            <View style={styles.dots}>
              {dots.map((index) => (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    themed.dot,
                    index < runtime.cyclePosition && { backgroundColor: accent },
                  ]}
                />
              ))}
            </View>
            {adjustable && !isDragging && (
              <Text style={[styles.dialHint, themed.textMuted]}>Drag the ring to set</Text>
            )}
          </View>
        </View>

        {/* The label is written into the history when the session completes,
            so it can be changed at any point. */}
        <TextInput
          style={[styles.taskInput, themed.taskInput]}
          placeholder="What are you working on?"
          placeholderTextColor={colors.placeholder}
          maxLength={120}
          value={pomodoro.task}
          onChangeText={pomodoro.setTask}
          accessibilityLabel="Task for this session"
          returnKeyType="done"
        />

        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.secondaryButton, themed.secondaryButton]}
            onPress={pomodoro.reset}
            accessibilityRole="button"
            accessibilityLabel="Restart this phase"
          >
            <RotateCcw size={18} color={colors.textPrimary} />
            <Text style={[styles.secondaryLabel, themed.textPrimary]}>Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: accent }]}
            onPress={pomodoro.toggle}
            accessibilityRole="button"
          >
            {runtime.isRunning ? (
              <Pause size={22} color={colors.white} />
            ) : (
              <Play size={22} color={colors.white} />
            )}
            <Text style={[styles.primaryLabel, themed.onAccent]}>
              {runtime.isRunning ? 'Pause' : remainingMs < total ? 'Resume' : 'Start'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, themed.secondaryButton]}
            onPress={pomodoro.skip}
            accessibilityRole="button"
            accessibilityLabel="Skip to the next phase without counting this one"
          >
            <SkipForward size={18} color={colors.textPrimary} />
            <Text style={[styles.secondaryLabel, themed.textPrimary]}>Skip</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          {pomodoro.isRinging && (
            <TouchableOpacity
              style={[styles.footerButton, { backgroundColor: accent }]}
              onPress={pomodoro.silence}
              accessibilityRole="button"
            >
              <BellOff size={14} color={colors.white} />
              <Text style={[styles.footerLabel, themed.onAccent]}>Stop ringing</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.footerButton, themed.secondaryButton]}
            onPress={pomodoro.resetAll}
            accessibilityRole="button"
            accessibilityLabel="Back to the first focus session"
          >
            <RotateCcw size={13} color={colors.textSecondary} />
            <Text style={[styles.footerLabel, themed.textSecondary]}>Reset cycle</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <PomodoroSettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <PomodoroHistoryModal visible={historyOpen} onClose={() => setHistoryOpen(false)} />
    </View>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  textPrimary: { color: colors.textPrimary },
  textSecondary: { color: colors.textSecondary },
  textMuted: { color: colors.textMuted },
  onAccent: { color: colors.white },
  banner: { backgroundColor: colors.bannerBg },
  phaseChip: { backgroundColor: colors.cardBg, borderColor: colors.border },
  dot: { backgroundColor: colors.divider },
  taskInput: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    color: colors.textPrimary,
  },
  secondaryButton: { backgroundColor: colors.cardBg, borderColor: colors.border },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  scroll: {
    alignItems: 'center',
    paddingBottom: 140,
  },
  banner: {
    alignSelf: 'stretch',
    borderRadius: Layout.borderRadiusButton,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  bannerText: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
    lineHeight: 20,
  },
  bannerAction: {
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
    marginTop: Spacing.sm,
    alignSelf: 'flex-end',
  },
  phases: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    marginBottom: Spacing.xl,
  },
  phaseChip: {
    flex: 1,
    marginHorizontal: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: Layout.borderRadiusButton,
    borderWidth: 1,
    alignItems: 'center',
  },
  phaseLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.small,
    fontWeight: 'bold',
  },
  phaseLength: {
    fontFamily: Fonts.body,
    fontSize: FontSize.caption,
    marginTop: 2,
  },
  dial: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  readout: {
    position: 'absolute',
    alignItems: 'center',
  },
  time: {
    fontFamily: Fonts.heading,
    fontSize: 52,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  phaseName: {
    fontFamily: Fonts.body,
    fontSize: FontSize.bodyLarge,
    marginTop: Spacing.xs,
  },
  dots: {
    flexDirection: 'row',
    marginTop: Spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 3,
  },
  dialHint: {
    fontFamily: Fonts.body,
    fontSize: FontSize.caption,
    marginTop: Spacing.sm,
  },
  taskInput: {
    alignSelf: 'stretch',
    marginTop: Spacing.xl,
    borderWidth: 1,
    borderRadius: Layout.borderRadiusButton,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xl,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    borderRadius: Layout.borderRadiusPill,
    marginHorizontal: Spacing.md,
    minWidth: 128,
    justifyContent: 'center',
  },
  primaryLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
    marginLeft: Spacing.sm,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: 56,
    borderRadius: Layout.borderRadiusButton,
    borderWidth: 1,
  },
  secondaryLabel: {
    fontFamily: Fonts.body,
    fontSize: FontSize.caption,
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    marginTop: Spacing.lg,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Layout.borderRadiusPill,
    borderWidth: 1,
    borderColor: 'transparent',
    marginHorizontal: Spacing.xs,
  },
  footerLabel: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    marginLeft: Spacing.xs,
  },
});
