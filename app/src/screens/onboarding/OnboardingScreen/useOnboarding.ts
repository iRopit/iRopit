import { useState, useCallback, useEffect } from 'react';
import {
  Platform,
  PermissionsAndroid,
  Appearance,
  Vibration,
  NativeModules,
} from 'react-native';
import { useSettingsStore } from '../../../store/settingsStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Permission } from './types';
import { LIGHT_COLORS, DARK_COLORS } from '../../../theme/colors';

const { NotificationModule } = NativeModules;

const ONBOARDING_COMPLETE_KEY = '@onboarding_complete';
const ONBOARDING_STEP_KEY = '@onboarding_step';
const PERMISSIONS_GRANTED_KEY = '@permissions_granted';

export const useOnboarding = () => {
  // Detect system theme
  const systemColorScheme = Appearance.getColorScheme();
  const systemTheme: 'light' | 'dark' =
    systemColorScheme === 'dark' ? 'dark' : 'light';

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState<
    'light' | 'dark' | 'system'
  >(systemTheme); // Start with system's current theme instead of 'system'
  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>(systemTheme);
  const [selectedLanguage, setSelectedLanguage] = useState<'ar' | 'en'>('en');
  const [showThemeSheet, setShowThemeSheet] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([
    {
      id: 'notificationListener',
      name: 'Notification Access',
      nameAr: 'إذن قراءة الإشعارات',
      description: 'Read SMS and app notifications to sync with other devices',
      descriptionAr: 'قراءة الرسائل والإشعارات لمزامنتها مع الأجهزة الأخرى',
      icon: 'notifications',
      required: true,
      granted: false,
    },
    {
      id: 'notifications',
      name: 'Push Notifications',
      nameAr: 'الإشعارات',
      description: 'Receive notifications about new messages and calls',
      descriptionAr: 'تلقي إشعارات حول الرسائل والمكالمات الجديدة',
      icon: 'notifications-outline',
      required: true,
      granted: false,
    },
    {
      id: 'sendSms',
      name: 'Send SMS',
      nameAr: 'إرسال الرسائل',
      description: 'Send SMS from Chrome Extension using your phone number',
      descriptionAr: 'إرسال رسائل SMS من الإكستنشن باستخدام رقم هاتفك',
      icon: 'chatbubble-outline',
      required: true,
      granted: false,
    },
    {
      id: 'readSms',
      name: 'Read SMS',
      nameAr: 'قراءة الرسائل',
      description:
        'Read all SMS messages (sent & received) to sync with extension',
      descriptionAr:
        'قراءة جميع الرسائل المرسلة والمستلمة لمزامنتها مع الإكستنشن',
      icon: 'mail-open-outline',
      required: true,
      granted: false,
    },
    {
      id: 'phone',
      name: 'Phone & Call Log',
      nameAr: 'سجل المكالمات',
      description:
        'Track incoming, outgoing, and missed calls with duration and time',
      descriptionAr: 'رصد المكالمات الواردة والصادرة والفائتة مع المدة والوقت',
      icon: 'call-outline',
      required: true,
      granted: false,
    },
    {
      id: 'contacts',
      name: 'Contacts',
      nameAr: 'جهات الاتصال',
      description: 'Display contact names for incoming calls and messages',
      descriptionAr: 'عرض أسماء جهات الاتصال للمكالمات والرسائل الواردة',
      icon: 'people',
      required: false,
      granted: false,
    },
  ]);

  const settings = useSettingsStore();
  const isRTL = selectedLanguage === 'ar';
  const [allPermissionsGranted, setAllPermissionsGranted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [permissionsAlreadyHandled, setPermissionsAlreadyHandled] =
    useState(false);

  const totalSteps = 7; // Welcome, Language, PrivacyPolicy, Theme, Permissions, Overview, Security

  // Update actual theme when selection or system changes
  useEffect(() => {
    if (selectedTheme === 'system') {
      setActualTheme(systemTheme);
    } else {
      setActualTheme(selectedTheme);
    }
  }, [selectedTheme, systemTheme]);

  // Listen for system theme changes
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      if (selectedTheme === 'system' && colorScheme) {
        const newTheme: 'light' | 'dark' =
          colorScheme === 'dark' ? 'dark' : 'light';
        setActualTheme(newTheme);
      }
    });
    return () => subscription.remove();
  }, [selectedTheme]);

  // Save step progress
  useEffect(() => {
    AsyncStorage.setItem(ONBOARDING_STEP_KEY, String(currentStep));
  }, [currentStep]);

  // Load saved step on mount
  useEffect(() => {
    const loadStep = async () => {
      const savedStep = await AsyncStorage.getItem(ONBOARDING_STEP_KEY);
      if (savedStep) {
        setCurrentStep(parseInt(savedStep, 10));
      }
    };
    loadStep();
  }, []);

  // Check already granted permissions on mount
  useEffect(() => {
    const checkExistingPermissions = async () => {
      if (Platform.OS !== 'android') {
        // iOS - assume permissions handled separately
        const wasHandled = await AsyncStorage.getItem(PERMISSIONS_GRANTED_KEY);
        if (wasHandled === 'true') {
          setPermissionsAlreadyHandled(true);
          setAllPermissionsGranted(true);
        }
        return;
      }

      // Check NotificationListener permission (special system permission)
      let notificationListenerGranted = false;
      try {
        if (NotificationModule && NotificationModule.isPermissionGranted) {
          notificationListenerGranted =
            await NotificationModule.isPermissionGranted();
        }
      } catch (e) {
        console.log('Error checking notification listener:', e);
      }

      const checks = await Promise.all([
        Promise.resolve(notificationListenerGranted), // NotificationListener
        Platform.Version >= 33
          ? PermissionsAndroid.check(
              PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
            )
          : Promise.resolve(true),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS),
        // readSms: check both READ_SMS and RECEIVE_SMS
        Promise.all([
          PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
          PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
        ]).then(([read, receive]) => read && receive),
        // phone: check READ_PHONE_STATE and READ_CALL_LOG
        Promise.all([
          PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
          ),
          PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
          ),
        ]).then(([phoneState, callLog]) => phoneState && callLog),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CONTACTS),
      ]);

      setPermissions(prev =>
        prev.map((p, i) => ({ ...p, granted: checks[i] })),
      );

      // Check if required permissions are granted
      const requiredGranted =
        checks[0] && checks[1] && checks[2] && checks[3] && checks[4]; // notificationListener, notifications, sendSms, readSms, phone are required
      const allGranted = checks.every(c => c);

      setAllPermissionsGranted(allGranted);

      // Check if permissions were already handled before
      const wasHandled = await AsyncStorage.getItem(PERMISSIONS_GRANTED_KEY);
      if (wasHandled === 'true' || requiredGranted) {
        setPermissionsAlreadyHandled(true);
      }
    };
    checkExistingPermissions();
  }, []);

  // Trigger haptic feedback (using Vibration as fallback)
  const triggerHaptic = useCallback(
    (type: 'selection' | 'success' | 'warning' = 'selection') => {
      try {
        // Use simple vibration as haptic feedback
        const duration =
          type === 'success' ? 50 : type === 'warning' ? 100 : 10;
        Vibration.vibrate(duration);
      } catch {
        // Haptic not available
      }
    },
    [],
  );

  // Theme colors based on selection - using app theme colors
  const getColors = useCallback(() => {
    const isDark = actualTheme === 'dark';
    const themeColors = isDark ? DARK_COLORS : LIGHT_COLORS;

    return {
      // Primary brand colors from theme
      primary: themeColors.primary,
      primaryLight: themeColors.primaryLight,
      primaryDark: themeColors.primaryDark,
      accent: themeColors.secondary,

      // Backgrounds
      background: themeColors.background,
      surface: themeColors.surface,
      surfaceSecondary: themeColors.surfaceSecondary,

      // Text
      text: themeColors.text,
      textSecondary: themeColors.textSecondary,
      textTertiary: themeColors.textLight,

      // Borders
      border: themeColors.border,
      borderLight: themeColors.borderLight,

      // Status
      success: themeColors.success,
      error: themeColors.error,

      // Phone mockup
      phoneBorder: isDark ? '#444444' : '#1A1A1A',
      phoneScreen: themeColors.surface,
    };
  }, [actualTheme]);

  const requestPermission = useCallback(
    async (permissionId: string) => {
      if (Platform.OS !== 'android') {
        // iOS permissions are handled differently
        setPermissions(prev =>
          prev.map(p => (p.id === permissionId ? { ...p, granted: true } : p)),
        );
        return;
      }

      // Handle NotificationListener separately - requires system settings
      if (permissionId === 'notificationListener') {
        try {
          if (NotificationModule && NotificationModule.openSettings) {
            await NotificationModule.openSettings();
            // After user returns, we'll check permission status
            // Set up a polling interval to check when permission is granted
            const checkInterval = setInterval(async () => {
              try {
                const granted = await NotificationModule.isPermissionGranted();
                if (granted) {
                  clearInterval(checkInterval);
                  setPermissions(prev => {
                    const updated = prev.map(p =>
                      p.id === 'notificationListener'
                        ? { ...p, granted: true }
                        : p,
                    );
                    const allNowGranted = updated.every(p => p.granted);
                    setAllPermissionsGranted(allNowGranted);
                    return updated;
                  });
                  triggerHaptic('success');
                }
              } catch (e) {
                console.log('Error checking notification listener:', e);
              }
            }, 1000);
            // Clear interval after 60 seconds
            setTimeout(() => clearInterval(checkInterval), 60000);
          }
        } catch (error) {
          console.log('Error opening notification settings:', error);
        }
        return;
      }

      let permission: any;
      switch (permissionId) {
        case 'notifications':
          // Android 13+ requires POST_NOTIFICATIONS
          if (Platform.Version >= 33) {
            permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
          } else {
            setPermissions(prev =>
              prev.map(p =>
                p.id === permissionId ? { ...p, granted: true } : p,
              ),
            );
            return;
          }
          break;
        case 'sendSms':
          permission = PermissionsAndroid.PERMISSIONS.SEND_SMS;
          break;
        case 'readSms':
          // Request both READ_SMS and RECEIVE_SMS together
          try {
            const smsResults = await PermissionsAndroid.requestMultiple([
              PermissionsAndroid.PERMISSIONS.READ_SMS,
              PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
            ]);
            const bothGranted =
              smsResults[PermissionsAndroid.PERMISSIONS.READ_SMS] ===
                PermissionsAndroid.RESULTS.GRANTED &&
              smsResults[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] ===
                PermissionsAndroid.RESULTS.GRANTED;
            setPermissions(prev => {
              const updated = prev.map(p =>
                p.id === permissionId ? { ...p, granted: bothGranted } : p,
              );
              const allGrantedNow = updated.every(
                p => !p.required || p.granted,
              );
              setAllPermissionsGranted(allGrantedNow);
              return updated;
            });
            triggerHaptic(bothGranted ? 'success' : 'warning');
          } catch (e) {
            console.error('Error requesting SMS permissions:', e);
          }
          return; // Skip the generic request below
        case 'phone':
          // Request READ_PHONE_STATE and READ_CALL_LOG together
          try {
            const phoneResults = await PermissionsAndroid.requestMultiple([
              PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
              PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
            ]);
            const phoneGranted =
              phoneResults[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] ===
                PermissionsAndroid.RESULTS.GRANTED &&
              phoneResults[PermissionsAndroid.PERMISSIONS.READ_CALL_LOG] ===
                PermissionsAndroid.RESULTS.GRANTED;
            setPermissions(prev => {
              const updated = prev.map(p =>
                p.id === permissionId ? { ...p, granted: phoneGranted } : p,
              );
              const allGrantedNow = updated.every(
                p => !p.required || p.granted,
              );
              setAllPermissionsGranted(allGrantedNow);
              return updated;
            });
            triggerHaptic(phoneGranted ? 'success' : 'warning');
          } catch (e) {
            console.error('Error requesting phone permissions:', e);
          }
          return; // Skip the generic request below
        case 'contacts':
          permission = PermissionsAndroid.PERMISSIONS.READ_CONTACTS;
          break;
        default:
          return;
      }

      try {
        const result = await PermissionsAndroid.request(permission, {
          title: isRTL ? 'إذن مطلوب' : 'Permission Required',
          message: isRTL
            ? 'يحتاج التطبيق إلى هذا الإذن للعمل بشكل صحيح'
            : 'The app needs this permission to work properly',
          buttonPositive: isRTL ? 'موافق' : 'OK',
          buttonNegative: isRTL ? 'لاحقاً' : 'Later',
        });

        if (result === PermissionsAndroid.RESULTS.GRANTED) {
          setPermissions(prev => {
            const updated = prev.map(p =>
              p.id === permissionId ? { ...p, granted: true } : p,
            );
            // Check if all permissions are now granted
            const allNowGranted = updated.every(p => p.granted);
            setAllPermissionsGranted(allNowGranted);

            // Mark permissions as handled when required permissions are granted
            if (
              permissionId === 'notifications' ||
              permissionId === 'notificationListener'
            ) {
              setPermissionsAlreadyHandled(true);
              AsyncStorage.setItem(PERMISSIONS_GRANTED_KEY, 'true');
            }

            return updated;
          });
          triggerHaptic('success');
        }
      } catch (error) {
        console.error('Permission request error:', error);
      }
    },
    [isRTL, triggerHaptic],
  );

  const requestAllPermissions = useCallback(async () => {
    for (const permission of permissions.filter(p => !p.granted)) {
      await requestPermission(permission.id);
    }
  }, [permissions, requestPermission]);

  const completeOnboarding = useCallback(async () => {
    try {
      triggerHaptic('success');

      // Save settings (use actualTheme for system mode)
      await settings.updateSetting('darkMode', actualTheme === 'dark');
      await settings.updateSetting('language', selectedLanguage);

      // Mark onboarding as complete and clear step
      await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
      await AsyncStorage.removeItem(ONBOARDING_STEP_KEY);

      return true;
    } catch (error) {
      console.error('Error completing onboarding:', error);
      return false;
    }
  }, [settings, actualTheme, selectedLanguage, triggerHaptic]);

  const goNext = useCallback(() => {
    if (currentStep < totalSteps - 1) {
      triggerHaptic('selection');
      let nextStep = currentStep + 1;

      // Skip permissions step (step 4) if permissions were already handled
      if (nextStep === 4 && permissionsAlreadyHandled) {
        nextStep = 5; // Skip to Overview
      }

      setCurrentStep(nextStep);
    }
  }, [currentStep, totalSteps, triggerHaptic, permissionsAlreadyHandled]);

  const goBack = useCallback(() => {
    if (currentStep > 0) {
      triggerHaptic('selection');
      let prevStep = currentStep - 1;

      // Skip permissions step (step 4) if permissions were already handled
      if (prevStep === 4 && permissionsAlreadyHandled) {
        prevStep = 3; // Skip to Theme selection
      }

      setCurrentStep(prevStep);
    }
  }, [currentStep, triggerHaptic, permissionsAlreadyHandled]);

  const goToStep = useCallback(
    (step: number) => {
      if (step >= 0 && step < totalSteps) {
        setCurrentStep(step);
      }
    },
    [totalSteps],
  );

  const skip = useCallback(() => {
    triggerHaptic('selection');
    // Skip to last step (Overview)
    setCurrentStep(totalSteps - 1);
  }, [totalSteps, triggerHaptic]);

  return {
    // State
    currentStep,
    totalSteps,
    selectedTheme,
    actualTheme,
    selectedLanguage,
    showThemeSheet,
    permissions,
    isRTL,
    allPermissionsGranted,
    privacyAccepted,
    permissionsAlreadyHandled,

    // Colors
    getColors,

    // Actions
    setSelectedTheme,
    setSelectedLanguage,
    setShowThemeSheet,
    setPrivacyAccepted,
    goNext,
    goBack,
    goToStep,
    skip,
    requestPermission,
    requestAllPermissions,
    completeOnboarding,
    triggerHaptic,
  };
};

// Check if onboarding has been completed
export const checkOnboardingComplete = async (): Promise<boolean> => {
  try {
    const value = await AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY);
    return value === 'true';
  } catch {
    return false;
  }
};

// Reset onboarding (for testing)
export const resetOnboarding = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(ONBOARDING_COMPLETE_KEY);
  } catch (error) {
    console.error('Error resetting onboarding:', error);
  }
};
