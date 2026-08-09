import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../../contexts/ThemeContext';
import { useSettingsStore } from '../../../store/settingsStore';
import { useAuthStore } from '../../../store/authStore';
import Icon from 'react-native-vector-icons/Ionicons';

import { NotificationSettingsScreenProps } from './types';
import { styles } from './styles';

const NotificationSettingsScreen = ({
  navigation,
}: NotificationSettingsScreenProps) => {
  const { colors, t, isDarkMode, isRTL } = useTheme();
  const { user } = useAuthStore();
  const settings = useSettingsStore();
  const [isLoading, setIsLoading] = useState(false);

  // Dynamic colors
  const bgColor = colors.background;
  const textColor = colors.text;

  useEffect(() => {
    if (user?.uid) {
      settings.loadFromFirebase(user.uid);
    }
  }, [user?.uid]);

  const handleToggleSetting = async (key: string, value: boolean) => {
    setIsLoading(true);
    try {
      await settings.saveSetting(key, value, user?.uid);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: bgColor }]}
      edges={['top', 'left', 'right']}
    >
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      {/* Header with back button */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Icon
            name={isRTL ? 'chevron-forward' : 'chevron-back'}
            size={28}
            color={colors.primary}
          />
        </TouchableOpacity>
      </View>

      {/* Title */}
      <View style={styles.titleContainer}>
        <Text style={[styles.title, { color: textColor }]}>
          {t('notificationSettings')}
        </Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={[styles.section, { borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('smsNotifications')}
          </Text>

          <View style={[styles.settingItem, { borderColor: colors.border }]}>
            <View style={styles.settingContent}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                {t('enableSmsNotif')}
              </Text>
              <Text
                style={[
                  styles.settingSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                {t('enableSmsNotifDesc')}
              </Text>
            </View>
            <Switch
              value={settings.enableSmsNotifications}
              onValueChange={value =>
                handleToggleSetting('enableSmsNotifications', value)
              }
              disabled={isLoading}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={
                settings.enableSmsNotifications ? colors.success : colors.surfaceTertiary
              }
            />
          </View>

          <View style={[styles.settingItem, { borderColor: colors.border }]}>
            <View style={styles.settingContent}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                {t('smsSound')}
              </Text>
              <Text
                style={[
                  styles.settingSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                {t('smsSoundDesc')}
              </Text>
            </View>
            <Switch
              value={settings.smsSoundEnabled}
              onValueChange={value =>
                handleToggleSetting('smsSoundEnabled', value)
              }
              disabled={isLoading || !settings.enableSmsNotifications}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={settings.smsSoundEnabled ? colors.success : colors.surfaceTertiary}
            />
          </View>

          <View style={[styles.settingItem, { borderColor: colors.border }]}>
            <View style={styles.settingContent}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                {t('smsVibration')}
              </Text>
              <Text
                style={[
                  styles.settingSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                {t('smsVibrationDesc')}
              </Text>
            </View>
            <Switch
              value={settings.smsVibrationEnabled}
              onValueChange={value =>
                handleToggleSetting('smsVibrationEnabled', value)
              }
              disabled={isLoading || !settings.enableSmsNotifications}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={
                settings.smsVibrationEnabled ? colors.success : colors.surfaceTertiary
              }
            />
          </View>
        </View>

        <View style={[styles.section, { borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('callNotifications')}
          </Text>

          <View style={[styles.settingItem, { borderColor: colors.border }]}>
            <View style={styles.settingContent}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                {t('enableCallNotif')}
              </Text>
              <Text
                style={[
                  styles.settingSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                {t('enableCallNotifDesc')}
              </Text>
            </View>
            <Switch
              value={settings.enableCallNotifications}
              onValueChange={value =>
                handleToggleSetting('enableCallNotifications', value)
              }
              disabled={isLoading}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={
                settings.enableCallNotifications ? colors.success : colors.surfaceTertiary
              }
            />
          </View>

          <View style={[styles.settingItem, { borderColor: colors.border }]}>
            <View style={styles.settingContent}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                {t('callSound')}
              </Text>
              <Text
                style={[
                  styles.settingSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                {t('callSoundDesc')}
              </Text>
            </View>
            <Switch
              value={settings.callSoundEnabled}
              onValueChange={value =>
                handleToggleSetting('callSoundEnabled', value)
              }
              disabled={isLoading || !settings.enableCallNotifications}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={
                settings.callSoundEnabled ? colors.success : colors.surfaceTertiary
              }
            />
          </View>
        </View>

        <View style={[styles.section, { borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('doNotDisturb')}
          </Text>

          <View style={[styles.settingItem, { borderColor: colors.border }]}>
            <View style={styles.settingContent}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                {t('enableDoNotDisturb')}
              </Text>
              <Text
                style={[
                  styles.settingSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                {t('enableDoNotDisturbDesc')}
              </Text>
            </View>
            <Switch
              value={settings.doNotDisturbEnabled}
              onValueChange={value =>
                handleToggleSetting('doNotDisturbEnabled', value)
              }
              disabled={isLoading}
              trackColor={{ false: colors.borderDark, true: colors.primary }}
              thumbColor={
                settings.doNotDisturbEnabled ? colors.success : colors.surfaceTertiary
              }
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default NotificationSettingsScreen;
