/**
 * Reads note bodies written by LAFINA desktop.
 *
 * Mobile stores a note body as plain text in a light markdown dialect
 * (`**bold**`, `*italic*`, `==highlight==`, `- [ ] task`). The desktop editor
 * stores sanitized HTML, and notes sync between the two as-is. This module
 * projects a desktop body back to the mobile dialect — the same rules as the
 * desktop's own `htmlToMarkdown` — without a DOM, which React Native lacks.
 * Saving the note on mobile then stores the dialect, which the desktop upgrades
 * back to HTML when it reads it.
 */

import { CHECKLIST_LINE, parseInline } from './noteMarkdown';

interface HtmlElement {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

interface HtmlText {
  type: 'text';
  text: string;
}

type HtmlNode = HtmlElement | HtmlText;

/** True when a stored body uses the desktop HTML format. */
export const isHtmlBody = (body: string): boolean =>
  /<\/?(p|div|ul|ol|li|h[1-3]|img|br|strong|em|mark|b|i|u|s|blockquote|pre)\b/i.test(body);

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'wbr', 'col', 'area', 'source', 'track']);
const BLOCK_TAGS = /^(p|div|ul|ol|h1|h2|h3|blockquote|pre|hr)$/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });

const parseAttributes = (source: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = pattern.exec(source);
  while (match) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    match = pattern.exec(source);
  }
  return attrs;
};

/**
 * Builds a forgiving element tree. Desktop bodies come out of a sanitizer, so
 * they are well formed; a stray end tag closes back to its opener, or is
 * ignored if nothing open matches.
 */
const parseHtml = (html: string): HtmlElement => {
  const root: HtmlElement = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const pattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|[^<]+|</g;
  let match = pattern.exec(html);
  while (match) {
    const [token, closing, rawTag, rest] = match;
    const parent = stack[stack.length - 1];
    if (token.startsWith('<!--')) {
      // Comments carry nothing a note shows.
    } else if (rawTag) {
      const tag = rawTag.toLowerCase();
      if (closing) {
        const openIndex = stack.map((element) => element.tag).lastIndexOf(tag);
        if (openIndex > 0) stack.length = openIndex;
      } else {
        const element: HtmlElement = {
          type: 'element',
          tag,
          attrs: parseAttributes(rest),
          children: [],
        };
        parent.children.push(element);
        if (!VOID_TAGS.has(tag) && !rest.trim().endsWith('/')) stack.push(element);
      }
    } else {
      parent.children.push({ type: 'text', text: decodeEntities(token) });
    }
    match = pattern.exec(html);
  }
  return root;
};

const textContent = (node: HtmlNode): string =>
  node.type === 'text' ? node.text : node.children.map(textContent).join('');

const inlineToMarkdown = (node: HtmlNode): string => {
  if (node.type === 'text') return node.text;
  const inner = node.children.map(inlineToMarkdown).join('');
  switch (node.tag) {
    case 'br':
      return '\n';
    case 'b':
    case 'strong':
      return inner ? `**${inner}**` : '';
    case 'i':
    case 'em':
      return inner ? `*${inner}*` : '';
    case 'mark':
      return inner ? `==${inner}==` : '';
    case 'code':
      return inner ? `\`${inner}\`` : '';
    case 'img':
      return node.attrs.alt ? `[image: ${node.attrs.alt}]` : '[image]';
    default:
      return inner;
  }
};

const isList = (node: HtmlNode): node is HtmlElement =>
  node.type === 'element' && (node.tag === 'ul' || node.tag === 'ol');

