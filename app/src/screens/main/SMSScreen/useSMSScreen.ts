import { useEffect, useCallback, useState, useMemo } from 'react';
import { Platform, Alert, InteractionManager } from 'react-native';
import { useSMSStore } from '../../../store/smsStore';
import { SMS } from '../../../types';
import { useTheme } from '../../../contexts/ThemeContext';
import smsService from '../../../services/smsService';
import { Conversation } from './types';

export const useSMSScreen = () => {
  const messages = useSMSStore(state => state.messages);
  const isLoading = useSMSStore(state => state.isLoading);
  const isSyncing = useSMSStore(state => state.isSyncing);
  const isLoadingMore = useSMSStore(state => state.isLoadingMore);
  const hasMoreMessages = useSMSStore(state => state.hasMoreMessages);
  const loadMoreMessages = useSMSStore(state => state.loadMoreMessages);
  const addMessage = useSMSStore(state => state.addMessage);
  const setMessages = useSMSStore(state => state.setMessages);
  const syncMessages = useSMSStore(state => state.syncMessages);
  const markAllAsRead = useSMSStore(state => state.markAllAsRead);
  const deleteAllMessages = useSMSStore(state => state.deleteAllMessages);
  const deleteMessage = useSMSStore(state => state.deleteMessage);

  const [showCompose, setShowCompose] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const { colors, isDarkMode, isRTL } = useTheme();

  // Dynamic colors
  const bgColor = colors.background;
  const textColor = colors.text;
  const secondaryTextColor = colors.textSecondary;

  // Group messages by phone number into conversations
  const conversations = useMemo(() => {
    const grouped: { [key: string]: Conversation } = {};

    const validMessages = Array.isArray(messages) ? messages : [];

    validMessages.forEach(msg => {
      const rawPhone = msg.phoneNumber || 'Unknown';
      const normalizedPhone = rawPhone.replace(/[\s\-\(\)\.]/g, '').trim();
      const key = normalizedPhone || 'Unknown';

      if (!grouped[key]) {
        grouped[key] = {
          phoneNumber: rawPhone,
          contactName: msg.contactName,
          messages: [],
          lastMessage: msg,
          unreadCount: 0,
        };
      }

      grouped[key].messages.push(msg);
      if (!msg.read) grouped[key].unreadCount++;

      if (msg.timestamp > grouped[key].lastMessage.timestamp) {
        grouped[key].lastMessage = msg;
        if (msg.contactName) {
          grouped[key].contactName = msg.contactName;
        }
      }
    });

    return Object.values(grouped).sort(
      (a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp,
    );
  }, [messages]);

  const loadFromDevice = useCallback(async () => {
    if (Platform.OS === 'android' && smsService) {
      try {
        const hasPermissions = await smsService.requestPermissions();
        setPermissionGranted(hasPermissions);

        if (hasPermissions) {
          const deviceMessages = await smsService.getAllSms();
          if (deviceMessages && deviceMessages.length > 0) {
            const formattedMessages: SMS[] = deviceMessages.map((msg: any) => ({
              id: String(msg._id || msg.id || Date.now()),
              threadId: msg.thread_id || '',
              userId: '',
              phoneNumber: msg.address || '',
              contactName: undefined,
              body: msg.body || '',
              timestamp: Number(msg.date) || Date.now(),
              type: msg.type === 1 ? 'inbox' : 'sent',
              read: msg.read === 1,
              deviceId: 'android',
              syncedAt: Date.now(),
            }));
            formattedMessages.forEach(msg => addMessage(msg));
            await syncMessages(deviceMessages);
          }
        }
      } catch (_error) {
        // Handle error silently
      }
    }
    // NOTE: initialLoading is intentionally NOT cleared here.
    // On a fresh install the historical Firestore sync (batchSyncNativeSMS)
    // runs ~1.5s later via useNativeEvents and the first onSnapshot fires
    // empty, so clearing here would show "No SMS yet" during that window.
    // It's cleared by the effect below once messages arrive (or after a
    // generous timeout so a genuinely empty inbox eventually shows empty).
  }, [addMessage, syncMessages]);

  useEffect(() => {
    // Defer heavy native SMS read until after navigation animation completes
    // so the screen transition stays smooth on fresh installs / first open.
    const task = InteractionManager.runAfterInteractions(() => {
      loadFromDevice();
    });
    return () => task.cancel();
  }, [loadFromDevice]);

  // Clear initial-loading once we actually have messages, OR after a
  // generous timeout to cover the case of a genuinely empty SMS inbox.
  useEffect(() => {
    if (!initialLoading) return;
    if (messages.length > 0 || isSyncing) {
      setInitialLoading(false);
      return;
    }
    const t = setTimeout(() => setInitialLoading(false), 30000);
    return () => clearTimeout(t);
  }, [initialLoading, messages.length, isSyncing]);

  const handleSendMessage = async () => {
    if (!phoneNumber.trim()) {
      Alert.alert(
        isRTL ? 'خطأ' : 'Error',
        isRTL ? 'أدخل رقم الهاتف' : 'Enter phone number',
      );
      return;
    }
    if (!messageText.trim()) {
      Alert.alert(
        isRTL ? 'خطأ' : 'Error',
        isRTL ? 'أدخل الرسالة' : 'Enter message',
      );
      return;
    }
    setIsSending(true);
    try {
      if (smsService) {
        const success = await smsService.sendSms(
          phoneNumber.trim(),
          messageText.trim(),
        );
        if (success) {
          const newMessage: SMS = {
            id: Date.now().toString(),
            threadId: '',
            userId: '',
            deviceId: 'android',
            phoneNumber: phoneNumber.trim(),
            contactName: undefined,
            body: messageText.trim(),
            timestamp: Date.now(),
            type: 'sent',
            read: true,
            syncedAt: Date.now(),
          };
          addMessage(newMessage);
          setShowCompose(false);
          setPhoneNumber('');
          setMessageText('');
          Alert.alert(
            isRTL ? 'تم' : 'Success',
            isRTL ? 'تم إرسال الرسالة' : 'Message sent',
          );
        } else {
          Alert.alert(
            isRTL ? 'خطأ' : 'Error',
            isRTL ? 'فشل في الإرسال' : 'Failed to send',
          );
        }
      }
    } catch (error: any) {
      Alert.alert(
        isRTL ? 'خطأ' : 'Error',
        error.message || (isRTL ? 'فشل في الإرسال' : 'Failed to send'),
      );
    }
    setIsSending(false);
  };

  const handleMarkAllAsRead = () => {
    Alert.alert(
      isRTL ? 'تعليم الكل كمقروء' : 'Mark All as Read',
      isRTL ? 'تعليم كل الرسائل كمقروءة؟' : 'Mark all messages as read?',
      [
        { text: isRTL ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: isRTL ? 'تعليم الكل' : 'Mark All',
          onPress: async () => {
            await markAllAsRead();
            setShowActions(false);
          },
        },
      ],
    );
  };

  const handleDeleteAll = () => {
    Alert.alert(
      isRTL ? 'حذف كل الرسائل' : 'Delete All Messages',
      isRTL
        ? `هل أنت متأكد من حذف كل ${messages.length} رسالة؟ لا يمكن التراجع عن هذا.`
        : `Are you sure you want to delete all ${messages.length} messages? This cannot be undone.`,
      [
        { text: isRTL ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: isRTL ? 'حذف الكل' : 'Delete All',
          style: 'destructive',
          onPress: async () => {
            await deleteAllMessages();
            setShowActions(false);
          },
        },
      ],
    );
  };

  const openCompose = () => setShowCompose(true);
  const closeCompose = () => setShowCompose(false);

  return {
    // State
    messages,
    conversations,
    isLoading,
    isSyncing,
    isLoadingMore,
    hasMoreMessages,
    initialLoading,
    permissionGranted,
    showCompose,
    phoneNumber,
    messageText,
    isSending,
    showActions,

    // Theme
    colors,
    isDarkMode,
    isRTL,
    bgColor,
    textColor,
    secondaryTextColor,

    // Actions
    setPhoneNumber,
    setMessageText,
    setShowActions,
    openCompose,
    closeCompose,
    loadFromDevice,
    loadMoreMessages,
    handleSendMessage,
    handleMarkAllAsRead,
    handleDeleteAll,
  };
};
