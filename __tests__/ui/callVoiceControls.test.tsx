import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import type { CallResolution, CallState } from '../../src/scheduler';
import { CallAnsweredView } from '../../src/ui/components/call/CallAnsweredView';

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
      chipActiveText: '#FFFFFF',
      switchTrackOff: '#767577',
      switchThumb: '#FFFFFF',
      placeholder: '#888888',
      iconMuted: '#AAAAAA',
      eventIconBg: '#F0F0FF',
      bannerBg: '#FCE4D6',
      noteHighlightBg: '#FFF3A3',
      noteHighlightText: '#1A1A1A',
    },
  }),
}));

const getTextContent = (content: React.ReactNode): string =>
  React.Children.toArray(content)
    .map(child =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : '',
    )
    .join('');

const getRenderedText = (
  renderer: ReactTestRenderer.ReactTestRenderer,
): string =>
  renderer.root
    .findAllByType(Text)
    .map(node => getTextContent(node.props.children))
    .join(' ');

const renderCallView = (
  callState: CallState,
  resolution: CallResolution | null,
  onSnooze: (minutes: number) => void = jest.fn(),
): React.ReactElement => (
  <CallAnsweredView
    task="Review algorithms"
    callState={callState}
    resolution={resolution}
    snoozeMinutes={10}
    onSnooze={onSnooze}
    onAcknowledge={jest.fn()}
    onDecline={jest.fn()}
    transcript=""
    reply=""
  />
);

describe('answered call voice controls', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T10:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses automatic voice guidance without a hold-to-talk control', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(renderCallView('connected', null));
    });

    expect(getRenderedText(renderer)).toContain(
      'Say Acknowledge or Snooze at any time',
    );
    expect(
      renderer.root.findAll(
        node => node.props.accessibilityLabel === 'Hold to speak',
      ),
    ).toHaveLength(0);
    expect(
      renderer.root.find(
        node => node.props.accessibilityLabel === 'End reminder call',
      ),
    ).toBeDefined();

    ReactTestRenderer.act(() => renderer.unmount());
  });
  it('shows a running call timer and the configured compact snooze action', () => {
    const onSnooze = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        renderCallView('connected', null, onSnooze),
      );
    });
    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(2_100);
    });

    expect(getRenderedText(renderer)).toContain('00:02');
    const snoozeButton = renderer.root.find(
      node =>
        node.props.accessibilityLabel === 'Snooze reminder for 10 minutes',
    );
    ReactTestRenderer.act(() => snoozeButton.props.onPress());
    expect(onSnooze).toHaveBeenCalledWith(10);

    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('renders speaking, listening, and processing call states', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(renderCallView('speaking', null));
    });
    expect(getRenderedText(renderer)).toContain('LAFINA is speaking...');

    ReactTestRenderer.act(() => {
      renderer.update(renderCallView('speaking_listening', null));
    });
    expect(getRenderedText(renderer)).toContain('you can respond now');

    ReactTestRenderer.act(() => {
      renderer.update(renderCallView('listening', null));
    });
    expect(getRenderedText(renderer)).toContain(
      'Listening for your response...',
    );

    ReactTestRenderer.act(() => {
      renderer.update(renderCallView('processing', null));
    });
    expect(getRenderedText(renderer)).toContain('Processing on this device...');

    ReactTestRenderer.act(() => renderer.unmount());
  });

  it.each([
    ['acknowledged', 'REMINDER ACKNOWLEDGED', 'Saved as complete.'],
    ['snoozed', 'REMINDER SNOOZED', 'Snoozed for 10 minutes.'],
    ['missed', 'REMINDER MISSED', 'Snooze limit reached.'],
  ] as const)(
    'renders the %s terminal result and disables call controls',
    (outcome, title, message) => {
      let renderer!: ReactTestRenderer.ReactTestRenderer;

      ReactTestRenderer.act(() => {
        renderer = ReactTestRenderer.create(
          renderCallView('disconnected', { outcome, message }),
        );
      });

      expect(getRenderedText(renderer)).toContain(title);
      expect(getRenderedText(renderer)).toContain(message);
      const endCall = renderer.root.find(
        node => node.props.accessibilityLabel === 'End reminder call',
      );
      expect(endCall.props.accessibilityState.disabled).toBe(true);

      ReactTestRenderer.act(() => renderer.unmount());
    },
  );
});
