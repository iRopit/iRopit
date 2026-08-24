/**
 * In-App Notification Context
 * Provides a global way to show toast notifications from anywhere
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast, { ToastType } from '../components/feedback/Toast';
import { useSettingsStore } from '../store/settingsStore';

interface NotificationData {
  id: string;
  title?: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface InAppNotificationContextType {
  showNotification: (options: {
    title?: string;
    message: string;
    type?: ToastType;
    duration?: number;
  }) => void;
  hideNotification: () => void;
}

const InAppNotificationContext =
  createContext<InAppNotificationContextType | null>(null);

export const useInAppNotification = () => {
  const context = useContext(InAppNotificationContext);
  if (!context) {
    throw new Error(
      'useInAppNotification must be used within InAppNotificationProvider',
    );
  }
  return context;
};

interface Props {
  children: React.ReactNode;
}

export const InAppNotificationProvider: React.FC<Props> = ({ children }) => {
  const [notification, setNotification] = useState<NotificationData | null>(
    null,
  );
  const darkMode = useSettingsStore(state => state.darkMode);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const showNotification = useCallback(
    ({
      title,
      message,
      type = 'info',
      duration = 4000,
    }: {
      title?: string;
      message: string;
      type?: ToastType;
      duration?: number;
    }) => {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const id = Date.now().toString();
      setNotification({ id, title, message, type, duration });
    },
    [],
  );

  const hideNotification = useCallback(() => {
    setNotification(null);
  }, []);

  // Set global notification handler
  useEffect(() => {
    setGlobalNotificationHandler(showNotification);
  }, [showNotification]);

  return (
    <InAppNotificationContext.Provider
      value={{ showNotification, hideNotification }}
    >
      {children}
      {notification && (
        <View
          style={[styles.toastContainer, { paddingTop: insets.top + 8 }]}
          pointerEvents="box-none"
        >
          <Toast
            visible={true}
            title={notification.title}
            message={notification.message}
            type={notification.type}
            duration={notification.duration}
            position="top"
            isDark={darkMode}
            onClose={hideNotification}
          />
        </View>
      )}
    </InAppNotificationContext.Provider>
  );
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    elevation: 99999,
    paddingHorizontal: 16,
  },
});

// Global notification function for use outside React components
let globalShowNotification:
  | InAppNotificationContextType['showNotification']
  | null = null;

// Track current screen to avoid showing notifications when already on chat
let currentScreen: string = '';

export const setGlobalNotificationHandler = (
  handler: InAppNotificationContextType['showNotification'],
) => {
  globalShowNotification = handler;
};

export const setCurrentScreen = (screenName: string) => {
  currentScreen = screenName;
};

export const showGlobalNotification = (options: {
  title?: string;
  message: string;
  type?: ToastType;
  duration?: number;
  skipIfOnChat?: boolean;
}) => {
  // Skip notification if user is on Chat screen and skipIfOnChat is true
  if (options.skipIfOnChat && currentScreen === 'Chat') {
    console.log(
      '[InAppNotification] Skipping notification - user is on Chat screen',
    );
    return;
  }

  if (globalShowNotification) {
    globalShowNotification(options);
  } else {
    console.warn('[InAppNotification] Global handler not set');
  }
};
