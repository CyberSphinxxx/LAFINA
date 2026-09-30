import type { Task, Event, TimeBlock } from '../../../storage';
import { ImportBatch } from '../../../storage/importedBatchesStore';

// ── View Modes ──
/** The week view shows the chosen day's timeline under its strip, so there is no separate day view. */
export type ViewMode = 'month' | 'week';

// ── CalendarScreen Props ──
export interface CalendarScreenProps {
  userId: string;
  refreshTrigger: number;
  onRefresh: () => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
}

// ── Modal State ──
export interface TimeBlockForm {
  title: string;
  startTime: string;
  endTime: string;
  category: string;
  color: string;
  notes: string;
  recurrenceRule?: string | null;
}

export interface ScheduleItemForm {
  title: string;
  time: string;
  endTime: string;
  priority: 'High' | 'Medium' | 'Low';
  category: string;
  location: string;
  notes: string;
  recurrenceRule?: string | null;
}

// ── Hook Return Types ──
export interface CalendarData {
  currentDate: Date;
  selectedDate: Date;
  viewMode: ViewMode;
  blocks: TimeBlock[];
  weekDays: Date[];
  tasks: Task[];
  events: Event[];
  allTasks: Task[];
  allEvents: Event[];
  timeFormat24h: boolean;
  weekStartsMonday: boolean;
  showDatePicker: boolean;
  setViewMode: (mode: ViewMode) => void;
  setSelectedDate: (date: Date) => void;
  setCurrentDate: (date: Date) => void;
  setShowDatePicker: (show: boolean) => void;
  handlePrevPress: () => void;
  handleNextPress: () => void;
  handleGoToToday: () => void;
  handleDayTap: (dayNum: number) => void;
  loadBlocks: () => void;
  loadScheduleData: () => void;
  
  // Visibility and Import/Export
  batches: ImportBatch[];
  visibilityMap: Record<string, boolean>;
  username: string;
  layersModalVisible: boolean;
  setLayersModalVisible: (visible: boolean) => void;
  handleToggleVisibility: (calendarId: string, isVisible: boolean) => Promise<void>;
  handleImportCalendar: () => Promise<void>;
  handleExportCalendar: () => Promise<void>;
  startRemoveFlow: () => Promise<void>;
  handleRemoveBatch: (batch: ImportBatch) => void;
}

export interface TimeBlockModalState {
  visible: boolean;
  editingBlock: TimeBlock | null;
  form: TimeBlockForm;
  showStartPicker: boolean;
  showEndPicker: boolean;
  openNewBlock: () => void;
  openEditBlock: (block: TimeBlock) => void;
  close: () => void;
  updateField: <K extends keyof TimeBlockForm>(key: K, value: TimeBlockForm[K]) => void;
  save: (recurrenceRule?: string | null) => void;
  delete: (id: string) => void;
  setShowStartPicker: (show: boolean) => void;
  setShowEndPicker: (show: boolean) => void;
}

export interface ScheduleItemModalState {
  visible: boolean;
  modalType: 'task' | 'event';
  editingItem: Task | Event | null;
  form: ScheduleItemForm;
  showTimePicker: boolean;
  showEndTimePicker: boolean;
  openNew: (type: 'task' | 'event') => void;
  openEdit: (item: Task | Event, type: 'task' | 'event') => void;
  close: () => void;
  updateField: <K extends keyof ScheduleItemForm>(key: K, value: ScheduleItemForm[K]) => void;
  save: (recurrenceRule?: string | null) => void;
  delete: (id: string, type: 'task' | 'event') => void;
  setShowTimePicker: (show: boolean) => void;
  setShowEndTimePicker: (show: boolean) => void;
}
