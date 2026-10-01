import { useState, useEffect, useCallback } from 'react';
import { ViewMode, CalendarData, FeedItem } from '../types';
import type { TimeBlock, Task, Event } from '../../../../storage';
import { timeBlocksStore, tasksStore, userStore, db } from '../../../../storage';
import { Colors } from '../../../theme';

import { importedBatchesStore, ImportBatch } from '../../../../storage/importedBatchesStore';
import { calendarVisibilityStore } from '../../../../storage/calendarVisibilityStore';
import { getOccurrences } from '../../../../storage/rruleHelper';
import { generateIcsString, parseIcsString } from '../../../../storage/icsHelper';
import { pick, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { generateId } from '../../../../utils';
import { formatStoredDate } from '../../../../utils/dateFormat';
import { Alert } from 'react-native';

interface UseCalendarDataOptions {
  userId: string;
  refreshTrigger: number;
  onRefresh: () => void;
  propViewMode?: ViewMode;
  propOnViewModeChange?: (mode: ViewMode) => void;
}

export const useCalendarData = (options: UseCalendarDataOptions): CalendarData & {
  getOverdueTasks: () => Task[];
  getChronologicalFeed: () => FeedItem[];
} => {
  const { userId, refreshTrigger, onRefresh, propViewMode, propOnViewModeChange } = options;

  const [localViewMode, setLocalViewMode] = useState<ViewMode>('week');
  const viewMode = propViewMode !== undefined ? propViewMode : localViewMode;
  const setViewMode = propOnViewModeChange !== undefined ? propOnViewModeChange : setLocalViewMode;
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [weekDays, setWeekDays] = useState<Date[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [timeFormat24h, setTimeFormat24h] = useState(false);
  const [weekStartsMonday, setWeekStartsMonday] = useState(false);

  // Visibility and imports state
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [visibilityMap, setVisibilityMap] = useState<Record<string, boolean>>({ main: true });
  const [username, setUsername] = useState('Main Calendar');
  const [layersModalVisible, setLayersModalVisible] = useState(false);

  const generateWeekDays = useCallback(() => {
    const days: Date[] = [];
    const base = new Date(selectedDate);
    for (let i = -3; i <= 3; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      days.push(d);
    }
    setWeekDays(days);
  }, [selectedDate]);

  const loadSettings = useCallback(() => {
    const is24h = userStore.get24HourFormat(userId);
    setTimeFormat24h(is24h);
    const mondayStart = userStore.getWeekStartsMonday(userId);
    setWeekStartsMonday(mondayStart);
  }, [userId]);

  const loadImportsAndVisibility = useCallback(async () => {
    try {
      const fetchedBatches = await importedBatchesStore.getImportedBatches();
      const fetchedVisibility = await calendarVisibilityStore.getVisibilityMap();
      setBatches(fetchedBatches);
      setVisibilityMap(fetchedVisibility);
      const user = userStore.getUserById(userId);
      if (user) {
        setUsername(user.username);
      }
    } catch (error) {
      console.error('Failed to load visibility or batches:', error);
    }
  }, [userId]);

  const getViewRange = useCallback((): { start: Date; end: Date } => {
    if (viewMode === 'day') {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    } else if (viewMode === 'week') {
      const start = new Date(selectedDate);
      start.setDate(selectedDate.getDate() - 3);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setDate(selectedDate.getDate() + 3);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    } else {
      const start = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 15);
      start.setHours(0, 0, 0, 0);
      const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 15);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }, [viewMode, selectedDate, currentDate]);

  const loadBlocks = useCallback(() => {
    let rawData = timeBlocksStore.getAll(userId);

    const importedBlockIds = new Set<string>();
    const hiddenBlockIds = new Set<string>();
    const hideMain = visibilityMap.main === false;

    batches.forEach((batch) => {
      const isVisible = visibilityMap[batch.id] !== false;
      batch.blocks.forEach((id) => {
        importedBlockIds.add(id);
        if (!isVisible) {
          hiddenBlockIds.add(id);
        }
      });
    });

    rawData = rawData.filter((block) => {
      const isImported = importedBlockIds.has(block.id);
      if (isImported) {
        return !hiddenBlockIds.has(block.id);
      } else {
        return !hideMain;
      }
    });

    // Expand recurrence
    const expandedBlocks: TimeBlock[] = [];
    const { start: rangeStart, end: rangeEnd } = getViewRange();

    rawData.forEach((block) => {
      if (block.recurrenceRule) {
        const dates = getOccurrences(block.date, block.recurrenceRule, rangeStart, rangeEnd);
        dates.forEach((dateStr) => {
          const isBase = dateStr === block.date;
          expandedBlocks.push({
            ...block,
            id: isBase ? block.id : `${block.id}_occur_${dateStr}`,
            date: dateStr,
          });
        });
      } else {
        expandedBlocks.push(block);
      }
    });

    setBlocks(expandedBlocks);
  }, [userId, batches, visibilityMap, getViewRange]);

  const loadScheduleData = useCallback(() => {
    let rawTasks = tasksStore.getAllTasks(userId);
    let rawEvents = tasksStore.getAllEvents(userId);

    const importedTaskIds = new Set<string>();
    const hiddenTaskIds = new Set<string>();
    const importedEventIds = new Set<string>();
    const hiddenEventIds = new Set<string>();
    const hideMain = visibilityMap.main === false;

    batches.forEach((batch) => {
      const isVisible = visibilityMap[batch.id] !== false;
      batch.tasks.forEach((id) => {
        importedTaskIds.add(id);
        if (!isVisible) {
          hiddenTaskIds.add(id);
        }
      });
      batch.events.forEach((id) => {
        importedEventIds.add(id);
        if (!isVisible) {
          hiddenEventIds.add(id);
        }
      });
    });

    rawTasks = rawTasks.filter((t) => {
      const isImported = importedTaskIds.has(t.id);
      if (isImported) {
        return !hiddenTaskIds.has(t.id);
      } else {
        return !hideMain;
      }
    });

    rawEvents = rawEvents.filter((e) => {
      const isImported = importedEventIds.has(e.id);
      if (isImported) {
        return !hiddenEventIds.has(e.id);
      } else {
        return !hideMain;
      }
    });

    // Expand recurrence
    const expandedTasks: Task[] = [];
    const expandedEvents: Event[] = [];
    const { start: rangeStart, end: rangeEnd } = getViewRange();

    rawTasks.forEach((t) => {
      if (t.recurrenceRule && t.dueDate) {
        const dates = getOccurrences(t.dueDate, t.recurrenceRule, rangeStart, rangeEnd);
        dates.forEach((dateStr) => {
          const isBase = dateStr === t.dueDate;
          expandedTasks.push({
            ...t,
            id: isBase ? t.id : `${t.id}_occur_${dateStr}`,
            dueDate: dateStr,
          });
        });
      } else {
        expandedTasks.push(t);
      }
    });

    rawEvents.forEach((e) => {
      if (e.recurrenceRule && e.date) {
        const dates = getOccurrences(e.date, e.recurrenceRule, rangeStart, rangeEnd);
        dates.forEach((dateStr) => {
          const isBase = dateStr === e.date;
          expandedEvents.push({
            ...e,
            id: isBase ? e.id : `${e.id}_occur_${dateStr}`,
            date: dateStr,
          });
        });
      } else {
        expandedEvents.push(e);
      }
    });

    setAllTasks(expandedTasks);
    setAllEvents(expandedEvents);

    const formatLocalDate = (d: Date): string => {
      const year = d.getFullYear();
      const month = `${d.getMonth() + 1}`.padStart(2, '0');
      const day = `${d.getDate()}`.padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const dateStr = formatLocalDate(selectedDate);
    const dayTasks = expandedTasks.filter((t) => t.dueDate === dateStr);
    const dayEvents = expandedEvents.filter((e) => e.date === dateStr);

    setTasks(dayTasks);
    setEvents(dayEvents);
  }, [userId, batches, visibilityMap, selectedDate, getViewRange]);

  useEffect(() => {
    loadBlocks();
    loadScheduleData();
    generateWeekDays();
  }, [userId, selectedDate, refreshTrigger, loadBlocks, loadScheduleData, generateWeekDays]);

  useEffect(() => {
    loadSettings();
  }, [userId, refreshTrigger, loadSettings]);

  useEffect(() => {
    loadImportsAndVisibility();
  }, [userId, refreshTrigger, loadImportsAndVisibility]);

  const handleToggleVisibility = useCallback(async (calendarId: string, isVisible: boolean) => {
    try {
      await calendarVisibilityStore.setVisibility(calendarId, isVisible);
      const updatedMap = await calendarVisibilityStore.getVisibilityMap();
      setVisibilityMap(updatedMap);
    } catch (error) {
      console.error('Failed to toggle visibility:', error);
    }
  }, []);

  const handleImportCalendar = useCallback(async () => {
    try {
      const res = await pick({
        type: ['text/calendar', 'application/octet-stream'],
      });

      if (!res || res.length === 0 || !res[0].uri) return;

      const fileUri = res[0].uri;
      const fileName = res[0].name || 'imported_calendar.ics';
      const content = await RNFS.readFile(fileUri, 'utf8');

      const { events: parsedEvents, blocks: parsedBlocks, tasks: parsedTasks } = parseIcsString(content);
      const totalCount = parsedEvents.length + parsedBlocks.length + parsedTasks.length;

      if (totalCount === 0) {
        Alert.alert('Import Calendar', 'No valid calendar events, tasks, or time blocks found in the selected file.');
        return;
      }

      Alert.alert(
        'Import Calendar',
        `Found ${parsedEvents.length} events, ${parsedBlocks.length} time blocks, and ${parsedTasks.length} tasks. Do you want to import them?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Import',
            onPress: async () => {
              try {
                const eventIds: string[] = [];
                const blockIds: string[] = [];
                const taskIds: string[] = [];

                const now = new Date().toISOString();
                await db.transaction(async (tx) => {
                  parsedEvents.forEach((item) => {
                    const id = generateId('event');
                    tx.executeSync(
                      `INSERT INTO events (id, user_id, title, date, start_time, end_time, location, linked_calendar_block, recurrence_rule, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                      [
                        id,
                        userId,
                        item.title,
                        item.date,
                        item.startTime,
                        item.endTime,
                        item.location || null,
                        null,
                        item.recurrenceRule || null,
                        now,
                        now,
                      ]
                    );
                    eventIds.push(id);
                  });

                  parsedBlocks.forEach((item) => {
                    const id = generateId('block');
                    tx.executeSync(
                      `INSERT INTO time_blocks (id, user_id, title, date, start_time, end_time, color, category, notes, recurrence_rule, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                      [
                        id,
                        userId,
                        item.title,
                        item.date,
                        item.startTime,
                        item.endTime,
                        item.color || Colors.blue,
                        item.category || 'Imported',
                        item.notes || null,
                        item.recurrenceRule || null,
                        now,
                        now,
                      ]
                    );
                    blockIds.push(id);
                  });

                  parsedTasks.forEach((item) => {
                    const id = generateId('task');
                    tx.executeSync(
                      `INSERT INTO tasks (id, user_id, title, due_date, due_time, is_completed, priority, category, notes, recurrence_rule, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                      [
                        id,
                        userId,
                        item.title,
                        item.dueDate || null,
                        item.dueTime || null,
                        0,
                        item.priority || 'Medium',
                        item.category || 'Imported',
                        item.notes || null,
                        item.recurrenceRule || null,
                        now,
                        now,
                      ]
                    );
                    taskIds.push(id);
                  });
                });

                await importedBatchesStore.saveImportedBatch(fileName, eventIds, blockIds, taskIds);

                Alert.alert('Success', `Successfully imported ${totalCount} items.`);
                loadImportsAndVisibility();
                onRefresh();
              } catch (err) {
                console.error('Failed to save imported items:', err);
                Alert.alert('Error', 'Failed to save imported calendar items.');
              }
            },
          },
        ]
      );
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        // User cancelled the picker, do nothing
      } else {
        console.error('Failed to import file:', err);
        Alert.alert('Error', 'Failed to read or parse the calendar file.');
      }
    }
  }, [userId, loadImportsAndVisibility, onRefresh]);

  const handleExportCalendar = useCallback(async () => {
    try {
      const allTasksData = tasksStore.getAllTasks(userId);
      const allEventsData = tasksStore.getAllEvents(userId);
      const allBlocksData = timeBlocksStore.getAll(userId);
      if (allTasksData.length === 0 && allEventsData.length === 0 && allBlocksData.length === 0) {
        Alert.alert('Export Calendar', 'Your calendar is empty. Nothing to export.');
        return;
      }
      const icsString = generateIcsString(allEventsData, allBlocksData, allTasksData);
      const tempPath = `${RNFS.TemporaryDirectoryPath}/lafina_calendar_export.ics`;
      await RNFS.writeFile(tempPath, icsString, 'utf8');
      await Share.open({
        url: `file://${tempPath}`,
        type: 'text/calendar',
        filename: 'lafina_calendar_export',
        title: 'Export LAFINA Calendar',
      });
      await RNFS.unlink(tempPath).catch((err: any) => console.warn('Clean temp file failed:', err));
    } catch (err) {
      if (err && (err as any).message && (err as any).message.includes('User did not share')) {
        return;
      }
      console.error('Failed to export calendar:', err);
      Alert.alert('Error', 'Failed to generate or share calendar file.');
    }
  }, [userId]);

  const confirmBatchRemoval = useCallback((batch: ImportBatch) => {
    const totalCount = batch.events.length + batch.blocks.length + batch.tasks.length;

    Alert.alert(
      'Confirm Removal',
      `Are you sure you want to delete all ${totalCount} items imported from "${batch.fileName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await db.transaction(async (tx) => {
                batch.events.forEach((id: string) => {
                  try {
                    tasksStore.deleteEvent(id, tx);
                  } catch (e) {
                    console.warn(`Failed to delete event ${id}:`, e);
                  }
                });

                batch.blocks.forEach((id: string) => {
                  try {
                    timeBlocksStore.delete(id, tx);
                  } catch (e) {
                    console.warn(`Failed to delete block ${id}:`, e);
                  }
                });

                batch.tasks.forEach((id: string) => {
                  try {
                    tasksStore.deleteTask(id, tx);
                  } catch (e) {
                    console.warn(`Failed to delete task ${id}:`, e);
                  }
                });
              });

              await importedBatchesStore.deleteImportedBatch(batch.id);

              loadImportsAndVisibility();
              onRefresh();
              Alert.alert('Success', `Successfully removed ${totalCount} items.`);
            } catch (err) {
              console.error('Failed to remove imported calendar batch:', err);
              Alert.alert('Error', 'Failed to remove calendar items.');
            }
          },
        },
      ]
    );
  }, [loadImportsAndVisibility, onRefresh]);

  const startRemoveFlow = useCallback(async () => {
    try {
      const fetchedBatches = await importedBatchesStore.getImportedBatches();
      if (fetchedBatches.length === 0) {
        Alert.alert('Remove Imported Calendar', 'No previously imported calendars were found.');
        return;
      }

      const buttons = fetchedBatches.map((batch) => {
        const dateFormatted = formatStoredDate(batch.timestamp, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        return {
          text: `${batch.fileName} (${dateFormatted})`,
          onPress: () => confirmBatchRemoval(batch),
        };
      });

      buttons.push({
        text: 'Cancel',
        style: 'cancel',
      } as any);

      Alert.alert(
        'Remove Imported Calendar',
        'Select the calendar import batch you wish to remove:',
        buttons
      );
    } catch (err) {
      console.error('Failed to load import batches:', err);
      Alert.alert('Error', 'Failed to load import history.');
    }
  }, [confirmBatchRemoval]);

  const navigateDay = useCallback((direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    if (direction === 'prev') {
      newDate.setDate(newDate.getDate() - 1);
    } else {
      newDate.setDate(newDate.getDate() + 1);
    }
    setSelectedDate(newDate);
    setCurrentDate(newDate);
  }, [selectedDate]);

  const navigateWeek = useCallback((direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    if (direction === 'prev') {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setDate(newDate.getDate() + 7);
    }
    setSelectedDate(newDate);
    setCurrentDate(newDate);
  }, [selectedDate]);

  const navigateMonth = useCallback((direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  }, [currentDate]);

  const handlePrevPress = useCallback(() => {
    if (viewMode === 'day') navigateDay('prev');
    else if (viewMode === 'week') navigateWeek('prev');
    else navigateMonth('prev');
  }, [viewMode, navigateDay, navigateWeek, navigateMonth]);

  const handleNextPress = useCallback(() => {
    if (viewMode === 'day') navigateDay('next');
    else if (viewMode === 'week') navigateWeek('next');
    else navigateMonth('next');
  }, [viewMode, navigateDay, navigateWeek, navigateMonth]);

  const handleGoToToday = useCallback(() => {
    const today = new Date();
    setSelectedDate(today);
    setCurrentDate(today);
  }, []);

  const handleDayTap = useCallback((dayNum: number) => {
    const targetDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayNum);
    setSelectedDate(targetDate);
    setViewMode('day');
  }, [currentDate, setViewMode]);

  const formatLocalDate = (d: Date): string => {
    const year = d.getFullYear();
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getOverdueTasks = useCallback(() => {
    const tasksData = tasksStore.getAllTasks(userId);
    const todayStr = formatLocalDate(new Date());
    return tasksData.filter((t) => t.dueDate && t.dueDate < todayStr && !t.isCompleted);
  }, [userId]);

  const getChronologicalFeed = useCallback((): FeedItem[] => {
    const feed: FeedItem[] = [];
    const dateStr = formatLocalDate(selectedDate);
    const dayBlocks = blocks.filter((b) => b.date === dateStr);

    tasks.forEach((t) => {
      feed.push({
        type: 'task', id: t.id, title: t.title,
        time: t.dueTime || 'All Day', item: t,
      });
    });
    events.forEach((e) => {
      feed.push({
        type: 'event', id: e.id, title: e.title,
        time: e.startTime, endTime: e.endTime, item: e,
      });
    });
    dayBlocks.forEach((b) => {
      feed.push({
        type: 'block', id: b.id, title: b.title,
        time: b.startTime, endTime: b.endTime, item: b,
      });
    });

    return feed.sort((a, b) => a.time.localeCompare(b.time));
  }, [selectedDate, blocks, tasks, events]);

  return {
    currentDate,
    selectedDate,
    viewMode,
    blocks,
    weekDays,
    tasks,
    events,
    allTasks,
    allEvents,
    timeFormat24h,
    weekStartsMonday,
    showDatePicker,
    setViewMode,
    setSelectedDate,
    setCurrentDate,
    setShowDatePicker,
    handlePrevPress,
    handleNextPress,
    handleGoToToday,
    handleDayTap,
    loadBlocks,
    loadScheduleData,
    getOverdueTasks,
    getChronologicalFeed,

    // Visibility and Import/Export
    batches,
    visibilityMap,
    username,
    layersModalVisible,
    setLayersModalVisible,
    handleToggleVisibility,
    handleImportCalendar,
    handleExportCalendar,
    startRemoveFlow,
    handleRemoveBatch: confirmBatchRemoval,
  };
};
