import { useEffect, useCallback, useState, useMemo } from 'react';
import { Platform, Alert, InteractionManager, NativeModules } from 'react-native';
import { useSMSStore } from '../../../store/smsStore';
import { useAuthStore } from '../../../store/authStore';
import { useTheme } from '../../../contexts/ThemeContext';
import smsService from '../../../services/smsService';
import { Conversation } from './types';

const { SmsModule } = NativeModules;

export const useSMSScreen = () => {
  const messages = useSMSStore(state => state.messages);
  const isLoading = useSMSStore(state => state.isLoading);
  const isSyncing = useSMSStore(state => state.isSyncing);
  const isLoadingMore = useSMSStore(state => state.isLoadingMore);
  const hasMoreMessages = useSMSStore(state => state.hasMoreMessages);
  const loadMoreMessages = useSMSStore(state => state.loadMoreMessages);
  const loadMessages = useSMSStore(state => state.loadMessages);
  const batchSyncNativeSMS = useSMSStore(state => state.batchSyncNativeSMS);
  const markAllAsRead = useSMSStore(state => state.markAllAsRead);
  const deleteAllMessages = useSMSStore(state => state.deleteAllMessages);
  const user = useAuthStore(state => state.user);

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

        // Lightweight top-up sync: fetch only newest native SMS so missed
        // background writes don't leave this tab stale.
        if (hasPermissions && user?.uid && SmsModule?.getAllSms) {
          try {
            const recentNativeSms = (await SmsModule.getAllSms(300)) || [];
            if (recentNativeSms.length > 0) {
              await batchSyncNativeSMS(recentNativeSms, user.uid);
            }
          } catch (_) {}
        }

        // Re-attach Firestore listener only; avoid re-uploading full native SMS
        // history on pull-to-refresh, which can trigger extension-side full reloads.
        if (hasPermissions) loadMessages();
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
  }, [loadMessages, batchSyncNativeSMS, user?.uid]);

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

    // Theme
    colors,
    isDarkMode,
    isRTL,
    bgColor,
    textColor,
    secondaryTextColor,

    // Actions
    loadFromDevice,
    loadMoreMessages,
    handleMarkAllAsRead,
    handleDeleteAll,
  };
};
