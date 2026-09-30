/**
 * Where a meeting is in its life, and which moves are allowed.
 *
 * The states are explicit so the screen never has to infer them from a
 * combination of flags — "is there a transcript? is a job running?" — and so a
 * meeting found half-way through something after a restart can be put back
 * into a state it can actually leave.
 */

export type MeetingStatus =
  | 'idle'
  | 'recording'
  | 'paused'
  /** An audio file is being converted into the meeting's recording. */
  | 'importing'
  | 'recording_complete'
  | 'transcribing'
  | 'transcription_complete'
  | 'generating_notes'
  | 'completed'
  | 'error'
  | 'cancelled';

const TRANSITIONS: Record<MeetingStatus, readonly MeetingStatus[]> = {
  idle: ['recording', 'importing', 'error'],
  recording: ['paused', 'recording_complete', 'cancelled', 'error'],
  paused: ['recording', 'recording_complete', 'cancelled', 'error'],
  importing: ['recording_complete', 'cancelled', 'error'],
  recording_complete: ['transcribing', 'error'],
  transcribing: ['transcription_complete', 'cancelled', 'error'],
  transcription_complete: ['generating_notes', 'transcribing', 'error'],
  generating_notes: ['completed', 'transcription_complete', 'cancelled', 'error'],
  // A finished meeting can have its notes regenerated or be transcribed again.
  completed: ['generating_notes', 'transcribing'],
  // From an error or a cancellation the meeting goes back to the last thing
  // that is still true about it — see `recoveryStatus`.
  // An interrupted import can be started again with the same file.
  error: ['importing', 'recording_complete', 'transcription_complete', 'completed', 'transcribing', 'generating_notes'],
  cancelled: ['recording_complete', 'transcription_complete', 'transcribing', 'generating_notes'],
};

export const canTransition = (from: MeetingStatus, to: MeetingStatus): boolean =>
  TRANSITIONS[from]?.includes(to) ?? false;

export class InvalidTransitionError extends Error {
  constructor(from: MeetingStatus, to: MeetingStatus) {
    super(`A meeting cannot go from "${from}" to "${to}".`);
    this.name = 'InvalidTransitionError';
  }
}

export const assertTransition = (from: MeetingStatus, to: MeetingStatus): void => {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
};

export interface MeetingFacts {
  hasAudio: boolean;
  hasTranscript: boolean;
  hasNotes: boolean;
}

/**
 * The state a meeting should settle in after an error, a cancellation or a
 * restart: the furthest point whose output actually exists.
 */
export const recoveryStatus = (facts: MeetingFacts): MeetingStatus => {
  if (facts.hasNotes) return 'completed';
  if (facts.hasTranscript) return 'transcription_complete';
  if (facts.hasAudio) return 'recording_complete';
  return 'error';
};

/** States in which work is happening and the meeting must not be edited or deleted. */
export const isBusy = (status: MeetingStatus): boolean =>
  status === 'recording' ||
  status === 'paused' ||
  status === 'importing' ||
  status === 'transcribing' ||
  status === 'generating_notes';

/**
 * States that cannot outlive the app. A meeting found in one of these at
 * launch was interrupted, and is moved to a state it can resume from.
 */
export const isInterruptible = (status: MeetingStatus): boolean => isBusy(status);

export const STATUS_LABELS: Record<MeetingStatus, string> = {
  idle: 'Ready to record',
  recording: 'Recording',
  paused: 'Paused',
  importing: 'Importing',
  recording_complete: 'Recorded',
  transcribing: 'Transcribing',
  transcription_complete: 'Transcribed',
  generating_notes: 'Generating notes',
  completed: 'Complete',
  error: 'Needs attention',
  cancelled: 'Cancelled',
};

/** The ordered stages the processing view walks through. */
export const PROCESSING_STAGES = [
  { status: 'recording_complete', label: 'Recording saved' },
  { status: 'transcribing', label: 'Transcribing audio' },
  { status: 'generating_notes', label: 'Generating meeting notes' },
  { status: 'completed', label: 'Complete' },
] as const;

/** Which processing stage a status belongs to, for the step indicator. */
export const stageIndex = (status: MeetingStatus): number => {
  switch (status) {
    case 'importing':
    case 'recording_complete':
      return 0;
    case 'transcribing':
    case 'transcription_complete':
      return 1;
    case 'generating_notes':
      return 2;
    case 'completed':
      return 3;
    default:
      return -1;
  }
};
