import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useAuthStore } from '../../../store/authStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useTheme } from '../../../contexts/ThemeContext';
import { MenuSection } from './types';

export const useMenuScreen = (navigation: any) => {
  const { user, signOut } = useAuthStore();
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

  const handleDeleteAccount = useCallback(() => {
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
          onPress: () => {
            Alert.alert(
              isRTL ? 'تواصل معنا' : 'Contact Us',
              isRTL
                ? 'لحذف حسابك نهائياً، تواصل معنا على iropitapp@gmail.com'
                : 'To permanently delete your account, contact us at iropitapp@gmail.com',
            );
          },
        },
      ],
    );
  }, [isRTL]);

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
