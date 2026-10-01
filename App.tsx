import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
  Image,
  Text,
  ActivityIndicator,
  Keyboard,
  DeviceEventEmitter,
  Alert,
  PermissionsAndroid,
  AppState,
} from 'react-native';
import type { AlertButton } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Colors } from './src/ui/theme';
import { initDatabase, remindersStore, userStore } from './src/storage';
import { cleanOrphanedAudioCache } from './src/ai';
import { CustomTabBar, TabType } from './src/ui/components/CustomTabBar';
import { ErrorBoundary } from './src/ui/components/ErrorBoundary';
import { VoiceModal } from './src/ui/components/VoiceModal';
import { ThemeProvider, useTheme } from './src/ui/contexts/ThemeContext';
import { SPLASH_DELAY_MS } from './src/constants';
import {
  consumePendingNativeCall,
  getReminderPermissionStatus,
  openExactAlarmSettings,
  openFullScreenIntentSettings,
  reconcileReminderAlarms,
  recoverOrphanedReminderCalls,
} from './src/scheduler';
import type { NativeCallAction, NativeCallTrigger } from './src/scheduler';
import { accountLinkService } from './src/cloud/accountLinkService';


// Screens
import { ChatScreen } from './src/ui/screens/ChatScreen';
import { CalendarScreen, ViewMode } from './src/ui/screens/calendar';
import { NotesScreen } from './src/ui/screens/notes';
import { ProfileScreen } from './src/ui/screens/ProfileScreen';
import { WelcomeScreen } from './src/ui/screens/WelcomeScreen';
import { LoginScreen } from './src/ui/screens/LoginScreen';
import { RegisterScreen } from './src/ui/screens/RegisterScreen';
import { OnboardingScreen } from './src/ui/screens/OnboardingScreen';
import { IncomingCallScreen } from './src/ui/screens';

// Assets
const lafinaDefaultLogo = require('./src/assets/lafina_default_logo.png');
const spashIcon = require('./src/assets/spash_icon.png');

