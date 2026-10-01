/**
 * Unit tests for `src/scheduler/speechProvider.ts`.
 *
 * The provider must prefer already-rendered precast audio, and must always fall
 * back to fresh on-device synthesis when that precast file is missing, empty or
 * unplayable — a reminder call may never fail silently.
 */
import { playSpeechFile, speakTextWithTts } from '../../src/ai/tts/ttsService';
import { defaultCallSpeechProvider } from '../../src/scheduler/speechProvider';

jest.mock('../../src/ai/tts/ttsService', () => ({
  playSpeechFile: jest.fn(),
  speakTextWithTts: jest.fn(),
}));

const mockPlaySpeechFile = playSpeechFile as jest.MockedFunction<typeof playSpeechFile>;
const mockSpeakTextWithTts = speakTextWithTts as jest.MockedFunction<typeof speakTextWithTts>;

describe('defaultCallSpeechProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlaySpeechFile.mockResolvedValue(true);
    mockSpeakTextWithTts.mockResolvedValue(undefined);
  });

  it('synthesises fresh speech when no precast audio is available', async () => {
    const result = await defaultCallSpeechProvider.speakText('Time to study.');

    expect(result).toEqual({ source: 'kokoro' });
    expect(mockSpeakTextWithTts).toHaveBeenCalledWith('Time to study.');
    expect(mockPlaySpeechFile).not.toHaveBeenCalled();
  });

  it('treats an explicitly null precast path as unavailable', async () => {
    const result = await defaultCallSpeechProvider.speakText('Time to study.', {
      fallbackAudioPath: null,
    });

    expect(result).toEqual({ source: 'kokoro' });
    expect(mockSpeakTextWithTts).toHaveBeenCalledWith('Time to study.');
  });

  it('plays precast audio when it is available', async () => {
    const result = await defaultCallSpeechProvider.speakText('Time to study.', {
      fallbackAudioPath: '/cache/reminder.wav',
    });

    expect(mockPlaySpeechFile).toHaveBeenCalledWith('/cache/reminder.wav');
    expect(result).toEqual({ source: 'kokoro' });
    expect(mockSpeakTextWithTts).not.toHaveBeenCalled();
  });

  it('synthesises fresh speech when precast playback reports failure', async () => {
    mockPlaySpeechFile.mockResolvedValue(false);

    const result = await defaultCallSpeechProvider.speakText('Time to study.', {
      fallbackAudioPath: '/cache/missing.wav',
    });

    expect(result).toEqual({ source: 'kokoro' });
    expect(mockSpeakTextWithTts).toHaveBeenCalledWith('Time to study.');
  });

  it('synthesises fresh speech when precast playback throws', async () => {
    mockPlaySpeechFile.mockRejectedValue(new Error('native playAudio unavailable'));

    const result = await defaultCallSpeechProvider.speakText('Time to study.', {
      fallbackAudioPath: '/cache/broken.wav',
    });

    expect(result).toEqual({ source: 'kokoro' });
    expect(mockSpeakTextWithTts).toHaveBeenCalledWith('Time to study.');
  });
});
