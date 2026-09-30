import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { DeviceEventEmitter } from 'react-native';

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
      blue: '#E6003A',
      yellow: '#C8A800',
      success: '#2ECC71',
      warning: '#F4A100',
      error: '#FF3B30',
      white: '#FFFFFF',
      black: '#000000',
      overlay: 'rgba(0,0,0,0.5)',
    },
  }),
}));

import { VoiceModal } from '../../src/ui/components/VoiceModal';

/** Every string rendered as a Text child. */
const textOf = (tree: ReactTestRenderer.ReactTestRenderer): string =>
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

const render = (): ReactTestRenderer.ReactTestRenderer => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<VoiceModal visible userId="voice-user" onClose={jest.fn()} />);
  });
  return tree;
};

describe('voice assistant sheet', () => {
  beforeEach(() => {
    // Jest runs as iOS, where PermissionsAndroid only logs that it does nothing.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('has no debug label, and says where the words will appear', () => {
    const tree = render();
    const text = textOf(tree);
    expect(text).not.toMatch(/DEBUG|🔍/);
    expect(text).toContain('You said');
    expect(text).toContain('Your words will show up here as you speak.');
    expect(text).toContain('Hold the mic button to talk');
    act(() => tree.unmount());
  });

  it('shows the words as they are transcribed', () => {
    const tree = render();
    act(() => {
      DeviceEventEmitter.emit('onSpeechPartialResult', { transcript: 'add task submit' });
    });
    expect(tree.root.findByProps({ testID: 'voice-transcript' }).props.children.join('')).toBe(
      '“add task submit”',
    );

    act(() => {
      DeviceEventEmitter.emit('onSpeechFinalResult', { transcript: 'add task submit report by 5pm' });
    });
    expect(textOf(tree)).toContain('add task submit report by 5pm');
    expect(textOf(tree)).not.toContain('Your words will show up here');
    act(() => tree.unmount());
  });

  it('has no suggested commands, only the mic and a box for typing one', () => {
    const tree = render();
    const text = textOf(tree);
    for (const command of [
      'Add task submit report by 5pm',
      'Block 2-4pm today for deep work',
      'Note: review pilot evaluation parameters',
    ]) {
      expect(text).not.toContain(command);
    }
    expect(text).not.toContain('Or try one of these');
    expect(tree.root.findAll((node) => node.props.placeholder === 'Or type a command...').length).toBeGreaterThan(0);
    act(() => tree.unmount());
  });
});
