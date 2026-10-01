/**
 * Audio cache hygiene tests.
 *
 * Cached announcement audio is keyed by the spoken text, and reminder
 * announcements embed the task title, so every distinct task used to leave a file
 * behind forever. A failed synthesis could also leave a truncated WAV that the
 * next call served as a cache hit.
 */
import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import {
  cleanOrphanedAudioCache,
  synthesizeSpeech,
} from '../../src/ai/tts/ttsService';

interface RnfsMock {
  readDir: jest.Mock;
  exists: jest.Mock;
  unlink: jest.Mock;
  mkdir: jest.Mock;
}

const rnfs = RNFS as unknown as RnfsMock;

const HOUR_MS = 60 * 60 * 1000;
const CACHE_DIR = `${RNFS.CachesDirectoryPath}/tts_cache`;

const entry = (name: string, ageMs: number): { name: string; path: string; mtime: Date } => ({
  name,
  path: `${CACHE_DIR}/${name}`,
  mtime: new Date(Date.now() - ageMs),
});

describe('TTS audio cache hygiene', () => {
  const synthesize = jest.fn<Promise<boolean>, [string, string]>();

  beforeEach(() => {
    jest.clearAllMocks();
    rnfs.readDir = jest.fn().mockResolvedValue([]);
    rnfs.exists = jest.fn().mockResolvedValue(true);
    rnfs.unlink = jest.fn().mockResolvedValue(undefined);
    rnfs.mkdir = jest.fn().mockResolvedValue(undefined);
    synthesize.mockResolvedValue(true);
    NativeModules.LafinaTTS = { synthesize };
  });

  it('deletes only stale wav files during the sweep', async () => {
    rnfs.readDir.mockResolvedValue([
      entry('old_announcement.wav', 48 * HOUR_MS),
      entry('fresh_announcement.wav', 1 * HOUR_MS),
      entry('old_transcript.txt', 48 * HOUR_MS),
    ]);

    const removed = await cleanOrphanedAudioCache();

    expect(removed).toBe(1);
    expect(rnfs.unlink).toHaveBeenCalledTimes(1);
    expect(rnfs.unlink).toHaveBeenCalledWith(
      `${CACHE_DIR}/old_announcement.wav`,
    );
  });

  it('ignores a file whose modification time is unusable', async () => {
    rnfs.readDir.mockResolvedValue([
      { name: 'broken.wav', path: `${CACHE_DIR}/broken.wav`, mtime: new Date('nope') },
    ]);

    const removed = await cleanOrphanedAudioCache();

    expect(removed).toBe(0);
    expect(rnfs.unlink).not.toHaveBeenCalled();
  });

  it('skips the sweep when the cache directory does not exist', async () => {
    rnfs.exists.mockResolvedValue(false);

    const removed = await cleanOrphanedAudioCache();

    expect(removed).toBe(0);
    expect(rnfs.readDir).not.toHaveBeenCalled();
  });

  it('never throws when the cache directory cannot be read', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    rnfs.readDir.mockRejectedValue(new Error('EACCES'));

    await expect(cleanOrphanedAudioCache()).resolves.toBe(0);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[TTS Cache] Audio cache sweep skipped:',
      expect.any(Error),
    );
    consoleWarnSpy.mockRestore();
  });

  it('keeps sweeping the rest when one file cannot be deleted', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    rnfs.readDir.mockResolvedValue([
      entry('locked.wav', 48 * HOUR_MS),
      entry('other.wav', 48 * HOUR_MS),
    ]);
    rnfs.unlink
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockResolvedValue(undefined);

    const removed = await cleanOrphanedAudioCache();

    expect(removed).toBe(1);
    expect(rnfs.unlink).toHaveBeenCalledTimes(2);
    consoleWarnSpy.mockRestore();
  });

  it('deletes a partial wav when synthesis reports failure', async () => {
    // Cache miss, then the partial file exists when cleanup looks for it.
    rnfs.exists.mockResolvedValueOnce(false).mockResolvedValue(true);
    synthesize.mockResolvedValueOnce(false);

    await expect(synthesizeSpeech('Good morning')).rejects.toThrow(
      'TTS synthesis returned false',
    );

    expect(rnfs.unlink).toHaveBeenCalledTimes(1);
    expect(rnfs.unlink).toHaveBeenCalledWith(
      expect.stringContaining(`${CACHE_DIR}/cached_`),
    );
  });

  it('deletes a partial wav when synthesis throws', async () => {
    rnfs.exists.mockResolvedValueOnce(false).mockResolvedValue(true);
    synthesize.mockRejectedValueOnce(new Error('kokoro crashed'));

    await expect(synthesizeSpeech('Good morning')).rejects.toThrow(
      'kokoro crashed',
    );

    expect(rnfs.unlink).toHaveBeenCalledWith(
      expect.stringContaining(`${CACHE_DIR}/cached_`),
    );
  });

  it('serves a cached announcement without re-synthesizing it', async () => {
    rnfs.exists.mockResolvedValue(true);

    const path = await synthesizeSpeech('Good morning');

    expect(path).toContain(`${CACHE_DIR}/cached_`);
    expect(synthesize).not.toHaveBeenCalled();
    expect(rnfs.unlink).not.toHaveBeenCalled();
  });
});
