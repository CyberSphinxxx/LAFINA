import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { X } from 'lucide-react-native';
import { Fonts, Layout, Shadows } from '../theme';
import { useTheme } from '../contexts/ThemeContext';
import { useThemedStyles } from '../theme/createThemedStyles';
import type { ThemeColors } from '../contexts/ThemeContext';
import type { TabType } from '../components/CustomTabBar';
import type { TourStep } from './tourSteps';
import { measureInWindow, measureTourTarget } from './tourTargets';
import type { ScreenRect } from './tourTargets';

interface ProductTourProps {
  steps: TourStep[];
  /** Shows the screen a step is about, behind the overlay. */
  onNavigate: (tab: TabType) => void;
  onFinish: (completed: boolean) => void;
}

const PADDING = 6;
const RADIUS = 16;
const GAP = 14;
const MARGIN = 16;
/** As on the desktop: the spotlight slides to its next target. */
export const MOVE_MS = 260;

/** The dimmed layer with a rounded hole around `hole`, as one even-odd path. */
export const spotlightPath = (width: number, height: number, hole: ScreenRect | null): string => {
  const outer = `M0 0H${width}V${height}H0Z`;
  if (!hole) return outer;
  const { x, y, width: w, height: h } = hole;
  const r = Math.max(0, Math.min(RADIUS, w / 2, h / 2));
  return (
    `${outer}M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}` +
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
};

/**
 * Where the card goes: beside the target on whichever side has room (the tab
 * bar is at the bottom, so usually above it), and in the middle when there is
 * no target. Never off screen.
 */
export const placeCard = (
  hole: ScreenRect | null,
  area: { width: number; height: number },
  cardHeight: number,
): number => {
  const highest = Math.max(MARGIN, area.height - cardHeight - MARGIN);
  if (!hole) return Math.min(highest, Math.max(MARGIN, area.height / 2 - cardHeight / 2));
  const below = hole.y + hole.height + GAP;
  const above = hole.y - GAP - cardHeight;
  const top = below + cardHeight + MARGIN <= area.height ? below : above;
  return Math.min(highest, Math.max(MARGIN, top));
};

const lerp = (from: ScreenRect, to: ScreenRect, t: number): ScreenRect => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
  width: from.width + (to.width - from.width) * t,
  height: from.height + (to.height - from.height) * t,
});

/**
 * The guided walkthrough, as on the desktop app: it dims the app and cuts a
 * hole around whatever the current step is about, so the thing being
 * described is the one thing still lit. A step with no target — the welcome
 * and the sign-off — puts its card in the middle instead.
 */
