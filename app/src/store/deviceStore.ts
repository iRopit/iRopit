import { create } from 'zustand';
import firestore from '@react-native-firebase/firestore';
import messaging from '@react-native-firebase/messaging';
import { Platform, NativeModules, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';
import { useAuthStore } from './authStore';
import { COLLECTIONS } from '../constants';
import { NativeCredentialsService } from '../services/nativeCredentials';

const { UserCredentialsModule } = NativeModules;

const DEVICE_ID_KEY = '@iRopit:deviceId';

interface Device {
  id: string;
  name: string;
  nickname?: string;
  type: string;
  platform: string;
  model: string;
  userId?: string;
  createdAt?: number;
  lastSeen?: number;
  isOnline?: boolean;
  fcmToken?: string;
  batteryLevel?: number;
  batteryLastUpdatedAt?: number;
  isCharging?: boolean;
}

interface DeviceState {
  currentDevice: Device | null;
  devices: Device[];
  isLoading: boolean;
  error: string | null;
  registerDevice: () => Promise<void>;
  loadDevices: () => void;
  deleteDevice: (deviceId: string) => Promise<void>;
  updateOnlineStatus: (isOnline: boolean) => Promise<void>;
  updateFcmToken: (token: string) => Promise<void>;
  startOnlineStatusTracking: () => void;
  startFcmTokenListener: () => () => void;
  startDeviceDeleteListener: () => () => void;
  cleanup: () => void;
}

// Generate a unique device ID based on hardware
const generateDeviceId = async (): Promise<string> => {
  try {
    // Use device unique ID for consistent identification
    const uniqueId = await DeviceInfo.getUniqueId();
    return `${Platform.OS}_${uniqueId}`;
  } catch (e) {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 10);
    return `${Platform.OS}_${timestamp}_${randomPart}`;
  }
};

// Get or create persistent device ID
const getOrCreateDeviceId = async (): Promise<string> => {
  try {
    // FIRST: Try to get from native SharedPreferences (iRopitPrefs)
    // This is critical for consistency with BackgroundSmsService
    if (UserCredentialsModule?.getDeviceId) {
      try {
        const nativeId = await UserCredentialsModule.getDeviceId();
        if (nativeId) {
          // Sync to AsyncStorage for backup
          await AsyncStorage.setItem(DEVICE_ID_KEY, nativeId);
          return nativeId;
        } else {
        }
      } catch (e) {}
    }

    // Second: Check AsyncStorage for existing ID
    const storedId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (storedId) {
      return storedId;
    }

    // Generate new ID and store it
    const newId = await generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    return newId;
  } catch (e) {
    // Fallback if AsyncStorage fails
    const fallbackId = await generateDeviceId();
    return fallbackId;
  }
};

