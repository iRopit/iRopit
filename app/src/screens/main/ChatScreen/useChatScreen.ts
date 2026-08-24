import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Alert, AppState, Clipboard, Keyboard, NativeModules, Platform, ToastAndroid } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
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
  const isFocused = useIsFocused();
  const user = useAuthStore(state => state.user);
  const currentDevice = useDeviceStore(state => state.currentDevice);
  const devices = useDeviceStore(state => state.devices);
  const loadDevices = useDeviceStore(state => state.loadDevices);
  const insets = useSafeAreaInsets();

  const pendingShare = useShareStore(state => state.pendingShare);
  const clearPendingShare = useShareStore(state => state.clearPendingShare);

  // null = 'All' tab
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const devicesRef = useRef<any[]>([]);
  const hasSeenServerSnapshotRef = useRef(false);

  // Dynamic colors based on theme
  const bgColor = colors.background;
  const textColor = colors.text;
  const secondaryTextColor = colors.textSecondary;
  const surfaceColor = isDarkMode ? colors.surface : colors.surfaceSecondary;

  // Real-time device subscription — ensures devices are always populated before sending
  useEffect(() => {
    if (!isFocused || !user?.uid) return;
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
  }, [isFocused, user?.uid, loadDevices]);

  // Keep latest devices in a ref to avoid re-subscribing chat listener on every device change.
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  // Current device should never be a selectable target in Chat.
  useEffect(() => {
    if (selectedDeviceId && currentDevice?.id && selectedDeviceId === currentDevice.id) {
      setSelectedDeviceId(null);
      return;
    }

    if (selectedDeviceId && !devices.some(d => d.id === selectedDeviceId)) {
      setSelectedDeviceId(null);
    }
  }, [selectedDeviceId, currentDevice?.id, devices]);

  // Keyboard listener for Android
  useEffect(() => {
    if (!isFocused) return;

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
  }, [isFocused]);

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

  // Consume pending text share — paste into input when ready.
  // currentDevice is intentionally NOT required here: we only need the user
  // to be authenticated to pre-fill the input.  The device is only needed when
  // the user actually hits Send, by which time registerDevice() will have
  // completed.  Waiting for currentDevice on cold launch caused the text to
  // never appear because device registration is async (Firestore round-trip).
  useEffect(() => {
    if (!pendingShare || !user?.uid) {
      return;
    }

    // Only handle plain-text shares here; file/image shares are handled by
    // RootNavigator → ShareModal.
    if (!pendingShare.text || pendingShare.uri || pendingShare.uris?.length) {
      return;
    }

    // Snapshot and clear immediately to prevent double-processing on re-render
    const share = pendingShare;
    clearPendingShare();

    // Plain text share — paste into input
    setInputText(share.text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShare, user?.uid]);

  // Subscribe to messages
  const isFirstSnapshotRef = useRef(true);
  useEffect(() => {
    if (!isFocused) return;
    if (!user?.uid || !currentDevice) {
      return;
    }

    isFirstSnapshotRef.current = true;
    hasSeenServerSnapshotRef.current = false;
    setIsLoading(true);

    const chatsQuery = firestore()
      .collection('chats')
      .where('participants', 'array-contains', user.uid)
      .orderBy('timestamp', 'desc')
      .limit(100);

    const unsubscribe = chatsQuery.onSnapshot(
        { includeMetadataChanges: true },
        async snapshot => {
          const rawMsgs: Message[] = [];
          snapshot.forEach(doc => {
            const data = doc.data();
            rawMsgs.push({ id: doc.id, ...data } as Message);
          });
          rawMsgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

          // The selector in this screen is "Send to" only.
          // Keep chat history unfiltered so incoming messages never disappear.
          const filteredMsgs = rawMsgs;
          // Decrypt messages
          const decryptedMsgs = await Promise.all(
            filteredMsgs.map(msg => decryptChatMessage(msg, user.uid)),
          );
          // Auto-copy text messages received from Chrome extension to clipboard
          if (isFirstSnapshotRef.current) {
            isFirstSnapshotRef.current = false;
          } else {
            const newFromExtension = (snapshot.docChanges() as any[])
              .filter(change => change.type === 'added')
              .map(change => ({ id: change.doc.id, ...change.doc.data() }))
              .filter((msg: any) =>
                (msg.senderPlatform === 'chrome-extension' ||
                  (msg.senderDeviceId || '').startsWith('ext_')) &&
                msg.type === 'text' &&
                msg.content,
              );
            if (newFromExtension.length > 0) {
              const newest = newFromExtension[newFromExtension.length - 1] as any;
              decryptChatMessage(newest, user.uid)
                .then((decrypted: any) => {
                  const text = decrypted.content || newest.content;
                  Clipboard.setString(text);
                  if (Platform.OS === 'android') {
                    ToastAndroid.show('📋 Copied from extension', ToastAndroid.SHORT);
                  }
                })
                .catch(() => {
                  Clipboard.setString(newest.content);
                  if (Platform.OS === 'android') {
                    ToastAndroid.show('📋 Copied from extension', ToastAndroid.SHORT);
                  }
                });
            }
          }
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

          if (!snapshot.metadata.fromCache) {
            hasSeenServerSnapshotRef.current = true;
          }

          // If first snapshot is empty cache, keep loading until we receive server data.
          if (hasSeenServerSnapshotRef.current || rawMsgs.length > 0) {
            setIsLoading(false);
          }
        },
        _error => {
          setIsLoading(false);
        },
      );

    const appStateSub = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') return;
      chatsQuery
        .get({ source: 'server' })
        .then(async serverSnap => {
          const rawMsgs: Message[] = [];
          serverSnap.forEach(doc => {
            const data = doc.data();
            rawMsgs.push({ id: doc.id, ...data } as Message);
          });
          rawMsgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

          const filteredMsgs = rawMsgs;

          const decryptedMsgs = await Promise.all(
            filteredMsgs.map(msg => decryptChatMessage(msg, user.uid)),
          );

          const seen = new Set<string>();
          const dedupedMsgs = decryptedMsgs.filter(msg => {
            const key = `${msg.senderDeviceId}|${msg.timestamp}|${(msg as any).content || ''}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

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
              if (!confirmed) merged.push(opt);
            });
            merged.sort((a, b) => ((a as any).timestamp || 0) - ((b as any).timestamp || 0));
            return merged;
          });
          setIsLoading(false);
        })
        .catch(() => {});
    });

    return () => {
      unsubscribe();
      appStateSub.remove();
    };
  }, [isFocused, user?.uid, currentDevice]);

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

  // Delete a single message
  const deleteMessage = useCallback(async (messageId: string) => {
    try {
      await firestore().collection('chats').doc(messageId).delete();
      if (Platform.OS === 'android') {
        ToastAndroid.show(isRTL ? 'تم حذف الرسالة' : 'Message deleted', ToastAndroid.SHORT);
      }
    } catch (_error) {
      Alert.alert(
        isRTL ? 'خطأ' : 'Error',
        isRTL ? 'فشل حذف الرسالة' : 'Failed to delete message',
      );
    }
  }, [isRTL]);

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

  const filteredMessages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return messages;

    return messages.filter(msg => {
      const content = String((msg as any).content || '').toLowerCase();
      const senderName = String((msg as any).senderName || '').toLowerCase();
      const senderPlatform = String((msg as any).senderPlatform || '').toLowerCase();
      const fileName = String((msg as any).fileName || '').toLowerCase();

      return (
        content.includes(query) ||
        senderName.includes(query) ||
        senderPlatform.includes(query) ||
        fileName.includes(query)
      );
    });
  }, [messages, searchQuery]);

  // With inverted FlatList, offset 0 is always the newest message (visual bottom).
  // No scroll effects needed — the list stays anchored to the bottom automatically.
  const scrollToEnd = useCallback((animated = true) => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  return {
    // State
    messages,
    filteredMessages,
    searchQuery,
    inputText,
    replyTo,
    isTyping,
    isLoading,
    isUploading,
    uploadProgress,
    keyboardHeight,
    insets,
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
    setSearchQuery,
    setInputText,
    handleInputChange,
    setReplyMessage,
    clearReply,
    pickImage,
    takePhoto,
    pickDocument,
    sendMessage,
    deleteMessage,
    deleteAllMessages,
    scrollToEnd,
  };
};
