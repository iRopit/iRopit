import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firestore from '@react-native-firebase/firestore';
import { NativeModules } from 'react-native';
import { SMS, SendSMSRequest } from '../types';
import { COLLECTIONS, SMS_PAGE_SIZE } from '../constants';
import { useAuthStore } from './authStore';
import { useDeviceStore } from './deviceStore';
import {
  AppError,
  parseSmsError,
  parseFirestoreError,
  logError,
  ErrorCode,
} from '../utils/errors';
import { smsLogger as logger } from '../utils/logger';
import {
  BatchProcessor,
  deduplicateById,
  mergeByIdKeepNewest,
} from '../utils/performance';
import { encryptSMS, decryptSMS } from '../services/cryptoService';

const { SmsModule } = NativeModules;

// Track if SMS requests listener is already active
let smsRequestsUnsubscribe: (() => void) | null = null;

// Normalize phone number for comparison (remove +, spaces, dashes, etc.)
const normalizePhoneNumber = (phone: string): string => {
  if (!phone) return '';
  // Remove all non-digit characters
  let normalized = phone.replace(/\D/g, '');
  // Remove leading zeros
  normalized = normalized.replace(/^0+/, '');
  // Get last 9 digits for comparison (handles country codes)
  if (normalized.length > 9) {
    normalized = normalized.slice(-9);
  }
  return normalized;
};

// Check if two phone numbers match
const phoneNumbersMatch = (phone1: string, phone2: string): boolean => {
  const n1 = normalizePhoneNumber(phone1);
  const n2 = normalizePhoneNumber(phone2);
  if (!n1 || !n2) return false;
  return n1 === n2 || n1.endsWith(n2) || n2.endsWith(n1);
};

interface SMSState {
  messages: SMS[];
  isLoading: boolean;
  isSyncing: boolean;
  isLoadingMore: boolean;
  hasMoreMessages: boolean;
  oldestMessageTimestamp: number | null;
  error: string | null;
  unsubscribe: (() => void) | null;

