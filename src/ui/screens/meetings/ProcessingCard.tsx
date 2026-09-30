import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { PROCESSING_STAGES, stageIndex } from '../../../meetings';
import type { ProcessingState } from '../../contexts/MeetingsContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Spacing } from '../../theme';
import { formatEta } from './meetingCopy';
import { getMeetingThemedStyles, meetingStyles } from './meetingStyles';

/**
 * The long wait, made legible: which step is running, how far through it is,
 * and what is happening right now, so nobody wonders whether the app froze.
 */
export const ProcessingCard: React.FC<{ processing: ProcessingState; onCancel: () => void }> = ({
  processing,
  onCancel,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getMeetingThemedStyles);
  const current = stageIndex(processing.stage);
  const eta = formatEta(processing.etaSeconds);

  return (
    <View style={[meetingStyles.card, themed.card]} accessibilityLiveRegion="polite">
      {PROCESSING_STAGES.map((stage, index) => {
        const done = index < current;
        const running = index === current;
        return (
          <View key={stage.status} style={[meetingStyles.row, styles.step]}>
            <View style={styles.stepIcon}>
              {done ? (
                <Check size={16} color={colors.success} />
              ) : running ? (
                <ActivityIndicator size="small" color={colors.red} />
              ) : null}
            </View>
            <Text
              style={[
                meetingStyles.body,
                running ? themed.textPrimary : themed.textMuted,
                running && meetingStyles.strong,
              ]}
            >
              {stage.label}
            </Text>
          </View>
        );
      })}

      <View style={[meetingStyles.spread, styles.progressHead]}>
        <Text style={[meetingStyles.strong, themed.textPrimary]}>
          {processing.stage === 'transcribing' ? 'Transcribing meeting…' : 'Writing meeting notes…'}
        </Text>
        <Text style={[meetingStyles.strong, themed.textSecondary]}>{processing.percent}%</Text>
      </View>
      <View
        style={[meetingStyles.track, themed.track]}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: processing.percent }}
      >
        <View style={[meetingStyles.fill, themed.fill, { width: `${Math.max(2, processing.percent)}%` }]} />
      </View>
      <Text style={[meetingStyles.small, themed.textSecondary]}>{processing.message}</Text>
      {eta ? <Text style={[meetingStyles.small, themed.textSecondary]}>{eta}</Text> : null}
      <Text style={[meetingStyles.small, styles.hint, themed.textMuted]}>
        {processing.stage === 'transcribing'
          ? 'Keep LAFINA open; you can use other screens meanwhile. If it is closed, the recording is kept and can be transcribed again.'
          : 'This needs a connection. Parts already written are kept if it stops.'}
      </Text>

      <TouchableOpacity
        style={[meetingStyles.secondaryButton, themed.secondaryButton, styles.cancel]}
        onPress={onCancel}
        accessibilityRole="button"
      >
        <X size={16} color={colors.textPrimary} />
        <Text style={[meetingStyles.secondaryLabel, themed.textPrimary]}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  step: {
    marginBottom: Spacing.xs,
  },
  stepIcon: {
    width: 24,
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  progressHead: {
    marginTop: Spacing.md,
  },
  hint: {
    marginTop: Spacing.sm,
  },
  cancel: {
    alignSelf: 'flex-start',
    marginTop: Spacing.md,
  },
});
