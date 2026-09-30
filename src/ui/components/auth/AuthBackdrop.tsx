import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StatusBar, StyleSheet, View } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { Grainient } from './Grainient';

/** Follows Android's "Remove animations" setting. */
const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
};

/**
 * The Welcome, Login and Register backdrop, as on the desktop app: a slow
 * grainy gradient in the logo's colours behind a solid card. Nothing is
 * written straight onto the colours — every word sits on the card — so the
 * gradient can be vivid without costing legibility.
 *
 * One backdrop stays mounted across the three screens, so moving between them
 * does not restart the gradient.
 */
export const AuthBackdrop: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { colors, isDarkMode } = useTheme();
  const reducedMotion = useReducedMotion();

  return (
    <View style={[styles.stage, { backgroundColor: colors.authGradientCrimson }]} testID="auth-backdrop">
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
      />
      <Grainient
        style={StyleSheet.absoluteFill}
        color1={colors.authGradientYellow}
        color2={colors.authGradientCrimson}
        color3={colors.authGradientBlue}
        timeSpeed={0.12}
        colorBalance={0.12}
        warpStrength={0.6}
        warpFrequency={4.0}
        warpSpeed={1.6}
        warpAmplitude={60.0}
        blendAngle={-18.0}
        blendSoftness={0.08}
        rotationAmount={120.0}
        noiseScale={1.6}
        grainAmount={0.07}
        grainScale={2.0}
        contrast={1.15}
        gamma={1.0}
        saturation={0.92}
        zoom={0.85}
        animate={!reducedMotion}
      />
      {/* Takes the edge off the brightest yellow and deepest blue, more so in dark mode. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.authVeil }]} />
      <View style={[styles.content, { paddingTop: StatusBar.currentHeight ?? 0 }]}>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  stage: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
