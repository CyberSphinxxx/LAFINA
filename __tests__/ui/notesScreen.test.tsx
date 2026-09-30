import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native/Libraries/Modal/Modal', () => ({
  __esModule: true,
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? children : null,
}));

jest.mock('../../src/ui/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: false,
    toggleTheme: jest.fn(),
    colors: {
      background: '#FAF9F6',
      cardBg: '#FFFFFF',
      inputBg: '#F7F7F7',
      divider: '#EEEEEE',
      textPrimary: '#111111',
      textSecondary: '#666666',
      textMuted: '#888888',
      border: '#DDDDDD',
      statusBarStyle: 'dark-content',
      red: '#F75A5A',
      blue: '#2563EB',
      yellow: '#C8A800',
      success: '#2ECC71',
      warning: '#F4A100',
      error: '#FF3B30',
      white: '#FFFFFF',
      black: '#000000',
      overlay: 'rgba(0,0,0,0.5)',
      chipActiveText: '#FFFFFF',
      switchTrackOff: '#767577',
      switchThumb: '#FFFFFF',
      placeholder: '#888888',
      iconMuted: '#AAAAAA',
      eventIconBg: '#F0F0FF',
      bannerBg: '#FFF0F0',
      noteHighlightBg: '#FFF3A3',
      noteHighlightText: '#1A1A1A',
    },
  }),
}));

import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { localSettingsStore } from '../../src/storage/localSettingsStore';
import { notesStore } from '../../src/storage/notesStore';
import { NotesScreen } from '../../src/ui/screens/notes';

type Tree = ReactTestRenderer.ReactTestRenderer;

const USER = 'notes-screen-user';

const addNote = (id: string, title: string, body: string): void => {
  notesStore.insert({
    id,
    userId: USER,
    title,
    body,
    category: 'Personal',
    isPinned: false,
    tags: [],
    isVoiceTranscribed: false,
    imageUri: null,
  });
};

const render = async (): Promise<Tree> => {
  let tree: Tree;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <NotesScreen userId={USER} refreshTrigger={0} onRefresh={jest.fn()} />
    );
  });
  return tree!;
};

/**
 * Every checklist row, in reading order. Only the host views are taken: a
 * Touchable passes its accessibility props down through several wrappers, so
 * matching on the role alone would count each row more than once.
 */
const checklistRows = (tree: Tree) =>
  tree.root.findAll(
    (node) => node.props.accessibilityRole === 'checkbox' && typeof node.type === 'string'
  );

const pressRow = (tree: Tree, label: string): void => {
  const row = tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === 'checkbox' &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function'
  )[0];
  row.props.onPress();
};

const rowFor = (tree: Tree, label: string) =>
  checklistRows(tree).find((node) => node.props.accessibilityLabel === label);

describe('Notes screen', () => {
  beforeEach(async () => {
    await initDatabase();
    const now = new Date().toISOString();
    db.executeSync(
      'INSERT OR IGNORE INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [USER, 'Notes Tester', now, now]
    );
    db.executeSync('DELETE FROM notes');
    db.executeSync('DELETE FROM local_settings');
    db.executeSync('DELETE FROM custom_categories');
  });

  afterEach(() => {
    db.executeSync('DELETE FROM notes');
    db.executeSync('DELETE FROM local_settings');
    db.executeSync('DELETE FROM custom_categories');
  });

  it('draws a to-do as a checkbox on the card rather than as its markup', async () => {
    addNote('note-todo', 'Shopping', ['- [ ] Buy paper', '- [x] Post it'].join('\n'));
    const tree = await render();

    const rows = checklistRows(tree);
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual(['Buy paper', 'Post it']);
    expect(rows.map((row) => row.props.accessibilityState.checked)).toEqual([false, true]);
  });

  it('ticks a to-do straight from its card', async () => {
    addNote('note-tick', 'Shopping', ['- [ ] Buy paper', '- [ ] Post it'].join('\n'));
    const tree = await render();

    await act(async () => {
      pressRow(tree, 'Post it');
    });

    expect(notesStore.getAll(USER)[0].body).toBe(['- [ ] Buy paper', '- [x] Post it'].join('\n'));
    expect(rowFor(tree, 'Post it')!.props.accessibilityState.checked).toBe(true);
  });

  it('keeps a desktop note as HTML when a box is ticked from the card', async () => {
    const html =
      '<p><u>Underlined</u></p><ul class="lf-checklist">' +
      '<li data-checked="false">Buy paper</li></ul>';
    addNote('note-html', 'From desktop', html);
    const tree = await render();

    await act(async () => {
      pressRow(tree, 'Buy paper');
    });

    const saved = notesStore.getAll(USER)[0].body;
    expect(saved).toContain('data-checked="true"');
    // Formatting this editor cannot draw still has to survive the tick.
    expect(saved).toContain('<u>Underlined</u>');
  });

  it('renders the desktop dialect instead of showing its markers', async () => {
    addNote('note-rich', 'Rich', ['# Heading', '> Quoted', '- Point'].join('\n'));
    const tree = await render();

    const text = tree.root
      .findAll((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children as string);
    expect(text).toContain('Heading');
    expect(text).toContain('Quoted');
    expect(text).not.toContain('# Heading');
    expect(text).not.toContain('> Quoted');
  });
  describe('the chosen filter', () => {
    /** Taps a filter chip by its label. */
    const pressFilter = (tree: Tree, label: string): void => {
      const chip = tree.root.findAll(
        (node) =>
          typeof node.props.onPress === 'function' &&
          node.props.children?.props?.children === label
      )[0];
      chip.props.onPress();
    };

    /** Titles of the notes currently listed, host views only so each counts once. */
    const listedTitles = (tree: Tree): string[] =>
      tree.root
        .findAll(
          (node) =>
            typeof node.type === 'string' &&
            node.props.numberOfLines === 1 &&
            typeof node.props.children === 'string'
        )
        .map((node) => node.props.children as string);

    it('is remembered when the screen goes away and comes back', async () => {
      addNote('note-work', 'Standup', 'Body');
      addNote('note-personal', 'Groceries', 'Body');
      db.executeSync('UPDATE notes SET category = ? WHERE id = ?', ['Work', 'note-work']);
      const first = await render();
      expect(listedTitles(first)).toEqual(expect.arrayContaining(['Standup', 'Groceries']));

      await act(async () => {
        pressFilter(first, 'Work');
      });
      expect(listedTitles(first)).toEqual(['Standup']);

      // Switching tabs unmounts the screen; coming back must not reset it.
      await act(async () => {
        first.unmount();
      });
      const second = await render();
      expect(localSettingsStore.get(USER, 'notes.selectedFilter')).toBe('Work');
      expect(listedTitles(second)).toEqual(['Standup']);
      await act(async () => {
        second.unmount();
      });
    });

    it('falls back to All when the remembered category no longer exists', async () => {
      localSettingsStore.set(USER, 'notes.selectedFilter', 'Deleted Category');
      addNote('note-any', 'Anything', 'Body');
      const tree = await render();

      expect(localSettingsStore.get(USER, 'notes.selectedFilter')).toBe('Deleted Category');
      // The note is still listed, so the screen did not silently filter to nothing.
      expect(
        tree.root.findAll((node) => node.props.children === 'Anything').length
      ).toBeGreaterThan(0);
      await act(async () => {
        tree.unmount();
      });
    });
  });
});
