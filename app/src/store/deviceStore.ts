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
      const existingDoc = await firestore()
        .collection(COLLECTIONS.DEVICES)
        .doc(deviceId)
        .get();

      const existingData = existingDoc.data();
      const savedNickname = existingData?.nickname || null;

      // Build device object with no undefined values (Firebase rejects undefined)
      const device: Device = {
        id: deviceId,
        name: deviceName,
        type: 'phone',
        platform: systemName,
        model: deviceModel,
        userId: user.uid,
        lastSeen: Date.now(),
        createdAt: existingData?.createdAt || Date.now(),
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
      // Use set with merge to avoid not-found errors
      await firestore()
        .collection(COLLECTIONS.DEVICES)
        .doc(currentDevice.id)
        .set(
          {
            isOnline,
            lastSeen: Date.now(),
          },
          { merge: true },
        );

      set({
        currentDevice: { ...currentDevice, isOnline, lastSeen: Date.now() },
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

    console.log('[DeviceStore] Watching device document:', currentDevice.id);

    const unsubscribe = firestore()
      .collection(COLLECTIONS.DEVICES)
      .doc(currentDevice.id)
      .onSnapshot(
        doc => {
          if (!doc.exists) {
            console.log(
              '[DeviceStore] Device document deleted remotely — signing out',
            );
            const { useAuthStore } = require('../store/authStore');
            useAuthStore.getState().signOut().catch(() => {});
          }
        },
        error => {
          console.warn('[DeviceStore] Device delete listener error:', error);
        },
      );

    return unsubscribe;
  },
}));
