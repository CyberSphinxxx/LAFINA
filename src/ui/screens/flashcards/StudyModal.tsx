import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import type { Flashcard } from '../../../utils';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, FontSize, Layout, Shadows, Spacing } from '../../theme';

/** Horizontal travel that counts as a swipe to the next or previous card. */
const SWIPE_DISTANCE = 60;

interface StudyModalProps {
  visible: boolean;
  title: string;
  cards: Flashcard[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/**
 * Studying a deck one card at a time: tap the card to turn it over, swipe or
 * use the arrows to move on.
 */
export const StudyModal: React.FC<StudyModalProps> = ({
  visible,
  title,
  cards,
  index,
  onIndexChange,
  onClose,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const [revealed, setRevealed] = useState(false);
  const flip = useRef(new Animated.Value(0)).current;
  const card = cards[index];
  const count = cards.length;

  // A new card always starts question side up.
  useEffect(() => {
    setRevealed(false);
    flip.setValue(0);
  }, [index, visible, flip]);

  const turn = (): void => {
    const next = !revealed;
    setRevealed(next);
    Animated.timing(flip, { toValue: next ? 1 : 0, duration: 260, useNativeDriver: true }).start();
  };

  const go = (delta: number): void => {
    const next = index + delta;
    if (next >= 0 && next < count) onIndexChange(next);
  };

  const goRef = useRef(go);
  goRef.current = go;
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx <= -SWIPE_DISTANCE) goRef.current(1);
          else if (gesture.dx >= SWIPE_DISTANCE) goRef.current(-1);
        },
      }),
    []
  );

  const frontRotation = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotation = flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.screen, themed.screen]}>
        <View style={styles.header}>
          <Text style={[styles.title, themed.textPrimary]} numberOfLines={1}>
            {title}
          </Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Stop studying" hitSlop={8}>
            <X size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {card ? (
          <View style={styles.stage} {...swipe.panHandlers}>
            <Pressable
              style={styles.cardArea}
              onPress={turn}
              accessibilityRole="button"
              accessibilityLabel={revealed ? `Answer: ${card.answer}` : `Question: ${card.question}`}
              accessibilityHint={revealed ? 'Double tap to see the question' : 'Double tap to see the answer'}
            >
              <Animated.View
                style={[
                  styles.card,
                  Shadows.card,
                  themed.card,
                  { transform: [{ perspective: 1000 }, { rotateY: frontRotation }] },
                ]}
                importantForAccessibility="no-hide-descendants"
              >
                <Text style={[styles.side, themed.textMuted]}>QUESTION</Text>
                <Text style={[styles.cardText, themed.textPrimary]}>{card.question}</Text>
              </Animated.View>
              <Animated.View
                style={[
                  styles.card,
                  styles.back,
                  Shadows.card,
                  themed.cardBack,
                  { transform: [{ perspective: 1000 }, { rotateY: backRotation }] },
                ]}
                importantForAccessibility="no-hide-descendants"
              >
                <Text style={[styles.side, themed.textMuted]}>ANSWER</Text>
                <Text style={[styles.cardText, themed.textPrimary]}>{card.answer}</Text>
              </Animated.View>
            </Pressable>
            <Text style={[styles.hint, themed.textSecondary]}>
              Tap the card to turn it over · swipe for the next one
            </Text>
          </View>
        ) : (
          <View style={styles.stage}>
            <Text style={[styles.hint, themed.textSecondary]}>This deck has no cards left.</Text>
          </View>
        )}

        <View style={styles.controls}>
          <TouchableOpacity
            style={[styles.arrow, themed.arrow]}
            onPress={() => go(-1)}
            disabled={index <= 0}
            accessibilityRole="button"
            accessibilityLabel="Previous card"
          >
            <ChevronLeft size={24} color={index <= 0 ? colors.textMuted : colors.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.counter, themed.textPrimary]}>
            {count === 0 ? 0 : index + 1} / {count}
          </Text>
          <TouchableOpacity
            style={[styles.arrow, themed.arrow]}
            onPress={() => go(1)}
            disabled={index >= count - 1}
            accessibilityRole="button"
            accessibilityLabel="Next card"
          >
            <ChevronRight size={24} color={index >= count - 1 ? colors.textMuted : colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.reveal, themed.reveal]}
          onPress={turn}
          disabled={!card}
          accessibilityRole="button"
        >
          <Text style={[styles.revealLabel, themed.onAccent]}>{revealed ? 'Show question' : 'Show answer'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  screen: { backgroundColor: colors.background },
  textPrimary: { color: colors.textPrimary },
  textSecondary: { color: colors.textSecondary },
  textMuted: { color: colors.textMuted },
  onAccent: { color: colors.white },
  card: { backgroundColor: colors.cardBg, borderColor: colors.border },
  cardBack: { backgroundColor: colors.cardBg, borderColor: colors.red },
  arrow: { backgroundColor: colors.cardBg, borderColor: colors.border },
  reveal: { backgroundColor: colors.red },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: Spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    fontFamily: Fonts.heading,
    fontSize: FontSize.subtitle,
    fontWeight: 'bold',
    marginRight: Spacing.md,
  },
  stage: {
    flex: 1,
    justifyContent: 'center',
  },
  cardArea: {
    height: 360,
  },
  card: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: Layout.borderRadiusCard + 4,
    borderWidth: 1,
    padding: Spacing.xl,
    justifyContent: 'center',
    backfaceVisibility: 'hidden',
  },
  back: {
    borderWidth: 2,
  },
  side: {
    position: 'absolute',
    top: Spacing.lg,
    left: Spacing.xl,
    fontFamily: Fonts.heading,
    fontSize: FontSize.caption,
    letterSpacing: 1,
  },
  cardText: {
    fontFamily: Fonts.body,
    fontSize: FontSize.subtitle,
    lineHeight: 26,
    textAlign: 'center',
  },
  hint: {
    fontFamily: Fonts.body,
    fontSize: FontSize.small,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    minWidth: 96,
    textAlign: 'center',
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontVariant: ['tabular-nums'],
  },
  reveal: {
    marginTop: Spacing.lg,
    borderRadius: Layout.borderRadiusPill,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  revealLabel: {
    fontFamily: Fonts.heading,
    fontSize: FontSize.bodyLarge,
    fontWeight: 'bold',
  },
});
