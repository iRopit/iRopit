import { useEffect, useCallback, useRef } from 'react';
import {
  NativeModules,
  Platform,
  PermissionsAndroid,
  Alert,
  DeviceEventEmitter,
  AppState,
} from 'react-native';
import { useSMSStore } from '../store/smsStore';
import { useCallStore } from '../store/callStore';
import { useAuthStore } from '../store/authStore';
import { useDeviceStore } from '../store/deviceStore';
import { useContactStore } from '../store/contactStore';
import { startPushNotificationListener } from '../services/pushNotificationListener';

const { ZyncITModule, CallLogModule, SmsModule } = NativeModules;

/**
 * Hook للاستماع للأحداث من Native Module
 * يربط بين الـ Native Android Code و React Native
 * @param listenToEvents - إذا كان true، يستمع للأحداث الجديدة (SMS/Calls). استخدمه فقط مرة واحدة في App.tsx
 */
export const useNativeEvents = (listenToEvents: boolean = false) => {
  const {
    addMessage,
    addMessageAndSync,
    syncMessagesToFirebase,
    listenForSMSRequests,
  } = useSMSStore();
  const { addCall, addCallAndSync, syncCallsToFirebase } = useCallStore();
  const { user } = useAuthStore();
  const {
    currentDevice,
    registerDevice,
    startOnlineStatusTracking,
    startFcmTokenListener,
  } = useDeviceStore();
  const { syncContactsToFirebase } = useContactStore();
  const pushListenerUnsubscribe = useRef<(() => void) | null>(null);
  const fcmTokenListenerUnsubscribe = useRef<(() => void) | null>(null);
  const lastContactSyncRef = useRef<number>(0);

  // Re-sync contacts when app comes to foreground (max once per 5 minutes)
  useEffect(() => {
    if (!user || !currentDevice) return;

    const handleAppState = (nextAppState: string) => {
      if (nextAppState === 'active') {
        const now = Date.now();
        const FIVE_MINUTES = 5 * 60 * 1000;
        if (now - lastContactSyncRef.current > FIVE_MINUTES) {
          lastContactSyncRef.current = now;
          console.log('[Contacts] App foregrounded - re-syncing contacts');
          syncContactsToFirebase();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);
    return () => subscription.remove();
  }, [user, currentDevice, syncContactsToFirebase]);

  // تسجيل الجهاز عند تحميل المستخدم
  useEffect(() => {
    if (user && !currentDevice) {
      registerDevice().then(() => {
        startOnlineStatusTracking();
        // مزامنة جهات الاتصال بعد تسجيل الجهاز
        syncContactsToFirebase();
        // Start FCM token refresh listener
        fcmTokenListenerUnsubscribe.current = startFcmTokenListener();
      });
    }

    return () => {
      if (fcmTokenListenerUnsubscribe.current) {
        fcmTokenListenerUnsubscribe.current();
        fcmTokenListenerUnsubscribe.current = null;
      }
    };
  }, [
    user,
    currentDevice,
    registerDevice,
    startOnlineStatusTracking,
    syncContactsToFirebase,
    startFcmTokenListener,
  ]);

  // الاستماع لطلبات إرسال SMS من Chrome Extension + بدء Foreground Service
  useEffect(() => {
    if (user && currentDevice) {
      listenForSMSRequests();

      if (Platform.OS === 'android' && SmsModule?.startSmsRequestService) {
        SmsModule.startSmsRequestService().catch(() => {});
      }

      // Start push notification listener
      pushListenerUnsubscribe.current = startPushNotificationListener();
    }

    return () => {
      if (pushListenerUnsubscribe.current) {
        pushListenerUnsubscribe.current();
        pushListenerUnsubscribe.current = null;
      }
    };
  }, [user, currentDevice, listenForSMSRequests]);

  // طلب الأذونات المطلوبة
  const requestPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return false;

    try {
      // Request contacts, SEND_SMS, and call-related permissions
      // SEND_SMS is for sending SMS from Chrome Extension (core feature)
      // READ_PHONE_STATE and READ_CALL_LOG are required for call history capture
      const permissions: string[] = [
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        PermissionsAndroid.PERMISSIONS.SEND_SMS,
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      ];

      // POST_NOTIFICATIONS is required on Android 13+ (API 33+) for showing
      // dial-prompt and sync notifications. Without it all notifications are silently dropped.
      if (Platform.Version >= 33) {
        permissions.push('android.permission.POST_NOTIFICATIONS');
      }

      const results = await PermissionsAndroid.requestMultiple(permissions);

      const allGranted = Object.values(results).every(
        result => result === PermissionsAndroid.RESULTS.GRANTED,
      );

      // Start SMS Request Service if SEND_SMS is granted
      if (
        results[PermissionsAndroid.PERMISSIONS.SEND_SMS] ===
        PermissionsAndroid.RESULTS.GRANTED
      ) {
        if (SmsModule?.startSmsRequestService) {
          SmsModule.startSmsRequestService().catch(() => {});
        }
      }

      return allGranted;
    } catch (error) {
      return false;
    }
  }, []);

  // بدء خدمة المزامنة
  const startSyncService = useCallback(async () => {
    if (Platform.OS !== 'android' || !ZyncITModule) return;

    try {
      const hasPermissions = await requestPermissions();
      if (hasPermissions) {
        await ZyncITModule.startSyncService();
      }
    } catch (error) {}
  }, [requestPermissions]);

  // إيقاف خدمة المزامنة
  const stopSyncService = useCallback(async () => {
    if (Platform.OS !== 'android' || !ZyncITModule) return;

    try {
      await ZyncITModule.stopSyncService();
    } catch (error) {}
  }, []);

  // تحميل كل الرسائل من الجهاز
  const loadAllSMS = useCallback(async () => {
    if (Platform.OS !== 'android') return [];

    try {
      if (SmsModule) {
        const messages = await SmsModule.getAllSms(100);
        return messages || [];
      } else if (ZyncITModule?.getAllSms) {
        const messages = await ZyncITModule.getAllSms(100);
        return messages || [];
      }
      return [];
    } catch (error) {
      return [];
    }
  }, []);

  // تحميل سجل المكالمات من الجهاز
  const loadCallLog = useCallback(async () => {
    if (Platform.OS !== 'android') return [];

    try {
      // Use CallLogModule first, fallback to ZyncITModule
      if (CallLogModule) {
        const calls = await CallLogModule.getCallLog(100);
        return calls || [];
      } else if (ZyncITModule?.getCallLog) {
        const calls = await ZyncITModule.getCallLog(100);
        return calls || [];
      }
      return [];
    } catch (error) {
      return [];
    }
  }, []);

  // إرسال رسالة SMS
  const sendSMS = useCallback(async (phoneNumber: string, message: string) => {
    if (Platform.OS !== 'android' || !ZyncITModule) {
      throw new Error('SMS sending is only available on Android');
    }

    try {
      const result = await ZyncITModule.sendSMS(phoneNumber, message);
      return result;
    } catch (error) {
      throw error;
    }
  }, []);

  // الاستماع للأحداث من Native Module - فقط إذا كان listenToEvents = true
  useEffect(() => {
    if (!listenToEvents || Platform.OS !== 'android' || !user) return;

    // الاستماع لرسائل SMS الجديدة - نستخدم DeviceEventEmitter مباشرة
    const smsSubscription = DeviceEventEmitter.addListener(
      'onSmsReceived',
      async data => {
        // ملاحظة: BackgroundSmsService يقوم بحفظ الرسالة في Firebase
        // هنا فقط نستمع للحدث لتحديث الـ UI إذا لزم الأمر
        // الرسالة ستظهر تلقائياً من real-time listener في smsStore
      },
    );

    // الاستماع للمكالمات الجديدة - نستخدم DeviceEventEmitter مباشرة
    const callSubscription = DeviceEventEmitter.addListener(
      'onCallReceived',
      async data => {
        // Only process 'ended' events - they have correct type + duration from call log
        // Intermediate events (ringing, answered, started) have duration=0 and incomplete type
        if (data.status !== 'ended') return;

        // CallReceiver يرسل phoneNumber و contactName
        const phoneNumber = data.phoneNumber || data.number || 'Unknown';
        const contactName = data.contactName || data.name || '';
        const callTimestamp = data.timestamp || Date.now();

        const newCall = {
          id: `call_${callTimestamp}_${phoneNumber}`,
          userId: user.uid,
          phoneNumber: phoneNumber,
          contactName: contactName,
          type: data.type as 'incoming' | 'outgoing' | 'missed',
          duration: data.duration || 0,
          timestamp: callTimestamp,
          deviceId: 'android',
          syncedAt: Date.now(),
        };

        // حفظ في Firebase مباشرة
        await addCallAndSync(newCall, user.uid);
      },
    );

    return () => {
      smsSubscription?.remove();
      callSubscription?.remove();
    };
  }, [listenToEvents, user, addMessageAndSync, addCallAndSync]);

  // Start call listener for real-time call events
  const startCallListener = useCallback(async () => {
    if (Platform.OS !== 'android') return;

    try {
      const hasPermissions = await requestPermissions();
      if (hasPermissions) {
        // Use CallLogModule.startListening to register the receiver
        if (CallLogModule?.startListening) {
          await CallLogModule.startListening();
        } else if (ZyncITModule?.startCallListener) {
          await ZyncITModule.startCallListener();
        } else {
        }
      }
    } catch (error) {}
  }, [requestPermissions]);

  return {
    requestPermissions,
    startSyncService,
    stopSyncService,
    loadAllSMS,
    loadCallLog,
    sendSMS,
    startCallListener,
  };
};

export default useNativeEvents;
