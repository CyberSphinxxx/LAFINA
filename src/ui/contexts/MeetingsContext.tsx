import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { recordedMeetingStore } from '../../storage';
import type { MeetingPatch, RecordedMeeting } from '../../storage';
import { generateId } from '../../utils';
import { meetingRecorder, transcribeMeetingChunks } from '../../ai';
import { hasProEntitlement } from '../../cloud';
import { meetingNotesSkill } from '../../skills/meetingNotesSkill';
import {
  MeetingError,
  cleanSegments,
  describeMeetingError,
  generateMeetingNotes,
} from '../../meetings';
import type { MeetingErrorCode, MeetingErrorInfo, MeetingNotes } from '../../meetings';

// ── Types ─────────────────────────────────────────────────────────────────

export interface RecorderState {
  meetingId: string;
  status: 'starting' | 'recording' | 'paused' | 'stopping';
  elapsedMs: number;
}

export interface ProcessingState {
  meetingId: string;
  stage: 'transcribing' | 'generating_notes';
  percent: number;
  message: string;
  etaSeconds: number | null;
}

interface MeetingsContextValue {
  userId: string;
  meetings: RecordedMeeting[];
  refresh: () => void;
  /** False in a build without the native recorder (tests, or an old APK). */
  available: boolean;
  /** Meetings are a Student Pro feature, like Flashcards and Study Notes. */
  entitled: boolean;

  recorder: RecorderState | null;
  recorderError: MeetingErrorInfo | null;
  clearRecorderError: () => void;
  startRecording: (input: { title?: string }) => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  discardRecording: () => Promise<void>;

  processing: ProcessingState | null;
  transcribeMeeting: (id: string) => Promise<void>;
  generateNotes: (id: string) => Promise<void>;
  cancelProcessing: () => void;

  renameMeeting: (id: string, title: string) => void;
  saveNotes: (id: string, notes: MeetingNotes) => void;
  /** Frees the space the recording takes; the transcript and notes stay. */
  deleteAudio: (id: string) => Promise<void>;
  deleteMeeting: (id: string) => Promise<void>;
}

const MeetingsContext = createContext<MeetingsContextValue | null>(null);

