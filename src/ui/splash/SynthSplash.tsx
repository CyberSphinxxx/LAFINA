import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';
import {
  DARK_STOPS,
  LIGHT_STOPS,
  SPLASH_TIMING,
  splashDoneAt,
  splashLookAt,
  splashMomentAt,
  strandHeightAt,
  type SplashLook,
} from './synthWave';

const lafinaDefaultLogo = require('../../assets/lafina_default_logo.png');

/**
 * Strands drawn on the phone.
 *
 * The desktop draws 18 into a canvas, where a stroke costs almost nothing.
 * Here every strand is an SVG path rebuilt in JavaScript each frame, so the
 * count is halved and the sampling coarsened: the ribbon still reads as a
 * ribbon, and the frame stays cheap enough to hold its rate on a mid-range
 * Android phone.
 */
const STRAND_COUNT = 9;
/** Horizontal step between plotted points, in points. */
const POINT_STEP = 6;
/** The waveform's width at rest, before it stretches away. */
const MARK_WIDTH = 300;
/** Height of the band the wave is drawn into. */
const CANVAS_HEIGHT = 180;

interface SynthSplashProps {
  /** Startup has finished; the splash may begin its exit. */
  ready: boolean;
  /** The exit has played out and the app can take over. */
  onFinished: () => void;
}

interface Frame {
  /** One path per strand, in ribbon order. */
  strands: string[];
  opacity: number;
}

const EMPTY_FRAME: Frame = { strands: [], opacity: 0 };

/**
 * The startup splash: the LAFINA mark as a live synthesiser voice.
 *
 * A flat signal line draws out and swells into speech while the app loads.
 * When startup is done it quiets back to a line, stretches and fades, and the
 * app takes over — one continuous transition rather than a cut.
 *
 * The timeline runs on timers, not animation frames: a backgrounded app gets
 * no frames, and must still reach the app when it comes back.
 */
export const SynthSplash: React.FC<SynthSplashProps> = ({ ready, onFinished }) => {
  const { colors, isDarkMode } = useTheme();
  const { width } = useWindowDimensions();
  const startRef = useRef(Date.now());
  const readyAtRef = useRef<number | null>(null);
  const finishedRef = useRef(onFinished);
  const [frame, setFrame] = useState<Frame>(EMPTY_FRAME);

  finishedRef.current = onFinished;

  const span = Math.min(MARK_WIDTH, width * 0.72);
  const centre = width / 2;
  const middle = CANVAS_HEIGHT / 2;
  const halfHeight = CANVAS_HEIGHT * 0.4;
  const steps = Math.max(8, Math.ceil(span / POINT_STEP));

  const stops = isDarkMode ? DARK_STOPS : LIGHT_STOPS;

  /** One strand as an SVG path, in the canvas's own coordinates. */
  const traceStrand = useCallback(
    (strand: number, seconds: number, look: SplashLook): string => {
      // Only the middle of the line exists at first; it draws outwards.
      const from = 0.5 - look.reveal / 2;
      const to = 0.5 + look.reveal / 2;
      if (to - from <= 0) return '';
      const toX = (x: number): number => centre + (x - 0.5) * span * look.stretch;

      let path = '';
      for (let index = 0; index <= steps; index += 1) {
        const x = from + ((to - from) * index) / steps;
        const y = middle - strandHeightAt(x, strand, seconds, look.amplitude) * halfHeight;
        path += `${index === 0 ? 'M' : 'L'}${toX(x).toFixed(2)} ${y.toFixed(2)}`;
      }
      return path;
    },
    [centre, span, steps, middle, halfHeight]
  );

  // Schedule the exit once startup reports in. The ready time is recorded once
  // and the timers always derive from it, so an effect that runs twice
  // reschedules the same exit instead of losing it.
  useEffect(() => {
    if (!ready) return undefined;
    const now = Date.now() - startRef.current;
    if (readyAtRef.current === null) readyAtRef.current = now;
    const doneAt = splashDoneAt(readyAtRef.current, SPLASH_TIMING) ?? now;
    const timer = setTimeout(() => finishedRef.current(), Math.max(0, doneAt - now));
    return () => clearTimeout(timer);
  }, [ready]);

  // Draw every frame until the timeline is done.
  useEffect(() => {
    let raf = 0;
    let cancelled = false;

    const tick = (): void => {
      if (cancelled) return;
      const elapsed = Date.now() - startRef.current;
      const moment = splashMomentAt(elapsed, readyAtRef.current, SPLASH_TIMING);
      const look = splashLookAt(moment);
      const seconds = elapsed / 1000;
      const strands =
        look.opacity <= 0
          ? []
          : Array.from({ length: STRAND_COUNT }, (_, index) =>
              traceStrand(-1 + (2 * index) / (STRAND_COUNT - 1), seconds, look)
            );
      setFrame({ strands, opacity: look.opacity });
      if (moment.phase !== 'done') raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [traceStrand]);

  const gradient = useMemo(
    () => stops.map(([offset, colour]) => ({ offset, colour })),
    [stops]
  );

  return (
    <View
      testID="synth-splash"
      style={[styles.container, { backgroundColor: colors.background }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={ready ? 'LAFINA is ready' : 'Loading LAFINA'}
    >
      <View style={styles.canvas} pointerEvents="none">
        <Svg width={width} height={CANVAS_HEIGHT} opacity={frame.opacity}>
          <Defs>
            <LinearGradient id="lafinaVoice" x1="0" y1="0" x2="1" y2="0">
              {gradient.map(({ offset, colour }) => (
                <Stop key={offset} offset={offset} stopColor={colour} />
              ))}
            </LinearGradient>
          </Defs>

          {/* A soft glow under the ribbon, as the logo's highlights have.
              react-native-svg has no additive blending, so the strands layer
              at low opacity instead of burning toward white where they cross. */}
          {frame.strands.length > 0 && (
            <Path
              d={frame.strands[Math.floor(STRAND_COUNT / 2)]}
              stroke="url(#lafinaVoice)"
              strokeWidth={7}
              strokeOpacity={isDarkMode ? 0.14 : 0.1}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          )}
          {frame.strands.map((d, index) =>
            d ? (
              <Path
                key={index}
                d={d}
                stroke="url(#lafinaVoice)"
                strokeWidth={1.4}
                strokeOpacity={isDarkMode ? 0.5 : 0.38}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ) : null
          )}
        </Svg>
      </View>

      <View style={styles.footer}>
        <Image source={lafinaDefaultLogo} style={styles.logo} resizeMode="contain" />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvas: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 60,
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 48,
  },
});
