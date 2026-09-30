import React from 'react';
import { NativeModules, requireNativeComponent, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

/** The desktop component's settings, same names and defaults. */
export interface GrainientProps {
  style?: StyleProp<ViewStyle>;
  color1: string;
  color2: string;
  color3: string;
  timeSpeed?: number;
  colorBalance?: number;
  warpStrength?: number;
  warpFrequency?: number;
  warpSpeed?: number;
  warpAmplitude?: number;
  blendAngle?: number;
  blendSoftness?: number;
  rotationAmount?: number;
  noiseScale?: number;
  grainAmount?: number;
  grainScale?: number;
  grainAnimated?: boolean;
  contrast?: number;
  gamma?: number;
  saturation?: number;
  centerX?: number;
  centerY?: number;
  zoom?: number;
  lightMode?: boolean;
  /** False draws a still frame only, for the system's remove-animations setting. */
  animate?: boolean;
}

/**
 * Whether this APK has the native view and the phone runs OpenGL ES 3. An
 * update that reaches an older APK over the air finds no view here, and shows
 * the still gradient instead of failing to render.
 */
const nativeSupported = ((): boolean => {
  const module = NativeModules.LafinaGrainient as { isSupported?: () => boolean } | undefined;
  try {
    return module?.isSupported?.() === true;
  } catch {
    return false;
  }
})();

const NativeGrainient = nativeSupported
  ? requireNativeComponent<Omit<GrainientProps, 'style'> & { style?: StyleProp<ViewStyle> }>('LafinaGrainientView')
  : null;

/**
 * Grainient — the animated, grainy gradient behind the desktop app's sign-in
 * screens, drawn natively with the same shader (`LafinaGrainientView.kt`).
 *
 * A still gradient in the same colours sits underneath: it is what shows until
 * the first frame is drawn, and all that shows where the shader cannot run.
 */
export const Grainient: React.FC<GrainientProps> = ({ style, ...props }) => (
  <View style={[styles.container, style]} pointerEvents="none">
    <Svg style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="grainientBase" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={props.color1} />
          <Stop offset="0.5" stopColor={props.color2} />
          <Stop offset="1" stopColor={props.color3} />
        </LinearGradient>
        <RadialGradient id="grainientGlowTop" cx="0" cy="0" r="0.75">
          <Stop offset="0" stopColor={props.color1} stopOpacity={1} />
          <Stop offset="1" stopColor={props.color1} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="grainientGlowBottom" cx="1" cy="1" r="0.8">
          <Stop offset="0" stopColor={props.color3} stopOpacity={1} />
          <Stop offset="1" stopColor={props.color3} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#grainientBase)" />
      <Rect width="100%" height="100%" fill="url(#grainientGlowTop)" />
      <Rect width="100%" height="100%" fill="url(#grainientGlowBottom)" />
    </Svg>
    {NativeGrainient && <NativeGrainient style={StyleSheet.absoluteFill} {...props} />}
  </View>
);

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});
