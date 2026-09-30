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

jest.mock('../../src/cloud', () => ({
  hasProEntitlement: jest.fn(),
}));

import { pick } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { hasProEntitlement } from '../../src/cloud';
import { cloudClient } from '../../src/cloud/cloudClient';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { flashcardStore } from '../../src/storage/flashcardStore';
import { FlashcardsScreen } from '../../src/ui/screens/flashcards';
import type { ToolBackHandler } from '../../src/ui/components/tools';

const USER = 'flashcards-screen-user';

/** Every string rendered as a Text child, whether alone or among others. */
const textOf = (tree: Pick<ReactTestRenderer.ReactTestRenderer, 'root'>): string =>
  tree.root
    .findAll((node) => {
      const { children } = node.props;
      return typeof children === 'string' || (Array.isArray(children) && children.some((c) => typeof c === 'string'));
    })
    .map((node) => {
      const { children } = node.props;
      return Array.isArray(children) ? children.filter((c) => typeof c !== 'object').join('') : children;
    })
    .join(' | ');

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('FlashcardsScreen', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM flashcard_decks');
    jest.mocked(hasProEntitlement).mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const render = (registerBack = jest.fn()) => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <FlashcardsScreen
          userId={USER}
          refreshTrigger={0}
          onRefresh={jest.fn()}
          onBack={jest.fn()}
          registerBack={registerBack}
        />
      );
    });
    return tree!;
  };

  it('explains Student Pro instead of offering uploads without the plan', () => {
    jest.mocked(hasProEntitlement).mockReturnValue(false);
    const text = textOf(render());
    expect(text).toContain('Flashcards is a Student Pro feature');
    expect(text).not.toContain('Choose a PDF');
  });

  it('turns a chosen PDF into a deck and opens it', async () => {
    jest.mocked(pick).mockResolvedValue([
      { uri: 'content://docs/bio.pdf', name: 'bio.pdf', size: 1200 } as never,
    ]);
    jest.mocked(RNFS.readFile).mockResolvedValue(Buffer.from('%PDF-1.7 cells').toString('base64'));
    jest.spyOn(cloudClient, 'request').mockResolvedValue({
      status: 'success',
      data: {
        deckTitle: 'Cell biology',
        cards: [{ question: 'What is a cell?', answer: 'The unit of life.' }],
        pagesRead: 3,
        ocrPages: [],
        warnings: [],
      } as never,
    });
    const tree = render();

    await act(async () => {
      tree.root
        .find((node) => node.props.accessibilityRole === 'button' && textOf({ root: node }).includes('Choose a PDF'))
        .props.onPress();
    });
    await flush();

    expect(flashcardStore.getDecks(USER).map((deck) => deck.title)).toEqual(['Cell biology']);
    const text = textOf(tree);
    expect(text).toContain('What is a cell?');
    expect(text).toContain('Study');
  });

  it('steps back from a deck to the list before leaving', () => {
    flashcardStore.save({
      id: 'deck-back',
      userId: USER,
      title: 'History',
      cards: [{ question: 'When?', answer: '1898' }],
    });
    let handler: ToolBackHandler | null = null;
    const registerBack = jest.fn((next: ToolBackHandler | null) => {
      handler = next;
    });
    const tree = render(registerBack);
    expect(handler).toBeNull();

    act(() => {
      tree.root
        .find((node) => node.props.accessibilityHint?.startsWith('Double tap to open') && node.props.onPress)
        .props.onPress();
    });
    expect(textOf(tree)).toContain('When?');
    expect(handler).not.toBeNull();

    act(() => {
      expect(handler!()).toBe(true);
    });
    expect(textOf(tree)).toContain('synced across your devices');
    expect(handler).toBeNull();
  });
});
