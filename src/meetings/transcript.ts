/**
 * What Whisper heard, tidied, and cut into pieces DeepSeek can read.
 *
 * Whisper leaves recognisable debris in a transcript: markers for silence and
 * music, and — on long quiet stretches — the same short phrase repeated over
 * and over ("Thank you. Thank you. Thank you."). Those are removed. Everything
 * else is kept verbatim, because the notes are only as faithful as the text
 * they are made from.
 *
 * Nothing is ever dropped to make a transcript fit. A meeting too long for one
 * request is split into sections at segment boundaries, and the notes are
 * built up from every section.
 */

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/** Transcript text up to this long goes to DeepSeek in one request. */
export const DIRECT_LIMIT_CHARS = 60_000;
/** Each section of a longer meeting is at most this long (the server allows 24,000). */
export const SECTION_LIMIT_CHARS = 20_000;
/** Section notes are consolidated in one request when their combined size is below this. */
export const CONSOLIDATE_LIMIT_CHARS = 80_000;

const ARTIFACT_ONLY = [
  /^\[?\(?\s*(blank[_ ]audio|silence|music|applause|laughter|noise|inaudible|no speech|background noise|sound|beep|static)\s*\)?\]?\.?$/i,
  /^\[\s*[^\]]{0,40}\]$/,
  /^\(\s*[^)]{0,40}\)$/,
  /^[♪♫\s.·…-]+$/,
];

const INLINE_ARTIFACTS = /\[(?:BLANK_AUDIO|MUSIC|SILENCE|NOISE|INAUDIBLE)\]|\((?:music|silence|inaudible)\)/gi;

const normaliseForRepeat = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();

/** Removes Whisper's debris; never rewrites what was said. */
export const cleanSegments = (segments: readonly TranscriptSegment[]): TranscriptSegment[] => {
  const cleaned: TranscriptSegment[] = [];
  let lastKey = '';
  let repeats = 0;

  for (const segment of segments) {
    const text = segment.text.replace(INLINE_ARTIFACTS, ' ').replace(/\s+/g, ' ').trim();
    if (!text || ARTIFACT_ONLY.some((pattern) => pattern.test(text))) continue;

    // A short phrase coming back again and again is Whisper looping on
    // silence, not someone saying it five times.
    const key = normaliseForRepeat(text);
    if (key && key === lastKey && key.length <= 40) {
      repeats += 1;
      if (repeats >= 2) continue;
    } else {
      repeats = 0;
    }
    lastKey = key;

    cleaned.push({ startMs: Math.max(0, segment.startMs), endMs: Math.max(segment.startMs, segment.endMs), text });
  }
  return cleaned;
};

/** `1:02:07` for a long meeting, `02:07` for a short one. */
export const formatTimestamp = (ms: number, forceHours = false): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 || forceHours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** The transcript as plain text, optionally with a timestamp on each line. */
export const transcriptToText = (
  segments: readonly TranscriptSegment[],
  options: { timestamps?: boolean } = {},
): string => {
  const hours = segments.some((segment) => segment.startMs >= 3_600_000);
  return segments
    .map((segment) =>
      options.timestamps ? `[${formatTimestamp(segment.startMs, hours)}] ${segment.text}` : segment.text,
    )
    .join('\n');
};

/**
 * Splits one segment too long to fit a section, at sentence ends where it can.
 * Whisper segments are normally a sentence or two, so this is rare.
 */
const splitOversized = (line: string, limit: number): string[] => {
  if (line.length <= limit) return [line];
  const parts: string[] = [];
  let current = '';
  for (const sentence of line.split(/(?<=[.!?])\s+/)) {
    if (current && current.length + sentence.length + 1 > limit) {
      parts.push(current);
      current = '';
    }
    if (sentence.length > limit) {
      for (let offset = 0; offset < sentence.length; offset += limit) parts.push(sentence.slice(offset, offset + limit));
      continue;
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) parts.push(current);
  return parts;
};

/**
 * Groups lines into sections no longer than `limit`, keeping each line whole
 * and in order. The sections, joined, are exactly the input.
 */
export const packSections = (lines: readonly string[], limit: number): string[] => {
  const sections: string[] = [];
  let current = '';
  for (const line of lines.flatMap((entry) => splitOversized(entry, limit))) {
    if (current && current.length + line.length + 1 > limit) {
      sections.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) sections.push(current);
  return sections;
};

export type NotesPlan =
  | { mode: 'direct'; content: string; characters: number }
  | { mode: 'sections'; sections: string[]; characters: number };

/**
 * Decides how a transcript reaches DeepSeek.
 *
 * Timestamps are included — they cost little and let the notes say when
 * something was decided. An ordinary meeting goes in one request; a long one
 * is split into sections that together cover every line.
 */
export const planNotesInput = (
  segments: readonly TranscriptSegment[],
  limits = { direct: DIRECT_LIMIT_CHARS, section: SECTION_LIMIT_CHARS },
): NotesPlan => {
  const text = transcriptToText(segments, { timestamps: true });
  if (text.length <= limits.direct) {
    return { mode: 'direct', content: text, characters: text.length };
  }
  return {
    mode: 'sections',
    sections: packSections(text.split('\n'), limits.section),
    characters: text.length,
  };
};

/** Words in a transcript, for the history list. */
export const wordCount = (segments: readonly TranscriptSegment[]): number =>
  segments.reduce((sum, segment) => sum + (segment.text.match(/\S+/g)?.length ?? 0), 0);
