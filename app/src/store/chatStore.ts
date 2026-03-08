import { create } from 'zustand';
import firestore from '@react-native-firebase/firestore';
import Clipboard from '@react-native-clipboard/clipboard';
import { Platform, ToastAndroid } from 'react-native';
import { ChatMessage } from '../types';
import { COLLECTIONS, PAGE_SIZE } from '../constants';
import { useAuthStore } from './authStore';
import { useDeviceStore } from './deviceStore';
import { 
  pickImage, 
  takePhoto, 
  pickDocument, 
  uploadImage, 
  uploadDocument,
  UploadResult 
} from '../services/fileService';
import { decryptChatMessage } from '../services/cryptoService';

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  isSending: boolean;
  isUploading: boolean;
  uploadProgress: number;
  error: string | null;
  unsubscribe: (() => void) | null;
  
  // Actions
  loadMessages: () => void;
  sendMessage: (content: string, receiverDeviceId?: string) => Promise<void>;
  sendImage: (receiverDeviceId?: string) => Promise<void>;
  sendCameraPhoto: (receiverDeviceId?: string) => Promise<void>;
  sendFile: (receiverDeviceId?: string) => Promise<void>;
  sendFileMessage: (uploadResult: UploadResult, receiverDeviceId?: string) => Promise<void>;
  markAsRead: (messageId: string) => Promise<void>;
  cleanup: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  isSending: false,
  isUploading: false,
  uploadProgress: 0,
  error: null,
  unsubscribe: null,

  loadMessages: () => {
    const { user } = useAuthStore.getState();
    if (!user) return;

    // Unsubscribe from previous listener
    const { unsubscribe: prevUnsubscribe } = get();
    if (prevUnsubscribe) {
      prevUnsubscribe();
    }

    set({ isLoading: true });

    let isFirstSnapshot = true;

    const unsubscribe = firestore()
      .collection(COLLECTIONS.CHATS)
      .where('participants', 'array-contains', user.uid)
      .orderBy('timestamp', 'desc')
      .limit(PAGE_SIZE)
      .onSnapshot(
        (snapshot) => {
          const messages: ChatMessage[] = [];
          snapshot.forEach((doc) => {
            messages.push({ id: doc.id, ...doc.data() } as ChatMessage);
          });
          // Reverse to show oldest first
          const sorted = messages.reverse();

          // Auto-copy new messages from Chrome extension to clipboard
          if (isFirstSnapshot) {
            // Skip initial load — all docs come as 'added' on first snapshot
            isFirstSnapshot = false;
          } else {
            const newFromExtension = (snapshot.docChanges() as any[])
              .filter((change) => change.type === 'added')
              .map((change) => ({ id: change.doc.id, ...change.doc.data() }))
              .filter((msg: any) =>
                (msg.senderPlatform === 'chrome-extension' ||
                  (msg.senderDeviceId || '').startsWith('ext_')) &&
                msg.type === 'text' &&
                msg.content
              );
            if (newFromExtension.length > 0) {
              const newest = newFromExtension[newFromExtension.length - 1] as any;
              decryptChatMessage(newest, user.uid).then((decrypted: any) => {
                const text = decrypted.content || newest.content;
                Clipboard.setString(text);
                if (Platform.OS === 'android') {
                  ToastAndroid.show('📋 Copied from extension', ToastAndroid.SHORT);
                }
              }).catch(() => {
                Clipboard.setString(newest.content);
              });
            }
          }

          set({ messages: sorted, isLoading: false });
        },
        (error) => {
          set({ error: error.message, isLoading: false });
        }
      );

    set({ unsubscribe });
  },

  sendMessage: async (content: string, receiverDeviceId?: string) => {
    const { user } = useAuthStore.getState();
    const { currentDevice } = useDeviceStore.getState();
    if (!user || !currentDevice) return;

    set({ isSending: true, error: null });

    try {
      const messageData: Omit<ChatMessage, 'id'> = {
        senderId: user.uid,
        senderDeviceId: currentDevice.id,
        receiverId: user.uid, // Same user, different device
        receiverDeviceId: receiverDeviceId || undefined,
        content: content,
        type: 'text',
        read: false,
        timestamp: Date.now(),
      };

      await firestore()
        .collection(COLLECTIONS.CHATS)
        .add({
          ...messageData,
          participants: [user.uid],
        });

      set({ isSending: false });
    } catch (error: any) {
      set({ error: error.message, isSending: false });
      throw error;
    }
  },

  // إرسال رسالة ملف (صورة أو ملف)
  sendFileMessage: async (uploadResult: UploadResult, receiverDeviceId?: string) => {
    const { user } = useAuthStore.getState();
    const { currentDevice } = useDeviceStore.getState();
    if (!user || !currentDevice) return;

    set({ isSending: true, error: null });

    try {
      const messageData: Omit<ChatMessage, 'id'> = {
        senderId: user.uid,
        senderDeviceId: currentDevice.id,
        receiverId: user.uid,
        receiverDeviceId: receiverDeviceId || undefined,
        content: uploadResult.fileType === 'image' ? '📷 Image' : `📎 ${uploadResult.fileName}`,
        type: uploadResult.fileType,
        fileUrl: uploadResult.url,
        fileName: uploadResult.fileName,
        read: false,
        timestamp: Date.now(),
      };

      await firestore()
        .collection(COLLECTIONS.CHATS)
        .add({
          ...messageData,
          participants: [user.uid],
        });

      set({ isSending: false });
    } catch (error: any) {
      set({ error: error.message, isSending: false });
      throw error;
    }
  },

  // إرسال صورة من المعرض
  sendImage: async (receiverDeviceId?: string) => {
    const { user } = useAuthStore.getState();
    if (!user) return;

    try {
      const asset = await pickImage();
      if (!asset) return;

      set({ isUploading: true, uploadProgress: 0 });
      
      const uploadResult = await uploadImage(user.uid, asset);
      
      set({ uploadProgress: 100 });
      
      await get().sendFileMessage(uploadResult, receiverDeviceId);
      
      set({ isUploading: false, uploadProgress: 0 });
    } catch (error: any) {
      set({ error: error.message, isUploading: false, uploadProgress: 0 });
      throw error;
    }
  },

  // إرسال صورة من الكاميرا
  sendCameraPhoto: async (receiverDeviceId?: string) => {
    const { user } = useAuthStore.getState();
    if (!user) return;

    try {
      const asset = await takePhoto();
      if (!asset) return;

      set({ isUploading: true, uploadProgress: 0 });
      
      const uploadResult = await uploadImage(user.uid, asset);
      
      set({ uploadProgress: 100 });
      
      await get().sendFileMessage(uploadResult, receiverDeviceId);
      
      set({ isUploading: false, uploadProgress: 0 });
    } catch (error: any) {
      set({ error: error.message, isUploading: false, uploadProgress: 0 });
      throw error;
    }
  },

  // إرسال ملف
  sendFile: async (receiverDeviceId?: string) => {
    const { user } = useAuthStore.getState();
    if (!user) return;

    try {
      const document = await pickDocument();
      if (!document) return;

      set({ isUploading: true, uploadProgress: 0 });
      
      const uploadResult = await uploadDocument(user.uid, document);
      
      set({ uploadProgress: 100 });
      
      await get().sendFileMessage(uploadResult, receiverDeviceId);
      
      set({ isUploading: false, uploadProgress: 0 });
    } catch (error: any) {
      set({ error: error.message, isUploading: false, uploadProgress: 0 });
      throw error;
    }
  },

  markAsRead: async (messageId: string) => {
    try {
      await firestore()
        .collection(COLLECTIONS.CHATS)
        .doc(messageId)
        .update({ read: true });
    } catch (error: any) {
      }
  },

  cleanup: () => {
    const { unsubscribe } = get();
    if (unsubscribe) {
      unsubscribe();
      set({ unsubscribe: null });
    }
  },
}));
