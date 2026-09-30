import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { CalendarScreen } from '../../src/ui/screens/calendar/CalendarScreen';
import { MonthView } from '../../src/ui/screens/calendar/components/MonthView';
import { useCalendarData } from '../../src/ui/screens/calendar/hooks/useCalendarData';
import { useScheduleItemModal } from '../../src/ui/screens/calendar/hooks/useScheduleItemModal';
import { useTimeBlockModal } from '../../src/ui/screens/calendar/hooks/useTimeBlockModal';
import type {
  ScheduleItemModalState,
  TimeBlockModalState,
} from '../../src/ui/screens/calendar/types';
import type { Task } from '../../src/storage';

jest.mock('@react-native-community/datetimepicker', () => () => null);

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

jest.mock('../../src/ui/screens/calendar/hooks/useCalendarData', () => ({
  useCalendarData: jest.fn(),
}));

jest.mock('../../src/ui/screens/calendar/hooks/useTimeBlockModal', () => ({
  useTimeBlockModal: jest.fn(),
}));

jest.mock('../../src/ui/screens/calendar/hooks/useScheduleItemModal', () => ({
  useScheduleItemModal: jest.fn(),
}));

jest.mock('../../src/ui/screens/calendar/components', () => ({
  WeekView: () => null,
  MonthView: () => null,
  DayView: () => null,
  AddBlockModal: () => null,
  AddTaskEventModal: () => null,
}));

jest.mock('../../src/ui/components/calendar/CalendarLayersModal', () => ({
  CalendarLayersModal: () => null,
}));

jest.mock('../../src/ui/screens/notes/components/NoteEditor', () => ({
  NoteEditor: () => null,
}));

const mockedUseCalendarData = useCalendarData as jest.MockedFunction<typeof useCalendarData>;
const mockedUseTimeBlockModal = useTimeBlockModal as jest.MockedFunction<typeof useTimeBlockModal>;
const mockedUseScheduleItemModal = useScheduleItemModal as jest.MockedFunction<typeof useScheduleItemModal>;

const createCalendarData = (): ReturnType<typeof useCalendarData> => ({
  currentDate: new Date(2026, 6, 15),
  selectedDate: new Date(2026, 6, 15),
  viewMode: 'month',
  blocks: [],
  weekDays: [],
  tasks: [],
  events: [],
  allTasks: [],
  allEvents: [],
  timeFormat24h: false,
  weekStartsMonday: false,
  showDatePicker: false,
  setViewMode: jest.fn(),
  setSelectedDate: jest.fn(),
  setCurrentDate: jest.fn(),
  setShowDatePicker: jest.fn(),
  handlePrevPress: jest.fn(),
  handleNextPress: jest.fn(),
  handleGoToToday: jest.fn(),
  handleDayTap: jest.fn(),
  loadBlocks: jest.fn(),
  loadScheduleData: jest.fn(),
  getOverdueTasks: jest.fn(() => []),
  batches: [],
  visibilityMap: {},
  username: 'Student',
  layersModalVisible: false,
  setLayersModalVisible: jest.fn(),
  handleToggleVisibility: jest.fn(async () => undefined),
  handleImportCalendar: jest.fn(async () => undefined),
  handleExportCalendar: jest.fn(async () => undefined),
  startRemoveFlow: jest.fn(async () => undefined),
  handleRemoveBatch: jest.fn(),
});

const createTimeBlockModal = (): TimeBlockModalState => ({
  visible: false,
  editingBlock: null,
  form: {
    title: '',
    startTime: '09:00',
    endTime: '10:00',
    category: 'Work',
    color: '#E6003A',
    notes: '',
  },
  showStartPicker: false,
  showEndPicker: false,
  openNewBlock: jest.fn(),
  openEditBlock: jest.fn(),
  close: jest.fn(),
  updateField: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  setShowStartPicker: jest.fn(),
  setShowEndPicker: jest.fn(),
});

