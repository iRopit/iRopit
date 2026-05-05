import React, { useEffect } from 'react';
import {
  StatusBar,
  LogBox,
  Alert,
  NativeModules,
  Platform,
  PermissionsAndroid,
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
  const { initialize, isLoading, isAuthenticated, error } = useAuthStore();
  const { darkMode } = useSettingsStore();

  // Initialize native event listeners for SMS and Calls - true to enable listening
  useNativeEvents(true);
  useEffect(() => {
    initializeFirebase();
    initialize();

    // Check Notification Access permission on app start (only after onboarding)
    if (Platform.OS === 'android' && NotificationModule) {
      const checkNotificationAccess = async () => {
        try {
          // Only show alert if user has completed onboarding
          const onboardingComplete = await checkOnboardingComplete();
          if (!onboardingComplete) {
            return; // Skip alert if onboarding not complete
          }

          // Request SMS permissions if not granted (for BroadcastReceiver fallback)
          const hasReceiveSms = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
          );
          const hasReadSms = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.READ_SMS,
          );
          if (!hasReceiveSms || !hasReadSms) {
            await PermissionsAndroid.requestMultiple([
              PermissionsAndroid.PERMISSIONS.READ_SMS,
              PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
            ]);
          }

          // Request CALL_PHONE so DialerActivity can place calls directly (no extra tap)
          const hasCallPhone = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.CALL_PHONE,
          );
          if (!hasCallPhone) {
            await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.CALL_PHONE,
              {
                title: 'Allow iRopit to make calls',
                message: 'iRopit needs permission to place calls from the extension.',
                buttonPositive: 'Allow',
              },
            );
          }

          // Request POST_NOTIFICATIONS on Android 13+ — without it, ALL app
          // notifications (including the dial-prompt) are silently suppressed.
          if (Platform.Version >= 33) {
            const hasNotifPerm = await PermissionsAndroid.check(
              'android.permission.POST_NOTIFICATIONS' as any,
            );
            if (!hasNotifPerm) {
              await PermissionsAndroid.request(
                'android.permission.POST_NOTIFICATIONS' as any,
              );
            }
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
      // Small delay to let UI render first
      setTimeout(checkNotificationAccess, 2000);
    }

    // Handle foreground FCM messages (push notifications when app is open)
    const unsubscribeForeground = messaging().onMessage(async remoteMessage => {
      console.log('[FCM] Foreground message received:', remoteMessage);

      const msgType  = remoteMessage.data?.type;
      const title    = remoteMessage.notification?.title || remoteMessage.data?.senderName || 'New Message';
      const msgBody  = remoteMessage.notification?.body  || remoteMessage.data?.messagePreview || '';
      const chatId   = remoteMessage.data?.chatId   || remoteMessage.data?.messageId || '';
      const pushDocId = remoteMessage.data?.pushDocId || '';

      if (msgType === 'chat') {
        // Show notifee notification with action buttons for chat messages
        try {
          await notifee.displayNotification({
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
      <StatusBar
        barStyle={darkMode ? 'light-content' : 'dark-content'}
        backgroundColor={darkMode ? DARK_COLORS.surface : LIGHT_COLORS.primary}
      />
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
