import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  DeviceEventEmitter,
  Easing,
  Image,
  Modal,
  PermissionsAndroid,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Phone, PhoneOff } from 'lucide-react-native';
import { CallAnsweredView } from '../components/call/CallAnsweredView';
import {
  answerCall,
  declineCall,
  getReminderPreferences,
  manualAcknowledgeCall,
  manualSnoozeCall,
  prepareCallSpeech,
} from '../../scheduler';
import type {
  CallResolution,
  CallSpeechProvider,
  CallState,
  CallStateEvent,
  NativeCallAction,
} from '../../scheduler';
import { CALL_RESULT_DELAY_MS } from '../../constants';
import { Fonts, Shadows } from '../theme';
import { useTheme } from '../contexts/ThemeContext';

const lafinaLogo = require('../../assets/lafina_default_logo.png');

import { createCallSpeechProvider } from '../../cloud/speechService';

interface IncomingCallScreenProps {
  visible: boolean;
  reminderId: string;
  task: string;
  userId: string;
  onClose: () => void;
  initialAction?: NativeCallAction;
}

/** Renders and coordinates the complete offline reminder call experience. */
export const IncomingCallScreen: React.FC<IncomingCallScreenProps> = ({
  visible,
  reminderId,
  task,
  userId,
  onClose,
  initialAction = 'call',
}) => {
  const { isDarkMode, colors } = useTheme();
  const [callState, setCallState] = useState<CallState>('ringing');
  const [resolution, setResolution] = useState<CallResolution | null>(null);
  const [snoozeMinutes, setSnoozeMinutes] = useState(5);
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const ringAnim = useRef(new Animated.Value(1)).current;
  const resultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedActionRef = useRef('');
  const closingRef = useRef(false);
  const speechProviderRef = useRef<CallSpeechProvider | null>(null);

  const clearResultTimeout = useCallback((): void => {
    if (resultTimeoutRef.current) {
      clearTimeout(resultTimeoutRef.current);
      resultTimeoutRef.current = null;
    }
  }, []);

  const resetPresentation = useCallback((): void => {
    clearResultTimeout();
    Vibration.cancel();
    setCallState('ringing');
    setResolution(null);
    setTranscript('');
    setReply('');
    ringAnim.setValue(1);
    processedActionRef.current = '';
  }, [clearResultTimeout, ringAnim]);

  const closeCallScreen = useCallback((): void => {
    if (closingRef.current) return;
    closingRef.current = true;
    resetPresentation();
    onClose();
  }, [onClose, resetPresentation]);

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      resetPresentation();
      const defaultSnoozeMinutes =
        getReminderPreferences(userId).snoozeDurationMinutes;
      setSnoozeMinutes(defaultSnoozeMinutes);
      const speechProvider = createCallSpeechProvider(userId);
      speechProviderRef.current = speechProvider;
      void prepareCallSpeech(speechProvider, task, defaultSnoozeMinutes);
      return () => {
        if (speechProviderRef.current === speechProvider) {
          speechProviderRef.current = null;
        }
        void speechProvider.dispose?.().catch(() => undefined);
      };
    }

    resetPresentation();
    return undefined;
  }, [reminderId, resetPresentation, task, userId, visible]);

  useEffect(() => {
    let animLoop: Animated.CompositeAnimation | null = null;

    if (visible && callState === 'ringing') {
      Vibration.vibrate([1000, 1000, 1000, 1000], true);
      animLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(ringAnim, {
            toValue: 1.1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ringAnim, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      animLoop.start();
    } else {
      Vibration.cancel();
      ringAnim.setValue(1);
    }

    return () => {
      Vibration.cancel();
      animLoop?.stop();
    };
  }, [visible, callState, ringAnim]);

  useEffect(() => {
    if (!visible) return;

    const stateSub = DeviceEventEmitter.addListener(
      'LAFINA_CALL_STATE_CHANGE',
      (event: CallStateEvent) => {
        if (event.state === 'disconnected') {
          if (event.resolution) {
            Vibration.cancel();
            setCallState('disconnected');
            setResolution(event.resolution);
            setReply(event.resolution.message);
            clearResultTimeout();
            resultTimeoutRef.current = setTimeout(
              closeCallScreen,
              CALL_RESULT_DELAY_MS,
            );
            return;
          }

          closeCallScreen();
          return;
        }

        setCallState(event.state);
        if (event.text !== undefined) {
          setReply(event.text);
        }
      },
    );

    const partialSub = DeviceEventEmitter.addListener(
      'onSpeechPartialResult',
      (event: { transcript?: string }) => {
        setTranscript(event.transcript || '');
      },
    );

    const finalSub = DeviceEventEmitter.addListener(
      'onSpeechFinalResult',
      (event: { transcript?: string }) => {
        setTranscript(event.transcript || '');
      },
    );

    return () => {
      stateSub.remove();
      partialSub.remove();
      finalSub.remove();
    };
  }, [clearResultTimeout, closeCallScreen, visible]);

  const handleAnswer = useCallback(async (): Promise<void> => {
    Vibration.cancel();
    setCallState('connected');

    let microphoneGranted = false;
    try {
      const permission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      microphoneGranted = permission === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      console.error(
        '[CallScreen] Could not request microphone permission:',
        error,
      );
    }

    try {
      const speechProvider =
        speechProviderRef.current || createCallSpeechProvider(userId);
      await answerCall(reminderId, userId, microphoneGranted, speechProvider);
      if (!microphoneGranted) {
        setReply(
          'Microphone permission is unavailable. Use Acknowledge or Snooze below.',
        );
      }
    } catch (error) {
      console.error('[CallScreen] Could not answer reminder call:', error);
      setReply('LAFINA could not start the voice call. Use the buttons below.');
    }
  }, [reminderId, userId]);

  const handleDecline = useCallback(async (): Promise<void> => {
    Vibration.cancel();
    try {
      const speechProvider =
        speechProviderRef.current || createCallSpeechProvider(userId);
      await declineCall(reminderId, userId, speechProvider);
    } catch (error) {
      console.error('[CallScreen] Could not end reminder call:', error);
    } finally {
      closeCallScreen();
    }
  }, [closeCallScreen, reminderId, userId]);

  const handleManualSnooze = useCallback(
    async (minutes: number): Promise<void> => {
      try {
        await manualSnoozeCall(reminderId, userId, minutes);
      } catch (error) {
        console.error('[CallScreen] Could not snooze reminder:', error);
        setReply('LAFINA could not snooze this reminder. Please try again.');
      }
    },
    [reminderId, userId],
  );

  const handleManualAcknowledge = useCallback(async (): Promise<void> => {
    try {
      await manualAcknowledgeCall(reminderId, userId);
    } catch (error) {
      console.error('[CallScreen] Could not acknowledge reminder:', error);
      setReply('LAFINA could not acknowledge this reminder. Please try again.');
    }
  }, [reminderId, userId]);

  useEffect(() => {
    if (!visible || !reminderId) return;
    const actionKey = reminderId + ':' + initialAction;
    if (processedActionRef.current === actionKey) return;
    processedActionRef.current = actionKey;

    if (initialAction === 'answer') void handleAnswer();
    if (initialAction === 'decline') void handleDecline();
  }, [visible, reminderId, initialAction, handleAnswer, handleDecline]);

  useEffect(() => {
    if (!visible || callState !== 'ringing') return;
    const timeout = setTimeout(() => void handleDecline(), 45_000);
    return () => clearTimeout(timeout);
  }, [visible, callState, handleDecline]);

  if (!visible) return null;

  const themed = {
    container: { backgroundColor: colors.background },
    primaryText: { color: colors.textPrimary },
    secondaryText: { color: colors.textSecondary },
    mutedText: { color: colors.textMuted },
    badge: {
      backgroundColor: isDarkMode
        ? 'rgba(230, 0, 58, 0.16)'
        : 'rgba(230, 0, 58, 0.08)',
      borderColor: isDarkMode
        ? 'rgba(230, 0, 58, 0.36)'
        : 'rgba(230, 0, 58, 0.20)',
    },
    logoSurface: {
      backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : colors.cardBg,
      borderColor: colors.blue,
    },
    taskCard: {
      backgroundColor: colors.cardBg,
      borderColor: colors.border,
    },
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
      onRequestClose={() => void handleDecline()}
    >
      <StatusBar
        barStyle={colors.statusBarStyle}
        backgroundColor={colors.background}
      />
      <SafeAreaView style={[styles.container, themed.container]}>
        {callState === 'ringing' ? (
          <View style={styles.ringingContainer}>
            <View style={styles.header}>
              <View style={[styles.badge, themed.badge]}>
                <Text style={[styles.badgeText, { color: colors.blue }]}>
                  INCOMING SCHEDULED CALL
                </Text>
              </View>
              <Text style={[styles.callerName, themed.primaryText]}>
                LAFINA Scheduler
              </Text>
              <Text style={[styles.callType, themed.secondaryText]}>
                University Academic Assistant
              </Text>
            </View>

            <View style={styles.middle}>
              <Animated.View
                style={[
                  styles.avatarRingOuter,
                  {
                    borderColor: colors.yellow,
                    transform: [{ scale: ringAnim }],
                  },
                ]}
              >
                <View
                  style={[styles.avatarRingInner, { borderColor: colors.red }]}
                >
                  <View style={[styles.avatarCircle, themed.logoSurface]}>
                    <Image
                      source={lafinaLogo}
                      style={styles.avatarImage}
                      resizeMode="contain"
                      accessibilityLabel="LAFINA logo"
                    />
                  </View>
                </View>
              </Animated.View>

              <View style={[styles.taskCard, themed.taskCard]}>
                <Text style={[styles.taskLabel, themed.mutedText]}>
                  REMINDER
                </Text>
                <Text style={[styles.taskText, themed.primaryText]}>
                  {task || 'Scheduled academic reminder'}
                </Text>
              </View>
            </View>

            <View style={styles.footer}>
              <Text style={[styles.offlineLabel, themed.mutedText]}>
                Offline reminder call
              </Text>
              <View style={styles.actionRow}>
                <View style={styles.buttonColumn}>
                  <TouchableOpacity
                    style={[
                      styles.circleButton,
                      { backgroundColor: colors.error },
                    ]}
                    onPress={() => void handleDecline()}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Decline reminder call"
                    accessibilityHint="Ends this call and applies the automatic snooze policy."
                  >
                    <PhoneOff size={30} color={colors.white} />
                  </TouchableOpacity>
                  <Text style={[styles.buttonLabel, themed.secondaryText]}>
                    Decline
                  </Text>
                </View>

                <View style={styles.buttonColumn}>
                  <TouchableOpacity
                    style={[
                      styles.circleButton,
                      { backgroundColor: colors.success },
                    ]}
                    onPress={() => void handleAnswer()}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Answer reminder call"
                    accessibilityHint="Answers LAFINA and opens the offline voice call."
                  >
                    <Phone size={30} color={colors.white} />
                  </TouchableOpacity>
                  <Text style={[styles.buttonLabel, themed.secondaryText]}>
                    Answer
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : (
          <CallAnsweredView
            task={task}
            callState={callState}
            resolution={resolution}
            snoozeMinutes={snoozeMinutes}
            onSnooze={handleManualSnooze}
            onAcknowledge={handleManualAcknowledge}
            onDecline={handleDecline}
            transcript={transcript}
            reply={reply}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  ringingContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 34,
    paddingBottom: 26,
  },
  header: {
    alignItems: 'center',
  },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  badgeText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  callerName: {
    fontFamily: Fonts.heading,
    fontSize: 30,
    fontWeight: '800',
    marginTop: 18,
    textAlign: 'center',
  },
  callType: {
    fontFamily: Fonts.body,
    fontSize: 15,
    marginTop: 7,
    textAlign: 'center',
  },
  middle: {
    width: '100%',
    alignItems: 'center',
  },
  avatarRingOuter: {
    width: 194,
    height: 194,
    borderRadius: 97,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRingInner: {
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircle: {
    width: 146,
    height: 146,
    borderRadius: 73,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Shadows.card,
  },
  avatarImage: {
    width: 124,
    height: 72,
  },
  taskCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginTop: 34,
    ...Shadows.card,
  },
  taskLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.3,
    textAlign: 'center',
  },
  taskText: {
    fontFamily: Fonts.body,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 23,
    textAlign: 'center',
    marginTop: 6,
  },
  footer: {
    width: '100%',
    alignItems: 'center',
  },
  offlineLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 18,
  },
  actionRow: {
    width: '100%',
    maxWidth: 360,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  buttonColumn: {
    alignItems: 'center',
    minWidth: 110,
  },
  circleButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.card,
  },
  buttonLabel: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
  },
});
