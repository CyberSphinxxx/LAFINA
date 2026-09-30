/**
 * Reads the note dialect into blocks the UI can draw.
 *
 * Desktop stores a note as HTML and mobile as a light markdown dialect;
 * `noteBodyToMarkdown` in ./richText projects one onto the other, so this
 * module only ever sees the dialect. It covers everything the desktop's own
 * `htmlToMarkdown` can emit — headings, quotes, dividers, bullet and numbered
 * lists, nested checklists, highlights and code — because a note written over
 * there should read the same here instead of showing its markup.
 */

/** A run of text, with whatever emphasis was wrapped around it. */
export interface NoteInline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  highlight?: boolean;
  code?: boolean;
}

export type NoteBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: NoteInline[] }
  | {
      kind: 'checklist';
      depth: number;
      checked: boolean;
      spans: NoteInline[];
      /** Position among every checklist item in the note, in reading order. */
      index: number;
    }
  | { kind: 'bullet'; depth: number; spans: NoteInline[] }
  | { kind: 'ordered'; depth: number; marker: string; spans: NoteInline[] }
  | { kind: 'quote'; spans: NoteInline[] }
  | { kind: 'image'; alt: string }
  | { kind: 'divider' }
  | { kind: 'paragraph'; spans: NoteInline[] };

/** Matches the desktop's reading of the dialect, so both apps agree on a line. */
export const CHECKLIST_LINE = /^([\t ]*)[-*][ \t]\[([ xX])\][ \t]?(.*)$/;
const BULLET_LINE = /^([\t ]*)[-*][ \t]+(.*)$/;
const ORDERED_LINE = /^([\t ]*)(\d{1,3})[.)][ \t]+(.*)$/;
const HEADING_LINE = /^(#{1,3})[ \t]+(.*)$/;
const QUOTE_LINE = /^[ \t]*>[ \t]?(.*)$/;
const DIVIDER_LINE = /^[ \t]*(?:-{3,}|_{3,}|\*{3,})[ \t]*$/;
const IMAGE_LINE = /^\[image(?::[ \t]*(.*?))?\]$/;

/** Two spaces, or one tab, is one level of nesting — as on the desktop. */
export const indentDepth = (indent: string): number => {
  let columns = 0;
  for (const character of indent) columns += character === '\t' ? 2 : 1;
  return Math.floor(columns / 2);
};

/**
 * Emphasis markers, most specific first. `**` has to be tried before `*` or
 * bold would read as an italic wrapping an empty string.
 */
const INLINE_RULES: { pattern: RegExp; mark: keyof Omit<NoteInline, 'text'> }[] = [
  { pattern: /={2}([^=]+)={2}/, mark: 'highlight' },
  { pattern: /\*\*([^*]+)\*\*/, mark: 'bold' },
  { pattern: /\*([^*]+)\*/, mark: 'italic' },
  { pattern: /`([^`]+)`/, mark: 'code' },
];

const pushText = (spans: NoteInline[], text: string, marks: Partial<NoteInline>): void => {
  if (text) spans.push({ ...marks, text });
};

/**
 * Splits a line into styled runs. Emphasis nests, so `**a ==b==**` reads as
 * bold throughout with the middle also highlighted; code is taken literally
 * and nothing inside it is treated as a marker.
 */
export const parseInline = (line: string, marks: Partial<NoteInline> = {}): NoteInline[] => {
  const spans: NoteInline[] = [];
  let rest = line;

  while (rest) {
    let earliest: { index: number; match: RegExpExecArray; mark: keyof NoteInline } | null = null;
    for (const rule of INLINE_RULES) {
      const match = rule.pattern.exec(rest);
      if (match && (!earliest || match.index < earliest.index)) {
        earliest = { index: match.index, match, mark: rule.mark };
      }
    }
    if (!earliest) break;

    pushText(spans, rest.slice(0, earliest.index), marks);
    const inner = earliest.match[1];
    const nested = { ...marks, [earliest.mark]: true };
    // Code is verbatim: markers inside it are part of the snippet.
    if (earliest.mark === 'code') pushText(spans, inner, nested);
    else spans.push(...parseInline(inner, nested));
    rest = rest.slice(earliest.index + earliest.match[0].length);
  }

  pushText(spans, rest, marks);
  return spans;
};

/** Reads a whole body — in either format — into blocks. */
export const parseNoteBlocks = (markdown: string): NoteBlock[] => {
  if (!markdown) return [];
  let checklistIndex = 0;

  return markdown.split('\n').map<NoteBlock>((line) => {
    const checklist = CHECKLIST_LINE.exec(line);
    if (checklist) {
      return {
        kind: 'checklist',
        depth: indentDepth(checklist[1]),
        checked: checklist[2].toLowerCase() === 'x',
        spans: parseInline(checklist[3]),
        index: checklistIndex++,
      };
    }
    if (DIVIDER_LINE.test(line)) return { kind: 'divider' };

    const image = IMAGE_LINE.exec(line.trim());
    if (image) return { kind: 'image', alt: image[1] ?? '' };

    const heading = HEADING_LINE.exec(line);
    if (heading) {
      return {
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        spans: parseInline(heading[2]),
      };
    }
    const quote = QUOTE_LINE.exec(line);
    if (quote) return { kind: 'quote', spans: parseInline(quote[1]) };

    const ordered = ORDERED_LINE.exec(line);
    if (ordered) {
      return {
        kind: 'ordered',
        depth: indentDepth(ordered[1]),
        marker: ordered[2],
        spans: parseInline(ordered[3]),
      };
    }
    const bullet = BULLET_LINE.exec(line);
    if (bullet) {
      return { kind: 'bullet', depth: indentDepth(bullet[1]), spans: parseInline(bullet[2]) };
    }
    return { kind: 'paragraph', spans: parseInline(line) };
  });
};

/** The plain words of a body, for search and for card previews. */
export const noteBlocksToPlainText = (blocks: NoteBlock[]): string =>
  blocks
    .map((block) => {
      if (block.kind === 'divider') return '';
      if (block.kind === 'image') return block.alt;
      return block.spans.map((span) => span.text).join('');
    })
    .join('\n')
    .trim();
