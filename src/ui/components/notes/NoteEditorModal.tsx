import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Colors, Fonts } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { Note } from '../../../storage/notesStore';
import {
  Pin,
  X,
  Bold,
  Italic,
  CheckSquare,
  Image as ImageIcon,
} from 'lucide-react-native';

const lafinaDefaultLogo = require('../../../assets/lafina_default_logo.png');
const lafinaLogoGradient = require('../../../assets/lafina_logo_gradient_bg.png');
const splashIcon = require('../../../assets/spash_icon.png');

const getLocalImage = (uri: string | null) => {
  if (uri === 'lafina_default_logo') return lafinaDefaultLogo;
  if (uri === 'lafina_logo_gradient_bg') return lafinaLogoGradient;
  if (uri === 'spash_icon') return splashIcon;
  return null;
};

const getCategoryColor = (cat: string): string => {
  switch (cat?.toLowerCase()) {
    case 'work': return Colors.blue;
    case 'personal': return Colors.yellow;
    case 'health': return Colors.success;
    case 'learning': return '#9B59B6';
    default: return '#9E9E9E';
  }
};

interface NoteEditorModalProps {
  visible: boolean;
  editingNote: Note | null;
  noteTitle: string;
  setNoteTitle: (val: string) => void;
  noteBody: string;
  setNoteBody: (val: string) => void;
  noteCategory: string;
  setNoteCategory: (val: string) => void;
  isPinned: boolean;
  setIsPinned: (val: boolean) => void;
  imageUri: string | null;
  selection: { start: number; end: number };
  setSelection: (val: { start: number; end: number }) => void;
  aiLoading: boolean;
  aiActionType: string;
  onSave: () => void;
  onDelete: (id: string) => void;
  onAttachImage: () => void;
  onRemoveImage: () => void;
  onApplyFormatting: (type: 'bold' | 'italic' | 'checklist') => void;
  onTriggerAiAction: (action: 'summarize' | 'clean' | 'tasks') => void;
}

