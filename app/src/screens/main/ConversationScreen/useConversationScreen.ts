import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Keyboard, FlatList } from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import { AppNotification } from '../../../services/notificationService';
import notificationService from '../../../services/notificationService';
import { useNotificationStore } from '../../../store/notificationStore';
import { useSMSStore } from '../../../store/smsStore';
import { extractPhoneNumber } from './helper';

// Normalize phone number for comparison
const normalizePhoneNumber = (phone: string): string => {
  if (!phone) return '';
  let normalized = phone.replace(/\D/g, '');
  normalized = normalized.replace(/^0+/, '');
  if (normalized.length > 9) {
    normalized = normalized.slice(-9);
  }
  return normalized;
};

// Check if two phone numbers match
const phoneNumbersMatch = (phone1: string, phone2: string): boolean => {
  const n1 = normalizePhoneNumber(phone1);
  const n2 = normalizePhoneNumber(phone2);
  if (!n1 || !n2) return false;
  return n1 === n2 || n1.endsWith(n2) || n2.endsWith(n1);
};

// Check if a value is a real phone number (digits only)
const isPhoneNumber = (value: string): boolean => {
  if (!value) return false;
  return /^[\+\d\s\-\(\)]+$/.test(value.trim());
};

// Match sender by phone number or name
const senderMatches = (sms: any, filterKey: string): boolean => {
  const smsPhone = sms.phoneNumber || sms.sender || sms.address || '';
  const smsContactName = sms.contactName || '';

  if (isPhoneNumber(filterKey)) {
    // Filter key is a phone number — match by digits
    return phoneNumbersMatch(smsPhone, filterKey);
  } else {
    // Filter key is a name (like "Klivvr", "CBD") — match by sender name or contactName
    const filterLower = filterKey.toLowerCase();
    return (
      smsPhone.toLowerCase() === filterLower ||
      smsContactName.toLowerCase() === filterLower
    );
  }
};

interface UseConversationScreenParams {
  title: string;
  appName: string;
  type: string;
  phoneNumber?: string;
}

