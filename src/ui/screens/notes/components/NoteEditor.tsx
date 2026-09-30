import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  PanResponder,
  Vibration,
  Animated,
} from 'react-native';
import {
  Bold,
  CheckSquare,
  Code,
  Edit,
  Eye,
  Heading1,
  Heading2,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListChecks,
  PenLine,
  Pencil,
  Pin,
  Plus,
  Quote,
  Sparkles,
  Trash,
  X,
} from 'lucide-react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import { Colors } from '../../../theme';
import { getLocalImage } from './NoteCard';
import { NoteBody } from './NoteBody';
import { getCategoryColor } from '../../../theme/categoryColors';
import type { Note } from '../../../../storage';
import type { NoteFormat } from '../../../../utils';

interface NoteEditorProps {
  visible: boolean;
  editingNote: Note | null;
  noteTitle: string;
  noteBody: string;
  noteCategory: string;
  noteTags: string[];
  isPinned: boolean;
  imageUri: string | null;
  selection: { start: number; end: number };
  aiLoading: boolean;
  aiActionType: string;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onPinToggle: () => void;
  onImageUriChange: (v: string | null) => void;
  onSelectionChange: (s: { start: number; end: number }) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onFormatting: (type: NoteFormat) => void;
  onToggleChecklist: (index: number) => void;
  onAttachImage: () => void;
  onRemoveImage: () => void;
  onAiAction: (action: 'summarize' | 'clean' | 'tasks') => void;
  customCategories: string[];
  onAddCategory: (cat: string, color: string) => void;
  onDeleteCategory: (cat: string) => void;
  onUpdateCategory: (oldCat: string, newCat: string, newColor: string) => void;
}

interface DraggableCategoryChipProps {
  cat: string;
  isSelected: boolean;
  isEditing: boolean;
  wiggleStyle: any;
  color: string;
  dragVal: Animated.ValueXY;
  onPress: () => void;
  onLongPress: () => void;
  onDragStart: (e: any) => void;
  onDragRelease: (dx: number, dy: number) => void;
}

