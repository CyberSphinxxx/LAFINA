import { playSpeechFile, speakTextWithTts } from '../../src/ai/tts/ttsService';
import { defaultCallSpeechProvider } from '../../src/scheduler/speechProvider';

jest.mock('../../src/ai/tts/ttsService', () => ({
  playSpeechFile: jest.fn(),
  speakTextWithTts: jest.fn().mockResolvedValue(undefined),
}));

describe('defaultCallSpeechProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('plays prepared reminder audio without synthesizing it again', async () => {
    jest.mocked(playSpeechFile).mockResolvedValueOnce(true);

    await expect(defaultCallSpeechProvider.speakText('Prepared reminder', {
      fallbackAudioPath: 'local://prepared.wav',
    })).resolves.toEqual({ source: 'kokoro' });

    expect(playSpeechFile).toHaveBeenCalledWith('local://prepared.wav');
    expect(speakTextWithTts).not.toHaveBeenCalled();
  });

  it('falls back to fresh synthesis when prepared playback fails', async () => {
    jest.mocked(playSpeechFile).mockRejectedValueOnce(new Error('missing audio'));

    await expect(defaultCallSpeechProvider.speakText('Fresh reminder', {
      fallbackAudioPath: 'local://missing.wav',
    })).resolves.toEqual({ source: 'kokoro' });

    expect(speakTextWithTts).toHaveBeenCalledWith('Fresh reminder');
  });
});