/** The recorder refuses to start with less free space than this. */
export const MIN_FREE_MB = 60;
/** Long meetings are fine; a recording left running by mistake is not. */
export const MAX_RECORDING_MS = 3 * 60 * 60 * 1000;
/** The model bundled in the app, recorded on each transcript. */
const WHISPER_MODEL = 'tiny.en';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const defaultMeetingTitle = (date = new Date()): string => {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `Meeting — ${MONTHS[date.getMonth()]} ${date.getDate()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const isDefaultTitle = (title: string): boolean => /^Meeting — /.test(title);

/**
 * What is stored beside an error code. A MeetingError's own message already is
 * the code's description, so storing it would print the description twice.
 */
const detailOf = (error: unknown): string | null =>
  error instanceof MeetingError ? error.detail || null : ((error as Error)?.message ?? null);

interface ActiveRecording {
  meetingId: string;
  accumulatedMs: number;
  resumedAt: number | null;
  paused: boolean;
}

const elapsedOf = (recording: ActiveRecording): number =>
  recording.accumulatedMs + (recording.resumedAt === null ? 0 : Date.now() - recording.resumedAt);

/**
 * Everything the meeting recorder does, above any one screen.
 *
 * It sits at the top of the app, like the Pomodoro timer, so a recording keeps
 * going while the student opens their notes or calendar in the middle of the
 * meeting, and so transcription that takes minutes keeps going too.
 *
 * Audio is recorded by a foreground service and transcribed on the phone by
 * the bundled Whisper model; only the transcript text goes out, to write the
 * notes. The audio stays until the student deletes it, so a meeting can be
 * transcribed again.
 */
export const MeetingsProvider: React.FC<{
  userId: string;
  /** Bumped when a sync pass brought in changes from another device. */
  syncRevision?: number;
  children: React.ReactNode;
}> = ({ userId, syncRevision = 0, children }) => {
  const available = meetingRecorder.isAvailable();
  const entitled = hasProEntitlement(userId);
  const [meetings, setMeetings] = useState<RecordedMeeting[]>([]);
  const [recorder, setRecorder] = useState<RecorderState | null>(null);
  const [recorderError, setRecorderError] = useState<MeetingErrorInfo | null>(null);
  const [processing, setProcessing] = useState<ProcessingState | null>(null);

  const active = useRef<ActiveRecording | null>(null);
  const job = useRef<{ meetingId: string; controller: AbortController } | null>(null);
  /** Recordings stopped while another meeting was processing, transcribed after it. */
  const queued = useRef<string[]>([]);
  const runPipelineRef = useRef<(id: string, from: 'transcribe' | 'notes') => Promise<void>>(async () => undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    setMeetings(recordedMeetingStore.list(userId));
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh, syncRevision]);

  const update = useCallback(
    (id: string, patch: MeetingPatch) => {
      recordedMeetingStore.update(id, patch);
      refresh();
    },
    [refresh],
  );

  // ── Processing ────────────────────────────────────────────────────────

  const runNotes = useCallback(
    async (id: string, controller: AbortController) => {
      const meeting = recordedMeetingStore.get(id);
      if (!meeting?.transcript?.length) return;

      if (!hasProEntitlement(userId)) {
        // Not an error: the transcript is the result on this plan.
        update(id, { status: 'transcription_complete', errorCode: 'plan_required', errorDetail: null });
        return;
      }

      update(id, { status: 'generating_notes', errorCode: null, errorDetail: null });
      setProcessing({
        meetingId: id,
        stage: 'generating_notes',
        percent: 0,
        message: 'Preparing the transcript…',
        etaSeconds: null,
      });

      const cache = { ...meeting.sectionCache };
      try {
        const result = await generateMeetingNotes({
          segments: meeting.transcript,
          skill: meetingNotesSkill,
          titleHint: isDefaultTitle(meeting.title) ? '' : meeting.title,
          recordedAt: meeting.startedAt,
          signal: controller.signal,
          cachedSections: cache,
          onSectionDone: (key, notes) => {
            cache[key] = notes;
            recordedMeetingStore.update(id, { sectionCache: cache });
          },
          onProgress: (progress) =>
            setProcessing((current) =>
              current?.meetingId === id
                ? { ...current, percent: progress.percent, message: progress.message }
                : current,
            ),
        });
        const latest = recordedMeetingStore.get(id);
        update(id, {
          status: 'completed',
          notes: result.notes,
          notesEdited: false,
          sectionCache: {},
          errorCode: null,
          errorDetail: null,
          title: latest && isDefaultTitle(latest.title) && result.notes.title ? result.notes.title : undefined,
        });
      } catch (error) {
        const code = error instanceof MeetingError ? error.code : 'unknown';
        if (code === 'cancelled') update(id, { status: 'cancelled', errorCode: null });
        else if (code === 'plan_required') update(id, { status: 'transcription_complete', errorCode: 'plan_required' });
        else update(id, { status: 'error', errorCode: code, errorDetail: detailOf(error) });
      }
    },
    [update, userId],
  );

  const runTranscription = useCallback(
    async (id: string, controller: AbortController): Promise<boolean> => {
      update(id, { status: 'transcribing', errorCode: null, errorDetail: null });
      setProcessing({
        meetingId: id,
        stage: 'transcribing',
        percent: 0,
        message: 'Preparing the recording…',
        etaSeconds: null,
      });

      const audio = await meetingRecorder.listMeetingAudio(id).catch(() => ({ chunks: [], totalBytes: 0 }));
      if (!audio.chunks.length) {
        update(id, { status: 'error', errorCode: 'recording_lost', audioBytes: 0 });
        return false;
      }

      const startedAt = Date.now();
      const result = await transcribeMeetingChunks({
        meetingId: id,
        chunkFiles: audio.chunks.map((chunk) => chunk.path),
        chunkDurationsMs: audio.chunks.map((chunk) => chunk.durationMs),
        // The audio is kept for transcribing again, until the student deletes it.
        keepAudio: true,
        shouldCancel: () => controller.signal.aborted,
        onProgress: (fraction, done, total) => {
          const elapsed = (Date.now() - startedAt) / 1000;
          setProcessing((current) =>
            current?.meetingId === id
              ? {
                  ...current,
                  percent: Math.round(fraction * 100),
                  message:
                    done < total
                      ? `Transcribing on this phone — part ${done + 1} of ${total}`
                      : 'Putting the transcript together…',
                  etaSeconds: done > 0 && done < total ? Math.round((elapsed / done) * (total - done)) : null,
                }
              : current,
          );
        },
      });

      if (result.cancelled || controller.signal.aborted) {
        update(id, { status: 'cancelled', errorCode: null });
        return false;
      }
      if (result.failedChunks === audio.chunks.length) {
        const code: MeetingErrorCode = /WHISPER_INIT|initiali[sz]e Whisper/i.test(result.lastError ?? '')
          ? 'whisper_init_failed'
          : 'transcription_failed';
        update(id, { status: 'error', errorCode: code, errorDetail: result.lastError });
        return false;
      }

      const segments = cleanSegments(
        result.segments.map((segment) => ({ startMs: segment.start_ms, endMs: segment.end_ms, text: segment.text })),
      );
      const durationMs = audio.chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0);
      update(id, {
        status: segments.length ? 'transcription_complete' : 'error',
        errorCode: segments.length ? null : 'empty_transcript',
        errorDetail: null,
        transcript: segments,
        language: 'en',
        transcriptionDevice: 'cpu',
        whisperModel: WHISPER_MODEL,
        durationSeconds: durationMs > 0 ? Math.round(durationMs / 1000) : undefined,
        audioBytes: audio.totalBytes,
        // A new transcript means cached sections no longer match it.
        sectionCache: {},
      });
      return segments.length > 0;
    },
    [update],
  );

  const runPipeline = useCallback(
    async (id: string, from: 'transcribe' | 'notes') => {
      if (job.current) {
        if (from === 'transcribe' && job.current.meetingId !== id && !queued.current.includes(id)) {
          queued.current.push(id);
        }
        return;
      }
      const controller = new AbortController();
      job.current = { meetingId: id, controller };
      try {
        if (from === 'transcribe') {
          const transcribed = await runTranscription(id, controller).catch((error) => {
            update(id, { status: 'error', errorCode: 'transcription_failed', errorDetail: detailOf(error) });
            return false;
          });
          if (!transcribed) return;
        }
        if (controller.signal.aborted) return;
        await runNotes(id, controller);
      } finally {
        job.current = null;
        if (mounted.current) setProcessing(null);
        const next = queued.current.shift();
        if (next && recordedMeetingStore.get(next)) void runPipelineRef.current(next, 'transcribe');
      }
    },
    [runNotes, runTranscription, update],
  );
  runPipelineRef.current = runPipeline;

  const transcribeMeeting = useCallback((id: string) => runPipeline(id, 'transcribe'), [runPipeline]);
  const generateNotes = useCallback((id: string) => runPipeline(id, 'notes'), [runPipeline]);

  const cancelProcessing = useCallback(() => {
    // Transcription stops after the part it is on; notes stop at once.
    job.current?.controller.abort();
  }, []);

  // ── Recording ─────────────────────────────────────────────────────────

  const finishActive = useCallback(
    async (options: { reason?: MeetingErrorCode; process: boolean }) => {
      const recording = active.current;
      if (!recording) return;
      active.current = null;
      const id = recording.meetingId;
      setRecorder((current) => (current ? { ...current, status: 'stopping' } : current));

      await meetingRecorder.stop().catch((error) => {
        console.error('[Meetings] Could not stop the recording cleanly:', error);
        return null;
      });
      const audio = await meetingRecorder.listMeetingAudio(id).catch(() => ({ chunks: [], totalBytes: 0 }));
      const recordedMs = audio.chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0);
      const saved = audio.chunks.length > 0;
      update(id, {
        status: saved ? 'recording_complete' : 'error',
        durationSeconds: Math.round((recordedMs || elapsedOf(recording)) / 1000),
        audioBytes: audio.totalBytes,
        errorCode: saved ? (options.reason ?? null) : 'recording_failed',
      });
      if (mounted.current) setRecorder(null);

      // A normal stop goes straight on to transcription. An abnormal one waits,
      // so the reason it stopped is seen before it is replaced by progress.
      if (saved && options.process && !options.reason) void runPipeline(id, 'transcribe');
    },
    [runPipeline, update],
  );

  const startRecording = useCallback(
    async (input: { title?: string }) => {
      if (active.current || !available || !hasProEntitlement(userId)) return;
      setRecorderError(null);

      if (!(await meetingRecorder.requestPermission())) {
        setRecorderError(describeMeetingError('microphone_permission_denied'));
        return;
      }
      const freeMb = await meetingRecorder.getAvailableStorageMB().catch(() => Number.POSITIVE_INFINITY);
      if (freeMb < MIN_FREE_MB) {
        setRecorderError(describeMeetingError('insufficient_storage'));
        return;
      }

      const id = generateId('meeting');
      const title = input.title?.trim() || defaultMeetingTitle();
      recordedMeetingStore.create({ id, userId, title, microphoneLabel: 'Phone microphone' });
      setRecorder({ meetingId: id, status: 'starting', elapsedMs: 0 });

      try {
        await meetingRecorder.start(id, title);
      } catch (error) {
        console.error('[Meetings] Could not start recording:', error);
        recordedMeetingStore.remove(id);
        setRecorder(null);
        const busy = /ALREADY_RECORDING|already being recorded/i.test(String((error as Error)?.message ?? ''));
        setRecorderError(describeMeetingError(busy ? 'microphone_in_use' : 'recording_failed'));
        refresh();
        return;
      }

      active.current = { meetingId: id, accumulatedMs: 0, resumedAt: Date.now(), paused: false };
      setRecorder({ meetingId: id, status: 'recording', elapsedMs: 0 });
      refresh();
    },
    [available, refresh, userId],
  );

  const pauseRecording = useCallback(async () => {
    const recording = active.current;
    if (!recording || recording.paused) return;
    await meetingRecorder.pause().catch(() => false);
    recording.accumulatedMs = elapsedOf(recording);
    recording.resumedAt = null;
    recording.paused = true;
    update(recording.meetingId, { status: 'paused' });
    setRecorder((current) => (current ? { ...current, status: 'paused', elapsedMs: recording.accumulatedMs } : current));
  }, [update]);

  const resumeRecording = useCallback(async () => {
    const recording = active.current;
    if (!recording || !recording.paused) return;
    await meetingRecorder.resume().catch(() => false);
    recording.resumedAt = Date.now();
    recording.paused = false;
    update(recording.meetingId, { status: 'recording' });
    setRecorder((current) => (current ? { ...current, status: 'recording' } : current));
  }, [update]);

  const stopRecording = useCallback(() => finishActive({ process: true }), [finishActive]);

  const discardRecording = useCallback(async () => {
    const recording = active.current;
    if (!recording) return;
    active.current = null;
    setRecorder((current) => (current ? { ...current, status: 'stopping' } : current));
    await meetingRecorder.stop().catch(() => null);
    await meetingRecorder.deleteMeetingAudio(recording.meetingId).catch(() => false);
    recordedMeetingStore.remove(recording.meetingId);
    if (mounted.current) setRecorder(null);
    refresh();
  }, [refresh]);

  // The clock, and a watch on the service: it stops on its own when storage
  // runs out or the microphone fails, and a long-forgotten recording is ended.
  const recordingId = recorder?.meetingId;
  const recordingStatus = recorder?.status;
  useEffect(() => {
    if (!recordingId || recordingStatus === 'starting' || recordingStatus === 'stopping') return undefined;
    let ticks = 0;
    const timer = setInterval(() => {
      const recording = active.current;
      if (!recording) return;
      const elapsedMs = elapsedOf(recording);
      setRecorder((current) => (current && current.status !== 'stopping' ? { ...current, elapsedMs } : current));
      if (elapsedMs >= MAX_RECORDING_MS) {
        void finishActive({ process: true });
        return;
      }
      ticks += 1;
      if (ticks % 6 !== 0) return;
      void meetingRecorder.isRecording().then(async (running) => {
        if (running || active.current !== recording) return;
        const freeMb = await meetingRecorder.getAvailableStorageMB().catch(() => Number.POSITIVE_INFINITY);
        const reason: MeetingErrorCode = freeMb < MIN_FREE_MB ? 'insufficient_storage' : 'recording_failed';
        setRecorderError(describeMeetingError(reason));
        await finishActive({ reason, process: false });
      });
    }, 500);
    return () => clearInterval(timer);
  }, [recordingId, recordingStatus, finishActive]);

  // ── Editing ───────────────────────────────────────────────────────────

  const renameMeeting = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      update(id, { title: trimmed });
    },
    [update],
  );

  const saveNotes = useCallback(
    (id: string, notes: MeetingNotes) => {
      update(id, { notes, notesEdited: true });
    },
    [update],
  );

  const deleteAudio = useCallback(
    async (id: string) => {
      if (job.current?.meetingId === id || active.current?.meetingId === id) return;
      await meetingRecorder.deleteMeetingAudio(id).catch(() => false);
      update(id, { audioBytes: 0 });
    },
    [update],
  );

  const deleteMeeting = useCallback(
    async (id: string) => {
      if (active.current?.meetingId === id) return;
      queued.current = queued.current.filter((entry) => entry !== id);
      if (job.current?.meetingId === id) job.current.controller.abort();
      await meetingRecorder.deleteMeetingAudio(id).catch(() => false);
      recordedMeetingStore.remove(id);
      refresh();
    },
    [refresh],
  );

  // ── Startup: meetings left mid-way by a closed app ────────────────────

  useEffect(() => {
    if (!available) return undefined;
    let cancelled = false;
    const recover = async (): Promise<void> => {
      const stillRecording = await meetingRecorder.isRecording().catch(() => false);
      const interrupted = recordedMeetingStore.findInterrupted(userId);
      let reattached = false;

      for (const meeting of interrupted) {
        if (cancelled) return;
        // Work this session started is not interrupted.
        if (meeting.id === active.current?.meetingId || meeting.id === job.current?.meetingId) continue;
        if (meeting.status === 'recording' || meeting.status === 'paused') {
          // The service outlived the screen (the app was swiped away mid-meeting
          // and opened again): carry on showing the recording that is running.
          if (stillRecording && !reattached && !active.current) {
            reattached = true;
            const paused = meeting.status === 'paused';
            // Pauses before the restart are not known here, so the clock
            // counts from the start and may read a little long.
            const sinceStart = Math.max(0, Date.now() - Date.parse(meeting.startedAt));
            active.current = paused
              ? { meetingId: meeting.id, accumulatedMs: sinceStart, resumedAt: null, paused: true }
              : { meetingId: meeting.id, accumulatedMs: 0, resumedAt: Date.now() - sinceStart, paused: false };
            setRecorder({ meetingId: meeting.id, status: paused ? 'paused' : 'recording', elapsedMs: sinceStart });
            continue;
          }
          const audio = await meetingRecorder.listMeetingAudio(meeting.id).catch(() => ({ chunks: [], totalBytes: 0 }));
          const recordedMs = audio.chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0);
          recordedMeetingStore.update(
            meeting.id,
            audio.chunks.length
              ? {
                  status: 'recording_complete',
                  durationSeconds: Math.round(recordedMs / 1000),
                  audioBytes: audio.totalBytes,
                  recovered: true,
                  errorCode: null,
                }
              : { status: 'error', errorCode: 'recording_lost' },
          );
        } else if (meeting.status === 'importing') {
          recordedMeetingStore.update(meeting.id, { status: 'error', errorCode: 'import_interrupted' });
        } else if (meeting.status === 'transcribing') {
          recordedMeetingStore.update(meeting.id, { status: 'cancelled', errorCode: 'transcription_interrupted' });
        } else if (meeting.status === 'generating_notes') {
          recordedMeetingStore.update(meeting.id, { status: 'cancelled', errorCode: 'notes_interrupted' });
        }
      }
      // The rows now hold what the recovery file did.
      if (!stillRecording) await meetingRecorder.clearRecoveryState().catch(() => false);
      if (!cancelled) refresh();
    };
    void recover();
    return () => {
      cancelled = true;
    };
  }, [available, refresh, userId]);

  const value = useMemo<MeetingsContextValue>(
    () => ({
      userId,
      meetings,
      refresh,
      available,
      entitled,
      recorder,
      recorderError,
      clearRecorderError: () => setRecorderError(null),
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      discardRecording,
      processing,
      transcribeMeeting,
      generateNotes,
      cancelProcessing,
      renameMeeting,
      saveNotes,
      deleteAudio,
      deleteMeeting,
    }),
    [
      userId, meetings, refresh, available, entitled, recorder, recorderError, startRecording, pauseRecording,
      resumeRecording, stopRecording, discardRecording, processing, transcribeMeeting, generateNotes,
      cancelProcessing, renameMeeting, saveNotes, deleteAudio, deleteMeeting,
    ],
  );

  return <MeetingsContext.Provider value={value}>{children}</MeetingsContext.Provider>;
};

export const useMeetings = (): MeetingsContextValue => {
  const context = useContext(MeetingsContext);
  if (!context) throw new Error('useMeetings must be used inside a MeetingsProvider.');
  return context;
};

/** For surfaces outside the meetings screen, such as the tab bar, that may render without one. */
export const useMeetingRecorderIndicator = (): RecorderState | null =>
  useContext(MeetingsContext)?.recorder ?? null;
