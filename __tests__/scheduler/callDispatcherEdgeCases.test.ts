import { DeviceEventEmitter, NativeModules } from 'react-native';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { remindersStore } from '../../src/storage/remindersStore';
import {
  cancelOfflineSpeechCapture,
  hasOfflineSpeechCapture,
  startOfflineSpeechCapture,
} from '../../src/ai/native/speechCapture';
import type { OfflineSpeechResult } from '../../src/ai/native/speechCapture';
import {
  stopSpeechPlayback,
  synthesizeSpeech,
} from '../../src/ai/tts/ttsService';
import {
  acknowledgeReminderAction,
  snoozeReminderAction,
} from '../../src/scheduler/reminderActions';
import type { ReminderActionResult } from '../../src/scheduler/reminderActions';
import {
  answerCall,
  declineCall,
  disconnectCall,
  manualAcknowledgeCall,
  manualSnoozeCall,
} from '../../src/scheduler/callDispatcher';
import type { CallStateEvent } from '../../src/scheduler/callDispatcher';

const emitMock = DeviceEventEmitter.emit as jest.MockedFunction<
  typeof DeviceEventEmitter.emit
>;

const hasCaptureMock = jest.mocked(hasOfflineSpeechCapture);
const startCaptureMock = jest.mocked(startOfflineSpeechCapture);
const cancelCaptureMock = jest.mocked(cancelOfflineSpeechCapture);
const synthesizeMock = jest.mocked(synthesizeSpeech);
const stopPlaybackMock = jest.mocked(stopSpeechPlayback);
const acknowledgeMock = jest.mocked(acknowledgeReminderAction);
const snoozeMock = jest.mocked(snoozeReminderAction);

let speechStartedListener: ((event: { captureId?: string }) => void) | null =
  null;
let mockExternalAudioSubscription: { remove: jest.Mock } | null = null;

jest.mock('react-native', () => {
  const rn = jest.requireActual('react-native');
  rn.NativeModules.LafinaReminder = {
    scheduleExactAlarm: jest.fn(),
    cancelAlarm: jest.fn(),
    finishIncomingCall: jest.fn(),
    startActiveCall: jest.fn(),
    stopActiveCall: jest.fn(),
    consumePendingCall: jest.fn(),
  };
  rn.NativeModules.LafinaTTS = {
    synthesize: jest.fn(),
    playAudio: jest.fn(),
    stopAudio: jest.fn(),
  };
  rn.NativeModules.LafinaSpeechToText = {
    startListening: jest.fn(),
    stopListening: jest.fn(),
    cancelListening: jest.fn(),
  };
  rn.DeviceEventEmitter.emit = jest.fn();
  rn.DeviceEventEmitter.addListener = jest.fn(
    (eventName: string, listener: (event: { captureId?: string }) => void) => {
      if (eventName === 'onSpeechStarted') speechStartedListener = listener;
      if (eventName === 'LAFINA_EXTERNAL_AUDIO_INTERRUPTED') {
        mockExternalAudioSubscription = { remove: jest.fn() };
        return mockExternalAudioSubscription;
      }
      return { remove: jest.fn() };
    },
  );
  return rn;
});

jest.mock('../../src/ai/native/speechCapture', () => {
  const actual = jest.requireActual('../../src/ai/native/speechCapture');
  return {
    ...actual,
    hasOfflineSpeechCapture: jest.fn(actual.hasOfflineSpeechCapture),
    startOfflineSpeechCapture: jest.fn(actual.startOfflineSpeechCapture),
    cancelOfflineSpeechCapture: jest.fn(actual.cancelOfflineSpeechCapture),
  };
});

jest.mock('../../src/ai/tts/ttsService', () => {
  const actual = jest.requireActual('../../src/ai/tts/ttsService');
  return {
    ...actual,
    synthesizeSpeech: jest.fn(actual.synthesizeSpeech),
    speakTextWithTts: jest.fn(actual.speakTextWithTts),
    playSpeechFile: jest.fn(actual.playSpeechFile),
    stopSpeechPlayback: jest.fn(actual.stopSpeechPlayback),
    deletePreCachedReminderAudio: jest.fn(actual.deletePreCachedReminderAudio),
  };
});

