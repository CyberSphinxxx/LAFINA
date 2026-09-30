import React, { useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Animated,
  ActivityIndicator,
  Easing,
  Keyboard,
  DeviceEventEmitter,
  PermissionsAndroid,
} from 'react-native';
import { Fonts, Shadows } from '../theme';
import { X, Check, ArrowRight, Mic, CircleAlert } from 'lucide-react-native';
import { processCommand } from '../../ai';
import { useTheme } from '../contexts/ThemeContext';
import { useThemedStyles } from '../theme/createThemedStyles';
import { NLU_PARSER_DELAY_MS, VOICE_SUCCESS_DELAY_MS } from '../../constants';
import type { ThemeColors } from '../contexts/ThemeContext';
import {
  cancelOfflineSpeechCapture,
  startOfflineSpeechCapture,
  stopOfflineSpeechCapture,
} from '../../ai/native/speechCapture';
import type { OfflineSpeechCaptureHandle } from '../../ai/native/speechCapture';
interface VoiceModalProps {
  visible: boolean;
  userId: string;
  onClose: (didUpdate?: boolean) => void;
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'success' | 'error';

const WAVE_BAR_COUNT = 11;

/** The line under the title: what the mic is doing, in a few words. */
const STATUS_TEXT: Record<VoiceState, string> = {
  idle: 'Hold the mic button to talk',
  listening: 'Listening… let go when you’re done',
  processing: 'Working on it…',
  success: 'Done',
  error: 'That didn’t work',
};

export const VoiceModal: React.FC<VoiceModalProps> = ({
  visible,
  userId,
  onClose,
}) => {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  /** What was heard, live while talking and final once the mic is let go. */
  const [transcript, setTranscript] = useState('');
  /** Why nothing was heard, when that happens (no microphone, silence, a failure). */
  const [notice, setNotice] = useState('');
  const [aiReply, setAiReply] = useState('');
  const [inputText, setInputText] = useState('');

  // Animated values
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Waveform bars, scaled on the native driver
  const waveBars = useRef(
    Array.from({ length: WAVE_BAR_COUNT }, () => new Animated.Value(0.2)),
  ).current;
  const waveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeCaptureRef = useRef(0);
  const pressActiveRef = useRef(false);
  const microphoneRequestRef = useRef<Promise<boolean> | null>(null);
  const speechCaptureRef = useRef<OfflineSpeechCaptureHandle | null>(null);

  const { colors } = useTheme();
  const themed = useThemedStyles(getVoiceThemedStyles);

  const ensureMicrophonePermission = useCallback(async (): Promise<boolean> => {
    try {
      if (
        await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        )
      ) {
        return true;
      }

      if (!microphoneRequestRef.current) {
        microphoneRequestRef.current = PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone access',
            message:
              'LAFINA needs microphone access to transcribe scheduling commands.',
            buttonPositive: 'Allow',
            buttonNegative: 'Not now',
          },
        ).then(result => result === PermissionsAndroid.RESULTS.GRANTED);
      }

      return await microphoneRequestRef.current;
    } catch (error) {
      console.error('Failed to request microphone permission:', error);
      return false;
    } finally {
      microphoneRequestRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (visible) {
      void ensureMicrophonePermission();
    }
  }, [ensureMicrophonePermission, visible]);

  useEffect(() => {
    const showHeard = (e: { captureId?: string; transcript?: string }) => {
      if (e.captureId && e.captureId !== speechCaptureRef.current?.captureId)
        return;
      if (e?.transcript) {
        setTranscript(e.transcript);
        setNotice('');
      }
    };
    const partialSub = DeviceEventEmitter.addListener('onSpeechPartialResult', showHeard);
    const finalSub = DeviceEventEmitter.addListener('onSpeechFinalResult', showHeard);

    return () => {
      partialSub.remove();
      finalSub.remove();
    };
  }, []);

  const stopWaveform = useCallback(() => {
    if (waveIntervalRef.current) {
      clearInterval(waveIntervalRef.current);
      waveIntervalRef.current = null;
    }
    waveBars.forEach(bar => bar.setValue(0.2));
  }, [waveBars]);

  const startWaveform = useCallback(() => {
    stopWaveform();
    waveIntervalRef.current = setInterval(() => {
      waveBars.forEach(bar => {
        Animated.timing(bar, {
          toValue: 0.2 + Math.random() * 0.8,
          duration: 180,
          easing: Easing.ease,
          useNativeDriver: true,
        }).start();
      });
    }, 200);
  }, [stopWaveform, waveBars]);

  useEffect(() => {
    if (!visible) {
      pressActiveRef.current = false;
      activeCaptureRef.current += 1;
      const capture = speechCaptureRef.current;
      speechCaptureRef.current = null;
      if (capture) void cancelOfflineSpeechCapture(capture.captureId);
      setVoiceState('idle');
      setTranscript('');
      setNotice('');
      stopWaveform();
      return;
    }

    setTranscript('');
    setNotice('');
    setAiReply('');
    setInputText('');
    setVoiceState('idle');
  }, [visible, stopWaveform]);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (visible && voiceState === 'listening') {
      startWaveform();

      // A ring that swells out from the button and fades, over and over.
      pulseAnim.setValue(0);
      animation = Animated.loop(
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      );
      animation.start();
    } else {
      pulseAnim.setValue(0);
      stopWaveform();
    }

    return () => {
      if (animation) {
        animation.stop();
      }
      stopWaveform();
    };
  }, [visible, voiceState, pulseAnim, startWaveform, stopWaveform]);

  const triggerErrorShake = useCallback(
    (nextState: VoiceState = 'idle') => {
      setVoiceState('error');
      Animated.sequence([
        Animated.timing(shakeAnim, {
          toValue: 10,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: -10,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 10,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 0,
          duration: 50,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setTimeout(() => {
          setVoiceState(nextState);
        }, 1500);
      });
    },
    [shakeAnim],
  );

  // Push-To-Talk: Press & Hold down mic button to speak.
  const handlePressIn = useCallback(async () => {
    pressActiveRef.current = true;
    const captureId = activeCaptureRef.current + 1;
    activeCaptureRef.current = captureId;

    const hasPermission = await ensureMicrophonePermission();
    if (
      activeCaptureRef.current !== captureId ||
      !pressActiveRef.current
    ) {
      return;
    }
    if (!hasPermission) {
      setTranscript('');
      setNotice('LAFINA needs microphone access to hear you. Allow it and try again.');
      triggerErrorShake('idle');
      return;
    }

    setVoiceState('listening');
    setTranscript('');
    setNotice('');
    setAiReply('');

    try {
      speechCaptureRef.current = startOfflineSpeechCapture({
        mode: 'manual',
        bargeIn: false,
        context: 'main_mic',
      });
    } catch (error) {
      console.error('Failed to start offline Whisper capture:', error);
      setNotice('Speech recognition could not start. Please try again.');
      triggerErrorShake('idle');
    }
  }, [ensureMicrophonePermission, triggerErrorShake]);

  // Release the mic button to stop recording and process the shared Whisper result.
  const handlePressOut = useCallback(async () => {
    pressActiveRef.current = false;
    const uiCaptureId = activeCaptureRef.current;
    const capture = speechCaptureRef.current;
    if (!capture) {
      setVoiceState('idle');
      return;
    }

    setVoiceState('processing');
    try {
      await stopOfflineSpeechCapture(capture.captureId);
      const result = await capture.result;
      if (speechCaptureRef.current?.captureId === capture.captureId) {
        speechCaptureRef.current = null;
      }
      if (activeCaptureRef.current !== uiCaptureId) return;

      const finalTranscript = result.transcript.trim();
      setTranscript(finalTranscript);

      if (!finalTranscript) {
        setNotice('I didn’t catch that. Hold the mic and try again.');
        triggerErrorShake('idle');
        return;
      }

      const reply = processCommand(finalTranscript, userId);
      setAiReply(reply);
      setVoiceState('success');

      setTimeout(() => {
        if (activeCaptureRef.current === uiCaptureId) {
          onClose(true);
          setVoiceState('idle');
          setInputText('');
        }
      }, VOICE_SUCCESS_DELAY_MS);
    } catch (error) {
      console.error('Failed to process offline Whisper capture:', error);
      if (speechCaptureRef.current?.captureId === capture.captureId) {
        speechCaptureRef.current = null;
      }
      setNotice('Speech recognition could not finish. Please try again.');
      triggerErrorShake('idle');
    }
  }, [onClose, triggerErrorShake, userId]);

  const handleCommandProcess = (command: string) => {
    if (!command.trim()) return;
    activeCaptureRef.current += 1;
    Keyboard.dismiss();
    setTranscript(command);
    setNotice('');
    setVoiceState('processing');

    setTimeout(() => {
      try {
        const reply = processCommand(command, userId);
        setAiReply(reply);
        setVoiceState('success');

        setTimeout(() => {
          onClose(true);
          setVoiceState('idle');
          setInputText('');
        }, VOICE_SUCCESS_DELAY_MS);
      } catch (err) {
        console.error(err);
        triggerErrorShake();
      }
    }, NLU_PARSER_DELAY_MS);
  };

  const showFallbackControls =
    voiceState === 'idle' || voiceState === 'listening';
  const listening = voiceState === 'listening';

  const micColor =
    voiceState === 'success'
      ? colors.success
      : voiceState === 'error'
      ? colors.error
      : listening
      ? colors.red
      : colors.blue;

  const statusColor =
    voiceState === 'error'
      ? colors.error
      : voiceState === 'success'
      ? colors.success
      : listening
      ? colors.red
      : colors.textSecondary;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={() => onClose(false)}
    >
      <TouchableOpacity
        style={[styles.overlay, themed.overlay]}
        activeOpacity={1}
        onPress={() => onClose(false)}
      >
        <TouchableOpacity
          style={[styles.modalContent, themed.modalContent]}
          activeOpacity={1}
          onPress={() => Keyboard.dismiss()}
        >
          <View style={[styles.grabber, themed.grabber]} />

          {/* Close button */}
          <TouchableOpacity
            style={[styles.closeButton, themed.closeButton]}
            onPress={() => onClose(false)}
            accessibilityRole="button"
            accessibilityLabel="Close voice assistant"
          >
            <X size={16} color={colors.textPrimary} />
          </TouchableOpacity>

          {/* Heading */}
          <Text style={[styles.modalTitle, themed.modalTitle]}>
            LAFINA Voice Assistant
          </Text>
          <Text style={[styles.statusText, { color: statusColor }]} accessibilityLiveRegion="polite">
            {STATUS_TEXT[voiceState]}
          </Text>

          {/* Central Push-To-Talk Hold Button */}
          <View style={styles.animationArea}>
            {listening && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.listeningRing,
                  {
                    borderColor: colors.red,
                    opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
                    transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) }],
                  },
                ]}
              />
            )}

            <TouchableOpacity
              activeOpacity={0.8}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              accessibilityRole="button"
              accessibilityLabel="Hold to talk"
            >
              <Animated.View
                style={[
                  styles.voicePulseCircle,
                  {
                    transform: [{ translateX: shakeAnim }],
                    backgroundColor: micColor,
                  },
                ]}
              >
                {voiceState === 'processing' ? (
                  <ActivityIndicator size="large" color={colors.white} />
                ) : voiceState === 'success' ? (
                  <Check size={32} color={colors.white} strokeWidth={3} />
                ) : voiceState === 'error' ? (
                  <X size={32} color={colors.white} strokeWidth={3} />
                ) : (
                  <Mic size={32} color={colors.white} />
                )}
              </Animated.View>
            </TouchableOpacity>
          </View>

          {/* What LAFINA heard, live as you speak */}
          <View style={[styles.transcriptCard, themed.transcriptCard, listening && { borderColor: colors.red }]}>
            <View style={styles.transcriptHeader}>
              <Text style={[styles.transcriptLabel, themed.transcriptLabel]}>You said</Text>
              {listening && (
                <View style={[styles.livePill, themed.livePill]}>
                  <View style={[styles.liveDot, { backgroundColor: colors.red }]} />
                  <Text style={[styles.liveText, { color: colors.red }]}>Live</Text>
                </View>
              )}
            </View>

            {notice ? (
              <View style={styles.noticeRow}>
                <CircleAlert size={16} color={colors.error} />
                <Text style={[styles.noticeText, { color: colors.error }]}>{notice}</Text>
              </View>
            ) : transcript ? (
              <Text style={[styles.transcriptText, themed.transcriptText]} testID="voice-transcript">
                “{transcript}”
              </Text>
            ) : (
              <Text style={[styles.placeholderText, themed.placeholderText]}>
                {listening ? 'Go ahead, I’m listening…' : 'Your words will show up here as you speak.'}
              </Text>
            )}

            {listening && (
              <View style={styles.waveformContainer}>
                {waveBars.map((bar, i) => (
                  <Animated.View
                    key={i}
                    style={[
                      styles.waveformBar,
                      { backgroundColor: colors.red, transform: [{ scaleY: bar }] },
                    ]}
                  />
                ))}
              </View>
            )}
          </View>

          {/* What LAFINA did about it */}
          {aiReply ? (
            <View style={[styles.replyRow, themed.replyRow]}>
              <View style={[styles.replyIcon, { backgroundColor: colors.success }]}>
                <Check size={12} color={colors.white} strokeWidth={3} />
              </View>
              <Text style={[styles.replyText, themed.replyText]}>{aiReply}</Text>
            </View>
          ) : null}

          {/* Keyboard input fallback */}
          {showFallbackControls && (
            <View style={[styles.inputRow, themed.inputRow]}>
              <TextInput
                style={[styles.textInput, themed.textInput]}
                placeholder="Or type a command..."
                placeholderTextColor={colors.textSecondary}
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={() => handleCommandProcess(inputText)}
              />
              <TouchableOpacity
                style={[styles.sendButton, { backgroundColor: colors.red }]}
                onPress={() => handleCommandProcess(inputText)}
                accessibilityRole="button"
                accessibilityLabel="Send command"
              >
                <ArrowRight size={18} color={colors.white} />
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const getVoiceThemedStyles = (colors: ThemeColors) => ({
  overlay: { backgroundColor: colors.overlay },
  modalContent: { backgroundColor: colors.cardBg },
  grabber: { backgroundColor: colors.border },
  closeButton: { backgroundColor: colors.inputBg },
  modalTitle: { color: colors.textPrimary },
  transcriptCard: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
  },
  transcriptLabel: { color: colors.textSecondary },
  livePill: { backgroundColor: colors.cardBg },
  transcriptText: { color: colors.textPrimary },
  placeholderText: { color: colors.textMuted },
  replyRow: { backgroundColor: colors.inputBg },
  replyText: { color: colors.textPrimary },
  inputRow: { backgroundColor: colors.inputBg },
  textInput: { color: colors.textPrimary },
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 20,
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statusText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 16,
  },
  animationArea: {
    height: 120,
    width: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  listeningRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
  },
  voicePulseCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.micButton,
  },

  // What LAFINA heard
  transcriptCard: {
    width: '100%',
    minHeight: 96,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  transcriptLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  liveText: {
    fontFamily: Fonts.body,
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  transcriptText: {
    fontFamily: Fonts.body,
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 23,
  },
  placeholderText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  noticeText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
  waveformContainer: {
    flexDirection: 'row',
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  waveformBar: {
    width: 3,
    height: 28,
    borderRadius: 1.5,
    marginHorizontal: 3,
  },

  // What LAFINA did
  replyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    gap: 10,
  },
  replyIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  replyText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
  },

  // Input styling
  inputRow: {
    flexDirection: 'row',
    width: '100%',
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 6,
    marginTop: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.body,
    paddingVertical: 0,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
