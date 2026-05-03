/**
 * NotificationContext
 * Local notifications management context
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  EventType,
  Notification,
  Event,
} from '@notifee/react-native';
import { handleChatNotificationAction } from '../services/chatNotificationActions';

// Types
export type NotificationType = 'sms' | 'call' | 'chat' | 'system' | 'alert';
export type NotificationPriority = 'high' | 'default' | 'low';

export interface NotificationPayload {
  id?: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: NotificationPriority;
  sound?: boolean;
  vibrate?: boolean;
  badge?: number;
  /** Schedule notification for later (timestamp in ms) */
  scheduledTime?: number;
}

export interface NotificationState {
  hasPermission: boolean;
  isInitialized: boolean;
  pendingNotifications: Notification[];
  lastNotification: Notification | null;
}

export interface NotificationContextValue extends NotificationState {
  // Actions
  requestPermission: () => Promise<boolean>;
  showNotification: (payload: NotificationPayload) => Promise<string | null>;
  scheduleNotification: (
    payload: NotificationPayload,
  ) => Promise<string | null>;
  cancelNotification: (notificationId: string) => Promise<void>;
  cancelAllNotifications: () => Promise<void>;
  getBadgeCount: () => Promise<number>;
  setBadgeCount: (count: number) => Promise<void>;
  clearBadge: () => Promise<void>;
  getPendingNotifications: () => Promise<Notification[]>;
}

// Channel IDs
const CHANNEL_IDS = {
  sms: 'iropit_sms',
  call: 'iropit_calls',
  chat: 'iropit_chat',
  system: 'iropit_system',
  alert: 'iropit_alerts',
};

// Default state
const defaultState: NotificationState = {
  hasPermission: false,
  isInitialized: false,
  pendingNotifications: [],
  lastNotification: null,
};

// Create context
const NotificationContext = createContext<NotificationContextValue | undefined>(
  undefined,
);

// Provider Props
interface NotificationProviderProps {
  children: ReactNode;
  onNotificationPress?: (notification: Notification) => void;
  onNotificationReceived?: (notification: Notification) => void;
}

/**
 * NotificationProvider Component
 */
