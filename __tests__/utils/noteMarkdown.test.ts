import { parseInline, parseNoteBlocks } from '../../src/utils/noteMarkdown';
import {
  checklistStats,
  extractChecklistItems,
  isBodyEmpty,
  toggleChecklistItem,
} from '../../src/utils/richText';

describe('note dialect blocks', () => {
  it('reads every block the desktop can write', () => {
    const blocks = parseNoteBlocks(
      ['# Title', '## Sub', '> Quoted', '---', '- Bullet', '1. First', 'Plain line'].join('\n')
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'heading',
      'quote',
      'divider',
      'bullet',
      'ordered',
      'paragraph',
    ]);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'heading', level: 2 });
    expect(blocks[5]).toMatchObject({ kind: 'ordered', marker: '1' });
  });

  it('numbers checklist items in reading order and keeps their nesting', () => {
    const blocks = parseNoteBlocks(['- [ ] Buy paper', '  - [x] A4', '- [ ] Post it'].join('\n'));
    expect(blocks).toMatchObject([
      { kind: 'checklist', index: 0, depth: 0, checked: false },
      { kind: 'checklist', index: 1, depth: 1, checked: true },
      { kind: 'checklist', index: 2, depth: 0, checked: false },
    ]);
  });

  it('nests emphasis and leaves code verbatim', () => {
    expect(parseInline('**bold ==both==** plain')).toEqual([
      { bold: true, text: 'bold ' },
      { bold: true, highlight: true, text: 'both' },
      { text: ' plain' },
    ]);
    expect(parseInline('run `a **b** c` now')).toEqual([
      { text: 'run ' },
      { code: true, text: 'a **b** c' },
      { text: ' now' },
    ]);
  });
});

describe('checklist helpers', () => {
  const markdown = ['- [ ] Buy paper', '  - [x] A4', '- [ ] Post it'].join('\n');
  const html =
    '<ul class="lf-checklist"><li data-checked="false">Buy paper' +
    '<ul class="lf-checklist"><li data-checked="true">A4</li></ul></li>' +
    '<li data-checked="false">Post it</li></ul>';

  it('counts progress in either format', () => {
    expect(checklistStats(markdown)).toEqual({ total: 3, done: 1 });
    expect(checklistStats(html)).toEqual({ total: 3, done: 1 });
    expect(checklistStats('Just a note')).toEqual({ total: 0, done: 0 });
  });

  it('flips the item at an index and leaves the rest of the line alone', () => {
    expect(toggleChecklistItem(markdown, 0)).toBe(
      ['- [x] Buy paper', '  - [x] A4', '- [ ] Post it'].join('\n')
    );
    expect(toggleChecklistItem(markdown, 1)).toBe(
      ['- [ ] Buy paper', '  - [ ] A4', '- [ ] Post it'].join('\n')
    );
    expect(toggleChecklistItem(markdown, 9)).toBe(markdown);
  });

  it('edits a desktop body in place rather than downgrading it', () => {
    const toggled = toggleChecklistItem(html, 2);
    expect(toggled).toBe(html.replace(/<li data-checked="false">Post it/, '<li data-checked="true">Post it'));
    // Formatting mobile cannot draw is still there afterwards.
    const styled = '<p><u>Keep me</u></p>' + html;
    expect(toggleChecklistItem(styled, 0)).toContain('<u>Keep me</u>');
  });

  it('lists items for Extract Tasks, without their emphasis markers', () => {
    expect(extractChecklistItems('- [ ] Email **Dr Cruz**\n- [x] Print it\nA plain line')).toEqual([
      { text: 'Email Dr Cruz', done: false },
      { text: 'Print it', done: true },
    ]);
    expect(extractChecklistItems(html)).toEqual([
      { text: 'Buy paper', done: false },
      { text: 'A4', done: true },
      { text: 'Post it', done: false },
    ]);
  });

  it('knows an empty body from one that only looks empty', () => {
    expect(isBodyEmpty('')).toBe(true);
    expect(isBodyEmpty('<p><br></p>')).toBe(true);
    expect(isBodyEmpty('<p>Words</p>')).toBe(false);
    expect(isBodyEmpty('<p></p><img src="x.png">')).toBe(false);
    expect(isBodyEmpty('- [ ] Task')).toBe(false);
  });
});