jest.mock('../../src/scheduler/reminderActions', () => {
  const actual = jest.requireActual('../../src/scheduler/reminderActions');
  return {
    ...actual,
    snoozeReminderAction: jest.fn(actual.snoozeReminderAction),
    acknowledgeReminderAction: jest.fn(actual.acknowledgeReminderAction),
    autoSnoozeReminderAction: jest.fn(actual.autoSnoozeReminderAction),
  };
});

const actualSpeechCapture = jest.requireActual<
  typeof import('../../src/ai/native/speechCapture')
>('../../src/ai/native/speechCapture');
const actualReminderActions = jest.requireActual<
  typeof import('../../src/scheduler/reminderActions')
>('../../src/scheduler/reminderActions');
const actualTtsService = jest.requireActual<
  typeof import('../../src/ai/tts/ttsService')
>('../../src/ai/tts/ttsService');

const sttResult = (transcript: string, captureId = 'native-capture') => ({
  captureId,
  transcript,
  speechDetected: transcript.length > 0,
  cancelled: false,
  captureDurationMs: 1_800,
  inferenceDurationMs: 900,
});

const nativeSpeechResult =
  (transcript: string) =>
  (options: { captureId: string }): Promise<ReturnType<typeof sttResult>> =>
    Promise.resolve(sttResult(transcript, options.captureId));

const pendingCapture =
  (onPending: (resolve: (result: OfflineSpeechResult) => void) => void) =>
  (options: { captureId: string }) =>
    new Promise<OfflineSpeechResult>(resolve => {
      onPending(result => resolve({ ...result, captureId: options.captureId }));
    });

const flushPromises = async (): Promise<void> => {
  for (let index = 0; index < 100; index += 1) await Promise.resolve();
};

const insertReminder = (id: string, task = 'Math Homework'): void => {
  remindersStore.insertReminder({
    id,
    userId: 'user1',
    task,
    description: null,
    scheduledAt: new Date().toISOString(),
    triggerAt: new Date().toISOString(),
    status: 'pending',
    preCastAudioPath: null,
  });
};

const makeProvider = () => ({
  speakText: jest.fn().mockResolvedValue({ source: 'kokoro' as const }),
  stopSpeech: jest.fn().mockResolvedValue(undefined),
  prepareText: jest.fn().mockResolvedValue(undefined),
});

const rejection = (message: string): ReminderActionResult => ({
  ok: false,
  outcome: 'rejected',
  triggerAt: null,
  message,
});

const listeningEmissions = (): number =>
  emitMock.mock.calls.filter(
    call => (call[1] as CallStateEvent | undefined)?.state === 'listening',
  ).length;

let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

