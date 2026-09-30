import React from 'react';
import { AppState, NativeModules } from 'react-native';
import type { AppStateStatus } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import { SPLASH_TIMING } from '../src/ui/splash/synthWave';
import { db } from '../src/storage/database';
import { initDatabase } from '../src/storage/dbInit';
import { remindersStore } from '../src/storage/remindersStore';
import { userStore } from '../src/storage/userStore';
import { syncWorker } from '../src/sync/syncWorker';

jest.mock('@op-engineering/op-sqlite', () => {
  throw new Error('Use the JS fallback database for React component tests.');
});

jest.mock('../src/sync/syncWorker', () => ({
  syncWorker: {
    performSync: jest.fn().mockResolvedValue(undefined),
  },
}));

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

jest.mock('react-native-safe-area-context', () => {
  const reactModule = jest.requireActual('react') as typeof import('react');
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      reactModule.createElement(reactModule.Fragment, null, children),
  };
});

jest.mock('../src/ui/screens/IncomingCallScreen', () => {
  const reactModule = jest.requireActual('react') as typeof import('react');
  return {
    IncomingCallScreen: (props: {
      visible: boolean;
      reminderId: string;
      initialAction: string;
    }) =>
      props.visible
        ? reactModule.createElement('MockIncomingCallScreen', props)
        : null,
  };
});

interface MockReminderModule {
  consumePendingCall: jest.Mock;
}

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('application startup', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | null = null;
  let nativeReminder: MockReminderModule;

  const getRenderer = (): ReactTestRenderer.ReactTestRenderer => {
    if (!renderer) {
      throw new Error('App renderer is unavailable.');
    }
    return renderer;
  };

  /**
   * How many splash screens are on screen: 1 while starting up, 0 after.
   * Only host views count — a View passes its testID to the one it renders,
   * so matching on the id alone would find the same splash twice.
   */
  const splashCount = (): number =>
    getRenderer().root.findAll(
      (node) => node.props.testID === 'synth-splash' && typeof node.type === 'string',
    ).length;

  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    db.executeSync('DELETE FROM reminders');
    db.executeSync('DELETE FROM active_session');
    db.executeSync('DELETE FROM users');

    NativeModules.LafinaReminder = {
      scheduleExactAlarm: jest.fn().mockResolvedValue(true),
      cancelAlarm: jest.fn().mockResolvedValue(true),
      consumePendingCall: jest.fn().mockResolvedValue(null),
      finishIncomingCall: jest.fn().mockResolvedValue(true),
      getPermissionStatus: jest.fn().mockResolvedValue({
        canScheduleExactAlarms: true,
        canUseFullScreenIntent: true,
        notificationsEnabled: true,
      }),
      openExactAlarmSettings: jest.fn().mockResolvedValue(true),
      openFullScreenIntentSettings: jest.fn().mockResolvedValue(true),
    };
    nativeReminder = NativeModules.LafinaReminder as MockReminderModule;
  });

  afterEach(() => {
    if (renderer) {
      ReactTestRenderer.act(() => renderer?.unmount());
      renderer = null;
    }
    jest.useRealTimers();
  });

  it('lets the splash finish speaking when no reminder call is pending', async () => {
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      await flushPromises();
    });

    // The splash owns the timing now: it says its piece, quiets down and
    // stretches away, rather than being cut off after a fixed wait.
    const { introMs, minVoiceMs, settleMs, releaseMs } = SPLASH_TIMING;
    const handover = introMs + minVoiceMs + settleMs + releaseMs;

    expect(splashCount()).toBe(1);
    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(handover - 1);
    });
    expect(splashCount()).toBe(1);

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(splashCount()).toBe(0);
  });

  it('routes a tapped heads-up notification body to the incoming call screen', async () => {
    const userId = 'cold-start-user';
    const now = new Date().toISOString();
    db.executeSync(
      'INSERT INTO users (id, username, is_new_user, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [userId, 'Cold Start Student', 0, now, now],
    );
    userStore.setCurrentUser(userId);
    remindersStore.insertReminder({
      id: 'rem-cold-start',
      userId,
      task: 'Compiler Design midterm',
      description: null,
      scheduledAt: now,
      triggerAt: new Date(Date.now() + 60_000).toISOString(),
      status: 'pending',
      preCastAudioPath: null,
    });
    nativeReminder.consumePendingCall.mockResolvedValueOnce({
      reminderId: 'rem-cold-start',
      task: 'Compiler Design midterm',
      action: 'call',
    });

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      await flushPromises();
    });
    for (let flushIndex = 0; flushIndex < 5; flushIndex += 1) {
      await ReactTestRenderer.act(flushPromises);
    }

    expect(nativeReminder.consumePendingCall).toHaveBeenCalledTimes(1);
    // A pending call skips the splash outright.
    expect(splashCount()).toBe(0);
    const incomingScreen = getRenderer().root.find(
      node => (node.type as unknown) === 'MockIncomingCallScreen',
    );
    expect(incomingScreen.props.visible).toBe(true);
    expect(incomingScreen.props.initialAction).toBe('call');
    expect(incomingScreen.props.reminderId).toBe('rem-cold-start');
  });

  it('syncs an existing account at startup and whenever the app resumes', async () => {
    const userId = 'resume-sync-user';
    const now = new Date().toISOString();
    db.executeSync(
      'INSERT INTO users (id, username, is_new_user, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [userId, 'Resume Student', 0, now, now],
    );
    userStore.setCurrentUser(userId);
    let appStateListener: ((nextState: AppStateStatus) => void) | null = null;
    const appStateSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_eventType, listener) => {
        appStateListener = listener;
        return { remove: jest.fn() };
      });

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
      await flushPromises();
    });
    for (let flushIndex = 0; flushIndex < 3; flushIndex += 1) {
      await ReactTestRenderer.act(flushPromises);
    }

    expect(syncWorker.performSync).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => {
      if (!appStateListener) {
        throw new Error('AppState listener was not registered.');
      }
      appStateListener('active');
      await flushPromises();
    });

    expect(syncWorker.performSync).toHaveBeenCalledTimes(2);
    appStateSpy.mockRestore();
  });
});
