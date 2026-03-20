import React, { useEffect, useRef, useCallback } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, I18nManager, BackHandler } from 'react-native';
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
import { LIGHT_COLORS, DARK_COLORS } from '../theme/colors';
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
  const prefetched = useRef(false);
  const navigation = useNavigation();

  // Back button: minimize the app when on a main tab.
  // Sub-screen navigation (Conversation, CallDetail, Menu→Settings) is
  // handled automatically by React Navigation's built-in back handler
  // (NavigationContainer). We only need to intercept when there's nothing
  // to go back to — i.e. the user is on a top-level tab.
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Let React Navigation handle sub-screen back navigation.
      // navigation.canGoBack() checks the entire focused navigator tree.
      if (navigation.canGoBack()) {
        return false; // Pass to React Navigation's handler
      }
      BackHandler.exitApp();
      return true;
    });
    return () => handler.remove();
  }, [navigation]);

  // Pre-fetch all store data so tabs load instantly
  useEffect(() => {
    if (prefetched.current || !user || !currentDevice) return;
    prefetched.current = true;
    useCallStore.getState().loadCalls();
    useSMSStore.getState().loadMessages();
    useNotificationStore.getState().syncFromFirebase(user.uid);
  }, [user, currentDevice]);

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
        screenOptions={{
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
