import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import firestore from '@react-native-firebase/firestore';

import notificationService, {
  AppNotification,
} from '../../../services/notificationService';
import { useNotificationStore } from '../../../store/notificationStore';
import { useSMSStore } from '../../../store/smsStore';
import { useCallStore } from '../../../store/callStore';
import { useAuthStore } from '../../../store/authStore';
import { useDeviceStore } from '../../../store/deviceStore';
import { useContactStore } from '../../../store/contactStore';
import { useTheme } from '../../../contexts/ThemeContext';
import { AlertService } from '../../../components/shared';

import { GroupedNotification } from './types';
import { normalizePhoneNumber, sanitizeFirestoreKey } from './helper';

export const useNotificationsScreen = (
  filterType?: 'sms' | 'notifications-only' | 'all',
) => {
  const navigation = useNavigation<any>();

  // Store hooks
  const {
    notifications,
    addNotification,
    setNotifications,
    removeNotification,
    markGroupAsRead,
  } = useNotificationStore();

  const {
    messages: smsMessages,
    smsDebug,
    markMessagesAsReadBySender,
    loadMessages: loadSmsMessages,
    deleteMessagesBySender,
  } = useSMSStore();

  const { addCallAndSync } = useCallStore();
  const { user } = useAuthStore();
  const { currentDevice, devices, loadDevices } = useDeviceStore();
  const { contacts } = useContactStore();
  const { isRTL, colors, isDarkMode } = useTheme();

  // Device filter state - default to current device
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const activeDeviceId = selectedDeviceId || currentDevice?.id || null;
  const smsDeviceId =
    filterType === 'sms'
      ? activeDeviceId || undefined
      : activeDeviceId || undefined;

  // Local state
  const [isLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [, setIsMiuiDevice] = useState(false);
  const [, setShowMiuiWarning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedNotifications, setSelectedNotifications] = useState<string[]>(
    [],
  );
  const lastSmsLoadKeyRef = useRef<string>('');

  // Theme colors
  const bgColor = colors.background;
  const textColor = colors.text;
  const secondaryTextColor = colors.textSecondary;

  const groupedNotifications = useMemo(() => {
    const groups: { [key: string]: GroupedNotification } = {};

    const validSmsMessages = Array.isArray(smsMessages) ? smsMessages : [];
    const validNotifications = Array.isArray(notifications)
      ? notifications
      : [];

    const nameToPhoneMap: { [name: string]: string } = {};
    const phoneToNameMap: { [phone: string]: string } = {};

    // Build phone-to-name map from local device contacts
    if (Array.isArray(contacts)) {
      contacts.forEach(contact => {
        if (contact.name && contact.phoneNumber) {
          const normalized = normalizePhoneNumber(contact.phoneNumber);
          if (normalized) {
            phoneToNameMap[normalized] = contact.name;
          }
          // Also map all alternate phone numbers
          if (contact.phoneNumbers) {
            contact.phoneNumbers.forEach((num: string) => {
              const normAlt = normalizePhoneNumber(num);
              if (normAlt) {
                phoneToNameMap[normAlt] = contact.name;
              }
            });
          }
        }
      });
    }

    // Also build map from SMS messages that have contactName
    validSmsMessages.forEach(sms => {
      const rawPhone = (sms as any).phoneNumber || (sms as any).sender || '';
      const name = (sms as any).contactName || '';
      const isPhone = /^[\+\d\s\-\(\)]+$/.test(rawPhone.trim());

      if (isPhone && name && rawPhone) {
        const normalized = normalizePhoneNumber(rawPhone);
        nameToPhoneMap[name] = normalized;
        phoneToNameMap[normalized] = name;
      }
    });

    // Process SMS messages - skip if notifications-only filter
    if (filterType !== 'notifications-only') {
      validSmsMessages.forEach(sms => {
        let phoneNumber =
          (sms as any).phoneNumber ||
          (sms as any).sender ||
          (sms as any).address ||
          '';
        let contactName = (sms as any).contactName || '';

        // If contactName looks like a phone number, treat it as empty
        // (name will be resolved from contacts map instead)
        if (contactName && /^[\+\d\s\-\(\)]+$/.test(contactName.trim())) {
          contactName = '';
        }

        const isActualPhoneNumber = /^[\+\d\s\-\(\)]+$/.test(
          phoneNumber.trim(),
        );

        let normalizedPhone = '';
        let groupingKey = '';

        if (isActualPhoneNumber && phoneNumber.trim()) {
          normalizedPhone = normalizePhoneNumber(phoneNumber);
          groupingKey = normalizedPhone;
        } else {
          const cleanName = (phoneNumber || contactName || 'Unknown')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_');
          groupingKey = `name_${cleanName}`;
        }

        if (!normalizedPhone && contactName && nameToPhoneMap[contactName]) {
          groupingKey = nameToPhoneMap[contactName];
        }

        const displayName =
          contactName ||
          phoneToNameMap[normalizedPhone] ||
          phoneNumber ||
          'Unknown';
        const groupKey = `sms_${groupingKey}`;
        const smsId = sms.id || `sms_${sms.timestamp}`;

        const notificationItem: AppNotification = {
          id: smsId,
          key: `sms_${smsId}`,
          packageName: 'com.android.mms',
          title: displayName,
          text:
            (sms as any).body ||
            (sms as any).message ||
            (sms as any).text ||
            '',
          appName: 'SMS',
          type: 'sms',
          smsType: (sms as any).type || 'inbox',
          timestamp: sms.timestamp || Date.now(),
          read: (sms as any).read || false,
          phoneNumber: phoneNumber,
        };

        if (!groups[groupKey]) {
          groups[groupKey] = {
            key: groupKey,
            title: displayName,
            appName: 'SMS',
            type: 'sms',
            lastText: notificationItem.text,
            lastTimestamp: notificationItem.timestamp,
            count: 1,
            unreadCount: notificationItem.read ? 0 : 1,
            notifications: [notificationItem],
            phoneNumber: phoneNumber,
          };
        } else {
          groups[groupKey].count++;
          if (!notificationItem.read) groups[groupKey].unreadCount++;
          groups[groupKey].notifications.push(notificationItem);
          if (notificationItem.timestamp > groups[groupKey].lastTimestamp) {
            groups[groupKey].lastTimestamp = notificationItem.timestamp;
            groups[groupKey].lastText = notificationItem.text;
          }
        }
      });
    }

    // Process regular notifications (filter out calls) - skip if SMS-only filter
    if (filterType !== 'sms') {
      validNotifications
        .filter(
          n =>
            n.type !== 'call' &&
            n.type !== 'missed_call' &&
            n.type !== 'whatsapp_call',
        )
        .forEach(n => {
          const groupKey = `${n.title}_${n.appName}_${n.type}`;

          if (!groups[groupKey]) {
            groups[groupKey] = {
              key: groupKey,
              title: n.title,
              appName: n.appName,
              type: n.type,
              lastText: n.text,
              lastTimestamp: n.timestamp,
              count: 1,
              unreadCount: n.read ? 0 : 1,
              notifications: [n],
              packageName: n.packageName,
              appIcon: (n as any).appIcon,
            };
          } else {
            groups[groupKey].count++;
            if (!n.read) groups[groupKey].unreadCount++;
            groups[groupKey].notifications.push(n);
            if (n.timestamp > groups[groupKey].lastTimestamp) {
              groups[groupKey].lastTimestamp = n.timestamp;
              groups[groupKey].lastText = n.text;
            }
            if (!groups[groupKey].packageName && n.packageName) {
              groups[groupKey].packageName = n.packageName;
            }
          }
        });
    }

    let result = Object.values(groups).sort(
      (a, b) => b.lastTimestamp - a.lastTimestamp,
    );

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        g =>
          (g.title || '').toLowerCase().includes(query) ||
          (g.lastText || '').toLowerCase().includes(query),
      );
    }

    return result;
  }, [notifications, smsMessages, searchQuery, filterType, contacts]);

  // Load devices list on mount
  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Permission handling
  const checkPermission = useCallback(async () => {
    try {
      if (filterType === 'sms' && Platform.OS === 'android') {
        const [hasReadSms, hasReceiveSms] = await Promise.all([
          PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
          PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
        ]);
        const granted = hasReadSms && hasReceiveSms;
        setHasPermission(granted);
        return granted;
      }

      const granted = await notificationService.isPermissionGranted();
      setHasPermission(granted);
      return granted;
    } catch (_error) {
      return false;
    }
  }, [filterType]);

  const requestPermission = useCallback(async () => {
    if (filterType === 'sms' && Platform.OS === 'android') {
      try {
        const smsResults = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_SMS,
          PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
        ]);
        const granted =
          smsResults[PermissionsAndroid.PERMISSIONS.READ_SMS] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          smsResults[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] ===
            PermissionsAndroid.RESULTS.GRANTED;
        setHasPermission(granted);
        if (granted && user && currentDevice) {
          loadSmsMessages(smsDeviceId);
        }
        return;
      } catch (_) {
        return;
      }
    }

    const isMiui = await notificationService.isMiuiDevice();

    if (isMiui) {
      AlertService.requestMiuiPermission({
        onAutoStartSettings: () => notificationService.openAutoStartSettings(),
        onNotificationSettings: () => notificationService.openSettings(),
      });
    } else {
      AlertService.requestNotificationPermission(() =>
        notificationService.openSettings(),
      );
    }
  }, [filterType, user, currentDevice, loadSmsMessages, smsDeviceId]);

  // Firebase operations
  const saveToFirebase = useCallback(
    async (notification: AppNotification) => {
      if (!user) return;
      const sanitizedKey = sanitizeFirestoreKey(notification.key);
      const uniqueId = `${sanitizedKey}_${notification.timestamp}`;
      const deviceId = currentDevice?.id ?? null;
      const notifData = {
        ...notification,
        id: uniqueId,
        deviceId: deviceId ?? 'user',
        createdAt: firestore.FieldValue.serverTimestamp(),
      };
      try {
        // Write to user-level path (with real deviceId so the extension can
        // attribute it to the correct device instead of showing "Android")
        await firestore()
          .collection('users')
          .doc(user.uid)
          .collection('notifications')
          .doc(uniqueId)
          .set(notifData, { merge: true });

        // Also write to per-device path so the extension per-device tab counts
        // this notification correctly
        if (deviceId) {
          await firestore()
            .collection('users')
            .doc(user.uid)
            .collection('devices')
            .doc(deviceId)
            .collection('notifications')
            .doc(uniqueId)
            .set(notifData, { merge: true });
        }
      } catch (_error: any) {
        // Silently handle Firebase errors
      }
    },
    [user, currentDevice],
  );

  // Handlers
  const handlePress = useCallback(
    (group: GroupedNotification) => {
      markGroupAsRead(group.title, group.appName, group.type);

      if (group.type === 'sms' && group.phoneNumber) {
        markMessagesAsReadBySender(group.phoneNumber);
      }

      navigation.navigate('Conversation', {
        title: group.title,
        appName: group.appName,
        type: group.type,
        phoneNumber: group.phoneNumber || group.key.replace('sms_', ''),
      });
    },
    [navigation, markGroupAsRead, markMessagesAsReadBySender],
  );

  const handleDelete = useCallback(
    async (group: GroupedNotification) => {
      group.notifications.forEach(n => removeNotification(n.id));
      if (group.type === 'sms') {
        const phoneNumber = group.key.replace('sms_', '');
        await deleteMessagesBySender(phoneNumber);
      }
    },
    [removeNotification, deleteMessagesBySender],
  );

  const handleMute = useCallback(
    (group: GroupedNotification) => {
      AlertService.showMuted({ itemName: group.title, isRTL });
    },
    [isRTL],
  );

  // Selection handlers
  const toggleSelectNotification = useCallback((key: string) => {
    setSelectedNotifications(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedNotifications.length === groupedNotifications.length) {
      setSelectedNotifications([]);
    } else {
      setSelectedNotifications(groupedNotifications.map(g => g.key));
    }
  }, [selectedNotifications.length, groupedNotifications]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedNotifications.length === 0) return;
    for (const key of selectedNotifications) {
      const group = groupedNotifications.find(g => g.key === key);
      if (group) {
        group.notifications.forEach(n => removeNotification(n.id));
        if (group.type === 'sms') {
          const phoneNumber = key.replace('sms_', '');
          await deleteMessagesBySender(phoneNumber);
        }
      }
    }
    setSelectedNotifications([]);
    setIsSelectMode(false);
  }, [
    selectedNotifications,
    groupedNotifications,
    removeNotification,
    deleteMessagesBySender,
  ]);

  const cancelSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedNotifications([]);
  }, []);

  const enterSelectMode = useCallback(() => {
    setIsSelectMode(true);
  }, []);

  // Effects
  useEffect(() => {
    checkPermission();
    notificationService.isMiuiDevice().then(isMiui => {
      setIsMiuiDevice(isMiui);
      if (isMiui) {
        notificationService.isServiceConnected().then(connected => {
          if (!connected) {
            setShowMiuiWarning(true);
          }
        });
      }
    });
    const interval = setInterval(checkPermission, 30000);
    return () => clearInterval(interval);
  }, [checkPermission]);

  // Load SMS from Firebase on mount
  useEffect(() => {
    if (user && currentDevice) {
      // Just kick off the listener — DON'T clear initialLoading here.
      // loadSmsMessages returns synchronously after attaching the Firestore
      // onSnapshot listener; the data arrives later (especially on a fresh
      // install where there is no cache and the historical batchSyncNativeSMS
      // hasn't run yet). The previous code cleared initialLoading in a
      // .finally() that fires immediately, so the spinner barely flashed.
      if (filterType !== 'sms' || hasPermission) {
        const loadKey = `${user.uid}:${smsDeviceId || 'all'}:${filterType || 'all'}:${hasPermission ? '1' : '0'}`;
        if (lastSmsLoadKeyRef.current !== loadKey) {
          lastSmsLoadKeyRef.current = loadKey;
          loadSmsMessages(smsDeviceId);
        }
      }
    }
  }, [
    user,
    currentDevice,
    loadSmsMessages,
    smsDeviceId,
    filterType,
    hasPermission,
  ]);

  // Clear initialLoading once messages/notifications actually arrive, OR
  // after a generous safety timeout (covers users with a truly empty inbox).
  useEffect(() => {
    if (!initialLoading) return;
    if (smsMessages.length > 0 || notifications.length > 0) {
      setInitialLoading(false);
      return;
    }
    const t = setTimeout(() => setInitialLoading(false), 30000);
    return () => clearTimeout(t);
  }, [initialLoading, smsMessages.length, notifications.length]);

  // Subscribe to notifications from Firebase
  useEffect(() => {
    if (!user || !currentDevice || !activeDeviceId) return;

    const unsubscribe = firestore()
      .collection('users')
      .doc(user.uid)
      .collection('devices')
      .doc(activeDeviceId)
      .collection('notifications')
      .orderBy('timestamp', 'desc')
      .limit(10000)
      .onSnapshot(
        snapshot => {
          const mapped: AppNotification[] = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            const type = data.type || 'other';

            if (
              type === 'sms' ||
              type === 'call' ||
              type === 'missed_call' ||
              type === 'whatsapp_call'
            ) {
              return;
            }

            const notification: AppNotification = {
              id: doc.id,
              key: data.key || `${data.packageName}_${data.timestamp}`,
              packageName: data.packageName || '',
              title: data.title || '',
              text: data.text || '',
              type: type,
              timestamp: data.timestamp || Date.now(),
              appName: data.appName || '',
              read: data.read ?? false,
            };
            mapped.push(notification);
          });

          setNotifications(mapped);
        },
        _error => {},
      );

    return () => unsubscribe();
  }, [user, currentDevice, setNotifications, activeDeviceId]);

  // Listen for new notifications
  useEffect(() => {
    if (!hasPermission) return;

    const unsubscribe = notificationService.onNotificationReceived(
      notification => {
        if (
          notification.type === 'sms' ||
          notification.packageName?.includes('messaging') ||
          notification.packageName?.includes('mms')
        ) {
          return;
        }

        if (
          notification.type === 'missed_call' ||
          notification.type === 'call' ||
          notification.type === 'whatsapp_call'
        ) {
          // استخدام phoneNumber من الإشعار إذا كان متوفراً
          const phoneNumber = (notification as any).phoneNumber || '';

          // تنظيف اسم جهة الاتصال من الإيموجي والرموز
          let contactName = notification.title || '';
          // إزالة الإيموجي والرموز الخاصة
          contactName = contactName
            .replace(
              /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[📞☎️]/gu,
              '',
            )
            .trim();
          // إذا كان الاسم هو نفس الرقم، استخدم الرقم النظيف
          if (/^[\d\s\-\+\(\)]+$/.test(contactName)) {
            contactName = phoneNumber || contactName.replace(/\s/g, '');
          }

          const callLog = {
            id: notification.id || `call_${notification.timestamp}`,
            userId: user?.uid || '',
            deviceId: currentDevice?.id || 'android',
            phoneNumber: phoneNumber,
            contactName: contactName,
            type: 'missed' as const,
            duration: 0,
            timestamp: notification.timestamp || Date.now(),
            syncedAt: Date.now(),
            source:
              notification.type === 'whatsapp_call' ? 'whatsapp' : 'phone',
          };

          console.log('[NotificationsScreen] Call notification converted:', {
            phoneNumber: callLog.phoneNumber,
            contactName: callLog.contactName,
            type: notification.type,
          });

          if (user?.uid) {
            addCallAndSync(callLog, user.uid);
          }
          return;
        }

        addNotification(notification);
        saveToFirebase(notification);
      },
    );
    return () => unsubscribe();
  }, [
    hasPermission,
    addNotification,
    saveToFirebase,
    addCallAndSync,
    user,
    currentDevice,
  ]);

  return {
    // Data
    groupedNotifications,
    searchQuery,
    isSelectMode,
    selectedNotifications,
    isLoading,
    initialLoading,
    hasPermission,
    smsRawCount: smsMessages.length,
    smsDebug,

    // Device filter
    devices,
    currentDevice,
    selectedDeviceId,
    setSelectedDeviceId,

    // Theme
    isRTL,
    isDarkMode,
    colors,
    bgColor,
    textColor,
    secondaryTextColor,

    // Handlers
    setSearchQuery,
    handlePress,
    handleDelete,
    handleMute,
    toggleSelectNotification,
    toggleSelectAll,
    handleDeleteSelected,
    cancelSelectMode,
    enterSelectMode,
    checkPermission,
    requestPermission,
  };
};
