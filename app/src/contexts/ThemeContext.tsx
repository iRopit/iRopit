import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNRestart from 'react-native-restart';
import { useSettingsStore } from '../store/settingsStore';
import { LIGHT_COLORS, DARK_COLORS } from '../theme/colors';
import { FONT_FAMILY as FONTS } from '../theme/typography';
import { SPACING, RADIUS } from '../theme/spacing';

// Arabic translations
const AR_TRANSLATIONS = {
  // Tabs
  sms: 'الرسائل',
  calls: 'المكالمات',
  chat: 'المحادثات',
  menu: 'المزيد',

  // Menu
  account: 'الحساب',
  accountInfo: 'معلومات الحساب',
  settings: 'الإعدادات',
  privacy: 'السياسة والخصوصية',
  terms: 'شروط الاستخدام',
  about: 'لمحة عن التطبيق',
  deleteAccount: 'حذف الحساب',
  logout: 'تسجيل الخروج',
  menuTitle: 'القائمة',
  editProfile: 'تعديل الملف الشخصي',
  updateInfo: 'تحديث معلوماتك',
  smsCallsAlerts: 'الرسائل والمكالمات والتنبيهات',
  deviceSettings: 'إعدادات الجهاز',
  manageDevices: 'إدارة أجهزتك',
  legalPrivacy: 'قانوني وخصوصية',
  protectData: 'كيف نحمي بياناتك',
  termsConditions: 'الشروط والأحكام',
  dangerZone: 'منطقة الخطر',
  signOutAccount: 'تسجيل الخروج من حسابك',

  // User Settings
  userSettings: 'إعدادات المستخدم',
  profileInfo: 'معلومات الملف الشخصي',
  email: 'البريد الإلكتروني',
  displayName: 'اسم العرض',
  edit: 'تعديل',
  changePassword: 'تغيير كلمة المرور',
  updatePassword: 'تحديث كلمة المرور',
  permanentlyDelete: 'حذف الحساب نهائياً',
  smsVibration: 'اهتزاز الرسائل',
  smsVibrationDesc: 'اهتزاز عند وصول رسالة',
  callNotifications: 'إشعارات المكالمات',
  enableDoNotDisturb: 'تفعيل عدم الإزعاج',
  enableDoNotDisturbDesc: 'كتم الإشعارات خلال الساعات المحددة',

  // Notification Settings
  notificationSettings: 'إعدادات الإشعارات',
  enableSmsNotif: 'تفعيل إشعارات الرسائل',
  enableSmsNotifDesc: 'عرض إشعارات الرسائل الواردة',
  smsSound: 'صوت الرسائل',
  smsSoundDesc: 'تشغيل صوت لإشعارات الرسائل',
  enableCallNotif: 'تفعيل إشعارات المكالمات',
  enableCallNotifDesc: 'عرض إشعارات المكالمات الواردة',
  callSound: 'صوت المكالمات',
  callSoundDesc: 'تشغيل صوت لإشعارات المكالمات',
  vibration: 'الاهتزاز',
  vibrationDesc: 'تفعيل الاهتزاز للإشعارات',
  doNotDisturb: 'عدم الإزعاج',
  doNotDisturbDesc: 'كتم جميع الإشعارات مؤقتاً',

  // Settings
  notifications: 'الإشعارات',
  smsNotifications: 'إشعارات الرسائل',
  callNotifications: 'إشعارات المكالمات',
  chatNotifications: 'إشعارات الشات',
  notificationSound: 'صوت الإشعارات',
  sync: 'المزامنة',
  autoSync: 'مزامنة تلقائية',
  wifiOnly: 'WiFi فقط',
  syncInterval: 'فترة المزامنة',
  appearance: 'المظهر',
  darkMode: 'الوضع الليلي',
  language: 'اللغة',
  security: 'الأمان',
  appLock: 'قفل التطبيق',
  biometric: 'البصمة',

  // Common
  cancel: 'إلغاء',
  confirm: 'تأكيد',
  save: 'حفظ',
  delete: 'حذف',
  back: 'رجوع',
  arabic: 'العربية',
  english: 'English',

  // SMS/Conversation
  pleaseEnterMessage: 'الرجاء إدخال رسالة',
  couldNotDeterminePhone: 'تعذر تحديد رقم الهاتف',
  failedToSendSMS: 'فشل إرسال الرسالة',
  errorOccurred: 'حدث خطأ',

  // Status
  on: 'مفعل',
  off: 'معطل',

  // Change Password
  currentPassword: 'كلمة المرور الحالية',
  newPassword: 'كلمة المرور الجديدة',
  confirmPassword: 'تأكيد كلمة المرور',
  enterCurrentPassword: 'أدخل كلمة المرور الحالية',
  enterNewPassword: 'أدخل كلمة المرور الجديدة',
  confirmNewPassword: 'أكد كلمة المرور الجديدة',
  passwordChanged: 'تم تغيير كلمة المرور بنجاح',
  passwordsDoNotMatch: 'كلمتا المرور غير متطابقتين',
  passwordTooShort: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
  wrongPassword: 'كلمة المرور الحالية غير صحيحة',
  weakPassword: 'كلمة المرور ضعيفة جداً',
  recentLoginRequired:
    'يرجى تسجيل الخروج وإعادة تسجيل الدخول ثم المحاولة مرة أخرى',
  fillAllFields: 'يرجى ملء جميع الحقول',
  error: 'خطأ',
  success: 'نجاح',
  ok: 'حسناً',

  // Time
  everyMinute: 'كل دقيقة',
  every5Minutes: 'كل 5 دقائق',
  every15Minutes: 'كل 15 دقيقة',
  every30Minutes: 'كل 30 دقيقة',
  everyHour: 'كل ساعة',

  // Login Screen
  appTagline: 'مزامنة أجهزتك بسلاسة،\nاربطها',
  welcomeBack: 'مرحباً بك في iRopit',
  signInToContinue: 'سجل دخولك للمتابعة',
  emailPlaceholder: 'البريد الإلكتروني',
  passwordPlaceholder: 'كلمة المرور',
  forgotPassword: 'نسيت كلمة المرور؟',
  forgotPasswordTitle: 'إعادة تعيين كلمة المرور',
  forgotPasswordSubtitle: 'أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين',
  sendResetLink: 'إرسال رابط الاسترداد',
  resetLinkSent: 'تم الإرسال! تحقق من بريدك الإلكتروني',
  resetEmailSentDesc: 'أرسلنا رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني',
  backToLogin: 'العودة لتسجيل الدخول',
  resetFailed: 'فشل إرسال رابط الاسترداد',
  loginButton: 'تسجيل الدخول',
  orDivider: 'أو',
  googleSignIn: 'تسجيل الدخول بجوجل',
  noAccount: 'ليس لديك حساب؟',
  signUp: 'إنشاء حساب',
  loginFailed: 'فشل تسجيل الدخول',
  googleSignInFailed: 'فشل تسجيل الدخول بجوجل',

  // SignUp Screen
  createAccount: 'إنشاء حساب',
  signUpSubtitle: 'سجل للبدء',
  fullName: 'الاسم الكامل',
  confirmPasswordPlaceholder: 'تأكيد كلمة المرور',
  creatingAccount: 'جاري إنشاء الحساب...',
  signUpButton: 'إنشاء حساب',
  googleSignUp: 'المتابعة بجوجل',
  hasAccount: 'لديك حساب بالفعل؟',
  signIn: 'تسجيل الدخول',
  passwordsNotMatch: 'كلمتا المرور غير متطابقتين',
  passwordMinLength: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل',
  signUpFailed: 'فشل إنشاء الحساب',
  googleSignUpFailed: 'فشل التسجيل بجوجل',

  // Validation Errors
  emailRequired: 'البريد الإلكتروني مطلوب',
  passwordRequired: 'كلمة المرور مطلوبة',
  nameRequired: 'الاسم مطلوب',
  confirmPasswordRequired: 'يرجى تأكيد كلمة المرور',

  // Account Screen
  noEmail: 'لا يوجد بريد',
  signOut: 'تسجيل الخروج',

  // Notifications Screen
  loading: 'جاري التحميل...',
  enableNotificationAccess: 'تفعيل الوصول للإشعارات',
  notificationPermissionDesc:
    'iRopit يحتاج إذن الوصول للإشعارات لمزامنة الرسائل',
  enableAccess: 'تفعيل الوصول',
  noMessagesYet: 'لا توجد رسائل',
  messagesWillAppear: 'ستظهر رسائلك هنا عند استلام الإشعارات',
};

