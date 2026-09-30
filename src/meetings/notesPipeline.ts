/**
 * Getting from a transcript to final notes, however long the meeting was.
 *
 *     transcript ──► sections ──► section notes ──► (grouped again if still
 *                                                   too long) ──► final notes
 *
 * An ordinary meeting skips straight to the last arrow. A long one is split
 * into sections, each becomes partial notes, and the partial notes are
 * consolidated — in groups first if there are too many to read at once. At no
 * point is anything cut off to make it fit: a piece that turns out too long is
 * split in two and both halves are sent.
 *
 * Each finished section is handed back as it completes, so a retry after a
 * failure or a cancellation does not pay for the same section twice.
 */

import type { CloudResult } from '../cloud/cloudClient';
import type { MeetingNotesSkill, NotesResponse } from '../skills/meetingNotesSkill';
import {
  CONSOLIDATE_LIMIT_CHARS,
  DIRECT_LIMIT_CHARS,
  SECTION_LIMIT_CHARS,
  packSections,
  planNotesInput,
  type TranscriptSegment,
} from './transcript';
import { MeetingError, classifyNotesFailure, isRetryable, type MeetingErrorCode } from './meetingErrors';
import { normalizeNotes, isNotesEmpty, type MeetingNotes } from './meetingNotes';

export interface NotesProgress {
  percent: number;
  phase: 'sending' | 'sections' | 'combining' | 'finalizing';
  done: number;
  total: number;
  message: string;
}

export interface PipelineOptions {
  segments: readonly TranscriptSegment[];
  skill: MeetingNotesSkill;
  titleHint?: string;
  recordedAt?: string;
  onProgress?: (progress: NotesProgress) => void;
  signal?: AbortSignal;
  /** Section notes from an earlier attempt, keyed by `sectionKey`. */
  cachedSections?: Record<string, MeetingNotes>;
  onSectionDone?: (key: string, notes: MeetingNotes) => void;
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  limits?: { direct: number; section: number; consolidate: number };
  concurrency?: number;
}

export interface PipelineResult {
  notes: MeetingNotes;
  mode: 'direct' | 'sections';
  sectionCount: number;
  levels: number;
}

/** A short, stable key for a piece of material, so cached work is matched exactly. */
export const sectionKey = (material: string, content: string): string => {
  let hash = 2166136261;
  const input = `${material}:${content}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${material}-${(hash >>> 0).toString(36)}-${content.length}`;
};

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new MeetingError('cancelled'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new MeetingError('cancelled'));
      },
      { once: true },
    );
  });

/** How long to wait before asking again, by what went wrong and how often. */
export const retryDelayMs = (code: MeetingErrorCode, attempt: number): number => {
  if (code === 'rate_limited') return [20_000, 45_000, 90_000][attempt] ?? 90_000;
  return [3_000, 9_000, 20_000][attempt] ?? 20_000;
};

const MAX_ATTEMPTS = 3;

