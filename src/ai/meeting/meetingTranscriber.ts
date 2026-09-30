import { meetingRecorder, MeetingSegment } from '../native/meetingRecorder';
import { generateId } from '../../utils';

export interface TranscribeMeetingOptions {
  meetingId: string;
  chunkFiles: string[];
  chunkDurationMs?: number;
  /** Each chunk's real length; a pause or a stop ends a chunk before 30 s. */
  chunkDurationsMs?: number[];
  keepAudio?: boolean;
  onProgress?: (progress: number, currentChunk: number, totalChunks: number) => void;
  /** Checked between chunks; returning true stops with what has been transcribed so far. */
  shouldCancel?: () => boolean;
}

export interface MeetingTranscriptionResult {
  fullTranscript: string;
  segments: MeetingSegment[];
  totalSegments: number;
  /** Chunks the model could not read, so "nothing was said" can be told apart from a failure. */
  failedChunks: number;
  lastError: string | null;
  cancelled: boolean;
}

const DEFAULT_CHUNK_DURATION_MS = 30000; // 30 seconds

/**
 * Transcribes audio chunks recorded during a meeting using on-device Whisper.cpp.
 * Combines chunk-relative timestamps into meeting-relative millisecond timestamps.
 * Deletes raw audio files automatically unless `keepAudio` is true.
 */
export const transcribeMeetingChunks = async (
  options: TranscribeMeetingOptions
): Promise<MeetingTranscriptionResult> => {
  const {
    chunkFiles,
    chunkDurationMs = DEFAULT_CHUNK_DURATION_MS,
    chunkDurationsMs,
    keepAudio = false,
    onProgress,
    shouldCancel,
  } = options;

  const aggregatedSegments: MeetingSegment[] = [];
  let transcriptBuilder = '';
  let chunkOffsetMs = 0;
  let failedChunks = 0;
  let lastError: string | null = null;
  let cancelled = false;

  for (let i = 0; i < chunkFiles.length; i++) {
    if (shouldCancel?.()) {
      cancelled = true;
      break;
    }
    const chunkPath = chunkFiles[i];
    const knownDuration = chunkDurationsMs?.[i];
    const thisChunkMs =
      typeof knownDuration === 'number' && Number.isFinite(knownDuration) && knownDuration >= 0
        ? knownDuration
        : chunkDurationMs;

    try {
      const rawSegments = await meetingRecorder.transcribeChunkWithTimestamps(chunkPath);

      for (const seg of rawSegments) {
        if (!seg.text || !seg.text.trim()) continue;
        const cleanedText = seg.text.trim();

        const segment: MeetingSegment = {
          id: generateId('seg'),
          // Whisper pads short audio to 30 s and can place text past the end of it.
          start_ms: chunkOffsetMs + Math.min(Math.max(0, seg.start_ms), thisChunkMs),
          end_ms: chunkOffsetMs + Math.min(Math.max(0, seg.end_ms), thisChunkMs),
          text: cleanedText,
        };
        aggregatedSegments.push(segment);

        if (transcriptBuilder.length > 0) {
          transcriptBuilder += ' ';
        }
        transcriptBuilder += cleanedText;
      }
    } catch (err) {
      console.warn(`[MeetingTranscriber] Failed to transcribe chunk ${i}:`, err);
      failedChunks += 1;
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      // Automatic raw audio deletion
      if (!keepAudio) {
        try {
          await meetingRecorder.deleteAudioFile(chunkPath);
        } catch {}
      }
    }

    chunkOffsetMs += thisChunkMs;

    if (onProgress) {
      onProgress((i + 1) / chunkFiles.length, i + 1, chunkFiles.length);
    }
  }

  return {
    fullTranscript: transcriptBuilder,
    segments: aggregatedSegments,
    totalSegments: aggregatedSegments.length,
    failedChunks,
    lastError,
    cancelled,
  };
};
