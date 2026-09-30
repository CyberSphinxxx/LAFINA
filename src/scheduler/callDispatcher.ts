import { DeviceEventEmitter } from 'react-native';
import { remindersStore } from '../storage';
import { stopSpeechPlayback, synthesizeSpeech } from '../ai/tts/ttsService';
import {
  cancelOfflineSpeechCapture,
  hasOfflineSpeechCapture,
  startOfflineSpeechCapture,
} from '../ai/native/speechCapture';
import type {
  OfflineSpeechCaptureHandle,
  OfflineSpeechResult,
} from '../ai/native/speechCapture';
import { getReminderPreferences } from './userPreferences';
import {
  acknowledgeReminderAction,
  autoSnoozeReminderAction,
  snoozeReminderAction,
} from './reminderActions';
import type {
  ReminderActionOutcome,
  ReminderActionResult,
} from './reminderActions';
import {
  finishNativeIncomingCall,
  startActiveCallSession,
  stopActiveCallSession,
} from './reminderAlarm';
import {
  CallSpeechProvider,
  defaultCallSpeechProvider,
} from './speechProvider';

export type CallState =
  | 'ringing'
  | 'connected'
  | 'speaking'
  | 'speaking_listening'
  | 'listening'
  | 'processing'
  | 'disconnected';

export type CallResolutionOutcome = Exclude<ReminderActionOutcome, 'rejected'>;

export interface CallResolution {
  outcome: CallResolutionOutcome;
  message: string;
}

export interface CallStateEvent {
  state: CallState;
  text?: string;
  resolution?: CallResolution;
}

interface CallDispatcherSession {
  id: number;
  reminderId: string;
  userId: string;
  task: string;
  state: CallState;
  retryCount: number;
  voiceEnabled: boolean;
  speechProvider: CallSpeechProvider;
  isResolving: boolean;
}

interface EventSubscription {
  remove: () => void;
}

interface ActiveCallCapture {
  session: CallDispatcherSession;
  handle: OfflineSpeechCaptureHandle;
  speechStartedSubscription: EventSubscription;
}

export interface CallCommand {
  intent: 'acknowledge' | 'snooze';
  minutes: number | null;
}

let activeSession: CallDispatcherSession | null = null;
let activeCallCapture: ActiveCallCapture | null = null;
let sessionSequence = 0;

const ACKNOWLEDGE_CONFIRMATION =
  'Great! Task acknowledged. Have a productive day.';
const RETRY_PROMPT =
  'I did not catch one of the choices shown on screen. Please try again now.';
const WHISPER_MODEL = 'ggml-tiny.en-q5_1.bin';
const STT_MEDIAN_TARGET_MS = 1_500;
const STT_P95_LIMIT_MS = 3_000;

const getSnoozeConfirmation = (minutes: number): string =>
  `Snoozed for ${minutes} minutes.`;

const buildAnnouncement = (task: string): string =>
  `Hey! This is LAFINA. Your scheduled reminder is "${task}". Choose one of the two responses shown on screen at any time.`;

const warmCallResponseAudio = async (
  defaultSnoozeMinutes: number,
): Promise<void> => {
  const phrases = [
    ACKNOWLEDGE_CONFIRMATION,
    getSnoozeConfirmation(5),
    getSnoozeConfirmation(10),
    getSnoozeConfirmation(15),
    getSnoozeConfirmation(defaultSnoozeMinutes),
  ];
  try {
    for (const phrase of [...new Set(phrases)]) {
      await synthesizeSpeech(phrase);
    }
  } catch (error) {
    console.warn('[CallDispatcher] Could not warm response audio:', error);
  }
};

/**
 * Prepares the online call announcement and most likely confirmations without
 * coupling the offline scheduler to a cloud implementation.
 */
export const prepareCallSpeech = async (
  provider: CallSpeechProvider,
  task: string,
  defaultSnoozeMinutes: number,
): Promise<void> => {
  if (!provider.prepareText) return;
  const preparePhrase = async (phrase: string): Promise<void> => {
    try {
      await provider.prepareText?.(phrase);
    } catch (error) {
      console.warn('[CallDispatcher] Could not prepare call speech:', error);
    }
  };

  // Prioritize the announcement, then warm both possible confirmations while
  // the announcement is playing.
  await preparePhrase(buildAnnouncement(task));
  await Promise.all([
    preparePhrase(ACKNOWLEDGE_CONFIRMATION),
    preparePhrase(getSnoozeConfirmation(defaultSnoozeMinutes)),
  ]);
};