export const useConversationScreen = (
  params: UseConversationScreenParams,
  navigation: any,
) => {
  const { title, appName, type, phoneNumber } = params;

  const {
    notifications: allNotifications,
    removeNotification,
    addNotification,
    loadNotificationsForConversation,
  } = useNotificationStore();
  const {
    messages: smsMessages,
    isLoading: isSmsLoading,
  } = useSMSStore();
  const { isRTL, isDarkMode, colors, t } = useTheme();

  // State for loaded notifications (non-SMS only)
  const [loadedNotifications, setLoadedNotifications] = useState<
    AppNotification[]
  >([]);

  // Dynamic colors from theme
  const bgColor = colors.background;
  const textColor = colors.text;
  const secondaryTextColor = colors.textSecondary;
  const bubbleColor = colors.card;
  const headerBgColor = isDarkMode ? colors.surfaceSecondary : colors.surfaceTertiary;
  const borderColor = colors.border;

  const [smsText, setSmsText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  // Load notifications for non-SMS conversations from Firebase on mount
  useEffect(() => {
    if (type !== 'sms') {
      loadNotificationsForConversation(title, appName, type)
        .then(notifications => setLoadedNotifications(notifications))
        .catch(() => {});
    }
  }, [type, title, appName, loadNotificationsForConversation]);

  // Filter messages locally from smsMessages store
  const senderMessages = useMemo(() => {
    if (type === 'sms' && phoneNumber) {
      if (isSmsLoading && smsMessages.length === 0) {
        return [];
      }

      return smsMessages.filter(sms => senderMatches(sms, phoneNumber));
    }
    return [];
  }, [type, phoneNumber, smsMessages, isSmsLoading]);

  // Convert SMS messages to AppNotification and merge
  const conversationNotifications = useMemo(() => {
    const validNotifications = Array.isArray(allNotifications)
      ? allNotifications
      : [];
    const validLoadedNotifications = Array.isArray(loadedNotifications)
      ? loadedNotifications
      : [];
    const validSmsMessages = Array.isArray(smsMessages) ? smsMessages : [];
    const validSenderMessages = Array.isArray(senderMessages)
      ? senderMessages
      : [];

    // Merge local notifications with loaded notifications from Firebase
    const allLocalNotifications = [
      ...validNotifications,
      ...validLoadedNotifications,
    ];
    const regularNotifications = allLocalNotifications.filter(
      n => n.title === title && n.appName === appName && n.type === type,
    );

    // Remove duplicates from regular notifications
    const uniqueRegularNotifications = regularNotifications.filter(
      (n, index, self) => index === self.findIndex(m => m.id === n.id),
    );

    if (type === 'sms') {
      const messagesToUse =
        validSenderMessages.length > 0
          ? validSenderMessages
          : validSmsMessages.filter(sms => {
              const filterKey = phoneNumber || title;
              return senderMatches(sms, filterKey);
            });

      const smsNotifications: AppNotification[] = messagesToUse.map(sms => ({
        id: sms.id || `sms_${sms.timestamp}`,
        key: `sms_${sms.id || sms.timestamp}`,
        packageName: 'com.android.mms',
        title:
          (sms as any).contactName ||
          (sms as any).sender ||
          (sms as any).phoneNumber ||
          (sms as any).address ||
          'Unknown',
        text: (sms as any).body || (sms as any).message || '',
        appName: 'SMS',
        type: 'sms' as const,
        timestamp: sms.timestamp || Date.now(),
        read: (sms as any).read || false,
        smsType: (sms as any).type || 'inbox',
      }));

      const allMessages = [...uniqueRegularNotifications, ...smsNotifications];
      const seenIds = new Set<string>();
      const uniqueMessages = allMessages.filter(msg => {
        if (seenIds.has(msg.id)) return false;
        seenIds.add(msg.id);
        return true;
      });

      return uniqueMessages.sort((a, b) => a.timestamp - b.timestamp);
    }

    return uniqueRegularNotifications.sort((a, b) => a.timestamp - b.timestamp);
  }, [
    allNotifications,
    loadedNotifications,
    smsMessages,
    senderMessages,
    title,
    appName,
    type,
    phoneNumber,
  ]);

  // Handle keyboard events
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      'keyboardDidShow',
      e => {
        setKeyboardHeight(e.endCoordinates.height);
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      },
    );
    const keyboardDidHideListener = Keyboard.addListener(
      'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      },
    );

    return () => {
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, []);

  const conversationLengthRef = useRef(conversationNotifications.length);
  conversationLengthRef.current = conversationNotifications.length;

  const handleDelete = useCallback(
    (id: string) => {
      removeNotification(id);
      if (conversationLengthRef.current <= 1) {
        navigation.goBack();
      }
    },
    [removeNotification, navigation],
  );

  // State for error messages
  const [errorMessage, setErrorMessage] = useState('');

  const handleSendSMS = useCallback(async () => {
    setErrorMessage('');

    if (!smsText.trim()) {
      setErrorMessage(t('pleaseEnterMessage'));
      return;
    }

    const phone = extractPhoneNumber(title);
    if (!phone || phone.length < 7) {
      setErrorMessage(t('couldNotDeterminePhone'));
      return;
    }

    setIsSending(true);

    try {
      const success = await notificationService.sendSMS(phone, smsText.trim());

      if (success) {
        const sentMessage: AppNotification = {
          id: `sent_${Date.now()}`,
          key: `sent_${Date.now()}`,
          title: title,
          text: smsText.trim(),
          appName: appName,
          packageName: 'com.IRopit.sent',
          type: 'sms',
          timestamp: Date.now(),
          read: true,
        };
        addNotification(sentMessage);

        setSmsText('');
        Keyboard.dismiss();

        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      } else {
        setErrorMessage(t('failedToSendSMS'));
      }
    } catch (error: any) {
      setErrorMessage(error.message || t('errorOccurred'));
    }

    setIsSending(false);
  }, [smsText, title, appName, addNotification, t]);

  const goBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const scrollToEnd = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  const isSMSType = type === 'sms';

  return {
    // Data
    conversationNotifications,
    smsMessages,
    isSmsLoading,
    isSMSType,

    // State
    smsText,
    isSending,
    keyboardHeight,
    errorMessage,
    setErrorMessage,

    // Theme
    isRTL,
    isDarkMode,
    colors,
    bgColor,
    textColor,
    secondaryTextColor,
    bubbleColor,
    headerBgColor,
    borderColor,

    // Refs
    flatListRef,

    // Actions
    setSmsText,
    handleDelete,
    handleSendSMS,
    goBack,
    scrollToEnd,
  };
};
