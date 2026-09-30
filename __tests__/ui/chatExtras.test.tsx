import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';

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

import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { cloudClient } from '../../src/cloud/cloudClient';
import { chatStore } from '../../src/storage/chatStore';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { ChatScreen } from '../../src/ui/screens/ChatScreen';

const PRO = 'chat-extras-pro';
const FREE = 'chat-extras-free';

type Tree = ReactTestRenderer.ReactTestRenderer;

/** Every string rendered as a Text child, whether alone or among others. */
const textOf = (tree: { root: ReactTestRenderer.ReactTestInstance }): string =>
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
    for (let round = 0; round < 20; round += 1) {
      await Promise.resolve();
    }
  });
};

/** The pressable itself; its host view carries the same label and handler. */
const byLabel = (tree: Tree, label: string) =>
  tree.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];

const send = async (tree: Tree, text: string): Promise<void> => {
  const input = tree.root.find((node) => typeof node.props.onChangeText === 'function' && node.props.returnKeyType === 'send');
  act(() => input.props.onChangeText(text));
  const button = tree.root.findAll(
    (node) =>
      typeof node.props.accessibilityLabel === 'string' &&
      /^(Send message|Create (PDF|Word|Excel|PowerPoint) file)$/.test(node.props.accessibilityLabel) &&
      typeof node.props.onPress === 'function',
  )[0];
  await act(async () => {
    button.props.onPress();
  });
  await flush();
};

const render = async (userId: string): Promise<Tree> => {
  let tree: Tree;
  act(() => {
    tree = ReactTestRenderer.create(<ChatScreen userId={userId} refreshTrigger={0} onRefresh={jest.fn()} />);
  });
  await flush();
  return tree!;
};

describe('Chat files and handbook answers on mobile', () => {
  beforeAll(async () => {
    await initDatabase();
    const now = new Date().toISOString();
    for (const [id, role] of [[PRO, 'student_pro'], [FREE, 'student']]) {
      db.executeSync(
        'INSERT OR IGNORE INTO users (id, username, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, id, role, now, now],
      );
    }
  });

  beforeEach(() => {
    jest.useFakeTimers();
    db.executeSync('DELETE FROM messages');
    db.executeSync('DELETE FROM local_settings');
    jest.spyOn(cloudClient, 'isOnline').mockResolvedValue(true);
    jest.spyOn(cloudClient, 'getAccessToken').mockReturnValue('token');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.mocked(RNFS.writeFile).mockReset();
    jest.mocked(Share.open).mockClear();
  });

  const serve = (routes: Record<string, unknown>) =>
    jest.spyOn(cloudClient, 'request').mockImplementation(async (path: string) => {
      const data = routes[path];
      return data ? { status: 'success', data: data as never } : { status: 'server_error', error: 'unexpected' };
    });

  it('creates a PDF from a request in so many words, and keeps it as a card to share', async () => {
    const request = serve({
      '/v1/ai/handbook/status': { enabled: false, functional: false, passages: 0 },
      '/v1/ai/documents': {
        summary: 'Here is your study guide on cell organelles.',
        filename: 'cell-organelles.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        contentBase64: 'JVBERi0xLjc=',
        warnings: [],
      },
    });
    const tree = await render(PRO);

    await send(tree, 'Make me a PDF study guide on cell organelles');

    expect(request).toHaveBeenCalledWith('/v1/ai/documents', expect.anything(), true);
    const [path, contents, encoding] = jest.mocked(RNFS.writeFile).mock.calls[0];
    expect(path).toMatch(/^\/documents\/attachments\/.+\.pdf$/);
    expect([contents, encoding]).toEqual(['JVBERi0xLjc=', 'base64']);

    const reply = chatStore.getMessages(PRO).find((message) => message.sender === 'assistant')!;
    expect(reply.content).toBe('Here is your study guide on cell organelles.');
    expect(reply.attachment).toMatchObject({ fileName: 'cell-organelles.pdf', format: 'pdf', uri: path });
    expect(textOf(tree)).toContain('cell-organelles.pdf');

    await act(async () => {
      byLabel(tree, 'Open or share cell-organelles.pdf').props.onPress();
    });
    await flush();
    expect(RNFS.copyFile).toHaveBeenCalledWith(path, '/temp/cell-organelles.pdf');
    expect(Share.open).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'file:///temp/cell-organelles.pdf', type: 'application/pdf' }),
    );
  });

  it('tags a reply grounded in the Student Handbook with its pages', async () => {
    const request = serve({
      '/v1/ai/handbook/status': { enabled: true, functional: true, passages: 412 },
      '/v1/ai/chat': {
        reply: 'USTP grades on a 1.0 to 5.0 scale.',
        model: 'deepseek-v4-flash',
        sources: [{ page: '32', pageEnd: '32', section: 'Grading', score: 0.8 }],
      },
    });
    const tree = await render(PRO);
    expect(textOf(tree)).toContain('Handbook');

    await send(tree, 'What is the grading system at USTP?');

    const chatCall = request.mock.calls.find(([path]) => path === '/v1/ai/chat')!;
    expect(JSON.parse(String(chatCall[1]?.body)).useHandbook).toBe(true);
    const text = textOf(tree);
    expect(text).toContain('USTP grades on a 1.0 to 5.0 scale.');
    expect(text).toContain('Handbook p. 32');
  });

  it('explains Student Pro instead of opening the file formats', async () => {
    serve({});
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const tree = await render(FREE);

    act(() => byLabel(tree, 'Create a file (Student Pro)').props.onPress());

    expect(alert).toHaveBeenCalledWith('Student Pro Required', expect.stringContaining('exclusive to Student Pro'));
    expect(textOf(tree)).not.toContain('PDF document');
  });

  it('offers the formats and the handbook switch to a Student Pro', async () => {
    serve({ '/v1/ai/handbook/status': { enabled: true, functional: true, passages: 412 } });
    const tree = await render(PRO);

    act(() => byLabel(tree, 'Create a file').props.onPress());
    const text = textOf(tree);
    expect(text).toContain('PDF document');
    expect(text).toContain('Excel workbook');
    expect(text).toContain('Answer from the Student Handbook');

    act(() => {
      tree.root
        .find((node) => node.props.accessibilityLabel === 'Answer from the Student Handbook' && node.props.onValueChange)
        .props.onValueChange(false);
    });
    const setting = db.executeSync('SELECT value FROM local_settings WHERE user_id = ? AND key = ?', [PRO, 'handbook'])
      .rows?.[0];
    expect(setting?.value).toBe('off');

    act(() => {
      tree.root
        .find((node) => node.props.accessibilityRole === 'button' && node.props.onPress && textOf({ root: node }).includes('Word document'))
        .props.onPress();
    });
    expect(textOf(tree)).toContain('Creating a Word file');
  });
});