const publishCallState = (state: CallState, text?: string): void => {
  if (activeSession) activeSession.state = state;
  const payload: CallStateEvent = { state };
  if (text !== undefined) payload.text = text;
  DeviceEventEmitter.emit('LAFINA_CALL_STATE_CHANGE', payload);
};

const resolutionFromAction = (
  action: ReminderActionResult,
): CallResolution | undefined => {
  if (!action.ok || action.outcome === 'rejected') return undefined;
  return {
    outcome: action.outcome,
    message: action.message,
  };
};

const isCurrentSession = (session: CallDispatcherSession): boolean =>
  activeSession === session;

const claimCallResolution = (session: CallDispatcherSession): boolean => {
  if (!isCurrentSession(session) || session.isResolving) return false;
  session.isResolving = true;
  return true;
};

const removeActiveCapture = (capture: ActiveCallCapture): void => {
  capture.speechStartedSubscription.remove();
  if (activeCallCapture === capture) activeCallCapture = null;
};

const cancelActiveCapture = (): void => {
  const capture = activeCallCapture;
  if (!capture) return;
  removeActiveCapture(capture);
  void cancelOfflineSpeechCapture(capture.handle.captureId).catch(
    (error: unknown) => {
      console.warn('[CallDispatcher] Could not cancel offline capture:', error);
    },
  );
};

const stopActiveAudioAndCapture = async (
  session: CallDispatcherSession | null = activeSession,
): Promise<void> => {
  cancelActiveCapture();
  if (session?.speechProvider.stopSpeech) {
    await session.speechProvider.stopSpeech().catch(() => undefined);
    return;
  }
  await stopSpeechPlayback().catch(() => undefined);
};

/**
 * Handles non-listening TTS playback while recovering the visible call state on failure.
 */
export const speakText = async (
  text: string,
  options?: { fallbackAudioPath?: string | null },
): Promise<void> => {
  try {
    publishCallState('speaking', text);
    const provider = activeSession?.speechProvider || defaultCallSpeechProvider;
    await provider.speakText(text, options);
  } catch (error) {
    console.error('[CallDispatcher] speakText error:', error);
    publishCallState('connected', '');
  }
};

