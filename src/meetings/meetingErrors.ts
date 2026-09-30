/**
 * Every way a meeting can go wrong, and what to do about each one.
 *
 * An error the person cannot act on is not finished. Each code carries a plain
 * account of what happened and a recovery: the one thing most likely to fix
 * it, which the screen offers as a button.
 */

/**
 * The desktop app imports recordings in these formats. Mobile records its
 * own audio instead, so the import errors that quote this list never arise
 * here; it is kept so both apps share one error catalogue.
 */
const SUPPORTED_FORMATS_TEXT = 'MP3, M4A, WAV, FLAC, OGG, OPUS, WEBM and AAC audio';

export type MeetingErrorCode =
  | 'microphone_unavailable'
  | 'microphone_permission_denied'
  | 'microphone_in_use'
  | 'microphone_disconnected'
  | 'recording_failed'
  | 'insufficient_storage'
  | 'recording_lost'
  | 'unsupported_format'
  | 'whisper_missing'
  | 'whisper_init_failed'
  | 'model_missing'
  | 'model_invalid'
  | 'insufficient_ram'
  | 'transcription_failed'
  | 'transcription_stalled'
  | 'empty_transcript'
  | 'offline'
  | 'session_expired'
  | 'plan_required'
  | 'deepseek_unavailable'
  | 'deepseek_not_configured'
  | 'deepseek_out_of_credit'
  | 'notes_unavailable'
  | 'rate_limited'
  | 'context_too_long'
  | 'network_timeout'
  | 'malformed_response'
  | 'nothing_to_note'
  | 'transcription_interrupted'
  | 'notes_interrupted'
  | 'import_unsupported'
  | 'import_failed'
  | 'import_empty'
  | 'import_interrupted'
  | 'cancelled'
  | 'unknown';

export type RecoveryAction =
  | 'retry_recording'
  | 'choose_microphone'
  | 'open_privacy_settings'
  | 'free_space'
  | 'install_whisper'
  | 'install_model'
  | 'choose_smaller_model'
  | 'retry_transcription'
  | 'retry_notes'
  | 'sign_in'
  | 'upgrade'
  | 'view_transcript'
  | 'choose_file'
  | 'none';

export interface MeetingErrorInfo {
  code: MeetingErrorCode;
  title: string;
  message: string;
  recovery: RecoveryAction;
  recoveryLabel: string;
}

