import React, { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Container } from '../../../components';
import { useSettingsStore } from '../../../store/settingsStore';
import { useAuthStore } from '../../../store/authStore';
import { useContactStore } from '../../../store/contactStore';
import { useTheme } from '../../../contexts/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { styles } from './styles';
import { SettingSwitchProps, SettingOptionProps } from './types';

const SettingsScreen = () => {
  const navigation = useNavigation();
  const { user, signOut } = useAuthStore();
  const settings = useSettingsStore();
  const { syncContactsToFirebase, isSyncing, lastSynced, contacts } =
    useContactStore();
  const { colors, t, isDarkMode, isRTL } = useTheme();

  // Dynamic colors
  const bgColor = colors.background;
  const textColor = colors.text;

  useEffect(() => {
    if (user?.uid) {
      settings.loadFromFirebase(user.uid);
    }
  }, [user?.uid]);

  const handleLogout = () => {
    Alert.alert(
      isRTL ? 'تسجيل الخروج' : 'Logout',
      isRTL ? 'هل تريد تسجيل الخروج؟' : 'Are you sure you want to logout?',
      [
        { text: isRTL ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: isRTL ? 'خروج' : 'Logout',
          style: 'destructive',
          onPress: () => signOut(),
        },
      ],
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      isRTL ? 'حذف الحساب' : 'Delete Account',
      isRTL
        ? 'هل أنت متأكد؟ سيتم حذف جميع بياناتك نهائياً ولا يمكن استعادتها.'
        : 'Are you sure? All your data will be permanently deleted and cannot be recovered.',
      [
        { text: isRTL ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: isRTL ? 'حذف' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              Alert.alert(
                isRTL ? 'تواصل معنا' : 'Contact Us',
                isRTL
                  ? 'لحذف حسابك نهائياً، تواصل معنا على iropitapp@gmail.com'
                  : 'To permanently delete your account, contact us at iropitapp@gmail.com',
              );
            } catch (error) {
              Alert.alert('Error', 'Failed to delete account');
            }
          },
        },
      ],
    );
  };

  const saveAndSync = async (key: string, value: any) => {
    await settings.updateSetting(key as any, value);
    if (user?.uid) {
      await settings.syncToFirebase(user.uid);
    }
  };

  const SettingSwitch = ({
    title,
    subtitle,
    value,
    settingKey,
  }: SettingSwitchProps) => (
    <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
      <View style={styles.settingLeft}>
        <View style={styles.settingText}>
          <Text style={[styles.settingTitle, { color: colors.text }]}>
            {title}
          </Text>
          {subtitle && (
            <Text
              style={[styles.settingSubtitle, { color: colors.textSecondary }]}
            >
              {subtitle}
            </Text>
          )}
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={val => saveAndSync(settingKey, val)}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={value ? colors.white : colors.surfaceTertiary}
      />
    </View>
  );

  const SettingOption = ({ title, value, onPress }: SettingOptionProps) => (
    <TouchableOpacity
      style={[styles.settingRow, { borderBottomColor: colors.border }]}
      onPress={onPress}
    >
      <View style={styles.settingLeft}>
        <View style={styles.settingText}>
          <Text style={[styles.settingTitle, { color: colors.text }]}>
            {title}
          </Text>
          <Text
            style={[styles.settingSubtitle, { color: colors.textSecondary }]}
          >
            {value}
          </Text>
        </View>
      </View>
      <Icon
        name={isRTL ? 'chevron-back' : 'chevron-forward'}
        size={20}
        color={colors.textSecondary}
      />
    </TouchableOpacity>
  );

  const showSyncIntervalPicker = () => {
    Alert.alert(t('syncInterval'), '', [
      { text: t('everyMinute'), onPress: () => saveAndSync('syncInterval', 1) },
      {
        text: t('every5Minutes'),
        onPress: () => saveAndSync('syncInterval', 5),
      },
      {
        text: t('every15Minutes'),
        onPress: () => saveAndSync('syncInterval', 15),
      },
      {
        text: t('every30Minutes'),
        onPress: () => saveAndSync('syncInterval', 30),
      },
      { text: t('everyHour'), onPress: () => saveAndSync('syncInterval', 60) },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  const showLanguagePicker = () => {
    Alert.alert(t('language'), '', [
      { text: t('arabic'), onPress: () => saveAndSync('language', 'ar') },
      { text: t('english'), onPress: () => saveAndSync('language', 'en') },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  const getSyncIntervalText = () => {
    const interval = settings.syncInterval;
    if (interval === 1) return t('everyMinute');
    if (interval === 60) return t('everyHour');
    return settings.language === 'ar'
      ? `كل ${interval} دقيقة`
      : `Every ${interval} minutes`;
  };

  return (
    <Container
      isDark={isDarkMode}
      noPaddingHorizontal
      backgroundColor={bgColor}
      edges={['top', 'left', 'right']}
    >
      {/* Header with back button and title inline */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Icon
            name={isRTL ? 'arrow-forward' : 'arrow-back'}
            size={24}
            color={colors.primary}
          />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor }]}>
          {t('deviceSettings')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={[styles.scrollContent, { backgroundColor: bgColor }]}>
        {/* Notifications Section */}
        <Text style={[styles.sectionTitle, { color: colors.primaryText }]}>
          🔔 {t('notifications')}
        </Text>
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <SettingSwitch
            title={t('callNotifications')}
            value={settings.callNotifications}
            settingKey="callNotifications"
          />
          <SettingSwitch
            title={t('chatNotifications')}
            value={settings.chatNotifications}
            settingKey="chatNotifications"
          />
          <SettingSwitch
            title={t('notificationSound')}
            value={settings.notificationSound}
            settingKey="notificationSound"
          />
        </View>

        {/* Contacts Sync Section */}
        <Text style={[styles.sectionTitle, { color: colors.primaryText }]}>
          📇 {isRTL ? 'جهات الاتصال' : 'Contacts'}
        </Text>
        <View style={[styles.section, { backgroundColor: colors.surface }]}>
          <TouchableOpacity
            style={[styles.settingRow, { borderBottomColor: colors.border }]}
            onPress={syncContactsToFirebase}
            disabled={isSyncing}
          >
            <View style={styles.settingLeft}>
              <View style={styles.settingText}>
                <Text style={[styles.settingTitle, { color: colors.text }]}>
                  {isRTL ? 'مزامنة جهات الاتصال' : 'Sync Contacts'}
                </Text>
                <Text
                  style={[
                    styles.settingSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  {isSyncing
                    ? isRTL
                      ? 'جاري المزامنة...'
                      : 'Syncing...'
                    : lastSynced
                    ? `${isRTL ? 'آخر مزامنة:' : 'Last sync:'} ${new Date(
                        lastSynced,
                      ).toLocaleString()}`
                    : `${contacts.length} ${isRTL ? 'جهة اتصال' : 'contacts'}`}
                </Text>
              </View>
            </View>
            {isSyncing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="sync-outline" size={24} color={colors.primary} />
            )}
          </TouchableOpacity>
        </View>

        {/* Logout Button */}
        <TouchableOpacity
          style={[styles.logoutButton, { backgroundColor: colors.surface }]}
          onPress={handleLogout}
        >
          <Icon
            name="log-out-outline"
            size={22}
            color={colors.warning}
            style={{ marginRight: 12 }}
          />
          <Text style={[styles.logoutButtonText, { color: colors.text }]}>
            {isRTL ? 'تسجيل الخروج' : 'Logout'}
          </Text>
        </TouchableOpacity>

        {/* Delete Account Button */}
        <TouchableOpacity
          style={[styles.deleteButton, { backgroundColor: colors.surface }]}
          onPress={handleDeleteAccount}
        >
          <Icon
            name="trash-outline"
            size={22}
            color={colors.error}
            style={{ marginRight: 12 }}
          />
          <Text style={[styles.deleteButtonText]}>
            {isRTL ? 'حذف الحساب' : 'Delete Account'}
          </Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </Container>
  );
};

export default SettingsScreen;