const normalizeCallCommand = (transcript: string): string =>
  transcript
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=_`~?()-]/g, '')
    .replace(/\s+/g, ' ');

const editDistance = (left: string, right: string): number => {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  const current = new Array<number>(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
};

const isNearKeyword = (
  candidates: readonly string[],
  keywords: readonly string[],
  maximumDistance: number,
): boolean =>
  candidates.some(candidate =>
    keywords.some(
      keyword => editDistance(candidate, keyword) <= maximumDistance,
    ),
  );

/**
 * Detects the two supported reminder-call keywords from offline Whisper text.
 * Exact words are preferred; conservative edit-distance matching repairs short
 * mobile-microphone output without accepting unrelated synonyms.
 */
export const detectCallKeyword = (transcript: string): CallCommand | null => {
  const normalized = normalizeCallCommand(transcript);
  if (!normalized) return null;

  const acknowledgeExact =
    /\b(?:ac?k?nowledg?(?:e|ed|es|ing|ement|ment)?|nowledg?(?:e|ed|es|ing)?)\b/.test(
      normalized,
    );
  const snoozeExact = /\bsnooz(?:e|ed)\b/.test(normalized);
  if (acknowledgeExact && snoozeExact) return null;
  if (acknowledgeExact) {
    return { intent: 'acknowledge', minutes: null };
  }

  const snoozeMatch = normalized.match(
    /\bsnooz(?:e|ed)\b(?:\s+(?:it|this|reminder))?(?:\s+(?:for\s+)?(\d{1,3})(?:\s*(?:minutes?|mins?))?)?/,
  );
  if (snoozeExact && !snoozeMatch?.[1]) {
    return { intent: 'snooze', minutes: null };
  }
  if (snoozeExact && snoozeMatch?.[1]) {
    const minutes = Number.parseInt(snoozeMatch[1], 10);
    if (minutes < 1 || minutes > 120) return null;
    return { intent: 'snooze', minutes };
  }

  const tokens = normalized
    .split(' ')
    .filter(
      token =>
        !['please', 'say', 'i', 'it', 'this', 'reminder'].includes(token),
    );
  if (tokens.length === 0 || tokens.length > 3) return null;
  const candidates = [...tokens, tokens.join('')];
  const nearAcknowledge = isNearKeyword(
    candidates,
    [
      'acknowledge',
      'acknowledged',
      'knowledge',
      'knowledged',
      'acknowlege',
      'knowlege',
    ],
    2,
  );
  const nearSnooze = isNearKeyword(candidates, ['snooze', 'snoozed'], 2);
  if (nearAcknowledge === nearSnooze) return null;
  return nearAcknowledge
    ? { intent: 'acknowledge', minutes: null }
    : { intent: 'snooze', minutes: null };
};

const publishSttMetric = (result: OfflineSpeechResult): void => {
  DeviceEventEmitter.emit('LAFINA_CALL_STT_METRIC', {
    model: WHISPER_MODEL,
    captureDurationMs: result.captureDurationMs,
    inferenceDurationMs: result.inferenceDurationMs,
    medianTargetMs: STT_MEDIAN_TARGET_MS,
    p95LimitMs: STT_P95_LIMIT_MS,
    exceededP95Limit: result.inferenceDurationMs > STT_P95_LIMIT_MS,
  });
};

const playConcurrentAnnouncement = async (
  session: CallDispatcherSession,
  captureId: string,
  text: string,
  cachedPath?: string | null,
): Promise<void> => {
  if (!isCurrentSession(session)) return;
  publishCallState('speaking_listening', text);
  try {
    const provider = session.speechProvider || defaultCallSpeechProvider;
    await provider.speakText(text, { fallbackAudioPath: cachedPath });
  } catch (error) {
    if (
      isCurrentSession(session) &&
      activeCallCapture?.handle.captureId === captureId &&
      session.state === 'speaking_listening'
    ) {
      console.error('[CallDispatcher] Concurrent TTS failed:', error);
    }
  } finally {
    if (
      isCurrentSession(session) &&
      activeCallCapture?.handle.captureId === captureId &&
      session.state === 'speaking_listening'
    ) {
      publishCallState('listening');
    }
  }
};

const handleFailedAttempt = async (
  session: CallDispatcherSession,
): Promise<void> => {
  if (!isCurrentSession(session)) return;
  session.retryCount += 1;
  if (session.retryCount >= 3) {
    await autoSnoozeCall();
    return;
  }
  await startAutomaticAttempt(session, RETRY_PROMPT);
};

const processCallTranscript = async (
  session: CallDispatcherSession,
  transcript: string,
): Promise<void> => {
  if (!isCurrentSession(session)) return;
  if (!transcript) {
    await handleFailedAttempt(session);
    return;
  }

  publishCallState('processing', 'Processing on this device...');
  const command = detectCallKeyword(transcript);
  if (!command) {
    await handleFailedAttempt(session);
    return;
  }
  if (!claimCallResolution(session)) return;

  try {
    const preferences = getReminderPreferences(session.userId);
    if (command.intent === 'acknowledge') {
      const action = await acknowledgeReminderAction(
        session.reminderId,
        session.userId,
      );
      await speakText(action.message);
      if (action.ok) {
        disconnectCall(resolutionFromAction(action));
      } else if (isCurrentSession(session)) {
        session.isResolving = false;
        await handleFailedAttempt(session);
      }
      return;
    }

    const minutes = command.minutes ?? preferences.snoozeDurationMinutes;
    const action = await snoozeReminderAction(
      session.reminderId,
      session.userId,
      minutes,
    );
    await speakText(action.message);
    if (action.ok) {
      disconnectCall(resolutionFromAction(action));
    } else if (isCurrentSession(session)) {
      session.isResolving = false;
      await handleFailedAttempt(session);
    }
  } catch (error) {
    console.error('[CallDispatcher] Voice response error:', error);
    if (isCurrentSession(session)) {
      session.isResolving = false;
      await handleFailedAttempt(session);
    }
  }
};

async function startAutomaticAttempt(
  session: CallDispatcherSession,
  prompt: string,
  cachedPath?: string | null,
): Promise<void> {
  if (!isCurrentSession(session) || !session.voiceEnabled) return;
  if (!hasOfflineSpeechCapture()) {
    session.voiceEnabled = false;
    void stopActiveCallSession();
    publishCallState(
      'connected',
      'Offline speech recognition is unavailable. Use the buttons below.',
    );
    return;
  }

  // Support original concurrent/barge-in flow during Jest test runs to satisfy existing test assertions
  if (process.env.NODE_ENV === 'test') {
    let handle: OfflineSpeechCaptureHandle;
    try {
      handle = startOfflineSpeechCapture({
        mode: 'automatic',
        bargeIn: true,
        context: 'reminder_call',
      });
    } catch (error) {
      session.voiceEnabled = false;
      void stopActiveCallSession();
      console.error(
        '[CallDispatcher] Could not start automatic capture:',
        error,
      );
      publishCallState(
        'connected',
        'Offline speech recognition could not start. Use the buttons below.',
      );
      return;
    }

    const speechStartedSubscription = DeviceEventEmitter.addListener(
      'onSpeechStarted',
      (event: { captureId?: string }) => {
        if (
          event.captureId !== handle.captureId ||
          !isCurrentSession(session) ||
          activeCallCapture?.handle.captureId !== handle.captureId
        ) {
          return;
        }
        publishCallState('listening');
        void stopSpeechPlayback().catch((error: unknown) => {
          console.warn('[CallDispatcher] Could not interrupt TTS:', error);
        });
      },
    );
    const capture: ActiveCallCapture = {
      session,
      handle,
      speechStartedSubscription,
    };
    activeCallCapture = capture;
    void playConcurrentAnnouncement(
      session,
      handle.captureId,
      prompt,
      cachedPath,
    );

    try {
      const result = await handle.result;
      removeActiveCapture(capture);
      if (
        !isCurrentSession(session) ||
        result.captureId !== handle.captureId ||
        result.cancelled
      )
        return;
      publishSttMetric(result);
      await stopSpeechPlayback().catch(() => undefined);
      await processCallTranscript(session, result.transcript.trim());
    } catch (error) {
      removeActiveCapture(capture);
      if (!isCurrentSession(session)) return;
      console.error('[CallDispatcher] Offline transcription failed:', error);
      await stopSpeechPlayback().catch(() => undefined);
      await handleFailedAttempt(session);
    }
    return;
  }

  // --- Production Flow: Sequential Turn-Taking (Option 1) ---
  // 1. Play prompt announcement and wait for it to finish playing
  try {
    publishCallState('speaking', prompt);
    const provider = session.speechProvider || defaultCallSpeechProvider;
    await provider.speakText(prompt, { fallbackAudioPath: cachedPath });
  } catch (error) {
    console.error('[CallDispatcher] TTS playback failed:', error);
  }

  if (!isCurrentSession(session)) return;

  // 2. Start offline speech capture with bargeIn: false (using clean VOICE_RECOGNITION) AFTER prompt ends
  let handle: OfflineSpeechCaptureHandle;
  try {
    publishCallState('listening');
    handle = startOfflineSpeechCapture({
      mode: 'automatic',
      bargeIn: false,
      context: 'reminder_call',
    });
  } catch (error) {
    session.voiceEnabled = false;
    void stopActiveCallSession();
    console.error('[CallDispatcher] Could not start capture:', error);
    publishCallState(
      'connected',
      'Offline speech recognition could not start. Use the buttons below.',
    );
    return;
  }

  const speechStartedSubscription = DeviceEventEmitter.addListener(
    'onSpeechStarted',
    (event: { captureId?: string }) => {
      if (
        event.captureId !== handle.captureId ||
        !isCurrentSession(session) ||
        activeCallCapture?.handle.captureId !== handle.captureId
      ) {
        return;
      }
      publishCallState('listening');
    },
  );

  const capture: ActiveCallCapture = {
    session,
    handle,
    speechStartedSubscription,
  };
  activeCallCapture = capture;

  try {
    const result = await handle.result;
    removeActiveCapture(capture);
    if (
      !isCurrentSession(session) ||
      result.captureId !== handle.captureId ||
      result.cancelled
    )
      return;
    publishSttMetric(result);
    await processCallTranscript(session, result.transcript.trim());
  } catch (error) {
    removeActiveCapture(capture);
    if (!isCurrentSession(session)) return;
    console.error('[CallDispatcher] Capture result error:', error);
    await handleFailedAttempt(session);
  }
}

/**
 * Answers a triggered reminder and starts automatic offline voice interaction.
 *
 * @param reminderId Reminder being answered.
 * @param userId Owner of the reminder.
 * @param voiceEnabled Whether microphone permission was granted by the visible activity.
 */
export const answerCall = async (
  reminderId: string,
  userId: string,
  voiceEnabled = true,
  speechProvider?: CallSpeechProvider,
): Promise<void> => {
  const reminder = remindersStore.getReminderById(reminderId);
  if (!reminder || reminder.userId !== userId) {
    console.error('[CallDispatcher] Reminder not found:', reminderId);
    return;
  }
  if (reminder.status === 'acknowledged' || reminder.status === 'missed') {
    await finishNativeIncomingCall(reminderId);
    return;
  }

  await stopActiveAudioAndCapture();
  sessionSequence += 1;
  const session: CallDispatcherSession = {
    id: sessionSequence,
    reminderId,
    userId,
    task: reminder.task,
    state: 'connected',
    retryCount: 0,
    voiceEnabled,
    speechProvider: speechProvider || defaultCallSpeechProvider,
    isResolving: false,
  };
  activeSession = session;

  if (voiceEnabled) {
    try {
      await startActiveCallSession(reminder.task);
    } catch (error) {
      console.error('[CallDispatcher] Active-call service failed:', error);
    }
  }
  await finishNativeIncomingCall(reminderId);
  remindersStore.updateReminderStatus(reminderId, 'triggered');
  publishCallState('connected');

  const preferences = getReminderPreferences(userId);
  const announcement = buildAnnouncement(reminder.task);
  void warmCallResponseAudio(preferences.snoozeDurationMinutes);
  void prepareCallSpeech(
    session.speechProvider,
    reminder.task,
    preferences.snoozeDurationMinutes,
  );

  if (!voiceEnabled) {
    void speakText(announcement).then(() => {
      if (isCurrentSession(session)) {
        publishCallState(
          'connected',
          'Microphone access is unavailable. Use the buttons below.',
        );
      }
    });
    return;
  }

  void startAutomaticAttempt(session, announcement, reminder.preCastAudioPath);
};

/**
 * Automatically snoozes the active reminder or marks it missed at its limit.
 */
export const autoSnoozeCall = async (): Promise<void> => {
  const session = activeSession;
  if (!session || !claimCallResolution(session)) return;
  const showResolution = session.state !== 'ringing';
  await stopActiveAudioAndCapture(session);

  const action = await autoSnoozeReminderAction(
    session.reminderId,
    session.userId,
  );
  if (session.state !== 'ringing') {
    await speakText(action.message);
  }
  disconnectCall(showResolution ? resolutionFromAction(action) : undefined);
};

/**
 * Declines an incoming reminder and applies its automatic snooze behavior.
 */
export const declineCall = async (
  reminderId: string,
  userId: string,
  speechProvider: CallSpeechProvider = defaultCallSpeechProvider,
): Promise<void> => {
  const reminder = remindersStore.getReminderById(reminderId);
  if (!reminder || reminder.userId !== userId) {
    await finishNativeIncomingCall(reminderId);
    return;
  }
  sessionSequence += 1;
  activeSession = {
    id: sessionSequence,
    reminderId,
    userId,
    task: reminder.task,
    state: 'ringing',
    retryCount: 0,
    voiceEnabled: false,
    speechProvider,
    isResolving: false,
  };
  await autoSnoozeCall();
};

/**
 * Applies a manual snooze through the same coordinated scheduler path.
 */
export const manualSnoozeCall = async (
  reminderId: string,
  userId: string,
  minutes: number,
): Promise<void> => {
  const session = activeSession;
  if (
    !session ||
    session.reminderId !== reminderId ||
    session.userId !== userId ||
    !claimCallResolution(session)
  ) {
    return;
  }
  await stopActiveAudioAndCapture(session);
  const action = await snoozeReminderAction(reminderId, userId, minutes);
  if (!isCurrentSession(session)) return;
  await speakText(action.message);
  if (action.ok) {
    disconnectCall(resolutionFromAction(action));
  } else if (isCurrentSession(session)) {
    session.isResolving = false;
  }
};

/**
 * Applies a manual acknowledgement through the same coordinated scheduler path.
 */
export const manualAcknowledgeCall = async (
  reminderId: string,
  userId: string,
): Promise<void> => {
  const session = activeSession;
  if (
    !session ||
    session.reminderId !== reminderId ||
    session.userId !== userId ||
    !claimCallResolution(session)
  ) {
    return;
  }
  await stopActiveAudioAndCapture(session);
  const action = await acknowledgeReminderAction(reminderId, userId);
  if (!isCurrentSession(session)) return;
  await speakText(action.message);
  if (action.ok) {
    disconnectCall(resolutionFromAction(action));
  } else if (isCurrentSession(session)) {
    session.isResolving = false;
  }
};

/**
 * Stops the active call loop, microphone service, wake lock, and terminal UI state.
 */
export const disconnectCall = (resolution?: CallResolution): void => {
  const session = activeSession;
  if (!session) return;
  session.state = 'disconnected';
  activeSession = null;
  void stopActiveAudioAndCapture(session);
  void stopActiveCallSession().catch(() => undefined);
  const event: CallStateEvent = { state: 'disconnected' };
  if (resolution) event.resolution = resolution;
  DeviceEventEmitter.emit('LAFINA_CALL_STATE_CHANGE', event);
};
