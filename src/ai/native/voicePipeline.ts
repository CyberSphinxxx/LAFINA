import { NativeModules, PermissionsAndroid } from 'react-native';
import { AI_MODEL_ASSETS } from '../modelAssets';
import { parseNluJson } from '../nlu/jsonParser';
import { buildNluPrompt } from '../nlu/prompt';
import { createFallbackNluResult, processCommand, normalizeTranscript } from '../nlu/parser';
import { applyNluScheduleResult } from '../nlu/scheduler';
import type { CreatedScheduleItemType, NluResult } from '../nlu/types';
import type { OfflineModelReference } from '../modelAssets';
import {
  hasOfflineSpeechCapture,
  startOfflineSpeechCapture,
} from './speechCapture';
const LLM_MAX_TOKENS = 220;
const LLM_TEMPERATURE = 0;
/**
 * Hard ceilings so a wedged native call can never leave the voice sheet spinning.
 *
 * Recording is bounded by the shared capture watchdog as well; this is the
 * pipeline-level promise that the caller always settles.
 */
const CAPTURE_TIMEOUT_MS = 60_000;
const INTENT_TIMEOUT_MS = 15_000;

/**
 * Rejects when an operation does not settle inside its budget.
 *
 * The underlying native work is not cancellable from here, so the timer is always
 * cleared to avoid keeping a stray handle alive for the rest of the process.
 */
const withTimeout = <T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

interface IntentExtractionRequest {
  transcript: string;
  prompt: string;
  model: OfflineModelReference;
  temperature: number;
  maxTokens: number;
}

interface LafinaIntentExtractorModule {
  extractIntentJson: (request: IntentExtractionRequest) => Promise<string>;
}

interface OfflineVoiceNativeModules {
  LafinaIntentExtractor?: LafinaIntentExtractorModule;
}

export type VoicePipelineErrorCode =
  | 'permission_denied'
  | 'native_runtime_unavailable'
  | 'no_speech_detected'
  | 'empty_transcript'
  | 'processing_failed';

export interface VoicePipelineResult {
  didUpdate: boolean;
  transcript: string;
  reply: string;
  createdItemType: CreatedScheduleItemType | null;
  nluResult: NluResult | null;
  errorCode: VoicePipelineErrorCode | null;
}

const getNativeVoiceModules = (): OfflineVoiceNativeModules => {
  return NativeModules as unknown as OfflineVoiceNativeModules;
};

const requestMicrophonePermission = async (): Promise<boolean> => {
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
};

const unavailableResult = (
  reply: string,
  errorCode: VoicePipelineErrorCode,
): VoicePipelineResult => ({
  didUpdate: false,
  transcript: '',
  reply,
  createdItemType: null,
  nluResult: null,
  errorCode,
});

/**
 * Checks whether all offline Android voice runtime modules are registered.
 *
 * @returns True when recording, STT, and LLM native modules are available.
 */
export const hasOfflineVoiceRuntime = (): boolean => {
  const modules = getNativeVoiceModules();
  return hasOfflineSpeechCapture() && Boolean(modules.LafinaIntentExtractor);
};

/**
 * Records a spoken command, transcribes it locally, extracts NLU JSON locally, and applies it.
 *
 * @param userId Active local user ID that owns any created schedule item.
 * @returns The pipeline result, including transcript, reply, and storage update status.
 */
export const runOfflineVoiceScheduling = async (
  userId: string,
): Promise<VoicePipelineResult> => {
  const modules = getNativeVoiceModules();

  if (!hasOfflineSpeechCapture() || !modules.LafinaIntentExtractor) {
    return unavailableResult(
      'Offline voice is not available in this build yet. You can type the command below for now.',
      'native_runtime_unavailable',
    );
  }

  const hasPermission = await requestMicrophonePermission();
  if (!hasPermission) {
    return unavailableResult(
      'Microphone permission is needed before I can listen for a schedule command.',
      'permission_denied',
    );
  }

  try {
    const capture = startOfflineSpeechCapture({
      mode: 'automatic',
      bargeIn: false,
      context: 'main_mic',
    });
    const transcription = await withTimeout(
      capture.result,
      CAPTURE_TIMEOUT_MS,
      'Offline speech capture timed out.',
    );
    if (!transcription.speechDetected) {
      return unavailableResult(
        "I didn't hear speech clearly enough to schedule anything.",
        'no_speech_detected',
      );
    }
    const transcript = normalizeTranscript(transcription.transcript.trim());
    if (transcript.length === 0) {
      return unavailableResult(
        "I couldn't transcribe that speech clearly enough to schedule it.",
        'empty_transcript',
      );
    }

    // Scheduling grammar is deterministic, so prefer it over a generated NLU
    // result. This keeps compact times, dates, and titles stable even when the
    // small local language model would otherwise invent or truncate a field.
    const deterministicResult = createFallbackNluResult(transcript);
    let nluResult: NluResult;
    if (deterministicResult.intent === 'schedule') {
      nluResult = deterministicResult;
    } else {
      const rawNluJson = await withTimeout(
        modules.LafinaIntentExtractor.extractIntentJson({
          transcript,
          prompt: buildNluPrompt(transcript),
          model: AI_MODEL_ASSETS.llm,
          temperature: LLM_TEMPERATURE,
          maxTokens: LLM_MAX_TOKENS,
        }),
        INTENT_TIMEOUT_MS,
        'Offline intent extraction timed out.',
      );
      nluResult = parseNluJson(rawNluJson);
    }
    const scheduleResult = applyNluScheduleResult(nluResult, userId);

    return {
      didUpdate: scheduleResult.didUpdate,
      transcript,
      reply: scheduleResult.reply,
      createdItemType: scheduleResult.createdItemType,
      nluResult,
      errorCode: null,
    };
  } catch (error) {
    console.error('Offline voice scheduling failed:', error);
    return unavailableResult(
      'Sorry, I could not process that speech command locally.',
      'processing_failed',
    );
  }
};

/**
 * Processes text input using the local SmolLM2 LLM chatbot engine.
 *
 * @param userText Message typed or spoken by the user.
 * @param userId Active user ID.
 * @returns Conversational reply generated by the local SmolLM2 LLM.
 */
export const runLocalLlmChat = async (
  userText: string,
  userId: string,
): Promise<string> => {
  const modules = getNativeVoiceModules();
  const normalizedUserText = normalizeTranscript(userText);
  const deterministicResult = createFallbackNluResult(normalizedUserText);

  // Scheduling commands are handled deterministically first. This avoids an
  // unnecessary native-model round trip and keeps title/date extraction
  // consistent between typed chat and the offline fallback path.
  if (deterministicResult.intent === 'schedule') {
    return applyNluScheduleResult(deterministicResult, userId).reply;
  }

  if (modules.LafinaIntentExtractor) {
    try {
      const rawNluJson = await withTimeout(
        modules.LafinaIntentExtractor.extractIntentJson({
          transcript: normalizedUserText,
          prompt: buildNluPrompt(normalizedUserText),
          model: AI_MODEL_ASSETS.llm,
          temperature: LLM_TEMPERATURE,
          maxTokens: LLM_MAX_TOKENS,
        }),
        INTENT_TIMEOUT_MS,
        'Offline intent extraction timed out.',
      );

      const nluResult = parseNluJson(rawNluJson);
      const scheduleResult = applyNluScheduleResult(nluResult, userId);
      return scheduleResult.reply;
    } catch {
      // Fall back below if native model call encounters issue
    }
  }

  return processCommand(normalizedUserText, userId);
};
