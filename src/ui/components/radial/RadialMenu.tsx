import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { Lock, X } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type { ThemeColors } from '../../contexts/ThemeContext';
import { useThemedStyles } from '../../theme/createThemedStyles';
import { Fonts, Layout, Shadows } from '../../theme';
import type { RadialLayout } from '../../../utils';
import { MIC_CENTER_FROM_BOTTOM } from '../CustomTabBar';
import type { RadialMenuItem } from './useRadialMenu';

const BUBBLE_SIZE = 56;
/** Width of an item's column: the bubble, and the label chip beneath it. */
const ITEM_WIDTH = 104;
/** Gap kept between a label chip and the side of the screen. */
const EDGE_PADDING = 8;
/** Delay added per step away from the middle item, so the fan opens outwards. */
const STAGGER_MS = 34;

interface RadialMenuProps {
  visible: boolean;
  items: RadialMenuItem[];
  layout: RadialLayout;
  highlightedIndex: number | null;
  onSelect: (key: string) => void;
  onDismiss: () => void;
}

const clamp = (value: number, min: number, max: number): number =>
  max < min ? min : Math.min(Math.max(value, min), max);

/**
 * The fan of shortcuts that opens from the Mic button.
 *
 * Drawn over the whole screen rather than inside the tab bar: Android only
 * delivers touches inside a view's bounds, and the items sit well above the
 * bar. Each item springs out from the Mic, middle one first, and a close
 * button takes the Mic's place.
 */
