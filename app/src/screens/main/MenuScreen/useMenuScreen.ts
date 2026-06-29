import { useCallback } from 'react';
import { useAuthStore } from '../../../store/authStore';
import { useDeviceStore } from '../../../store/deviceStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useTheme } from '../../../contexts/ThemeContext';
import { MenuSection } from './types';

export const useMenuScreen = (
  navigation: any,
  onOpenShareDeviceModal?: () => void,
  onOpenLanguageModal?: () => void,
  onOpenLogoutModal?: () => void,
  onOpenDeleteDeviceModal?: () => void,
  onOpenDeleteAccountModal?: () => void,
) => {
  const { user, signOut, deleteAccount } = useAuthStore();
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
    onOpenLanguageModal?.();
  }, [onOpenLanguageModal]);

  const setLanguage = useCallback(
    async (language: 'ar' | 'en') => {
      await saveAndSync('language', language);
    },
    [saveAndSync],
  );

  const handleLogout = useCallback(() => {
    onOpenLogoutModal?.();
  }, [onOpenLogoutModal]);

  const performLogout = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const handleDeleteDevice = useCallback(() => {
    onOpenDeleteDeviceModal?.();
  }, [onOpenDeleteDeviceModal]);

  const performDeleteDevice = useCallback(async () => {
    if (!currentDevice) {
      await signOut();
      return;
    }

    await deleteDevice(currentDevice.id).catch(() => {
      // still sign out even if delete fails
    });
    await signOut();
  }, [currentDevice, deleteDevice, signOut]);

  const handleDeleteAccount = useCallback(() => {
    onOpenDeleteAccountModal?.();
  }, [onOpenDeleteAccountModal]);

  const performDeleteAccount = useCallback(async () => {
    await deleteAccount();
  }, [deleteAccount]);

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
        {
          icon: 'trash',
          title: isRTL ? 'حذف الحساب' : 'Delete Account',
          subtitle: '',
          danger: true,
          onPress: handleDeleteAccount,
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
    setLanguage,
    navigateToUserSettings,
    performLogout,
    performDeleteDevice,
    performDeleteAccount,
  };
};
