import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  FlatList,
  Alert,
} from 'react-native';
import { pick } from '@react-native-documents/picker';
import { FileText, Plus, Search, Grid, List, X } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Colors, Shadows } from '../../theme';
import { useNotesData } from './hooks/useNotesData';
import { NoteFilters, NoteCardWithDrag } from './components';
import { NoteEditor } from './components/NoteEditor';
import { NotesScreenProps } from './types';
import type { Note } from '../../../storage';

export const NotesScreen: React.FC<NotesScreenProps> = ({
  userId,
  refreshTrigger,
  onRefresh,
}) => {
  const { colors } = useTheme();
  const data = useNotesData({ userId, refreshTrigger, onRefresh });

  const keyExtractor = useCallback((item: Note) => item.id, []);

  const renderItem = useCallback(({ item, index }: { item: Note; index: number }) => {
    const isItemPinned = item.isPinned;
    const canDrag = !isItemPinned && data.selectedFilter === 'All' && !data.searchQuery.trim();
    const isActive = item.id === data.activeDragId;

    return (
      <NoteCardWithDrag
        key={item.id}
        item={item}
        index={index}
        isGridView={data.isGridView}
        isActive={isActive}
        canDrag={canDrag}
        dragX={data.dragXRef.current}
        dragY={data.dragYRef.current}
        onPress={data.openEditNote}
        onDragStart={data.handleDragStart}
        onDragMove={data.handleDragMove}
        onDragRelease={data.handleDragRelease}
        onLayout={data.onCardLayout}
        onToggleChecklist={data.toggleNoteChecklist}
      />
    );
  }, [data]);

  const handleAttachImage = async () => {
    try {
      const res = await pick({
        type: ['image/*'],
      });
      if (res && res.length > 0 && res[0].uri) {
        data.setImageUri(res[0].uri);
      }
    } catch (err: any) {
      if (err && err.code === 'DOCUMENT_PICKER_CANCELED') {
        return;
      }
      console.error('Failed to pick image:', err);
      Alert.alert('Error', 'Failed to pick image from device.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        {data.searchActive ? (
          <View style={[styles.searchRow, { backgroundColor: colors.inputBg }]}>
            <TextInput
              style={[styles.searchInput, { color: colors.textPrimary }]}
              placeholder="Search notes..."
              placeholderTextColor={colors.textSecondary}
              autoFocus
              value={data.searchQuery}
              onChangeText={data.setSearchQuery}
            />
            <TouchableOpacity onPress={() => { data.setSearchActive(false); data.setSearchQuery(''); }} style={styles.headerIconBtn}>
              <X size={16} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Notes</Text>
            <View style={styles.headerIcons}>
              <TouchableOpacity onPress={() => data.setSearchActive(true)} style={styles.headerIconBtn}>
                <Search size={18} color={colors.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => data.setIsGridView(!data.isGridView)} style={styles.headerIconBtn}>
                {data.isGridView ? <List size={18} color={colors.textPrimary} /> : <Grid size={18} color={colors.textPrimary} />}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* Filters */}
      <NoteFilters
        selectedFilter={data.selectedFilter}
        onFilterChange={data.setSelectedFilter}
        customCategories={data.customCategories}
      />

      {/* Content */}
      {data.filtered.length === 0 ? (
        <View style={styles.emptyState}>
          <FileText size={48} color={colors.red} style={{ marginBottom: 16 }} />
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>No notes found</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Tap the + button below to write a new note, or use the voice assistant.
          </Text>
        </View>
      ) : data.isGridView ? (
        <ScrollView
          style={styles.notesListScroll}
          contentContainerStyle={[styles.notesList, styles.gridContainer]}
          scrollEnabled={!data.isDragging}
        >
          {data.filtered.map((item, index) => renderItem({ item, index }))}
        </ScrollView>
      ) : (
        <FlatList
          key="list"
          data={data.filtered}
          numColumns={1}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.notesList}
          scrollEnabled={!data.isDragging}
          extraData={data.renderGen}
          renderItem={renderItem}
          removeClippedSubviews={false}
          windowSize={21}
        />
      )}

      {/* FAB */}
      <TouchableOpacity style={[styles.fab, Shadows.card]} onPress={data.openNewNote}>
        <Plus size={24} color={colors.white} />
      </TouchableOpacity>

      {/* Editor Modal */}
      <NoteEditor
        visible={data.editorVisible}
        editingNote={data.editingNote}
        noteTitle={data.noteTitle}
        noteBody={data.noteBody}
        noteCategory={data.noteCategory}
        noteTags={data.noteTags}
        isPinned={data.isPinned}
        imageUri={data.imageUri}
        selection={data.selection}
        aiLoading={data.aiLoading}
        aiActionType={data.aiActionType}
        onTitleChange={data.setNoteTitle}
        onBodyChange={data.changeBody}
        onCategoryChange={data.setNoteCategory}
        onPinToggle={() => data.setIsPinned(!data.isPinned)}
        onImageUriChange={data.setImageUri}
        onSelectionChange={data.setSelection}
        onClose={data.closeEditor}
        onSave={data.saveNote}
        onDelete={() => data.editingNote && data.deleteNote(data.editingNote.id)}
        onFormatting={data.applyFormatting}
        onToggleChecklist={data.toggleEditorChecklist}
        onAttachImage={handleAttachImage}
        onRemoveImage={() => data.setImageUri(null)}
        onAiAction={data.triggerAiAction}
        customCategories={data.customCategories}
        onAddCategory={data.addCategory}
        onDeleteCategory={data.deleteCategory}
        onUpdateCategory={data.updateCategory}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    height: 40,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    borderRadius: 8,
    paddingLeft: 12,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 14,
    fontFamily: 'sans-serif',
    paddingVertical: 0,
  },
  headerTitle: {
    fontFamily: 'sans-serif-medium',
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerIcons: {
    flexDirection: 'row',
  },
  headerIconBtn: {
    padding: 8,
    marginLeft: 8,
  },
  notesList: {
    paddingBottom: 120,
  },
  notesListScroll: {
    flex: 1,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyTitle: {
    fontFamily: 'sans-serif-medium',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: 'sans-serif',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
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
});
