/**
 * The splash's voice: the LAFINA mark, synthesised live.
 *
 * The logo is a waveform woven from many fine strands, yellow through rose to
 * violet, pinched to nothing at both ends. This computes the same shape as a
 * moving signal: a carrier with two harmonics, shaped by drifting formant
 * bumps and a syllable envelope, so it reads as a voice speaking rather than
 * a sine wave wobbling. The strands twist around each other like a ribbon,
 * which is what gives the mark its silk.
 *
 * Numbers only — no DOM and no canvas — so the timeline and the shape can be
 * tested. `SynthSplash` draws what this returns.
 *
 * Kept byte-for-byte in step with the desktop app's copy at
 * `src/renderer/src/ui/splash/synthWave.ts`: the two apps have to open with
 * the same voice, and the only difference between them is the drawing surface
 * — a canvas there, SVG here.
 */

export interface SplashTiming {
  /** A flat line draws out from the centre and swells into the voice. */
  introMs: number;
  /** Speaks at least this long once the intro is done, so it reads as speech. */
  minVoiceMs: number;
  /** The voice quiets back down to a flat line. */
  settleMs: number;
  /** The line stretches out and fades, uncovering the app. */
  releaseMs: number;
}

export const SPLASH_TIMING: SplashTiming = {
  introMs: 480,
  minVoiceMs: 620,
  settleMs: 300,
  releaseMs: 340,
};

/** Nothing moves, so nothing is waited on: a brief hold, then a fade. */
export const REDUCED_MOTION_TIMING: SplashTiming = {
  introMs: 0,
  minVoiceMs: 350,
  settleMs: 0,
  releaseMs: 200,
};

export type SplashPhase = 'intro' | 'voice' | 'settle' | 'release' | 'done';

export interface SplashMoment {
  phase: SplashPhase;
  /** 0 → 1 through the current phase; 0 throughout `voice`, which has no end of its own. */
  progress: number;
}

/**
 * When the exit begins: once startup is ready, but never before the voice has
 * been heard for its minimum. `null` while startup is still running.
 */
export const splashExitStart = (readyAtMs: number | null, timing: SplashTiming = SPLASH_TIMING): number | null =>
  readyAtMs === null ? null : Math.max(readyAtMs, timing.introMs + timing.minVoiceMs);

/** When the app can be shown, or `null` while startup is still running. */
export const splashDoneAt = (readyAtMs: number | null, timing: SplashTiming = SPLASH_TIMING): number | null => {
  const exit = splashExitStart(readyAtMs, timing);
  return exit === null ? null : exit + timing.settleMs + timing.releaseMs;
};

