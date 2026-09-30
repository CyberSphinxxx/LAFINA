import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  PanResponder,
  Animated,
  GestureResponderHandlers,
} from 'react-native';
import { CheckSquare, GripVertical, Pin } from 'lucide-react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import { Shadows } from '../../../theme';
import { getCategoryColor } from '../../../theme/categoryColors';
import type { Note } from '../../../../storage';
import { checklistStats } from '../../../../utils';
import { NoteBody } from './NoteBody';

const lafinaDefaultLogo = require('../../../../assets/lafina_default_logo.png');
const lafinaLogoGradient = require('../../../../assets/lafina_logo_gradient_bg.png');
const splashIcon = require('../../../../assets/spash_icon.png');

export const getLocalImage = (uri: string | null) => {
  if (!uri) return null;
  if (uri === 'lafina_default_logo') return lafinaDefaultLogo;
  if (uri === 'lafina_logo_gradient_bg') return lafinaLogoGradient;
  if (uri === 'spash_icon') return splashIcon;
  return { uri };
};

const dragHandleStyles = StyleSheet.create({
  gridHandle: { padding: 6, justifyContent: 'center', alignItems: 'center' },
  listHandle: { paddingHorizontal: 16, paddingVertical: 24, justifyContent: 'center', alignItems: 'center', borderLeftWidth: 1 },
});

interface NoteCardBaseProps {
  item: Note;
  isGridView: boolean;
  onPress: (note: Note) => void;
  isActive: boolean;
  canDrag: boolean;
  panHandlers: GestureResponderHandlers;
  dragX: Animated.Value;
  dragY: Animated.Value;
  onLayout: (id: string, layout: { x: number; y: number; width: number; height: number }) => void;
  /** Ticks a to-do from the card, as the desktop's cards do. */
  onToggleChecklist: (note: Note, index: number) => void;
}