const INFO: Record<MeetingErrorCode, Omit<MeetingErrorInfo, 'code'>> = {
  microphone_unavailable: {
    title: 'No microphone found',
    message: 'LAFINA could not find a microphone. Plug one in or check that the built-in one is enabled.',
    recovery: 'choose_microphone',
    recoveryLabel: 'Look for microphones again',
  },
  microphone_permission_denied: {
    title: 'Microphone access is blocked',
    message: 'Your system is not letting LAFINA use the microphone. Allow it in privacy settings, then try again.',
    recovery: 'open_privacy_settings',
    recoveryLabel: 'Open privacy settings',
  },
  microphone_in_use: {
    title: 'The microphone is busy',
    message: 'Another app is holding the microphone. Close it or pick a different microphone.',
    recovery: 'choose_microphone',
    recoveryLabel: 'Choose another microphone',
  },
  microphone_disconnected: {
    title: 'The microphone was disconnected',
    message: 'The recording stopped when the microphone went away. Everything up to that moment is saved.',
    recovery: 'choose_microphone',
    recoveryLabel: 'Choose a microphone',
  },
  recording_failed: {
    title: 'The recording stopped',
    message: 'The audio stream from the microphone stopped unexpectedly. Everything captured before it stopped is saved, and you can start a new recording.',
    recovery: 'retry_recording',
    recoveryLabel: 'Record again',
  },
  insufficient_storage: {
    title: 'The disk is full',
    message: 'There is not enough free space to keep recording. The recording so far is saved. Free some space to continue.',
    recovery: 'free_space',
    recoveryLabel: 'Show where recordings are stored',
  },
  recording_lost: {
    title: 'The recording file is missing',
    message: 'The audio for this meeting is no longer on this computer, so it cannot be transcribed.',
    recovery: 'none',
    recoveryLabel: '',
  },
  unsupported_format: {
    title: 'The recording could not be read',
    message: 'The audio file is damaged or not in a format Whisper can read.',
    recovery: 'retry_recording',
    recoveryLabel: 'Record again',
  },
  whisper_missing: {
    title: 'Transcription is not set up',
    message: 'Whisper, the local speech-to-text engine, is not installed yet. It runs on this computer, so the audio never leaves it.',
    recovery: 'install_whisper',
    recoveryLabel: 'Set up transcription',
  },
  whisper_init_failed: {
    title: 'Whisper could not start',
    message: 'The transcription engine failed to start. Reinstalling it usually fixes this.',
    recovery: 'install_whisper',
    recoveryLabel: 'Reinstall Whisper',
  },
  model_missing: {
    title: 'The Whisper model is not downloaded',
    message: 'The speech model for transcription has not been downloaded yet.',
    recovery: 'install_model',
    recoveryLabel: 'Download the model',
  },
  model_invalid: {
    title: 'The Whisper model is damaged',
    message: 'The speech model file is incomplete or damaged. Downloading it again fixes this.',
    recovery: 'install_model',
    recoveryLabel: 'Download it again',
  },
  insufficient_ram: {
    title: 'Not enough memory for this model',
    message: 'This computer does not have enough memory for the selected Whisper model. A smaller model will work.',
    recovery: 'choose_smaller_model',
    recoveryLabel: 'Choose a smaller model',
  },
  transcription_failed: {
    title: 'Transcription failed',
    message: 'Whisper stopped before finishing. Parts already transcribed are kept, so trying again picks up where it left off.',
    recovery: 'retry_transcription',
    recoveryLabel: 'Try transcribing again',
  },
  transcription_stalled: {
    title: 'Transcription stopped responding',
    message: 'Whisper stopped making progress and was stopped. Trying again resumes from the last finished part.',
    recovery: 'retry_transcription',
    recoveryLabel: 'Resume transcription',
  },
  empty_transcript: {
    title: 'No speech was found',
    message: 'Whisper did not hear any speech in this recording. Check that the right microphone was selected.',
    recovery: 'view_transcript',
    recoveryLabel: 'View the transcript',
  },
  offline: {
    title: 'You are offline',
    message: 'The transcript is saved on this computer. Notes are written by DeepSeek, so they need a connection.',
    recovery: 'retry_notes',
    recoveryLabel: 'Try again',
  },
  session_expired: {
    title: 'Sign in again',
    message: 'Your cloud session expired. The transcript is saved; sign out and back in, then generate the notes.',
    recovery: 'sign_in',
    recoveryLabel: 'Go to sign in',
  },
  plan_required: {
    title: 'Notes need Student Pro',
    message: 'Writing notes from the transcript is part of Student Pro, which this account does not have right now. The transcript is saved.',
    recovery: 'view_transcript',
    recoveryLabel: 'Read the transcript',
  },
  deepseek_unavailable: {
    title: 'DeepSeek is unavailable',
    message: 'The notes service is not answering right now. The transcript is saved — try again in a few minutes.',
    recovery: 'retry_notes',
    recoveryLabel: 'Try again',
  },
  deepseek_not_configured: {
    title: 'Notes are not configured on the server',
    message: "The server's DeepSeek API key is missing or invalid, so notes cannot be generated until an administrator fixes it. The transcript is saved.",
    recovery: 'view_transcript',
    recoveryLabel: 'Read the transcript',
  },
  deepseek_out_of_credit: {
    title: 'Notes are paused on the server',
    message:
      "The server's DeepSeek account has run out of credit, so notes cannot be generated until an administrator tops it up. The transcript is saved, and notes can be generated afterwards.",
    recovery: 'view_transcript',
    recoveryLabel: 'Read the transcript',
  },
  notes_unavailable: {
    title: 'Notes are not available on the server yet',
    message:
      "LAFINA's server does not have meeting notes yet, so they could not be written. The transcript is saved; generate the notes again once the server has been updated.",
    recovery: 'retry_notes',
    recoveryLabel: 'Try again',
  },
  rate_limited: {
    title: 'Too many requests',
    message: 'DeepSeek is limiting requests. Wait a minute, then try again.',
    recovery: 'retry_notes',
    recoveryLabel: 'Try again',
  },
  context_too_long: {
    title: 'Too long for one request',
    message: 'Part of the meeting was too long for DeepSeek to read. Trying again splits it into smaller parts.',
    recovery: 'retry_notes',
    recoveryLabel: 'Try again',
  },
  network_timeout: {
    title: 'The request timed out',
    message: 'DeepSeek took too long to answer. Parts already summarised are kept; try again.',
    recovery: 'retry_notes',
    recoveryLabel: 'Try again',
  },
  malformed_response: {
    title: 'The notes came back unreadable',
    message: 'DeepSeek returned something that was not usable notes. Generating them again usually works.',
    recovery: 'retry_notes',
    recoveryLabel: 'Generate again',
  },
  nothing_to_note: {
    title: 'Nothing to take notes on',
    message: 'DeepSeek found nothing to write up. The recording may be silent or too unclear — check the transcript.',
    recovery: 'view_transcript',
    recoveryLabel: 'View the transcript',
  },
  transcription_interrupted: {
    title: 'Transcription was interrupted',
    message: 'LAFINA closed while this meeting was being transcribed. The parts already finished are kept, so resuming carries on from there.',
    recovery: 'retry_transcription',
    recoveryLabel: 'Resume transcription',
  },
  notes_interrupted: {
    title: 'Notes were not finished',
    message: 'LAFINA closed while the notes were being written. The transcript is saved, and sections already summarised are kept.',
    recovery: 'retry_notes',
    recoveryLabel: 'Finish the notes',
  },
  import_unsupported: {
    title: 'This file cannot be imported',
    message: `LAFINA can import ${SUPPORTED_FORMATS_TEXT}. Convert the file to one of these, or choose another file.`,
    recovery: 'choose_file',
    recoveryLabel: 'Choose another file',
  },
  import_failed: {
    title: 'The file could not be read to the end',
    message:
      'The audio in this file is damaged or incomplete, so it could not be converted. If it plays in other apps, export it again as MP3 or WAV and import that.',
    recovery: 'choose_file',
    recoveryLabel: 'Choose another file',
  },
  import_empty: {
    title: 'No audio in this file',
    message: 'The file has no sound that could be read. Check that it is the right file.',
    recovery: 'choose_file',
    recoveryLabel: 'Choose another file',
  },
  import_interrupted: {
    title: 'The import did not finish',
    message: 'LAFINA closed while this audio file was being imported. Choose the file again to import it.',
    recovery: 'choose_file',
    recoveryLabel: 'Choose the file again',
  },
  cancelled: {
    title: 'Cancelled',
    message: 'Processing was stopped. Nothing finished so far has been thrown away.',
    recovery: 'none',
    recoveryLabel: '',
  },
  unknown: {
    title: 'This step could not finish',
    message: 'LAFINA hit an error it does not recognise while processing this meeting. Your recording is still saved on this computer, so the step can be run again.',
    recovery: 'retry_notes',
    recoveryLabel: 'Try again',
  },
};

