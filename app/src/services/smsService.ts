import {
  NativeModules,
  NativeEventEmitter,
  Platform,
  PermissionsAndroid,
} from 'react-native';

const { SmsModule } = NativeModules;

interface SmsMessage {
  id: string;
  address: string;
  body: string;
  date: number;
  read: boolean;
}

interface ReceivedSms {
  sender: string;
  message: string;
  timestamp: number;
}

class SmsService {
  private eventEmitter: NativeEventEmitter | null = null;

  constructor() {
    if (Platform.OS === 'android' && SmsModule) {
      this.eventEmitter = new NativeEventEmitter(SmsModule);
    }
  }

  // Permissions removed for Google Play compliance
  // SMS is now captured via NotificationListenerService
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    try {
      // Only request contacts - SMS permissions removed for Google Play
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      ]);

      return (
        granted['android.permission.READ_CONTACTS'] ===
        PermissionsAndroid.RESULTS.GRANTED
      );
    } catch (err) {
      return false;
    }
  }

  async getAllSms(limit: number = 100000): Promise<SmsMessage[]> {
    if (Platform.OS !== 'android' || !SmsModule) {
      return [];
    }

    try {
      const messages = await SmsModule.getAllSms(limit);
      return messages;
    } catch (error) {
      return [];
    }
  }

  async sendSms(phoneNumber: string, message: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !SmsModule) {
      return false;
    }

    try {
      await SmsModule.sendSms(phoneNumber, message);
      return true;
    } catch (error) {
      return false;
    }
  }

  onSmsReceived(callback: (sms: ReceivedSms) => void): () => void {
    if (!this.eventEmitter) {
      return () => {};
    }

    const subscription = this.eventEmitter.addListener(
      'onSmsReceived',
      callback,
    );
    return () => subscription.remove();
  }
}

const smsService = new SmsService();
export default smsService;
export type { SmsMessage, ReceivedSms };