const createScheduleModal = (): ScheduleItemModalState => ({
  visible: false,
  modalType: 'task',
  editingItem: null,
  form: {
    title: '',
    time: '09:00',
    endTime: '10:00',
    priority: 'Medium',
    category: 'Work',
    location: '',
    notes: '',
  },
  showTimePicker: false,
  showEndTimePicker: false,
  openNew: jest.fn(),
  openEdit: jest.fn(),
  close: jest.fn(),
  updateField: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  setShowTimePicker: jest.fn(),
  setShowEndTimePicker: jest.fn(),
});

const getTextContent = (content: React.ReactNode): string => (
  React.Children.toArray(content).map(child => (
    typeof child === 'string' || typeof child === 'number' ? String(child) : ''
  )).join('')
);

const getRenderedText = (renderer: ReactTestRenderer.ReactTestRenderer): string[] => (
  renderer.root.findAllByType(Text).map(node => getTextContent(node.props.children))
);

describe('Calendar UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseCalendarData.mockReturnValue(createCalendarData());
    mockedUseTimeBlockModal.mockReturnValue(createTimeBlockModal());
    mockedUseScheduleItemModal.mockReturnValue(createScheduleModal());
  });

  it('uses one clear header and labeled calendar actions in month mode', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <CalendarScreen userId="user-1" refreshTrigger={0} onRefresh={jest.fn()} />,
      );
    });

    const text = getRenderedText(renderer);
    const accessibilityLabels = renderer.root.findAll(
      node => typeof node.props.accessibilityLabel === 'string',
    ).map(node => node.props.accessibilityLabel as string);

    expect(text).toEqual(expect.arrayContaining(['July 2026', 'Today', 'Import', 'Export', 'Calendars']));
    expect(text).not.toEqual(expect.arrayContaining(['PREV', 'NEXT']));
    expect(accessibilityLabels).toEqual(expect.arrayContaining([
      'Choose calendar date',
      'Previous month',
      'Go to today',
      'Next month',
      'Import calendar',
      'Export calendar',
      'Manage calendars',
    ]));

    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('offers Month and Week only, now that the day timeline lives inside Week', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <CalendarScreen userId="user-1" refreshTrigger={0} onRefresh={jest.fn()} />,
      );
    });

    const viewButtons = renderer.root
      .findAll(node => typeof node.props.accessibilityLabel === 'string' && / view$/.test(node.props.accessibilityLabel) && typeof node.props.onPress === 'function')
      .map(node => node.props.accessibilityLabel as string);

    expect([...new Set(viewButtons)]).toEqual(['Month view', 'Week view']);
    expect(getRenderedText(renderer)).not.toContain('Day');

    ReactTestRenderer.act(() => renderer.unmount());
  });

  it('renders readable, accessible month cells without decorative moon content', () => {
    const onDayTap = jest.fn();
    const task: Task = {
      id: 'task-1',
      userId: 'user-1',
      title: 'Submit capstone report',
      dueDate: '2026-07-15',
      dueTime: '09:00',
      isCompleted: false,
      priority: 'High',
      category: 'Work',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <MonthView
          currentDate={new Date(2026, 6, 15)}
          weekStartsMonday={false}
          viewMode="month"
          blocks={[]}
          allTasks={[task]}
          allEvents={[]}
          onDayTap={onDayTap}
          getCategoryColor={() => '#E6003A'}
        />,
      );
    });

    const text = getRenderedText(renderer);
    const dayButton = renderer.root.find(
      node => node.props.accessibilityLabel === 'July 15, 2026, 1 scheduled item',
    );

    expect(text).toContain('Submit capstone report');
    expect(text).not.toEqual(expect.arrayContaining(['NEW MOON', 'FIRST QUARTER', 'FULL MOON', 'LAST QUARTER']));
    expect(dayButton.props.accessibilityRole).toBe('button');

    ReactTestRenderer.act(() => {
      dayButton.props.onPress();
    });
    expect(onDayTap).toHaveBeenCalledWith(15);

    ReactTestRenderer.act(() => renderer.unmount());
  });
});
