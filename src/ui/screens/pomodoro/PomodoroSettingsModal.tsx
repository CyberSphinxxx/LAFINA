import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Minus, Plus, Volume2 } from 'lucide-react-native';
import {
  MAX_INTERVAL,
  MAX_MINUTES,
  MAX_RING_SECONDS,
  MIN_INTERVAL,
  MIN_MINUTES,
  MIN_RING_SECONDS,
} from '../../../storage';
import type { PomodoroSettings } from '../../../storage';
import { usePomodoro } from '../../contexts/PomodoroContext';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Layout, Spacing } from '../../theme';
import { ToolSheet } from '../../components/tools';

interface StepperRowProps {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

const StepperRow: React.FC<StepperRowProps> = ({ label, value, unit, min, max, onChange }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const step = (delta: number): void => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <View style={[styles.row, themed.row]}>
      <Text style={[styles.rowLabel, themed.textPrimary]}>{label}</Text>
      <View
        style={styles.stepper}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text: `${value} ${unit}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        <TouchableOpacity
          style={[styles.stepButton, themed.stepButton]}
          onPress={() => step(-1)}
          onLongPress={() => step(-5)}
          disabled={value <= min}
          importantForAccessibility="no"
        >
          <Minus size={16} color={value <= min ? colors.textMuted : colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.stepValue, themed.textPrimary]}>
          {value}
          <Text style={[styles.stepUnit, themed.textSecondary]}> {unit}</Text>
        </Text>
        <TouchableOpacity
          style={[styles.stepButton, themed.stepButton]}
          onPress={() => step(1)}
          onLongPress={() => step(5)}
          disabled={value >= max}
          importantForAccessibility="no"
        >
          <Plus size={16} color={value >= max ? colors.textMuted : colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

interface SwitchRowProps {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

const SwitchRow: React.FC<SwitchRowProps> = ({ label, hint, value, onChange }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  return (
    <View style={[styles.row, themed.row]}>
      <View style={styles.switchText}>
        <Text style={[styles.rowLabel, themed.textPrimary]}>{label}</Text>
        {hint ? <Text style={[styles.rowHint, themed.textSecondary]}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.switchTrackOff, true: colors.red }}
        thumbColor={colors.switchThumb}
        accessibilityLabel={label}
      />
    </View>
  );
};

/**
 * Timer lengths, the long-break rhythm, auto-start and the alert. Edits are
 * held until Save, which writes (and syncs) them once. Volume follows the
 * phone's own ringer volume, so the desktop's volume setting is not shown.
 */
export const PomodoroSettingsModal: React.FC<{ visible: boolean; onClose: () => void }> = ({
  visible,
  onClose,
}) => {
  const pomodoro = usePomodoro();
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const [draft, setDraft] = useState<PomodoroSettings>(pomodoro.settings);

  useEffect(() => {
    if (visible) setDraft(pomodoro.settings);
  }, [visible, pomodoro.settings]);

  const update = (patch: Partial<PomodoroSettings>): void =>
    setDraft((previous) => ({ ...previous, ...patch }));

  const save = (): void => {
    pomodoro.saveSettings(draft);
    onClose();
  };

  return (
    <ToolSheet
      visible={visible}
      title="Pomodoro settings"
      onClose={onClose}
      footer={
        <>
          <TouchableOpacity style={styles.footerButton} onPress={onClose} accessibilityRole="button">
            <Text style={[styles.footerLabel, themed.textSecondary]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerButton, styles.saveButton, themed.saveButton]}
            onPress={save}
            accessibilityRole="button"
          >
            <Text style={[styles.footerLabel, themed.onAccent]}>Save</Text>
          </TouchableOpacity>
        </>
      }
    >
      <Text style={[styles.section, themed.textSecondary]}>Lengths</Text>
      <StepperRow label="Focus" unit="min" value={draft.focusMinutes} min={MIN_MINUTES} max={MAX_MINUTES}
        onChange={(focusMinutes) => update({ focusMinutes })} />
      <StepperRow label="Short break" unit="min" value={draft.shortBreakMinutes} min={MIN_MINUTES} max={MAX_MINUTES}
        onChange={(shortBreakMinutes) => update({ shortBreakMinutes })} />
      <StepperRow label="Long break" unit="min" value={draft.longBreakMinutes} min={MIN_MINUTES} max={MAX_MINUTES}
        onChange={(longBreakMinutes) => update({ longBreakMinutes })} />
      <StepperRow label="Long break every" unit="focus" value={draft.longBreakInterval} min={MIN_INTERVAL} max={MAX_INTERVAL}
        onChange={(longBreakInterval) => update({ longBreakInterval })} />

      <Text style={[styles.section, themed.textSecondary]}>Flow</Text>
      <SwitchRow label="Start breaks automatically" value={draft.autoStartBreaks}
        onChange={(autoStartBreaks) => update({ autoStartBreaks })} />
      <SwitchRow label="Start focus automatically" hint="After a break ends" value={draft.autoStartFocus}
        onChange={(autoStartFocus) => update({ autoStartFocus })} />

      <Text style={[styles.section, themed.textSecondary]}>Alert</Text>
      <SwitchRow label="Ring" hint="Uses your phone's ringtone and ringer volume" value={draft.soundEnabled}
        onChange={(soundEnabled) => update({ soundEnabled })} />
      <StepperRow label="Ring for" unit="sec" value={draft.ringSeconds} min={MIN_RING_SECONDS} max={MAX_RING_SECONDS}
        onChange={(ringSeconds) => update({ ringSeconds })} />
      <SwitchRow label="Notify in the background" hint="When a phase ends with LAFINA closed"
        value={draft.notificationsEnabled} onChange={(notificationsEnabled) => update({ notificationsEnabled })} />
      <TouchableOpacity
        style={[styles.preview, themed.row]}
        onPress={pomodoro.previewSound}
        accessibilityRole="button"
      >
        <Volume2 size={16} color={colors.textPrimary} />
        <Text style={[styles.previewLabel, themed.textPrimary]}>Preview ring</Text>
      </TouchableOpacity>
    </ToolSheet>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  textPrimary: { color: colors.textPrimary },
  textSecondary: { color: colors.textSecondary },
  onAccent: { color: colors.white },
  row: { backgroundColor: colors.cardBg, borderColor: colors.border },
  stepButton: { backgroundColor: colors.inputBg, borderColor: colors.border },
  saveButton: { backgroundColor: colors.red },
});

const styles = StyleSheet.create({
  section: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.small,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Layout.borderRadiusButton,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
    minHeight: 52,
  },
  rowLabel: {
    fontFamily: Fonts.body,
    fontSize: FontSize.body,
  },
  rowHint: {
    fontFamily: Fonts.body,
    fontSize: FontSize.caption + 1,
    marginTop: 2,
  },
  switchText: {
    flex: 1,
    marginRight: Spacing.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    minWidth: 70,
    textAlign: 'center',
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
  },
  stepUnit: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    fontWeight: 'normal',
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Layout.borderRadiusPill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  previewLabel: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    marginLeft: Spacing.sm,
  },
  footerButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Layout.borderRadiusPill,
    marginLeft: Spacing.sm,
  },
  saveButton: {
    paddingHorizontal: Spacing.xl,
  },
  footerLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.body,
    fontWeight: 'bold',
  },
});