function AppContent({
  userId,
  setUserId,
}: {
  userId: string | null;
  setUserId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [authScreen, setAuthScreen] = useState<'welcome' | 'login' | 'register'>('welcome');
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('calendar');
  const [voiceVisible, setVoiceVisible] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [callVisible, setCallVisible] = useState(false);
  const [callReminderId, setCallReminderId] = useState('');
  const [callTask, setCallTask] = useState('');
  const [callAction, setCallAction] = useState<NativeCallAction>('call');
  const [calendarViewMode, setCalendarViewMode] = useState<ViewMode>('week');
  const splashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { colors } = useTheme();
  const themed = useThemedStyles();

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setIsKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setIsKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Reconcile exact alarms and consume a call that launched a cold app process.
  useEffect(() => {
    if (!userId) return;

    // Recover first: a call interrupted by the process being killed is still marked
    // 'triggered' and would otherwise never ring again. Recovering re-arms it, so the
    // reconciliation pass below then has a future trigger time to schedule.
    void (async (): Promise<void> => {
      try {
        await recoverOrphanedReminderCalls(userId);
      } catch (error) {
        console.error('[App] Failed to recover interrupted reminder calls:', error);
      }
      await reconcileReminderAlarms(remindersStore.getPendingReminders(userId));
    })();
    // Synthesized announcements are cached per phrase, so the directory grows with
    // every distinct task title. Sweep files nothing has touched in a day.
    void cleanOrphanedAudioCache()
      .then(removed => {
        if (removed > 0) {
          console.log(`[App] Removed ${removed} stale TTS audio file(s).`);
        }
      })
      .catch((error: unknown) => {
        console.warn('[App] Audio cache sweep note:', error);
      });
    void (async (): Promise<void> => {
      let status = await getReminderPermissionStatus();
      if (status && !status.notificationsEnabled) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        status = await getReminderPermissionStatus();
      }
      if (!status || (status.canScheduleExactAlarms && status.canUseFullScreenIntent)) {
        return;
      }

      const buttons: AlertButton[] = [{ text: 'Later', style: 'cancel' }];
      if (!status.canScheduleExactAlarms) {
        buttons.push({
          text: 'Alarm access',
          onPress: () => void openExactAlarmSettings(),
        });
      }
      if (!status.canUseFullScreenIntent) {
        buttons.push({
          text: 'Full-screen access',
          onPress: () => void openFullScreenIntentSettings(),
        });
      }
      Alert.alert(
        'Enable reminder calls',
        'LAFINA needs Android alarm and full-screen access to ring reliably while the app is closed.',
        buttons
      );
    })().catch((error: unknown) => {
      console.error('[App] Failed to prepare reminder permissions:', error);
    });
    void consumePendingNativeCall().then((payload) => {
      if (!payload) return;
      const reminder = remindersStore.getReminderById(payload.reminderId);
      if (!reminder || reminder.userId !== userId) return;
      if (splashTimeoutRef.current) {
        clearTimeout(splashTimeoutRef.current);
        splashTimeoutRef.current = null;
      }
      setIsLoading(false);
      setCallReminderId(reminder.id);
      setCallTask(payload.task || reminder.task);
      setCallAction(payload.action);
      setCallVisible(true);
    });
  }, [userId]);

  // Listen for both foreground scheduler events and native alarm/activity intents.
  useEffect(() => {
    const showCall = (event: NativeCallTrigger): void => {
      const reminder = remindersStore.getReminderById(event.reminderId);
      if (!reminder || (userId && reminder.userId !== userId)) return;
      setCallReminderId(reminder.id);
      setCallTask(event.task || reminder.task);
      setCallAction(event.action);
      setCallVisible(true);
    };

    const foregroundSubscription = DeviceEventEmitter.addListener(
      'LAFINA_CALL_TRIGGER',
      (event: { reminderId: string; task: string }) =>
        showCall({ ...event, action: 'call' })
    );
    const nativeSubscription = DeviceEventEmitter.addListener(
      'LAFINA_NATIVE_CALL_TRIGGER',
      (event: NativeCallTrigger) => showCall(event)
    );

    return () => {
      foregroundSubscription.remove();
      nativeSubscription.remove();
    };
  }, [userId]);

  useEffect(() => {
    const setupApp = async () => {
      try {
        // 1. Initialize SQLite Database
        await initDatabase();

        // 2. Check for active session
        const currentUser = userStore.getCurrentUser();
        if (currentUser) {
          setUserId(currentUser.id);
          setIsOnboarding(currentUser.isNewUser);
          accountLinkService.refreshCloudProfile(currentUser.id).then((result) => {
            if (result.status === 'success') {
              setRefreshTrigger((previous) => previous + 1);
            }
          }).catch(() => undefined);
        }

        // Simulate a minor visual delay for the premium splash screen display
        splashTimeoutRef.current = setTimeout(() => {
          splashTimeoutRef.current = null;
          setIsLoading(false);
        }, SPLASH_DELAY_MS);
      } catch (error) {
        console.error('Failed application startup setup:', error);
        setIsLoading(false);
      }
    };
    setupApp();

    return () => {
      if (splashTimeoutRef.current) {
        clearTimeout(splashTimeoutRef.current);
        splashTimeoutRef.current = null;
      }
    };
  }, [setUserId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !userId) {
        return;
      }
      accountLinkService.refreshCloudProfile(userId).then((result) => {
        if (result.status === 'success') {
          setRefreshTrigger((previous) => previous + 1);
        }
      }).catch(() => undefined);
    });

    return () => {
      subscription.remove();
    };
  }, [userId]);

  const triggerRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleVoiceClose = (didUpdate?: boolean) => {
    setVoiceVisible(false);
    if (didUpdate) {
      triggerRefresh();
    }
  };

  const handleGetStarted = (uid: string) => {
    setUserId(uid);
    const user = userStore.getUserById(uid);
    setIsOnboarding(user ? user.isNewUser : false);
  };

  const handleGuestCreateAccount = () => {
    // Clear guest session and show register screen
    userStore.logout();
    setUserId(null);
    setAuthScreen('register');
  };

  const handleLoginSuccess = (uid: string) => {
    setUserId(uid);
    const user = userStore.getUserById(uid);
    setIsOnboarding(user ? user.isNewUser : false);
  };

  const handleRegisterSuccess = (uid: string) => {
    setUserId(uid);
    setIsOnboarding(true);
  };

  const handleOnboardingComplete = () => {
    setIsOnboarding(false);
  };

  const handleLogout = (isGuestParam?: boolean) => {
    setUserId(null);
    setAuthScreen(isGuestParam ? 'welcome' : 'login');
    setIsOnboarding(false);
  };

  // Render Active Screen Component
  const renderScreen = () => {
    if (!userId) return <View style={[styles.errorScreen, themed.errorScreen]}><Text style={themed.errorText}>Access Denied</Text></View>;
    switch (activeTab) {
      case 'chat':
        return (
          <ChatScreen
            userId={userId}
            refreshTrigger={refreshTrigger}
            onRefresh={triggerRefresh}
          />
        );
      case 'calendar':
        return (
          <CalendarScreen
            userId={userId}
            refreshTrigger={refreshTrigger}
            onRefresh={triggerRefresh}
            viewMode={calendarViewMode}
            onViewModeChange={setCalendarViewMode}
          />
        );
      case 'notes':
        return (
          <NotesScreen
            userId={userId}
            refreshTrigger={refreshTrigger}
            onRefresh={triggerRefresh}
          />
        );
      case 'profile':
        return (
          <ProfileScreen
            userId={userId}
            refreshTrigger={refreshTrigger}
            onRefresh={triggerRefresh}
            onLogout={handleLogout}
            onNavigateToRegister={handleGuestCreateAccount}
          />
        );
      default:
        return <View style={[styles.errorScreen, themed.errorScreen]}><Text style={themed.errorText}>Page Not Found</Text></View>;
    }
  };

  // Render Splash Loading Screen
  if (isLoading) {
    return (
      <View style={[styles.splashContainer, themed.splashContainer]}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} />
        <Image source={spashIcon} style={styles.splashIconStyle} resizeMode="contain" />
        <View style={styles.splashFooter}>
          <Image source={lafinaDefaultLogo} style={styles.splashLogoStyle} resizeMode="contain" />
          <ActivityIndicator size="small" color={Colors.yellow} style={styles.loader} />
        </View>
      </View>
    );
  }

  // Render Welcome / Auth Flow
  if (!userId) {
    switch (authScreen) {
      case 'welcome':
        return (
          <WelcomeScreen
            onGetStarted={handleGetStarted}
            onNavigateToLogin={() => setAuthScreen('login')}
            onNavigateToRegister={() => setAuthScreen('register')}
          />
        );
      case 'login':
        return (
          <LoginScreen
            onLoginSuccess={handleLoginSuccess}
            onNavigateToRegister={() => setAuthScreen('register')}
          />
        );
      case 'register':
        return (
          <RegisterScreen
            onRegisterSuccess={handleRegisterSuccess}
            onNavigateToLogin={() => setAuthScreen('login')}
          />
        );
      default:
        return null;
    }
  }

  // Render Onboarding Flow
  if (isOnboarding) {
    return (
      <OnboardingScreen
        userId={userId}
        onOnboardingComplete={handleOnboardingComplete}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.safeContainer, themed.safeContainer]}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} />
        
        {/* Render Active Page Content */}
        <View style={styles.content}>
          <ErrorBoundary
            label="This screen"
            resetKey={activeTab}
            onReset={triggerRefresh}
          >
            {renderScreen()}
          </ErrorBoundary>
        </View>

        {/* Floating Custom Bottom Tab Bar */}
        {!isKeyboardVisible && (
          <CustomTabBar
            activeTab={activeTab}
            onTabPress={setActiveTab}
            onMicPress={() => setVoiceVisible(true)}
          />
        )}

        {/* Voice Assistant Modal */}
        <ErrorBoundary label="The voice assistant" resetKey={voiceVisible}>
          <VoiceModal visible={voiceVisible} userId={userId} onClose={handleVoiceClose} />
        </ErrorBoundary>

        {/* Proactive Incoming Call Screen */}
        <ErrorBoundary
          label="The reminder call"
          resetKey={callReminderId}
          onReset={triggerRefresh}
        >
          <IncomingCallScreen
            visible={callVisible}
            reminderId={callReminderId}
            task={callTask}
            userId={userId}
            initialAction={callAction}
            onClose={() => {
              setCallVisible(false);
              triggerRefresh();
            }}
          />
        </ErrorBoundary>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function useThemedStyles() {
  const { colors } = useTheme();
  return {
    safeContainer: {
      backgroundColor: colors.background,
    },
    splashContainer: {
      backgroundColor: colors.background,
    },
    errorScreen: {
      backgroundColor: colors.background,
    },
    errorText: {
      color: colors.textPrimary,
    },
  };
}

function App() {
  const [userId, setUserId] = useState<string | null>(null);

  return (
    // Last line of defence: a failure anywhere below shows a recovery screen
    // instead of unmounting the activity and dropping the student to the home screen.
    <ErrorBoundary label="LAFINA">
      <ThemeProvider userId={userId}>
        <AppContent userId={userId} setUserId={setUserId} />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  errorScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Splash Screen Sizing & Styling
  splashContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashIconStyle: {
    width: 140,
    height: 140,
    marginBottom: 40,
  },
  splashFooter: {
    position: 'absolute',
    bottom: 60,
    alignItems: 'center',
  },
  splashLogoStyle: {
    width: 120,
    height: 48,
    marginBottom: 16,
  },
  loader: {
    marginTop: 8,
  },
});

export default App;

