import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

interface PrivacyPolicyStepProps {
  isRTL: boolean;
  colors: {
    text: string;
    textSecondary: string;
    surface: string;
    surfaceSecondary: string;
    border: string;
    borderLight: string;
    primary: string;
    primaryLight: string;
    background: string;
    success: string;
    error: string;
    [key: string]: string;
  };
  accepted: boolean;
  onAccept: (accepted: boolean) => void;
}

interface PermissionItem {
  icon: string;
  titleEn: string;
  titleAr: string;
  descEn: string;
  descAr: string;
  purposeEn: string;
  purposeAr: string;
}

const PERMISSIONS_LIST: PermissionItem[] = [
  {
    icon: 'notifications',
    titleEn: 'Notification Access',
    titleAr: 'إذن قراءة الإشعارات',
    descEn: 'Read device notifications',
    descAr: 'قراءة إشعارات الجهاز',
    purposeEn:
      'Sync SMS and app notifications with your Chrome Extension in real-time',
    purposeAr:
      'مزامنة الرسائل القصيرة وإشعارات التطبيقات مع إضافة Chrome في الوقت الفعلي',
  },
  {
    icon: 'notifications-outline',
    titleEn: 'Push Notifications',
    titleAr: 'الإشعارات الفورية',
    descEn:
      'iRopit collects and transmits Android notification content, notification titles, application names, and notification timestamps from your device to your authenticated Chrome Extension.',
    descAr: 'عرض الإشعارات الفورية',
    purposeEn:
      'This permission is required to:\n\n• Display mobile notifications on your desktop browser.\n• Show real-time alerts from installed applications.\n• Keep notifications synchronized across your connected devices.\n• Allow you to view important mobile activity without checking your phone.\n\nNotification data is securely transmitted only to your authenticated iRopit account and connected devices and is not used for advertising purposes.',
    purposeAr: 'تنبيهك بالرسائل الجديدة والمكالمات الفائتة والتحديثات المهمة',
  },
  {
    icon: 'mail-open-outline',
    titleEn: 'Read SMS',
    titleAr: 'قراءة الرسائل القصيرة',
    descEn:
      "iRopit collects and uploads SMS messages, SMS content, sender information, message timestamps, and SMS log data from your device to iRopit's secure servers, even when the app is closed, minimized, or not actively in use.",
    descAr: 'قراءة الرسائل المرسلة والمستلمة',
    purposeEn:
      'This data is required to provide core iRopit features, including:\n\n• Real-time SMS synchronization with your connected Chrome Extension.\n• Desktop pop-up notifications for incoming messages.\n• OTP code retrieval and display on your desktop.\n• Cross-device access to SMS conversations.\n\nSMS data is transmitted only to your authenticated iRopit account and connected devices. It is not sold to third parties or used for advertising purposes.',
    purposeAr: 'مزامنة سجل محادثات SMS الكامل مع إضافة Chrome للوصول السلس',
  },
  {
    icon: 'call-outline',
    titleEn: 'Phone & Call Log',
    titleAr: 'سجل الهاتف والمكالمات',
    descEn:
      'iRopit collects and transmits call log information, including incoming calls, outgoing calls, missed calls, phone numbers, call duration, call timestamps, and call status from your device to your authenticated Chrome Extension.',
    descAr: 'الوصول إلى سجل المكالمات وحالة الهاتف',
    purposeEn:
      'This permission is required to:\n\n• Display call activity on your desktop browser.\n• Show incoming and missed call notifications in real-time.\n• Synchronize call history across your connected devices.\n• Help you identify and manage calls without accessing your phone.\n\nCall log data is securely transmitted only to your authenticated iRopit account and connected devices. It is not sold to third parties or used for advertising purposes.',
    purposeAr:
      'تتبع المكالمات الواردة والصادرة والفائتة مع المدة والوقت لعرضها على إضافة Chrome',
  },
  {
    icon: 'people-outline',
    titleEn: 'Contacts',
    titleAr: 'جهات الاتصال',
    descEn: 'Read your contacts list',
    descAr: 'قراءة قائمة جهات الاتصال',
    purposeEn:
      'Display contact names alongside calls and messages instead of just phone numbers',
    purposeAr:
      'عرض أسماء جهات الاتصال بجانب المكالمات والرسائل بدلاً من أرقام الهاتف فقط',
  },
];