  // Actions
  loadMessages: (deviceId?: string) => void;
  loadMoreMessages: (deviceId?: string) => Promise<void>;
  loadMessagesForSender: (sender: string) => Promise<SMS[]>;
  setMessages: (messages: SMS[]) => void;
  addMessage: (message: SMS) => void;
  addMessageAndSync: (message: SMS, userId: string) => Promise<void>;
  syncMessages: (localMessages: any[]) => Promise<void>;
  syncMessagesToFirebase: (userId: string) => Promise<void>;
  sendSMS: (phoneNumber: string, message: string) => Promise<void>;
  listenForSMSRequests: () => void;
  stopListeningForSMSRequests: () => void;
  markAsRead: (messageId: string) => Promise<void>;
  markMessagesAsReadBySender: (sender: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  deleteMessagesBySender: (sender: string) => Promise<void>;
  deleteAllMessages: () => Promise<void>;
  batchSyncNativeSMS: (nativeMessages: any[], userId: string) => Promise<void>;
  cleanup: () => void;
}

export const useSMSStore = create<SMSState>()(
  persist(
    (set, get) => ({
      messages: [],
      isLoading: false,
      isSyncing: false,
      isLoadingMore: false,
      hasMoreMessages: false,
      oldestMessageTimestamp: null,
      error: null,
      unsubscribe: null,

      setMessages: (messages: SMS[]) => {
        set({ messages });
      },

      addMessage: (message: SMS) => {
        const { messages } = get();
        // تجنب التكرار
        if (!messages.find(m => m.id === message.id)) {
          set({ messages: [message, ...messages] });
        }
      },

      // إضافة رسالة وحفظها في Firebase مباشرة
      addMessageAndSync: async (message: SMS, userId: string) => {
        const { messages } = get();
        let { currentDevice } = useDeviceStore.getState();

        // تجنب التكرار
        if (!messages.find(m => m.id === message.id)) {
          set({ messages: [message, ...messages] });
        } else {
        }

        // If no currentDevice, try to register it first
        if (!currentDevice && userId) {
          try {
            await useDeviceStore.getState().registerDevice();
            currentDevice = useDeviceStore.getState().currentDevice;
          } catch (e) {}
        }

        // حفظ في Firebase كإشعار (في نفس مسار الإشعارات)
        if (userId && currentDevice) {
          try {
            const phoneNumber =
              (message as any).phoneNumber ||
              (message as any).sender ||
              'unknown';
            const contactName = (message as any).contactName || '';
            const messageText = message.body || message.text || '';

            // استخدام messageHash بنفس طريقة BackgroundSmsService.java لتجنب التكرار
            const messageHash = Math.abs(
              `${phoneNumber}${messageText}`.split('').reduce((a, b) => {
                a = (a << 5) - a + b.charCodeAt(0);
                return a & a;
              }, 0),
            );

            // تحويل SMS إلى صيغة إشعار
            const notificationData = {
              id: message.id,
              key: `sms_${message.id}`,
              packageName: 'com.android.mms',
              title: contactName || phoneNumber,
              text: messageText,
              content: messageText,
              appName: 'SMS',
              type: 'sms',
              smsType: message.type || 'inbox', // حفظ نوع الرسالة: sent أو inbox
              timestamp: message.timestamp,
              receivedAt: message.timestamp,
              read: message.read || false,
              userId,
              deviceId: currentDevice.id,
              deviceName:
                currentDevice.nickname ||
                currentDevice.name ||
                'Android Device',
              phoneNumber,
              contactName,
              simSlot: (message as any).simSlot != null ? (message as any).simSlot : -1,
              syncedAt: Date.now(),
            };

            // استخدام نفس بنية docId مثل BackgroundSmsService.java: sms_deviceId_timestamp_messageHash
            const docId = `sms_${currentDevice.id}_${message.timestamp}_${messageHash}`;

            // Encrypt sensitive SMS data before saving
            const encryptedNotificationData = await encryptSMS(
              notificationData,
              userId,
            );

            // حفظ في مسار الإشعارات: users/{userId}/devices/{deviceId}/notifications
            await firestore()
              .collection(COLLECTIONS.USERS)
              .doc(userId)
              .collection(COLLECTIONS.DEVICES)
              .doc(currentDevice.id)
              .collection(COLLECTIONS.NOTIFICATIONS)
              .doc(docId)
              .set(encryptedNotificationData, { merge: true });
          } catch (error) {}
        } else {
        }
      },

      syncMessagesToFirebase: async (userId: string) => {
        const { messages } = get();
        const { currentDevice } = useDeviceStore.getState();
        if (!userId || !currentDevice || messages.length === 0) return;

        try {
          const batch = firestore().batch();

          for (const msg of messages.slice(0, 1000)) {
            const phoneNumber = msg.phoneNumber || msg.sender || 'unknown';

            const smsData = {
              ...msg,
              userId,
              deviceId: currentDevice.id,
              phoneNumber, // تأكد من وجود phoneNumber
              syncedAt: Date.now(),
            };

            const docId =
              `${currentDevice.id}_${msg.timestamp}_${phoneNumber}`.replace(
                /[\/\.]/g,
                '_',
              );
            const docRef = firestore().collection(COLLECTIONS.SMS).doc(docId);
            batch.set(docRef, smsData, { merge: true });
          }

          await batch.commit();
        } catch (error: any) {}
      },

      loadMessages: (deviceIdParam?: string) => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();

        if (!user || !currentDevice) {
          return;
        }

        const deviceId = deviceIdParam || currentDevice.id;

        const { unsubscribe: prevUnsubscribe } = get();
        if (prevUnsubscribe) {
          prevUnsubscribe();
        }

        set({ isLoading: true });

        // Helper to map a decrypted data object to a typed SMS
        const toSMS = (data: any): SMS =>
          ({
            id: data.id,
            threadId: data.threadId || '',
            userId: data.userId || user.uid,
            deviceId: data.deviceId || currentDevice.id,
            body: data.text || data.content || data.body || '',
            text: data.text || data.content || data.body || '',
            phoneNumber: data.phoneNumber || '',
            sender: data.phoneNumber || '',
            contactName: data.contactName || '',
            timestamp: data.timestamp || data.receivedAt || Date.now(),
            read: data.read || false,
            type: data.smsType || 'inbox',
            syncedAt: data.syncedAt || Date.now(),
          } as SMS);

        // Track whether the initial full snapshot has been processed.
        // Subsequent snapshots only carry changed documents (docChanges),
        // so we can merge them incrementally without re-decrypting everything.
        let isInitialSnapshot = true;

        const unsubscribe = firestore()
          .collection(COLLECTIONS.USERS)
          .doc(user.uid)
          .collection(COLLECTIONS.DEVICES)
          .doc(deviceId)
          .collection(COLLECTIONS.NOTIFICATIONS)
          .where('type', '==', 'sms')
          .orderBy('timestamp', 'desc')
          .limit(SMS_PAGE_SIZE)
          .onSnapshot(
            async snapshot => {
              if (isInitialSnapshot) {
                isInitialSnapshot = false;

                // Initial load: process all documents with chunked decryption
                const rawMessages: any[] = [];
                snapshot.forEach(doc => {
                  // Spread doc.data() FIRST, then override id with doc.id
                  // data.id is notification ID ("0" for Google Messages) - NOT unique!
                  // doc.id is the Firestore document ID - always unique
                  rawMessages.push({ ...doc.data(), id: doc.id });
                });

                // Decrypt in small chunks with a yield between each, so a large
                // snapshot (e.g. 10k messages on first load) doesn't freeze the UI.
                const DECRYPT_CHUNK = 100;
                const decryptedMessages: any[] = [];
                for (let i = 0; i < rawMessages.length; i += DECRYPT_CHUNK) {
                  const chunk = rawMessages.slice(i, i + DECRYPT_CHUNK);
                  const decryptedChunk = await Promise.all(
                    chunk.map(msg => decryptSMS(msg, user.uid)),
                  );
                  decryptedMessages.push(...decryptedChunk);
                  await new Promise(resolve => setTimeout(resolve, 0));
                }

                const firebaseMessages: SMS[] = decryptedMessages.map(toSMS);

                // Content-based dedup: remove duplicate SMS written by different services
                // (NotificationService vs BackgroundSmsService create different docIds for same SMS)
                const seenContent = new Set<string>();
                const dedupedMessages = firebaseMessages.filter(m => {
                  const phone = normalizePhoneNumber(
                    m.phoneNumber || m.sender || '',
                  );
                  const body = (m.body || m.text || '').trim().substring(0, 100);
                  // Round timestamp to 60-second window
                  const timeWindow = Math.floor((m.timestamp || 0) / 60000);
                  const contentKey = `${phone}_${timeWindow}_${body}`;
                  if (seenContent.has(contentKey)) return false;
                  seenContent.add(contentKey);
                  return true;
                });

                dedupedMessages.sort(
                  (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
                );
                const oldestTs =
                  dedupedMessages.length > 0
                    ? Math.min(...dedupedMessages.map(m => m.timestamp || Infinity))
                    : null;
                set({
                  messages: dedupedMessages,
                  isLoading: false,
                  hasMoreMessages: snapshot.size >= SMS_PAGE_SIZE,
                  oldestMessageTimestamp: oldestTs,
                });
                return;
              }

              // Subsequent snapshots: only process added/modified documents so
              // a single incoming SMS updates the UI immediately instead of
              // re-decrypting the entire collection.
              const changes = snapshot
                .docChanges()
                .filter(c => c.type === 'added' || c.type === 'modified');
              if (changes.length === 0) return;

              const rawNew = changes.map(c => ({ ...c.doc.data(), id: c.doc.id }));
              const decrypted = await Promise.all(
                rawNew.map(msg => decryptSMS(msg, user.uid)),
              );
              const newMessages: SMS[] = decrypted.map(toSMS);

              const { messages: currentMessages } = get();
              const merged = mergeByIdKeepNewest([...newMessages, ...currentMessages]);
              merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
              set({ messages: merged });
            },
            error => {
              set({ error: error.message, isLoading: false });
            },
          );

        set({ unsubscribe });
      },

      loadMoreMessages: async (deviceIdParam?: string) => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        const { isLoadingMore, hasMoreMessages, oldestMessageTimestamp, messages } = get();

        if (!user || !currentDevice || isLoadingMore || !hasMoreMessages || !oldestMessageTimestamp) return;

        const deviceId = deviceIdParam || currentDevice.id;
        set({ isLoadingMore: true });

        try {
          const snapshot = await firestore()
            .collection(COLLECTIONS.USERS)
            .doc(user.uid)
            .collection(COLLECTIONS.DEVICES)
            .doc(deviceId)
            .collection(COLLECTIONS.NOTIFICATIONS)
            .where('type', '==', 'sms')
            .where('timestamp', '<', oldestMessageTimestamp)
            .orderBy('timestamp', 'desc')
            .limit(SMS_PAGE_SIZE)
            .get();

          const rawMessages: any[] = [];
          snapshot.forEach(doc => rawMessages.push({ ...doc.data(), id: doc.id }));

          // Chunked decrypt with yields (older messages page)
          const DECRYPT_CHUNK = 100;
          const decryptedMessages: any[] = [];
          for (let i = 0; i < rawMessages.length; i += DECRYPT_CHUNK) {
            const chunk = rawMessages.slice(i, i + DECRYPT_CHUNK);
            const decryptedChunk = await Promise.all(
              chunk.map(msg => decryptSMS(msg, user.uid)),
            );
            decryptedMessages.push(...decryptedChunk);
            await new Promise(resolve => setTimeout(resolve, 0));
          }

          const olderMessages: SMS[] = decryptedMessages.map(
            data =>
              ({
                id: data.id,
                threadId: data.threadId || '',
                userId: data.userId || user.uid,
                deviceId: data.deviceId || currentDevice.id,
                body: data.text || data.content || data.body || '',
                text: data.text || data.content || data.body || '',
                phoneNumber: data.phoneNumber || '',
                sender: data.phoneNumber || '',
                contactName: data.contactName || '',
                timestamp: data.timestamp || data.receivedAt || Date.now(),
                read: data.read || false,
                type: data.smsType || 'inbox',
                syncedAt: data.syncedAt || Date.now(),
              } as SMS),
          );

          const newOldestTs =
            olderMessages.length > 0
              ? Math.min(...olderMessages.map(m => m.timestamp || Infinity))
              : oldestMessageTimestamp;

          const merged = mergeByIdKeepNewest([...messages, ...olderMessages]);
          merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

          set({
            messages: merged,
            hasMoreMessages: snapshot.size >= SMS_PAGE_SIZE,
            oldestMessageTimestamp: newOldestTs,
            isLoadingMore: false,
          });
        } catch {
          set({ isLoadingMore: false });
        }
      },

      // جلب الرسائل برقم الهاتف أو اسم المرسل
      loadMessagesForSender: async (
        phoneNumberParam: string,
      ): Promise<SMS[]> => {
        if (!phoneNumberParam) {
          return [];
        }

        const { messages: storeMessages } = get();
        const isPhone = /^[\+\d\s\-\(\)]+$/.test(phoneNumberParam.trim());

        const filtered = storeMessages.filter(sms => {
          const smsPhone = sms.phoneNumber || sms.sender || '';
          const smsContactName = (sms as any).contactName || '';

          if (isPhone) {
            return phoneNumbersMatch(smsPhone, phoneNumberParam);
          } else {
            // Name-based sender (e.g. "Klivvr", "CBD")
            const paramLower = phoneNumberParam.toLowerCase();
            return (
              smsPhone.toLowerCase() === paramLower ||
              smsContactName.toLowerCase() === paramLower
            );
          }
        });

        filtered.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        return filtered;
      },

      syncMessages: async (localMessages: any[]) => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        if (!user || !currentDevice) return;

        set({ isSyncing: true, error: null });

        try {
          const batch = firestore().batch();

          for (const msg of localMessages) {
            const smsData: Omit<SMS, 'id'> = {
              threadId: msg.threadId?.toString() || '',
              userId: user.uid,
              deviceId: currentDevice.id,
              phoneNumber: msg.address || msg.phoneNumber,
              contactName: msg.contactName,
              body: msg.body || msg.message,
              type: msg.type === 1 ? 'inbox' : 'sent',
              read: msg.read === 1 || msg.read === true,
              timestamp: parseInt(msg.date) || msg.timestamp,
              syncedAt: Date.now(),
            };

            const docId = `${currentDevice.id}_${smsData.timestamp}_${smsData.phoneNumber}`;
            const docRef = firestore().collection(COLLECTIONS.SMS).doc(docId);
            batch.set(docRef, smsData, { merge: true });
          }

          await batch.commit();
          set({ isSyncing: false });
        } catch (error: any) {
          set({ error: error.message, isSyncing: false });
        }
      },

      sendSMS: async (phoneNumber: string, message: string) => {},

      listenForSMSRequests: () => {
        if (smsRequestsUnsubscribe) {
          return;
        }

        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        if (!user || !currentDevice) {
          return;
        }

        return;
      },

      stopListeningForSMSRequests: () => {
        if (smsRequestsUnsubscribe) {
          smsRequestsUnsubscribe();
          smsRequestsUnsubscribe = null;
        }
      },

      markAsRead: async (messageId: string) => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        if (!user || !currentDevice) return;

        try {
          await firestore()
            .collection(COLLECTIONS.USERS)
            .doc(user.uid)
            .collection(COLLECTIONS.DEVICES)
            .doc(currentDevice.id)
            .collection(COLLECTIONS.NOTIFICATIONS)
            .doc(messageId)
            .update({ read: true });
        } catch (error: any) {}
      },

      markMessagesAsReadBySender: async (sender: string) => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        const { messages } = get();

        set(state => ({
          messages: state.messages.map(msg => {
            const msgSender =
              (msg as any).sender ||
              (msg as any).phoneNumber ||
              (msg as any).address;
            if (msgSender === sender) {
              return { ...msg, read: true } as SMS;
            }
            return msg;
          }),
        }));
        if (user && currentDevice) {
          try {
            const batch = firestore().batch();
            let count = 0;

            for (const msg of messages) {
              const msgSender =
                (msg as any).sender ||
                (msg as any).phoneNumber ||
                (msg as any).address;
              if (msgSender === sender && !msg.read) {
                const docRef = firestore()
                  .collection(COLLECTIONS.USERS)
                  .doc(user.uid)
                  .collection(COLLECTIONS.DEVICES)
                  .doc(currentDevice.id)
                  .collection(COLLECTIONS.NOTIFICATIONS)
                  .doc(msg.id);
                batch.update(docRef, { read: true });
                count++;
              }
            }

            if (count > 0) {
              await batch.commit();
            }
          } catch (error) {}
        }
      },