export const useDeviceStore = create<DeviceState>((set, get) => ({
  currentDevice: null,
  devices: [],
  isLoading: false,
  error: null,

  registerDevice: async () => {
    const { user } = useAuthStore.getState();
    if (!user) {
      return;
    }

    try {
      set({ isLoading: true, error: null });

      // Get persistent device ID
      const deviceId = await getOrCreateDeviceId();

      // Check if already registered in state
      const { currentDevice } = get();
      if (currentDevice && currentDevice.id === deviceId) {
        // Still refresh the device name in native storage so Java background
        // services pick up any nickname that was set via the extension.
        try {
          await NativeCredentialsService.saveDeviceName(
            currentDevice.nickname || currentDevice.name || 'Android',
          );
        } catch (_) {}
        set({ isLoading: false });
        return;
      }

      // Get real device info - with fallbacks to avoid undefined
      const deviceName = (await DeviceInfo.getDeviceName()) || 'Android Device';
      const deviceModel = (await DeviceInfo.getModel()) || 'Unknown';
      const systemName = (await DeviceInfo.getSystemName()) || Platform.OS;

      // Get FCM token for push notifications
      let fcmToken: string | null = null;
      try {
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (enabled) {
          fcmToken = await messaging().getToken();
          console.log(
            '[DeviceStore] FCM Token obtained:',
            fcmToken?.substring(0, 20) + '...',
          );
        }
      } catch (fcmError) {
        console.log('[DeviceStore] Could not get FCM token:', fcmError);
      }

      // Check if device already exists to preserve nickname
      // Wrapped in try-catch: if doc belongs to another user, permission-denied
      // is thrown here. We catch it and proceed without the existing data,
      // letting the write below claim the device under the current user's uid.
      let savedNickname: string | null = null;
      let savedCreatedAt: number | null = null;
      try {
        const existingDoc = await firestore()
          .collection(COLLECTIONS.DEVICES)
          .doc(deviceId)
          .get();
        const existingData = existingDoc.data();
        savedNickname = existingData?.nickname || null;
        savedCreatedAt = existingData?.createdAt || null;
      } catch (readError: any) {
        console.log('[DeviceStore] Could not read existing device doc (may belong to another user), will claim it:', readError?.code);
      }

      // Get battery info
      let batteryLevel: number | undefined;
      let isCharging: boolean | undefined;
      try {
        const rawLevel = await DeviceInfo.getBatteryLevel();
        if (rawLevel >= 0) batteryLevel = Math.round(rawLevel * 100);
        isCharging = await DeviceInfo.isBatteryCharging();
      } catch (_) {}

      // Build device object with no undefined values (Firebase rejects undefined)
      const device: Device = {
        id: deviceId,
        name: deviceName,
        type: 'phone',
        platform: systemName,
        model: deviceModel,
        userId: user.uid,
        lastSeen: Date.now(),
        createdAt: savedCreatedAt || Date.now(),
        isOnline: true,
      };

      // Only add nickname if it exists (avoid undefined)
      if (savedNickname) {
        device.nickname = savedNickname;
      }

      // Add FCM token if available
      if (fcmToken) {
        device.fcmToken = fcmToken;
      }

      // Add battery info if available
      if (batteryLevel !== undefined) device.batteryLevel = batteryLevel;
      if (batteryLevel !== undefined) device.batteryLastUpdatedAt = Date.now();
      if (isCharging !== undefined) device.isCharging = isCharging;

      // Save to Firestore - always use set with merge to avoid not-found errors
      await firestore()
        .collection(COLLECTIONS.DEVICES)
        .doc(deviceId)
        .set(device, { merge: true });

      // Save credentials to native BEFORE updating currentDevice state.
      // CallRequestService starts when currentDevice is set; it needs credentials
      // already in SharedPreferences or it will stop itself immediately.
      try {
        await NativeCredentialsService.saveCredentials(user.uid, deviceId);

        // Also save the friendly device name for background notifications
        const friendlyName = savedNickname || deviceName || 'Android';
        await NativeCredentialsService.saveDeviceName(friendlyName);
      } catch (credError) {}

      set({ currentDevice: device, isLoading: false });
    } catch (error: any) {
      // Fallback: create a local device only
      const { user: currentUser } = useAuthStore.getState();
      const fallbackDevice: Device = {
        id: `android_${Date.now()}`,
        name: 'Android Device',
        type: 'phone',
        platform: Platform.OS,
        model: 'Unknown',
        userId: currentUser?.uid,
      };

      set({
        currentDevice: fallbackDevice,
        isLoading: false,
        error: error.message,
      });
    }
  },

  loadDevices: () => {
    const { user } = useAuthStore.getState();
    if (!user) return;

    set({ isLoading: true });

    firestore()
      .collection(COLLECTIONS.DEVICES)
      .where('userId', '==', user.uid)
      .get()
      .then(snapshot => {
        const devices: Device[] = [];
        snapshot.forEach(doc => {
          devices.push({ id: doc.id, ...doc.data() } as Device);
        });
        set({ devices, isLoading: false });
      })
      .catch(error => {
        set({ error: error.message, isLoading: false });
      });
  },

  // ??? ???? ????? ????????
  deleteDevice: async (deviceId: string) => {
    const { user } = useAuthStore.getState();
    if (!user) return;

    set({ isLoading: true });

    try {
      // ??? ???? ????????? ?????? ???????
      const notificationsRef = firestore()
        .collection(COLLECTIONS.USERS)
        .doc(user.uid)
        .collection(COLLECTIONS.DEVICES)
        .doc(deviceId)
        .collection(COLLECTIONS.NOTIFICATIONS);

      const notificationsSnapshot = await notificationsRef.get();
      const batch = firestore().batch();

      notificationsSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });

      // ??? ?????? ?? ?????? devices ????????
      const devicesQuery = await firestore()
        .collection(COLLECTIONS.DEVICES)
        .where('id', '==', deviceId)
        .where('userId', '==', user.uid)
        .get();

      devicesQuery.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      // ????? ??????? ??????
      set(state => ({
        devices: state.devices.filter(d => d.id !== deviceId),
        isLoading: false,
      }));
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  cleanup: () => {
    set({ currentDevice: null, devices: [], error: null });
  },

  updateOnlineStatus: async (isOnline: boolean) => {
    const { currentDevice } = get();
    if (!currentDevice) return;

    try {
      const updateData: Record<string, any> = {
        isOnline,
        lastSeen: Date.now(),
      };

      // Refresh battery when coming to foreground
      if (isOnline) {
        try {
          const rawLevel = await DeviceInfo.getBatteryLevel();
          if (rawLevel >= 0) {
            updateData.batteryLevel = Math.round(rawLevel * 100);
            updateData.batteryLastUpdatedAt = Date.now();
          }
          updateData.isCharging = await DeviceInfo.isBatteryCharging();
        } catch (_) {}
      }

      // Use set with merge to avoid not-found errors
      await firestore()
        .collection(COLLECTIONS.DEVICES)
        .doc(currentDevice.id)
        .set(updateData, { merge: true });

      set({
        currentDevice: { ...currentDevice, ...updateData },
      });
    } catch (error) {}
  },

  startOnlineStatusTracking: () => {
    const { updateOnlineStatus } = get();

    // Set online when app becomes active
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active') {
        updateOnlineStatus(true);
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        updateOnlineStatus(false);
      }
    };

    AppState.addEventListener('change', handleAppStateChange);

    // Set online immediately
    updateOnlineStatus(true);

    // Start periodic battery polling every 10 minutes
    startBatteryPolling();
  },

  updateFcmToken: async (token: string) => {
    const { currentDevice } = get();
    if (!currentDevice) return;

    try {
      await firestore()
        .collection(COLLECTIONS.DEVICES)
        .doc(currentDevice.id)
        .set({ fcmToken: token }, { merge: true });

      set({
        currentDevice: { ...currentDevice, fcmToken: token },
      });

      console.log('[DeviceStore] FCM token updated');
    } catch (error) {
      console.error('[DeviceStore] Error updating FCM token:', error);
    }
  },

  startFcmTokenListener: () => {
    const { updateFcmToken } = get();

    // Listen for FCM token refresh
    const unsubscribe = messaging().onTokenRefresh(token => {
      console.log('[DeviceStore] FCM token refreshed');
      updateFcmToken(token);
    });

    return unsubscribe;
  },

  startDeviceDeleteListener: () => {
    const { currentDevice } = get();
    if (!currentDevice) return () => {};

    console.log('[DeviceStore] Starting device delete listener for:', currentDevice.id);

    // Skip the first snapshot — it may reflect a stale Firestore cache from
    // a previous deletion and would incorrectly trigger sign-out on re-login.
    let isFirstSnapshot = true;

    const unsubscribe = firestore()
      .collection(COLLECTIONS.DEVICES)
      .doc(currentDevice.id)
      .onSnapshot(
        snapshot => {
          // exists may be a getter property (boolean) or a method (function) depending on RN Firebase version
          const docExists = typeof snapshot.exists === 'function'
            ? (snapshot.exists as unknown as () => boolean)()
            : snapshot.exists;
          console.log('[DeviceStore] Device snapshot — exists:', docExists, 'firstSnapshot:', isFirstSnapshot);
          if (isFirstSnapshot) {
            isFirstSnapshot = false;
            return; // Ignore first (potentially stale cached) snapshot
          }
          if (!docExists) {
            console.log('[DeviceStore] Device document deleted remotely — signing out');
            const { Alert } = require('react-native');
            Alert.alert(
              'Device Removed',
              'This device has been removed. You will be signed out.',
              [{
                text: 'OK',
                onPress: () => {
                  useAuthStore.getState().signOut().catch((err: any) => {
                    console.error('[DeviceStore] Sign out after delete failed:', err);
                  });
                },
              }],
              { cancelable: false },
            );
          }
        },
        error => {
          console.warn('[DeviceStore] Device delete listener error:', error.code || error.message);
          // Only auto-signout on permission-denied AFTER the first snapshot was processed.
          // During initial setup (isFirstSnapshot still true) the error is a stale rule
          // mismatch — not an account deletion. After that, permission-denied means the
          // Firebase auth account was deleted remotely (e.g. via Delete Account in Chrome).
          if (!isFirstSnapshot && error?.code === 'firestore/permission-denied') {
            console.log('[DeviceStore] Permission denied after registration — account likely deleted, signing out');
            useAuthStore.getState().signOut().catch(() => {});
          }
        },
      );

    return unsubscribe;
  },
}));

