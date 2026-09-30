import { NativeModules, PermissionsAndroid } from 'react-native';

export interface MeetingRecordingSession {
  meetingId: string;
  title: string;
  durationSeconds: number;
  chunkFiles: string[];
  status?: 'recording' | 'stopped';
  /** False when the recorder did not finish writing before the stop gave up waiting. */
  finalized?: boolean;
}

export interface MeetingSegment {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  speaker?: string;
}

/** One recorded chunk. Chunks end early on a pause or a stop, so lengths vary. */
export interface MeetingAudioChunk {
  path: string;
  durationMs: number;
  bytes: number;
}

export interface MeetingAudio {
  chunks: MeetingAudioChunk[];
  totalBytes: number;
}

interface LafinaMeetingRecorderNativeModule {
  startMeetingRecording: (options: { meetingId: string; title: string }) => Promise<{ success: boolean; meetingId: string }>;
  pauseMeetingRecording: () => Promise<boolean>;
  resumeMeetingRecording: () => Promise<boolean>;
  stopMeetingRecording: () => Promise<MeetingRecordingSession>;
  isMeetingRecording?: () => Promise<boolean>;
  getAvailableStorageMB: () => Promise<number>;
  getRecoverableMeeting: () => Promise<MeetingRecordingSession | null>;
  discardRecoverableMeeting: () => Promise<boolean>;
  clearRecoveryState?: () => Promise<boolean>;
  listMeetingAudio?: (meetingId: string) => Promise<MeetingAudio>;
  deleteMeetingAudio?: (meetingId: string) => Promise<boolean>;
  transcribeChunkWithTimestamps: (filePath: string) => Promise<string>;
  deleteAudioFile: (filePath: string) => Promise<boolean>;
}

const getNativeModule = (): LafinaMeetingRecorderNativeModule | null => {
  const module = NativeModules.LafinaMeetingRecorder as LafinaMeetingRecorderNativeModule | undefined;
  return module?.startMeetingRecording ? module : null;
};

export const meetingRecorder = {
  isAvailable: (): boolean => getNativeModule() !== null,

  /** Asks for the microphone; the recording service cannot start without it. */
  requestPermission: async (): Promise<boolean> => {
    try {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  },

  start: async (meetingId: string, title: string): Promise<{ success: boolean; meetingId: string }> => {
    const module = getNativeModule();
    if (!module) throw new Error('Native meeting recorder is unavailable.');
    return module.startMeetingRecording({ meetingId, title });
  },

  pause: async (): Promise<boolean> => {
    const module = getNativeModule();
    if (!module) return false;
    return module.pauseMeetingRecording();
  },

  resume: async (): Promise<boolean> => {
    const module = getNativeModule();
    if (!module) return false;
    return module.resumeMeetingRecording();
  },

  stop: async (): Promise<MeetingRecordingSession> => {
    const module = getNativeModule();
    if (!module) throw new Error('Native meeting recorder is unavailable.');
    return module.stopMeetingRecording();
  },

  /** False once the service has stopped, including on its own (storage ran out, microphone failed). */
  isRecording: async (): Promise<boolean> => {
    const module = getNativeModule();
    if (!module?.isMeetingRecording) return false;
    return module.isMeetingRecording();
  },

  getAvailableStorageMB: async (): Promise<number> => {
    const module = getNativeModule();
    if (!module) return 1024.0; // fallback mock
    return module.getAvailableStorageMB();
  },

  getRecoverableMeeting: async (): Promise<MeetingRecordingSession | null> => {
    const module = getNativeModule();
    if (!module) return null;
    return module.getRecoverableMeeting();
  },

  discardRecoverableMeeting: async (): Promise<boolean> => {
    const module = getNativeModule();
    if (!module) return true;
    return module.discardRecoverableMeeting();
  },

  /** Forgets the recovery file, leaving the audio it lists in place. */
  clearRecoveryState: async (): Promise<boolean> => {
    const module = getNativeModule();
    if (!module?.clearRecoveryState) return true;
    return module.clearRecoveryState();
  },

  /** A meeting's audio chunks on this device, in recording order. */
  listMeetingAudio: async (meetingId: string): Promise<MeetingAudio> => {
    const module = getNativeModule();
    if (!module?.listMeetingAudio) return { chunks: [], totalBytes: 0 };
    return module.listMeetingAudio(meetingId);
  },

  deleteMeetingAudio: async (meetingId: string): Promise<boolean> => {
    const module = getNativeModule();
    if (!module?.deleteMeetingAudio) return true;
    return module.deleteMeetingAudio(meetingId);
  },

  transcribeChunkWithTimestamps: async (filePath: string): Promise<Array<{ start_ms: number; end_ms: number; text: string }>> => {
    const module = getNativeModule();
    if (!module) return [];
    const jsonStr = await module.transcribeChunkWithTimestamps(filePath);
    try {
      return JSON.parse(jsonStr);
    } catch {
      return [];
    }
  },

  deleteAudioFile: async (filePath: string): Promise<boolean> => {
    const module = getNativeModule();
    if (!module) return true;
    return module.deleteAudioFile(filePath);
  },
};
