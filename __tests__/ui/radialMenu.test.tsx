import React, { useImperativeHandle } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Vibration } from 'react-native';

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

import { CustomTabBar, MIC_CENTER_FROM_BOTTOM } from '../../src/ui/components/CustomTabBar';
import {
  RadialMenu,
  buildRadialItems,
  useRadialMenu,
} from '../../src/ui/components/radial';
import type { RadialMenuItem, RadialMenuState } from '../../src/ui/components/radial';

type Tree = ReactTestRenderer.ReactTestRenderer;

const touch = (pageX: number, pageY: number) => ({ nativeEvent: { pageX, pageY } });

const findMic = (tree: Tree) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === 'Voice Action button' &&
      typeof node.props.onTouchStart === 'function'
  )[0];

describe('Mic button and radial menu', () => {
  beforeEach(() => {
    jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('CustomTabBar mic', () => {
    const renderBar = (props: Partial<React.ComponentProps<typeof CustomTabBar>> = {}): Tree => {
      let tree: Tree;
      act(() => {
        tree = ReactTestRenderer.create(
          <CustomTabBar activeTab="calendar" onTabPress={jest.fn()} onMicPress={jest.fn()} {...props} />
        );
      });
      return tree!;
    };

    it('still opens the voice assistant on a tap', () => {
      const onMicPress = jest.fn();
      const onMicDrag = jest.fn();
      const mic = findMic(renderBar({ onMicPress, onMicLongPress: jest.fn(), onMicDrag }));
      act(() => {
        mic.props.onTouchStart(touch(100, 500));
        mic.props.onTouchMove(touch(100, 490));
        mic.props.onPress();
      });
      expect(onMicPress).toHaveBeenCalledTimes(1);
      expect(onMicDrag).not.toHaveBeenCalled();
    });

    it('reports a hold, the slide that follows, and the release', () => {
      const onMicLongPress = jest.fn();
      const onMicDrag = jest.fn();
      const onMicRelease = jest.fn();
      const mic = findMic(renderBar({ onMicLongPress, onMicDrag, onMicRelease }));
      act(() => {
        mic.props.onTouchStart(touch(100, 500));
        mic.props.onLongPress();
        mic.props.onTouchMove(touch(60, 400));
        mic.props.onTouchEnd(touch(40, 380));
      });
      expect(onMicLongPress).toHaveBeenCalledTimes(1);
      expect(onMicDrag).toHaveBeenCalledWith(-40, -100);
      expect(onMicRelease).toHaveBeenCalledWith(-60, -120);
      expect(mic.props.delayLongPress).toBe(350);
    });

    it('reports a cancelled hold without an offset', () => {
      const onMicRelease = jest.fn();
      const mic = findMic(renderBar({ onMicLongPress: jest.fn(), onMicRelease }));
      act(() => {
        mic.props.onTouchStart(touch(100, 500));
        mic.props.onLongPress();
        mic.props.onTouchCancel();
      });
      expect(onMicRelease).toHaveBeenCalledWith(null, null);
    });

    it('offers the menu to TalkBack as a long-press action', () => {
      const onMicLongPress = jest.fn();
      const onMicPress = jest.fn();
      const mic = findMic(renderBar({ onMicLongPress, onMicPress }));
      expect(mic.props.accessibilityActions).toEqual([
        { name: 'activate' },
        { name: 'longpress', label: 'Open study tools' },
      ]);
      act(() => {
        mic.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
        mic.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
      });
      expect(onMicLongPress).toHaveBeenCalledTimes(1);
      expect(onMicPress).toHaveBeenCalledTimes(1);
    });

    it('shows a running timer on the mic', () => {
      const tree = renderBar({ micBadge: '12:34' });
      expect(tree.root.findAll((node) => node.props.children === '12:34').length).toBeGreaterThan(0);
    });

    it('places the mic centre where the menu expects it', () => {
      expect(MIC_CENTER_FROM_BOTTOM).toBe(66);
    });
  });

  describe('radial items', () => {
    it('gives students the study tools, locked without Student Pro', () => {
      const free = buildRadialItems('student', false);
      expect(free.map((item) => item.key)).toEqual(['pomodoro', 'flashcards', 'mic', 'studynotes', 'meetings']);
      expect(free.filter((item) => item.locked).map((item) => item.key)).toEqual([
        'flashcards',
        'studynotes',
        'meetings',
      ]);
      expect(buildRadialItems('student', true).some((item) => item.locked)).toBe(false);
    });

    it('gives business shells the Pomodoro and the Mic', () => {
      expect(buildRadialItems('manager', true).map((item) => item.key)).toEqual(['pomodoro', 'mic']);
      expect(buildRadialItems('employee', false).map((item) => item.key)).toEqual(['pomodoro', 'mic']);
    });
  });

  describe('RadialMenu', () => {
    const items: RadialMenuItem[] = [
      ...buildRadialItems('student', false),
      { key: 'locked', label: 'Locked tool', icon: () => null, locked: true },
    ];

    // The fan opens on staggered springs; an unmounted tree stops them, so the
    // timers cannot outlive the test and fire against a torn-down renderer.
    const rendered: Tree[] = [];
    afterEach(() => {
      act(() => {
        rendered.splice(0).forEach((tree) => tree.unmount());
      });
    });

    const renderMenu = (onSelect = jest.fn(), onDismiss = jest.fn()): Tree => {
      const Harness: React.FC = () => {
        const state = useRadialMenu(items, onSelect);
        return (
          <RadialMenu
            visible
            items={items}
            layout={state.layout}
            highlightedIndex={null}
            onSelect={onSelect}
            onDismiss={onDismiss}
          />
        );
      };
      let tree: Tree;
      act(() => {
        tree = ReactTestRenderer.create(<Harness />);
      });
      // Items are placed once the overlay knows its size.
      act(() => {
        tree!.root
          .find((node) => node.props.testID === 'radial-menu' && node.props.onLayout)
          .props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } });
      });
      rendered.push(tree!);
      return tree!;
    };

    it('opens an item on tap and closes on the backdrop', () => {
      const onSelect = jest.fn();
      const onDismiss = jest.fn();
      const tree = renderMenu(onSelect, onDismiss);
      act(() => {
        tree.root
          .find((node) => node.props.testID === 'radial-item-pomodoro' && node.props.onPress)
          .props.onPress();
      });
      expect(onSelect).toHaveBeenCalledWith('pomodoro');

      const closers = tree.root.findAll(
        (node) => node.props.accessibilityLabel === 'Close study tools' && node.props.onPress
      );
      expect(closers.length).toBeGreaterThanOrEqual(2);
      act(() => closers[0].props.onPress());
      expect(onDismiss).toHaveBeenCalled();
    });

    it('labels a locked item for TalkBack', () => {
      const tree = renderMenu();
      expect(
        tree.root.findAll((node) => node.props.accessibilityLabel === 'Locked tool, Student Pro').length
      ).toBeGreaterThan(0);
    });
  });

  describe('useRadialMenu', () => {
    const items = buildRadialItems('student', true);

    const renderHook = (onSelect: (key: string) => void) => {
      const ref = React.createRef<RadialMenuState>();
      const Harness = React.forwardRef<RadialMenuState>((_, forwarded) => {
        const state = useRadialMenu(items, onSelect);
        useImperativeHandle(forwarded, () => state, [state]);
        return null;
      });
      act(() => {
        ReactTestRenderer.create(<Harness ref={ref} />);
      });
      return ref;
    };

    it('selects the item a released finger rests on', () => {
      const onSelect = jest.fn();
      const menu = renderHook(onSelect);
      const first = menu.current!.layout.items[0];
      act(() => menu.current!.openMenu());
      act(() => menu.current!.drag(first.x, first.y));
      expect(menu.current!.highlighted).toBe(0);
      act(() => menu.current!.release(first.x, first.y));
      expect(onSelect).toHaveBeenCalledWith(items[0].key);
      expect(menu.current!.open).toBe(false);
    });

    it('stays open for tapping when released near the mic', () => {
      const onSelect = jest.fn();
      const menu = renderHook(onSelect);
      act(() => menu.current!.openMenu());
      act(() => menu.current!.release(4, -6));
      expect(onSelect).not.toHaveBeenCalled();
      expect(menu.current!.open).toBe(true);
      act(() => menu.current!.close());
      expect(menu.current!.open).toBe(false);
    });
  });
});