describe('callDispatcher turn-taking and failure handling', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM users');
    db.executeSync(
      'INSERT INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ['user1', 'testuser', new Date().toISOString(), new Date().toISOString()],
    );

    jest.clearAllMocks();
    emitMock.mockImplementation(() => undefined);
    speechStartedListener = null;
    mockExternalAudioSubscription = null;

    hasCaptureMock
      .mockReset()
      .mockImplementation(actualSpeechCapture.hasOfflineSpeechCapture);
    startCaptureMock
      .mockReset()
      .mockImplementation(actualSpeechCapture.startOfflineSpeechCapture);
    cancelCaptureMock
      .mockReset()
      .mockImplementation(actualSpeechCapture.cancelOfflineSpeechCapture);
    synthesizeMock
      .mockReset()
      .mockImplementation(actualTtsService.synthesizeSpeech);
    stopPlaybackMock
      .mockReset()
      .mockImplementation(actualTtsService.stopSpeechPlayback);
    acknowledgeMock
      .mockReset()
      .mockImplementation(actualReminderActions.acknowledgeReminderAction);
    snoozeMock
      .mockReset()
      .mockImplementation(actualReminderActions.snoozeReminderAction);

    NativeModules.LafinaReminder.scheduleExactAlarm
      .mockReset()
      .mockResolvedValue(true);
    NativeModules.LafinaReminder.cancelAlarm
      .mockReset()
      .mockResolvedValue(true);
    NativeModules.LafinaReminder.finishIncomingCall
      .mockReset()
      .mockResolvedValue(true);
    NativeModules.LafinaReminder.startActiveCall
      .mockReset()
      .mockResolvedValue(true);
    NativeModules.LafinaReminder.stopActiveCall
      .mockReset()
      .mockResolvedValue(true);
    NativeModules.LafinaSpeechToText.startListening
      .mockReset()
      .mockImplementation(nativeSpeechResult('acknowledge'));
    NativeModules.LafinaSpeechToText.cancelListening
      .mockReset()
      .mockResolvedValue(true);
    NativeModules.LafinaTTS.stopAudio.mockReset().mockResolvedValue(true);

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    disconnectCall();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('runs the sequential turn-taking flow on device', async () => {
    insertReminder('rem-prod');
    const provider = makeProvider();
    process.env.NODE_ENV = 'production';

    await answerCall('rem-prod', 'user1', true, provider);
    await flushPromises();

    expect(
      NativeModules.LafinaSpeechToText.startListening,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'automatic',
        bargeIn: false,
        context: 'reminder_call',
      }),
    );
    expect(emitMock).toHaveBeenCalledWith('LAFINA_CALL_STATE_CHANGE', {
      state: 'speaking',
      text: expect.stringContaining('Math Homework'),
    });
    expect(emitMock).toHaveBeenCalledWith('LAFINA_CALL_STATE_CHANGE', {
      state: 'listening',
    });
    expect(provider.speakText).toHaveBeenCalledWith(
      expect.stringContaining('Math Homework'),
      { fallbackAudioPath: null },
    );
    expect(remindersStore.getReminderById('rem-prod')?.status).toBe(
      'acknowledged',
    );
  });

  it('keeps the call alive when the on-device announcement fails', async () => {
    insertReminder('rem-prod-tts');
    const provider = makeProvider();
    provider.speakText.mockRejectedValueOnce(new Error('tts offline'));
    process.env.NODE_ENV = 'production';

    await answerCall('rem-prod-tts', 'user1', true, provider);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] TTS playback failed:',
      expect.any(Error),
    );
    expect(
      NativeModules.LafinaSpeechToText.startListening,
    ).toHaveBeenCalledTimes(1);
    expect(remindersStore.getReminderById('rem-prod-tts')?.status).toBe(
      'acknowledged',
    );
  });

  it('hands back to the buttons when the on-device capture cannot start', async () => {
    insertReminder('rem-prod-nocapture');
    const provider = makeProvider();
    startCaptureMock.mockImplementationOnce(() => {
      throw new Error('microphone busy');
    });
    process.env.NODE_ENV = 'production';

    await answerCall('rem-prod-nocapture', 'user1', true, provider);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Could not start capture:',
      expect.any(Error),
    );
    expect(emitMock).toHaveBeenCalledWith('LAFINA_CALL_STATE_CHANGE', {
      state: 'connected',
      text: 'Offline speech recognition could not start. Use the buttons below.',
    });
    expect(NativeModules.LafinaReminder.stopActiveCall).toHaveBeenCalled();
    expect(remindersStore.getReminderById('rem-prod-nocapture')?.status).toBe(
      'triggered',
    );
  });

  it('retries the on-device attempt after a capture rejection', async () => {
    insertReminder('rem-prod-reject');
    const provider = makeProvider();
    NativeModules.LafinaSpeechToText.startListening
      .mockReset()
      .mockImplementationOnce(() => Promise.reject(new Error('stt crashed')))
      .mockImplementation(nativeSpeechResult('acknowledge'));
    process.env.NODE_ENV = 'production';

    await answerCall('rem-prod-reject', 'user1', true, provider);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Capture result error:',
      expect.any(Error),
    );
    expect(
      NativeModules.LafinaSpeechToText.startListening,
    ).toHaveBeenCalledTimes(2);
    expect(remindersStore.getReminderById('rem-prod-reject')?.status).toBe(
      'acknowledged',
    );
  });

  it('ignores a cancelled on-device capture result', async () => {
    insertReminder('rem-prod-cancelled');
    const provider = makeProvider();
    NativeModules.LafinaSpeechToText.startListening.mockImplementation(
      (options: { captureId: string }) =>
        Promise.resolve({
          ...sttResult('acknowledge', options.captureId),
          cancelled: true,
        }),
    );
    process.env.NODE_ENV = 'production';

    await answerCall('rem-prod-cancelled', 'user1', true, provider);
    await flushPromises();

    expect(remindersStore.getReminderById('rem-prod-cancelled')?.status).toBe(
      'triggered',
    );
  });

  it('only republishes listening for the matching on-device capture', async () => {
    insertReminder('rem-prod-speech');
    const provider = makeProvider();
    let resolveCapture!: (result: OfflineSpeechResult) => void;
    NativeModules.LafinaSpeechToText.startListening.mockImplementationOnce(
      pendingCapture(resolve => {
        resolveCapture = resolve;
      }),
    );
    process.env.NODE_ENV = 'production';

    await answerCall('rem-prod-speech', 'user1', true, provider);
    await flushPromises();
    const request =
      NativeModules.LafinaSpeechToText.startListening.mock.calls[0][0];
    const beforeMismatch = listeningEmissions();

    speechStartedListener?.({ captureId: 'some-other-capture' });
    await flushPromises();
    expect(listeningEmissions()).toBe(beforeMismatch);

    speechStartedListener?.({ captureId: request.captureId });
    await flushPromises();
    expect(listeningEmissions()).toBe(beforeMismatch + 1);

    resolveCapture({ ...sttResult('acknowledge', request.captureId), cancelled: true });
    await flushPromises();
  });

  it('barges in only for the matching capture and reports a failed interrupt', async () => {
    insertReminder('rem-barge-edge');
    let resolveCapture!: (result: OfflineSpeechResult) => void;
    NativeModules.LafinaSpeechToText.startListening.mockImplementationOnce(
      pendingCapture(resolve => {
        resolveCapture = resolve;
      }),
    );
    await answerCall('rem-barge-edge', 'user1', true);
    await flushPromises();
    const request =
      NativeModules.LafinaSpeechToText.startListening.mock.calls[0][0];

    stopPlaybackMock.mockClear();
    stopPlaybackMock.mockRejectedValueOnce(new Error('stop refused'));
    speechStartedListener?.({});
    await flushPromises();
    expect(stopPlaybackMock).not.toHaveBeenCalled();

    speechStartedListener?.({ captureId: request.captureId });
    await flushPromises();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Could not interrupt TTS:',
      expect.any(Error),
    );
    expect(emitMock).toHaveBeenCalledWith('LAFINA_CALL_STATE_CHANGE', {
      state: 'listening',
    });

    resolveCapture({ ...sttResult('acknowledge', request.captureId), cancelled: true });
    await flushPromises();
  });

  it('moves to listening when the concurrent announcement finishes', async () => {
    insertReminder('rem-concurrent-done');
    const provider = makeProvider();
    let finishAnnouncement!: () => void;
    let resolveCapture!: (result: OfflineSpeechResult) => void;
    provider.speakText.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishAnnouncement = () => resolve({ source: 'kokoro' as const });
        }),
    );
    NativeModules.LafinaSpeechToText.startListening.mockImplementationOnce(
      pendingCapture(resolve => {
        resolveCapture = resolve;
      }),
    );

    await answerCall('rem-concurrent-done', 'user1', true, provider);
    finishAnnouncement();
    await flushPromises();

    expect(listeningEmissions()).toBeGreaterThanOrEqual(1);

    resolveCapture(sttResult('', 'native-capture'));
    await flushPromises();
  });

  it('reports a failed concurrent announcement', async () => {
    insertReminder('rem-concurrent-fail');
    const provider = makeProvider();
    let resolveCapture!: (result: OfflineSpeechResult) => void;
    provider.speakText.mockImplementationOnce(() =>
      Promise.reject(new Error('concurrent tts down')),
    );
    NativeModules.LafinaSpeechToText.startListening.mockImplementationOnce(
      pendingCapture(resolve => {
        resolveCapture = resolve;
      }),
    );

    await answerCall('rem-concurrent-fail', 'user1', true, provider);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Concurrent TTS failed:',
      expect.any(Error),
    );

    resolveCapture({ ...sttResult('acknowledge'), cancelled: true });
    await flushPromises();
  });

  it('hands back to the buttons when the automatic capture cannot start', async () => {
    insertReminder('rem-automatic-nocapture');
    startCaptureMock.mockImplementationOnce(() => {
      throw new Error('capture slot busy');
    });

    await answerCall('rem-automatic-nocapture', 'user1', true);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Could not start automatic capture:',
      expect.any(Error),
    );
    expect(emitMock).toHaveBeenCalledWith('LAFINA_CALL_STATE_CHANGE', {
      state: 'connected',
      text: 'Offline speech recognition could not start. Use the buttons below.',
    });
    expect(NativeModules.LafinaReminder.stopActiveCall).toHaveBeenCalled();
  });

  it('hands back to the buttons when offline speech capture is missing', async () => {
    insertReminder('rem-no-offline-stt');
    hasCaptureMock.mockReturnValueOnce(false);

    await answerCall('rem-no-offline-stt', 'user1', true);
    await flushPromises();

    expect(emitMock).toHaveBeenCalledWith('LAFINA_CALL_STATE_CHANGE', {
      state: 'connected',
      text: 'Offline speech recognition is unavailable. Use the buttons below.',
    });
    expect(
      NativeModules.LafinaSpeechToText.startListening,
    ).not.toHaveBeenCalled();
    expect(NativeModules.LafinaReminder.stopActiveCall).toHaveBeenCalled();
    expect(remindersStore.getReminderById('rem-no-offline-stt')?.status).toBe(
      'triggered',
    );
  });

  it('retries empty transcripts until the automatic snooze limit', async () => {
    insertReminder('rem-silent');
    NativeModules.LafinaSpeechToText.startListening
      .mockReset()
      .mockImplementation(nativeSpeechResult(''));

    await answerCall('rem-silent', 'user1', true);
    await flushPromises();

    expect(
      NativeModules.LafinaSpeechToText.startListening,
    ).toHaveBeenCalledTimes(3);
    expect(remindersStore.getReminderById('rem-silent')?.status).toBe(
      'snoozed',
    );
  });

  it('retries a rejected acknowledgement then auto-snoozes at the limit', async () => {
    insertReminder('rem-ack-rejected');
    acknowledgeMock.mockImplementation(() =>
      Promise.resolve(rejection('I could not acknowledge this reminder.')),
    );

    await answerCall('rem-ack-rejected', 'user1', true);
    await flushPromises();

    expect(acknowledgeMock).toHaveBeenCalledTimes(3);
    expect(remindersStore.getReminderById('rem-ack-rejected')?.status).toBe(
      'snoozed',
    );
  });

  it('retries a rejected snooze then auto-snoozes at the limit', async () => {
    insertReminder('rem-snooze-rejected');
    NativeModules.LafinaSpeechToText.startListening
      .mockReset()
      .mockImplementation(nativeSpeechResult('snooze 10'));
    snoozeMock.mockImplementation(() =>
      Promise.resolve(rejection('I could not reschedule this reminder.')),
    );

    await answerCall('rem-snooze-rejected', 'user1', true);
    await flushPromises();

    expect(snoozeMock).toHaveBeenCalledWith(
      'rem-snooze-rejected',
      'user1',
      10,
    );
    expect(remindersStore.getReminderById('rem-snooze-rejected')?.status).toBe(
      'snoozed',
    );
  });

  it('recovers when the snooze action throws', async () => {
    insertReminder('rem-snooze-throws');
    NativeModules.LafinaSpeechToText.startListening
      .mockReset()
      .mockImplementation(nativeSpeechResult('snooze 10'));
    snoozeMock.mockImplementationOnce(() =>
      Promise.reject(new Error('snooze crashed')),
    );

    await answerCall('rem-snooze-throws', 'user1', true);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Voice response error:',
      expect.any(Error),
    );
    expect(remindersStore.getReminderById('rem-snooze-throws')?.status).toBe(
      'snoozed',
    );
  });

  it('retries after a rejected automatic capture result', async () => {
    insertReminder('rem-stt-rejected');
    NativeModules.LafinaSpeechToText.startListening
      .mockReset()
      .mockImplementationOnce(() => Promise.reject(new Error('stt down')))
      .mockImplementation(nativeSpeechResult('acknowledge'));

    await answerCall('rem-stt-rejected', 'user1', true);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Offline transcription failed:',
      expect.any(Error),
    );
    expect(remindersStore.getReminderById('rem-stt-rejected')?.status).toBe(
      'acknowledged',
    );
  });

  it('warns when the offline capture cannot be cancelled', async () => {
    insertReminder('rem-cancel-failure');
    let resolveCapture!: (result: OfflineSpeechResult) => void;
    NativeModules.LafinaSpeechToText.startListening.mockImplementationOnce(
      pendingCapture(resolve => {
        resolveCapture = resolve;
      }),
    );
    // Reject inside the native bridge so the shared capture slot is still released.
    NativeModules.LafinaSpeechToText.cancelListening.mockRejectedValueOnce(
      new Error('cancel refused'),
    );

    await answerCall('rem-cancel-failure', 'user1', true);
    disconnectCall();
    await flushPromises();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Could not cancel offline capture:',
      expect.any(Error),
    );

    resolveCapture({ ...sttResult('acknowledge'), cancelled: true });
    await flushPromises();
  });

  it('warns when the response audio warm-up fails', async () => {
    insertReminder('rem-warmer');
    synthesizeMock.mockImplementationOnce(() =>
      Promise.reject(new Error('kokoro unavailable')),
    );

    await answerCall('rem-warmer', 'user1', false);
    await flushPromises();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Could not warm response audio:',
      expect.any(Error),
    );
  });

  it('warns when preparing call speech fails', async () => {
    insertReminder('rem-prepare');
    const provider = makeProvider();
    provider.prepareText.mockRejectedValueOnce(new Error('prepare failed'));

    await answerCall('rem-prepare', 'user1', false, provider);
    await flushPromises();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Could not prepare call speech:',
      expect.any(Error),
    );
  });

  it('recovers the visible call state when speakText fails', async () => {
    insertReminder('rem-speak-failure');
    const provider = makeProvider();
    provider.speakText.mockRejectedValue(new Error('speaker busy'));

    await answerCall('rem-speak-failure', 'user1', false, provider);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] speakText error:',
      expect.any(Error),
    );
    expect(emitMock).toHaveBeenCalledWith('LAFINA_CALL_STATE_CHANGE', {
      state: 'connected',
      text: '',
    });
  });

  it('rejects answering an unknown or foreign reminder', async () => {
    insertReminder('rem-foreign');

    await answerCall('rem-missing', 'user1', true);
    await answerCall('rem-foreign', 'user2', true);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Reminder not found:',
      'rem-missing',
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Reminder not found:',
      'rem-foreign',
    );
    expect(
      NativeModules.LafinaSpeechToText.startListening,
    ).not.toHaveBeenCalled();
  });

  it.each(['acknowledged', 'missed'] as const)(
    'finishes a reminder that is already %s without starting the microphone',
    async status => {
      const id = `rem-already-${status}`;
      insertReminder(id);
      remindersStore.updateReminderStatus(id, status);

      await answerCall(id, 'user1', true);
      await flushPromises();

      expect(
        NativeModules.LafinaReminder.finishIncomingCall,
      ).toHaveBeenCalledWith(id);
      expect(
        NativeModules.LafinaSpeechToText.startListening,
      ).not.toHaveBeenCalled();
      expect(remindersStore.getReminderById(id)?.status).toBe(status);
    },
  );

  it('continues when the foreground call service fails to start', async () => {
    insertReminder('rem-service-failure');
    NativeModules.LafinaReminder.startActiveCall.mockRejectedValueOnce(
      new Error('service denied'),
    );

    await answerCall('rem-service-failure', 'user1', true);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Active-call service failed:',
      expect.any(Error),
    );
    expect(
      NativeModules.LafinaSpeechToText.startListening,
    ).toHaveBeenCalledTimes(1);
  });

  it('declines an unknown reminder through the native cleanup only', async () => {
    await declineCall('rem-decline-missing', 'user1');

    expect(NativeModules.LafinaReminder.finishIncomingCall).toHaveBeenCalledWith(
      'rem-decline-missing',
    );
    expect(NativeModules.LafinaReminder.cancelAlarm).not.toHaveBeenCalled();
  });

  it('ignores manual controls without a matching live session', async () => {
    insertReminder('rem-no-session');

    await manualSnoozeCall('rem-no-session', 'user1', 10);
    await manualAcknowledgeCall('rem-no-session', 'user1');

    insertReminder('rem-live');
    await answerCall('rem-live', 'user1', false);
    await manualSnoozeCall('rem-other', 'user1', 10);
    await manualAcknowledgeCall('rem-live', 'user2');

    expect(remindersStore.getReminderById('rem-live')?.status).toBe(
      'triggered',
    );
    expect(NativeModules.LafinaReminder.cancelAlarm).not.toHaveBeenCalled();
  });

  it('releases the resolution lock when a manual snooze is rejected', async () => {
    insertReminder('rem-manual-snooze');
    await answerCall('rem-manual-snooze', 'user1', false);
    snoozeMock.mockImplementationOnce(() =>
      Promise.resolve(rejection('I could not reschedule this reminder.')),
    );

    await manualSnoozeCall('rem-manual-snooze', 'user1', 10);
    expect(remindersStore.getReminderById('rem-manual-snooze')?.status).toBe(
      'triggered',
    );

    await manualSnoozeCall('rem-manual-snooze', 'user1', 10);
    expect(snoozeMock).toHaveBeenCalledTimes(2);
    expect(remindersStore.getReminderById('rem-manual-snooze')?.status).toBe(
      'snoozed',
    );
  });

  it('releases the resolution lock when a manual acknowledgement is rejected', async () => {
    insertReminder('rem-manual-ack');
    await answerCall('rem-manual-ack', 'user1', false);
    acknowledgeMock.mockImplementationOnce(() =>
      Promise.resolve(rejection('I could not acknowledge this reminder.')),
    );

    await manualAcknowledgeCall('rem-manual-ack', 'user1');
    expect(remindersStore.getReminderById('rem-manual-ack')?.status).toBe(
      'triggered',
    );

    await manualAcknowledgeCall('rem-manual-ack', 'user1');
    expect(acknowledgeMock).toHaveBeenCalledTimes(2);
    expect(remindersStore.getReminderById('rem-manual-ack')?.status).toBe(
      'acknowledged',
    );
  });

  it('hands a colliding reminder back to the scheduler instead of stranding it', async () => {
    insertReminder('rem-first', 'Physics Lab');
    insertReminder('rem-second', 'Thesis Defence');

    await answerCall('rem-first', 'user1', false);
    await answerCall('rem-second', 'user1', false);
    await flushPromises();

    // The first call cannot be heard anyway, so it is re-armed rather than dropped.
    expect(remindersStore.getReminderById('rem-first')?.status).toBe('snoozed');
    expect(new Date(remindersStore.getReminderById('rem-first')?.triggerAt ?? '').getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(remindersStore.getReminderById('rem-second')?.status).toBe(
      'triggered',
    );
  });

  it('ignores a second Answer tap for the reminder that is already ringing', async () => {
    insertReminder('rem-double-tap');
    let resolveCapture!: (result: OfflineSpeechResult) => void;
    NativeModules.LafinaSpeechToText.startListening.mockImplementationOnce(
      pendingCapture(resolve => {
        resolveCapture = resolve;
      }),
    );

    await answerCall('rem-double-tap', 'user1', true);
    await flushPromises();
    await answerCall('rem-double-tap', 'user1', true);
    await flushPromises();

    expect(NativeModules.LafinaReminder.startActiveCall).toHaveBeenCalledTimes(
      1,
    );
    expect(
      NativeModules.LafinaSpeechToText.startListening,
    ).toHaveBeenCalledTimes(1);
    expect(remindersStore.getReminderById('rem-double-tap')?.status).toBe(
      'triggered',
    );

    resolveCapture({
      ...sttResult('acknowledge'),
      cancelled: true,
    });
    await flushPromises();
  });

  it('refuses to replace a call that is still resolving a manual action', async () => {
    insertReminder('rem-resolving', 'Algorithms Quiz');
    insertReminder('rem-late', 'Chemistry Lab');
    await answerCall('rem-resolving', 'user1', false);

    let releaseSnooze!: (value: ReminderActionResult) => void;
    snoozeMock.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseSnooze = resolve;
        }),
    );
    const pendingSnooze = manualSnoozeCall('rem-resolving', 'user1', 10);
    await flushPromises();

    await answerCall('rem-late', 'user1', false);
    await flushPromises();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[CallDispatcher] Refusing to replace a call that is still resolving:',
      'rem-late',
    );
    // The colliding reminder is left untouched for the scheduler to offer again.
    expect(remindersStore.getReminderById('rem-late')?.status).toBe('pending');

    releaseSnooze({
      ok: true,
      outcome: 'snoozed',
      triggerAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      message: 'Snoozed for 10 minutes.',
    });
    await pendingSnooze;

    expect(emitMock).toHaveBeenCalledWith(
      'LAFINA_CALL_STATE_CHANGE',
      expect.objectContaining({
        state: 'disconnected',
        resolution: expect.objectContaining({ outcome: 'snoozed' }),
      }),
    );
  });

  it('stops listening for external audio interruptions once the call ends', async () => {
    insertReminder('rem-edge-unsubscribe');

    await answerCall('rem-edge-unsubscribe', 'user1', false);
    expect(mockExternalAudioSubscription).not.toBeNull();

    disconnectCall();

    expect(mockExternalAudioSubscription?.remove).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(remindersStore.getReminderById('rem-edge-unsubscribe')?.status).toBe(
      'triggered',
    );
  });
});