const DraggableCategoryChip: React.FC<DraggableCategoryChipProps> = ({
  cat, isSelected, isEditing, wiggleStyle, color, dragVal, onPress, onLongPress,
  onDragStart, onDragRelease,
}) => {
  const isEditingRef = useRef(isEditing);
  isEditingRef.current = isEditing;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragReleaseRef = useRef(onDragRelease);
  onDragReleaseRef.current = onDragRelease;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isEditingRef.current,
      onMoveShouldSetPanResponder: (_, gs) => isEditingRef.current && (Math.abs(gs.dx) > 3 || Math.abs(gs.dy) > 3),
      onPanResponderGrant: (e) => {
        onDragStartRef.current(e);
      },
      onPanResponderMove: Animated.event(
        [null, { dx: dragVal.x, dy: dragVal.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: (e, gs) => {
        onDragReleaseRef.current(gs.dx, gs.dy);
      },
      onPanResponderTerminate: (e, gs) => {
        onDragReleaseRef.current(gs.dx, gs.dy);
      },
    })
  ).current;

  return (
    <Animated.View 
      style={isEditing ? wiggleStyle : null}
      {...(isEditing ? panResponder.panHandlers : {})}
    >
      <TouchableOpacity
        activeOpacity={isEditing ? 1 : 0.7}
        style={[
          styles.catChipSmall,
          { borderColor: Colors.border },
          isSelected && { backgroundColor: color, borderColor: 'transparent' },
        ]}
        onPress={isEditing ? undefined : onPress}
        onLongPress={isEditing ? undefined : onLongPress}
      >
        <Text style={[
          { color: '#A0A0A0' },
          isSelected && { color: '#FFFFFF', fontWeight: 'bold' },
          { fontSize: 11 },
        ]}>
          {cat}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

/**
 * The formatting the desktop offers, less what a plain text field cannot send
 * back to it: underline, strikethrough, text colour and links have no place in
 * the shared dialect, and dividers and numbered lists are written by the
 * desktop but not read back by it, so offering them here would only produce
 * notes that degrade on the way over.
 */
const TOOLBAR_BUTTONS: {
  format: NoteFormat;
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
}[] = [
  { format: 'bold', label: 'Bold', icon: Bold },
  { format: 'italic', label: 'Italic', icon: Italic },
  { format: 'highlight', label: 'Highlight', icon: Highlighter },
  { format: 'code', label: 'Code', icon: Code },
  { format: 'h1', label: 'Heading', icon: Heading1 },
  { format: 'h2', label: 'Subheading', icon: Heading2 },
  { format: 'checklist', label: 'Checklist', icon: CheckSquare },
  { format: 'bullet', label: 'Bullet list', icon: List },
  { format: 'quote', label: 'Quote', icon: Quote },
  { format: 'indent', label: 'Indent item', icon: IndentIncrease },
  { format: 'outdent', label: 'Outdent item', icon: IndentDecrease },
];

const AI_ACTIONS: {
  action: 'summarize' | 'clean' | 'tasks';
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
}[] = [
  { action: 'summarize', label: 'Summarize', icon: Sparkles },
  { action: 'clean', label: 'Clean Up', icon: PenLine },
  { action: 'tasks', label: 'Extract Tasks', icon: ListChecks },
];

const COLOR_OPTIONS = [
  '#3498DB', // Blue
  '#2ECC71', // Green
  '#C8A800', // Yellow
  '#9B59B6', // Purple
  '#F75A5A', // Red
  '#E67E22', // Orange
  '#E91E63', // Pink
  '#1ABC9C', // Teal
];

export const NoteEditor: React.FC<NoteEditorProps> = ({
  visible, editingNote, noteTitle, noteBody, noteCategory,
  isPinned, imageUri, selection, aiLoading, aiActionType,
  onTitleChange, onBodyChange, onCategoryChange, onPinToggle,
  onSelectionChange, onClose: _onClose, onSave, onDelete,
  onFormatting, onToggleChecklist, onAttachImage, onRemoveImage, onAiAction,
  customCategories = [], onAddCategory, onDeleteCategory, onUpdateCategory,
}) => {
  const { colors } = useTheme();

  /** False while writing, true while reading — where to-dos can be ticked. */
  const [preview, setPreview] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [selectedColor, setSelectedColor] = useState('#3498DB');

  const [isEditingCats, setIsEditingCats] = useState(false);
  const [draggingCat, setDraggingCat] = useState<string | null>(null);
  const dragVal = useRef(new Animated.ValueXY()).current;
  const wiggleAnim = useRef(new Animated.Value(0)).current;
  const [clonePos, setClonePos] = useState({ x: 0, y: 0 });

  const [deleteLayout, setDeleteLayout] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const [updateLayout, setUpdateLayout] = useState<{x: number, y: number, w: number, h: number} | null>(null);

  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updatingCatName, setUpdatingCatName] = useState('');
  const [updatedCatName, setUpdatedCatName] = useState('');
  const [updatedCatColor, setUpdatedCatColor] = useState('#3498DB');

  useEffect(() => {
    if (isEditingCats) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(wiggleAnim, { toValue: 1, duration: 90, useNativeDriver: true }),
          Animated.timing(wiggleAnim, { toValue: -1, duration: 90, useNativeDriver: true }),
          Animated.timing(wiggleAnim, { toValue: 0, duration: 90, useNativeDriver: true }),
        ])
      ).start();
    } else {
      wiggleAnim.setValue(0);
    }
  }, [isEditingCats, wiggleAnim]);

  const wiggleStyle = {
    transform: [
      {
        rotate: wiggleAnim.interpolate({
          inputRange: [-1, 1],
          outputRange: ['-2.5deg', '2.5deg'],
        }),
      },
    ],
  };

  const handleDragStart = (e: any, cat: string) => {
    setDraggingCat(cat);
    setClonePos({
      x: e.nativeEvent.pageX - 40,
      y: e.nativeEvent.pageY - 20,
    });
    dragVal.setValue({ x: 0, y: 0 });
    Vibration.vibrate(30);
  };

  const handleDragRelease = (cat: string, dx: number, dy: number) => {
    const finalX = clonePos.x + 40 + dx;
    const finalY = clonePos.y + 20 + dy;
    setDraggingCat(null);
    checkCollision(finalX, finalY, cat);
  };

  const checkCollision = (px: number, py: number, cat: string) => {
    if (deleteLayout &&
        px >= deleteLayout.x && px <= deleteLayout.x + deleteLayout.w &&
        py >= deleteLayout.y && py <= deleteLayout.y + deleteLayout.h) {
      Vibration.vibrate(50);
      onDeleteCategory(cat);
      if (noteCategory === cat) {
        onCategoryChange('Personal');
      }
      return;
    }
    if (updateLayout &&
        px >= updateLayout.x && px <= updateLayout.x + updateLayout.w &&
        py >= updateLayout.y && py <= updateLayout.y + updateLayout.h) {
      Vibration.vibrate(30);
      setUpdatingCatName(cat);
      setUpdatedCatName(cat);
      setUpdatedCatColor(getCategoryColor(cat));
      setShowUpdateModal(true);
      return;
    }
  };


  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={[styles.editorContainer, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.editorHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onDelete} style={styles.deleteNoteBtn} disabled={!editingNote || isEditingCats}>
            <Text style={[styles.deleteNoteText, (!editingNote || isEditingCats) && { opacity: 0.3 }]}>Delete</Text>
          </TouchableOpacity>

          <View style={styles.editorHeaderActions}>
            {isEditingCats ? (
              <TouchableOpacity onPress={() => setIsEditingCats(false)} style={styles.doneBtn}>
                <Text style={styles.doneText}>Done</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity onPress={onPinToggle} style={[styles.headerPinBtn, { flexDirection: 'row', alignItems: 'center' }]}>
                  <Pin size={14} color={isPinned ? colors.red : colors.textSecondary} style={{ marginRight: 4, transform: [{ rotate: isPinned ? '45deg' : '0deg' }] }} />
                  <Text style={[{ color: isPinned ? colors.red : colors.textSecondary }, { fontSize: 13 }]}>{isPinned ? 'Pinned' : 'Pin'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onSave} style={styles.doneBtn}>
                  <Text style={styles.doneText}>Done</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Form */}
        <ScrollView style={styles.editorForm} keyboardShouldPersistTaps="handled">
          <TextInput
            style={[styles.editorTitleInput, { color: colors.textPrimary }]}
            placeholder="Title"
            placeholderTextColor={colors.textSecondary}
            value={noteTitle}
            onChangeText={onTitleChange}
          />

          <View style={styles.categoryEditorRow}>
            <Text style={[styles.categoryLabel, { color: colors.textSecondary }]}>Category:</Text>
            {isEditingCats && (
              <TouchableOpacity onPress={() => setIsEditingCats(false)} style={styles.doneEditingBtn}>
                <Text style={{ color: Colors.blue, fontSize: 11, fontWeight: 'bold' }}>Done</Text>
              </TouchableOpacity>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catScroll}>
              {['Work', 'Personal', 'Health', 'Learning'].map((cat) => (
                <TouchableOpacity
                  key={cat}
                  disabled={isEditingCats}
                  style={[
                    styles.catChipSmall,
                    { borderColor: colors.border },
                    { borderColor: colors.textSecondary },
                    noteCategory === cat && { backgroundColor: getCategoryColor(cat), borderColor: 'transparent' },
                    isEditingCats && { opacity: 0.4 },
                  ]}
                  onPress={() => onCategoryChange(cat)}
                >
                  <Text style={[
                    { color: colors.textSecondary },
                    noteCategory === cat && { color: colors.white, fontWeight: 'bold' },
                    { fontSize: 11 },
                  ]}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}

              {customCategories.map((cat) => (
                <DraggableCategoryChip
                  key={cat}
                  cat={cat}
                  isSelected={noteCategory === cat}
                  isEditing={isEditingCats}
                  wiggleStyle={wiggleStyle}
                  color={getCategoryColor(cat)}
                  dragVal={dragVal}
                  onPress={() => onCategoryChange(cat)}
                  onLongPress={() => {
                    Vibration.vibrate(50);
                    setIsEditingCats(true);
                  }}
                  onDragStart={(e) => handleDragStart(e, cat)}
                  onDragRelease={(dx, dy) => handleDragRelease(cat, dx, dy)}
                />
              ))}

              {!isEditingCats && (
                <TouchableOpacity
                  style={[styles.addCatBtn, { borderColor: colors.border }]}
                  onPress={() => setShowAddModal(true)}
                >
                  <Plus size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>

          {isEditingCats && (
            <View style={styles.targetsRow}>
              <View
                style={[styles.targetBox, styles.deleteTarget, { borderColor: Colors.red }]}
                onLayout={(e) => {
                  e.currentTarget.measureInWindow((x, y, w, h) => {
                    setDeleteLayout({ x, y, w, h });
                  });
                }}
              >
                <Trash size={20} color={Colors.red} style={{ marginBottom: 4 }} />
                <Text style={[styles.targetText, { color: Colors.red }]}>Drag here to delete</Text>
              </View>

              <View
                style={[styles.targetBox, styles.updateTarget, { borderColor: Colors.blue }]}
                onLayout={(e) => {
                  e.currentTarget.measureInWindow((x, y, w, h) => {
                    setUpdateLayout({ x, y, w, h });
                  });
                }}
              >
                <Edit size={20} color={Colors.blue} style={{ marginBottom: 4 }} />
                <Text style={[styles.targetText, { color: Colors.blue }]}>Drag here to update</Text>
              </View>
            </View>
          )}

          {/* Add Custom Category Modal */}
          <Modal visible={showAddModal} transparent={true} animationType="fade">
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Add Category</Text>
                
                <TextInput
                  style={[styles.modalInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                  placeholder="Category Name"
                  placeholderTextColor={colors.textSecondary}
                  value={newCatName}
                  onChangeText={setNewCatName}
                  autoFocus
                />

                <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>Select Color:</Text>
                <View style={styles.colorPaletteRow}>
                  {COLOR_OPTIONS.map((color) => (
                    <TouchableOpacity
                      key={color}
                      style={[
                        styles.colorCircle,
                        { backgroundColor: color },
                        selectedColor === color && [styles.activeColorCircle, { borderColor: colors.textPrimary }],
                      ]}
                      onPress={() => setSelectedColor(color)}
                    />
                  ))}
                </View>

                <View style={styles.modalActionsRow}>
                  <TouchableOpacity
                    onPress={() => {
                      setShowAddModal(false);
                      setNewCatName('');
                    }}
                    style={[styles.modalBtn, { marginRight: 8 }]}
                  >
                    <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>Cancel</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    onPress={() => {
                      if (newCatName.trim()) {
                        onAddCategory(newCatName.trim(), selectedColor);
                        onCategoryChange(newCatName.trim());
                        setNewCatName('');
                        setShowAddModal(false);
                      }
                    }}
                    style={[styles.modalBtn, { backgroundColor: Colors.blue }]}
                  >
                    <Text style={{ color: colors.white, fontWeight: 'bold' }}>Add</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Update Custom Category Modal */}
          <Modal visible={showUpdateModal} transparent={true} animationType="fade">
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Update Category</Text>
                
                <TextInput
                  style={[styles.modalInput, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                  placeholder="Category Name"
                  placeholderTextColor={colors.textSecondary}
                  value={updatedCatName}
                  onChangeText={setUpdatedCatName}
                  autoFocus
                />

                <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>Select Color:</Text>
                <View style={styles.colorPaletteRow}>
                  {COLOR_OPTIONS.map((color) => (
                    <TouchableOpacity
                      key={color}
                      style={[
                        styles.colorCircle,
                        { backgroundColor: color },
                        updatedCatColor === color && [styles.activeColorCircle, { borderColor: colors.textPrimary }],
                      ]}
                      onPress={() => setUpdatedCatColor(color)}
                    />
                  ))}
                </View>

                <View style={styles.modalActionsRow}>
                  <TouchableOpacity
                    onPress={() => {
                      setShowUpdateModal(false);
                      setUpdatedCatName('');
                    }}
                    style={[styles.modalBtn, { marginRight: 8 }]}
                  >
                    <Text style={{ color: colors.textSecondary, fontWeight: 'bold' }}>Cancel</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    onPress={() => {
                      if (updatedCatName.trim()) {
                        onUpdateCategory(updatingCatName, updatedCatName.trim(), updatedCatColor);
                        setShowUpdateModal(false);
                        setUpdatedCatName('');
                      }
                    }}
                    style={[styles.modalBtn, { backgroundColor: Colors.blue }]}
                  >
                    <Text style={{ color: colors.white, fontWeight: 'bold' }}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {imageUri && (
            <View style={[styles.editorImageContainer, { borderColor: colors.border }]}>
              <Image source={getLocalImage(imageUri)} style={styles.editorImage} resizeMode="cover" />
              <TouchableOpacity style={styles.removeImageOverlayBtn} onPress={onRemoveImage} activeOpacity={0.7}>
                <X size={16} color={colors.white} />
              </TouchableOpacity>
            </View>
          )}

          {/* Toolbar: the desktop's formatting set, minus what a plain text
              field cannot carry back to it. */}
          <View style={[styles.editorToolbar, { borderColor: colors.border }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {TOOLBAR_BUTTONS.map(({ format, label, icon: Icon }) => (
                <TouchableOpacity
                  key={format}
                  onPress={() => onFormatting(format)}
                  style={[styles.toolbarBtn, { backgroundColor: colors.inputBg }]}
                  activeOpacity={0.7}
                  disabled={preview}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ disabled: preview }}
                >
                  <Icon size={16} color={preview ? colors.textMuted : colors.textPrimary} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={imageUri ? onRemoveImage : onAttachImage}
                style={[styles.toolbarBtn, { backgroundColor: colors.inputBg }, styles.imageToolbarBtn, imageUri && { backgroundColor: Colors.red }]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={imageUri ? 'Remove image' : 'Add image'}
              >
                <ImageIcon size={16} color={imageUri ? colors.white : colors.textPrimary} style={{ marginRight: 4 }} />
                <Text style={[styles.imageToolbarText, { color: colors.textPrimary }, imageUri && { color: colors.white, fontWeight: 'bold' }]}>
                  {imageUri ? 'Remove Image' : 'Image'}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Write or read. Ticking a box needs the note drawn rather than
              typed, which a single text field cannot do. */}
          <View style={[styles.modeRow, { borderColor: colors.border }]}>
            {([false, true] as const).map((wantsPreview) => (
              <TouchableOpacity
                key={wantsPreview ? 'preview' : 'write'}
                onPress={() => setPreview(wantsPreview)}
                style={[
                  styles.modeBtn,
                  preview === wantsPreview && { backgroundColor: Colors.blue },
                ]}
                activeOpacity={0.8}
                accessibilityRole="tab"
                accessibilityState={{ selected: preview === wantsPreview }}
              >
                {wantsPreview ? (
                  <Eye size={13} color={preview ? colors.white : colors.textSecondary} />
                ) : (
                  <Pencil size={13} color={preview ? colors.textSecondary : colors.white} />
                )}
                <Text
                  style={[
                    styles.modeText,
                    { color: colors.textSecondary },
                    preview === wantsPreview && { color: colors.white, fontWeight: 'bold' },
                  ]}
                >
                  {wantsPreview ? 'Preview' : 'Write'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {preview ? (
            <View style={styles.editorPreview} testID="note-preview">
              <NoteBody body={noteBody} onToggleChecklist={onToggleChecklist} />
            </View>
          ) : (
            <TextInput
              style={[styles.editorBodyInput, { color: colors.textPrimary }]}
              placeholder="Start writing..."
              placeholderTextColor={colors.textSecondary}
              multiline
              value={noteBody}
              onChangeText={onBodyChange}
              selection={selection}
              onSelectionChange={(e) => onSelectionChange(e.nativeEvent.selection)}
            />
          )}
        </ScrollView>

        {/* AI Loader */}
        {aiLoading && (
          <View style={[styles.aiLoadingOverlay, { backgroundColor: 'rgba(18, 18, 18, 0.85)' }]}>
            <ActivityIndicator size="large" color={Colors.yellow} />
            <Text style={[styles.aiLoadingText, { color: colors.textPrimary }]}>AI is performing {aiActionType}...</Text>
          </View>
        )}

        {/* AI Actions — same icons as the desktop's AI strip. */}
        <View style={[styles.aiActionsStrip, { backgroundColor: colors.cardBg }]}>
          {AI_ACTIONS.map(({ action, label, icon: Icon }) => (
            <TouchableOpacity
              key={action}
              onPress={() => onAiAction(action)}
              style={[styles.aiActionBtn, { backgroundColor: colors.inputBg }]}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              <Icon size={13} color={Colors.yellow} />
              <Text style={styles.aiActionBtnText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {draggingCat && (
          <Animated.View
            style={[
              styles.dragClone,
              {
                backgroundColor: getCategoryColor(draggingCat),
                left: clonePos.x,
                top: clonePos.y,
                transform: [
                  { translateX: dragVal.x },
                  { translateY: dragVal.y },
                ],
              },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.dragCloneText}>{draggingCat}</Text>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  editorContainer: { flex: 1 },
  editorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1 },
  deleteNoteBtn: { paddingVertical: 6 },
  deleteNoteText: { color: Colors.error, fontWeight: 'bold' },
  editorHeaderActions: { flexDirection: 'row', alignItems: 'center' },
  headerPinBtn: { marginRight: 16, paddingVertical: 6 },
  doneBtn: { backgroundColor: Colors.red, paddingVertical: 6, paddingHorizontal: 16, borderRadius: 12 },
  doneText: { color: Colors.textLight, fontWeight: 'bold' },
  editorForm: { flex: 1, padding: 16 },
  editorTitleInput: { fontFamily: 'sans-serif-medium', fontSize: 22, fontWeight: 'bold', marginBottom: 12, paddingVertical: 0 },
  categoryEditorRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  categoryLabel: { fontSize: 12, marginRight: 8 },
  catChipSmall: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, marginRight: 4 },
  editorToolbar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 6 },
  toolbarBtn: { padding: 8, marginRight: 8, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  modeRow: { flexDirection: 'row', alignSelf: 'flex-start', borderWidth: 1, borderRadius: 10, overflow: 'hidden', marginTop: 10, marginBottom: 12 },
  modeBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  modeText: { fontSize: 12, fontFamily: 'sans-serif', marginLeft: 5 },
  editorPreview: { minHeight: 400, paddingBottom: 8 },
  imageToolbarBtn: { flexDirection: 'row', paddingHorizontal: 12 },
  imageToolbarText: { fontSize: 12, fontFamily: 'sans-serif' },
  editorImageContainer: { position: 'relative', marginVertical: 12, borderRadius: 12, overflow: 'hidden', borderWidth: 1, height: 180, width: '100%' },
  editorImage: { width: '100%', height: '100%' },
  removeImageOverlayBtn: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  editorBodyInput: { fontFamily: 'sans-serif', fontSize: 15, lineHeight: 22, height: 400, textAlignVertical: 'top', paddingVertical: 0 },
  aiLoadingOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  aiLoadingText: { marginTop: 12, fontWeight: 'bold', fontFamily: 'sans-serif' },
  aiActionsStrip: { flexDirection: 'row', paddingTop: 10, paddingBottom: 10, paddingHorizontal: 12, justifyContent: 'space-between' },
  aiActionBtn: { flex: 1, flexDirection: 'row', borderRadius: 8, paddingVertical: 8, marginHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  aiActionBtnText: { color: Colors.yellow, fontSize: 11, fontWeight: 'bold', fontFamily: 'sans-serif', marginLeft: 5 },
  catScroll: { flexDirection: 'row', alignItems: 'center', paddingRight: 16 },
  addCatBtn: { padding: 4, borderRadius: 8, borderWidth: 1, justifyContent: 'center', alignItems: 'center', minWidth: 28, height: 22 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '90%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'sans-serif-medium',
    marginBottom: 16,
  },
  modalSubtitle: {
    fontSize: 13,
    alignSelf: 'flex-start',
    marginTop: 12,
    marginBottom: 8,
    fontFamily: 'sans-serif',
  },
  modalInput: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: 'sans-serif',
  },
  colorPaletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginVertical: 12,
    width: '100%',
  },
  colorCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    margin: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  activeColorCircle: {
    borderWidth: 2,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 1.5,
  },
  modalActionsRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  modalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 70,
  },
  doneEditingBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginRight: 6,
  },
  targetsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 12,
  },
  targetBox: {
    flex: 1,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 12,
    marginHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteTarget: {
    backgroundColor: 'rgba(247, 90, 90, 0.08)',
  },
  updateTarget: {
    backgroundColor: 'rgba(230, 0, 58, 0.08)',
  },
  targetText: {
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: 'sans-serif',
  },
  dragClone: {
    position: 'absolute',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    zIndex: 9999,
  },
  dragCloneText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 11,
    fontFamily: 'sans-serif',
  },
});
