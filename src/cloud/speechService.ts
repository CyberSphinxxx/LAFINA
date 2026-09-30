import RNFS from 'react-native-fs';
import { cloudClient } from './cloudClient';
import { accountLinkService } from './accountLinkService';
import { userStore } from '../storage/userStore';
import { businessStore } from '../storage/businessStore';
import {
  playSpeechFile,
  speakTextWithTts,
  stopSpeechPlayback,
} from '../ai/tts/ttsService';
import type {
  CallSpeechProvider,
  CallSpeechResult,
} from '../scheduler/speechProvider';

const PLAYBACK_REQUEST_TIMEOUT_MS = 17_000;
const PREPARATION_REQUEST_TIMEOUT_MS = 22_000;

interface TtsApiResponse {
  requestId: string;
  audioBase64: string;
  mimeType: string;
  model: string;
  voice: string;
  createdAt: string;
}

interface EntitlementSnapshot {
  role: string;
  subscriptionPlan: string;
  effectivePlan: string;
  entitled: boolean;
}

const waitForPreparation = async (
  preparation: Promise<string | null>,
): Promise<string | null | undefined> =>
  new Promise(resolve => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      settled = true;
      resolve(undefined);
    }, PLAYBACK_REQUEST_TIMEOUT_MS);

    void preparation
      .then(path => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(path);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(null);
      });
  });

/**
 * Creates a user-bound CallSpeechProvider instance.
 * Checks active user, student_pro entitlement, cloud token, and connectivity before
 * requesting Gemini 3.1 Flash TTS. Falls back cleanly to Kokoro on failure or offline.
 */
