import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { remindersStore } from '../../storage';

interface LafinaTTSModuleType {
  synthesize: (text: string, outputPath: string) => Promise<boolean>;
  playAudio?: (filePath: string) => Promise<boolean>;
  stopAudio?: () => Promise<boolean>;
  resetInitError?: () => Promise<boolean>;
}

const inFlightSyntheses = new Map<string, Promise<string>>();

/** Cached announcement audio lives under the OS cache directory. */
const TTS_CACHE_DIR = `${RNFS.CachesDirectoryPath}/tts_cache`;
/**
 * How long a synthesized file may stay unused before a boot sweep removes it.
 *
 * The cache key is derived from the spoken text, and reminder announcements embed
 * the task name, so every distinct task creates a new file. Without a sweep the
 * directory grows for the life of the install.
 */
const AUDIO_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Removes a partially written WAV so a failed synthesis cannot be served from cache.
 *
 * A native failure can leave a truncated file behind, and the next call would then
 * see it as a cache hit and play a corrupt announcement forever.
 */
const discardPartialAudio = async (filePath: string): Promise<void> => {
  try {
    if (await RNFS.exists(filePath)) {
      await RNFS.unlink(filePath);
    }
  } catch (error) {
    console.warn('[TTS Cache] Could not delete a partial WAV file:', error);
  }
};

const getNativeTTSModule = (): LafinaTTSModuleType | null => {
  const mod = NativeModules.LafinaTTS;
  if (mod && typeof mod.synthesize === 'function') {
    return mod as LafinaTTSModuleType;
  }
  return null;
};

/**
 * Checks if the native Kokoro-82M TTS module is available.
 */
export const isTtsAvailable = (): boolean => {
  return getNativeTTSModule() !== null;
};

/**
 * Plays a previously synthesized WAV file via the native TTS module.
 *
 * @param filePath Absolute path to a WAV file on disk.
 * @returns Promise resolving true when playback finishes successfully.
 */
export const playSpeechFile = async (filePath: string): Promise<boolean> => {
  const nativeModule = getNativeTTSModule();
  if (!nativeModule?.playAudio) {
    throw new Error('Native TTS playAudio is not available.');
  }

  const exists = await RNFS.exists(filePath);
  if (!exists) {
    throw new Error(`TTS audio file does not exist: ${filePath}`);
  }

  return nativeModule.playAudio(filePath);
};

/**
 * Stops active Kokoro playback, including a call announcement interrupted by user speech.
 */
export const stopSpeechPlayback = async (): Promise<void> => {
  const nativeModule = getNativeTTSModule();
  if (!nativeModule?.stopAudio) return;
  await nativeModule.stopAudio();
};
/**
 * Generates a deterministic filename for a given text phrase using a simple FNV-like hash.
 */
const getDeterministicFilename = (text: string): string => {
  const clean = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    const char = clean.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  const hashHex = (hash >>> 0).toString(16);
  const prefix = clean.substring(0, 15);
  return `cached_${prefix}_${hashHex}.wav`;
};

/**
 * Synthesizes speech from text and saves it as a WAV file in the cache directory.
 *
 * @param text The text to read aloud.
 * @returns Promise resolving to the absolute path of the generated WAV file.
 */
export const synthesizeSpeech = async (text: string): Promise<string> => {
  const nativeModule = getNativeTTSModule();
  if (!nativeModule) {
    throw new Error(
      'Native TTS module is not available. Rebuild the Android app so LafinaTTS is linked.',
    );
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Cannot synthesize empty text.');
  }

  const cacheDir = TTS_CACHE_DIR;
  await RNFS.mkdir(cacheDir);

  const filename = getDeterministicFilename(trimmed);
  const outputPath = `${cacheDir}/${filename}`;

  const inFlight = inFlightSyntheses.get(outputPath);
  if (inFlight) {
    return inFlight;
  }

  const synthesis = (async (): Promise<string> => {
    // Check cache first
    const exists = await RNFS.exists(outputPath);
    if (exists) {
      console.log(
        `[TTS Cache] Hit: "${trimmed.substring(0, 40)}${
          trimmed.length > 40 ? '...' : ''
        }" -> ${filename}`,
      );
      return outputPath;
    }

    console.log(
      `[TTS Cache] Miss: Synthesizing: "${trimmed.substring(0, 40)}${
        trimmed.length > 40 ? '...' : ''
      }"`,
    );

    try {
      const success = await nativeModule.synthesize(trimmed, outputPath);
      if (!success) {
        throw new Error(
          `TTS synthesis returned false for text: "${trimmed.substring(
            0,
            60,
          )}"`,
        );
      }
    } catch (error) {
      // Never leave a half-written announcement behind for the cache to serve.
      await discardPartialAudio(outputPath);
      // Clear sticky native init failures so the next attempt can reload models
      if (nativeModule.resetInitError) {
        try {
          await nativeModule.resetInitError();
        } catch {
          // ignore reset failures
        }
      }
      throw error;
    }

    const fileExistsNow = await RNFS.exists(outputPath);
    if (!fileExistsNow) {
      throw new Error(`TTS claimed success but WAV is missing: ${outputPath}`);
    }

    return outputPath;
  })();

  inFlightSyntheses.set(outputPath, synthesis);

  try {
    return await synthesis;
  } finally {
    if (inFlightSyntheses.get(outputPath) === synthesis) {
      inFlightSyntheses.delete(outputPath);
    }
  }
};

