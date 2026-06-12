import { useEffect, useCallback, useRef } from 'react';
import {
  NativeModules,
  Platform,
  PermissionsAndroid,
  Alert,
  DeviceEventEmitter,
  AppState,
  InteractionManager,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firestore from '@react-native-firebase/firestore';
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
    startDeviceDeleteListener,
  } = useDeviceStore();
  const { syncContactsToFirebase } = useContactStore();
  const pushListenerUnsubscribe = useRef<(() => void) | null>(null);
  const fcmTokenListenerUnsubscribe = useRef<(() => void) | null>(null);
  const deviceDeleteListenerUnsubscribe = useRef<(() => void) | null>(null);
  const lastContactSyncRef = useRef<number>(0);
  const initialSyncAttemptedRef = useRef(false);

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
        // Delay contact sync slightly to ensure Firestore auth token is ready
        setTimeout(() => syncContactsToFirebase(), 2000);
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

  // Watch for remote device deletion — sign out if device doc is removed
  // Use currentDevice?.id (primitive) to avoid re-triggering on every object reference change
  const currentDeviceId = currentDevice?.id;
  useEffect(() => {
    if (!user || !currentDeviceId) return;

    deviceDeleteListenerUnsubscribe.current = startDeviceDeleteListener();

    return () => {
      if (deviceDeleteListenerUnsubscribe.current) {
        deviceDeleteListenerUnsubscribe.current();
        deviceDeleteListenerUnsubscribe.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, currentDeviceId]);

  // One-time initial sync of existing calls & SMS from device to Firebase.
  // Runs as soon as both user and currentDevice are ready.
  // Key includes deviceId so re-installing on a new device re-syncs.
  useEffect(() => {
    if (!user || !currentDevice || Platform.OS !== 'android') return;
    if (initialSyncAttemptedRef.current) return;
    initialSyncAttemptedRef.current = true;

    const doInitialSync = async () => {
      try {
        // v10: initial call sync capped at 2000; SMS initial sync increased to 10000.
        const syncKey = `@iRopit:initialDeviceSyncDone_v10_${user.uid}_${currentDevice.id}`;
        const alreadySynced = await AsyncStorage.getItem(syncKey);
        if (alreadySynced) {
          console.log('[InitialSync] Already done, skipping');
          return;
        }

        console.log('[InitialSync] Starting first-time device sync...');

        // Check permissions before accessing native modules
        const [hasCallLog, hasSms] = await Promise.all([
          PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG),
          PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
        ]);

        if (!hasCallLog && !hasSms) {
          console.warn('[InitialSync] No READ_CALL_LOG or READ_SMS permissions, skipping');
          return;
        }

        // Sync call log — capped at 2000 newest calls on initial/fresh install.
        // Native query uses ORDER BY date DESC so the most recent 2000 are fetched first.
        const INITIAL_CALL_LIMIT = 2000;
        if (hasCallLog) {
          try {
            let nativeCalls: any[] = [];
            if (CallLogModule) {
              nativeCalls = (await CallLogModule.getCallLog(INITIAL_CALL_LIMIT)) || [];
            } else if (ZyncITModule?.getCallLog) {
              nativeCalls = (await ZyncITModule.getCallLog(INITIAL_CALL_LIMIT)) || [];
            }
            console.log(`[InitialSync] Got ${nativeCalls.length} calls from device`);
            if (nativeCalls.length > 0) {
              await useCallStore.getState().syncCalls(nativeCalls);
              console.log(`[InitialSync] Synced ${nativeCalls.length} calls to Firebase`);
            }
          } catch (e) {
            console.warn('[InitialSync] Call sync error:', e);
          }
        }

        // Sync SMS — limit to 10000 newest messages on initial/fresh install.
        // Native query uses ORDER BY date DESC so the most recent 10000 are fetched first.
        // Ongoing new SMS are synced in real-time via the SMS listener.
        const INITIAL_SMS_LIMIT = 10000;
        if (hasSms) {
          try {
            let nativeSms: any[] = [];
            if (SmsModule) {
              nativeSms = (await SmsModule.getAllSms(INITIAL_SMS_LIMIT)) || [];
            } else if (ZyncITModule?.getAllSms) {
              nativeSms = (await ZyncITModule.getAllSms(INITIAL_SMS_LIMIT)) || [];
            }
            console.log(`[InitialSync] Got ${nativeSms.length} SMS from device`);
            if (nativeSms.length > 0) {
              await useSMSStore.getState().batchSyncNativeSMS(nativeSms, user.uid);
              console.log(`[InitialSync] Synced ${nativeSms.length} SMS to Firebase`);
            }
          } catch (e) {
            console.warn('[InitialSync] SMS sync error:', e);
          }
        }

        await AsyncStorage.setItem(syncKey, 'true');
        console.log('[InitialSync] Complete');
      } catch (e) {
        console.warn('[InitialSync] Error:', e);
      }
    };

    // Defer the heavy work until after the UI has had time to mount/render,
    // then add a small delay so the first paint/navigation isn't blocked
    // by the native module call + encrypt/batch-write loop.
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        doInitialSync();
      }, 1500);
    });
  }, [user?.uid, currentDevice?.id]);

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
      // Request contacts and call-related permissions
      // READ_PHONE_STATE and READ_CALL_LOG are required for call history capture
      const permissions: string[] = [
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
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

      // SMS sending disabled - SmsRequestService no longer started

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

  // تحميل كل الرسائل من الجهاز — بدون حد
  const loadAllSMS = useCallback(async () => {
    if (Platform.OS !== 'android') return [];

    try {
      if (SmsModule) {
        const messages = await SmsModule.getAllSms(100000);
        return messages || [];
      } else if (ZyncITModule?.getAllSms) {
        const messages = await ZyncITModule.getAllSms(100000);
        return messages || [];
      }
      return [];
    } catch (error) {
      return [];
    }
  }, []);

  // تحميل سجل المكالمات من الجهاز — بدون حد
  const loadCallLog = useCallback(async () => {
    if (Platform.OS !== 'android') return [];

    try {
      // Use CallLogModule first, fallback to ZyncITModule
      if (CallLogModule) {
        const calls = await CallLogModule.getCallLog(100000);
        return calls || [];
      } else if (ZyncITModule?.getCallLog) {
        const calls = await ZyncITModule.getCallLog(100000);
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
        const { currentDevice } = useDeviceStore.getState();

        // ── Live ringing: write / clear the ringing_call sentinel doc ──────
        if (data.status === 'ringing' && currentDevice) {
          try {
            const ringingDocRef = firestore()
              .collection('users').doc(user.uid)
              .collection('devices').doc(currentDevice.id)
              .collection('ringing_call').doc('current');

            await ringingDocRef.set({
              status: 'ringing',
              phoneNumber: data.phoneNumber || data.number || '',
              contactName: data.contactName || data.name || null,
              deviceName: currentDevice.nickname || currentDevice.name || 'Android Device',
              simSlot: data.simSlot ?? -1,
              timestamp: Date.now(),
            });
          } catch (e) {
            console.error('[useNativeEvents] Failed to write ringing_call:', e);
          }
          return; // nothing else to do for a ringing event
        }

        // ── Call answered or ended: clear the ringing sentinel ───────────
        if ((data.status === 'answered' || data.status === 'ended') && currentDevice) {
          try {
            await firestore()
              .collection('users').doc(user.uid)
              .collection('devices').doc(currentDevice.id)
              .collection('ringing_call').doc('current')
              .delete();
          } catch (_) {}
        }

        // ── Live outgoing call: native CallReceiver writes outgoing_call directly
        // (works even when JS isn't running) and re-queries the call log to fill
        // in the dialed number on Android 10+. Don't duplicate the write here.
        if (data.type === 'outgoing' && data.status === 'started') {
          return;
        }

        // ── Outgoing call ended: clear the outgoing sentinel ─────────────
        if (data.status === 'ended' && currentDevice) {
          try {
            await firestore()
              .collection('users').doc(user.uid)
              .collection('devices').doc(currentDevice.id)
              .collection('outgoing_call').doc('current')
              .delete();
          } catch (_) {}
        }

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
          simSlot: data.simSlot ?? -1,
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