export const createCallSpeechProvider = (
  userId: string,
): CallSpeechProvider => {
  const preparedAudioPaths = new Map<string, string>();
  const preparations = new Map<string, Promise<string | null>>();
  const preparationControllers = new Set<AbortController>();
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  let activePlaybackController: AbortController | null = null;
  let cancellationSequence = 0;
  let disposed = false;
  let roleRefreshAttempted = false;
  let cloudLinkAttempted = false;

  const normalizeText = (text: string): string => text.trim().substring(0, 512);

  const getEntitlementSnapshot = (): EntitlementSnapshot => {
    const localUser = userStore.getUserById(userId);
    const cachedBiz = businessStore.getCachedCapabilities(userId);
    const role = localUser?.role ?? 'unknown';
    const subscriptionPlan = cachedBiz?.subscriptionPlan ?? 'unknown';
    const effectivePlan = cachedBiz?.effectivePlan ?? 'unknown';
    return {
      role,
      subscriptionPlan,
      effectivePlan,
      entitled:
        localUser?.role === 'student_pro' ||
        localUser?.role === 'business' ||
        cachedBiz?.effectivePlan === 'business' ||
        cachedBiz?.effectivePlan === 'student_pro' ||
        cachedBiz?.subscriptionPlan === 'business' ||
        cachedBiz?.subscriptionPlan === 'student_pro',
    };
  };

  const canUseGemini = async (): Promise<boolean> => {
    if (disposed) return false;

    // 1. Connectivity is the primary gate: an offline device always falls back
    //    to on-device Kokoro rather than attempting a doomed network request.
    let online = false;
    try {
      online = await cloudClient.isOnline();
    } catch {
      online = false;
    }
    if (!online) {
      console.warn(
        '[CloudSpeech] Gemini TTS skipped — device is offline. Using Kokoro fallback.',
      );
      return false;
    }

    // 2. A cloud token is required to call the authenticated /v1/ai/tts proxy.
    let activeSessionToken = userStore.getActiveSessionToken();
    if (activeSessionToken.userId !== userId) {
      console.warn(
        '[CloudSpeech] Gemini TTS skipped — the cloud session belongs to a different local user. Using Kokoro fallback.',
      );
      return false;
    }
    let hasToken =
      !!cloudClient.getAccessToken() || !!activeSessionToken.accessToken;
    if (!hasToken && !cloudLinkAttempted) {
      cloudLinkAttempted = true;
      try {
        const linkResult = await accountLinkService.completeDeferredCloudLink(
          userId
        );
        if (linkResult.status !== 'success') {
          console.warn(
            `[CloudSpeech] Automatic FastAPI linking did not complete (${linkResult.status}): ${linkResult.message}`,
          );
        }
        activeSessionToken = userStore.getActiveSessionToken();
        hasToken =
          !!cloudClient.getAccessToken() || !!activeSessionToken.accessToken;
      } catch (error: unknown) {
        console.warn(
          '[CloudSpeech] Automatic FastAPI linking threw:',
          error instanceof Error ? error.message : 'Unknown linking error.',
        );
      }
    }
    if (!hasToken) {
      console.warn(
        '[CloudSpeech] Gemini TTS skipped — no active cloud session token. Sign in while online to link FastAPI automatically. Using Kokoro fallback.',
      );
      return false;
    }

    // 3. Entitlement short-circuit: Gemini TTS is a student_pro/business feature.
    //    Accounts the backend will reject (403) are routed straight to Kokoro.
    //    The locally stored role can go stale (e.g. the backend account was
    //    upgraded after linking), so refresh it from the authoritative FastAPI
    //    profile once before giving up. Note: the backend /v1/ai/tts endpoint
    //    intentionally excludes `admin` (unlike /v1/ai/chat), so admin is NOT
    //    entitled here.
    let entitlement = getEntitlementSnapshot();
    if (!entitlement.entitled && !roleRefreshAttempted) {
      roleRefreshAttempted = true;
      console.info(
        `[CloudSpeech] Local TTS entitlement may be stale (role=${entitlement.role}, subscriptionPlan=${entitlement.subscriptionPlan}, effectivePlan=${entitlement.effectivePlan}); refreshing the cloud profile once.`,
      );
      try {
        const refresh = await accountLinkService.refreshCloudProfile(userId);
        if (refresh.status !== 'success') {
          console.warn(
            `[CloudSpeech] Cloud profile refresh failed (${refresh.status}): ${refresh.message}`,
          );
        } else {
          entitlement = getEntitlementSnapshot();
          console.info(
            `[CloudSpeech] Cloud profile refresh succeeded (role=${entitlement.role}, subscriptionPlan=${entitlement.subscriptionPlan}, effectivePlan=${entitlement.effectivePlan}).`,
          );
        }
      } catch (error) {
        console.warn('[CloudSpeech] Cloud profile refresh threw:', error);
      }
    }

    entitlement = getEntitlementSnapshot();
    if (!entitlement.entitled) {
      console.warn(
        `[CloudSpeech] Gemini TTS skipped — local entitlement is insufficient (role=${entitlement.role}, subscriptionPlan=${entitlement.subscriptionPlan}, effectivePlan=${entitlement.effectivePlan}; student_pro or business required). Using Kokoro fallback.`,
      );
      return false;
    }

    console.info(
      `[CloudSpeech] Gemini TTS selected (role=${entitlement.role}, subscriptionPlan=${entitlement.subscriptionPlan}, effectivePlan=${entitlement.effectivePlan}).`,
    );
    return true;
  };

  const executeKokoroFallback = async (
    text: string,
    fallbackAudioPath?: string | null,
  ): Promise<CallSpeechResult> => {
    console.info('[CloudSpeech] Kokoro TTS selected as the local fallback.');
    if (fallbackAudioPath) {
      try {
        const playable = await RNFS.exists(fallbackAudioPath);
        if (playable) {
          const success = await playSpeechFile(fallbackAudioPath);
          if (success) {
            return { source: 'kokoro' };
          }
        }
      } catch (error) {
        console.warn(
          '[CloudSpeech] Pre-cached audio unplayable, proceeding to fresh synthesis:',
          error,
        );
      }
    }
    await speakTextWithTts(text);
    return { source: 'kokoro' };
  };

  const requestGeminiAudio = async (
    text: string,
    controller: AbortController,
    timeoutMs: number,
  ): Promise<string | null> => {
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let wavPath: string | null = null;
    let callerOwnsFile = false;

    try {
      const cacheDir = `${RNFS.CachesDirectoryPath}/gemini_tts`;
      await RNFS.mkdir(cacheDir).catch(() => undefined);

      const requestId = `tts_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 8)}`;
      wavPath = `${cacheDir}/gemini_${safeUserId}_${requestId}.wav`;
      const result = await cloudClient.request<TtsApiResponse>(
        '/v1/ai/tts',
        {
          method: 'POST',
          body: JSON.stringify({ requestId, text }),
          signal: controller.signal,
        },
        true,
      );

      if (controller.signal.aborted || disposed) return null;

      if (result.status !== 'success' || !result.data?.audioBase64) {
        const httpStatus = result.httpStatus
          ? `, HTTP ${result.httpStatus}`
          : '';
        console.warn(
          `[CloudSpeech] Gemini TTS request failed (${
            result.status
          }${httpStatus}): ${result.error || 'No audio data'}`,
        );
        return null;
      }

      console.info(
        `[CloudSpeech] Gemini TTS audio received (model=${result.data.model}, voice=${result.data.voice}).`,
      );

      await RNFS.writeFile(wavPath, result.data.audioBase64, 'base64');
      if (controller.signal.aborted || disposed) return null;
      callerOwnsFile = true;
      return wavPath;
    } catch (error: unknown) {
      if (!controller.signal.aborted && !disposed) {
        console.warn(
          '[CloudSpeech] Error during Gemini TTS generation:',
          error,
        );
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
      if (!callerOwnsFile && wavPath) {
        RNFS.unlink(wavPath).catch(() => undefined);
      }
    }
  };

  const playGeminiAudio = async (
    wavPath: string,
  ): Promise<CallSpeechResult> => {
    const playbackFinished = await playSpeechFile(wavPath);
    if (!playbackFinished) {
      console.warn(
        '[CloudSpeech] Gemini playback returned false (interrupted or failed).',
      );
    }
    return { source: 'gemini' };
  };

  const prepareText = async (text: string): Promise<void> => {
    const normalizedText = normalizeText(text);
    if (!normalizedText || disposed || preparedAudioPaths.has(normalizedText)) {
      return;
    }

    const existingPreparation = preparations.get(normalizedText);
    if (existingPreparation) {
      await existingPreparation;
      return;
    }

    const preparation = (async (): Promise<string | null> => {
      if (!(await canUseGemini()) || disposed) return null;

      const controller = new AbortController();
      preparationControllers.add(controller);
      try {
        const wavPath = await requestGeminiAudio(
          normalizedText,
          controller,
          PREPARATION_REQUEST_TIMEOUT_MS,
        );
        if (!wavPath) return null;
        if (disposed) {
          RNFS.unlink(wavPath).catch(() => undefined);
          return null;
        }
        preparedAudioPaths.set(normalizedText, wavPath);
        return wavPath;
      } finally {
        preparationControllers.delete(controller);
      }
    })();

    preparations.set(normalizedText, preparation);
    try {
      await preparation;
    } finally {
      if (preparations.get(normalizedText) === preparation) {
        preparations.delete(normalizedText);
      }
    }
  };

  const stopSpeech = async (): Promise<void> => {
    cancellationSequence += 1;
    activePlaybackController?.abort();
    activePlaybackController = null;
    await Promise.resolve(stopSpeechPlayback()).catch(() => undefined);
  };

  const speakText = async (
    text: string,
    options?: { fallbackAudioPath?: string | null },
  ): Promise<CallSpeechResult> => {
    const operationSequence = cancellationSequence;
    const normalizedText = normalizeText(text);
    if (disposed) return { source: 'gemini' };
    if (!normalizedText || !(await canUseGemini())) {
      return executeKokoroFallback(text, options?.fallbackAudioPath);
    }
    if (operationSequence !== cancellationSequence || disposed) {
      return { source: 'gemini' };
    }

    let preparedPath = preparedAudioPaths.get(normalizedText) || null;
    if (!preparedPath) {
      const preparation = preparations.get(normalizedText);
      if (preparation) {
        const preparedResult = await waitForPreparation(preparation);
        if (operationSequence !== cancellationSequence || disposed) {
          return { source: 'gemini' };
        }
        if (preparedResult === undefined || preparedResult === null) {
          return executeKokoroFallback(text, options?.fallbackAudioPath);
        }
        preparedPath = preparedResult;
      }
    }

    if (preparedPath) {
      const playable = await RNFS.exists(preparedPath).catch(() => false);
      if (playable) {
        return playGeminiAudio(preparedPath);
      }
      preparedAudioPaths.delete(normalizedText);
    }

    const controller = new AbortController();
    activePlaybackController = controller;
    let wavPath: string | null = null;
    try {
      wavPath = await requestGeminiAudio(
        normalizedText,
        controller,
        PLAYBACK_REQUEST_TIMEOUT_MS,
      );
      if (
        operationSequence !== cancellationSequence ||
        controller.signal.aborted ||
        disposed
      ) {
        return { source: 'gemini' };
      }
      if (!wavPath) {
        return executeKokoroFallback(text, options?.fallbackAudioPath);
      }
      return await playGeminiAudio(wavPath);
    } finally {
      if (activePlaybackController === controller) {
        activePlaybackController = null;
      }
      if (wavPath) {
        RNFS.unlink(wavPath).catch(() => undefined);
      }
    }
  };

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    cancellationSequence += 1;
    activePlaybackController?.abort();
    activePlaybackController = null;
    for (const controller of preparationControllers) controller.abort();
    await Promise.resolve(stopSpeechPlayback()).catch(() => undefined);
    await Promise.allSettled([...preparations.values()]);
    await Promise.all(
      [...preparedAudioPaths.values()].map(path =>
        RNFS.unlink(path).catch(() => undefined),
      ),
    );
    preparedAudioPaths.clear();
    preparations.clear();
  };

  return {
    speakText,
    stopSpeech,
    prepareText,
    dispose,
  };
};
