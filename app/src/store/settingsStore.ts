import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firestore from '@react-native-firebase/firestore';

interface Settings {
  // Notifications
  smsNotifications: boolean;
  callNotifications: boolean;
  chatNotifications: boolean;
  notificationSound: boolean;
  // Sync
  autoSync: boolean;
  wifiOnlySync: boolean;
  syncInterval: number; // minutes
  // Appearance
  darkMode: boolean;
  language: 'ar' | 'en';
  // Security
  appLock: boolean;
  lockPin: string | null;
  biometricLock: boolean;
}

interface SettingsState extends Settings {
  isLoading: boolean;
  updateSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
  loadFromFirebase: (userId: string) => Promise<void>;
  syncToFirebase: (userId: string) => Promise<void>;
  resetSettings: () => void;
}

const defaultSettings: Settings = {
  smsNotifications: true,
  callNotifications: true,
  chatNotifications: true,
  notificationSound: true,
  autoSync: true,
  wifiOnlySync: false,
  syncInterval: 5,
  darkMode: false,
  language: 'en',
  appLock: false,
  lockPin: null,
  biometricLock: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      isLoading: false,

      updateSetting: async (key, value) => {
        set({ [key]: value } as any);
      },

      loadFromFirebase: async (userId: string) => {
        try {
          set({ isLoading: true });
          const doc = await firestore()
            .collection('settings')
            .doc(userId)
            .get();
          if (doc.exists) {
            const data = doc.data() as Settings;
            set({ ...data, isLoading: false });
          } else {
            set({ isLoading: false });
          }
        } catch (error) {
          set({ isLoading: false });
        }
      },

      syncToFirebase: async (userId: string) => {
        try {
          const state = get();
          const settings: Settings = {
            smsNotifications: state.smsNotifications,
            callNotifications: state.callNotifications,
            chatNotifications: state.chatNotifications,
            notificationSound: state.notificationSound,
            autoSync: state.autoSync,
            wifiOnlySync: state.wifiOnlySync,
            syncInterval: state.syncInterval,
            darkMode: state.darkMode,
            language: state.language,
            appLock: state.appLock,
            lockPin: state.lockPin,
            biometricLock: state.biometricLock,
          };
          await firestore()
            .collection('settings')
            .doc(userId)
            .set(settings, { merge: true });
        } catch (error) {}
      },

      resetSettings: () => {
        set(defaultSettings);
      },
    }),
    {
      name: 'iropit-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
