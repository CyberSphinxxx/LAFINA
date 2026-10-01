import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Animated,
  PanResponder,
} from 'react-native';
import { Colors, Fonts, Layout, Shadows } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';
import { Note } from '../../../storage/notesStore';
import { formatStoredDate } from '../../../utils/dateFormat';
import { GripVertical, Pin } from 'lucide-react-native';

const lafinaDefaultLogo = require('../../../assets/lafina_default_logo.png');
const lafinaLogoGradient = require('../../../assets/lafina_logo_gradient_bg.png');
const splashIcon = require('../../../assets/spash_icon.png');

const getLocalImage = (uri: string | null) => {
  if (!uri) return null;
  if (uri === 'lafina_default_logo') return lafinaDefaultLogo;
  if (uri === 'lafina_logo_gradient_bg') return lafinaLogoGradient;
  if (uri === 'spash_icon') return splashIcon;
  return { uri };
};

const renderMarkdown = (text: string): React.ReactNode => {
  if (!text) return null;

  const lines = text.split('\n');
  return lines.map((line, lineIndex) => {
    let isChecklist = false;
    let isCompleted = false;
    let remainingLine = line;

    if (line.startsWith('- [ ] ')) {
      isChecklist = true;
      isCompleted = false;
      remainingLine = line.slice(6);
    } else if (line.startsWith('- [x] ')) {
      isChecklist = true;
      isCompleted = true;
      remainingLine = line.slice(6);
    }

    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
    const parts = remainingLine.split(regex);

    const inlineElements = parts.map((part, partIndex) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <Text key={partIndex} style={{ fontWeight: 'bold' }}>
            {part.slice(2, -2)}
          </Text>
        );
      }
      if (part.startsWith('*') && part.endsWith('*')) {
        return (
          <Text key={partIndex} style={{ fontStyle: 'italic' }}>
            {part.slice(1, -1)}
          </Text>
        );
      }
      return part;
    });

    return (
      <Text key={lineIndex} style={isCompleted ? { textDecorationLine: 'line-through', color: '#999' } : undefined}>
        {isChecklist && (
          <Text style={{ color: isCompleted ? Colors.success : Colors.red, fontWeight: 'bold' }}>
            {isCompleted ? '☑ ' : '☐ '}
          </Text>
        )}
        {inlineElements}
        {lineIndex < lines.length - 1 ? '\n' : ''}
      </Text>
    );
  });
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

interface NoteCardProps {
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
}

