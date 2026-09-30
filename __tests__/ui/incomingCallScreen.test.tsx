import React from 'react';
import {
  DeviceEventEmitter,
  PermissionsAndroid,
  StyleSheet,
  Text,
} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import type { CallStateEvent, NativeCallAction } from '../../src/scheduler';
import { useTheme } from '../../src/ui/contexts/ThemeContext';
import { IncomingCallScreen } from '../../src/ui/screens/IncomingCallScreen';

jest.mock('react-native/Libraries/Modal/Modal', () => ({
  __esModule: true,
  default: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: React.ReactNode;
  }) => (visible ? children : null),
}));

jest.mock('../../src/ui/contexts/ThemeContext', () => ({
  useTheme: jest.fn(),
}));

jest.mock('../../src/scheduler', () => ({
  answerCall: jest.fn().mockResolvedValue(undefined),
  declineCall: jest.fn().mockResolvedValue(undefined),
  getReminderPreferences: jest.fn(() => ({
    leadTimeMinutes: 15,
    snoozeDurationMinutes: 10,
    maxSnoozeCount: 3,
    autoSnoozeDurationMinutes: 5,
  })),
  manualAcknowledgeCall: jest.fn().mockResolvedValue(undefined),
  manualSnoozeCall: jest.fn().mockResolvedValue(undefined),
  prepareCallSpeech: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/cloud/speechService', () => ({
  createCallSpeechProvider: jest.fn(() => ({
    speakText: jest.fn().mockResolvedValue({ source: 'gemini' }),
    stopSpeech: jest.fn().mockResolvedValue(undefined),
    prepareText: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn().mockResolvedValue(undefined),
  })),
}));

const schedulerMock = jest.requireMock('../../src/scheduler') as {
  answerCall: jest.Mock;
  declineCall: jest.Mock;
  prepareCallSpeech: jest.Mock;
};

let stateListener: ((event: CallStateEvent) => void) | null = null;

const useThemeMock = useTheme as jest.MockedFunction<typeof useTheme>;

const createTheme = (isDarkMode: boolean) => ({
  isDarkMode,
  toggleTheme: jest.fn(),
  colors: {
    background: isDarkMode ? '#121212' : '#FAF9F6',
    cardBg: isDarkMode ? '#1C1C1E' : '#FFFFFF',
    inputBg: isDarkMode ? '#2C2C2E' : '#FAF9F6',
    divider: isDarkMode ? '#3A3A3C' : '#F0F0F0',
    textPrimary: isDarkMode ? '#FFFFFF' : '#1A1A1A',
    textSecondary: isDarkMode ? '#A0A0A0' : '#7A7A7A',
    textMuted: isDarkMode ? '#666666' : '#A0A0A0',
    border: isDarkMode ? '#2C2C2E' : '#E5E5E5',
    statusBarStyle: isDarkMode
      ? ('light-content' as const)
      : ('dark-content' as const),
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
    proGradientStart: '#FF4D00',
    proGradientMid: '#C2006A',
    proGradientEnd: '#6B00C9',
    authGradientYellow: '#F8E81C',
    authGradientCrimson: '#D8163F',
    authGradientBlue: '#2A10F0',
    authVeil: 'rgba(255, 255, 255, 0.12)',
    holiday: '#0B8043',
  },
});

const getTextContent = (contentValue: React.ReactNode): string =>
  React.Children.toArray(contentValue)
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

const renderIncomingCall = (
  visible: boolean,
  onClose: () => void,
  initialAction: NativeCallAction = 'call',
): React.ReactElement => (
  <IncomingCallScreen
    visible={visible}
    reminderId="rem-call-ui"
    task="Compiler Design midterm"
    userId="student-1"
    initialAction={initialAction}
    onClose={onClose}
  />
);

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const emitCallState = (event: CallStateEvent): void => {
  if (!stateListener) {
    throw new Error('Call state listener was not registered.');
  }
  stateListener(event);
};

