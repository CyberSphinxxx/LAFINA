/**
 * Rendering a flashcard deck as the file Anki imports.
 *
 * Anki reads plain text where a tab starts the next field and a newline the
 * next note, so a card carrying either would silently split into the wrong
 * shape. Both are neutralised here rather than at the edges of the app, and
 * the same rules are applied on the server so a deck exported from either side
 * comes out identical.
 */

export interface Flashcard {
  question: string;
  answer: string;
}

/**
 * The directives Anki reads before the first note.
 *
 * `#html:true` is what makes the `<br>` a line break in the finished card
 * rather than four literal characters.
 */
export const ANKI_HEADER_LINES = ['#separator:tab', '#html:true', '#columns:Front\tBack'];

/** Makes one field safe to sit between tabs on a single line. */
export const escapeAnkiField = (value: string): string =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\n/g, '<br>')
    .replace(/ {2,}/g, ' ')
    .trim();

/** Renders a deck as Front/Back TSV, skipping cards that lost a side. */
export const toAnkiTsv = (cards: readonly Flashcard[], includeHeader = true): string => {
  const lines: string[] = includeHeader ? [...ANKI_HEADER_LINES] : [];
  cards.forEach((card) => {
    const front = escapeAnkiField(card.question);
    const back = escapeAnkiField(card.answer);
    if (!front || !back) return;
    lines.push(`${front}\t${back}`);
  });
  return `${lines.join('\n')}\n`;
};

/** A filename Windows, macOS and Linux all accept, derived from the deck title. */
export const ankiFileName = (deckTitle: string): string => {
  const safe = (deckTitle || 'flashcards')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${safe || 'flashcards'}.txt`;
};
