import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Alert, Animated, LayoutAnimation, UIManager } from 'react-native';
import type { Note } from '../../../../storage';
import { localSettingsStore, notesStore, tasksStore } from '../../../../storage';
import { FilterType } from '../types';
import {
  applyNoteFormat,
  continueListOnNewline,
  extractChecklistItems,
  generateId,
  isBodyEmpty,
  isHtmlBody,
  noteBodyToMarkdown,
  toggleChecklistItem,
} from '../../../../utils';
import type { NoteFormat } from '../../../../utils';
import { registerCustomCategoryColor } from '../../../theme/categoryColors';

// Enable LayoutAnimation on Android
if (UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Smooth spring-like LayoutAnimation preset for swap transitions */
const swapAnimation = {
  duration: 300,
  create: {
    type: LayoutAnimation.Types.spring,
    property: LayoutAnimation.Properties.scaleXY,
    springDamping: 0.7,
  },
  update: {
    type: LayoutAnimation.Types.spring,
    springDamping: 0.7,
  },
};

/** Where the chosen note filter is kept between visits to the screen. */
const NOTES_FILTER_KEY = 'notes.selectedFilter';
const DEFAULT_FILTER: FilterType = 'All';
/** Filters that are always offered, whatever categories the account has. */
const BUILT_IN_FILTERS: readonly FilterType[] = [
  'All',
  'AI Transcribed',
  'Pinned',
  'Personal',
  'Work',
  'Health',
  'Learning',
];

interface UseNotesDataOptions {
  userId: string;
  refreshTrigger: number;
  onRefresh: () => void;
}

export const useNotesData = (options: UseNotesDataOptions) => {
  const { userId, refreshTrigger, onRefresh } = options;

  const [notes, setNotes] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  // Switching tabs unmounts this screen, so the chosen filter is remembered on
  // the device rather than in state that goes with it.
  const [selectedFilter, setSelectedFilterState] = useState<FilterType>(
    () => localSettingsStore.get(userId, NOTES_FILTER_KEY, DEFAULT_FILTER) ?? DEFAULT_FILTER
  );
  const [isGridView, setIsGridView] = useState(true);

  // Editor state
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteCategory, setNoteCategory] = useState('Personal');
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [isPinned, setIsPinned] = useState(false);
  const [isVoice, setIsVoice] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [customCategories, setCustomCategories] = useState<string[]>([]);

  // Drag state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragXRef = useRef(new Animated.Value(0));
  const dragYRef = useRef(new Animated.Value(0));
  const [renderGen, setRenderGen] = useState(0);
  const notesRef = useRef<Note[]>(notes);
  const activeDragIdRef = useRef<string | null>(null);
  const cardLayoutsRef = useRef<{ [id: string]: { x: number; y: number; width: number; height: number } }>({});
  const dragStartLayoutRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  notesRef.current = notes;

  // AI loading
  const [aiLoading, setAiLoading] = useState(false);
  const [aiActionType, setAiActionType] = useState('');

  const setSelectedFilter = useCallback(
    (filter: FilterType) => {
      setSelectedFilterState(filter);
      localSettingsStore.set(userId, NOTES_FILTER_KEY, filter);
    },
    [userId]
  );

  const loadNotes = useCallback(() => {
    const data = notesStore.getAll(userId);
    setNotes(data);
    const cats = notesStore.getCustomCategories(userId);
    cats.forEach((c) => {
      registerCustomCategoryColor(c.name, c.color);
    });
    const names = cats.map((c) => c.name);
    setCustomCategories(names);
    // A remembered filter whose category has since been deleted would leave the
    // screen empty with no chip lit to explain why, so fall back to All.
    setSelectedFilterState((current) =>
      BUILT_IN_FILTERS.includes(current) || names.includes(current) ? current : DEFAULT_FILTER
    );
  }, [userId]);

  const addCategory = useCallback((name: string, color: string) => {
    if (!name.trim()) return;
    const normalizedName = name.trim();
    const standard = ['Work', 'Personal', 'Health', 'Learning'];
    if (standard.includes(normalizedName) || customCategories.includes(normalizedName)) {
      Alert.alert('Duplicate Category', 'This category already exists.');
      return;
    }
    notesStore.addCustomCategory(userId, normalizedName, color);
    registerCustomCategoryColor(normalizedName, color);
    loadNotes();
  }, [userId, customCategories, loadNotes]);

  useEffect(() => {
    loadNotes();
  }, [userId, refreshTrigger, loadNotes]);

  // ── Drag lifecycle ──

  const onCardLayout = useCallback((id: string, layout: { x: number; y: number; width: number; height: number }) => {
    cardLayoutsRef.current[id] = layout;
  }, []);

  const handleDragStart = useCallback((noteId: string, _index: number) => {
    activeDragIdRef.current = noteId;
    dragOffsetRef.current = { x: 0, y: 0 };
    const layout = cardLayoutsRef.current[noteId];
    dragStartLayoutRef.current = layout ? { ...layout } : null;
    setActiveDragId(noteId);
    setIsDragging(true);
  }, []);

  const handleDragMove = useCallback((dx: number, dy: number) => {
    const draggedId = activeDragIdRef.current;
    if (!draggedId) return;
    const initialLayout = dragStartLayoutRef.current;
    if (!initialLayout) return;

    const currentX = initialLayout.x + dx + dragOffsetRef.current.x;
    const currentY = initialLayout.y + dy + dragOffsetRef.current.y;

    dragXRef.current.setValue(dx + dragOffsetRef.current.x);
    dragYRef.current.setValue(dy + dragOffsetRef.current.y);

    const centerX = currentX + initialLayout.width / 2;
    const centerY = currentY + initialLayout.height / 2;

    const currentNotes = notesRef.current;
    const curIdx = currentNotes.findIndex(n => n.id === draggedId);
    if (curIdx === -1) return;

    const draggedNote = currentNotes[curIdx];
    if (!draggedNote) return;

    let targetIdx = -1;
    let minDistance = Infinity;
    const baseCenterX = initialLayout.x + dragOffsetRef.current.x + initialLayout.width / 2;
    const baseCenterY = initialLayout.y + dragOffsetRef.current.y + initialLayout.height / 2;
    const distToSelfSqr = Math.pow(centerX - baseCenterX, 2) + Math.pow(centerY - baseCenterY, 2);

    for (let i = 0; i < currentNotes.length; i++) {
      const note = currentNotes[i];
      if (note.id === draggedId || note.isPinned) continue;
      const layout = cardLayoutsRef.current[note.id];
      if (layout) {
        const d = Math.pow(centerX - (layout.x + layout.width / 2), 2) + Math.pow(centerY - (layout.y + layout.height / 2), 2);
        if (d < distToSelfSqr && d < minDistance) {
          minDistance = d;
          targetIdx = i;
        }
      }
    }

    if (targetIdx === -1 || targetIdx === curIdx) return;
    const targetNote = currentNotes[targetIdx];
    const targetLayout = cardLayoutsRef.current[targetNote.id];
    if (!targetLayout) return;

    LayoutAnimation.configureNext(swapAnimation);
    const newNotes = [...currentNotes];
    newNotes.splice(curIdx, 1);
    newNotes.splice(targetIdx, 0, draggedNote);

    const oldLayoutsMap = { ...cardLayoutsRef.current };
    for (let i = 0; i < currentNotes.length; i++) {
      const oldNote = currentNotes[i];
      const newIndex = newNotes.findIndex(n => n.id === oldNote.id);
      if (newIndex !== -1) {
        cardLayoutsRef.current[oldNote.id] = oldLayoutsMap[currentNotes[newIndex].id];
      }
    }

    notesRef.current = newNotes;
    setNotes(newNotes);

    const oldBaseX = initialLayout.x + dragOffsetRef.current.x;
    const oldBaseY = initialLayout.y + dragOffsetRef.current.y;
    dragOffsetRef.current.x += oldBaseX - targetLayout.x;
    dragOffsetRef.current.y += oldBaseY - targetLayout.y;
    dragXRef.current.setValue(dx + dragOffsetRef.current.x);
    dragYRef.current.setValue(dy + dragOffsetRef.current.y);
    dragStartLayoutRef.current = {
      x: targetLayout.x - dragOffsetRef.current.x,
      y: targetLayout.y - dragOffsetRef.current.y,
      width: initialLayout.width,
      height: initialLayout.height,
    };
  }, []);

  const handleDragEnd = useCallback(() => {
    const latestNotes = notesRef.current;
    const unpinnedNotes = latestNotes.filter(n => !n.isPinned);
    const orderUpdates = unpinnedNotes.map((note, idx) => ({ id: note.id, sortOrder: idx }));
    notesStore.updateOrder(orderUpdates);

    activeDragIdRef.current = null;
    setActiveDragId(null);
    setIsDragging(false);
    dragOffsetRef.current = { x: 0, y: 0 };
    dragStartLayoutRef.current = null;
    setRenderGen(g => g + 1);
    onRefresh();
  }, [onRefresh]);

  const handleDragRelease = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  // ── Editor ──

  const openNewNote = useCallback(() => {
    setEditingNote(null);
    setNoteTitle('');
    setNoteBody('');
    setNoteCategory('Personal');
    setNoteTags([]);
    setIsPinned(false);
    setIsVoice(false);
    setImageUri(null);
    setSelection({ start: 0, end: 0 });
    setEditorVisible(true);
  }, []);

  const openEditNote = useCallback((note: Note) => {
    if (isDragging) return;
    // A note last saved on desktop is HTML; edit it in the mobile dialect.
    const body = noteBodyToMarkdown(note.body);
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteBody(body);
    setNoteCategory(note.category);
    setNoteTags(note.tags);
    setIsPinned(note.isPinned);
    setIsVoice(note.isVoiceTranscribed);
    setImageUri(note.imageUri || null);
    setSelection({ start: body.length, end: body.length });
    setEditorVisible(true);
  }, [isDragging]);

  const closeEditor = useCallback(() => setEditorVisible(false), []);

  const applyFormatting = useCallback(
    (type: NoteFormat) => {
      const edit = applyNoteFormat(noteBody, selection, type);
      setNoteBody(edit.body);
      setSelection(edit.selection);
    },
    [noteBody, selection]
  );

  /**
   * Body edits go through here so a list can carry itself on: pressing Enter
   * at the end of an item starts the next one, as it does on the desktop.
   */
  const changeBody = useCallback(
    (next: string) => {
      const carried = continueListOnNewline(noteBody, next);
      if (!carried) {
        setNoteBody(next);
        return;
      }
      setNoteBody(carried.body);
      setSelection(carried.selection);
    },
    [noteBody]
  );

  /**
   * Ticks the checklist item at `index` in the note being edited.
   *
   * The stored body is flipped alongside the draft. Both hold the same items
   * in the same order, so the two stay in step — and `saveNote` can still see
   * that a desktop document was only ticked, not rewritten, and keep its HTML.
   */
  const toggleEditorChecklist = useCallback((index: number) => {
    setEditingNote((note) => {
      if (!note) return note;
      const body = toggleChecklistItem(note.body, index);
      return body === note.body ? note : { ...note, body };
    });
    setNoteBody((previous) => toggleChecklistItem(previous, index));
  }, []);

  /**
   * Ticks a to-do straight from its card. The stored body is updated rather
   * than the draft, so a desktop note keeps the formatting mobile cannot draw.
   */
  const toggleNoteChecklist = useCallback(
    (note: Note, index: number) => {
      const body = toggleChecklistItem(note.body, index);
      if (body === note.body) return;
      notesStore.update({
        id: note.id,
        title: note.title,
        body,
        category: note.category,
        isPinned: note.isPinned,
        tags: note.tags,
        imageUri: note.imageUri,
      });
      loadNotes();
      onRefresh();
    },
    [loadNotes, onRefresh]
  );

  const saveNote = useCallback(() => {
    if (!noteTitle.trim() && !noteBody.trim() && !imageUri) {
      setEditorVisible(false);
      return;
    }
    const titleStr = noteTitle.trim() || 'Untitled Note';

    if (editingNote) {
      // Unchanged text keeps the desktop's HTML, and with it the formatting
      // this editor can't show (colours, highlights, images).
      const bodyUnchanged =
        isHtmlBody(editingNote.body) && noteBody === noteBodyToMarkdown(editingNote.body);
      notesStore.update({
        id: editingNote.id,
        title: titleStr,
        body: bodyUnchanged ? editingNote.body : noteBody,
        category: noteCategory,
        isPinned: isPinned,
        tags: noteTags,
        imageUri: imageUri,
      });
    } else {
      notesStore.insert({
        id: generateId('note'),
        userId,
        title: titleStr,
        body: noteBody,
        category: noteCategory,
        isPinned: isPinned,
        tags: isVoice ? ['AI Transcribed'] : noteTags,
        isVoiceTranscribed: isVoice,
        imageUri: imageUri,
      });
    }

    setEditorVisible(false);
    loadNotes();
    onRefresh();
  }, [noteTitle, noteBody, imageUri, editingNote, noteCategory, isPinned, noteTags, isVoice, userId, loadNotes, onRefresh]);

  const deleteNote = useCallback((id: string) => {
    Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        notesStore.delete(id);
        setEditorVisible(false);
        loadNotes();
        onRefresh();
      }},
    ]);
  }, [loadNotes, onRefresh]);

  const getFilteredNotes = useCallback(() => {
    return notes.filter((n) => {
      const matchesSearch = n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        noteBodyToMarkdown(n.body).toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;
      if (selectedFilter === 'All') return true;
      if (selectedFilter === 'Pinned') return n.isPinned;
      if (selectedFilter === 'AI Transcribed') return n.isVoiceTranscribed;
      return n.category === selectedFilter;
    });
  }, [notes, searchQuery, selectedFilter]);

  const triggerAiAction = useCallback((action: 'summarize' | 'clean' | 'tasks') => {
    if (isBodyEmpty(noteBody)) {
      Alert.alert('Nothing to work with', 'Write something in the note body first.');
      return;
    }
    setAiActionType(action);
    setAiLoading(true);

    setTimeout(() => {
      setAiLoading(false);
      if (action === 'summarize') {
        // Written in the dialect, so the desktop reads it back as a heading
        // and a list rather than as three lines of punctuation.
        setNoteBody(
          (prev) =>
            `${prev}\n\n### AI summary\n` +
            '- Key focus of this note centers on productivity details.\n' +
            '- Critical path action items should be extracted and scheduled.'
        );
      } else if (action === 'clean') {
        // Only spacing is tidied. Collapsing every run of whitespace, as this
        // used to, ran the whole note onto one line and destroyed its lists.
        setNoteBody((prev) =>
          prev
            .split('\n')
            .map((line) => line.replace(/[ \t]+$/, ''))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
        );
        Alert.alert('AI Clean Up', 'Empty blocks were collapsed and spacing was tidied.');
      } else if (action === 'tasks') {
        // To-dos still to do come first, as on the desktop; only a note with
        // no checklist at all falls back to reading its prose.
        const checklist = extractChecklistItems(noteBody).filter((item) => !item.done);
        const candidates =
          checklist.length > 0
            ? checklist.map((item) => item.text)
            : noteBodyToMarkdown(noteBody)
                .split('\n')
                .map((line) => line.replace(/^[-*#>\s]+/, '').trim())
                .filter((line) => line.length > 5);

        const today = new Date().toISOString().split('T')[0];
        candidates.forEach((title) => {
          tasksStore.insertTask({
            id: generateId('task'),
            userId,
            title,
            dueDate: today,
            dueTime: '09:00',
            isCompleted: false,
            priority: 'Medium',
            category: noteCategory,
            notes: `Extracted from note: ${noteTitle}`,
          });
        });

        if (candidates.length > 0) {
          Alert.alert(
            'AI Task Extractor',
            `Successfully created ${candidates.length} task${
              candidates.length === 1 ? '' : 's'
            } in your Schedule!`
          );
        } else {
          tasksStore.insertTask({
            id: generateId('task'),
            userId,
            title: noteTitle || 'Untitled Note',
            dueDate: today,
            dueTime: '09:00',
            isCompleted: false,
            priority: 'Medium',
            category: noteCategory,
            notes: noteBody,
          });
          Alert.alert('AI Task Extractor', `Created 1 task based on note: "${noteTitle}".`);
        }
        onRefresh();
      }
    }, 1500);
  }, [noteBody, noteTitle, noteCategory, userId, onRefresh]);

  const deleteCategory = useCallback((name: string) => {
    notesStore.deleteCustomCategory(userId, name);
    loadNotes();
  }, [userId, loadNotes]);

  const updateCategory = useCallback((oldName: string, newName: string, color: string) => {
    if (!newName.trim()) return;
    const normalizedName = newName.trim();
    const standard = ['Work', 'Personal', 'Health', 'Learning'];
    if (normalizedName !== oldName && (standard.includes(normalizedName) || customCategories.includes(normalizedName))) {
      Alert.alert('Duplicate Category', 'This category name already exists.');
      return;
    }
    notesStore.updateCustomCategory(userId, oldName, normalizedName, color);
    registerCustomCategoryColor(normalizedName, color);
    loadNotes();
    if (noteCategory === oldName) {
      setNoteCategory(normalizedName);
    }
  }, [userId, customCategories, noteCategory, loadNotes]);

  const filtered = useMemo(() => getFilteredNotes(), [getFilteredNotes]);

  return {
    // Data
    notes, filtered, searchQuery, searchActive, selectedFilter, isGridView,
    // Editor
    editorVisible, editingNote, noteTitle, noteBody, noteCategory, noteTags,
    isPinned, isVoice, imageUri, selection, customCategories,
    // Drag
    activeDragId, isDragging, dragXRef, dragYRef, renderGen,
    // AI
    aiLoading, aiActionType,
    // Setters
    setSearchQuery, setSearchActive, setSelectedFilter, setIsGridView,
    setNoteTitle, setNoteBody, setNoteCategory, setNoteTags,
    setIsPinned, setIsVoice, setImageUri, setSelection,
    // Actions
    loadNotes, onCardLayout, handleDragStart, handleDragMove, handleDragRelease,
    openNewNote, openEditNote, closeEditor,
    applyFormatting, changeBody, toggleEditorChecklist, toggleNoteChecklist,
    saveNote, deleteNote,
    triggerAiAction, addCategory, deleteCategory, updateCategory,
  };
};
