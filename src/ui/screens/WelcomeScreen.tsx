import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
} from 'react-native';
import { Fonts, Layout, Shadows } from '../theme';
import { userStore } from '../../storage';
import { useThemedStyles } from '../theme/createThemedStyles';
import type { ThemeColors } from '../contexts/ThemeContext';

interface WelcomeScreenProps {
  onGetStarted: (userId: string) => void;
  onNavigateToLogin: () => void;
  onNavigateToRegister: () => void;
}

/**
 * The first screen when signed out. It sits on the Grainient backdrop
 * (`AuthBackdrop`), so everything is on one card, as on the desktop app.
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onGetStarted,
  onNavigateToLogin,
  onNavigateToRegister,
}) => {
  const themed = useThemedStyles(getWelcomeThemedStyles);

  const handleGetStarted = () => {
    const guest = userStore.createGuestUser();
    userStore.setCurrentUser(guest.id);
    onGetStarted(guest.id);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} bounces={false}>
      <View style={[styles.card, Shadows.card, themed.card]}>
        {/* Branding */}
        <Image
          source={require('../../assets/lafina_default_logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="LAFINA"
        />
        <Text style={[styles.tagline, themed.tagline]}>Your Offline AI Scheduler</Text>
        <Text style={[styles.description, themed.description]}>
          Offline-first smart scheduling, voice notes, and calendar management — no account required.
        </Text>

        {/* Actions */}
        <TouchableOpacity
          style={[styles.primaryButton, themed.primaryButton]}
          onPress={handleGetStarted}
          activeOpacity={0.8}
        >
          <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>Get Started Free</Text>
          <Text style={[styles.primaryButtonSubtext, themed.primaryButtonText]}>No account needed</Text>
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, themed.dividerLine]} />
          <Text style={[styles.dividerText, themed.dividerText]}>or</Text>
          <View style={[styles.dividerLine, themed.dividerLine]} />
        </View>

        <TouchableOpacity
          style={[styles.secondaryButton, themed.secondaryButton]}
          onPress={onNavigateToRegister}
          activeOpacity={0.8}
        >
          <Text style={[styles.secondaryButtonText, themed.secondaryButtonText]}>Create Account</Text>
        </TouchableOpacity>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, themed.footerText]}>Already have an account? </Text>
          <TouchableOpacity onPress={onNavigateToLogin}>
            <Text style={[styles.loginLink, themed.loginLink]}>Log In</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};

const getWelcomeThemedStyles = (colors: ThemeColors) => ({
  card: { backgroundColor: colors.cardBg },
  tagline: { color: colors.textPrimary },
  description: { color: colors.textSecondary },
  primaryButton: { backgroundColor: colors.blue },
  primaryButtonText: { color: colors.white },
  dividerLine: { backgroundColor: colors.border },
  dividerText: { color: colors.textSecondary },
  secondaryButton: { borderColor: colors.border, backgroundColor: colors.cardBg },
  secondaryButtonText: { color: colors.textPrimary },
  footerText: { color: colors.textSecondary },
  loginLink: { color: colors.blue },
});

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: Layout.borderRadiusCard,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: 'center',
  },
  logo: {
    width: 180,
    height: 80,
    marginBottom: 12,
  },
  tagline: {
    fontFamily: Fonts.heading,
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontFamily: Fonts.body,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  primaryButton: {
    width: '100%',
    height: 56,
    borderRadius: Layout.borderRadiusButton,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  primaryButtonText: {
    fontFamily: Fonts.body,
    fontWeight: 'bold',
    fontSize: 16,
  },
  primaryButtonSubtext: {
    fontFamily: Fonts.body,
    fontSize: 11,
    marginTop: 2,
    opacity: 0.9,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    marginHorizontal: 12,
  },
  secondaryButton: {
    width: '100%',
    height: 48,
    borderRadius: Layout.borderRadiusButton,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: Fonts.body,
    fontWeight: 'bold',
    fontSize: 15,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  footerText: {
    fontFamily: Fonts.body,
    fontSize: 14,
  },
  loginLink: {
    fontFamily: Fonts.body,
    fontWeight: 'bold',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
