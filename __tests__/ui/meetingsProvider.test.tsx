import React, { useImperativeHandle } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NativeModules, PermissionsAndroid } from 'react-native';

jest.mock('../../src/cloud', () => ({
  hasProEntitlement: jest.fn(() => true),
}));

import { cloudClient } from '../../src/cloud/cloudClient';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { recordedMeetingStore } from '../../src/storage/recordedMeetingStore';
import { syncOutboxStore } from '../../src/storage/syncOutboxStore';
import { MeetingsProvider, useMeetings } from '../../src/ui/contexts/MeetingsContext';

type MeetingsValue = ReturnType<typeof useMeetings>;

const USER = 'meetings-provider-user';

const Probe = React.forwardRef<MeetingsValue>((_, ref) => {
  const value = useMeetings();
  useImperativeHandle(ref, () => value, [value]);
  return null;
});

/** Lets chains of awaited native calls and store writes run to the end. */
const flush = async (rounds = 30): Promise<void> => {
  await act(async () => {
    for (let round = 0; round < rounds; round += 1) {
      await Promise.resolve();
    }
  });
};

const chunk = (index: number, durationMs: number) => ({
  path: `/data/meetings/m/chunk_${index}.wav`,
  durationMs,
  bytes: 44 + (durationMs / 1000) * 32_000,
});

const createNative = () => ({
  startMeetingRecording: jest.fn(async ({ meetingId }: { meetingId: string }) => ({ success: true, meetingId })),
  pauseMeetingRecording: jest.fn(async () => true),
  resumeMeetingRecording: jest.fn(async () => true),
  stopMeetingRecording: jest.fn(async () => ({ chunkFiles: [], durationSeconds: 0, finalized: true })),
  isMeetingRecording: jest.fn(async () => true),
  getAvailableStorageMB: jest.fn(async () => 4096),
  getRecoverableMeeting: jest.fn(async () => null),
  discardRecoverableMeeting: jest.fn(async () => true),
  clearRecoveryState: jest.fn(async () => true),
  listMeetingAudio: jest.fn(async () => ({ chunks: [chunk(0, 30_000), chunk(1, 12_000)], totalBytes: 1_344_088 })),
  deleteMeetingAudio: jest.fn(async () => true),
  transcribeChunkWithTimestamps: jest.fn(async (path: string) =>
    path.endsWith('chunk_0.wav')
      ? JSON.stringify([{ start_ms: 0, end_ms: 4000, text: ' We agreed to ship on Friday.' }])
      : // Whisper pads a short chunk to 30 s and can place text past its end.
        JSON.stringify([{ start_ms: 1000, end_ms: 29_000, text: 'Ana will write the report.' }]),
  ),
  deleteAudioFile: jest.fn(async () => true),
});

const NOTES = {
  title: 'Launch planning',
  summary: 'The team agreed on a Friday launch.',
  key_topics: [],
  decisions: ['Ship on Friday'],
  action_items: [{ task: 'Write the report', assignee: 'Ana', deadline: 'Thursday', status: 'pending' }],
  important_dates: [],
  issues: [],
  unresolved_questions: [],
  key_points: [],
};

const renderProvider = () => {
  const ref = React.createRef<MeetingsValue>();
  act(() => {
    ReactTestRenderer.create(
      <MeetingsProvider userId={USER}>
        <Probe ref={ref} />
      </MeetingsProvider>,
    );
  });
  return ref;
};

