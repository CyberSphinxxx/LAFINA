import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Mic, Pause, Play, Square, Trash2 } from 'lucide-react-native';
import { useMeetings, MAX_RECORDING_MS } from '../../contexts/MeetingsContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Shadows, Spacing } from '../../theme';
import { describeMeetingProblem, formatClock } from './meetingCopy';
import { getMeetingThemedStyles, meetingStyles } from './meetingStyles';

/**
 * Before and during a recording.
 *
 * The clock is the reassurance that something is happening, so it is big.
 * Discarding is kept away from Stop and always asks first.
 */
export const RecorderCard: React.FC = () => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getMeetingThemedStyles);
  const {
    recorder,
    recorderError,
    clearRecorderError,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    processing,
  } = useMeetings();
  const [title, setTitle] = useState('');

  const error = recorderError ? describeMeetingProblem(recorderError.code) : null;

  const confirmDiscard = (): void => {
    Alert.alert('Discard this recording?', 'The audio recorded so far is deleted and cannot be recovered.', [
      { text: 'Keep recording', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void discardRecording() },
    ]);
  };

  const errorBanner = error ? (
    <View style={[meetingStyles.banner, themed.bannerError]} accessibilityRole="alert">
      <Text style={[meetingStyles.bannerTitle, themed.textPrimary]}>{error.title}</Text>
      <Text style={[meetingStyles.small, themed.textPrimary]}>{error.message}</Text>
      <View style={[meetingStyles.buttonRow, styles.bannerActions]}>
        {error.recovery === 'open_privacy_settings' && (
          <TouchableOpacity
            style={[meetingStyles.secondaryButton, themed.secondaryButton]}
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
          >
            <Text style={[meetingStyles.secondaryLabel, themed.textPrimary]}>{error.recoveryLabel}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[meetingStyles.secondaryButton, themed.secondaryButton]}
          onPress={clearRecorderError}
          accessibilityRole="button"
        >
          <Text style={[meetingStyles.secondaryLabel, themed.textPrimary]}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : null;

  if (!recorder) {
    const busy = processing !== null;
    return (
      <View style={[meetingStyles.card, Shadows.card, themed.card]}>
        {errorBanner}
        <TextInput
          style={[meetingStyles.input, themed.input]}
          placeholder="Meeting title (optional)"
          placeholderTextColor={colors.placeholder}
          value={title}
          onChangeText={setTitle}
          maxLength={160}
          accessibilityLabel="Meeting title"
        />
        <TouchableOpacity
          style={[meetingStyles.primaryButton, themed.primaryButton]}
          onPress={() => {
            void startRecording({ title });
            setTitle('');
          }}
          accessibilityRole="button"
          accessibilityLabel="Start recording"
        >
          <Mic size={18} color={colors.white} />
          <Text style={[meetingStyles.primaryLabel, themed.onAccent]}>Start recording</Text>
        </TouchableOpacity>
        <Text style={[meetingStyles.small, styles.note, themed.textMuted]}>
          Recorded and transcribed on this phone, up to {Math.round(MAX_RECORDING_MS / 3_600_000)} hours. It keeps
          recording with the screen off or while you use other apps.
          {busy ? ' Another meeting is being processed; this one is transcribed after it.' : ''}
        </Text>
      </View>
    );
  }

  const stopping = recorder.status === 'stopping' || recorder.status === 'starting';
  const paused = recorder.status === 'paused';

  return (
    <View style={[meetingStyles.card, Shadows.card, themed.card]} accessibilityLiveRegion="polite">
      {errorBanner}
      <View style={meetingStyles.row}>
        <View style={[styles.dot, themed.recordDot, paused && styles.dotPaused]} />
        <Text style={[meetingStyles.strong, themed.textPrimary]}>
          {recorder.status === 'starting'
            ? 'Starting…'
            : recorder.status === 'stopping'
              ? 'Saving the recording…'
              : paused
                ? 'Paused'
                : 'Recording'}
        </Text>
      </View>
      <Text
        style={[styles.clock, themed.textPrimary]}
        accessibilityLabel={`Recorded ${formatClock(recorder.elapsedMs)}`}
      >
        {formatClock(recorder.elapsedMs)}
      </Text>

      {stopping ? (
        <ActivityIndicator color={colors.red} />
      ) : (
        <View style={[meetingStyles.buttonRow, styles.controls]}>
          <TouchableOpacity
            style={[meetingStyles.secondaryButton, themed.secondaryButton, styles.control]}
            onPress={() => void (paused ? resumeRecording() : pauseRecording())}
            accessibilityRole="button"
          >
            {paused ? <Play size={18} color={colors.textPrimary} /> : <Pause size={18} color={colors.textPrimary} />}
            <Text style={[meetingStyles.secondaryLabel, themed.textPrimary]}>{paused ? 'Resume' : 'Pause'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[meetingStyles.primaryButton, themed.primaryButton, styles.control]}
            onPress={() => void stopRecording()}
            accessibilityRole="button"
            accessibilityLabel="Stop and transcribe"
          >
            <Square size={16} color={colors.white} fill={colors.white} />
            <Text style={[meetingStyles.primaryLabel, themed.onAccent]}>Stop</Text>
          </TouchableOpacity>
        </View>
      )}

      {!stopping && (
        <TouchableOpacity
          style={styles.discard}
          onPress={confirmDiscard}
          accessibilityRole="button"
          accessibilityLabel="Discard recording"
          hitSlop={8}
        >
          <Trash2 size={14} color={colors.error} />
          <Text style={[meetingStyles.small, styles.discardLabel, themed.errorText]}>Discard recording</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  note: {
    marginTop: Spacing.sm,
  },
  bannerActions: {
    marginTop: Spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: Spacing.sm,
  },
  dotPaused: {
    opacity: 0.4,
  },
  clock: {
    fontFamily: Fonts.heading,
    fontSize: 44,
    fontWeight: 'bold',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginVertical: Spacing.lg,
  },
  controls: {
    justifyContent: 'center',
  },
  control: {
    minWidth: 120,
  },
  discard: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: Spacing.lg,
  },
  discardLabel: {
    marginLeft: Spacing.xs,
  },
});