export const generateMeetingNotes = async (options: PipelineOptions): Promise<PipelineResult> => {
  const limits = options.limits ?? {
    direct: DIRECT_LIMIT_CHARS,
    section: SECTION_LIMIT_CHARS,
    consolidate: CONSOLIDATE_LIMIT_CHARS,
  };
  const sleep = options.sleep ?? defaultSleep;
  const report = (progress: NotesProgress): void => options.onProgress?.(progress);
  const cache = { ...(options.cachedSections ?? {}) };

  const checkCancelled = (): void => {
    if (options.signal?.aborted) throw new MeetingError('cancelled');
  };

  /** One request, retried with back-off when waiting could help. */
  const call = async (request: () => Promise<CloudResult<NotesResponse>>): Promise<MeetingNotes> => {
    for (let attempt = 0; ; attempt += 1) {
      checkCancelled();
      const result = await request();
      checkCancelled();
      if (result.status === 'success' && result.data) return normalizeNotes(result.data.notes);
      const code = classifyNotesFailure(result);
      if (!isRetryable(code) || attempt >= MAX_ATTEMPTS - 1) throw new MeetingError(code, result.error ?? '');
      await sleep(retryDelayMs(code, attempt), options.signal);
    }
  };

  const cleaned = options.segments.filter((segment) => segment.text.trim());
  if (cleaned.length === 0) throw new MeetingError('empty_transcript');

  const plan = planNotesInput(cleaned, { direct: limits.direct, section: limits.section });

  const finalFrom = async (content: string, source: 'transcript' | 'sections'): Promise<MeetingNotes> => {
    const notes = await call(() =>
      options.skill.generate({ content, source, titleHint: options.titleHint, recordedAt: options.recordedAt }),
    );
    if (isNotesEmpty(notes)) throw new MeetingError('nothing_to_note');
    return notes;
  };

  if (plan.mode === 'direct') {
    report({ percent: 10, phase: 'sending', done: 0, total: 1, message: 'Sending the transcript to DeepSeek…' });
    try {
      const notes = await finalFrom(plan.content, 'transcript');
      report({ percent: 100, phase: 'finalizing', done: 1, total: 1, message: 'Notes ready' });
      return { notes, mode: 'direct', sectionCount: 0, levels: 1 };
    } catch (error) {
      // Longer in tokens than it looked in characters: fall through to sections.
      if (!(error instanceof MeetingError) || error.code !== 'context_too_long') throw error;
    }
  }

  // ── Sections ────────────────────────────────────────────────────────────
  const firstSections =
    plan.mode === 'sections' ? plan.sections : packSections(plan.content.split('\n'), Math.floor(limits.section / 2));

  /**
   * Summarises pieces into notes, in order, a couple at a time.
   *
   * A piece the model says is too long is split in two and each half is
   * summarised in its place — so one position can yield several notes, and
   * the order of the meeting is kept without reshuffling the queue while
   * other requests are still in flight.
   */
  const summarise = async (
    pieces: string[],
    material: 'transcript' | 'notes',
    progressFrom: number,
    progressTo: number,
    phase: NotesProgress['phase'],
  ): Promise<MeetingNotes[]> => {
    const results: MeetingNotes[][] = new Array(pieces.length);
    let done = 0;
    let next = 0;
    let failed = false;

    const emit = (): void => {
      const fraction = pieces.length ? done / pieces.length : 1;
      report({
        percent: Math.round(progressFrom + (progressTo - progressFrom) * fraction),
        phase,
        done,
        total: pieces.length,
        message:
          phase === 'sections'
            ? `Summarising part ${Math.min(done + 1, pieces.length)} of ${pieces.length}…`
            : `Combining notes (${done} of ${pieces.length})…`,
      });
    };

    const summarisePiece = async (content: string, position: number): Promise<MeetingNotes[]> => {
      const key = sectionKey(material, content);
      if (cache[key]) return [cache[key]];
      try {
        const notes = await call(() =>
          options.skill.section({ content, index: position, count: pieces.length, material }),
        );
        cache[key] = notes;
        options.onSectionDone?.(key, notes);
        return [notes];
      } catch (error) {
        if (!(error instanceof MeetingError) || error.code !== 'context_too_long') throw error;
        const halves = packSections(content.split('\n'), Math.max(500, Math.floor(content.length / 2)));
        if (halves.length < 2) throw error;
        const out: MeetingNotes[] = [];
        for (const half of halves) out.push(...(await summarisePiece(half, position)));
        return out;
      }
    };

    const worker = async (): Promise<void> => {
      while (!failed && next < pieces.length) {
        const position = next;
        next += 1;
        try {
          results[position] = await summarisePiece(pieces[position], position);
        } catch (error) {
          failed = true;
          throw error;
        }
        done += 1;
        emit();
      }
    };

    emit();
    await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 2) }, () => worker()));
    return results.flat();
  };

  let notesList = await summarise(firstSections, 'transcript', 5, 80, 'sections');
  let levels = 1;

  // ── Consolidation, in as many rounds as it takes ────────────────────────
  const serialise = (list: MeetingNotes[]): string[] =>
    list.map((notes, index) => JSON.stringify({ part: index + 1, ...notes }));

  let pieces = serialise(notesList);
  while (pieces.join('\n').length > limits.consolidate) {
    checkCancelled();
    levels += 1;
    if (levels > 6) throw new MeetingError('context_too_long');
    const groups = packSections(pieces, limits.section);
    // Guaranteed to shrink: if every piece is alone in its group, halve the limit's reach.
    if (groups.length >= pieces.length) throw new MeetingError('context_too_long');
    notesList = await summarise(groups, 'notes', 80, 90, 'combining');
    pieces = serialise(notesList);
  }

  report({ percent: 92, phase: 'finalizing', done: 0, total: 1, message: 'Writing the final notes…' });
  const notes = await finalFrom(`[${pieces.join(',\n')}]`, 'sections');
  report({ percent: 100, phase: 'finalizing', done: 1, total: 1, message: 'Notes ready' });
  return { notes, mode: 'sections', sectionCount: firstSections.length, levels };
};
