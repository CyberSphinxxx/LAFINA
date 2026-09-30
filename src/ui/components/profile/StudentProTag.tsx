import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Fonts } from '../../theme';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * The Student Pro tag, in the brand gradient the desktop app uses beside the
 * account name. Shown for Student Pro accounts only — admins and business
 * accounts get the paid features, not the tag.
 */
export const StudentProTag: React.FC = () => {
  const { colors } = useTheme();
  return (
    <View style={styles.tag} accessibilityRole="text" accessibilityLabel="Student Pro" testID="student-pro-tag">
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="studentProTag" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.proGradientStart} />
            <Stop offset="0.55" stopColor={colors.proGradientMid} />
            <Stop offset="1" stopColor={colors.proGradientEnd} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#studentProTag)" />
      </Svg>
      <Text style={[styles.label, { color: colors.white }]}>Student Pro</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  tag: {
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  label: {
    fontFamily: Fonts.body,
    fontSize: 10.5,
    fontWeight: 'bold',
    letterSpacing: 0.2,
  },
});