      markAllAsRead: async () => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        const { messages } = get();

        set(state => ({
          messages: state.messages.map(msg => ({ ...msg, read: true } as SMS)),
        }));
        if (user && currentDevice && messages.length > 0) {
          try {
            const batch = firestore().batch();
            let count = 0;

            for (const msg of messages) {
              if (!msg.read) {
                const docRef = firestore()
                  .collection(COLLECTIONS.USERS)
                  .doc(user.uid)
                  .collection(COLLECTIONS.DEVICES)
                  .doc(currentDevice.id)
                  .collection(COLLECTIONS.NOTIFICATIONS)
                  .doc(msg.id);
                batch.update(docRef, { read: true });
                count++;
              }
            }

            if (count > 0) {
              await batch.commit();
            }
          } catch (error) {}
        }
      },

      deleteMessagesBySender: async (sender: string) => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        const { messages } = get();

        // Find messages from this sender
        const senderMessages = messages.filter(msg => {
          const msgSender =
            (msg as any).sender ||
            (msg as any).phoneNumber ||
            (msg as any).address;
          return (
            msgSender === sender ||
            msgSender?.includes(sender) ||
            sender?.includes(msgSender)
          );
        });

        if (senderMessages.length === 0) {
          return;
        }

        set(state => ({
          messages: state.messages.filter(msg => {
            const msgSender =
              (msg as any).sender ||
              (msg as any).phoneNumber ||
              (msg as any).address;
            return !(
              msgSender === sender ||
              msgSender?.includes(sender) ||
              sender?.includes(msgSender)
            );
          }),
        }));
        if (user && currentDevice) {
          try {
            const batch = firestore().batch();
            for (const msg of senderMessages) {
              const docRef = firestore()
                .collection(COLLECTIONS.USERS)
                .doc(user.uid)
                .collection(COLLECTIONS.DEVICES)
                .doc(currentDevice.id)
                .collection(COLLECTIONS.NOTIFICATIONS)
                .doc(msg.id);
              batch.delete(docRef);
            }
            await batch.commit();
          } catch (error) {}
        }
      },

      deleteMessage: async (messageId: string) => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();

        set(state => ({
          messages: state.messages.filter(msg => msg.id !== messageId),
        }));
        if (user && currentDevice) {
          try {
            await firestore()
              .collection(COLLECTIONS.USERS)
              .doc(user.uid)
              .collection(COLLECTIONS.DEVICES)
              .doc(currentDevice.id)
              .collection(COLLECTIONS.NOTIFICATIONS)
              .doc(messageId)
              .delete();
          } catch (error) {}
        }
      },

      deleteAllMessages: async () => {
        const { user } = useAuthStore.getState();
        const { currentDevice } = useDeviceStore.getState();
        const { messages } = get();

        set({ messages: [] });
        if (user && currentDevice && messages.length > 0) {
          try {
            const batch = firestore().batch();

            for (const msg of messages) {
              const docRef = firestore()
                .collection(COLLECTIONS.USERS)
                .doc(user.uid)
                .collection(COLLECTIONS.DEVICES)
                .doc(currentDevice.id)
                .collection(COLLECTIONS.NOTIFICATIONS)
                .doc(msg.id);
              batch.delete(docRef);
            }

            await batch.commit();
          } catch (error) {}
        }
      },

      batchSyncNativeSMS: async (nativeMessages: any[], userId: string) => {
        const { currentDevice } = useDeviceStore.getState();
        if (!userId || !currentDevice || !nativeMessages.length) return;

        set({ isSyncing: true });
        try {
          // nativeMessages comes from SmsModule.getAllSms which returns "date DESC"
          // (newest first). We process in Firestore-batch-sized chunks so that the
          // first write immediately shows the newest messages in the Firestore
          // listener — rather than encrypting ALL messages before any write.
          const BATCH_SIZE = 400; // Firestore batch limit is 500; stay under it
          const ENCRYPT_CHUNK = 50; // parallel encryption sub-chunk within each batch

          const encryptOne = async (msg: any) => {
            const phoneNumber = (msg.phoneNumber || msg.address || msg.sender || '').trim() || 'unknown';
            const messageText = msg.body || msg.text || msg.content || '';
            const contactName = msg.contactName || msg.name || '';
            // SmsModule.java returns 'date', fallback to 'timestamp'/'dateTime'
            const timestamp = parseInt(msg.date || msg.timestamp || msg.dateTime) || Date.now();
            const smsType = msg.smsType || msg.type || 'inbox';

            // Same hash formula as BackgroundSmsService.java
            const messageHash = Math.abs(
              `${phoneNumber}${messageText}`.split('').reduce((a: number, b: string) => {
                a = (a << 5) - a + b.charCodeAt(0);
                return a & a;
              }, 0),
            );

            const notificationData = {
              id: msg.id?.toString() || `${timestamp}`,
              key: `sms_${msg.id || timestamp}`,
              packageName: 'com.android.mms',
              title: contactName || phoneNumber,
              text: messageText,
              content: messageText,
              appName: 'SMS',
              type: 'sms',
              smsType,
              direction: smsType === 'sent' ? 'outgoing' : 'incoming',
              timestamp,
              receivedAt: timestamp,
              read: msg.read ?? true,
              userId,
              deviceId: currentDevice.id,
              deviceName: currentDevice.nickname || currentDevice.name || 'Android Device',
              phoneNumber,
              contactName,
              simSlot: msg.simSlot != null ? msg.simSlot : -1,
              syncedAt: Date.now(),
            };

            const docId = `sms_${currentDevice.id}_${timestamp}_${messageHash}`;
            const encryptedData = await encryptSMS(notificationData, userId);
            return { docId, encryptedData };
          };

          // Process BATCH_SIZE messages at a time: encrypt then immediately write
          // to Firestore. Because messages are ordered newest-first, the first
          // Firestore write makes the newest messages visible in the listener
          // without waiting for the entire history to be encrypted.
          for (let i = 0; i < nativeMessages.length; i += BATCH_SIZE) {
            const batchMsgs = nativeMessages.slice(i, i + BATCH_SIZE);

            // Encrypt this batch in ENCRYPT_CHUNK sub-chunks with JS yields
            const encrypted: Array<{ docId: string; encryptedData: any }> = [];
            for (let j = 0; j < batchMsgs.length; j += ENCRYPT_CHUNK) {
              const subChunk = batchMsgs.slice(j, j + ENCRYPT_CHUNK);
              const encryptedChunk = await Promise.all(subChunk.map(encryptOne));
              encrypted.push(...encryptedChunk);
              await new Promise(resolve => setTimeout(resolve, 0));
            }

            // Write this batch to Firestore
            const batch = firestore().batch();
            for (const { docId, encryptedData } of encrypted) {
              const docRef = firestore()
                .collection(COLLECTIONS.USERS)
                .doc(userId)
                .collection(COLLECTIONS.DEVICES)
                .doc(currentDevice.id)
                .collection(COLLECTIONS.NOTIFICATIONS)
                .doc(docId);
              batch.set(docRef, encryptedData, { merge: true });
            }
            await batch.commit();
            // Yield between Firestore commits so the UI/listener can update
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } catch (error: any) {
          console.warn('[SMS] Initial batch sync error:', error?.message);
        } finally {
          set({ isSyncing: false });
        }
      },

      cleanup: () => {
        const { unsubscribe } = get();
        if (unsubscribe) {
          unsubscribe();
          set({ unsubscribe: null });
        }
      },
    }),
    {
      name: 'sms-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        messages: state.messages.slice(0, 200),
      }),
    },
  ),
);
