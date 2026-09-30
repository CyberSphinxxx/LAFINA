import { transcribeMeetingChunks } from '../../src/ai/meeting/meetingTranscriber';
import { meetingRecorder } from '../../src/ai/native/meetingRecorder';

jest.mock('../../src/ai/native/meetingRecorder', () => ({
  meetingRecorder: {
    transcribeChunkWithTimestamps: jest.fn(),
    deleteAudioFile: jest.fn(),
  },
}));

describe('meetingTranscriber - Offline Chunk Transcription & Audio Cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates timestamps across chunks and automatically deletes audio files when keepAudio is false', async () => {
    (meetingRecorder.transcribeChunkWithTimestamps as jest.Mock)
      .mockResolvedValueOnce([
        { start_ms: 0, end_ms: 2500, text: 'Hello everyone.' },
        { start_ms: 3000, end_ms: 6000, text: 'Welcome to the sync.' },
      ])
      .mockResolvedValueOnce([
        { start_ms: 1000, end_ms: 4000, text: 'Let us discuss tasks.' },
      ]);

    const result = await transcribeMeetingChunks({
      meetingId: 'meet_1',
      chunkFiles: ['/cache/chunk_0.wav', '/cache/chunk_1.wav'],
      chunkDurationMs: 30000,
      keepAudio: false,
    });

    expect(result.segments.length).toBe(3);
    // First chunk segments (offset 0)
    expect(result.segments[0].start_ms).toBe(0);
    expect(result.segments[0].end_ms).toBe(2500);
    expect(result.segments[0].text).toBe('Hello everyone.');

    // Second chunk segments (offset 30,000 ms)
    expect(result.segments[2].start_ms).toBe(31000);
    expect(result.segments[2].end_ms).toBe(34000);
    expect(result.segments[2].text).toBe('Let us discuss tasks.');

    expect(result.fullTranscript).toBe('Hello everyone. Welcome to the sync. Let us discuss tasks.');

    // Verify automatic deletion of raw audio files
    expect(meetingRecorder.deleteAudioFile).toHaveBeenCalledTimes(2);
    expect(meetingRecorder.deleteAudioFile).toHaveBeenCalledWith('/cache/chunk_0.wav');
    expect(meetingRecorder.deleteAudioFile).toHaveBeenCalledWith('/cache/chunk_1.wav');
  });

  it('retains audio files on disk when keepAudio is true', async () => {
    (meetingRecorder.transcribeChunkWithTimestamps as jest.Mock).mockResolvedValueOnce([
      { start_ms: 0, end_ms: 2000, text: 'Testing audio retention.' },
    ]);

    await transcribeMeetingChunks({
      meetingId: 'meet_2',
      chunkFiles: ['/cache/chunk_0.wav'],
      keepAudio: true,
    });

    // Delete should not have been called
    expect(meetingRecorder.deleteAudioFile).not.toHaveBeenCalled();
  });
});
