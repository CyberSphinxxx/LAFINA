import { applyNoteFormat, continueListOnNewline } from '../../src/utils/noteEditing';

const at = (position: number) => ({ start: position, end: position });

describe('inline formatting', () => {
  it('wraps a selection and keeps it selected', () => {
    const result = applyNoteFormat('hello world', { start: 6, end: 11 }, 'bold');
    expect(result.body).toBe('hello **world**');
    expect(result.body.slice(result.selection.start, result.selection.end)).toBe('world');
  });

  it('parks the caret between the markers when nothing is selected', () => {
    const result = applyNoteFormat('note: ', at(6), 'highlight');
    expect(result.body).toBe('note: ====');
    expect(result.selection).toEqual(at(8));
  });

  it('takes the markers off again', () => {
    const wrapped = applyNoteFormat('a `code` b', { start: 2, end: 8 }, 'code');
    expect(wrapped.body).toBe('a code b');
    // Also when only the inner text is selected.
    const inner = applyNoteFormat('a **bold** b', { start: 4, end: 8 }, 'bold');
    expect(inner.body).toBe('a bold b');
  });
});

describe('block formatting', () => {
  it('replaces whatever marker a line already had', () => {
    expect(applyNoteFormat('- Item', at(3), 'checklist').body).toBe('- [ ] Item');
    expect(applyNoteFormat('- [ ] Item', at(8), 'h2').body).toBe('## Item');
    expect(applyNoteFormat('### Deep', at(6), 'quote').body).toBe('> Deep');
  });

  it('toggles a marker off when every touched line has it', () => {
    const body = ['- [ ] One', '- [x] Two'].join('\n');
    expect(applyNoteFormat(body, { start: 0, end: body.length }, 'checklist').body).toBe(
      ['One', 'Two'].join('\n')
    );
  });

  it('marks every line the selection reaches, keeping their indents', () => {
    const body = ['  One', '  Two'].join('\n');
    expect(applyNoteFormat(body, { start: 3, end: 8 }, 'bullet').body).toBe(
      ['  - One', '  - Two'].join('\n')
    );
  });
});

describe('nesting', () => {
  it('indents and outdents list items only', () => {
    expect(applyNoteFormat('- [ ] Task', at(8), 'indent').body).toBe('  - [ ] Task');
    expect(applyNoteFormat('  - [ ] Task', at(8), 'outdent').body).toBe('- [ ] Task');
    // A paragraph has no nesting to change.
    expect(applyNoteFormat('Just words', at(4), 'indent').body).toBe('Just words');
  });

  it('stops at the outermost level', () => {
    expect(applyNoteFormat('- Item', at(3), 'outdent').body).toBe('- Item');
  });
});

describe('carrying a list on', () => {
  it('starts the next item when Enter ends a filled one', () => {
    const previous = '- [ ] Buy paper';
    const result = continueListOnNewline(previous, `${previous}\n`);
    expect(result?.body).toBe('- [ ] Buy paper\n- [ ] ');
    expect(result?.selection).toEqual(at(22));
  });

  it('keeps the indent and counts numbered items up', () => {
    expect(continueListOnNewline('  - [x] A4', '  - [x] A4\n')?.body).toBe('  - [x] A4\n  - [ ] ');
    expect(continueListOnNewline('1. First', '1. First\n')?.body).toBe('1. First\n2. ');
    expect(continueListOnNewline('- Point', '- Point\n')?.body).toBe('- Point\n- ');
  });

  it('leaves the list when the item was left empty', () => {
    const result = continueListOnNewline('- [ ] Done\n- [ ] ', '- [ ] Done\n- [ ] \n');
    expect(result?.body).toBe('- [ ] Done\n');
    expect(result?.selection).toEqual(at(11));
  });

  it('ignores anything that is not a newline typed at the end of an item', () => {
    expect(continueListOnNewline('Plain text', 'Plain text\n')).toBeNull();
    expect(continueListOnNewline('- [ ] A', '- [ ] AB')).toBeNull();
    expect(continueListOnNewline('- [ ] A', '')).toBeNull();
  });
});