/** Projects a desktop HTML body to the mobile markdown dialect. */
export const htmlToMarkdown = (html: string): string => {
  if (!html) return '';
  const lines: string[] = [];

  const walkBlock = (element: HtmlElement, depth = 0): void => {
    switch (element.tag) {
      case 'ul':
      case 'ol': {
        const isChecklist = (element.attrs.class ?? '').split(/\s+/).includes('lf-checklist');
        // Two spaces per level, which is what the desktop reads back.
        const indent = '  '.repeat(depth);
        let index = 0;
        element.children.forEach((child) => {
          if (child.type !== 'element' || child.tag !== 'li') return;
          index += 1;
          const text = child.children
            .filter((node) => !isList(node))
            .map(inlineToMarkdown)
            .join('')
            .trim();
          if (isChecklist || 'data-checked' in child.attrs) {
            const checked = child.attrs['data-checked'] === 'true';
            lines.push(`${indent}- [${checked ? 'x' : ' '}] ${text}`);
          } else if (element.tag === 'ol') {
            lines.push(`${indent}${index}. ${text}`);
          } else {
            lines.push(`${indent}- ${text}`);
          }
          child.children.filter(isList).forEach((nested) => walkBlock(nested, depth + 1));
        });
        return;
      }
      case 'h1':
      case 'h2':
      case 'h3':
        lines.push(`${'#'.repeat(Number(element.tag[1]))} ${inlineToMarkdown(element).trim()}`);
        return;
      case 'blockquote':
        lines.push(`> ${inlineToMarkdown(element).trim()}`);
        return;
      case 'hr':
        lines.push('---');
        return;
      default: {
        const hasBlockChildren = element.children.some(
          (child) => child.type === 'element' && BLOCK_TAGS.test(child.tag)
        );
        if (hasBlockChildren) {
          element.children.forEach((child) => {
            if (child.type === 'element') walkBlock(child, depth);
            else if (child.text.trim()) lines.push(child.text.trim());
          });
          return;
        }
        lines.push(inlineToMarkdown(element));
      }
    }
  };

  parseHtml(html).children.forEach((child) => {
    if (child.type === 'element') walkBlock(child);
    else if (textContent(child)) lines.push(child.text);
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

/** A note body in the mobile dialect, whichever app last saved it. */
export const noteBodyToMarkdown = (body: string): string =>
  body && isHtmlBody(body) ? htmlToMarkdown(body) : body;

/** Every `<li>` that carries a checked state, in document order. */
const CHECKED_ITEM_TAG = /<li\b[^>]*\bdata-checked\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi;
const CHECKED_ATTRIBUTE = /(\bdata-checked\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

export interface ChecklistStat {
  total: number;
  done: number;
}

/** Counts checklist progress, so a card can show "3/7". */
export const checklistStats = (body: string): ChecklistStat => {
  if (!body) return { total: 0, done: 0 };
  if (isHtmlBody(body)) {
    const items = body.match(CHECKED_ITEM_TAG) ?? [];
    return {
      total: items.length,
      done: items.filter((tag) => /data-checked\s*=\s*["']?true/i.test(tag)).length,
    };
  }
  const items = body
    .split('\n')
    .map((line) => CHECKLIST_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  return {
    total: items.length,
    done: items.filter((match) => match[2].toLowerCase() === 'x').length,
  };
};

/**
 * Flips one checklist item and returns the updated body, so a to-do can be
 * ticked from a card without opening the editor.
 *
 * `index` counts checklist items in reading order, the same way the desktop
 * counts them. A desktop body is edited where it stands rather than converted
 * to the mobile dialect first: everything mobile cannot draw — colours,
 * underlines, inline images — has to survive someone ticking a box.
 */
export const toggleChecklistItem = (body: string, index: number): string => {
  if (!body || index < 0) return body;

  if (isHtmlBody(body)) {
    let seen = -1;
    let changed = false;
    const updated = body.replace(CHECKED_ITEM_TAG, (tag) => {
      seen += 1;
      if (seen !== index || changed) return tag;
      changed = true;
      return tag.replace(CHECKED_ATTRIBUTE, (_attribute, prefix, quoted, single, bare) => {
        const current = String(quoted ?? single ?? bare ?? 'false').toLowerCase();
        return `${prefix}"${current === 'true' ? 'false' : 'true'}"`;
      });
    });
    return changed ? updated : body;
  }

  let seen = -1;
  let changed = false;
  const lines = body.split('\n').map((line) => {
    const match = CHECKLIST_LINE.exec(line);
    if (!match) return line;
    seen += 1;
    if (seen !== index) return line;
    changed = true;
    // Rewrite only the box, so the indent, the marker and the text are kept
    // exactly as they were: "  - [ ] Buy paper" differs by one character.
    const boxAt = line.indexOf('[', match[1].length);
    return `${line.slice(0, boxAt)}[${match[2].toLowerCase() === 'x' ? ' ' : 'x'}]${line.slice(
      boxAt + 3
    )}`;
  });
  return changed ? lines.join('\n') : body;
};

/** Every checklist line, plain, for the "Extract Tasks" action. */
export const extractChecklistItems = (body: string): { text: string; done: boolean }[] =>
  noteBodyToMarkdown(body)
    .split('\n')
    .map((line) => CHECKLIST_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      // Emphasis markers are not part of a task's name.
      text: parseInline(match[3])
        .map((span) => span.text)
        .join('')
        .trim(),
      done: match[2].toLowerCase() === 'x',
    }));

/** True when a body holds no words and no image, so an empty save can be skipped. */
export const isBodyEmpty = (body: string): boolean => {
  if (!body.trim()) return true;
  if (!isHtmlBody(body)) return false;
  // Markup on its own is not content: an empty desktop document is a `<p>`.
  if (/<img\b/i.test(body)) return false;
  return htmlToMarkdown(body).trim().length === 0;
};
