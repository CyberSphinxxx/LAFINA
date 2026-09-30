/**
 * Formatting for the meeting screens, and the error wording that differs on a
 * phone. The shared catalogue (`src/meetings/meetingErrors.ts`) is written for
 * the desktop app, where Whisper is installed separately and a microphone can
 * be chosen; here the model ships inside the app and there is one microphone.
 */

import { describeMeetingError } from '../../../meetings';
import type { MeetingErrorCode, MeetingErrorInfo } from '../../../meetings';

/** `00:42:17`: the recording clock always shows hours, so it never changes width mid-meeting. */
export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
};

/** `1 h 02 min`, `12 min`, `45 s`. */
export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min`;
};

/** "About 3 minutes left", once there is an estimate worth giving. */
export const formatEta = (seconds: number | null): string | null => {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (seconds < 45) return 'Less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `About ${minutes} minute${minutes === 1 ? '' : 's'} left`;
  return `About ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

/** A filename every platform accepts. */
export const meetingFileName = (title: string, extension: string): string => {
  const safe = (title || 'meeting')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${safe || 'meeting'}.${extension}`;
};

type PhoneWording = Partial<Omit<MeetingErrorInfo, 'code'>>;

const ON_A_PHONE: Partial<Record<MeetingErrorCode, PhoneWording>> = {
  microphone_permission_denied: {
    title: 'Microphone access is off',
    message: 'Android is not letting LAFINA use the microphone. Allow it in LAFINA’s app settings, then record again.',
    recoveryLabel: 'Open app settings',
  },
  microphone_in_use: {
    title: 'The microphone is busy',
    message: 'Another recording is already running. Stop it, then record again.',
    recovery: 'none',
    recoveryLabel: '',
  },
  recording_failed: {
    message:
      'The microphone stopped delivering audio, which can happen when another app takes it over. Everything captured before that is saved.',
    recovery: 'none',
    recoveryLabel: '',
  },
  insufficient_storage: {
    title: 'The phone is almost full',
    message: 'There is not enough free space to keep recording. What was recorded is saved. Free some space, then record again.',
    recovery: 'none',
    recoveryLabel: '',
  },
  recording_lost: {
    message: 'The audio for this meeting is no longer on this phone, so it cannot be transcribed.',
  },
  whisper_init_failed: {
    title: 'The speech model could not load',
    message: 'The on-device transcription model did not start, usually because the phone is short of memory. Close other apps and try again.',
    recovery: 'retry_transcription',
    recoveryLabel: 'Try again',
  },
  transcription_failed: {
    message: 'Transcription stopped before finishing. The recording is kept, so it can be transcribed again.',
  },
  transcription_interrupted: {
    message: 'LAFINA closed while this meeting was being transcribed. The recording is kept, so it can be transcribed again.',
    recoveryLabel: 'Transcribe again',
  },
  empty_transcript: {
    message: 'No speech was heard in this recording. Keep the phone close to whoever is speaking, and uncovered.',
    recovery: 'none',
    recoveryLabel: '',
  },
  offline: {
    message: 'The transcript is saved on this phone. Notes are written by DeepSeek, so they need a connection.',
  },
  unknown: {
    message:
      'LAFINA hit an error it does not recognise while processing this meeting. The recording is still on this phone, so the step can be run again.',
  },
};

/** The shared description of an error, reworded where a phone differs. */
export const describeMeetingProblem = (code: MeetingErrorCode, detail?: string): MeetingErrorInfo => {
  const base = describeMeetingError(code, detail);
  const phone = ON_A_PHONE[code];
  if (!phone) return base;
  // An unknown error keeps the detail the shared wording appends to it.
  const message = code === 'unknown' && detail ? `${phone.message} (${detail})` : phone.message ?? base.message;
  return { ...base, ...phone, message };
};
