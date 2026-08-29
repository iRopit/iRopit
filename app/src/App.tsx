import React, { useEffect } from 'react';
import {
  StatusBar,
  LogBox,
  Alert,
  NativeModules,
  Platform,
  InteractionManager,
} from 'react-native';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import messaging from '@react-native-firebase/messaging';
// @ts-ignore
import notifee, { AndroidImportance } from '@notifee/react-native';
import RootNavigator from './navigation/RootNavigator';
import { navigationRef } from './navigation/navigationRef';
import { useAuthStore } from './store/authStore';
import { useSettingsStore } from './store/settingsStore';
import { initializeFirebase } from './services/firebase';
import { ThemeProvider } from './contexts/ThemeContext';
import {
  InAppNotificationProvider,
  setGlobalNotificationHandler,
  setCurrentScreen,
  showGlobalNotification,
} from './contexts/InAppNotificationContext';
import { LIGHT_COLORS, DARK_COLORS } from './theme/colors';
import { useNativeEvents } from './hooks/useNativeEvents';
import { checkOnboardingComplete } from './screens/onboarding/OnboardingScreen/useOnboarding';
// ServiceStatusBanner is now only in MainNavigator

const { NotificationModule } = NativeModules;

// Ignore specific warnings
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
]);

const AppContent = () => {
  const initialize = useAuthStore(state => state.initialize);
  const darkMode = useSettingsStore(state => state.darkMode);

  // Initialize native event listeners for SMS and Calls - true to enable listening
  useNativeEvents(true);
  useEffect(() => {
    initializeFirebase();
    initialize();
    let interactionTask: { cancel: () => void } | null = null;

    // Check Notification Access permission on app start (only after onboarding)
    if (Platform.OS === 'android' && NotificationModule) {
      const checkNotificationAccess = async () => {
        try {
          // Only show alert if user has completed onboarding
          const onboardingComplete = await checkOnboardingComplete();
          if (!onboardingComplete) {
            return; // Skip alert if onboarding not complete
          }

          const isGranted = await NotificationModule.isPermissionGranted();
          if (!isGranted) {
            // Show alert to guide user to enable Notification Access
            Alert.alert(
              '⚠️ SMS & Notifications Not Working',
              'Notification Access is required for SMS sync to work.\n\n' +
                'Please enable it:\n' +
                'Settings → Apps → Special Access → Notification Access → Enable iRopit\n\n' +
                'Without this, SMS messages will NOT sync to the extension.',
              [
                { text: 'Later', style: 'cancel' },
                {
                  text: 'Open Settings',
                  onPress: async () => {
                    try {
                      await NotificationModule.openSettings();
                    } catch (e) {
                      console.error('Error opening notification settings:', e);
                    }
                  },
                },
              ],
              { cancelable: true },
            );
          }
        } catch (e) {
          console.error('Error checking notification access:', e);
        }
      };
      // Run after initial interactions to avoid delaying first paint on cold reopen.
      interactionTask = InteractionManager.runAfterInteractions(() => {
        setTimeout(checkNotificationAccess, 1200);
      });
    }

    // Handle foreground FCM messages (push notifications when app is open)
    const unsubscribeForeground = messaging().onMessage(async remoteMessage => {
      console.log('[FCM] Foreground message received:', remoteMessage);

      const msgType  = remoteMessage.data?.type;
      const title    = remoteMessage.notification?.title || remoteMessage.data?.senderName || 'New Message';
      const msgBody  = (remoteMessage.notification?.body  || remoteMessage.data?.messagePreview || '').trim();
      const chatId   = remoteMessage.data?.chatId   || remoteMessage.data?.messageId || '';
      const pushDocId = remoteMessage.data?.pushDocId || '';

      if (msgType === 'chat') {
        // Skip empty-body chat notifications — they show as a content-less
        // entry in the Android notification panel.
        if (!msgBody) {
          console.log('[FCM] Skipping foreground chat notification with empty body');
          return;
        }
        // Stable id dedupes FCM redeliveries.
        const notifId = pushDocId || chatId || (remoteMessage as any).messageId || undefined;
        // Show notifee notification with action buttons for chat messages
        try {
          await notifee.displayNotification({
            id: notifId,
            title,
            body: msgBody,
            data: { messageBody: msgBody, pushDocId, chatId },
            android: {
              channelId: 'iropit_chat',
              importance: AndroidImportance.HIGH,
              smallIcon: 'ic_notification',
              pressAction: { id: 'default' },
              actions: [
                { title: 'Copy',   pressAction: { id: 'copy_message' } },
                { title: 'Delete', pressAction: { id: 'delete_message' } },
                { title: 'Share',  pressAction: { id: 'share_message', launchActivity: 'default' } },
              ],
            },
            ios: {
              categoryId: 'chat_actions',
              sound: 'default',
            },
          });
        } catch (e) {
          console.error('[FCM] Failed to show notifee notification:', e);
        }
      } else if (remoteMessage.notification) {
        // Non-chat notifications: show in-app toast as before
        showGlobalNotification({
          title,
          message: msgBody,
          type: 'info',
          duration: 5000,
          skipIfOnChat: true,
        });
      }
    });

    // Handle notification opened when app is in background
    const unsubscribeOpenedApp = messaging().onNotificationOpenedApp(
      remoteMessage => {
        console.log('[FCM] Notification opened app:', remoteMessage);
        // Navigate to chat screen or handle accordingly
      },
    );

    // Check if app was opened from a notification when app was quit
    messaging()
      .getInitialNotification()
      .then(remoteMessage => {
        if (remoteMessage) {
          console.log(
            '[FCM] App opened from quit state by notification:',
            remoteMessage,
          );
          // Navigate to chat screen or handle accordingly
        }
      });

    return () => {
      interactionTask?.cancel();
      unsubscribeForeground();
      unsubscribeOpenedApp();
    };
  }, []);

  // Custom navigation theme based on dark mode
  const navigationTheme = darkMode
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          primary: DARK_COLORS.primary,
          background: DARK_COLORS.background,
          card: DARK_COLORS.surface,
          text: DARK_COLORS.text,
          border: DARK_COLORS.border,
          notification: DARK_COLORS.primary,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          primary: LIGHT_COLORS.primary,
          background: LIGHT_COLORS.background,
          card: LIGHT_COLORS.surface,
          text: LIGHT_COLORS.text,
          border: LIGHT_COLORS.border,
          notification: LIGHT_COLORS.primary,
        },
      };

  return (
    <>
      <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} />
      <NavigationContainer
        ref={navigationRef}
        theme={navigationTheme}
        onStateChange={state => {
          // Track current screen for notification filtering
          const route = state?.routes[state.index];
          if (route) {
            // Check if it's a nested navigator (like MainNavigator tabs)
            const nestedRoute = route.state?.routes?.[route.state.index];
            const screenName = nestedRoute?.name || route.name;
            setCurrentScreen(screenName);
          }
        }}
      >
        <RootNavigator />
      </NavigationContainer>
    </>
  );
};

const App = () => {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <InAppNotificationProvider>
          <AppContent />
        </InAppNotificationProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
};

export default App;