export const NoteCardBase: React.FC<NoteCardBaseProps> = ({
  item, isGridView, onPress, isActive, canDrag, panHandlers,
  dragX, dragY, onLayout, onToggleChecklist,
}) => {
  const { colors } = useTheme();
  const checklist = checklistStats(item.body);
  const toggle = (index: number) => onToggleChecklist(item, index);

  const progressBadge = checklist.total > 0 && (
    <View style={[styles.checklistBadge, { backgroundColor: colors.inputBg }]}>
      <CheckSquare size={9} color={checklist.done === checklist.total ? colors.success : colors.textMuted} />
      <Text style={[styles.checklistBadgeText, { color: colors.textMuted }]}>
        {`${checklist.done}/${checklist.total}`}
      </Text>
    </View>
  );

  const cardStyle = isActive
    ? {
        transform: [{ translateX: dragX }, { translateY: dragY }, { scale: 1.04 }],
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 15,
        zIndex: 999,
        opacity: 0.92,
      }
    : { zIndex: 1 };

  return (
    <Animated.View
      onLayout={(e) => {
        const { x, y, width, height } = e.nativeEvent.layout;
        onLayout(item.id, { x, y, width, height });
      }}
      style={[
        isGridView ? styles.gridCard : styles.listCard,
        Shadows.card,
        cardStyle,
        { backgroundColor: colors.cardBg },
      ]}
    >
      <View style={[styles.noteTopStrip, { backgroundColor: getCategoryColor(item.category) }]} />

      {isGridView ? (
        <TouchableOpacity style={{ flex: 1 }} onPress={() => onPress(item)} activeOpacity={0.7} disabled={isActive}>
          {item.imageUri && (
            <Image source={getLocalImage(item.imageUri)} style={[styles.gridCardImage, { backgroundColor: colors.inputBg }]} resizeMode="cover" />
          )}
          <View style={styles.cardPadding}>
            <View style={styles.titleRow}>
              <Text style={[styles.noteCardTitle, { color: colors.textPrimary }]} numberOfLines={1}>{item.title}</Text>
              {canDrag && <View {...panHandlers} style={dragHandleStyles.gridHandle}><GripVertical size={14} color={colors.iconMuted} /></View>}
              {item.isPinned && <Pin size={12} color={colors.red} style={{ transform: [{ rotate: '45deg' }] }} />}
            </View>
            <View style={styles.noteCardBody}>
              <NoteBody
                body={item.body}
                compact
                maxBlocks={item.imageUri ? 3 : 6}
                onToggleChecklist={toggle}
              />
            </View>
            <View style={styles.cardFooter}>
              <Text style={[styles.cardDate, { color: colors.textMuted }]}>
                {new Date(item.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Text>
              {progressBadge}
              {item.isVoiceTranscribed && (
                <View style={[styles.voiceBadge, { backgroundColor: 'rgba(91, 91, 255, 0.15)' }]}>
                  <Text style={[styles.voiceBadgeText, { color: colors.blue }]}>AI</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => onPress(item)} activeOpacity={0.7} disabled={isActive}>
            <View style={{ flexDirection: 'row', padding: 12, alignItems: 'center' }}>
              <View style={{ flex: 1, marginRight: item.imageUri ? 12 : 0 }}>
                <View style={styles.titleRow}>
                  <Text style={[styles.noteCardTitle, { color: colors.textPrimary }]} numberOfLines={1}>{item.title}</Text>
                  {item.isPinned && <Pin size={12} color={colors.red} style={{ transform: [{ rotate: '45deg' }] }} />}
                </View>
                <View style={styles.noteCardBody}>
                  <NoteBody
                    body={item.body}
                    compact
                    maxBlocks={4}
                    onToggleChecklist={toggle}
                  />
                </View>
                <View style={styles.cardFooter}>
                  <Text style={[styles.cardDate, { color: colors.textMuted }]}>
                    {new Date(item.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                  {progressBadge}
                  {item.isVoiceTranscribed && (
                    <View style={[styles.voiceBadge, { backgroundColor: 'rgba(91, 91, 255, 0.15)' }]}>
                      <Text style={[styles.voiceBadgeText, { color: colors.blue }]}>AI Transcribed</Text>
                    </View>
                  )}
                </View>
              </View>
              {item.imageUri && (
                <Image source={getLocalImage(item.imageUri)} style={[styles.listCardImage, { backgroundColor: colors.inputBg }]} resizeMode="cover" />
              )}
            </View>
          </TouchableOpacity>
          {canDrag && (
            <View {...panHandlers} style={[dragHandleStyles.listHandle, { borderLeftColor: colors.border }]}>
              <GripVertical size={18} color={colors.iconMuted} />
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
};

interface NoteCardWithDragProps {
  item: Note;
  index: number;
  isGridView: boolean;
  isActive: boolean;
  canDrag: boolean;
  dragX: Animated.Value;
  dragY: Animated.Value;
  onPress: (note: Note) => void;
  onDragStart: (noteId: string, index: number) => void;
  onDragMove: (dx: number, dy: number) => void;
  onDragRelease: () => void;
  onLayout: (id: string, layout: { x: number; y: number; width: number; height: number }) => void;
  onToggleChecklist: (note: Note, index: number) => void;
}

export const NoteCardWithDrag = React.memo<NoteCardWithDragProps>(({
  item, index: _index, isGridView, isActive, canDrag,
  dragX, dragY, onPress, onDragStart, onDragMove, onDragRelease, onLayout,
  onToggleChecklist,
}) => {
  const panRef = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  const itemRef = useRef(item);
  itemRef.current = item;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const onDragReleaseRef = useRef(onDragRelease);
  onDragReleaseRef.current = onDragRelease;

  if (!panRef.current && canDrag) {
    panRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
      onPanResponderGrant: () => {
        dragX.setValue(0);
        dragY.setValue(0);
        onDragStartRef.current(itemRef.current.id, -1);
      },
      onPanResponderMove: (_, gs) => onDragMoveRef.current(gs.dx, gs.dy),
      onPanResponderRelease: () => {
        Animated.parallel([
          Animated.spring(dragX, { toValue: 0, useNativeDriver: false, tension: 120, friction: 8 }),
          Animated.spring(dragY, { toValue: 0, useNativeDriver: false, tension: 120, friction: 8 }),
        ]).start(() => onDragReleaseRef.current());
      },
      onPanResponderTerminate: () => {
        dragX.setValue(0);
        dragY.setValue(0);
        onDragReleaseRef.current();
      },
    });
  }

  const panHandlers = canDrag && panRef.current ? panRef.current.panHandlers : {};

  return (
    <NoteCardBase
      item={item}
      isGridView={isGridView}
      onPress={onPress}
      isActive={isActive}
      canDrag={canDrag}
      panHandlers={panHandlers}
      dragX={dragX}
      dragY={dragY}
      onLayout={onLayout}
      onToggleChecklist={onToggleChecklist}
    />
  );
}, (prev, next) => {
  return prev.item === next.item && prev.isGridView === next.isGridView &&
    prev.isActive === next.isActive && prev.canDrag === next.canDrag &&
    prev.index === next.index;
});

const styles = StyleSheet.create({
  gridCard: { width: '48%', borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
  listCard: { width: '100%', borderRadius: 16, marginBottom: 12, overflow: 'hidden' },
  noteTopStrip: { height: 4, width: '100%' },
  cardPadding: { padding: 12 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  noteCardTitle: { fontFamily: 'sans-serif', fontSize: 14, fontWeight: 'bold', flex: 1 },
  noteCardBody: { marginBottom: 8 },
  checklistBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  checklistBadgeText: { fontSize: 9, fontWeight: 'bold', marginLeft: 3 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDate: { fontSize: 10, fontFamily: 'sans-serif' },
  voiceBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  voiceBadgeText: { fontSize: 8, fontWeight: 'bold' },
  gridCardImage: { width: '100%', height: 80 },
  listCardImage: { width: 60, height: 60, borderRadius: 8 },
});
