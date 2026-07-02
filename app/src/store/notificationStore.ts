import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppNotification } from '../services/notificationService';
import firestore from '@react-native-firebase/firestore';
import { useAuthStore } from './authStore';
import { useDeviceStore } from './deviceStore';
import { COLLECTIONS } from '../constants';

interface NotificationState {
  notifications: AppNotification[];
  setNotifications: (notifications: AppNotification[]) => void;
  addNotification: (notification: AppNotification) => void;
  removeNotification: (id: string) => void;
  removeNotificationsByKeys: (keys: string[]) => void;
  markAsRead: (ids: string[]) => void;
  markGroupAsRead: (title: string, appName: string, type: string) => void;
  clearNotifications: () => void;
  getNotificationsByType: (type: string) => AppNotification[];
  getUnreadCount: (title: string, appName: string, type: string) => number;
  syncFromFirebase: (userId: string) => Promise<void>;
  loadNotificationsForConversation: (
    title: string,
    appName: string,
    type: string,
  ) => Promise<AppNotification[]>;
  cleanup: () => void;
}

const NOTIFICATION_STORE_CAP = 10000;

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],

      setNotifications: (notifications: AppNotification[]) => {
        const deduped = new Map<string, AppNotification>();
        notifications.forEach(n => {
          if (!n?.id) return;
          deduped.set(n.id, n);
        });
        const ordered = Array.from(deduped.values()).sort(
          (a, b) => b.timestamp - a.timestamp,
        );
        set({ notifications: ordered.slice(0, NOTIFICATION_STORE_CAP) });
      },

      addNotification: (notification: AppNotification) => {
        set(state => {
          // Use the Firestore docId (notification.id) as the primary dedup key.
          // The previous key+timestamp computation created a different id than
          // what was passed in, causing the same document (with a modified
          // timestamp field) to appear as a new entry.
          const dedupId = notification.id || (() => {
            const sanitizedKey = notification.key
              .replace(/[/|\\=\n\r\t]/g, '_')
              .replace(/[^a-zA-Z0-9_.-]/g, '_')
              .substring(0, 200);
            return `${sanitizedKey}_${notification.timestamp}`;
          })();

          const exists = state.notifications.find(n => n.id === dedupId);
          if (exists) {
            return state;
          }

          const notificationWithId = {
            ...notification,
            id: dedupId,
            read: false,
          };

          const updated = [notificationWithId, ...state.notifications].slice(0, NOTIFICATION_STORE_CAP);
          return { notifications: updated };
        });
      },

      removeNotification: (id: string) => {
        set(state => ({
          notifications: state.notifications.filter(n => n.id !== id),
        }));
      },

      removeNotificationsByKeys: (keys: string[]) => {
        set(state => ({
          notifications: state.notifications.filter(n => {
            // Check if notification's group key matches any of the keys to delete
            const notificationGroupKey = `${n.title}_${n.appName}_${n.type}`;
            return !keys.includes(notificationGroupKey);
          }),
        }));
      },

      markAsRead: (ids: string[]) => {
        set(state => ({
          notifications: state.notifications.map(n =>
            ids.includes(n.id) ? { ...n, read: true } : n,
          ),
        }));
      },

      markGroupAsRead: (title: string, appName: string, type: string) => {
        set(state => ({
          notifications: state.notifications.map(n =>
            n.title === title && n.appName === appName && n.type === type
              ? { ...n, read: true }
              : n,
          ),
        }));
      },

      clearNotifications: () => {
        set({ notifications: [] });
      },

      getNotificationsByType: (type: string) => {
        return get().notifications.filter(n => n.type === type);
      },

      getUnreadCount: (title: string, appName: string, type: string) => {
        return get().notifications.filter(
          n =>
            n.title === title &&
            n.appName === appName &&
            n.type === type &&
            !n.read,
        ).length;
      },

      syncFromFirebase: async (userId: string) => {
        const { currentDevice } = useDeviceStore.getState();
        if (!currentDevice) {
          return;
        }

        try {
          const snapshot = await firestore()
            .collection(COLLECTIONS.USERS)
            .doc(userId)
            .collection(COLLECTIONS.DEVICES)
            .doc(currentDevice.id)
            .collection(COLLECTIONS.NOTIFICATIONS)
            .orderBy('timestamp', 'desc')
            .limit(100)
            .get();

          const firebaseNotifications: AppNotification[] = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            firebaseNotifications.push({
              id: doc.id,
              key: data.key || doc.id,
              packageName: data.packageName || '',
              title: data.title || '',
              text: data.text || data.content || '',
              type: data.type || 'notification',
              timestamp: data.timestamp || data.receivedAt || Date.now(),
              appName: data.appName || '',
              read: data.read ?? false,
            });
          });

          set(state => {
            const merged = [...firebaseNotifications];
            state.notifications.forEach(n => {
              if (!merged.find(m => m.id === n.id)) {
                merged.push(n);
              }
            });
            merged.sort((a, b) => b.timestamp - a.timestamp);
            return { notifications: merged.slice(0, NOTIFICATION_STORE_CAP) };
          });
        } catch (error) {
          console.log('Error syncing notifications from Firebase:', error);
        }
      },

      loadNotificationsForConversation: async (
        title: string,
        appName: string,
        type: string,
      ): Promise<AppNotification[]> => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();

        if (!user || !currentDevice) {
          return [];
        }

        try {
          // Load all notifications and filter locally
          const snapshot = await firestore()
            .collection(COLLECTIONS.USERS)
            .doc(user.uid)
            .collection(COLLECTIONS.DEVICES)
            .doc(currentDevice.id)
            .collection(COLLECTIONS.NOTIFICATIONS)
            .where('type', '==', type)
            .orderBy('timestamp', 'desc')
            .get();

          const notifications: AppNotification[] = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            const notifTitle = data.title || '';
            const notifAppName = data.appName || '';

            // Filter by title and appName
            if (notifTitle === title && notifAppName === appName) {
              notifications.push({
                id: doc.id,
                key: data.key || doc.id,
                packageName: data.packageName || '',
                title: notifTitle,
                text: data.text || data.content || '',
                type: data.type || 'notification',
                timestamp: data.timestamp || data.receivedAt || Date.now(),
                appName: notifAppName,
                read: data.read ?? false,
              });
            }
          });

          return notifications;
        } catch (error) {
          console.log('Error loading notifications for conversation:', error);
          return [];
        }
      },

      cleanup: () => {
        set({ notifications: [] });
      },
    }),
    {
      name: 'notification-storage',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