/** Import problems are specific to the file, so what was found is said first. */
const LEADS_WITH_DETAIL = new Set<MeetingErrorCode>(['import_unsupported', 'import_failed', 'import_empty']);
/** Codes whose usual wording is about recording; an import says its own thing instead. */
const REPLACED_BY_DETAIL = new Set<MeetingErrorCode>(['insufficient_storage']);

export const describeMeetingError = (code: MeetingErrorCode, detail?: string): MeetingErrorInfo => {
  const info = INFO[code] ?? INFO.unknown;
  if (detail && LEADS_WITH_DETAIL.has(code)) return { code, ...info, message: `${detail} ${info.message}` };
  if (detail && REPLACED_BY_DETAIL.has(code)) return { code, ...info, message: detail };
  return { code, ...info, message: detail && code === 'unknown' ? `${info.message} (${detail})` : info.message };
};

export class MeetingError extends Error {
  constructor(
    readonly code: MeetingErrorCode,
    readonly detail = '',
  ) {
    super(describeMeetingError(code, detail).message);
    this.name = 'MeetingError';
  }
}

/** Maps a failed `getUserMedia` or a recorder failure to its code. */
export const classifyMicrophoneError = (error: unknown): MeetingErrorCode => {
  const name = (error as { name?: string })?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'microphone_permission_denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'microphone_unavailable';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'microphone_in_use';
    default:
      return 'recording_failed';
  }
};

const WHISPER_CODES: readonly MeetingErrorCode[] = [
  'whisper_missing',
  'whisper_init_failed',
  'model_missing',
  'model_invalid',
  'insufficient_ram',
  'unsupported_format',
  'transcription_failed',
  'transcription_stalled',
  'insufficient_storage',
  'cancelled',
];

/** Reads the code the main process attached to a failed transcription. */
export const classifyWhisperError = (error: unknown): MeetingErrorCode => {
  const message = String((error as Error)?.message ?? error ?? '');
  // IPC flattens errors to their message; the main process prefixes the code.
  const match = /\[([a-z_]+)\]/.exec(message);
  const code = (match?.[1] ?? (error as { code?: string })?.code ?? '') as MeetingErrorCode;
  return WHISPER_CODES.includes(code) ? code : 'transcription_failed';
};

export interface CloudFailure {
  status: string;
  error?: string;
  httpStatus?: number;
}

/**
 * Maps a failed notes request to its code, from the transport status, the
 * HTTP status and — where one status means two things — the server's wording,
 * which the server side keeps stable for exactly this.
 */
export const classifyNotesFailure = (failure: CloudFailure): MeetingErrorCode => {
  const detail = failure.error ?? '';
  switch (failure.status) {
    case 'offline':
      return 'offline';
    case 'auth_required':
      return 'session_expired';
    case 'subscription_required':
    case 'account_disabled':
      return 'plan_required';
    case 'rate_limited':
      return 'rate_limited';
    case 'server_unavailable':
      return 'deepseek_unavailable';
    default:
      break;
  }
  switch (failure.httpStatus) {
    // The route itself is missing: a server older than this version of the app.
    case 404:
      return 'notes_unavailable';
    case 413:
      return 'context_too_long';
    case 422:
      return 'nothing_to_note';
    case 502:
      return 'malformed_response';
    case 504:
      return 'network_timeout';
    case 503:
      if (/out of credit|insufficient balance/i.test(detail)) return 'deepseek_out_of_credit';
      return /not configured/i.test(detail) ? 'deepseek_not_configured' : 'deepseek_unavailable';
    default:
      return 'unknown';
  }
};

/** Whether waiting and asking again has a real chance of succeeding. */
export const isRetryable = (code: MeetingErrorCode): boolean =>
  code === 'rate_limited' ||
  code === 'deepseek_unavailable' ||
  code === 'network_timeout' ||
  code === 'malformed_response';
