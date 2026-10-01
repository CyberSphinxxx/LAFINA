/**
 * Chaos tests for a wedged offline speech capture.
 *
 * A native capture that never settles used to hold the shared microphone slot for
 * the life of the process, which made every later recording fail with "another
 * capture is already active" until the app was restarted.
 */
import { NativeModules } from 'react-native';
import {
  getActiveOfflineCaptureId,
  startOfflineSpeechCapture,
} from '../../src/ai/native/speechCapture';
import type { OfflineSpeechResult } from '../../src/ai/native/speechCapture';

const nativeResult = (captureId: string, transcript = 'snooze'): OfflineSpeechResult => ({
  captureId,
  transcript,
  speechDetected: true,
  cancelled: false,
  captureDurationMs: 1_200,
  inferenceDurationMs: 400,
});

describe('offline capture watchdog', () => {
  afterEach(() => {
    delete NativeModules.LafinaSpeechToText;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('releases the shared microphone slot when the native result never settles', async () => {
    const cancelListening = jest.fn().mockResolvedValue(true);
    NativeModules.LafinaSpeechToText = {
      startListening: jest.fn(() => new Promise(() => undefined)),
      stopListening: jest.fn().mockResolvedValue(true),
      cancelListening,
    };
    jest.useFakeTimers();

    const capture = startOfflineSpeechCapture({
      mode: 'automatic',
      bargeIn: false,
      context: 'reminder_call',
    });
    expect(getActiveOfflineCaptureId()).toBe(capture.captureId);

    const settled = capture.result.catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(90_000);
    const error = await settled;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('exceeded');
    expect(cancelListening).toHaveBeenCalledWith(capture.captureId);
    expect(getActiveOfflineCaptureId()).toBeNull();
  });

  it('lets the next recording start after a timed-out capture', async () => {
    const cancelListening = jest.fn().mockResolvedValue(true);
    NativeModules.LafinaSpeechToText = {
      startListening: jest.fn(() => new Promise(() => undefined)),
      stopListening: jest.fn().mockResolvedValue(true),
      cancelListening,
    };
    jest.useFakeTimers();

    const stuck = startOfflineSpeechCapture({
      mode: 'automatic',
      bargeIn: false,
      context: 'reminder_call',
    });
    const settled = stuck.result.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(90_000);
    await settled;

    NativeModules.LafinaSpeechToText.startListening = jest.fn(
      (options: { captureId: string }) =>
        Promise.resolve(nativeResult(options.captureId, 'acknowledge')),
    );
    const recovered = startOfflineSpeechCapture({
      mode: 'manual',
      bargeIn: false,
      context: 'main_mic',
    });

    await expect(recovered.result).resolves.toMatchObject({
      transcript: 'acknowledge',
    });
    expect(getActiveOfflineCaptureId()).toBeNull();
  });

  it('keeps a capture that is still inside its budget', async () => {
    let resolveNative!: (result: OfflineSpeechResult) => void;
    NativeModules.LafinaSpeechToText = {
      startListening: jest.fn(
        (options: { captureId: string }) =>
          new Promise<OfflineSpeechResult>(resolve => {
            resolveNative = result => resolve(result);
            options.captureId;
          }),
      ),
      stopListening: jest.fn().mockResolvedValue(true),
      cancelListening: jest.fn().mockResolvedValue(true),
    };
    jest.useFakeTimers();

    const capture = startOfflineSpeechCapture({
      mode: 'automatic',
      bargeIn: true,
      context: 'reminder_call',
    });
    await jest.advanceTimersByTimeAsync(89_000);
    expect(getActiveOfflineCaptureId()).toBe(capture.captureId);

    resolveNative(nativeResult(capture.captureId, 'acknowledge'));
    await expect(capture.result).resolves.toMatchObject({
      transcript: 'acknowledge',
    });
    expect(getActiveOfflineCaptureId()).toBeNull();
  });

  it('still releases the slot when the native cancel itself fails', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    NativeModules.LafinaSpeechToText = {
      startListening: jest.fn(() => new Promise(() => undefined)),
      stopListening: jest.fn().mockResolvedValue(true),
      cancelListening: jest.fn().mockRejectedValue(new Error('no audio device')),
    };
    jest.useFakeTimers();

    const capture = startOfflineSpeechCapture({
      mode: 'automatic',
      bargeIn: false,
      context: 'reminder_call',
    });
    const settled = capture.result.catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(90_000);
    await settled;

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[SpeechCapture] Could not cancel the timed-out capture:',
      expect.any(Error),
    );
    expect(getActiveOfflineCaptureId()).toBeNull();
    consoleWarnSpy.mockRestore();
  });
});