export const NotificationProvider: React.FC<NotificationProviderProps> = ({
  children,
  onNotificationPress,
  onNotificationReceived,
}) => {
  const [state, setState] = useState<NotificationState>(defaultState);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Create notification channels (Android)
  const createChannels = useCallback(async () => {
    if (Platform.OS !== 'android') return;

    await notifee.createChannel({
      id: CHANNEL_IDS.sms,
      name: 'الرسائل النصية',
      description: 'إشعارات الرسائل النصية',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      sound: 'default',
      vibration: true,
    });

    await notifee.createChannel({
      id: CHANNEL_IDS.call,
      name: 'المكالمات',
      description: 'إشعارات المكالمات',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      sound: 'default',
      vibration: true,
    });

    await notifee.createChannel({
      id: CHANNEL_IDS.chat,
      name: 'المحادثات',
      description: 'إشعارات المحادثات',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      sound: 'default',
      vibration: true,
    });

    await notifee.createChannel({
      id: CHANNEL_IDS.system,
      name: 'النظام',
      description: 'إشعارات النظام',
      importance: AndroidImportance.DEFAULT,
      visibility: AndroidVisibility.PUBLIC,
    });

    await notifee.createChannel({
      id: CHANNEL_IDS.alert,
      name: 'التنبيهات',
      description: 'التنبيهات المهمة',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      sound: 'default',
      vibration: true,
    });

    // FCM default channel (fallback for push notifications)
    await notifee.createChannel({
      id: 'chat_notifications',
      name: 'Chat Notifications',
      description: 'Push notification channel for chat messages',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      sound: 'default',
      vibration: true,
    });
  }, []);

  // Initialize notifications
  useEffect(() => {
    const initialize = async () => {
      try {
        // Create channels
        await createChannels();

        // Check permission
        const settings = await notifee.getNotificationSettings();
        const hasPermission = settings.authorizationStatus >= 1;

        // Get pending notifications
        const pending = await notifee.getTriggerNotifications();
        const notifications = pending.map(t => t.notification);

        setState({
          hasPermission,
          isInitialized: true,
          pendingNotifications: notifications,
          lastNotification: null,
        });
      } catch (error) {
        console.error('Failed to initialize notifications:', error);
        setState(prev => ({ ...prev, isInitialized: true }));
      }
    };

    initialize();
  }, [createChannels]);

  // Handle notification events
  useEffect(() => {
    const unsubscribe = notifee.onForegroundEvent(({ type, detail }: Event) => {
      switch (type) {
        case EventType.PRESS:
          if (detail.notification) {
            setState(prev => ({
              ...prev,
              lastNotification: detail.notification!,
            }));
            onNotificationPress?.(detail.notification);
          }
          break;
        case EventType.ACTION_PRESS:
          if (detail.pressAction?.id && detail.notification) {
            handleChatNotificationAction(
              detail.pressAction.id,
              (detail.notification.data || {}) as Record<string, string>,
              detail.notification.id,
            );
          }
          break;
        case EventType.DELIVERED:
          if (detail.notification) {
            onNotificationReceived?.(detail.notification);
          }
          break;
      }
    });

    return unsubscribe;
  }, [onNotificationPress, onNotificationReceived]);

  // Handle app state changes for badge
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === 'active'
      ) {
        // App came to foreground - could refresh notifications here
      }
      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, []);

  // Request permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const settings = await notifee.requestPermission();
      const hasPermission = settings.authorizationStatus >= 1;
      setState(prev => ({ ...prev, hasPermission }));
      return hasPermission;
    } catch (error) {
      console.error('Failed to request notification permission:', error);
      return false;
    }
  }, []);

  // Show notification
  const showNotification = useCallback(
    async (payload: NotificationPayload): Promise<string | null> => {
      try {
        const channelId = CHANNEL_IDS[payload.type] || CHANNEL_IDS.system;

        const notificationId = await notifee.displayNotification({
          id: payload.id,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          android: {
            channelId,
            importance:
              payload.priority === 'high'
                ? AndroidImportance.HIGH
                : AndroidImportance.DEFAULT,
            sound: payload.sound !== false ? 'default' : undefined,
            vibrationPattern:
              payload.vibrate !== false ? [300, 500] : undefined,
            pressAction: { id: 'default' },
            smallIcon: 'ic_notification',
          },
          ios: {
            sound: payload.sound !== false ? 'default' : undefined,
            badgeCount: payload.badge,
          },
        });

        return notificationId;
      } catch (error) {
        console.error('Failed to show notification:', error);
        return null;
      }
    },
    [],
  );

  // Schedule notification
  const scheduleNotification = useCallback(
    async (payload: NotificationPayload): Promise<string | null> => {
      if (!payload.scheduledTime) {
        return showNotification(payload);
      }

      try {
        const channelId = CHANNEL_IDS[payload.type] || CHANNEL_IDS.system;

        const notificationId = await notifee.createTriggerNotification(
          {
            id: payload.id,
            title: payload.title,
            body: payload.body,
            data: payload.data,
            android: {
              channelId,
              pressAction: { id: 'default' },
              smallIcon: 'ic_notification',
            },
            ios: {
              sound: payload.sound !== false ? 'default' : undefined,
            },
          },
          {
            type: 0, // Timestamp trigger
            timestamp: payload.scheduledTime,
          },
        );

        // Update pending notifications
        const pending = await notifee.getTriggerNotifications();
        setState(prev => ({
          ...prev,
          pendingNotifications: pending.map(t => t.notification),
        }));

        return notificationId;
      } catch (error) {
        console.error('Failed to schedule notification:', error);
        return null;
      }
    },
    [showNotification],
  );

  // Cancel notification
  const cancelNotification = useCallback(async (notificationId: string) => {
    try {
      await notifee.cancelNotification(notificationId);

      // Update pending notifications
      const pending = await notifee.getTriggerNotifications();
      setState(prev => ({
        ...prev,
        pendingNotifications: pending.map(t => t.notification),
      }));
    } catch (error) {
      console.error('Failed to cancel notification:', error);
    }
  }, []);

  // Cancel all notifications
  const cancelAllNotifications = useCallback(async () => {
    try {
      await notifee.cancelAllNotifications();
      setState(prev => ({ ...prev, pendingNotifications: [] }));
    } catch (error) {
      console.error('Failed to cancel all notifications:', error);
    }
  }, []);

  // Get badge count
  const getBadgeCount = useCallback(async (): Promise<number> => {
    try {
      return await notifee.getBadgeCount();
    } catch (error) {
      console.error('Failed to get badge count:', error);
      return 0;
    }
  }, []);

  // Set badge count
  const setBadgeCount = useCallback(async (count: number) => {
    try {
      await notifee.setBadgeCount(count);
    } catch (error) {
      console.error('Failed to set badge count:', error);
    }
  }, []);

  // Clear badge
  const clearBadge = useCallback(async () => {
    try {
      await notifee.setBadgeCount(0);
    } catch (error) {
      console.error('Failed to clear badge:', error);
    }
  }, []);

  // Get pending notifications
  const getPendingNotifications = useCallback(async (): Promise<
    Notification[]
  > => {
    try {
      const pending = await notifee.getTriggerNotifications();
      return pending.map(t => t.notification);
    } catch (error) {
      console.error('Failed to get pending notifications:', error);
      return [];
    }
  }, []);

  // Memoized context value
  const value = useMemo<NotificationContextValue>(
    () => ({
      ...state,
      requestPermission,
      showNotification,
      scheduleNotification,
      cancelNotification,
      cancelAllNotifications,
      getBadgeCount,
      setBadgeCount,
      clearBadge,
      getPendingNotifications,
    }),
    [
      state,
      requestPermission,
      showNotification,
      scheduleNotification,
      cancelNotification,
      cancelAllNotifications,
      getBadgeCount,
      setBadgeCount,
      clearBadge,
      getPendingNotifications,
    ],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

/**
 * useNotifications Hook
 */
export const useNotifications = (): NotificationContextValue => {
  const context = useContext(NotificationContext);

  if (context === undefined) {
    throw new Error(
      'useNotifications must be used within a NotificationProvider',
    );
  }

  return context;
};

export default NotificationContext;
