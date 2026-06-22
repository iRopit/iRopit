import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useAuthStore } from '../../../store/authStore';
import { useDeviceStore } from '../../../store/deviceStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useTheme } from '../../../contexts/ThemeContext';
import { MenuSection } from './types';

export const useMenuScreen = (
  navigation: any,
  onOpenShareDeviceModal?: () => void,
) => {
  const { user, signOut } = useAuthStore();
  const { currentDevice, deleteDevice } = useDeviceStore();
  const settings = useSettingsStore();
  const { colors, t, isDarkMode, isRTL } = useTheme();

  // Dynamic colors for iOS-like design
  const bgColor = colors.background;
  const textColor = colors.text;

  const saveAndSync = useCallback(
    async (key: string, value: any) => {
      await settings.updateSetting(key as any, value);
      if (user?.uid) {
        await settings.syncToFirebase(user.uid);
      }
    },
    [settings, user?.uid],
  );

  const showLanguagePicker = useCallback(() => {
    Alert.alert(t('language'), '', [
      { text: t('arabic'), onPress: () => saveAndSync('language', 'ar') },
      { text: t('english'), onPress: () => saveAndSync('language', 'en') },
      { text: t('cancel'), style: 'cancel' },
    ]);
  }, [t, saveAndSync]);

  const handleLogout = useCallback(() => {
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
  }, [isRTL, signOut]);

  const handleDeleteDevice = useCallback(() => {
    Alert.alert(
      isRTL ? 'حذف هذا الجهاز' : 'Delete This Device',
      isRTL
        ? 'هل أنت متأكد؟ سيتم حذف هذا الجهاز وسيتم تسجيل الخروج تلقائياً.'
        : 'Are you sure? This device will be removed and you will be signed out.',
      [
        { text: isRTL ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: isRTL ? 'حذف' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!currentDevice) {
              signOut();
              return;
            }
            deleteDevice(currentDevice.id).catch(() => {
              // still sign out even if delete fails
            });
            signOut();
          },
        },
      ],
    );
  }, [isRTL, currentDevice, deleteDevice, signOut]);

  const navigateToUserSettings = useCallback(() => {
    navigation.navigate('UserSettings');
  }, [navigation]);

  const navigateToPrivacyPolicy = useCallback(() => {
    navigation.navigate('PrivacyPolicy');
  }, [navigation]);

  const navigateToTermsOfService = useCallback(() => {
    navigation.navigate('TermsOfService');
  }, [navigation]);

  const menuSections: MenuSection[] = [
    {
      title: t('appearance'),
      items: [
        {
          icon: 'moon-outline',
          title: t('darkMode'),
          subtitle: isDarkMode ? t('on') : t('off'),
          danger: false,
          isSwitch: true,
          value: settings.darkMode,
          settingKey: 'darkMode',
        },
        {
          icon: 'language-outline',
          title: t('language'),
          subtitle: settings.language === 'ar' ? t('arabic') : t('english'),
          danger: false,
          onPress: showLanguagePicker,
        },
      ],
    },
    {
      title: t('legalPrivacy'),
      items: [
        {
          icon: 'shield-checkmark-outline',
          title: t('privacy'),
          subtitle: t('protectData'),
          danger: false,
          onPress: navigateToPrivacyPolicy,
        },
        {
          icon: 'document-text-outline',
          title: t('terms'),
          subtitle: t('termsConditions'),
          danger: false,
          onPress: navigateToTermsOfService,
        },
      ],
    },
    {
      title: isRTL ? 'الجهاز' : 'Device',
      items: [
        {
          icon: 'share-social-outline',
          title: isRTL ? 'مشاركة هذا الجهاز' : 'Share This Device',
          subtitle: isRTL
            ? 'مشاركة الرسائل والمكالمات والإشعارات مع حساب iRopit آخر'
            : 'Share SMS, calls, and notifications with another iRopit account',
          danger: false,
          onPress: onOpenShareDeviceModal,
        },
      ],
    },
    {
      title: t('account'),
      items: [
        {
          icon: 'log-out-outline',
          title: isRTL ? 'تسجيل الخروج' : 'Logout',
          subtitle: '',
          danger: false,
          iconColor: colors.warning,
          onPress: handleLogout,
        },
        {
          icon: 'trash-outline',
          title: isRTL ? 'حذف هذا الجهاز' : 'Delete This Device',
          subtitle: '',
          danger: true,
          onPress: handleDeleteDevice,
        },
      ],
    },
  ];

  return {
    // Data
    user,
    currentDevice,
    settings,
    menuSections,

    // Theme
    colors,
    t,
    isDarkMode,
    isRTL,
    bgColor,
    textColor,

    // Actions
    saveAndSync,
    navigateToUserSettings,
  };
};
