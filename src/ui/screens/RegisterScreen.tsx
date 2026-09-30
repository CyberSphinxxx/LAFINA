import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Alert,
} from 'react-native';
import { Mail, Lock, User } from 'lucide-react-native';
import { Colors, Fonts, Layout, Shadows } from '../theme';
import { validatePassword } from '../../storage';
import { accountLinkService } from '../../cloud/accountLinkService';
import { syncWorker } from '../../sync/syncWorker';
import { useTheme } from '../contexts/ThemeContext';
import { useThemedStyles } from '../theme/createThemedStyles';
import type { ThemeColors } from '../contexts/ThemeContext';

// Auth sub-components
import { AuthHeader } from '../components/auth/AuthHeader';
import { AuthInput } from '../components/auth/AuthInput';
import { AuthButton } from '../components/auth/AuthButton';

interface RegisterScreenProps {
  onRegisterSuccess: (userId: string) => void;
  onNavigateToLogin: () => void;
}

const getThemedStyles = (colors: ThemeColors) => ({
  card: { backgroundColor: colors.cardBg },
  cardTitle: { color: colors.textPrimary },
  cardSubtitle: { color: colors.textSecondary },
  link: { color: colors.blue },
  fieldLabel: { color: colors.textPrimary },
  inputContainer: { borderColor: colors.border, backgroundColor: colors.inputBg },
  input: { color: colors.textPrimary },
  footerText: { color: colors.textSecondary },
});

export const RegisterScreen: React.FC<RegisterScreenProps> = ({
  onRegisterSuccess,
  onNavigateToLogin,
}) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { colors } = useTheme();
  const themed = useThemedStyles(getThemedStyles);

  const completeRegistration = (userId: string, message?: string) => {
    if (message) {
      Alert.alert('Offline-Only Account', message);
    }
    onRegisterSuccess(userId);
  };

  const handleOfflineOnlyRegistration = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await accountLinkService.registerOfflineOnly({
        username,
        email,
        password,
      });
      if (result.status === 'offline_only' && result.localUserId) {
        completeRegistration(result.localUserId, result.message);
      } else {
        setError(result.message);
      }
    } catch (registrationError: unknown) {
      setError(registrationError instanceof Error ? registrationError.message : 'Offline registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!username.trim() || !email.trim() || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setError(passwordValidation.error);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await new Promise<void>(resolve => setTimeout(resolve, 800));
      const result = await accountLinkService.registerCloudFirst({
        username,
        email,
        password,
      });

      if (result.status === 'offline' || result.status === 'server_unavailable') {
        setLoading(false);
        Alert.alert(
          result.status === 'offline' ? 'Device Offline' : 'FastAPI Unavailable',
          `${result.message}\n\nYou can cancel and try again, or explicitly create an offline-only account.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Create Offline-Only Account',
              onPress: handleOfflineOnlyRegistration,
            },
          ]
        );
        return;
      }

      if (result.status === 'success' && result.localUserId) {
        syncWorker.performSync().catch(err => {
          console.warn('[RegisterScreen] Background sync error:', err);
        });
        completeRegistration(result.localUserId);
        return;
      }

      if (result.status === 'local_only' && result.localUserId) {
        completeRegistration(result.localUserId, result.message);
        return;
      }

      setError(result.message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">

        {/* Card Form */}
        <View style={[styles.card, Shadows.card, themed.card]}>
          <AuthHeader />
          <Text style={[styles.cardTitle, themed.cardTitle]}>Create Account</Text>
          <Text style={[styles.cardSubtitle, themed.cardSubtitle]}>Get started with your smart study companion</Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          {/* Display Name */}
          <AuthInput
            label="Display Name"
            placeholder="Juan dela Cruz"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="words"
            icon={<User size={20} color={colors.textSecondary} />}
          />

          {/* Email Field */}
          <AuthInput
            label="Email Address"
            placeholder="student@ustp.edu.ph"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            icon={<Mail size={20} color={colors.textSecondary} />}
          />

          {/* Password Field */}
          <AuthInput
            label="Password"
            placeholder="••••••••"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            icon={<Lock size={20} color={colors.textSecondary} />}
            showPasswordToggle
            showPassword={showPassword}
            onPasswordToggle={() => setShowPassword(!showPassword)}
          />

          {/* Confirm Password Field */}
          <AuthInput
            label="Confirm Password"
            placeholder="••••••••"
            secureTextEntry={!showPassword}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            icon={<Lock size={20} color={colors.textSecondary} />}
          />

          {/* Register Button */}
          <AuthButton
            title="Register"
            onPress={handleRegister}
            loading={loading}
          />

          {/* Footer Navigation */}
          <View style={styles.footer}>
            <Text style={[styles.footerText, themed.footerText]}>Already have an account? </Text>
            <TouchableOpacity onPress={onNavigateToLogin}>
              <Text style={[styles.loginLink, themed.link]}>Log In</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: Layout.borderRadiusCard,
    padding: 24,
    width: '100%',
  },
  cardTitle: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  cardSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  errorText: {
    fontFamily: Fonts.body,
    color: Colors.error,
    fontSize: 13,
    marginBottom: 16,
    fontWeight: '500',
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
