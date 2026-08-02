import React, { useEffect, useRef, useCallback } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, I18nManager, BackHandler, AppState, AppStateStatus } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MainTabParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { useDeviceStore } from '../store/deviceStore';
import { useCallStore } from '../store/callStore';
import { useSMSStore } from '../store/smsStore';
import { useNotificationStore } from '../store/notificationStore';
import { useDeviceFilterStore } from '../store/deviceFilterStore';
import { LIGHT_COLORS, DARK_COLORS } from '../theme/colors';
import { navigationRef } from './navigationRef';
// ServiceStatusBanner removed - permissions are handled in onboarding

import NotificationsScreen from '../screens/main/NotificationsScreen';
import SMSNotificationsScreen from '../screens/main/SMSNotificationsScreen';
import CallsScreen from '../screens/main/CallsScreen';
import ChatScreen from '../screens/main/ChatScreen';
import MenuNavigator from './MenuNavigator';

const Tab = createBottomTabNavigator<MainTabParamList>();

const MainNavigator = () => {
  const { isRTL, t } = useTheme();
  const { darkMode, language } = useSettingsStore();
  const colors = darkMode ? DARK_COLORS : LIGHT_COLORS;
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const currentDevice = useDeviceStore(s => s.currentDevice);
  const selectedCallsDeviceId = useDeviceFilterStore(s => s.callsDeviceId);
  const selectedSmsDeviceId = useDeviceFilterStore(s => s.smsDeviceId);
  const prefetched = useRef(false);

  // Back button: only exit the app when on a top-level tab (nothing to go back to).
  // We check navigationRef (the root NavigationContainer ref) instead of the
  // local navigation object, because useNavigation() here is scoped to the
  // 'Main' screen in the root stack — its canGoBack() is always false even
  // when CallDetail / Conversation / sub-menu screens are pushed on top.
  // navigationRef.canGoBack() inspects the entire navigation tree correctly.
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigationRef.isReady() && navigationRef.canGoBack()) {
        return false; // Let React Navigation pop the top screen
      }
      BackHandler.exitApp();
      return true;
    });
    return () => handler.remove();
  }, []);

  // Pre-fetch all store data so tabs load instantly
  useEffect(() => {
    if (prefetched.current || !user || !currentDevice) return;
    prefetched.current = true;
    useCallStore.getState().loadCalls(selectedCallsDeviceId || undefined);
    useSMSStore.getState().loadMessages(selectedSmsDeviceId || undefined);
    useNotificationStore.getState().syncFromFirebase(user.uid);
  }, [user, currentDevice, selectedCallsDeviceId, selectedSmsDeviceId]);

  // Re-establish Firestore listeners when app comes back to foreground.
  // Firestore connections can go stale when the OS throttles background
  // processes, causing new SMS/calls to not appear until a manual refresh.
  useEffect(() => {
    if (!user || !currentDevice) return;
    const appStateRef = { current: AppState.currentState };
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (
          appStateRef.current !== 'active' &&
          nextState === 'active'
        ) {
          useCallStore.getState().loadCalls(selectedCallsDeviceId || undefined);
          useSMSStore.getState().loadMessages(selectedSmsDeviceId || undefined);
        }
        appStateRef.current = nextState;
      },
    );
    return () => subscription.remove();
  }, [user, currentDevice, selectedCallsDeviceId, selectedSmsDeviceId]);

  // Define tabs in order - will be reversed for LTR
  const tabs = [
     {
      name: 'Chat' as const,
      component: ChatScreen,
      titleAr: 'المحادثات',
      titleEn: 'Chat',
      icon: 'chatbubbles',
    },
    {
      name: 'SMS' as const,
      component: SMSNotificationsScreen,
      titleAr: 'الرسائل',
      titleEn: 'SMS',
      icon: 'chatbubble',
    },
     {
      name: 'Calls' as const,
      component: CallsScreen,
      titleAr: 'المكالمات',
      titleEn: 'Calls',
      icon: 'call',
    },
    {
      name: 'Notifications' as const,
      component: NotificationsScreen,
      titleAr: 'الإشعارات',
      titleEn: 'Notifications',
      icon: 'notifications',
    },
   
   
    {
      name: 'Menu' as const,
      component: MenuNavigator,
      titleAr: 'القائمة',
      titleEn: 'Menu',
      icon: 'menu',
    },
  ];

  // Manual tab ordering based on RTL/LTR
  // In both RTL and LTR, we want SMS (Notifications) to appear first from the starting side
  // RTL (Arabic): SMS should be on the right (first in array)
  // LTR (English): SMS should be on the left (first in array)
  const orderedTabs = tabs;

  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr' }}>
      <Tab.Navigator
        key={language} // Force re-mount when language changes
        backBehavior="none"
        detachInactiveScreens={true}
        screenOptions={{
          // Prevent hidden tabs from re-rendering on every global store update.
          // This reduces intermittent lag when switching between menu tabs.
          freezeOnBlur: true,
          lazy: true,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: 0.5,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 44) + 4,
            height: 64 + Math.max(insets.bottom, 44),
            flexDirection: isRTL ? 'row-reverse' : 'row',
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '500',
            marginTop: 2,
          },
          headerShown: false,
        }}
      >
        {orderedTabs.map(tab => (
          <Tab.Screen
            key={tab.name}
            name={tab.name}
            component={tab.component}
            options={{
              title: isRTL ? tab.titleAr : tab.titleEn,
              tabBarIcon: ({ color, focused }) => (
                <Icon
                  name={focused ? tab.icon : `${tab.icon}-outline`}
                  size={24}
                  color={color}
                />
              ),
            }}
          />
        ))}
      </Tab.Navigator>
    </View>
  );
};

export default MainNavigator;
