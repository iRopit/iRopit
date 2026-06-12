import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  EmitterSubscription,
} from 'react-native';

const { NotificationModule } = NativeModules;

export interface AppNotification {
  id: string;
  key: string;
  packageName: string;
  title: string;
  text: string;
  type: 'sms' | 'call' | 'whatsapp' | 'telegram' | 'other';
  timestamp: number;
  appName: string;
  read: boolean;
  smsType?: 'sent' | 'inbox'; // For SMS messages: sent or received
  simSlot?: number; // 0 = SIM 1, 1 = SIM 2, -1 = unknown
}

class NotificationServiceClass {
  private eventEmitter: NativeEventEmitter | null = null;
  private listeners: EmitterSubscription[] = [];

  constructor() {
    if (Platform.OS === 'android' && NotificationModule) {
      this.eventEmitter = new NativeEventEmitter(NotificationModule);
    }
  }

  async isPermissionGranted(): Promise<boolean> {
    if (Platform.OS !== 'android' || !NotificationModule) {
      return false;
    }
    try {
      return await NotificationModule.isPermissionGranted();
    } catch (error) {
      return false;
    }
  }

  async openSettings(): Promise<void> {
    if (Platform.OS !== 'android' || !NotificationModule) {
      return;
    }
    try {
      await NotificationModule.openSettings();
    } catch (error) {}
  }

  async isServiceConnected(): Promise<boolean> {
    if (Platform.OS !== 'android' || !NotificationModule) {
      return false;
    }
    try {
      return await NotificationModule.isServiceConnected();
    } catch (error) {
      return false;
    }
  }

  async sendSMS(phoneNumber: string, message: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !NotificationModule) {
      return false;
    }
    try {
      return await NotificationModule.sendSMS(phoneNumber, message);
    } catch (error) {
      return false;
    }
  }

  /**
   * Open MIUI/Chinese ROM AutoStart settings
   * Required for NotificationListenerService to work on these devices
   */
  async openAutoStartSettings(): Promise<void> {
    if (Platform.OS !== 'android' || !NotificationModule) {
      return;
    }
    try {
      await NotificationModule.openAutoStartSettings();
    } catch (error) {}
  }

  /**
   * Open battery optimization settings
   */
  async openBatterySettings(): Promise<void> {
    if (Platform.OS !== 'android' || !NotificationModule) {
      return;
    }
    try {
      await NotificationModule.openBatterySettings();
    } catch (error) {}
  }

  /**
   * Check if device is MIUI or Chinese ROM that blocks background services
   */
  async isMiuiDevice(): Promise<boolean> {
    if (Platform.OS !== 'android' || !NotificationModule) {
      return false;
    }
    try {
      return await NotificationModule.isMiuiDevice();
    } catch (error) {
      return false;
    }
  }

  onNotificationReceived(
    callback: (notification: AppNotification) => void,
  ): () => void {
    if (!this.eventEmitter) {
      return () => {};
    }

    const subscription = this.eventEmitter.addListener(
      'onNotificationReceived',
      (data: any) => {
        const notification: AppNotification & { phoneNumber?: string } = {
          id: data.id,
          key: data.key,
          packageName: data.packageName,
          title: data.title || '',
          text: data.text || '',
          type: data.type || 'other',
          timestamp: data.timestamp || Date.now(),
          appName: data.appName || data.packageName,
          read: false,
          phoneNumber: data.phoneNumber || '',
        };
        console.log('[NotificationService] Received notification:', {
          type: notification.type,
          phoneNumber: notification.phoneNumber,
          title: notification.title,
          dataPhoneNumber: data.phoneNumber,
        });
        callback(notification);
      },
    );

    this.listeners.push(subscription);
    return () => subscription.remove();
  }

  onNotificationRemoved(
    callback: (data: { key: string; packageName: string }) => void,
  ): () => void {
    if (!this.eventEmitter) {
      return () => {};
    }

    const subscription = this.eventEmitter.addListener(
      'onNotificationRemoved',
      callback,
    );

    this.listeners.push(subscription);
    return () => subscription.remove();
  }

  removeAllListeners(): void {
    this.listeners.forEach(sub => sub.remove());
    this.listeners = [];
  }
}

const notificationService = new NotificationServiceClass();
export default notificationService;