// English translations
const EN_TRANSLATIONS = {
  // Tabs
  sms: 'Messages',
  calls: 'Calls',
  chat: 'Chat',
  menu: 'More',

  // Menu
  account: 'Account',
  accountInfo: 'Account Info',
  settings: 'Settings',
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  about: 'About',
  deleteAccount: 'Delete Account',
  logout: 'Logout',
  menuTitle: 'Menu',
  editProfile: 'Edit Profile',
  updateInfo: 'Update your information',
  smsCallsAlerts: 'SMS, Calls, and alerts',
  deviceSettings: 'Device Settings',
  manageDevices: 'Manage your devices',
  legalPrivacy: 'Legal & Privacy',
  protectData: 'How we protect your data',
  termsConditions: 'Our terms and conditions',
  dangerZone: 'Danger Zone',
  signOutAccount: 'Sign out of your account',

  // User Settings
  userSettings: 'User Settings',
  profileInfo: 'Profile Information',
  email: 'Email',
  displayName: 'Display Name',
  edit: 'Edit',
  changePassword: 'Change Password',
  updatePassword: 'Update your password',
  permanentlyDelete: 'Permanently delete your account',
  smsVibration: 'SMS Vibration',
  smsVibrationDesc: 'Vibrate on SMS alerts',
  callNotifications: 'Call Notifications',
  enableDoNotDisturb: 'Enable Do Not Disturb',
  enableDoNotDisturbDesc: 'Silence notifications during set hours',

  // Notification Settings
  notificationSettings: 'Notification Settings',
  enableSmsNotif: 'Enable SMS Notifications',
  enableSmsNotifDesc: 'Show notifications for incoming SMS',
  smsSound: 'SMS Sound',
  smsSoundDesc: 'Play sound for SMS alerts',
  enableCallNotif: 'Enable Call Notifications',
  enableCallNotifDesc: 'Show notifications for incoming calls',
  callSound: 'Call Sound',
  callSoundDesc: 'Play sound for call alerts',
  vibration: 'Vibration',
  vibrationDesc: 'Enable vibration for notifications',
  doNotDisturb: 'Do Not Disturb',
  doNotDisturbDesc: 'Mute all notifications temporarily',

  // Settings
  notifications: 'Notifications',
  smsNotifications: 'SMS Notifications',
  callNotifications: 'Call Notifications',
  chatNotifications: 'Chat Notifications',
  notificationSound: 'Notification Sound',
  sync: 'Sync',
  autoSync: 'Auto Sync',
  wifiOnly: 'WiFi Only',
  syncInterval: 'Sync Interval',
  appearance: 'Appearance',
  darkMode: 'Dark Mode',
  language: 'Language',
  security: 'Security',
  appLock: 'App Lock',
  biometric: 'Biometric',

  // Common
  cancel: 'Cancel',
  confirm: 'Confirm',
  save: 'Save',
  delete: 'Delete',
  back: 'Back',
  arabic: 'العربية',
  english: 'English',

  // SMS/Conversation
  pleaseEnterMessage: 'Please enter a message',
  couldNotDeterminePhone: 'Could not determine phone number',
  failedToSendSMS: 'Failed to send SMS',
  errorOccurred: 'An error occurred',

  // Status
  on: 'On',
  off: 'Off',

  // Change Password
  currentPassword: 'Current Password',
  newPassword: 'New Password',
  confirmPassword: 'Confirm Password',
  enterCurrentPassword: 'Enter current password',
  enterNewPassword: 'Enter new password',
  confirmNewPassword: 'Confirm new password',
  passwordChanged: 'Password changed successfully',
  passwordsDoNotMatch: 'Passwords do not match',
  passwordTooShort: 'Password must be at least 6 characters',
  wrongPassword: 'Current password is incorrect',
  weakPassword: 'Password is too weak',
  recentLoginRequired: 'Please logout and login again, then try again',
  fillAllFields: 'Please fill all fields',
  error: 'Error',
  success: 'Success',
  ok: 'OK',

  // Time
  everyMinute: 'Every minute',
  every5Minutes: 'Every 5 minutes',
  every15Minutes: 'Every 15 minutes',
  every30Minutes: 'Every 30 minutes',
  everyHour: 'Every hour',

  // Login Screen
  appTagline: 'Connect Your Android Device to Your Computer,\nRope it.',
  welcomeBack: 'Welcome to iRopit',
  signInToContinue: 'Sign in to continue',
  emailPlaceholder: 'Email Address',
  passwordPlaceholder: 'Password',
  forgotPassword: 'Forgot Password?',
  forgotPasswordTitle: 'Reset Password',
  forgotPasswordSubtitle: 'Enter your email and we\'ll send you a reset link',
  sendResetLink: 'Send Reset Link',
  resetLinkSent: 'Sent! Check your email',
  resetEmailSentDesc: 'We sent a password reset link to your email address',
  backToLogin: 'Back to Login',
  resetFailed: 'Failed to send reset link',
  loginButton: 'Login',
  orDivider: 'OR',
  googleSignIn: 'Sign in with Google',
  noAccount: "Don't have an account?",
  signUp: 'Sign Up',
  loginFailed: 'Login Failed',
  googleSignInFailed: 'Google Sign In Failed',

  // SignUp Screen
  createAccount: 'Create Account',
  signUpSubtitle: 'Sign up to get started',
  fullName: 'Full Name',
  confirmPasswordPlaceholder: 'Confirm Password',
  creatingAccount: 'Creating Account...',
  signUpButton: 'Sign Up',
  googleSignUp: 'Continue with Google',
  hasAccount: 'Already have an account?',
  signIn: 'Sign In',
  passwordsNotMatch: 'Passwords do not match',
  passwordMinLength: 'Password must be at least 6 characters',
  signUpFailed: 'Sign Up Failed',
  googleSignUpFailed: 'Google Sign In Failed',

  // Validation Errors
  emailRequired: 'Email is required',
  passwordRequired: 'Password is required',
  nameRequired: 'Name is required',
  confirmPasswordRequired: 'Please confirm your password',

  // Account Screen
  noEmail: 'No email',
  signOut: 'Sign Out',

  // Notifications Screen
  loading: 'Loading...',
  enableNotificationAccess: 'Enable Notification Access',
  notificationPermissionDesc:
    'iRopit needs permission to read notifications for syncing messages.',
  enableAccess: 'Enable Access',
  noMessagesYet: 'No Messages Yet',
  messagesWillAppear:
    'Your messages will appear here when you receive notifications.',
};

