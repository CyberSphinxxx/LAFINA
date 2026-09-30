/**
 * The formatting actions behind the note editor's toolbar.
 *
 * Mobile edits the note as text in the shared dialect, so a toolbar button is
 * really a small text edit plus a new caret position. Kept here, away from
 * the component, because getting the caret right is the fiddly part and it is
 * worth testing on its own.
 */

export interface NoteSelection {
  start: number;
  end: number;
}

export interface NoteEdit {
  body: string;
  selection: NoteSelection;
}

/** Wraps the selection in a marker. */
export type InlineFormat = 'bold' | 'italic' | 'highlight' | 'code';
/** Replaces whatever block marker the touched lines start with. */
export type BlockFormat = 'h1' | 'h2' | 'h3' | 'bullet' | 'checklist' | 'quote';
export type NoteFormat = InlineFormat | BlockFormat | 'indent' | 'outdent';

const MARKERS: Record<InlineFormat, string> = {
  bold: '**',
  italic: '*',
  highlight: '==',
  code: '`',
};

const PREFIXES: Record<BlockFormat, string> = {
  h1: '# ',
  h2: '## ',
  h3: '### ',
  bullet: '- ',
  checklist: '- [ ] ',
  quote: '> ',
};

/** Any block marker a line in the dialect can start with, after its indent. */
const ANY_PREFIX = /^(#{1,3} |> |[-*] \[[ xX]\] |[-*] |\d{1,3}[.)] )/;
/** A line that nesting means something for. */
const NESTABLE = /^[\t ]*([-*] \[[ xX]\] |[-*] |\d{1,3}[.)] )/;
const INDENT_UNIT = '  ';

const lineBounds = (body: string, selection: NoteSelection): NoteSelection => ({
  start: body.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1,
  end: body.indexOf('\n', selection.end) === -1 ? body.length : body.indexOf('\n', selection.end),
});

