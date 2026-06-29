import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Switch,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import firestore from '@react-native-firebase/firestore';
import { Container } from '../../../components';
import { useAuthStore } from '../../../store/authStore';
import { useDeviceStore } from '../../../store/deviceStore';
import { useTheme } from '../../../contexts/ThemeContext';
import { styles } from './styles';
import { getInitials } from './helper';
import { MenuScreenProps } from './types';
import { useMenuScreen } from './useMenuScreen';
import { APP_VERSION } from '../../../constants';

type SharePermissions = {
  sms?: boolean;
  calls?: boolean;
  notifications?: boolean;
};

type ExistingShare = {
  shareId: string;
  sharedWithEmail: string;
  sharedWithUid?: string;
  permissions?: SharePermissions;
};

type PendingRequest = {
  requestId: string;
  sharedWithEmail: string;
  sharedWithUid?: string;
  permissions?: SharePermissions;
};

const MenuScreen = ({ navigation }: MenuScreenProps) => {
  const authUser = useAuthStore(state => state.user);
  const activeDevice = useDeviceStore(state => state.currentDevice);
  const { isRTL: isRtlNow } = useTheme();

  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareSms, setShareSms] = useState(true);
  const [shareCalls, setShareCalls] = useState(true);
  const [shareNotifications, setShareNotifications] = useState(true);
  const [shareError, setShareError] = useState('');
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [isSubmittingShare, setIsSubmittingShare] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [isChangingLanguage, setIsChangingLanguage] = useState(false);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [deleteDeviceModalVisible, setDeleteDeviceModalVisible] = useState(false);
  const [isDeletingDevice, setIsDeletingDevice] = useState(false);
  const [deleteAccountModalVisible, setDeleteAccountModalVisible] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [existingShares, setExistingShares] = useState<ExistingShare[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);

  const openShareDeviceModal = useCallback(async () => {
    setShareModalVisible(true);
    setShareError('');
    setShareEmail('');
    setShareSms(true);
    setShareCalls(true);
    setShareNotifications(true);
    setIsLoadingShares(true);

    try {
      const user = authUser;
      const currentDevice = activeDevice;
      if (!user?.uid || !currentDevice?.id) {
        setShareError(
          isRtlNow
            ? 'لا يمكن تحديد الجهاز الحالي حالياً.'
            : 'Current device is not ready yet.',
        );
        setExistingShares([]);
        setPendingRequests([]);
        return;
      }

      const [sharesSnap, pendingSnap] = await Promise.all([
        firestore()
          .collection('deviceShares')
          .where('ownerUid', '==', user.uid)
          .where('deviceId', '==', currentDevice.id)
          .get(),
        firestore()
          .collection('deviceShareRequests')
          .where('ownerUid', '==', user.uid)
          .where('deviceId', '==', currentDevice.id)
          .where('status', '==', 'pending')
          .get(),
      ]);

      const loadedShares: ExistingShare[] = sharesSnap.docs.map(doc => ({
        shareId: doc.id,
        ...(doc.data() as any),
      }));
      const loadedPending: PendingRequest[] = pendingSnap.docs.map(doc => ({
        requestId: doc.id,
        ...(doc.data() as any),
      }));

      setExistingShares(loadedShares);
      setPendingRequests(loadedPending);
    } catch {
      setShareError(
        isRtlNow
          ? 'فشل تحميل المشاركات الحالية.'
          : 'Failed to load current shares.',
      );
      setExistingShares([]);
      setPendingRequests([]);
    } finally {
      setIsLoadingShares(false);
    }
  }, [activeDevice, authUser, isRtlNow]);

  const {
    user,
    currentDevice,
    settings,
    menuSections,
    colors,
    t,
    isDarkMode,
    isRTL,
    bgColor,
    textColor,
    saveAndSync,
    setLanguage,
    navigateToUserSettings,
    performLogout,
    performDeleteDevice,
    performDeleteAccount,
  } = useMenuScreen(
    navigation,
    openShareDeviceModal,
    () => setLanguageModalVisible(true),
    () => setLogoutModalVisible(true),
    () => setDeleteDeviceModalVisible(true),
    () => setDeleteAccountModalVisible(true),
  );

  const getCurrentDeviceName = () =>
    (currentDevice as any)?.nickname ||
    currentDevice?.name ||
    (currentDevice as any)?.model ||
    (isRTL ? 'هذا الجهاز' : 'This device');

  const getPermissionsText = (permissions?: SharePermissions) => {
    const list = [
      permissions?.sms && (isRTL ? 'الرسائل' : 'SMS'),
      permissions?.calls && (isRTL ? 'المكالمات' : 'Calls'),
      permissions?.notifications && (isRTL ? 'الإشعارات' : 'Notifications'),
    ].filter(Boolean);
    if (list.length === 0) return isRTL ? 'لا شيء' : 'None';
    return list.join(', ');
  };

  const closeShareModal = () => {
    setShareModalVisible(false);
    setShareError('');
  };

  const closeDeleteDeviceModal = () => {
    if (isDeletingDevice) return;
    setDeleteDeviceModalVisible(false);
  };

  const closeLanguageModal = () => {
    if (isChangingLanguage) return;
    setLanguageModalVisible(false);
  };

  const handleSelectLanguage = async (language: 'ar' | 'en') => {
    if (isChangingLanguage) return;
    setIsChangingLanguage(true);
    try {
      await setLanguage(language);
      setLanguageModalVisible(false);
    } finally {
      setIsChangingLanguage(false);
    }
  };

  const closeLogoutModal = () => {
    if (isLoggingOut) return;
    setLogoutModalVisible(false);
  };

  const handleConfirmLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await performLogout();
      setLogoutModalVisible(false);
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleConfirmDeleteDevice = async () => {
    if (isDeletingDevice) return;
    setIsDeletingDevice(true);
    try {
      await performDeleteDevice();
      setDeleteDeviceModalVisible(false);
    } finally {
      setIsDeletingDevice(false);
    }
  };

  const closeDeleteAccountModal = () => {
    if (isDeletingAccount) return;
    setDeleteAccountModalVisible(false);
  };

  const handleConfirmDeleteAccount = async () => {
    if (isDeletingAccount) return;
    setIsDeletingAccount(true);
    try {
      await performDeleteAccount();
      setDeleteAccountModalVisible(false);
    } catch (error: any) {
      const message =
        error?.getLocalizedMessage?.('en') ||
        error?.message ||
        (isRTL
          ? 'تعذر حذف الحساب. يرجى إعادة تسجيل الدخول ثم المحاولة مرة أخرى.'
          : 'Could not delete account. Please sign in again and try one more time.');
      Alert.alert(isRTL ? 'خطأ' : 'Error', message);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleSubmitShare = async () => {
    const email = shareEmail.trim().toLowerCase();

    if (!email) {
      setShareError(
        isRTL
          ? 'يرجى إدخال البريد الإلكتروني للمستلم.'
          : 'Please enter a recipient email.',
      );
      return;
    }
    if (email === user?.email?.toLowerCase()) {
      setShareError(
        isRTL
          ? 'لا يمكنك مشاركة الجهاز مع نفسك.'
          : 'You cannot share a device with yourself.',
      );
      return;
    }
    if (!shareSms && !shareCalls && !shareNotifications) {
      setShareError(
        isRTL
          ? 'يرجى تحديد نوع واحد على الأقل للمشاركة.'
          : 'Select at least one item to share.',
      );
      return;
    }
    if (!user?.uid || !currentDevice?.id) {
      setShareError(
        isRTL
          ? 'الجهاز الحالي غير متاح حالياً.'
          : 'Current device is not available yet.',
      );
      return;
    }

    const exists = existingShares.some(
      s => (s.sharedWithEmail || '').toLowerCase() === email,
    );
    const pending = pendingRequests.some(
      p => (p.sharedWithEmail || '').toLowerCase() === email,
    );
    if (exists) {
      setShareError(
        isRTL
          ? 'الجهاز مشارك بالفعل مع هذا المستخدم.'
          : 'Device is already shared with this user.',
      );
      return;
    }
    if (pending) {
      setShareError(
        isRTL
          ? 'تم إرسال طلب مشاركة بالفعل لهذا المستخدم.'
          : 'A share request is already pending for this user.',
      );
      return;
    }

    setShareError('');
    setIsSubmittingShare(true);

    try {
      const recipientSnap = await firestore()
        .collection('users')
        .where('email', '==', email)
        .limit(1)
        .get();

      if (recipientSnap.empty) {
        setShareError(
          isRTL
            ? 'لم يتم العثور على مستخدم iRopit بهذا البريد الإلكتروني.'
            : 'No iRopit user found with this email.',
        );
        return;
      }

      const recipientDoc = recipientSnap.docs[0];
      const recipientData = recipientDoc.data() as any;
      const recipientUid = recipientData.uid || recipientDoc.id;

      const payload = {
        ownerUid: user.uid,
        ownerEmail: user.email || '',
        ownerDisplayName: user.displayName || user.email || '',
        deviceId: currentDevice.id,
        deviceDocId: currentDevice.id,
        deviceName: getCurrentDeviceName(),
        sharedWithEmail: email,
        sharedWithUid: recipientUid,
        permissions: {
          sms: shareSms,
          calls: shareCalls,
          notifications: shareNotifications,
        },
        status: 'pending',
        createdAt: Date.now(),
      };

      const reqRef = await firestore().collection('deviceShareRequests').add(payload);
      setPendingRequests(prev => [{ requestId: reqRef.id, ...payload }, ...prev]);
      setShareEmail('');

      Alert.alert(
        isRTL ? 'تم إرسال الطلب' : 'Request Sent',
        isRTL
          ? `تم إرسال طلب مشاركة الجهاز إلى ${email}`
          : `Share request sent to ${email}`,
      );
    } catch {
      setShareError(
        isRTL ? 'حدث خطأ. حاول مرة أخرى.' : 'An error occurred. Please try again.',
      );
    } finally {
      setIsSubmittingShare(false);
    }
  };

  const handleCancelPending = (request: PendingRequest) => {
    Alert.alert(
      isRTL ? 'إلغاء الطلب' : 'Cancel Request',
      isRTL
        ? `إلغاء طلب المشاركة المرسل إلى ${request.sharedWithEmail}؟`
        : `Cancel pending request to ${request.sharedWithEmail}?`,
      [
        { text: isRTL ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: isRTL ? 'تأكيد' : 'Confirm',
          style: 'destructive',
          onPress: async () => {
            try {
              await firestore()
                .collection('deviceShareRequests')
                .doc(request.requestId)
                .delete();

              // If the recipient accepted quickly (race), ensure Cancel also
              // revokes the active share like the Stop action.
              if (user?.uid && currentDevice?.id) {
                const activeShareBaseQ = firestore()
                  .collection('deviceShares')
                  .where('ownerUid', '==', user.uid)
                  .where('deviceId', '==', currentDevice.id);
                const activeShareSnap = request.sharedWithUid
                  ? await activeShareBaseQ
                      .where('sharedWithUid', '==', request.sharedWithUid)
                      .get()
                  : await activeShareBaseQ
                      .where('sharedWithEmail', '==', request.sharedWithEmail)
                      .get();

                if (!activeShareSnap.empty) {
                  const batch = firestore().batch();
                  activeShareSnap.docs.forEach(doc => {
                    batch.delete(doc.ref);
                    const data = doc.data() as any;
                    const shareUid = data?.sharedWithUid || request.sharedWithUid;
                    if (shareUid) {
                      const indexId = `${currentDevice.id}_${shareUid}`;
                      batch.delete(
                        firestore().collection('deviceShareIndex').doc(indexId),
                      );
                    }
                  });
                  await batch.commit();

                  setExistingShares(prev =>
                    prev.filter(
                      item =>
                        (item.sharedWithEmail || '').toLowerCase() !==
                        (request.sharedWithEmail || '').toLowerCase(),
                    ),
                  );
                }
              }

              setPendingRequests(prev =>
                prev.filter(item => item.requestId !== request.requestId),
              );
            } catch {
              setShareError(
                isRTL ? 'فشل إلغاء الطلب.' : 'Failed to cancel request.',
              );
            }
          },
        },
      ],
    );
  };

  const handleStopSharing = (share: ExistingShare) => {
    Alert.alert(
      isRTL ? 'إيقاف المشاركة' : 'Stop Sharing',
      isRTL
        ? `إيقاف مشاركة الجهاز مع ${share.sharedWithEmail}؟`
        : `Stop sharing with ${share.sharedWithEmail}?`,
      [
        { text: isRTL ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: isRTL ? 'إيقاف' : 'Stop',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!user?.uid || !currentDevice?.id) {
                throw new Error('missing-context');
              }

              const targetUid = share.sharedWithUid || '';
              const targetEmail = (share.sharedWithEmail || '').trim().toLowerCase();

              // Optimistically remove all matching rows so revocation is instant in UI.
              setExistingShares(prev =>
                prev.filter(item => {
                  const sameUid = targetUid && item.sharedWithUid === targetUid;
                  const sameEmail =
                    !targetUid &&
                    (item.sharedWithEmail || '').trim().toLowerCase() === targetEmail;
                  return !(sameUid || sameEmail || item.shareId === share.shareId);
                }),
              );

              const baseQ = firestore()
                .collection('deviceShares')
                .where('ownerUid', '==', user.uid)
                .where('deviceId', '==', currentDevice.id);
              const activeShareSnap = targetUid
                ? await baseQ.where('sharedWithUid', '==', targetUid).get()
                : await baseQ.where('sharedWithEmail', '==', targetEmail).get();

              const batch = firestore().batch();
              const indexUids = new Set<string>();

              if (!activeShareSnap.empty) {
                activeShareSnap.docs.forEach(doc => {
                  batch.delete(doc.ref);
                  const data = doc.data() as any;
                  const uid = data?.sharedWithUid;
                  if (uid) indexUids.add(uid);
                });
              } else {
                // Fallback for stale/partial UI rows.
                batch.delete(firestore().collection('deviceShares').doc(share.shareId));
              }

              if (targetUid) indexUids.add(targetUid);
              indexUids.forEach(uid => {
                const indexId = `${currentDevice.id}_${uid}`;
                batch.delete(firestore().collection('deviceShareIndex').doc(indexId));
              });

              await batch.commit();
            } catch {
              setShareError(
                isRTL ? 'فشل إيقاف المشاركة.' : 'Failed to stop sharing.',
              );
            }
          },
        },
      ],
    );
  };

  return (
    <Container
      isDark={isDarkMode}
      noPaddingHorizontal
      backgroundColor={bgColor}
      edges={['top', 'left', 'right']}
    >
      {/* Title like Notifications Screen */}
      <View style={styles.titleContainer}>
        <Text style={[styles.title, { color: textColor }]}>
          {isRTL ? 'الإعدادات' : 'Settings'}
        </Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Profile Header - Improved Design */}
        <TouchableOpacity
          style={[styles.profileHeader, { backgroundColor: colors.surface }]}
          onPress={navigateToUserSettings}
          activeOpacity={0.7}
        >
          {user?.photoURL ? (
            <Image
              source={{ uri: user.photoURL }}
              style={styles.profileImage}
            />
          ) : (
            <View
              style={[styles.profileImage, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.profileInitials}>
                {getInitials(user?.displayName || 'User')}
              </Text>
            </View>
          )}

          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.text }]}>
              {user?.displayName || 'iRopit User'}
            </Text>
            <Text
              style={[styles.profileEmail, { color: colors.textSecondary }]}
            >
              {user?.email}
            </Text>
          </View>

          <Icon
            name={isRTL ? 'chevron-back' : 'chevron-forward'}
            size={20}
            color={colors.textSecondary}
          />
        </TouchableOpacity>

        {/* Menu Sections */}
        {menuSections.map((section, sectionIndex) => (
          <View key={sectionIndex}>
            <Text
              style={[styles.sectionTitle, { color: colors.textSecondary }]}
            >
              {section.title}
            </Text>

            <View style={[styles.section, { backgroundColor: colors.surface }]}>
              {section.items.map((item: any, itemIndex: number) => (
                <TouchableOpacity
                  key={itemIndex}
                  style={[
                    styles.menuItem,
                    { borderBottomColor: colors.border },
                    itemIndex === section.items.length - 1 && styles.lastItem,
                  ]}
                  onPress={item.isSwitch ? undefined : item.onPress}
                  activeOpacity={item.isSwitch ? 1 : 0.7}
                >
                  <Icon
                    name={item.icon}
                    size={24}
                    color={
                      item.iconColor ||
                      (item.danger ? colors.error : colors.primary)
                    }
                    style={styles.menuIcon}
                  />

                  <View style={styles.menuContent}>
                    <Text
                      style={[
                        styles.menuTitle,
                        { color: item.danger ? colors.error : colors.text },
                      ]}
                    >
                      {item.title}
                    </Text>
                    {item.subtitle && !item.isSwitch && (
                      <Text
                        style={[
                          styles.menuSubtitle,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {item.subtitle}
                      </Text>
                    )}
                  </View>

                  {item.isSwitch ? (
                    <Switch
                      value={item.value}
                      onValueChange={val => saveAndSync(item.settingKey, val)}
                      trackColor={{
                        false: colors.border,
                        true: colors.primary,
                      }}
                      thumbColor={
                        item.value ? colors.white : colors.surfaceTertiary
                      }
                    />
                  ) : (
                    <Icon
                      name={isRTL ? 'chevron-back' : 'chevron-forward'}
                      size={20}
                      color={colors.textSecondary}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

      </ScrollView>

      <Modal
        visible={shareModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeShareModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.shareModalCard, { backgroundColor: colors.surface }]}> 
            <View style={styles.shareModalHeader}>
              <Text style={[styles.shareModalTitle, { color: colors.text }]}>
                {isRTL ? 'مشاركة الجهاز' : 'Share Device'}: {getCurrentDeviceName()}
              </Text>
              <TouchableOpacity onPress={closeShareModal}>
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.shareModalBody} keyboardShouldPersistTaps="handled">
              <Text style={[styles.shareHint, { color: colors.textSecondary }]}> 
                {isLoadingShares
                  ? isRTL
                    ? 'جارٍ تحميل المشاركات الحالية...'
                    : 'Loading current shares...'
                  : isRTL
                  ? 'المشاركات الحالية'
                  : 'Current shares'}
              </Text>

              {isLoadingShares && (
                <ActivityIndicator style={{ marginBottom: 12 }} color={colors.primary} />
              )}

              {!isLoadingShares && existingShares.map((share) => (
                <View
                  key={share.shareId}
                  style={[styles.shareRow, { borderColor: colors.border }]}
                >
                  <View style={styles.shareRowInfo}>
                    <Text style={[styles.shareEmail, { color: colors.text }]} numberOfLines={1}>
                      {share.sharedWithEmail}
                    </Text>
                    <Text style={[styles.sharePerms, { color: colors.textSecondary }]}>
                      {getPermissionsText(share.permissions)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleStopSharing(share)}
                    style={[styles.shareActionBtn, { backgroundColor: colors.error + '22' }]}
                  >
                    <Text style={[styles.shareActionText, { color: colors.error }]}> 
                      {isRTL ? 'إيقاف' : 'Stop'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}

              {!isLoadingShares && pendingRequests.map((request) => (
                <View
                  key={request.requestId}
                  style={[styles.shareRow, { borderColor: colors.border }]}
                >
                  <View style={styles.shareRowInfo}>
                    <Text style={[styles.shareEmail, { color: colors.text }]} numberOfLines={1}>
                      {request.sharedWithEmail}
                    </Text>
                    <Text style={[styles.sharePerms, { color: colors.textSecondary }]}>
                      {getPermissionsText(request.permissions)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleCancelPending(request)}
                    style={[styles.shareActionBtn, { backgroundColor: colors.warning + '22' }]}
                  >
                    <Text style={[styles.shareActionText, { color: colors.warning }]}> 
                      {isRTL ? 'إلغاء الطلب' : 'Cancel'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}

              {!isLoadingShares && existingShares.length === 0 && pendingRequests.length === 0 && (
                <Text style={[styles.shareEmpty, { color: colors.textSecondary }]}> 
                  {isRTL ? 'لا توجد مشاركات حالية.' : 'No current shares.'}
                </Text>
              )}

              <Text style={[styles.shareLabel, { color: colors.textSecondary }]}> 
                {isRTL
                  ? 'حساب iRopit المستلم (البريد الإلكتروني)'
                  : 'Recipient iRopit account (email)'}
              </Text>
              <TextInput
                value={shareEmail}
                onChangeText={(v) => {
                  setShareEmail(v);
                  if (shareError) setShareError('');
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="example@email.com"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.shareInput,
                  {
                    color: colors.text,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              />

              <Text style={[styles.shareLabel, { color: colors.textSecondary }]}> 
                {isRTL ? 'ما الذي تريد مشاركته؟' : 'What to share?'}
              </Text>
              <View style={styles.permsRow}>
                <TouchableOpacity
                  style={styles.permItem}
                  onPress={() => setShareSms(v => !v)}
                >
                  <Icon
                    name={shareSms ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={shareSms ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[styles.permText, { color: colors.text }]}>SMS</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.permItem}
                  onPress={() => setShareCalls(v => !v)}
                >
                  <Icon
                    name={shareCalls ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={shareCalls ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[styles.permText, { color: colors.text }]}>Calls</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.permItem}
                  onPress={() => setShareNotifications(v => !v)}
                >
                  <Icon
                    name={shareNotifications ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={shareNotifications ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[styles.permText, { color: colors.text }]}>Notifications</Text>
                </TouchableOpacity>
              </View>

              {!!shareError && (
                <Text style={[styles.shareError, { color: colors.error }]}>
                  {shareError}
                </Text>
              )}
            </ScrollView>

            <View style={styles.shareFooter}>
              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: colors.surfaceSecondary }]}
                onPress={closeShareModal}
                disabled={isSubmittingShare}
              >
                <Text style={[styles.shareFooterBtnText, { color: colors.text }]}> 
                  {isRTL ? 'إلغاء' : 'Cancel'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: colors.primary }]}
                onPress={handleSubmitShare}
                disabled={isSubmittingShare}
              >
                {isSubmittingShare ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={[styles.shareFooterBtnText, { color: colors.textInverse }]}> 
                    {isRTL ? 'مشاركة' : 'Share'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={languageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeLanguageModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.shareModalCard, { backgroundColor: colors.surface }]}> 
            <View style={styles.shareModalHeader}>
              <Text style={[styles.shareModalTitle, { color: colors.text }]}> 
                {t('language')}
              </Text>
              <TouchableOpacity onPress={closeLanguageModal} disabled={isChangingLanguage}>
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.shareModalBody}>
              <TouchableOpacity
                style={[
                  styles.languageOptionBtn,
                  {
                    backgroundColor:
                      settings.language === 'en' ? colors.primary : colors.surfaceSecondary,
                    borderWidth: 1,
                    borderColor:
                      settings.language === 'en' ? colors.primaryDark : colors.border,
                    marginBottom: 10,
                  },
                ]}
                onPress={() => handleSelectLanguage('en')}
                disabled={isChangingLanguage}
              >
                <Text
                  style={[
                    styles.languageOptionText,
                    {
                      color:
                        settings.language === 'en'
                          ? colors.black
                          : isDarkMode
                          ? colors.white
                          : colors.text,
                    },
                  ]}
                >
                  {t('english') || 'English'}
                </Text>
                {settings.language === 'en' ? (
                  <Icon name="checkmark-circle" size={18} color={colors.black} />
                ) : (
                  <View style={{ width: 18, height: 18 }} />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.languageOptionBtn,
                  {
                    backgroundColor:
                      settings.language === 'ar' ? colors.primary : colors.surfaceSecondary,
                    borderWidth: 1,
                    borderColor:
                      settings.language === 'ar' ? colors.primaryDark : colors.border,
                  },
                ]}
                onPress={() => handleSelectLanguage('ar')}
                disabled={isChangingLanguage}
              >
                <Text
                  style={[
                    styles.languageOptionText,
                    {
                      color:
                        settings.language === 'ar'
                          ? colors.black
                          : isDarkMode
                          ? colors.white
                          : colors.text,
                    },
                  ]}
                >
                  {t('arabic') || 'العربية'}
                </Text>
                {settings.language === 'ar' ? (
                  <Icon name="checkmark-circle" size={18} color={colors.black} />
                ) : (
                  <View style={{ width: 18, height: 18 }} />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.shareFooter}>
              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: colors.surfaceSecondary }]}
                onPress={closeLanguageModal}
                disabled={isChangingLanguage}
              >
                <Text style={[styles.shareFooterBtnText, { color: colors.text }]}> 
                  {t('cancel')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={logoutModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeLogoutModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.shareModalCard, { backgroundColor: colors.surface }]}> 
            <View style={styles.shareModalHeader}>
              <Text style={[styles.shareModalTitle, { color: colors.text }]}> 
                {isRTL ? 'تسجيل الخروج' : 'Logout'}
              </Text>
              <TouchableOpacity onPress={closeLogoutModal} disabled={isLoggingOut}>
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.shareModalBody}>
              <View style={styles.deleteWarningWrap}>
                <Icon name="log-out-outline" size={20} color={colors.warning} />
                <Text style={[styles.deleteWarningText, { color: colors.text }]}> 
                  {isRTL
                    ? 'هل تريد تسجيل الخروج؟'
                    : 'Are you sure you want to logout?'}
                </Text>
              </View>
            </View>

            <View style={styles.shareFooter}>
              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: colors.surfaceSecondary }]}
                onPress={closeLogoutModal}
                disabled={isLoggingOut}
              >
                <Text style={[styles.shareFooterBtnText, { color: colors.text }]}> 
                  {isRTL ? 'إلغاء' : 'Cancel'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: colors.primary }]}
                onPress={handleConfirmLogout}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={[styles.shareFooterBtnText, { color: colors.textInverse }]}> 
                    {isRTL ? 'تسجيل الخروج' : 'Logout'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={deleteDeviceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteDeviceModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.shareModalCard, { backgroundColor: colors.surface }]}> 
            <View style={styles.shareModalHeader}>
              <Text style={[styles.shareModalTitle, { color: colors.error }]}> 
                {isRTL ? 'حذف هذا الجهاز' : 'Delete This Device'}
              </Text>
              <TouchableOpacity onPress={closeDeleteDeviceModal} disabled={isDeletingDevice}>
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.shareModalBody}>
              <View style={styles.deleteWarningWrap}>
                <Icon name="warning-outline" size={20} color={colors.warning} />
                <Text style={[styles.deleteWarningText, { color: colors.text }]}> 
                  {isRTL
                    ? 'سيتم حذف هذا الجهاز من حسابك الحالي وسيتم تسجيل خروجك تلقائياً من التطبيق.'
                    : 'This device will be removed from your account and you will be signed out automatically.'}
                </Text>
              </View>
            </View>

            <View style={styles.shareFooter}>
              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: colors.surfaceSecondary }]}
                onPress={closeDeleteDeviceModal}
                disabled={isDeletingDevice}
              >
                <Text style={[styles.shareFooterBtnText, { color: colors.text }]}> 
                  {isRTL ? 'إلغاء' : 'Cancel'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: colors.error }]}
                onPress={handleConfirmDeleteDevice}
                disabled={isDeletingDevice}
              >
                {isDeletingDevice ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={[styles.shareFooterBtnText, { color: colors.textInverse }]}> 
                    {isRTL ? 'حذف الجهاز' : 'Delete Device'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={deleteAccountModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeDeleteAccountModal}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.shareModalCard, { backgroundColor: colors.surface }]}> 
            <View style={styles.shareModalHeader}>
              <Text style={[styles.shareModalTitle, { color: colors.error }]}> 
                {isRTL ? 'حذف الحساب' : 'Delete Account'}
              </Text>
              <TouchableOpacity onPress={closeDeleteAccountModal} disabled={isDeletingAccount}>
                <Icon name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.shareModalBody}>
              <View style={styles.deleteWarningWrap}>
                <Icon name="warning-outline" size={20} color={colors.warning} />
                <Text style={[styles.deleteWarningText, { color: colors.text }]}> 
                  {isRTL
                    ? 'هل تريد حذف هذا الحساب نهائياً؟ سيتم حذف البيانات المرتبطة بالحساب وإلغاء أي مشاركة أجهزة مرتبطة به.'
                    : 'Do you want to permanently delete this account? Account-related data will be deleted and any linked shared-device access will be revoked.'}
                </Text>
              </View>
            </View>

            <View style={styles.shareFooter}>
              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: colors.surfaceSecondary }]}
                onPress={closeDeleteAccountModal}
                disabled={isDeletingAccount}
              >
                <Text style={[styles.shareFooterBtnText, { color: colors.text }]}> 
                  {isRTL ? 'إلغاء' : 'Cancel'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.shareFooterBtn, { backgroundColor: colors.error }]}
                onPress={handleConfirmDeleteAccount}
                disabled={isDeletingAccount}
              >
                {isDeletingAccount ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={[styles.shareFooterBtnText, { color: colors.textInverse }]}> 
                    {isRTL ? 'حذف الحساب' : 'Delete Account'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Text style={[styles.version, { color: colors.textSecondary, paddingBottom: 12 }]}>
        {`iRopit v${APP_VERSION}`}
      </Text>
    </Container>
  );
};

export default MenuScreen;