export const NoteCard = React.memo<NoteCardProps>(({
  item,
  index: _index,
  isGridView,
  isActive,
  canDrag,
  dragX,
  dragY,
  onPress,
  onDragStart,
  onDragMove,
  onDragRelease,
  onLayout,
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

  const { colors } = useTheme();
  const themed = useThemedStyles();

  if (!panRef.current && canDrag) {
    panRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5,
      onPanResponderGrant: () => {
        const currentItem = itemRef.current;
        dragX.setValue(0);
        dragY.setValue(0);
        onDragStartRef.current(currentItem.id, -1);
      },
      onPanResponderMove: (_, gs) => {
        onDragMoveRef.current(gs.dx, gs.dy);
      },
      onPanResponderRelease: () => {
        Animated.parallel([
          Animated.spring(dragX, {
            toValue: 0,
            useNativeDriver: false,
            tension: 120,
            friction: 8,
          }),
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: false,
            tension: 120,
            friction: 8,
          }),
        ]).start(() => {
          onDragReleaseRef.current();
        });
      },
      onPanResponderTerminate: () => {
        dragX.setValue(0);
        dragY.setValue(0);
        onDragReleaseRef.current();
      },
    });
  }

  const panHandlers = canDrag && panRef.current ? panRef.current.panHandlers : {};

  const cardStyle = isActive
    ? {
        transform: [
          { translateX: dragX },
          { translateY: dragY },
          { scale: 1.04 },
        ],
        shadowColor: '#000',
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
        isGridView ? themed.gridCard : themed.listCard,
        Shadows.card,
        cardStyle,
      ]}
    >
      <View style={[styles.noteTopStrip, { backgroundColor: getCategoryColor(item.category) }]} />

      {isGridView ? (
        <TouchableOpacity
          style={{ flex: 1 }}
          onPress={() => onPress(item)}
          activeOpacity={0.7}
          disabled={isActive}
        >
          {item.imageUri && (
            <Image
              source={getLocalImage(item.imageUri)}
              style={[styles.gridCardImage, themed.gridCardImage]}
              resizeMode="cover"
            />
          )}
          <View style={styles.cardPadding}>
            <View style={styles.titleRow}>
              <Text style={[styles.noteCardTitle, themed.noteCardTitle]} numberOfLines={1}>
                {item.title}
              </Text>
              {canDrag && (
                <View
                  {...panHandlers}
                  style={dragHandleStyles.gridHandle}
                >
                  <GripVertical size={14} color="#AAA" />
                </View>
              )}
              {item.isPinned && <Pin size={12} color={colors.red} style={{ transform: [{ rotate: '45deg' }] }} />}
            </View>
            <Text style={[styles.noteCardBody, themed.noteCardBody]} numberOfLines={item.imageUri ? 2 : 4}>
              {renderMarkdown(item.body)}
            </Text>
            <View style={styles.cardFooter}>
              <Text style={[styles.cardDate, themed.cardDate]}>
                {formatStoredDate(item.updatedAt, { month: 'short', day: 'numeric' })}
              </Text>
              {item.isVoiceTranscribed && (
                <View style={[styles.voiceBadge, themed.voiceBadge]}>
                  <Text style={[styles.voiceBadgeText, themed.voiceBadgeText]}>AI</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => onPress(item)}
            activeOpacity={0.7}
            disabled={isActive}
          >
            <View style={{ flexDirection: 'row', padding: 12, alignItems: 'center' }}>
              <View style={{ flex: 1, marginRight: item.imageUri ? 12 : 0 }}>
                <View style={styles.titleRow}>
                  <Text style={[styles.noteCardTitle, themed.noteCardTitle]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.isPinned && <Pin size={12} color={colors.red} style={{ transform: [{ rotate: '45deg' }] }} />}
                </View>
                <Text style={[styles.noteCardBody, themed.noteCardBody]} numberOfLines={2}>
                  {renderMarkdown(item.body)}
                </Text>
                <View style={styles.cardFooter}>
                  <Text style={[styles.cardDate, themed.cardDate]}>
                    {formatStoredDate(item.updatedAt, { month: 'short', day: 'numeric' })}
                  </Text>
                  {item.isVoiceTranscribed && (
                    <View style={[styles.voiceBadge, themed.voiceBadge]}>
                      <Text style={[styles.voiceBadgeText, themed.voiceBadgeText]}>AI Transcribed</Text>
                    </View>
                  )}
                </View>
              </View>

              {item.imageUri && (
                <Image
                  source={getLocalImage(item.imageUri)}
                  style={[styles.listCardImage, themed.listCardImage]}
                  resizeMode="cover"
                />
              )}
            </View>
          </TouchableOpacity>

          {canDrag && (
            <View
              {...panHandlers}
              style={[dragHandleStyles.listHandle, themed.listHandle]}
            >
              <GripVertical size={18} color="#AAA" />
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
}, (prev, next) => {
  return (
    prev.item === next.item &&
    prev.isGridView === next.isGridView &&
    prev.isActive === next.isActive &&
    prev.canDrag === next.canDrag &&
    prev.index === next.index
  );
});

const dragHandleStyles = StyleSheet.create({
  gridHandle: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listHandle: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
  },
});

const styles = StyleSheet.create({
  gridCard: {
    width: '48%',
    borderRadius: Layout.borderRadiusCard,
    marginBottom: 12,
    overflow: 'hidden',
  },
  listCard: {
    width: '100%',
    borderRadius: Layout.borderRadiusCard,
    marginBottom: 12,
    overflow: 'hidden',
  },
  noteTopStrip: {
    height: 4,
    width: '100%',
  },
  cardPadding: {
    padding: 12,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  noteCardTitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: 'bold',
    flex: 1,
  },
  noteCardBody: {
    fontFamily: Fonts.body,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardDate: {
    fontSize: 10,
    fontFamily: Fonts.body,
  },
  voiceBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  voiceBadgeText: {
    fontSize: 8,
    fontWeight: 'bold',
  },
  gridCardImage: {
    width: '100%',
    height: 80,
  },
  listCardImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
});

function useThemedStyles() {
  const { colors, isDarkMode } = useTheme();
  return {
    gridCard: {
      backgroundColor: colors.cardBg,
    },
    listCard: {
      backgroundColor: colors.cardBg,
    },
    noteCardTitle: {
      color: colors.textPrimary,
    },
    noteCardBody: {
      color: colors.textSecondary,
    },
    cardDate: {
      color: colors.textMuted,
    },
    voiceBadge: {
      backgroundColor: isDarkMode ? 'rgba(91, 91, 255, 0.15)' : '#F0F0FF',
    },
    voiceBadgeText: {
      color: isDarkMode ? '#8F8FFF' : '#5B5BFF',
    },
    gridCardImage: {
      backgroundColor: colors.inputBg,
    },
    listCardImage: {
      backgroundColor: colors.inputBg,
    },
    listHandle: {
      borderLeftColor: colors.border,
    },
  };
}