/**
 * Periodic battery polling - updates every 10 minutes
 */
let batteryPollingInterval: NodeJS.Timeout | null = null;

function startBatteryPolling() {
  // Clear any existing interval
  if (batteryPollingInterval) {
    clearInterval(batteryPollingInterval);
  }

  // Poll every 10 minutes (600000ms)
  batteryPollingInterval = setInterval(async () => {
    const { currentDevice } = useDeviceStore.getState();
    if (!currentDevice) return;

    try {
      const rawLevel = await DeviceInfo.getBatteryLevel();
      if (rawLevel >= 0) {
        const updateData = {
          batteryLevel: Math.round(rawLevel * 100),
          batteryLastUpdatedAt: Date.now(),
        };

        // Add isCharging if available
        try {
          updateData.isCharging = await DeviceInfo.isBatteryCharging();
        } catch (_) {}

        // Update Firestore
        await firestore()
          .collection(COLLECTIONS.DEVICES)
          .doc(currentDevice.id)
          .set(updateData, { merge: true });

        // Update local state
        useDeviceStore.setState({
          currentDevice: { ...currentDevice, ...updateData },
        });

        console.log('[DeviceStore] Battery polling update:', updateData.batteryLevel + '%');
      }
    } catch (error) {
      console.warn('[DeviceStore] Battery polling error:', error?.message);
    }
  }, 600000); // 10 minutes
}
