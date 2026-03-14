import { useState, useEffect, useRef, useCallback } from 'react';
import { Alert, Keyboard, NativeModules, Platform, ToastAndroid } from 'react-native';
import { useTheme } from '../../../contexts/ThemeContext';
import { useAuthStore } from '../../../store/authStore';
import { useDeviceStore } from '../../../store/deviceStore';
import { useShareStore } from '../../../store/shareStore';
import { COLLECTIONS } from '../../../constants';
import firestore from '@react-native-firebase/firestore';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import { FlatList } from 'react-native';
import { Message } from './types';
import { uploadFile } from './helper';
import { pickDocument as pickDocumentFromDevice } from '../../../services/fileService';
import {
  encryptChatMessage,
  decryptChatMessage,
} from '../../../services/cryptoService';

const { FilePickerModule } = NativeModules;

export const useChatScreen = () => {
  const { colors, isRTL, isDarkMode } = useTheme();
  const { user } = useAuthStore();
  const { currentDevice, devices, loadDevices } = useDeviceStore();

  const pendingShare = useShareStore(state => state.pendingShare);
  const clearPendingShare = useShareStore(state => state.clearPendingShare);

  // null = 'All' tab
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Dynamic colors based on theme
  const bgColor = colors.background;
  const textColor = colors.text;
  const secondaryTextColor = colors.textSecondary;
  const surfaceColor = isDarkMode ? colors.surface : colors.surfaceSecondary;

  // Real-time device subscription — ensures devices are always populated before sending
  useEffect(() => {
    if (!user?.uid) return;
    const unsubscribe = firestore()
      .collection(COLLECTIONS.DEVICES)
      .where('userId', '==', user.uid)
      .onSnapshot(
        snapshot => {
          const devs: any[] = [];
          snapshot.forEach(doc => devs.push({ id: doc.id, ...doc.data() }));
          useDeviceStore.setState({ devices: devs });
        },
        () => {
          // Fallback to one-time fetch on snapshot error
          loadDevices();
        },
      );
    return () => unsubscribe();
  }, [user?.uid]);

  // Keyboard listener for Android
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', e => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Pick image from gallery
  const pickImage = useCallback(async () => {
    try {
      Keyboard.dismiss();
      await new Promise(resolve => setTimeout(resolve, 300));

      if (Platform.OS === 'android' && FilePickerModule) {
        // Use native module to avoid "activity is null" issue
        try {
          const result = await FilePickerModule.pickImage();
          if (result?.uri) {
            await sendFileMessage(
              result.uri,
              result.name || 'image.jpg',
              'image',
            );
            return;
          }
        } catch (nativeError: any) {
          if (nativeError?.code === 'CANCELLED') return;
          console.log(
            '[ChatScreen] Native picker failed, trying library:',
            nativeError?.message,
          );
        }
      }

      // Fallback to library
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
      });

      if (result.assets && result.assets[0]) {
        const asset = result.assets[0];
        if (asset.uri) {
          await sendFileMessage(
            asset.uri,
            asset.fileName || 'image.jpg',
            'image',
          );
        }
      }
    } catch (_error) {
      Alert.alert(
        isRTL ? 'خطأ' : 'Error',
        isRTL ? 'فشل في اختيار الصورة' : 'Failed to pick image',
      );
    }
  }, [isRTL, user?.uid, currentDevice]);

  // Take photo with camera
  const takePhoto = useCallback(async () => {
    try {
      Keyboard.dismiss();
      await new Promise(resolve => setTimeout(resolve, 300));

      const result = await launchCamera({
        mediaType: 'photo',
        quality: 0.8,
      });

      if (result.assets && result.assets[0]) {
        const asset = result.assets[0];
        if (asset.uri) {
          await sendFileMessage(
            asset.uri,
            asset.fileName || 'photo.jpg',
            'image',
          );
        }
      }
    } catch (_error) {
      Alert.alert(
        isRTL ? 'خطأ' : 'Error',
        isRTL ? 'فشل في التقاط الصورة' : 'Failed to take photo',
      );
    }
  }, [isRTL, user?.uid, currentDevice]);

  // Pick document from device
  const pickDocument = useCallback(async () => {
    try {
      Keyboard.dismiss();
      await new Promise(resolve => setTimeout(resolve, 300));

      if (Platform.OS === 'android' && FilePickerModule) {
        // Use native module to avoid "activity is null" issue
        try {
          const result = await FilePickerModule.pickFile();
          if (result?.uri) {
            // Detect if file is an image by MIME type or extension
            const isImage =
              result.type?.startsWith('image/') ||
              /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/i.test(
                result.name || '',
              );
            await sendFileMessage(
              result.uri,
              result.name || 'document',
              isImage ? 'image' : 'file',
            );
            return;
          }
        } catch (nativeError: any) {
          if (nativeError?.code === 'CANCELLED') return;
          console.log(
            '[ChatScreen] Native picker failed, trying library:',
            nativeError?.message,
          );
        }
      }

      // Fallback to library
      const document = await pickDocumentFromDevice();
      if (document) {
        const isImage =
          document.type?.startsWith('image/') ||
          /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif)$/i.test(document.name || '');
        await sendFileMessage(
          document.uri,
          document.name,
          isImage ? 'image' : 'file',
        );
      }
    } catch (_error) {
      Alert.alert(
        isRTL ? 'خطأ' : 'Error',
        isRTL ? 'فشل في اختيار الملف' : 'Failed to pick file',
      );
    }
  }, [isRTL, user?.uid, currentDevice]);

  // Send file message
  const sendFileMessage = useCallback(
    async (uri: string, fileName: string, type: 'image' | 'file') => {
      if (!user?.uid || !currentDevice) return;

      // --- Optimistic UI ---
      // Show the image immediately using the local URI; the inverted FlatList
      // will display it at the bottom automatically — no scroll needed.
      const optimisticId = `optimistic_${Date.now()}`;
      const optimisticTs = Date.now();
      const optimisticMsg: any = {
        id: optimisticId,
        senderId: user.uid,
        senderDeviceId: currentDevice.id,
        senderName: (currentDevice as any).nickname || currentDevice.name || 'Mobile',
        receiverId: user.uid,
        content: type === 'image' ? '📷 Image' : `📎 ${fileName}`,
        type: type,
        fileUrl: uri,
        fileName: fileName,
        read: false,
        timestamp: optimisticTs,
        participants: [user.uid],
        _optimistic: true,
      };
      setMessages(prev => [...prev, optimisticMsg]);
      // inverted FlatList auto-shows newest at bottom — no scroll call needed

      setIsUploading(true);
      setUploadProgress(0);
      try {
        const downloadUrl = await uploadFile(uri, fileName, type, user.uid, (percent) => {
          setUploadProgress(percent);
        });

        // Update the optimistic message URL in-place — no length change, no jank
        setMessages(prev =>
          prev.map(m => m.id === optimisticId ? { ...m, fileUrl: downloadUrl } : m),
        );

        // Write to Firestore
        let fileMessageData: any = {
          senderId: user.uid,
          senderDeviceId: currentDevice.id,
          senderName:
            (currentDevice as any).nickname || currentDevice.name || 'Mobile',
          senderPlatform: (currentDevice as any).platform || 'android',
          receiverId: user.uid,
          content: type === 'image' ? '📷 Image' : `📎 ${fileName}`,
          type: type,
          fileUrl: downloadUrl,
          fileName: fileName,
          read: false,
          timestamp: optimisticTs,
          participants: [user.uid],
        };

        fileMessageData = await encryptChatMessage(fileMessageData, user.uid);

        const fileWrites: Promise<any>[] = [];
        if (!selectedDeviceId) {
          const otherDevices = devices.filter(d => d.id !== currentDevice.id);
          if (otherDevices.length > 0) {
            otherDevices.forEach(d =>
              fileWrites.push(firestore().collection('chats').add({ ...fileMessageData, receiverDeviceId: d.id })),
            );
          } else {
            fileWrites.push(firestore().collection('chats').add(fileMessageData));
          }
        } else {
          fileWrites.push(firestore().collection('chats').add({ ...fileMessageData, receiverDeviceId: selectedDeviceId }));
        }
        await Promise.all(fileWrites);
      } catch (_error) {
        setMessages(prev => prev.filter(m => m.id !== optimisticId));
        Alert.alert(
          isRTL ? 'خطأ' : 'Error',
          isRTL ? 'فشل في إرسال الملف' : 'Failed to send file',
        );
      }
      setIsUploading(false);
      setUploadProgress(0);
    },
    [user?.uid, currentDevice, isRTL, selectedDeviceId, devices],
  );

  // Consume pending shared data — waits until user AND device are both ready
  useEffect(() => {
    if (!pendingShare || !user?.uid || !currentDevice) return;

    // Snapshot and clear immediately to prevent double-send on re-render
    const share = pendingShare;
    clearPendingShare();

    if (share.text) {
      setInputText(share.text);
      return;
    }

    const uris = share.uris ?? (share.uri ? [share.uri] : []);
    if (uris.length === 0) return;

    const isImage = share.mimeType?.startsWith('image/') ||
      share.mimeType?.startsWith('video/');
    const fileType: 'image' | 'file' = isImage ? 'image' : 'file';

    uris.forEach(uri => {
      // Extract filename from content URI or path
      const rawName = decodeURIComponent(uri.split('/').pop()?.split('?')[0] || '');
      const fileName = rawName || `shared_${Date.now()}.${isImage ? 'jpg' : 'bin'}`;
      sendFileMessage(uri, fileName, fileType);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShare, user?.uid, currentDevice?.id]);

  // Subscribe to messages
  useEffect(() => {
    if (!user?.uid || !currentDevice) {
      return;
    }

    setIsLoading(true);

    const unsubscribe = firestore()
      .collection('chats')
      .where('participants', 'array-contains', user.uid)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .onSnapshot(
        async snapshot => {
          const rawMsgs: Message[] = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            rawMsgs.push({ id: doc.id, ...data } as Message);
          });
          rawMsgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          // Filter: only messages sent from or directly to this device
          const deviceMsgs = rawMsgs.filter(msg =>
            msg.receiverDeviceId === currentDevice.id ||
            msg.senderDeviceId === currentDevice.id,
          );
          // Further filter by selected device tab
          const filteredMsgs = selectedDeviceId
            ? deviceMsgs.filter(msg =>
                msg.senderDeviceId === selectedDeviceId ||
                msg.receiverDeviceId === selectedDeviceId,
              )
            : deviceMsgs;
          // Decrypt messages
          const decryptedMsgs = await Promise.all(
            filteredMsgs.map(msg => decryptChatMessage(msg, user.uid)),
          );
          // Deduplicate: fan-out creates one Firestore doc per device;
          // collapse copies with same sender + timestamp + content into one.
          const seen = new Set<string>();
          const dedupedMsgs = decryptedMsgs.filter(msg => {
            const key = `${msg.senderDeviceId}|${msg.timestamp}|${(msg as any).content || ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          // Merge: preserve optimistic messages that haven't been confirmed by
          // Firestore yet (matched by senderDeviceId + type + timestamp proximity).
          setMessages(prev => {
            const optimistics = prev.filter((m: any) => m._optimistic);
            const real = dedupedMsgs as Message[];
            if (optimistics.length === 0) return real;
            const merged = [...real];
            optimistics.forEach((opt: any) => {
              const confirmed = real.some(
                r =>
                  (r as any).senderDeviceId === opt.senderDeviceId &&
                  (r as any).type === opt.type &&
                  Math.abs(((r as any).timestamp || 0) - (opt.timestamp || 0)) < 10000,
              );
              // Only keep optimistic if the real message hasn't arrived yet
              if (!confirmed) merged.push(opt);
            });
            merged.sort((a, b) => ((a as any).timestamp || 0) - ((b as any).timestamp || 0));
            return merged;
          });
          setIsLoading(false);
        },
        _error => {
          setIsLoading(false);
        },
      );

    return () => unsubscribe();
  }, [user?.uid, currentDevice, selectedDeviceId]);

  // Send typing indicator - disabled for flat structure
  const sendTypingIndicator = useCallback(async () => {
    // Not used in flat chat structure
  }, []);

  // Send message
  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !user?.uid || !currentDevice) return;

    // Optimistic UI — clear input immediately so there's no perceived delay
    setInputText('');
    setReplyTo(null);
    // inverted FlatList auto-shows newest message at bottom

    let messageData: any = {
      senderId: user.uid,
      senderDeviceId: currentDevice.id,
      senderName:
        (currentDevice as any).nickname ||
        currentDevice.name ||
        (currentDevice as any).model ||
        'Android Device',
      senderPlatform: (currentDevice as any).platform || 'android',
      receiverId: user.uid,
      content: text,
      type: 'text',
      read: false,
      timestamp: Date.now(),
      participants: [user.uid],
    };

    if (replyTo) {
      messageData.replyTo = {
        id: replyTo.id,
        content: replyTo.content,
        senderId: replyTo.senderId,
      };
    }

    try {
      messageData = await encryptChatMessage(messageData, user.uid);
    } catch {
      ToastAndroid.show(isRTL ? 'فشل في إرسال الرسالة' : 'Failed to send message', ToastAndroid.SHORT);
      return;
    }

    // Fire writes without awaiting — non-blocking so UI stays responsive
    const writes: Promise<any>[] = [];
    if (!selectedDeviceId) {
      const otherDevices = devices.filter(d => d.id !== currentDevice.id);
      if (otherDevices.length > 0) {
        otherDevices.forEach(d =>
          writes.push(firestore().collection('chats').add({ ...messageData, receiverDeviceId: d.id })),
        );
      } else {
        // Devices not yet loaded — send without receiver; sender sees their own message
        writes.push(firestore().collection('chats').add(messageData));
      }
    } else {
      writes.push(firestore().collection('chats').add({ ...messageData, receiverDeviceId: selectedDeviceId }));
    }
    Promise.all(writes).catch(() => {
      ToastAndroid.show(isRTL ? 'فشل في إرسال الرسالة' : 'Failed to send message', ToastAndroid.SHORT);
    });
  }, [inputText, user?.uid, currentDevice, replyTo, isRTL, selectedDeviceId, devices]);

  // Delete all messages
  const deleteAllMessages = useCallback(async () => {
    if (messages.length === 0) {
      Alert.alert(
        isRTL ? 'لا توجد رسائل' : 'No Messages',
        isRTL ? 'لا توجد رسائل للحذف' : 'There are no messages to delete',
      );
      return;
    }

    Alert.alert(
      isRTL ? 'حذف جميع الرسائل' : 'Delete All Messages',
      isRTL
        ? 'هل أنت متأكد من حذف جميع الرسائل؟ لا يمكن التراجع عن هذا.'
        : 'Are you sure you want to delete all messages? This cannot be undone.',
      [
        { text: isRTL ? 'إلغاء' : 'Cancel', style: 'cancel' },
        {
          text: isRTL ? 'حذف' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const batch = firestore().batch();
              messages.forEach(msg => {
                const ref = firestore().collection('chats').doc(msg.id);
                batch.delete(ref);
              });
              await batch.commit();
              Alert.alert(
                isRTL ? 'تم' : 'Done',
                isRTL ? 'تم حذف جميع الرسائل' : 'All messages deleted',
              );
            } catch (_error) {
              Alert.alert(
                isRTL ? 'خطأ' : 'Error',
                isRTL ? 'فشل حذف الرسائل' : 'Failed to delete messages',
              );
            }
          },
        },
      ],
    );
  }, [messages, isRTL]);

  const setReplyMessage = useCallback((message: Message | null) => {
    setReplyTo(message);
  }, []);

  const handleInputChange = useCallback(
    (text: string) => {
      setInputText(text);
      if (text.length > 0) {
        sendTypingIndicator();
      }
    },
    [sendTypingIndicator],
  );

  const clearReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  // With inverted FlatList, offset 0 is always the newest message (visual bottom).
  // No scroll effects needed — the list stays anchored to the bottom automatically.
  const scrollToEnd = useCallback((animated = true) => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  return {
    // State
    messages,
    inputText,
    replyTo,
    isTyping,
    isLoading,
    isUploading,
    uploadProgress,
    keyboardHeight,
    user,
    currentDevice,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,

    // Theme
    colors,
    isRTL,
    isDarkMode,
    bgColor,
    textColor,
    secondaryTextColor,
    surfaceColor,

    // Refs
    flatListRef,

    // Actions
    setInputText,
    handleInputChange,
    setReplyMessage,
    clearReply,
    pickImage,
    takePhoto,
    pickDocument,
    sendMessage,
    deleteAllMessages,
    scrollToEnd,
  };
};
