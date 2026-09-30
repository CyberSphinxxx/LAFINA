import React, { useImperativeHandle } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

jest.mock('../../src/scheduler', () => ({
  scheduleTimerAlarm: jest.fn().mockResolvedValue(undefined),
  cancelTimerAlarm: jest.fn().mockResolvedValue(undefined),
  startTimerRing: jest.fn(),
  stopTimerRing: jest.fn(),
}));

import { cancelTimerAlarm, scheduleTimerAlarm, startTimerRing } from '../../src/scheduler';
import { initDatabase } from '../../src/storage/dbInit';
import { db } from '../../src/storage/database';
import { pomodoroStore } from '../../src/storage/pomodoroStore';
import { PomodoroProvider, usePomodoro } from '../../src/ui/contexts/PomodoroContext';

type PomodoroValue = ReturnType<typeof usePomodoro>;

const USER = 'pomodoro-provider-user';

const Probe = React.forwardRef<PomodoroValue>((_, ref) => {
  const value = usePomodoro();
  useImperativeHandle(ref, () => value, [value]);
  return null;
});

const renderProvider = (syncRevision = 0) => {
  const ref = React.createRef<PomodoroValue>();
  let tree: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <PomodoroProvider userId={USER} syncRevision={syncRevision}>
        <Probe ref={ref} />
      </PomodoroProvider>
    );
  });
  const rerender = (revision: number) =>
    act(() => {
      tree.update(
        <PomodoroProvider userId={USER} syncRevision={revision}>
          <Probe ref={ref} />
        </PomodoroProvider>
      );
    });
  return { ref, tree: tree!, rerender };
};

describe('PomodoroProvider on mobile', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-19T08:00:00.000Z') });
    jest.clearAllMocks();
    ['pomodoro_settings', 'pomodoro_state', 'pomodoro_sessions', 'sync_outbox'].forEach((table) =>
      db.executeSync(`DELETE FROM ${table}`)
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules the background alert at the phase deadline and cancels it on pause', () => {
    const { ref, tree } = renderProvider();
    act(() => ref.current!.start());

    const deadline = Date.now() + 25 * 60_000;
    expect(scheduleTimerAlarm).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'pomodoro', triggerAtMs: deadline, title: 'Focus complete' })
    );

    act(() => ref.current!.pause());
    expect(cancelTimerAlarm).toHaveBeenLastCalledWith('pomodoro');
    act(() => tree.unmount());
  });

  it('rings in the app and logs the session when a phase ends while open', () => {
    const { ref, tree } = renderProvider();
    act(() => ref.current!.start());
    act(() => {
      jest.advanceTimersByTime(25 * 60_000 + 500);
    });

    expect(startTimerRing).toHaveBeenCalledWith(10, true);
    expect(pomodoroStore.listSessions(USER)).toHaveLength(1);
    expect(ref.current!.runtime.phase).toBe('shortBreak');
    act(() => tree.unmount());
  });

  it('picks up settings that arrived from another device', () => {
    const { ref, rerender, tree } = renderProvider();
    expect(ref.current!.settings.focusMinutes).toBe(25);

    // What applying a synced change leaves in the table.
    pomodoroStore.saveSettings(USER, { ...pomodoroStore.getSettings(USER), focusMinutes: 40 });
    rerender(1);

    expect(ref.current!.settings.focusMinutes).toBe(40);
    expect(ref.current!.runtime.totalMs).toBe(40 * 60_000);
    act(() => tree.unmount());
  });
});
