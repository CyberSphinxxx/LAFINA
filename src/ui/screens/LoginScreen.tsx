import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Alert,
} from 'react-native';
import { Mail, Lock, Check } from 'lucide-react-native';
import { Colors, Fonts, Layout, Shadows } from '../theme';
import { userStore } from '../../storage';
import { accountLinkService } from '../../cloud/accountLinkService';
import { syncWorker } from '../../sync/syncWorker';
import { useTheme } from '../contexts/ThemeContext';
import { useThemedStyles } from '../theme/createThemedStyles';
import type { ThemeColors } from '../contexts/ThemeContext';

// Auth sub-components
import { AuthHeader } from '../components/auth/AuthHeader';
import { AuthInput } from '../components/auth/AuthInput';
import { AuthButton } from '../components/auth/AuthButton';

interface LoginScreenProps {
  onLoginSuccess: (userId: string) => void;
  onNavigateToRegister: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onNavigateToRegister,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(false);

  const { colors } = useTheme();
  const themed = useThemedStyles(getLoginThemedStyles);

  // Load saved credentials on mount [Fix #9]
  useEffect(() => {
    const saved = userStore.getRememberMe();
    if (saved.enabled && saved.email) {
      setEmail(saved.email);
      setRememberMe(true);
    }
  }, []);

  const handleRememberMeToggle = () => {
    const newValue = !rememberMe;
    setRememberMe(newValue);

    if (newValue) {
      userStore.setRememberMe(true, email.trim() || null);
    } else {
      userStore.setRememberMe(false, null);
    }
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    if (rememberMe) {
      userStore.setRememberMe(true, text.trim() || null);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await new Promise<void>(resolve => setTimeout(resolve, 800));

      const result = await accountLinkService.login(email, password);
      if (
        (result.status === 'success' || result.status === 'local_only') &&
        result.localUserId
      ) {
        if (rememberMe) {
          userStore.setRememberMe(true, email.trim().toLowerCase());
        }

        if (result.status === 'success') {
          syncWorker.performSync().catch(err => {
            console.warn('[LoginScreen] Background sync error:', err);
          });
        }

        if (result.status === 'local_only') {
          Alert.alert(
            'Signed In for Offline Mode',
            `${result.message}\n\nLAFINA will retry automatic FastAPI linking on startup or when the app resumes with internet access.`
          );
        }

        onLoginSuccess(result.localUserId);
      } else {
        setError(result.message);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during login');
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
          <Text style={[styles.cardTitle, themed.cardTitle]}>Welcome Back</Text>
          <Text style={[styles.cardSubtitle, themed.cardSubtitle]}>Sign in to access your offline schedule</Text>

          {error && <Text style={styles.errorText}>{error}</Text>}

          {/* Email Field */}
          <AuthInput
            label="Email Address"
            placeholder="student@ustp.edu.ph"
            value={email}
            onChangeText={handleEmailChange}
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

          {/* Remember Me Checkbox [Fix #9] */}
          <TouchableOpacity
            style={styles.rememberMeRow}
            onPress={handleRememberMeToggle}
            activeOpacity={0.7}
          >
            <View style={[
              styles.checkbox,
              themed.checkbox,
              rememberMe && styles.checkboxChecked,
              rememberMe && themed.checkboxChecked,
            ]}>
              {rememberMe && <Check size={14} color={colors.white} />}
            </View>
            <Text style={[styles.rememberMeText, themed.rememberMeText]}>
              Remember me
            </Text>
          </TouchableOpacity>

          {/* Log In Button */}
          <AuthButton
            title="Sign In"
            onPress={handleLogin}
            loading={loading}
          />

          {/* Footer Navigation */}
          <View style={styles.footer}>
            <Text style={[styles.footerText, themed.footerText]}>Don't have an account? </Text>
            <TouchableOpacity onPress={onNavigateToRegister}>
              <Text style={[styles.registerLink, themed.link]}>Register</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const getLoginThemedStyles = (colors: ThemeColors) => ({
  card: { backgroundColor: colors.cardBg },
  cardTitle: { color: colors.textPrimary },
  cardSubtitle: { color: colors.textSecondary },
  link: { color: colors.blue },
  rememberMeText: { color: colors.textSecondary },
  checkbox: { borderColor: colors.border, backgroundColor: colors.cardBg },
  checkboxChecked: { backgroundColor: colors.blue, borderColor: colors.blue },
  footerText: { color: colors.textSecondary },
});

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
  rememberMeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  checkboxChecked: {
    // themed styles handle background and borders
  },
  rememberMeText: {
    fontFamily: Fonts.body,
    fontSize: 14,
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
  registerLink: {
    fontFamily: Fonts.body,
    fontWeight: 'bold',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