describe('incoming reminder call presentation', () => {
  const addListenerSpy = jest.spyOn(DeviceEventEmitter, 'addListener');
  const permissionRequestSpy = jest.spyOn(PermissionsAndroid, 'request');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    stateListener = null;
    addListenerSpy.mockImplementation(((
      eventType: string,
      listener: (...args: unknown[]) => unknown,
    ) => {
      if (eventType === 'LAFINA_CALL_STATE_CHANGE') {
        stateListener = listener as (event: CallStateEvent) => void;
      }
      return {
        remove: jest.fn(),
      } as unknown as ReturnType<typeof DeviceEventEmitter.addListener>;
    }) as typeof DeviceEventEmitter.addListener);
    permissionRequestSpy.mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    useThemeMock.mockReturnValue(createTheme(false));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    addListenerSpy.mockRestore();
    permissionRequestSpy.mockRestore();
  });

  it('shows a terminal result for 1.5 seconds before closing', async () => {
    const onClose = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(renderIncomingCall(true, onClose));
      await flushPromises();
    });
    ReactTestRenderer.act(() => {
      emitCallState({
        state: 'disconnected',
        resolution: {
          outcome: 'acknowledged',
          message: 'Great! Task acknowledged.',
        },
      });
    });

    expect(getRenderedText(renderer)).toContain('REMINDER ACKNOWLEDGED');
    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(1_499);
    });
    expect(onClose).not.toHaveBeenCalled();
    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('closes immediately when a disconnect has no terminal result', async () => {
    const onClose = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(renderIncomingCall(true, onClose));
      await flushPromises();
    });
    ReactTestRenderer.act(() => {
      emitCallState({
        state: 'disconnected',
      });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('processes the same notification answer action again after reopening', async () => {
    const onClose = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        renderIncomingCall(true, onClose, 'answer'),
      );
      await flushPromises();
    });
    expect(schedulerMock.answerCall).toHaveBeenCalledTimes(1);

    ReactTestRenderer.act(() => {
      renderer.update(renderIncomingCall(false, onClose, 'answer'));
    });
    ReactTestRenderer.act(() => {
      renderer.update(renderIncomingCall(true, onClose, 'answer'));
    });
    await ReactTestRenderer.act(flushPromises);

    expect(schedulerMock.answerCall).toHaveBeenCalledTimes(2);
    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('shows the LAFINA call identity, reminder, accessible actions, and both theme backgrounds', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(renderIncomingCall(true, jest.fn()));
    });

    const text = getRenderedText(renderer);
    expect(text).toContain('INCOMING SCHEDULED CALL');
    expect(text).toContain('LAFINA Scheduler');
    expect(text).toContain('University Academic Assistant');
    expect(text).toContain('Compiler Design midterm');
    expect(
      renderer.root.find(
        node => node.props.accessibilityLabel === 'LAFINA logo',
      ),
    ).toBeDefined();
    expect(
      renderer.root.find(
        node => node.props.accessibilityLabel === 'Answer reminder call',
      ),
    ).toBeDefined();
    expect(
      renderer.root.find(
        node => node.props.accessibilityLabel === 'Decline reminder call',
      ),
    ).toBeDefined();

    const hasLightBackground = renderer.root.findAll(node => {
      const flattened = StyleSheet.flatten(node.props.style);
      return flattened?.backgroundColor === '#FAF9F6';
    });
    expect(hasLightBackground.length).toBeGreaterThan(0);

    useThemeMock.mockReturnValue(createTheme(true));
    ReactTestRenderer.act(() => {
      renderer.update(renderIncomingCall(true, jest.fn()));
    });
    const hasDarkBackground = renderer.root.findAll(node => {
      const flattened = StyleSheet.flatten(node.props.style);
      return flattened?.backgroundColor === '#121212';
    });
    expect(hasDarkBackground.length).toBeGreaterThan(0);

    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('answers into the active call and ends through the existing auto-snooze path', async () => {
    const onClose = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(renderIncomingCall(true, onClose));
    });
    const answerButton = renderer.root.find(
      node => node.props.accessibilityLabel === 'Answer reminder call',
    );
    ReactTestRenderer.act(() => answerButton.props.onPress());
    await ReactTestRenderer.act(flushPromises);

    expect(schedulerMock.prepareCallSpeech).toHaveBeenCalledWith(
      expect.any(Object),
      'Compiler Design midterm',
      10,
    );
    expect(schedulerMock.answerCall).toHaveBeenCalledWith(
      'rem-call-ui',
      'student-1',
      true,
      expect.any(Object),
    );
    expect(getRenderedText(renderer)).toContain('ACTIVE SCHEDULED CALL');

    const endButton = renderer.root.find(
      node => node.props.accessibilityLabel === 'End reminder call',
    );
    ReactTestRenderer.act(() => endButton.props.onPress());
    await ReactTestRenderer.act(flushPromises);

    expect(schedulerMock.declineCall).toHaveBeenCalledWith(
      'rem-call-ui',
      'student-1',
      expect.any(Object),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    ReactTestRenderer.act(() => renderer.unmount());
  });
});