const splitIndent = (line: string): [string, string] => {
  const indent = /^[\t ]*/.exec(line)?.[0] ?? '';
  return [indent, line.slice(indent.length)];
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const applyInline = (
  body: string,
  selection: NoteSelection,
  format: InlineFormat
): NoteEdit => {
  const marker = MARKERS[format];
  const { start, end } = selection;
  const before = body.slice(0, start);
  const selected = body.slice(start, end);
  const after = body.slice(end);

  // Already wrapped: take the markers off rather than doubling them up.
  if (
    selected.length > marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(marker.length, -marker.length);
    return { body: `${before}${inner}${after}`, selection: { start, end: start + inner.length } };
  }
  if (before.endsWith(marker) && after.startsWith(marker)) {
    const trimmedBefore = before.slice(0, -marker.length);
    return {
      body: `${trimmedBefore}${selected}${after.slice(marker.length)}`,
      selection: { start: start - marker.length, end: end - marker.length },
    };
  }

  const body2 = `${before}${marker}${selected}${marker}${after}`;
  // With nothing selected the caret goes between the markers, ready to type.
  return start === end
    ? { body: body2, selection: { start: start + marker.length, end: start + marker.length } }
    : {
        body: body2,
        selection: { start: start + marker.length, end: end + marker.length },
      };
};

const applyBlock = (body: string, selection: NoteSelection, format: BlockFormat): NoteEdit => {
  const prefix = PREFIXES[format];
  const bounds = lineBounds(body, selection);
  const lines = body.slice(bounds.start, bounds.end).split('\n');
  // A checklist toggles off whatever its box currently says.
  const marker =
    format === 'checklist' ? /^[-*] \[[ xX]\] / : new RegExp(`^${escapeRegExp(prefix)}`);
  const allMarked = lines.every((line) => marker.test(splitIndent(line)[1]));

  const updated = lines.map((line) => {
    const [indent, rest] = splitIndent(line);
    if (allMarked) return indent + rest.replace(marker, '');
    return indent + prefix + rest.replace(ANY_PREFIX, '');
  });

  const replaced = updated.join('\n');
  const shift = replaced.length - (bounds.end - bounds.start);
  return {
    body: body.slice(0, bounds.start) + replaced + body.slice(bounds.end),
    selection: {
      start: Math.max(bounds.start, selection.start + (allMarked ? -prefix.length : prefix.length)),
      end: Math.max(bounds.start, selection.end + shift),
    },
  };
};

const applyIndent = (body: string, selection: NoteSelection, outwards: boolean): NoteEdit => {
  const bounds = lineBounds(body, selection);
  const lines = body.slice(bounds.start, bounds.end).split('\n');
  let firstLineShift = 0;

  const updated = lines.map((line, index) => {
    // Only list items nest; indenting a paragraph means nothing in either app.
    if (!NESTABLE.test(line)) return line;
    if (outwards) {
      const removed = line.startsWith(INDENT_UNIT)
        ? INDENT_UNIT.length
        : line.startsWith('\t')
          ? 1
          : 0;
      if (index === 0) firstLineShift = -removed;
      return line.slice(removed);
    }
    if (index === 0) firstLineShift = INDENT_UNIT.length;
    return INDENT_UNIT + line;
  });

  const replaced = updated.join('\n');
  const shift = replaced.length - (bounds.end - bounds.start);
  return {
    body: body.slice(0, bounds.start) + replaced + body.slice(bounds.end),
    selection: {
      start: Math.max(bounds.start, selection.start + firstLineShift),
      end: Math.max(bounds.start, selection.end + shift),
    },
  };
};

/** Runs a toolbar button over the body, and says where the caret lands. */
export const applyNoteFormat = (
  body: string,
  selection: NoteSelection,
  format: NoteFormat
): NoteEdit => {
  if (format === 'indent' || format === 'outdent') {
    return applyIndent(body, selection, format === 'outdent');
  }
  if (format in MARKERS) return applyInline(body, selection, format as InlineFormat);
  return applyBlock(body, selection, format as BlockFormat);
};

/**
 * Carries a list on when Enter is pressed at the end of one of its items, so
 * a checklist can be typed straight down without reaching for the toolbar.
 * Returns null when the text change was anything else.
 *
 * An empty item ends the list instead, which is what pressing Enter twice
 * does on the desktop.
 */
export const continueListOnNewline = (previous: string, next: string): NoteEdit | null => {
  // Exactly one newline typed at a caret, with nothing else changed.
  if (next.length !== previous.length + 1) return null;
  const at = findInsertedNewline(previous, next);
  if (at === null) return null;

  const lineStart = next.lastIndexOf('\n', at - 1) + 1;
  const line = next.slice(lineStart, at);
  const match = /^([\t ]*)([-*] \[[ xX]\] |[-*] |(\d{1,3})([.)]) )(.*)$/.exec(line);
  if (!match) return null;

  const [, indent, marker, number, punctuation, text] = match;
  if (!text.trim()) {
    // Enter on an empty item leaves the list: the marker goes, and that line
    // becomes the blank one the newline was asking for.
    const body = next.slice(0, lineStart) + next.slice(at + 1);
    return { body, selection: { start: lineStart, end: lineStart } };
  }

  const nextMarker = number
    ? `${Number(number) + 1}${punctuation} `
    : marker.replace(/\[[xX]\]/, '[ ]');
  const insertion = indent + nextMarker;
  const body = next.slice(0, at + 1) + insertion + next.slice(at + 1);
  const caretAt = at + 1 + insertion.length;
  return { body, selection: { start: caretAt, end: caretAt } };
};

/** Index of the single newline `next` gained over `previous`, if that is the change. */
const findInsertedNewline = (previous: string, next: string): number | null => {
  let index = 0;
  while (index < previous.length && previous[index] === next[index]) index += 1;
  if (next[index] !== '\n') return null;
  if (previous.slice(index) !== next.slice(index + 1)) return null;
  return index;
};