export const RadialMenu: React.FC<RadialMenuProps> = ({
  visible,
  items,
  layout,
  highlightedIndex,
  onSelect,
  onDismiss,
}) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const [mounted, setMounted] = useState(visible);
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);

  /** Backdrop, and the close button that replaces the Mic. */
  const chrome = useRef(new Animated.Value(0)).current;
  /**
   * One value per item, 0 closed to 1 open. Rebuilt when the menu's shape
   * changes, which only happens between opens as the shell swaps modes.
   */
  const itemAnims = useMemo(
    () => items.map(() => new Animated.Value(0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length]
  );
  /** Kept apart from the fly-out so a highlight can grow and shrink on its own. */
  const highlights = useMemo(
    () => items.map(() => new Animated.Value(0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length]
  );

  useEffect(() => {
    // Held so the next run — or an unmount — can stop it. Without that, the
    // staggered springs keep firing on timers after the menu has gone.
    let animation: Animated.CompositeAnimation;
    if (visible) {
      setMounted(true);
      const middle = (itemAnims.length - 1) / 2;
      animation = Animated.parallel([
        Animated.timing(chrome, {
          toValue: 1,
          duration: 170,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        ...itemAnims.map((value, index) =>
          Animated.sequence([
            Animated.delay(Math.round(Math.abs(index - middle) * STAGGER_MS)),
            Animated.spring(value, {
              toValue: 1,
              friction: 6.5,
              tension: 78,
              useNativeDriver: true,
            }),
          ])
        ),
      ]);
      animation.start();
    } else {
      animation = Animated.parallel([
        Animated.timing(chrome, {
          toValue: 0,
          duration: 130,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        ...itemAnims.map((value) =>
          Animated.timing(value, {
            toValue: 0,
            duration: 130,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          })
        ),
      ]);
      animation.start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    return () => animation.stop();
  }, [visible, chrome, itemAnims]);

  useEffect(() => {
    highlights.forEach((value, index) => {
      Animated.spring(value, {
        toValue: index === highlightedIndex ? 1 : 0,
        friction: 7,
        tension: 140,
        useNativeDriver: true,
      }).start();
    });
  }, [highlightedIndex, highlights]);

  if (!mounted) return null;

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setArea((previous) =>
      previous && previous.width === width && previous.height === height ? previous : { width, height }
    );
  };

  const anchorX = area ? area.width / 2 : 0;
  const anchorY = area ? area.height - MIC_CENTER_FROM_BOTTOM : 0;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} testID="radial-menu">
      <Animated.View style={[StyleSheet.absoluteFill, themed.backdrop, { opacity: chrome }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityLabel="Close study tools"
          accessibilityRole="button"
        />
      </Animated.View>

      {area &&
        items.map((item, index) => {
          const position = layout.items[index];
          const progress = itemAnims[index];
          if (!position || !progress) return null;
          // The column is kept on screen, and the bubble nudged back by however
          // far the column had to move, so the bubble still sits exactly where
          // the geometry — and so a sliding finger — expects it.
          const wantedLeft = anchorX + position.x - ITEM_WIDTH / 2;
          const left = clamp(wantedLeft, EDGE_PADDING, area.width - ITEM_WIDTH - EDGE_PADDING);
          const highlighted = index === highlightedIndex;
          const Icon = item.icon;
          return (
            <Animated.View
              key={item.key}
              style={[
                styles.item,
                {
                  left,
                  top: anchorY + position.y - BUBBLE_SIZE / 2,
                  opacity: progress.interpolate({
                    inputRange: [0, 0.4, 1],
                    outputRange: [0, 1, 1],
                    extrapolate: 'clamp',
                  }),
                  transform: [
                    {
                      translateX: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [wantedLeft - left - position.x, 0],
                      }),
                    },
                    {
                      translateY: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-position.y, 0],
                      }),
                    },
                    {
                      scale: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Pressable
                style={styles.itemPress}
                onPress={() => onSelect(item.key)}
                accessibilityRole="button"
                accessibilityLabel={item.locked ? `${item.label}, Student Pro` : item.label}
                accessibilityState={{ selected: highlighted }}
                testID={`radial-item-${item.key}`}
              >
                <Animated.View
                  style={[
                    styles.bubble,
                    Shadows.card,
                    themed.bubble,
                    highlighted && themed.bubbleActive,
                    {
                      marginLeft: wantedLeft - left,
                      transform: [
                        {
                          scale: highlights[index].interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.16],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Icon size={24} color={highlighted ? colors.white : colors.textPrimary} />
                  {item.locked ? (
                    <View style={[styles.lock, themed.lock]}>
                      <Lock size={10} color={colors.white} />
                    </View>
                  ) : null}
                </Animated.View>
                <View
                  style={[styles.labelChip, themed.labelChip, highlighted && themed.labelChipActive]}
                >
                  <Text
                    style={[styles.label, themed.label, highlighted && themed.labelActive]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                </View>
              </Pressable>
            </Animated.View>
          );
        })}

      {area && (
        <Animated.View
          style={[
            styles.close,
            Shadows.micButton,
            themed.close,
            {
              left: anchorX - Layout.micButtonSize / 2,
              top: anchorY - Layout.micButtonSize / 2,
              opacity: chrome,
              transform: [
                { scale: chrome.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                {
                  rotate: chrome.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['-90deg', '0deg'],
                  }),
                },
              ],
            },
          ]}
        >
          <Pressable
            style={styles.closePress}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close study tools"
          >
            <X size={26} color={colors.white} />
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
};

const getThemedStyles = (colors: ThemeColors) => ({
  backdrop: { backgroundColor: colors.overlay },
  bubble: { backgroundColor: colors.cardBg, borderColor: colors.border },
  bubbleActive: { backgroundColor: colors.red, borderColor: colors.red },
  lock: { backgroundColor: colors.textSecondary, borderColor: colors.cardBg },
  labelChip: { backgroundColor: colors.cardBg },
  labelChipActive: { backgroundColor: colors.red },
  label: { color: colors.textPrimary },
  labelActive: { color: colors.white },
  close: { backgroundColor: colors.blue },
});

const styles = StyleSheet.create({
  item: {
    position: 'absolute',
    width: ITEM_WIDTH,
    alignItems: 'center',
  },
  itemPress: {
    width: ITEM_WIDTH,
    alignItems: 'center',
  },
  bubble: {
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lock: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelChip: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Layout.borderRadiusPill,
    maxWidth: ITEM_WIDTH,
  },
  label: {
    fontSize: 12,
    fontFamily: Fonts.heading,
    fontWeight: 'bold',
  },
  close: {
    position: 'absolute',
    width: Layout.micButtonSize,
    height: Layout.micButtonSize,
    borderRadius: Layout.micButtonSize / 2,
  },
  closePress: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
