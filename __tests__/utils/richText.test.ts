import { htmlToMarkdown, isHtmlBody, noteBodyToMarkdown } from '../../src/utils/richText';

describe('note bodies written by LAFINA desktop', () => {
  it('recognises desktop HTML and leaves mobile text alone', () => {
    expect(isHtmlBody('<p>Hello</p>')).toBe(true);
    expect(isHtmlBody('**Hello** - [ ] task')).toBe(false);
    expect(noteBodyToMarkdown('Plain *mobile* note')).toBe('Plain *mobile* note');
  });

  it('projects paragraphs and inline formatting to the mobile dialect', () => {
    expect(
      htmlToMarkdown('<p>Read <strong>chapter 3</strong> and <em>skim</em> <mark>4</mark></p><p>Then <code>quiz</code></p>')
    ).toBe('Read **chapter 3** and *skim* ==4==\nThen `quiz`');
  });

  it('keeps checklists, their state and their nesting', () => {
    const html =
      '<ul class="lf-checklist"><li data-checked="true">Buy paper' +
      '<ul class="lf-checklist"><li data-checked="false">A4</li></ul></li>' +
      '<li data-checked="false">Print</li></ul>';
    expect(htmlToMarkdown(html)).toBe('- [x] Buy paper\n  - [ ] A4\n- [ ] Print');
  });

  it('numbers ordered lists and marks headings, quotes and rules', () => {
    expect(
      htmlToMarkdown('<h2>Plan</h2><ol><li>One</li><li>Two</li></ol><blockquote>Note</blockquote><hr>')
    ).toBe('## Plan\n1. One\n2. Two\n> Note\n---');
  });

  it('decodes entities, turns line breaks into new lines and names images', () => {
    expect(htmlToMarkdown('<p>Tom &amp; Jerry&nbsp;&#8212; 1 &lt; 2<br>next</p>')).toBe(
      'Tom & Jerry — 1 < 2\nnext'
    );
    expect(htmlToMarkdown('<p><img src="lafina-asset://a.png" alt="Diagram"></p>')).toBe(
      '[image: Diagram]'
    );
  });

  it('copes with nested blocks and a stray closing tag', () => {
    expect(htmlToMarkdown('<div><p>First</p><p>Second</p></div></span>')).toBe('First\nSecond');
  });
});
