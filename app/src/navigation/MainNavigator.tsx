import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, I18nManager } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MainTabParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useSettingsStore } from '../store/settingsStore';
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

  // Define tabs in order - will be reversed for LTR
  const tabs = [
     {
      name: 'Chat' as const,
      component: ChatScreen,
      titleAr: 'المحادثات',
      titleEn: 'Messages',
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
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
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