export const NoteEditorModal: React.FC<NoteEditorModalProps> = ({
  visible,
  editingNote,
  noteTitle,
  setNoteTitle,
  noteBody,
  setNoteBody,
  noteCategory,
  setNoteCategory,
  isPinned,
  setIsPinned,
  imageUri,
  selection,
  setSelection,
  aiLoading,
  aiActionType,
  onSave,
  onDelete,
  onAttachImage,
  onRemoveImage,
  onApplyFormatting,
  onTriggerAiAction,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles();

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={[styles.editorContainer, themed.editorContainer]}>
        {/* Header */}
        <View style={[styles.editorHeader, themed.editorHeader]}>
          <TouchableOpacity
            onPress={() => editingNote && onDelete(editingNote.id)}
            style={styles.deleteNoteBtn}
            disabled={!editingNote}
          >
            <Text style={[styles.deleteNoteText, !editingNote && { opacity: 0.3 }]}>Delete</Text>
          </TouchableOpacity>

          <View style={styles.editorHeaderActions}>
            <TouchableOpacity
              onPress={() => setIsPinned(!isPinned)}
              style={[styles.headerPinBtn, { flexDirection: 'row', alignItems: 'center' }]}
            >
              <Pin
                size={14}
                color={isPinned ? colors.red : colors.textSecondary}
                style={{ marginRight: 4, transform: [{ rotate: isPinned ? '45deg' : '0deg' }] }}
              />
              <Text
                style={[
                  styles.pinIcon,
                  themed.pinIcon,
                  { color: isPinned ? colors.red : colors.textSecondary, marginTop: 0 },
                ]}
              >
                {isPinned ? 'Pinned' : 'Pin'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onSave} style={styles.doneBtn}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Form */}
        <ScrollView style={styles.editorForm} keyboardShouldPersistTaps="handled">
          <TextInput
            style={[styles.editorTitleInput, themed.editorTitleInput]}
            placeholder="Title"
            placeholderTextColor={colors.textSecondary}
            value={noteTitle}
            onChangeText={setNoteTitle}
          />

          <View style={styles.categoryEditorRow}>
            <Text style={[styles.categoryLabel, themed.categoryLabel]}>Category:</Text>
            {['Work', 'Personal', 'Health', 'Learning'].map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.catChipSmall,
                  themed.catChipSmall,
                  noteCategory === cat && { backgroundColor: getCategoryColor(cat), borderColor: 'transparent' },
                ]}
                onPress={() => setNoteCategory(cat)}
              >
                <Text
                  style={[
                    styles.catChipSmallText,
                    themed.catChipSmallText,
                    noteCategory === cat && { color: '#FFF', fontWeight: 'bold' },
                  ]}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {imageUri && (
            <View style={[styles.editorImageContainer, themed.editorImageContainer]}>
              <Image
                source={getLocalImage(imageUri)}
                style={styles.editorImage}
                resizeMode="cover"
              />
              <TouchableOpacity
                style={styles.removeImageOverlayBtn}
                onPress={onRemoveImage}
                activeOpacity={0.7}
              >
                <X size={16} color="#FFF" />
              </TouchableOpacity>
            </View>
          )}

          {/* Text styling toolbar */}
          <View style={[styles.editorToolbar, themed.editorToolbar]}>
            <TouchableOpacity
              onPress={() => onApplyFormatting('bold')}
              style={[styles.toolbarBtn, themed.toolbarBtn]}
              activeOpacity={0.7}
            >
              <Bold size={16} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onApplyFormatting('italic')}
              style={[styles.toolbarBtn, themed.toolbarBtn]}
              activeOpacity={0.7}
            >
              <Italic size={16} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onApplyFormatting('checklist')}
              style={[styles.toolbarBtn, themed.toolbarBtn]}
              activeOpacity={0.7}
            >
              <CheckSquare size={16} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={imageUri ? onRemoveImage : onAttachImage}
              style={[
                styles.toolbarBtn,
                themed.toolbarBtn,
                styles.imageToolbarBtn,
                themed.imageToolbarBtn,
                imageUri && styles.imageToolbarBtnActive,
              ]}
              activeOpacity={0.7}
            >
              <ImageIcon size={16} color={imageUri ? '#FFF' : colors.textPrimary} style={{ marginRight: 4 }} />
              <Text
                style={[
                  styles.imageToolbarText,
                  themed.imageToolbarText,
                  imageUri && styles.imageToolbarTextActive,
                ]}
              >
                {imageUri ? 'Remove Image' : 'Image'}
              </Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={[styles.editorBodyInput, themed.editorBodyInput]}
            placeholder="Start writing..."
            placeholderTextColor={colors.textSecondary}
            multiline
            value={noteBody}
            onChangeText={setNoteBody}
            selection={selection}
            onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
          />
        </ScrollView>

        {/* AI Loader Overlay */}
        {aiLoading && (
          <View style={[styles.aiLoadingOverlay, themed.aiLoadingOverlay]}>
            <ActivityIndicator size="large" color={colors.yellow} />
            <Text style={[styles.aiLoadingText, themed.aiLoadingText]}>AI is performing {aiActionType}...</Text>
          </View>
        )}

        {/* AI Actions Strip */}
        <View style={[styles.aiActionsStrip, themed.aiActionsStrip]}>
          <TouchableOpacity
            onPress={() => onTriggerAiAction('summarize')}
            style={[styles.aiActionBtn, themed.aiActionBtn]}
          >
            <Text style={styles.aiActionBtnText}>✨ Summarize</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onTriggerAiAction('clean')}
            style={[styles.aiActionBtn, themed.aiActionBtn]}
          >
            <Text style={styles.aiActionBtnText}>✍ Clean Up</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onTriggerAiAction('tasks')}
            style={[styles.aiActionBtn, themed.aiActionBtn]}
          >
            <Text style={styles.aiActionBtnText}>📋 Extract Tasks</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  editorContainer: {
    flex: 1,
  },
  editorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  deleteNoteBtn: {
    paddingVertical: 6,
  },
  deleteNoteText: {
    color: Colors.error,
    fontWeight: 'bold',
  },
  editorHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerPinBtn: {
    marginRight: 16,
    paddingVertical: 6,
  },
  pinIcon: {
    fontSize: 13,
  },
  doneBtn: {
    backgroundColor: Colors.red,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  doneText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  editorForm: {
    flex: 1,
    padding: 16,
  },
  editorTitleInput: {
    fontFamily: Fonts.heading,
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
    paddingVertical: 0,
  },
  categoryEditorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryLabel: {
    fontSize: 12,
    marginRight: 8,
  },
  catChipSmall: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 4,
  },
  catChipSmallText: {
    fontSize: 11,
  },
  editorToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 6,
    marginBottom: 12,
  },
  toolbarBtn: {
    padding: 8,
    marginRight: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageToolbarBtn: {
    flexDirection: 'row',
    paddingHorizontal: 12,
  },
  imageToolbarBtnActive: {
    backgroundColor: Colors.red,
  },
  imageToolbarText: {
    fontSize: 12,
    fontFamily: Fonts.body,
  },
  imageToolbarTextActive: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  editorImageContainer: {
    position: 'relative',
    marginVertical: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    height: 180,
    width: '100%',
  },
  editorImage: {
    width: '100%',
    height: '100%',
  },
  removeImageOverlayBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editorBodyInput: {
    fontFamily: Fonts.body,
    fontSize: 15,
    lineHeight: 22,
    height: 400,
    textAlignVertical: 'top',
    paddingVertical: 0,
  },
  aiLoadingOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  aiLoadingText: {
    marginTop: 12,
    fontWeight: 'bold',
    fontFamily: Fonts.body,
  },
  aiActionsStrip: {
    flexDirection: 'row',
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 12,
    justifyContent: 'space-between',
  },
  aiActionBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  aiActionBtnText: {
    color: Colors.yellow,
    fontSize: 11,
    fontWeight: 'bold',
    fontFamily: Fonts.body,
  },
});

function useThemedStyles() {
  const { colors, isDarkMode } = useTheme();
  return {
    editorContainer: {
      backgroundColor: colors.background,
    },
    editorHeader: {
      borderBottomColor: colors.border,
    },
    pinIcon: {
      color: colors.textSecondary,
    },
    editorTitleInput: {
      color: colors.textPrimary,
    },
    categoryLabel: {
      color: colors.textSecondary,
    },
    catChipSmall: {
      borderColor: colors.border,
    },
    catChipSmallText: {
      color: colors.textSecondary,
    },
    editorToolbar: {
      borderColor: colors.border,
    },
    toolbarBtn: {
      backgroundColor: colors.inputBg,
    },
    imageToolbarBtn: {
      backgroundColor: colors.inputBg,
    },
    imageToolbarText: {
      color: colors.textPrimary,
    },
    editorImageContainer: {
      borderColor: colors.border,
    },
    editorBodyInput: {
      color: colors.textPrimary,
    },
    aiLoadingOverlay: {
      backgroundColor: isDarkMode ? 'rgba(18, 18, 18, 0.85)' : 'rgba(255, 255, 255, 0.85)',
    },
    aiLoadingText: {
      color: colors.textPrimary,
    },
    aiActionsStrip: {
      backgroundColor: colors.cardBg,
    },
    aiActionBtn: {
      backgroundColor: colors.inputBg,
    },
  };
}