type TranslationKey = keyof typeof AR_TRANSLATIONS;

interface ThemeContextType {
  colors: typeof LIGHT_COLORS;
  fonts: typeof FONTS;
  spacing: typeof SPACING;
  radius: typeof RADIUS;
  isDarkMode: boolean;
  language: 'ar' | 'en';
  isRTL: boolean;
  t: (key: TranslationKey) => string;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { darkMode, language } = useSettingsStore();
  const [isHydrated, setIsHydrated] = React.useState(false);

  // Wait for Zustand persist to hydrate before checking language
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsHydrated(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isHydrated) return; // Don't run until store is hydrated

    const handleLanguageChange = async () => {
      // Check saved language
      const savedLanguage = await AsyncStorage.getItem('app_language');

      if (!savedLanguage) {
        // First time - just save and set RTL
        const isRTL = language === 'ar';
        I18nManager.allowRTL(isRTL);
        I18nManager.forceRTL(isRTL);
        await AsyncStorage.setItem('app_language', language);
        return;
      }

      // Language changed - need to restart
      if (savedLanguage !== language) {
        const isRTL = language === 'ar';
        I18nManager.allowRTL(isRTL);
        I18nManager.forceRTL(isRTL);

        // Save BEFORE restart
        await AsyncStorage.setItem('app_language', language);

        // Restart to apply RTL changes
        if (Platform.OS === 'android') {
          RNRestart.restart();
        }
      }
      // If savedLanguage === language, do nothing (already correct)
    };

    handleLanguageChange();
  }, [language, isHydrated]);

  const value = useMemo(() => {
    const colors = darkMode ? DARK_COLORS : LIGHT_COLORS;
    const translations = language === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS;

    return {
      colors,
      fonts: FONTS,
      spacing: SPACING,
      radius: RADIUS,
      isDarkMode: darkMode,
      language,
      isRTL: language === 'ar',
      t: (key: TranslationKey) => translations[key] || key,
    };
  }, [darkMode, language]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    // Return default values if not in provider
    return {
      colors: LIGHT_COLORS,
      fonts: FONTS,
      spacing: SPACING,
      radius: RADIUS,
      isDarkMode: false,
      language: 'ar',
      isRTL: false,
      t: (key: TranslationKey) => AR_TRANSLATIONS[key] || key,
    };
  }
  return context;
};

export type { TranslationKey };
