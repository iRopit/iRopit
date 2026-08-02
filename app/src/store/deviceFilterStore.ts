import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface DeviceFilterState {
  callsDeviceId: string | null;
  smsDeviceId: string | null;
  notificationsDeviceId: string | null;
  setCallsDeviceId: (deviceId: string | null) => void;
  setSmsDeviceId: (deviceId: string | null) => void;
  setNotificationsDeviceId: (deviceId: string | null) => void;
  clearDeviceFilters: () => void;
}

export const useDeviceFilterStore = create<DeviceFilterState>()(
  persist(
    set => ({
      callsDeviceId: null,
      smsDeviceId: null,
      notificationsDeviceId: null,

      setCallsDeviceId: (deviceId: string | null) => {
        set({ callsDeviceId: deviceId });
      },

      setSmsDeviceId: (deviceId: string | null) => {
        set({ smsDeviceId: deviceId });
      },

      setNotificationsDeviceId: (deviceId: string | null) => {
        set({ notificationsDeviceId: deviceId });
      },

      clearDeviceFilters: () => {
        set({
          callsDeviceId: null,
          smsDeviceId: null,
          notificationsDeviceId: null,
        });
      },
    }),
    {
      name: 'device-filter-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
