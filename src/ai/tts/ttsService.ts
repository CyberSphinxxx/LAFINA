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

  const cacheDir = `${RNFS.CachesDirectoryPath}/tts_cache`;
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

/**
 * Formats and sanitizes email content (subject, sender, body) for natural Kokoro TTS playback.
 */
export const cleanEmailForReadAloud = (
  subject: string,
  sender: string,
  body: string
): string => {
  let cleanBody = body
    // Remove reply quotes like "> On Mon, Jan 1..."
    .replace(/^>+.*$/gm, '')
    // Remove common email signature dashes and footer
    .replace(/--\s*[\s\S]*$/, '')
    // Replace long URLs with spoken word 'link'
    .replace(/https?:\/\/[^\s]+/g, 'link')
    // Remove excessive newlines
    .replace(/\n\s*\n+/g, '. ')
    .trim();

  if (!cleanBody) {
    cleanBody = 'No text content.';
  }

  // Extract clean sender name from "Name <email@domain.com>"
  const senderMatch = sender.match(/^([^<]+)/);
  const senderName = senderMatch ? senderMatch[1].trim().replace(/"/g, '') : sender;

  return `Email from ${senderName}. Subject: ${subject}. ${cleanBody}`;
};

