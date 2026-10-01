import { NativeModules } from 'react-native';

export type OfflineSpeechCaptureMode = 'manual' | 'automatic';

export interface OfflineSpeechCaptureOptions {
  mode: OfflineSpeechCaptureMode;
  bargeIn: boolean;
  context: 'main_mic' | 'reminder_call';
}

export interface OfflineSpeechResult {
  captureId: string;
  transcript: string;
  speechDetected: boolean;
  cancelled: boolean;
  captureDurationMs: number;
  inferenceDurationMs: number;
}

export interface OfflineSpeechCaptureHandle {
  captureId: string;
  result: Promise<OfflineSpeechResult>;
}

interface OfflineSpeechNativeModule {
  startListening: (
    options: OfflineSpeechCaptureOptions & { captureId: string },
  ) => Promise<OfflineSpeechResult>;
  stopListening: (captureId: string) => Promise<boolean>;
  cancelListening: (captureId: string) => Promise<boolean>;
}

let captureSequence = 0;
let activeCaptureId: string | null = null;

/**
 * Hard ceiling on how long one capture may own the shared microphone slot.
 *
 * A native result that never settles (killed audio HAL, wedged Whisper inference)
 * would otherwise keep `activeCaptureId` set for the life of the process, so every
 * later recording throws "another capture is already active" and voice input is
 * dead until the app restarts.
 */
const MAX_CAPTURE_DURATION_MS = 90_000;

const getNativeModule = (): OfflineSpeechNativeModule | null => {
  const module = NativeModules.LafinaSpeechToText as
    | OfflineSpeechNativeModule
    | undefined;
  return module?.startListening ? module : null;
};

/**
 * Stops a capture whose watchdog expired, ignoring any native failure.
 *
 * The microphone is released defensively: a timed-out capture must not keep
 * recording underneath the next one.
 */
const releaseTimedOutCapture = (
  module: OfflineSpeechNativeModule,
  captureId: string,
): void => {
  try {
    void module.cancelListening(captureId).catch((error: unknown) => {
      console.warn('[SpeechCapture] Could not cancel the timed-out capture:', error);
    });
  } catch (error) {
    console.warn('[SpeechCapture] Could not cancel the timed-out capture:', error);
  }
};

/**
 * Returns whether the shared on-device Silero VAD and Whisper.cpp bridge is linked.
 */
export const hasOfflineSpeechCapture = (): boolean =>
  getNativeModule() !== null;

/**
 * Atomically starts the single shared offline speech capture.
 *
 * @throws When the native runtime is unavailable or another capture owns the slot.
 */
export const startOfflineSpeechCapture = (
  options: OfflineSpeechCaptureOptions,
): OfflineSpeechCaptureHandle => {
  const module = getNativeModule();
  if (!module) {
    throw new Error('Offline speech recognition is unavailable.');
  }
  if (activeCaptureId !== null) {
    throw new Error('Another offline speech capture is already active.');
  }

  captureSequence += 1;
  const captureId = `${options.context}-${Date.now()}-${captureSequence}`;
  activeCaptureId = captureId;

  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const captureTimeout = new Promise<never>((_resolve, reject) => {
    watchdog = setTimeout(() => {
      releaseTimedOutCapture(module, captureId);
      reject(
        new Error(
          `Offline speech capture exceeded ${MAX_CAPTURE_DURATION_MS}ms and was stopped.`,
        ),
      );
    }, MAX_CAPTURE_DURATION_MS);
  });

  const result = Promise.race([
    module.startListening({ ...options, captureId }).then(nativeResult => {
      if (nativeResult.captureId !== captureId) {
        throw new Error(
          'Offline speech result did not match the active capture owner.',
        );
      }
      return nativeResult;
    }),
    captureTimeout,
  ]).finally(() => {
    if (watchdog) clearTimeout(watchdog);
    if (activeCaptureId === captureId) activeCaptureId = null;
  });
  return { captureId, result };
};

/**
 * Ends a matching manual capture and preserves its recorded audio for Whisper.
 */
export const stopOfflineSpeechCapture = async (
  captureId: string,
): Promise<boolean> => {
  const module = getNativeModule();
  if (!module) return false;
  return module.stopListening(captureId);
};

/**
 * Cancels a matching capture and discards its recorded audio and late result.
 */
export const cancelOfflineSpeechCapture = async (
  captureId: string,
): Promise<boolean> => {
  const module = getNativeModule();
  if (!module) {
    if (activeCaptureId === captureId) activeCaptureId = null;
    return false;
  }

  try {
    return await module.cancelListening(captureId);
  } finally {
    // A cancelled result is intentionally discarded by its caller. Release the
    // local owner even if a device fails to settle the native result promise.
    if (activeCaptureId === captureId) activeCaptureId = null;
  }
};

/**
 * Returns the JavaScript-side owner of the shared capture slot for diagnostics.
 */
export const getActiveOfflineCaptureId = (): string | null => activeCaptureId;