export const ProductTour: React.FC<ProductTourProps> = ({ steps, onNavigate, onFinish }) => {
  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);
  const [index, setIndex] = useState(0);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [hole, setHole] = useState<ScreenRect | null>(null);
  const [cardHeight, setCardHeight] = useState(220);
  const [reduceMotion, setReduceMotion] = useState(false);
  const containerRef = useRef<View>(null);
  const shownHole = useRef<ScreenRect | null>(null);
  const move = useRef(new Animated.Value(1)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  const step = steps[index];
  const isLast = index === steps.length - 1;

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const showHole = useCallback((next: ScreenRect | null) => {
    shownHole.current = next;
    setHole(next);
  }, []);

  /** Slides the hole from where it is to `next`, or puts it there at once. */
  const moveHole = useCallback(
    (next: ScreenRect | null) => {
      const from = shownHole.current;
      move.stopAnimation();
      move.removeAllListeners();
      if (!from || !next || reduceMotion) {
        showHole(next);
        return;
      }
      move.setValue(0);
      move.addListener(({ value }) => showHole(lerp(from, next, value)));
      Animated.timing(move, {
        toValue: 1,
        duration: MOVE_MS,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: false,
      }).start(() => {
        move.removeAllListeners();
        showHole(next);
      });
    },
    [move, reduceMotion, showHole],
  );

  useEffect(() => () => move.removeAllListeners(), [move]);

  // Show the step's screen, then measure once it has laid out behind the overlay.
  useEffect(() => {
    if (!step) return undefined;
    if (step.tab) onNavigate(step.tab);
    let cancelled = false;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(async () => {
        const [target, origin] = await Promise.all([
          step.anchor ? measureTourTarget(step.anchor) : Promise.resolve(null),
          measureInWindow(containerRef.current),
        ]);
        if (cancelled) return;
        // A target that is not on screen gets a centred card, not a spotlight on nothing.
        moveHole(
          target && origin
            ? {
                x: target.x - origin.x - PADDING,
                y: target.y - origin.y - PADDING,
                width: target.width + PADDING * 2,
                height: target.height + PADDING * 2,
              }
            : null,
        );
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [step, area, onNavigate, moveHole]);

  // Each step's card fades in.
  useEffect(() => {
    cardOpacity.setValue(reduceMotion ? 1 : 0);
    if (reduceMotion) return;
    Animated.timing(cardOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [index, cardOpacity, reduceMotion]);

  const close = useCallback((completed: boolean) => onFinish(completed), [onFinish]);
  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);
  const next = useCallback(() => {
    if (index >= steps.length - 1) close(true);
    else setIndex(index + 1);
  }, [index, steps.length, close]);

  // Back steps back through the tour, and leaves it from the first step.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index > 0) back();
      else close(false);
      return true;
    });
    return () => subscription.remove();
  }, [index, back, close]);

  if (!step) return null;

  const cardTop = placeCard(hole, area, cardHeight);

  return (
    <View
      ref={containerRef}
      style={styles.root}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setArea((current) => (current.width === width && current.height === height ? current : { width, height }));
      }}
      accessibilityViewIsModal
      testID="product-tour"
    >
      {area.width > 0 && (
        <Svg width={area.width} height={area.height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={spotlightPath(area.width, area.height, hole)} fill={colors.overlay} fillRule="evenodd" />
          {hole && (
            <Rect
              x={hole.x}
              y={hole.y}
              width={hole.width}
              height={hole.height}
              rx={Math.min(RADIUS, hole.width / 2, hole.height / 2)}
              fill="none"
              stroke={colors.white}
              strokeOpacity={0.85}
              strokeWidth={2}
            />
          )}
        </Svg>
      )}

      {/* Takes every tap, so nothing behind the tour is pressed through it. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={() => undefined} accessible={false} />

      <Animated.View
        style={[styles.card, themed.card, { top: cardTop, opacity: cardOpacity }]}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          if (Math.abs(height - cardHeight) > 2) setCardHeight(height);
        }}
        accessibilityLiveRegion="polite"
      >
        <View style={styles.head}>
          <Text style={[styles.stepCount, themed.muted]}>
            {index + 1} of {steps.length}
          </Text>
          <TouchableOpacity
            onPress={() => close(false)}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Skip the walkthrough"
          >
            <X size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.title, themed.title]} accessibilityRole="header">
          {step.title}
        </Text>
        <Text style={[styles.body, themed.body]}>{step.body}</Text>

        <View style={styles.actions}>
          <TouchableOpacity onPress={() => close(false)} accessibilityRole="button" style={styles.skip}>
            <Text style={[styles.skipText, themed.muted]}>Skip</Text>
          </TouchableOpacity>
          <View style={styles.spacer} />
          {index > 0 && (
            <TouchableOpacity
              onPress={back}
              style={[styles.button, styles.ghostButton, themed.ghostButton]}
              accessibilityRole="button"
            >
              <Text style={[styles.buttonText, themed.title]}>Back</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={next}
            style={[styles.button, { backgroundColor: colors.blue }]}
            accessibilityRole="button"
          >
            <Text style={[styles.buttonText, { color: colors.white }]}>{isLast ? 'Get started' : 'Next'}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // Above the tab bar and its raised Mic, which have their own elevation.
    zIndex: 1000,
    elevation: 30,
  },
  card: {
    position: 'absolute',
    left: MARGIN,
    right: MARGIN,
    borderRadius: Layout.borderRadiusCard,
    padding: 18,
    ...Shadows.micButton,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  stepCount: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
    marginRight: -4,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  skip: {
    paddingVertical: 8,
    paddingRight: 8,
  },
  skipText: {
    fontFamily: Fonts.body,
    fontSize: 14,
  },
  spacer: {
    flex: 1,
  },
  button: {
    minWidth: 76,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: Layout.borderRadiusButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButton: {
    borderWidth: 1,
  },
  buttonText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: 'bold',
  },
});

const getThemedStyles = (colors: ThemeColors) => ({
  card: { backgroundColor: colors.cardBg },
  title: { color: colors.textPrimary },
  body: { color: colors.textSecondary },
  muted: { color: colors.textSecondary },
  ghostButton: { borderColor: colors.border },
});
