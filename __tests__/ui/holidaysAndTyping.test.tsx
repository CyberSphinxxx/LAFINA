import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../../src/ui/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: false,
    toggleTheme: jest.fn(),
    colors: {
      background: '#FAF9F6',
      cardBg: '#FFFFFF',
      border: '#E5E5E5',
      textPrimary: '#1A1A1A',
      textSecondary: '#7A7A7A',
      textMuted: '#A0A0A0',
      red: '#F75A5A',
      blue: '#E6003A',
      success: '#2ECC71',
      white: '#FFFFFF',
      holiday: '#0B8043',
    },
  }),
}));

import { DayView } from '../../src/ui/screens/calendar/components/DayView';
import { getHolidaysOn, getPhilippineHolidays } from '../../src/ui/screens/calendar/utils/philippineHolidays';
import { TypingBubble } from '../../src/ui/components/chat/TypingBubble';

const renderDay = (date: Date, showHolidays?: boolean) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <DayView
        targetDate={date}
        blocks={[]}
        allTasks={[]}
        allEvents={[]}
        timeFormat24h={false}
        onEditTask={jest.fn()}
        onEditEvent={jest.fn()}
        onEditBlock={jest.fn()}
        onToggleTask={jest.fn()}
        onAddBlock={jest.fn()}
        getCategoryColor={() => '#8B5CF6'}
        showHolidays={showHolidays}
      />,
    );
  });
  return tree;
};

const chipsOf = (tree: ReactTestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => node.props.testID === 'holiday-chip' && typeof node.props.onPress === 'function', { deep: false })
    .map((chip) => chip.findByType(Text).props.children as string);

describe('Philippine holidays in the day timeline', () => {
  it('shows a holiday in the all-day row, above the hours', () => {
    const tree = renderDay(new Date(2026, 11, 25));
    expect(chipsOf(tree)).toEqual(['Christmas Day']);
    act(() => tree.unmount());
  });

  it('shows every holiday that falls on the day', () => {
    // Holy Week 2026: Good Friday is April 3.
    const tree = renderDay(new Date(2026, 3, 3));
    expect(chipsOf(tree)).toEqual(['Good Friday']);
    act(() => tree.unmount());
  });

  it('shows nothing on an ordinary day, or when the layer is hidden', () => {
    const ordinary = renderDay(new Date(2026, 8, 22));
    expect(chipsOf(ordinary)).toEqual([]);
    act(() => ordinary.unmount());

    const hidden = renderDay(new Date(2026, 11, 25), false);
    expect(chipsOf(hidden)).toEqual([]);
    act(() => hidden.unmount());
  });

  it('carries the same table as the desktop app', () => {
    expect(getHolidaysOn('2026-06-12').map((h) => h.name)).toEqual(['Independence Day']);
    expect(getHolidaysOn('2026-08-31').map((h) => h.name)).toEqual(['National Heroes Day']);
    expect(getPhilippineHolidays(2026).filter((h) => h.kind === 'regular').length).toBeGreaterThanOrEqual(12);
  });
});

describe('chat typing bubble', () => {
  it('shows dots in a bubble, with no "is replying" line', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<TypingBubble />);
    });
    const bubble = tree.root.findByProps({ testID: 'typing-bubble' });
    expect(bubble.props.accessibilityLabel).toBe('LAFINA is typing a reply');
    expect(tree.root.findAllByType(Text)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it('says what is happening when there is more to it than a reply', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<TypingBubble label="Creating your PDF…" />);
    });
    expect(tree.root.findByType(Text).props.children).toBe('Creating your PDF…');
    act(() => tree.unmount());
  });
});