const PrivacyPolicyStep: React.FC<PrivacyPolicyStepProps> = ({
  isRTL,
  colors,
  accepted,
  onAccept,
}) => {
  // Animations
  const shieldAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const itemAnims = useRef(
    PERMISSIONS_LIST.map(() => new Animated.Value(0)),
  ).current;
  const checkboxScale = useRef(new Animated.Value(1)).current;
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  useEffect(() => {
    // Shield entrance
    Animated.spring(shieldAnim, {
      toValue: 1,
      tension: 40,
      friction: 8,
      useNativeDriver: true,
    }).start();

    // Content fade in
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      delay: 200,
      useNativeDriver: true,
    }).start();

    // Staggered permission items
    Animated.stagger(
      80,
      itemAnims.map(anim =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: true,
        }),
      ),
    ).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = () => {
    const newValue = !accepted;
    onAccept(newValue);

    // Bounce animation on checkbox
    Animated.sequence([
      Animated.timing(checkboxScale, {
        toValue: 0.8,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(checkboxScale, {
        toValue: 1,
        tension: 200,
        friction: 10,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isAtBottom =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - 40;
    if (isAtBottom && !scrolledToBottom) {
      setScrolledToBottom(true);
    }
  };

  const t = (en: string, ar: string) => (isRTL ? ar : en);

  return (
    <View style={localStyles.container}>
      {/* Header with animated shield */}
      <Animated.View
        style={[
          localStyles.headerContainer,
          {
            opacity: shieldAnim,
            transform: [
              {
                scale: shieldAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.5, 1],
                }),
              },
            ],
          },
        ]}
      >
        <View
          style={[
            localStyles.shieldBadge,
            { backgroundColor: `${colors.primary}15` },
          ]}
        >
          <Icon name="document-text" size={32} color={colors.primary} />
          <View
            style={[
              localStyles.shieldCheckBadge,
              { backgroundColor: colors.primary },
            ]}
          >
            <Icon name="shield-checkmark" size={14} color="#FFFFFF" />
          </View>
        </View>

        <Text
          style={[
            localStyles.title,
            { color: colors.text },
          ]}
        >
          {t('Privacy Policy & Terms', 'سياسة الخصوصية والشروط')}
        </Text>
        <Text
          style={[
            localStyles.subtitle,
            { color: colors.textSecondary },
          ]}
        >
          {t(
            'Please review our policy before continuing',
            'يرجى مراجعة سياستنا قبل المتابعة',
          )}
        </Text>
      </Animated.View>

      {/* Scrollable Policy Content */}
      <Animated.View
        style={[
          localStyles.scrollContainer,
          {
            opacity: fadeAnim,
            borderColor: colors.borderLight,
            backgroundColor: colors.surface,
          },
        ]}
      >
        <ScrollView
          style={localStyles.scrollView}
          contentContainerStyle={localStyles.scrollContent}
          showsVerticalScrollIndicator={true}
          onScroll={handleScroll}
          scrollEventThrottle={100}
        >
          {/* Introduction Section */}
          <View style={localStyles.section}>
            <View
              style={[
                localStyles.sectionHeader,
                { backgroundColor: `${colors.primary}10` },
              ]}
            >
              <Icon
                name="information-circle"
                size={20}
                color={colors.primary}
              />
              <Text
                style={[
                  localStyles.sectionTitle,
                  { color: colors.primary },
                ]}
              >
                {t('About iRopit', 'حول iRopit')}
              </Text>
            </View>
            <Text
              style={[
                localStyles.bodyText,
                { color: colors.text },
              ]}
            >
              {t(
                'To use iRopit, please review our core terms and data governance policies. We are committed to protecting your personal information and ensuring your digital data remains private, secure, and fully encrypted.\n\nYou can view our complete legal documentation at any time using the links provided.',
                'لاستخدام iRopit، يرجى مراجعة الشروط الأساسية وسياسات حوكمة البيانات الخاصة بنا. نحن ملتزمون بحماية معلوماتك الشخصية وضمان بقاء بياناتك الرقمية خاصة وآمنة ومشفرة بالكامل.\n\nيمكنك الاطلاع على وثائقنا القانونية الكاملة في أي وقت عبر الروابط المتاحة.',
              )}
            </Text>
          </View>

          {/* Data Collection Section */}
          <View style={localStyles.section}>
            <View
              style={[
                localStyles.sectionHeader,
                { backgroundColor: `${colors.primary}10` },
              ]}
            >
              <Icon name="server" size={20} color={colors.primary} />
              <Text
                style={[
                  localStyles.sectionTitle,
                  { color: colors.primary },
                ]}
              >
                {t('Data Collection & Storage', 'جمع البيانات وتخزينها')}
              </Text>
            </View>
            <Text
              style={[
                localStyles.bodyText,
                { color: colors.text },
              ]}
            >
              {t(
                'Your data is encrypted with AES-256 end-to-end encryption before being stored in Firebase. Only you can decrypt and read your data using your unique encryption key tied to your account. We do not sell, share, or analyze your personal data.',
                'يتم تشفير بياناتك بتشفير AES-256 من طرف لطرف قبل تخزينها في Firebase. أنت وحدك من يمكنه فك تشفير وقراءة بياناتك باستخدام مفتاح التشفير الفريد المرتبط بحسابك. نحن لا نبيع أو نشارك أو نحلل بياناتك الشخصية.',
              )}
            </Text>
          </View>

          {/* Permissions Section */}
          <View style={localStyles.section}>
            <View
              style={[
                localStyles.sectionHeader,
                { backgroundColor: `${colors.primary}10` },
              ]}
            >
              <Icon name="key" size={20} color={colors.primary} />
              <Text
                style={[
                  localStyles.sectionTitle,
                  { color: colors.primary },
                ]}
              >
                {t('Permissions We Request', 'الصلاحيات التي نطلبها')}
              </Text>
            </View>
            <Text
              style={[
                localStyles.bodyTextSmall,
                {
                  color: colors.textSecondary,
                  marginBottom: 12,
                },
              ]}
            >
              {t(
                'Below are the permissions this app requires and why each is needed:',
                'فيما يلي الصلاحيات التي يتطلبها هذا التطبيق وسبب الحاجة لكل منها:',
              )}
            </Text>

            {PERMISSIONS_LIST.map((perm, index) => (
              <Animated.View
                key={index}
                style={[
                  localStyles.permissionCard,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderLight,
                    opacity: itemAnims[index],
                    transform: [
                      {
                        translateY: itemAnims[index].interpolate({
                          inputRange: [0, 1],
                          outputRange: [20, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View
                  style={[
                    localStyles.permIconContainer,
                    { backgroundColor: `${colors.primary}12` },
                  ]}
                >
                  <Icon name={perm.icon} size={22} color={colors.primary} />
                </View>
                <View style={localStyles.permContent}>
                  <Text
                    style={[
                      localStyles.permTitle,
                      { color: colors.text },
                    ]}
                  >
                    {isRTL ? perm.titleAr : perm.titleEn}
                  </Text>
                  <Text
                    style={[
                      localStyles.permDesc,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {isRTL ? perm.descAr : perm.descEn}
                  </Text>
                  <View
                    style={[
                      localStyles.purposeBadge,
                      { backgroundColor: `${colors.success}12` },
                    ]}
                  >
                    <Icon
                      name="checkmark-circle"
                      size={14}
                      color={colors.success}
                    />
                    <Text
                      style={[
                        localStyles.purposeText,
                        { color: colors.success },
                      ]}
                    >
                      {isRTL ? perm.purposeAr : perm.purposeEn}
                    </Text>
                  </View>
                </View>
              </Animated.View>
            ))}
          </View>

          {/* User Rights Section */}
          <View style={localStyles.section}>
            <View
              style={[
                localStyles.sectionHeader,
                { backgroundColor: `${colors.primary}10` },
              ]}
            >
              <Icon name="person-circle" size={20} color={colors.primary} />
              <Text
                style={[
                  localStyles.sectionTitle,
                  { color: colors.primary },
                ]}
              >
                {t('Your Rights', 'حقوقك')}
              </Text>
            </View>

            {[
              {
                icon: 'trash-outline',
                en: 'Delete your data at any time from account settings',
                ar: 'حذف بياناتك في أي وقت من إعدادات الحساب',
              },
              {
                icon: 'close-circle-outline',
                en: 'Revoke any permission at any time from device settings',
                ar: 'إلغاء أي صلاحية في أي وقت من إعدادات الجهاز',
              },
              {
                icon: 'log-out-outline',
                en: 'Delete your account and all associated data permanently',
                ar: 'حذف حسابك وجميع البيانات المرتبطة به نهائياً',
              },
            ].map((right, index) => (
              <View
                key={index}
                style={localStyles.rightItem}
              >
                <Icon
                  name={right.icon}
                  size={18}
                  color={colors.primary}
                  style={{ marginRight: 10 }}
                />
                <Text
                  style={[
                    localStyles.rightText,
                    { color: colors.text },
                  ]}
                >
                  {isRTL ? right.ar : right.en}
                </Text>
              </View>
            ))}
          </View>

          {/* Contact Section */}
          <View style={[localStyles.section, { marginBottom: 20 }]}>
            <View
              style={[
                localStyles.sectionHeader,
                { backgroundColor: `${colors.primary}10` },
              ]}
            >
              <Icon name="mail" size={20} color={colors.primary} />
              <Text
                style={[
                  localStyles.sectionTitle,
                  { color: colors.primary },
                ]}
              >
                {t('Contact Us', 'تواصل معنا')}
              </Text>
            </View>
            <Text
              style={[
                localStyles.bodyText,
                { color: colors.text },
              ]}
            >
              {t(
                'If you have any questions about this privacy policy or your data, please contact us at: info@iRopit.com',
                'إذا كان لديك أي أسئلة حول سياسة الخصوصية أو بياناتك، يرجى التواصل معنا على: info@iRopit.com',
              )}
            </Text>
          </View>
        </ScrollView>
      </Animated.View>

      {/* Agreement Checkbox */}
      <TouchableOpacity
        style={[
          localStyles.checkboxContainer,
          {
            backgroundColor: accepted ? `${colors.success}10` : colors.surface,
            borderColor: accepted ? colors.success : colors.border,
          },
        ]}
        onPress={handleToggle}
        activeOpacity={0.7}
      >
        <Animated.View
          style={[
            localStyles.checkbox,
            {
              backgroundColor: accepted ? colors.success : 'transparent',
              borderColor: accepted ? colors.success : colors.border,
              transform: [{ scale: checkboxScale }],
            },
          ]}
        >
          {accepted && <Icon name="checkmark" size={16} color="#FFFFFF" />}
        </Animated.View>
        <Text
          style={[
            localStyles.checkboxLabel,
            { color: colors.text, marginLeft: 12, marginRight: isRTL ? 16 : 0 },
          ]}
        >
          {t(
            'I have read and agree to the Privacy Policy and Terms of Service',
            'لقد قرأت وأوافق على سياسة الخصوصية وشروط الخدمة',
          )}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 12,
    width: '100%',
  },
  shieldBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  shieldCheckBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.8,
    textAlign: 'center',
  },
  scrollContainer: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 10,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
  },
  bodyText: {
    fontSize: 13.5,
    lineHeight: 22,
    opacity: 0.9,
  },
  bodyTextSmall: {
    fontSize: 12.5,
    lineHeight: 20,
  },
  permissionCard: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  permIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permContent: {
    flex: 1,
    marginLeft: 12,
  },
  permTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  permDesc: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 6,
  },
  purposeBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  purposeText: {
    fontSize: 11.5,
    lineHeight: 17,
    flex: 1,
    fontWeight: '500',
    marginLeft: 6,
  },
  rightItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  rightText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 4,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 20,
    marginLeft: 12,
  },
});

export default PrivacyPolicyStep;