describe('MeetingsProvider on mobile', () => {
  let native: ReturnType<typeof createNative>;

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM recorded_meetings');
    db.executeSync('DELETE FROM sync_outbox');
    native = createNative();
    (NativeModules as Record<string, unknown>).LafinaMeetingRecorder = native;
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (NativeModules as Record<string, unknown>).LafinaMeetingRecorder;
  });

  it('records, transcribes on the phone, writes the notes, and queues the text for sync', async () => {
    const request = jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: { requestId: 'r1', notes: NOTES, model: 'deepseek', usage: {}, createdAt: '' } as never,
    });
    const meetings = renderProvider();
    await flush();

    await act(async () => {
      await meetings.current!.startRecording({});
    });
    const meetingId = native.startMeetingRecording.mock.calls[0][0].meetingId;
    expect(meetings.current!.recorder).toMatchObject({ meetingId, status: 'recording' });
    expect(recordedMeetingStore.get(meetingId)?.status).toBe('recording');

    await act(async () => {
      await meetings.current!.stopRecording();
    });
    await flush();

    expect(native.stopMeetingRecording).toHaveBeenCalledTimes(1);
    expect(native.transcribeChunkWithTimestamps).toHaveBeenCalledTimes(2);
    // The audio is kept for transcribing again.
    expect(native.deleteAudioFile).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith('/v1/ai/meeting-notes/generate', expect.anything(), true);

    const meeting = recordedMeetingStore.get(meetingId)!;
    expect(meeting.status).toBe('completed');
    expect(meeting.durationSeconds).toBe(42);
    expect(meeting.whisperModel).toBe('tiny.en');
    expect(meeting.transcript).toEqual([
      { startMs: 0, endMs: 4000, text: 'We agreed to ship on Friday.' },
      // The second chunk starts where the first really ended, and its text is clamped to its length.
      { startMs: 31_000, endMs: 42_000, text: 'Ana will write the report.' },
    ]);
    expect(meeting.notes?.decisions).toEqual(['Ship on Friday']);
    // The default title gives way to the one the notes suggest.
    expect(meeting.title).toBe('Launch planning');
    expect(meetings.current!.recorder).toBeNull();
    expect(meetings.current!.processing).toBeNull();

    const pending = syncOutboxStore.getPendingMutations(USER).filter((row) => row.entityType === 'recorded_meeting');
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[pending.length - 1].payload).toMatchObject({ status: 'completed', title: 'Launch planning' });
  });

  it('keeps the transcript and says so when notes need Student Pro', async () => {
    const { hasProEntitlement } = jest.requireMock('../../src/cloud') as { hasProEntitlement: jest.Mock };
    const meetings = renderProvider();
    await flush();
    await act(async () => {
      await meetings.current!.startRecording({ title: 'Lab sync' });
    });
    hasProEntitlement.mockReturnValue(false);
    await act(async () => {
      await meetings.current!.stopRecording();
    });
    await flush();
    hasProEntitlement.mockReturnValue(true);

    const [meeting] = recordedMeetingStore.list(USER);
    expect(meeting.status).toBe('transcription_complete');
    expect(meeting.errorCode).toBe('plan_required');
    expect(meeting.transcript).toHaveLength(2);
  });

  it('tells a model failure apart from a silent recording', async () => {
    native.transcribeChunkWithTimestamps.mockRejectedValue(new Error('Failed to initialize Whisper model context'));
    const meetings = renderProvider();
    await flush();
    await act(async () => {
      await meetings.current!.startRecording({});
    });
    await act(async () => {
      await meetings.current!.stopRecording();
    });
    await flush();

    const [meeting] = recordedMeetingStore.list(USER);
    expect(meeting.status).toBe('error');
    expect(meeting.errorCode).toBe('whisper_init_failed');
  });

  it('does not record without the microphone', async () => {
    jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    const meetings = renderProvider();
    await flush();
    await act(async () => {
      await meetings.current!.startRecording({});
    });
    expect(native.startMeetingRecording).not.toHaveBeenCalled();
    expect(meetings.current!.recorderError?.code).toBe('microphone_permission_denied');
    expect(recordedMeetingStore.list(USER)).toEqual([]);
  });

  it('notices the service stopping on its own and keeps what was recorded', async () => {
    jest.useFakeTimers();
    const meetings = renderProvider();
    await flush();
    await act(async () => {
      await meetings.current!.startRecording({});
    });
    native.isMeetingRecording.mockResolvedValue(false);
    native.getAvailableStorageMB.mockResolvedValue(10);

    await act(async () => {
      jest.advanceTimersByTime(3_100);
    });
    await flush();

    const [meeting] = recordedMeetingStore.list(USER);
    expect(meeting.status).toBe('recording_complete');
    expect(meeting.errorCode).toBe('insufficient_storage');
    expect(meetings.current!.recorderError?.code).toBe('insufficient_storage');
    // An abnormal stop waits, so its reason is seen before processing replaces it.
    expect(native.transcribeChunkWithTimestamps).not.toHaveBeenCalled();
  });

  it('picks up meetings a closed app left mid-way', async () => {
    native.isMeetingRecording.mockResolvedValue(false);
    recordedMeetingStore.create({ id: 'interrupted-recording', userId: USER, title: 'Standup' });
    recordedMeetingStore.create({ id: 'interrupted-transcribing', userId: USER, title: 'Review' });
    recordedMeetingStore.update('interrupted-transcribing', { status: 'transcribing' });

    const meetings = renderProvider();
    await flush();

    const recovered = recordedMeetingStore.get('interrupted-recording')!;
    expect(recovered).toMatchObject({ status: 'recording_complete', recovered: true, durationSeconds: 42 });
    expect(recordedMeetingStore.get('interrupted-transcribing')).toMatchObject({
      status: 'cancelled',
      errorCode: 'transcription_interrupted',
    });
    expect(native.clearRecoveryState).toHaveBeenCalled();
    expect(meetings.current!.meetings).toHaveLength(2);
  });

  it('carries on showing a recording the service is still making', async () => {
    recordedMeetingStore.create({ id: 'still-recording', userId: USER, title: 'Long meeting' });
    const meetings = renderProvider();
    await flush();

    expect(meetings.current!.recorder).toMatchObject({ meetingId: 'still-recording', status: 'recording' });
    expect(recordedMeetingStore.get('still-recording')?.status).toBe('recording');
    expect(native.clearRecoveryState).not.toHaveBeenCalled();
  });

  it('deletes the audio but keeps the transcript', async () => {
    recordedMeetingStore.create({ id: 'with-audio', userId: USER, title: 'Retro' });
    recordedMeetingStore.update('with-audio', {
      status: 'transcription_complete',
      audioBytes: 5000,
      transcript: [{ startMs: 0, endMs: 1000, text: 'Hello.' }],
    });
    native.isMeetingRecording.mockResolvedValue(false);
    const meetings = renderProvider();
    await flush();

    await act(async () => {
      await meetings.current!.deleteAudio('with-audio');
    });
    expect(native.deleteMeetingAudio).toHaveBeenCalledWith('with-audio');
    expect(recordedMeetingStore.get('with-audio')).toMatchObject({ audioBytes: 0, status: 'transcription_complete' });
  });
});
