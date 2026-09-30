import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Plus, ChevronLeft, ChevronRight, ChevronDown, Upload, Download, Layers, Clock, CheckSquare, FileText } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Colors, Shadows } from '../../theme';
import { getCategoryColor, registerCustomCategoryColor } from '../../theme/categoryColors';
import { useCalendarData } from './hooks/useCalendarData';
import { useTimeBlockModal } from './hooks/useTimeBlockModal';
import { useScheduleItemModal } from './hooks/useScheduleItemModal';
import { WeekView, MonthView, AddBlockModal, AddTaskEventModal } from './components';
import { NoteEditor } from '../notes/components/NoteEditor';
import { getHeaderTitle } from './utils/calendarHelpers';
import { CalendarScreenProps, ViewMode } from './types';
import { tasksStore, notesStore } from '../../../storage';
import type { Task } from '../../../storage';
import {
  applyNoteFormat,
  continueListOnNewline,
  generateId,
  toggleChecklistItem,
} from '../../../utils';
import { CalendarLayersModal } from '../../components/calendar/CalendarLayersModal';

/** Renders the offline calendar workspace and its local scheduling actions. */
export const CalendarScreen: React.FC<CalendarScreenProps> = ({
  userId,
  refreshTrigger,
  onRefresh,
  viewMode: propViewMode,
  onViewModeChange: propOnViewModeChange,
}) => {
  const { colors } = useTheme();

  const [fabMenuVisible, setFabMenuVisible] = useState(false);
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteCategory, setNoteCategory] = useState('Personal');
  const [isPinned, setIsPinned] = useState(false);
  const [noteSelection, setNoteSelection] = useState({ start: 0, end: 0 });
  const [customCategories, setCustomCategories] = useState<string[]>([]);

  React.useEffect(() => {
    try {
      const cats = notesStore.getCustomCategories(userId);
      cats.forEach((c) => {
        registerCustomCategoryColor(c.name, c.color);
      });
      setCustomCategories(cats.map((c) => c.name));
    } catch (e) {
      console.error(e);
    }
  }, [userId, noteModalVisible]);

  const handleAddCategory = (name: string, color: string) => {
    if (!name.trim()) return;
    const normalizedName = name.trim();
    const standard = ['Work', 'Personal', 'Health', 'Learning'];
    if (standard.includes(normalizedName) || customCategories.includes(normalizedName)) {
      return;
    }
    notesStore.addCustomCategory(userId, normalizedName, color);
    registerCustomCategoryColor(normalizedName, color);
    setCustomCategories([...customCategories, normalizedName]);
  };

  const handleDeleteCategory = (name: string) => {
    notesStore.deleteCustomCategory(userId, name);
    const cats = notesStore.getCustomCategories(userId);
    setCustomCategories(cats.map(c => c.name));
  };

  const handleUpdateCategory = (oldName: string, newName: string, color: string) => {
    if (!newName.trim()) return;
    const normalizedName = newName.trim();
    const standard = ['Work', 'Personal', 'Health', 'Learning'];
    if (normalizedName !== oldName && (standard.includes(normalizedName) || customCategories.includes(normalizedName))) {
      return;
    }
    notesStore.updateCustomCategory(userId, oldName, normalizedName, color);
    registerCustomCategoryColor(normalizedName, color);
    const cats = notesStore.getCustomCategories(userId);
    setCustomCategories(cats.map(c => c.name));
    if (noteCategory === oldName) {
      setNoteCategory(normalizedName);
    }
  };

  const calendar = useCalendarData({
    userId,
    refreshTrigger,
    onRefresh,
    propViewMode,
    propOnViewModeChange,
  });

  const blockModal = useTimeBlockModal({
    userId,
    selectedDate: calendar.selectedDate,
    onSaved: calendar.loadBlocks,
    onRefresh,
  });

  const scheduleModal = useScheduleItemModal({
    userId,
    selectedDate: calendar.selectedDate,
    onSaved: calendar.loadScheduleData,
    onRefresh,
  });

  const handleFABPress = () => {
    setFabMenuVisible(true);
  };

  const handleSaveNote = () => {
    if (!noteTitle.trim() && !noteBody.trim()) {
      setNoteModalVisible(false);
      return;
    }
    notesStore.insert({
      id: generateId('note'),
      userId,
      title: noteTitle.trim() || 'Untitled Note',
      body: noteBody,
      category: noteCategory,
      isPinned: isPinned,
      tags: [],
      isVoiceTranscribed: false,
      imageUri: null,
    });
    setNoteTitle('');
    setNoteBody('');
    setNoteCategory('Personal');
    setIsPinned(false);
    setNoteModalVisible(false);
    onRefresh();
  };

  const toggleTaskCompletion = (task: Task) => {
    tasksStore.updateTask({ id: task.id, isCompleted: !task.isCompleted });
    calendar.loadScheduleData();
    onRefresh();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Shared date header for the month and week views. */}
        <View style={styles.topHeaderRow}>
          <TouchableOpacity
            onPress={() => calendar.setShowDatePicker(true)}
            style={styles.headerTitleContainer}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Choose calendar date"
            accessibilityHint="Opens the date picker"
          >
            <Text
              style={[styles.headerTitle, { color: colors.textPrimary }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {getHeaderTitle(calendar.viewMode, calendar.selectedDate, calendar.currentDate, calendar.weekDays)}
            </Text>
            <ChevronDown size={18} color={colors.textSecondary} style={styles.titleChevron} />
          </TouchableOpacity>

          <View style={styles.navGroup}>
            <TouchableOpacity
              onPress={calendar.handlePrevPress}
              style={[styles.navButton, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Previous ${calendar.viewMode}`}
            >
              <ChevronLeft size={16} color={colors.textPrimary} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={calendar.handleGoToToday}
              style={[styles.todayButton, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Go to today"
            >
              <Text style={[styles.todayButtonText, { color: colors.textPrimary }]}>Today</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={calendar.handleNextPress}
              style={[styles.navButton, { backgroundColor: colors.inputBg, borderColor: colors.border }]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Next ${calendar.viewMode}`}
            >
              <ChevronRight size={16} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

      {calendar.showDatePicker && (
        <DateTimePicker
          value={calendar.viewMode === 'month' ? calendar.currentDate : calendar.selectedDate}
          mode="date"
          display="default"
          onChange={(_event, date) => {
            calendar.setShowDatePicker(false);
            if (date) {
              calendar.setSelectedDate(date);
              calendar.setCurrentDate(date);
            }
          }}
        />
      )}

      {/* View mode and clearly labeled local calendar actions. */}
      <View style={styles.subHeaderContainer}>
        <View style={[styles.toggleRow, { backgroundColor: colors.divider }]}>
          {(['month', 'week'] as ViewMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[
                styles.toggleBtn,
                { backgroundColor: 'transparent' },
                calendar.viewMode === mode && { backgroundColor: colors.cardBg, ...Shadows.card },
              ]}
              onPress={() => calendar.setViewMode(mode)}
              accessibilityRole="button"
              accessibilityLabel={`${mode.charAt(0).toUpperCase() + mode.slice(1)} view`}
              accessibilityState={{ selected: calendar.viewMode === mode }}
            >
              <Text style={[
                styles.toggleText,
                { color: colors.textSecondary },
                calendar.viewMode === mode && { color: colors.textPrimary, fontWeight: 'bold' },
              ]}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.actionButtonsRow}>
          <TouchableOpacity
            onPress={calendar.handleImportCalendar}
            onLongPress={calendar.startRemoveFlow}
            style={[styles.actionButton, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Import calendar"
            accessibilityHint="Imports a calendar file. Press and hold to remove an imported calendar."
          >
            <Upload size={16} color={colors.textPrimary} />
            <Text style={[styles.actionButtonText, { color: colors.textPrimary }]}>Import</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={calendar.handleExportCalendar}
            style={[styles.actionButton, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Export calendar"
            accessibilityHint="Exports the visible local calendar"
          >
            <Download size={16} color={colors.textPrimary} />
            <Text style={[styles.actionButtonText, { color: colors.textPrimary }]}>Export</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => calendar.setLayersModalVisible(true)}
            style={[styles.actionButton, { borderColor: colors.border, backgroundColor: colors.inputBg }]}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Manage calendars"
            accessibilityHint="Shows calendar visibility and imported calendars"
          >
            <Layers size={16} color={colors.textPrimary} />
            <Text style={[styles.actionButtonText, { color: colors.textPrimary }]}>Calendars</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {calendar.viewMode === 'month' && (
          <MonthView
            currentDate={calendar.currentDate}
            selectedDate={calendar.selectedDate}
            weekStartsMonday={calendar.weekStartsMonday}
            viewMode={calendar.viewMode}
            blocks={calendar.blocks}
            allTasks={calendar.allTasks}
            allEvents={calendar.allEvents}
            onDayTap={calendar.handleDayTap}
            getCategoryColor={getCategoryColor}
            onSwipeLeft={calendar.handleNextPress}
            onSwipeRight={calendar.handlePrevPress}
          />
        )}
        {calendar.viewMode === 'week' && (
          <WeekView
            calendar={calendar}
            selectedDate={calendar.selectedDate}
            setSelectedDate={calendar.setSelectedDate}
            weekDays={calendar.weekDays}
            timeFormat24h={calendar.timeFormat24h}
            onEditTask={(task) => scheduleModal.openEdit(task, 'task')}
            onEditEvent={(event) => scheduleModal.openEdit(event, 'event')}
            onEditBlock={(block) => blockModal.openEditBlock(block)}
            onToggleTask={toggleTaskCompletion}
            onAddBlock={blockModal.openNewBlock}
            getCategoryColor={getCategoryColor}
          />
        )}
      </View>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, Shadows.card]}
        onPress={handleFABPress}
      >
        <Plus size={24} color={colors.white} />
      </TouchableOpacity>

      {/* Modals */}
      <AddBlockModal state={blockModal} timeFormat24h={calendar.timeFormat24h} />
      <AddTaskEventModal state={scheduleModal} timeFormat24h={calendar.timeFormat24h} />
      
      <CalendarLayersModal
        visible={calendar.layersModalVisible}
        onClose={() => calendar.setLayersModalVisible(false)}
        username={calendar.username}
        batches={calendar.batches}
        visibilityMap={calendar.visibilityMap}
        onToggleVisibility={calendar.handleToggleVisibility}
        onRemoveBatch={calendar.handleRemoveBatch}
      />

      {/* FAB Choice Overlay Menu */}
      <Modal
        visible={fabMenuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setFabMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setFabMenuVisible(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.cardBg, borderColor: colors.border, borderWidth: 1.5 }]}>
            <Text style={[styles.modalHeaderTitle, { color: colors.textPrimary, textAlign: 'center' }]}>Create New</Text>
            
            <TouchableOpacity
              style={[styles.fabMenuItem, { borderBottomColor: colors.divider }]}
              onPress={() => {
                setFabMenuVisible(false);
                blockModal.openNewBlock();
              }}
            >
              <Clock size={20} color={colors.blue} style={styles.fabMenuItemIcon} />
              <Text style={[styles.fabMenuItemText, { color: colors.textPrimary }]}>Time Block</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.fabMenuItem, { borderBottomColor: colors.divider }]}
              onPress={() => {
                setFabMenuVisible(false);
                scheduleModal.openNew('task');
              }}
            >
              <CheckSquare size={20} color={colors.red} style={styles.fabMenuItemIcon} />
              <Text style={[styles.fabMenuItemText, { color: colors.textPrimary }]}>Task</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.fabMenuItem, { borderBottomColor: colors.divider }]}
              onPress={() => {
                setFabMenuVisible(false);
                setNoteTitle('');
                setNoteBody('');
                setNoteCategory('Personal');
                setIsPinned(false);
                setNoteSelection({ start: 0, end: 0 });
                setNoteModalVisible(true);
              }}
            >
              <FileText size={20} color={colors.textSecondary} style={styles.fabMenuItemIcon} />
              <Text style={[styles.fabMenuItemText, { color: colors.textPrimary }]}>Note</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalBtn, { backgroundColor: colors.divider, marginTop: 16, alignSelf: 'stretch', alignItems: 'center' }]}
              onPress={() => setFabMenuVisible(false)}
            >
              <Text style={[styles.modalBtnTextDark, { color: colors.textPrimary, fontWeight: 'bold' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Full Note Editor Modal matching NotesScreen */}
      <NoteEditor
        visible={noteModalVisible}
        editingNote={null}
        noteTitle={noteTitle}
        noteBody={noteBody}
        noteCategory={noteCategory}
        noteTags={[]}
        isPinned={isPinned}
        imageUri={null}
        selection={noteSelection}
        aiLoading={false}
        aiActionType=""
        onTitleChange={setNoteTitle}
        onBodyChange={(next) => {
          const carried = continueListOnNewline(noteBody, next);
          setNoteBody(carried ? carried.body : next);
          if (carried) setNoteSelection(carried.selection);
        }}
        onCategoryChange={setNoteCategory}
        onPinToggle={() => setIsPinned(p => !p)}
        onImageUriChange={() => {}}
        onSelectionChange={setNoteSelection}
        onClose={() => setNoteModalVisible(false)}
        onSave={handleSaveNote}
        onDelete={() => {}}
        onFormatting={(type) => {
          const edit = applyNoteFormat(noteBody, noteSelection, type);
          setNoteBody(edit.body);
          setNoteSelection(edit.selection);
        }}
        onToggleChecklist={(index) => setNoteBody(toggleChecklistItem(noteBody, index))}
        onAttachImage={() => {}}
        onRemoveImage={() => {}}
        onAiAction={() => {}}
        customCategories={customCategories}
        onAddCategory={handleAddCategory}
        onDeleteCategory={handleDeleteCategory}
        onUpdateCategory={handleUpdateCategory}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 100, // Account for floating bottom tab bar
  },
  topHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  headerTitle: {
    fontFamily: 'sans-serif-medium',
    fontSize: 22,
    fontWeight: 'bold',
    flexShrink: 1,
  },
  titleChevron: {
    marginLeft: 4,
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navButton: {
    padding: 7,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginHorizontal: 6,
  },
  todayButtonText: {
    fontSize: 12,
    fontFamily: 'sans-serif',
    fontWeight: '600',
  },
  subHeaderContainer: {
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 2,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 6,
  },
  toggleText: {
    fontFamily: 'sans-serif',
    fontSize: 13,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginHorizontal: -4,
  },
  actionButton: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    paddingHorizontal: 8,
    marginHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    marginLeft: 6,
    fontFamily: 'sans-serif-medium',
    fontSize: 11,
    fontWeight: '600',
  },
  body: {
    flex: 1,
  },
  fab: {
    position: 'absolute',
    bottom: 96,
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 16,
    padding: 24,
    width: '90%',
  },
  modalHeaderTitle: {
    fontFamily: 'sans-serif-medium',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  textArea: {
    height: 120,
    textAlignVertical: 'top',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginLeft: 8,
  },
  saveBtn: {
    backgroundColor: Colors.red,
  },
  cancelBtn: {},
  modalBtnText: {
    color: Colors.textLight,
    fontWeight: 'bold',
    fontSize: 14,
  },
  modalBtnTextDark: {
    fontSize: 14,
  },
  fabMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  fabMenuItemIcon: {
    marginRight: 16,
  },
  fabMenuItemText: {
    fontSize: 15,
    fontFamily: 'sans-serif-medium',
  },
});