/** Where the splash is, given how long it has been up and when startup finished. */
export const splashMomentAt = (
  elapsedMs: number,
  readyAtMs: number | null,
  timing: SplashTiming = SPLASH_TIMING,
): SplashMoment => {
  const elapsed = Math.max(0, elapsedMs);
  if (elapsed < timing.introMs) return { phase: 'intro', progress: elapsed / timing.introMs };
  const exit = splashExitStart(readyAtMs, timing);
  if (exit === null || elapsed < exit) return { phase: 'voice', progress: 0 };
  const since = elapsed - exit;
  if (since < timing.settleMs) return { phase: 'settle', progress: since / timing.settleMs };
  if (since < timing.settleMs + timing.releaseMs) {
    return { phase: 'release', progress: (since - timing.settleMs) / timing.releaseMs };
  }
  return { phase: 'done', progress: 1 };
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
export const easeOutCubic = (t: number): number => 1 - (1 - clamp01(t)) ** 3;
export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

/** How the drawing should look at a moment: the transition, as four dials. */
export interface SplashLook {
  /** How much of the line is drawn, from the centre outwards (0 → 1). */
  reveal: number;
  /** How loudly the voice speaks (0 is a flat line). */
  amplitude: number;
  /** Horizontal stretch about the centre; grows as the line lets go. */
  stretch: number;
  /** Overall opacity of the drawing. */
  opacity: number;
}

export const splashLookAt = ({ phase, progress }: SplashMoment): SplashLook => {
  switch (phase) {
    case 'intro':
      // Draw the line first, then let it find its voice.
      return {
        reveal: easeOutCubic(progress / 0.7),
        amplitude: easeOutCubic((progress - 0.3) / 0.7),
        stretch: 1,
        opacity: 1,
      };
    case 'voice':
      return { reveal: 1, amplitude: 1, stretch: 1, opacity: 1 };
    case 'settle':
      return { reveal: 1, amplitude: 1 - easeInOutCubic(progress), stretch: 1, opacity: 1 };
    case 'release':
      return {
        reveal: 1,
        amplitude: 0,
        stretch: 1 + 1.6 * easeInOutCubic(progress),
        opacity: 1 - easeInOutCubic(progress),
      };
    default:
      return { reveal: 1, amplitude: 0, stretch: 2.6, opacity: 0 };
  }
};

const TAU = Math.PI * 2;
/** The quietest the voice gets: always audible, never a flat line mid-sentence. */
export const VOICE_FLOOR = 0.38;
/** Breaths only begin after this; a typical startup has already finished. */
export const VOICE_BREATH_AFTER_S = 2.4;
/** Brings the loudest lobes up to the logo's proportions. */
const HEIGHT_GAIN = 1.15;

/**
 * Loudness over time: syllables at a speaking rate of three to five a second,
 * with the occasional breath. Incommensurate rates keep it from ever settling
 * into an audible loop, and it needs no state, so any frame can be drawn cold.
 */
export const voiceLevelAt = (seconds: number): number => {
  const syllables =
    0.74 +
    0.2 * Math.sin(TAU * 3.1 * seconds) +
    0.13 * Math.sin(TAU * 5.3 * seconds + 1.2) +
    0.09 * Math.sin(TAU * 1.7 * seconds + 0.4);
  // Most startups are over within two seconds, so the voice is at its fullest
  // then; the pauses for breath only come to a splash that is still waiting.
  const breath = seconds > VOICE_BREATH_AFTER_S && Math.sin(TAU * 0.43 * seconds + 0.9) < -0.9 ? 0.55 : 1;
  const vibrato = 1 + 0.035 * Math.sin(TAU * 6.4 * seconds);
  return Math.min(1, Math.max(VOICE_FLOOR, syllables * breath * vibrato));
};

const bump = (x: number, centre: number, width: number): number => Math.exp(-(((x - centre) / width) ** 2));

/**
 * Where along the line the energy sits: two formant bumps that drift as the
 * "vowel" changes, over a pinch that holds both ends at exactly zero, as the
 * logo does.
 */
export const envelopeAt = (x: number, seconds: number): number => {
  if (x <= 0 || x >= 1) return 0;
  const pinch = Math.sin(Math.PI * x) ** 1.4;
  const vowel = 0.5 + 0.5 * Math.sin(TAU * 0.9 * seconds + 0.7);
  const low = bump(x, 0.36 + 0.07 * Math.sin(TAU * 0.37 * seconds), 0.13);
  const high = bump(x, 0.67 + 0.06 * Math.sin(TAU * 0.53 * seconds + 2.1), 0.11);
  const body = bump(x, 0.5, 0.24);
  const shaped = (0.45 + 0.55 * vowel) * low + (1 - 0.45 * vowel) * high + 0.3 * body;
  return pinch * Math.min(1, shaped);
};

/** Strands per waveform; enough for silk, few enough to stay cheap. */
export const STRAND_COUNT = 18;

/**
 * One strand's height at `x` (0 → 1 across the mark), in −1 → 1.
 * `strand` runs −1 → 1 across the ribbon; `amplitude` is the look's loudness.
 */
export const strandHeightAt = (x: number, strand: number, seconds: number, amplitude: number): number => {
  if (amplitude <= 0) return 0;
  // A travelling carrier with the soft harmonics a voice has and a sine lacks.
  const phase = TAU * 7.2 * x - TAU * 1.6 * seconds;
  // The ribbon twists slowly along its length, so its strands cross and part.
  const turn = TAU * 1.4 * x + TAU * 0.35 * seconds;
  const offset = strand * Math.sin(turn) * 0.95;
  const carrier =
    (Math.sin(phase + offset) +
      0.28 * Math.sin(2 * phase + 0.9 + offset * 1.6) +
      0.06 * Math.sin(3.1 * phase + 2.2)) /
    1.34;
  const edge = 1 - 0.18 * strand * strand;
  const loudness = amplitude * voiceLevelAt(seconds);
  const envelope = envelopeAt(x, seconds);
  // Where the ribbon faces the viewer its strands fan apart, giving it the
  // width the mark has even where the wave itself crosses zero.
  const fan = strand * 0.075 * envelope * Math.cos(turn);
  const height = loudness * (HEIGHT_GAIN * envelope * carrier * edge + fan);
  return Math.max(-1, Math.min(1, height));
};

/** The mark's colours, sampled left to right from the splash logo itself. */
export const DARK_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0.0, '#fbf295'],
  [0.22, '#fbdb8c'],
  [0.4, '#f39397'],
  [0.5, '#f1788b'],
  [0.6, '#e9bccd'],
  [0.72, '#d2a9dc'],
  [0.84, '#bcaff0'],
  [1.0, '#7360f4'],
];

/** The same journey, deepened so it holds its own on a light background. */
export const LIGHT_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0.0, '#d9b400'],
  [0.22, '#ee9a1c'],
  [0.4, '#e8505f'],
  [0.5, '#de3a6d'],
  [0.6, '#c35aa6'],
  [0.72, '#9d63d6'],
  [0.84, '#7b5ee8'],
  [1.0, '#4b34e0'],
];
