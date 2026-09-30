import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NativeModules } from 'react-native';

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
  hasProEntitlement: jest.fn(() => true),
}));

import { hasProEntitlement } from '../../src/cloud';
import { db } from '../../src/storage/database';
import { initDatabase } from '../../src/storage/dbInit';
import { notesStore } from '../../src/storage/notesStore';
import { recordedMeetingStore } from '../../src/storage/recordedMeetingStore';
import { MeetingsProvider } from '../../src/ui/contexts/MeetingsContext';
import { MeetingsScreen } from '../../src/ui/screens/meetings';
import type { ToolBackHandler } from '../../src/ui/components/tools';

const USER = 'meetings-screen-user';

type Node = ReactTestRenderer.ReactTestInstance;

/** Every string rendered as a Text child, whether alone or among others. */
const textOf = (tree: { root: Node }): string =>
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

const pressButton = (tree: ReactTestRenderer.ReactTestRenderer, label: string): void => {
  const button = tree.root.find(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.onPress === 'function' &&
      textOf({ root: node }).includes(label),
  );
  act(() => button.props.onPress());
};

const NOTES = {
  title: 'Sprint review',
  summary: 'The demo went well and the release is on track.',
  key_topics: [{ topic: 'Release', discussion: 'Friday is still the target.' }],
  decisions: ['Keep the Friday release'],
  action_items: [{ task: 'Update the changelog', assignee: 'Mia', deadline: 'Thursday', status: 'pending' as const }],
  important_dates: [],
  issues: [],
  unresolved_questions: [],
  key_points: [],
};

const seedMeeting = (id: string, options: { hasAudio: boolean }): void => {
  recordedMeetingStore.create({ id, userId: USER, title: id === 'local' ? 'Sprint review' : 'Desktop meeting' });
  recordedMeetingStore.update(id, {
    status: 'completed',
    durationSeconds: 1500,
    audioBytes: options.hasAudio ? 48_000_000 : 0,
    transcript: [{ startMs: 0, endMs: 3000, text: 'Let us start with the demo.' }],
    notes: NOTES,
  });
  if (!options.hasAudio) db.executeSync('UPDATE recorded_meetings SET has_audio = 0 WHERE id = ?', [id]);
};

const render = (registerBack = jest.fn()) => {
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <MeetingsProvider userId={USER}>
        <MeetingsScreen onBack={jest.fn()} registerBack={registerBack} />
      </MeetingsProvider>,
    );
  });
  return tree!;
};

describe('MeetingsScreen', () => {
  beforeAll(async () => {
    await initDatabase();
    const now = new Date().toISOString();
    db.executeSync(
      'INSERT OR IGNORE INTO users (id, username, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [USER, 'meetings-screen', now, now],
    );
  });

  beforeEach(() => {
    db.executeSync('DELETE FROM recorded_meetings');
    db.executeSync('DELETE FROM notes');
    jest.mocked(hasProEntitlement).mockReturnValue(true);
    (NativeModules as Record<string, unknown>).LafinaMeetingRecorder = {
      startMeetingRecording: jest.fn(),
      isMeetingRecording: jest.fn(async () => false),
      listMeetingAudio: jest.fn(async () => ({ chunks: [], totalBytes: 0 })),
      clearRecoveryState: jest.fn(async () => true),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (NativeModules as Record<string, unknown>).LafinaMeetingRecorder;
  });

  it('explains Student Pro instead of offering to record without the plan', () => {
    jest.mocked(hasProEntitlement).mockReturnValue(false);
    const text = textOf(render());
    expect(text).toContain('Meetings is a Student Pro feature');
    expect(text).not.toContain('Start recording');
  });

  it('lists meetings under the recorder and opens one to its notes', () => {
    seedMeeting('local', { hasAudio: true });
    let handler: ToolBackHandler | null = null;
    const tree = render(
      jest.fn((next: ToolBackHandler | null) => {
        handler = next;
      }),
    );
    expect(textOf(tree)).toContain('Start recording');
    expect(textOf(tree)).toContain('Sprint review');

    act(() => {
      tree.root
        .find((node) => node.props.accessibilityHint?.startsWith('Double tap to open') && node.props.onPress)
        .props.onPress();
    });
    const text = textOf(tree);
    expect(text).toContain('The demo went well and the release is on track.');
    expect(text).toContain('Update the changelog');
    expect(text).toContain('Delete audio (46 MB)');

    // Back steps out of the meeting before it leaves the screen.
    act(() => {
      expect(handler!()).toBe(true);
    });
    expect(textOf(tree)).toContain('Start recording');
  });

  it('saves the notes into Notes as markdown, under Work', () => {
    seedMeeting('local', { hasAudio: true });
    const tree = render();
    act(() => {
      tree.root
        .find((node) => node.props.accessibilityHint?.startsWith('Double tap to open') && node.props.onPress)
        .props.onPress();
    });
    pressButton(tree, 'Save to Notes');

    const [note] = notesStore.getAll(USER);
    expect(note).toMatchObject({ title: 'Sprint review', category: 'Work', tags: ['Meeting'] });
    expect(note.body).toContain('## Summary');
    expect(note.body).toContain('- [ ] Mia — Update the changelog (by Thursday)');
    expect(textOf(tree)).toContain('Added to your notes, under Work.');
  });

  it('offers no audio actions for a meeting recorded on another device', () => {
    seedMeeting('synced', { hasAudio: false });
    const tree = render();
    expect(textOf(tree)).toContain('from another device');
    act(() => {
      tree.root
        .find((node) => node.props.accessibilityHint?.startsWith('Double tap to open') && node.props.onPress)
        .props.onPress();
    });
    const text = textOf(tree);
    expect(text).toContain('Recorded on another device');
    expect(text).not.toContain('Delete audio');
    expect(text).not.toContain('Transcribe again');
    expect(text).toContain('Share transcript');
  });
});
