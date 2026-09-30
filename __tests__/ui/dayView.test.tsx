import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

jest.mock('../../src/ui/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: true,
    toggleTheme: jest.fn(),
    colors: {
      background: '#121212',
      cardBg: '#1C1C1E',
      border: '#2C2C2E',
      textPrimary: '#FFFFFF',
      textSecondary: '#A0A0A0',
      textMuted: '#666666',
      red: '#F75A5A',
      blue: '#E6003A',
      success: '#2ECC71',
      white: '#FFFFFF',
    },
  }),
}));

import { DayView } from '../../src/ui/screens/calendar/components/DayView';
import { HOUR_HEIGHT } from '../../src/ui/screens/calendar/utils/timeGridLayout';
import type { Event, Task, TimeBlock } from '../../src/storage';

const DATE = new Date(2026, 8, 22);

const gym = { id: 'gym', title: 'GYM (TBA)', date: '2026-09-22', startTime: '08:00', endTime: '10:00' } as Event;
const study = {
  id: 'study', title: 'Study Block', date: '2026-09-22', startTime: '10:00', endTime: '11:00',
  color: '#3B82F6', category: 'study',
} as TimeBlock;
const quiz = {
  id: 'quiz', title: 'Quiz', dueDate: '2026-09-22', dueTime: '09:00', isCompleted: false, category: 'study', priority: 'High',
} as Task;

const render = () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <DayView
        targetDate={DATE}
        blocks={[study]}
        allTasks={[quiz]}
        allEvents={[gym]}
        timeFormat24h={false}
        onEditTask={jest.fn()}
        onEditEvent={jest.fn()}
        onEditBlock={jest.fn()}
        onToggleTask={jest.fn()}
        onAddBlock={jest.fn()}
        getCategoryColor={() => '#8B5CF6'}
      />,
    );
  });
  return tree;
};

/** The positioned frame around the item with this accessibility label. */
const frameOf = (tree: ReactTestRenderer.ReactTestRenderer, label: string) => {
  const button = tree.root.find(
    (node) => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith(label) && typeof node.props.onPress === 'function',
  );
  let node = button.parent;
  while (node && StyleSheet.flatten(node.props.style)?.position !== 'absolute') node = node.parent;
  return StyleSheet.flatten(node!.props.style);
};

describe('day view', () => {
  it('draws each item from its start to its end on the hour scale', () => {
    const tree = render();
    expect(frameOf(tree, 'GYM (TBA)')).toMatchObject({ top: 8 * HOUR_HEIGHT, height: 2 * HOUR_HEIGHT });
    expect(frameOf(tree, 'Study Block')).toMatchObject({ top: 10 * HOUR_HEIGHT, height: HOUR_HEIGHT });
    act(() => tree.unmount());
  });

  it('sets an item that overlaps another beside it, not on top of it', () => {
    const tree = render();
    // The 9:00 quiz overlaps GYM (8–10), so each takes half the width.
    expect(frameOf(tree, 'GYM (TBA)')).toMatchObject({ left: '0%', width: '50%' });
    expect(frameOf(tree, 'Quiz')).toMatchObject({ left: '50%', width: '50%', top: 9 * HOUR_HEIGHT });
    // The study block touches GYM's end and has the row to itself.
    expect(frameOf(tree, 'Study Block')).toMatchObject({ left: '0%', width: '100%' });
    act(() => tree.unmount());
  });

  it('tints items with their colour over the card, as the desktop does in dark mode', () => {
    const tree = render();
    const card = tree.root.find(
      (node) => StyleSheet.flatten(node.props.style)?.borderLeftColor === '#E6003A' && StyleSheet.flatten(node.props.style)?.borderLeftWidth === 3,
    );
    expect(StyleSheet.flatten(card.props.style).backgroundColor).toBe('#4f1525');
    act(() => tree.unmount());
  });
});
