import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Fonts, Layout, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../contexts/ThemeContext';

interface OnboardingNavigationProps {
  step: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
}

export const OnboardingNavigation: React.FC<OnboardingNavigationProps> = ({
  step,
  totalSteps,
  onBack,
  onNext,
}) => {
  const themed = useThemedStyles(getThemedStyles);

  return (
    <View style={[styles.navigation, themed.navigation]}>
      {step > 1 && step < totalSteps ? (
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={[styles.backButtonText, themed.backButtonText]}>Back</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.backSpacer} />
      )}

      <TouchableOpacity style={styles.nextButton} onPress={onNext}>
        <Text style={styles.nextButtonText}>
          {step === totalSteps ? 'Get Started' : 'Continue'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  navigation: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
  },
  backButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  backSpacer: {
    width: 80,
  },
  backButtonText: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '600',
  },
  nextButton: {
    backgroundColor: Colors.blue,
    borderRadius: Layout.borderRadiusButton,
    paddingVertical: 12,
    paddingHorizontal: 24,
    minWidth: 120,
    alignItems: 'center',
  },
  nextButtonText: {
    fontFamily: Fonts.body,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
});

const getThemedStyles = (colors: ThemeColors) => ({
  navigation: {
    borderTopColor: colors.border,
  },
  backButtonText: {
    color: colors.textSecondary,
  },
});