/**
 * Synthesizes text and plays it aloud end-to-end.
 *
 * @param text The text to speak.
 */
export const speakTextWithTts = async (text: string): Promise<void> => {
  const wavPath = await synthesizeSpeech(text);
  const played = await playSpeechFile(wavPath);
  if (!played) {
    throw new Error(`TTS playback failed for: ${wavPath}`);
  }
};

/**
 * Pre-caches audio for a scheduled reminder and updates its precast_audio_path in SQLite.
 *
 * @param reminderId The ID of the reminder.
 * @param text The text to pre-cache (usually the reminder announcement).
 * @returns Promise resolving to the path of the generated WAV file.
 */
export const preCacheReminderAudio = async (
  reminderId: string,
  text: string,
): Promise<string> => {
  const nativeModule = getNativeTTSModule();
  if (!nativeModule) {
    console.warn('Native TTS module not available; skipping pre-cache.');
    return '';
  }

  try {
    const cacheDir = `${RNFS.DocumentDirectoryPath}/tts_reminders`;
    await RNFS.mkdir(cacheDir);

    const safeReminderId = reminderId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputPath = `${cacheDir}/tts_v2_${safeReminderId}.wav`;

    const exists = await RNFS.exists(outputPath);
    if (exists) {
      await RNFS.unlink(outputPath);
    }

    const success = await nativeModule.synthesize(text, outputPath);
    if (success) {
      remindersStore.updatePreCachedAudioPath(reminderId, outputPath);
      return outputPath;
    }
    console.warn('TTS pre-caching failed.');
  } catch (error) {
    console.error('Error pre-caching reminder audio:', error);
  }

  return '';
};

/**
 * Deletes synthesized announcement audio that has not been used recently.
 *
 * Intended to run once per cold boot. Only `.wav` files older than the maximum age
 * are removed, so audio belonging to an active call or a freshly cached phrase is
 * never touched. Failures are logged and never thrown: a sweep must not be able to
 * block startup on a device with an unusual cache directory.
 *
 * @param maxAgeMs Age threshold in milliseconds; defaults to 24 hours.
 * @returns How many stale files were deleted.
 */
export const cleanOrphanedAudioCache = async (
  maxAgeMs: number = AUDIO_CACHE_MAX_AGE_MS,
): Promise<number> => {
  let removed = 0;

  try {
    if (!(await RNFS.exists(TTS_CACHE_DIR))) return 0;

    const cutoff = Date.now() - maxAgeMs;
    const entries = await RNFS.readDir(TTS_CACHE_DIR);

    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith('.wav')) continue;
      const modifiedAt = entry.mtime ? new Date(entry.mtime).getTime() : NaN;
      if (!Number.isFinite(modifiedAt) || modifiedAt >= cutoff) continue;

      try {
        await RNFS.unlink(entry.path);
        removed += 1;
      } catch (error) {
        console.warn(`[TTS Cache] Could not delete ${entry.name}:`, error);
      }
    }
  } catch (error) {
    console.warn('[TTS Cache] Audio cache sweep skipped:', error);
  }

  return removed;
};

/**
 * Removes durable pre-cached reminder audio after a terminal reminder action.
 *
 * @param filePath Absolute reminder audio path, when one was generated.
 */
export const deletePreCachedReminderAudio = async (
  filePath: string | null,
): Promise<void> => {
  if (!filePath) return;
  try {
    if (await RNFS.exists(filePath)) {
      await RNFS.unlink(filePath);
    }
  } catch (error) {
    console.warn('[TTS Cache] Failed to delete reminder audio:', error);
  }
};
