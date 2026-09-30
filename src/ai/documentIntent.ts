/**
 * Noticing when a chat message asks for a file.
 *
 * "Make me a PDF of the plan above" should produce a PDF even when nobody
 * picked a format in the composer. The trouble is that files come up in
 * ordinary scheduling too — "remind me to submit the PDF Friday" — and the
 * offline parser treats "create" as a scheduling verb. So this only answers
 * when a creation verb is followed, within a few words, by a file format, and
 * the sentence is not a reminder, a calendar entry or a flashcard request.
 */

import type { DocumentFormat } from '../skills/documentSkill';

const FORMAT_PATTERNS: [DocumentFormat, RegExp][] = [
  ['pdf', /\bpdfs?\b/],
  [
    'docx',
    /\b(?:docx|word\s+(?:docs?|documents?|files?|format)|ms\s+word|microsoft\s+word|(?:in|as|to|into)\s+word)\b/,
  ],
  ['xlsx', /\b(?:xlsx|excel|spreadsheets?|workbooks?)\b/],
  ['pptx', /\b(?:pptx|power\s?points?|slides?|slide\s?decks?|presentations?)\b/],
];

/** Verbs that ask for something to be made, as opposed to read or sent. */
const CREATION_VERB =
  /\b(?:make|create|generate|export|produce|build|draft|write|give|turn|convert|put|save|compile|design)\b/g;

/** "I need a PDF…", "can I get an Excel file…" */
const WANT_ONE = /\b(?:need|want|get)\s+an?\s+/g;

/** Scheduling commands keep going to the scheduler, whatever they mention. */
const SCHEDULING_LEAD =
  /^\s*(?:please\s+|can you\s+|could you\s+)?(?:remind|schedule|block|set\s+(?:an?\s+)?(?:reminder|alarm|timer)|add\s+(?:an?\s+)?(?:task|event|reminder|class))\b/;
const REMIND_ME = /\bremind\s+me\b/;

/** Things a creation verb can make that are not files. */
const NOT_A_FILE =
  /\b(?:task|event|reminder|meeting|appointment|alarm|class|time\s?block|block|schedule|note|flash\s?cards?)\b/;
const FLASHCARDS = /\bflash\s?cards?\b/;

const WINDOW_WORDS = 10;
const WANT_WINDOW_WORDS = 3;

const firstWords = (text: string, count: number): string =>
  text.trim().split(' ').slice(0, count).join(' ');

/** The format mentioned first in `text`, and where. */
const earliestFormat = (text: string): { format: DocumentFormat; index: number } | null => {
  let best: { format: DocumentFormat; index: number } | null = null;
  for (const [format, pattern] of FORMAT_PATTERNS) {
    const match = pattern.exec(text);
    if (match && (best === null || match.index < best.index)) {
      best = { format, index: match.index };
    }
  }
  return best;
};

/** The format a message asks LAFINA to create, or null when it asks for no file. */
export const detectDocumentRequest = (text: string): DocumentFormat | null => {
  const lower = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!lower) return null;
  if (SCHEDULING_LEAD.test(lower) || REMIND_ME.test(lower) || FLASHCARDS.test(lower)) {
    return null;
  }

  const lookAfter = (pattern: RegExp, windowWords: number): DocumentFormat | null => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(lower)) !== null) {
      const window = firstWords(lower.slice(match.index + match[0].length), windowWords);
      const found = earliestFormat(window);
      if (!found) continue;
      // "create a task to finish the Excel report" makes a task, not a workbook.
      if (NOT_A_FILE.test(window.slice(0, found.index))) continue;
      return found.format;
    }
    return null;
  };

  return lookAfter(CREATION_VERB, WINDOW_WORDS) ?? lookAfter(WANT_ONE, WANT_WINDOW_WORDS);
};
