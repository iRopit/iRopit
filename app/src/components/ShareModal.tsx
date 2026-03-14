import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  StyleSheet,
  Platform,
  NativeModules,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import firestore from '@react-native-firebase/firestore';
import { SharedData } from '../hooks/useShareReceive';
import { useTheme } from '../contexts/ThemeContext';
import { useAuthStore } from '../store/authStore';
import { useDeviceStore } from '../store/deviceStore';
import { uploadFile } from '../screens/main/ChatScreen/helper';
import { encryptChatMessage } from '../services/cryptoService';

const { FilePickerModule } = NativeModules;

interface Props {
  data: SharedData;
  onClose: () => void;
}

export const ShareModal: React.FC<Props> = ({ data, onClose }) => {
  const { colors, isDarkMode } = useTheme();
  const { user } = useAuthStore();
  const { currentDevice, devices } = useDeviceStore();
  const [caption, setCaption] = useState(data.text || '');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const isImage = data.mimeType?.startsWith('image/');
  const isVideo = data.mimeType?.startsWith('video/');
  const isText = data.mimeType?.startsWith('text/');
  const uris = data.uris || (data.uri ? [data.uri] : []);

  // Exclude current device â€” send TO other devices
  const otherDevices = devices.filter(d => d.id !== currentDevice?.id);

  const handleSend = useCallback(async () => {
    if (!user?.uid || !currentDevice) return;

    // Close immediately — send in background
    onClose();

    try {
      const targetDeviceIds: string[] =
        selectedDeviceId ? [selectedDeviceId] : otherDevices.map(d => d.id);

      if (isText || (!uris.length && !isImage && !isVideo)) {
        // Text share â€” send as text message
        const messageText = caption.trim() || data.text || data.subject || '';
        if (!messageText) return;

        let msgData: any = {
          senderId: user.uid,
          senderDeviceId: currentDevice.id,
          senderName: (currentDevice as any).nickname || currentDevice.name || 'Mobile',
          senderPlatform: (currentDevice as any).platform || 'android',
          receiverId: user.uid,
          content: messageText,
          type: 'text',
          read: false,
          timestamp: Date.now(),
          participants: [user.uid],
        };
        msgData = await encryptChatMessage(msgData, user.uid);

        await Promise.all(
          (targetDeviceIds.length ? targetDeviceIds : [undefined]).map((dId) =>
            firestore().collection('chats').add(
              dId ? { ...msgData, receiverDeviceId: dId } : msgData,
            ),
          ),
        );
      } else {
        // File/image share â€” upload each URI then send
        for (const uri of uris) {
          let fileUri = uri;
          const fileName = uri.split('/').pop() || `share_${Date.now()}`;

          // Convert content:// URI to file:// if needed
          if (Platform.OS === 'android' && uri.startsWith('content://') && FilePickerModule?.copyToLocal) {
            try {
              fileUri = await FilePickerModule.copyToLocal(uri, fileName);
            } catch {}
          }

          const fileType = isImage ? 'image' : isVideo ? 'file' : 'file';
          const downloadUrl = await uploadFile(fileUri, fileName, fileType, user.uid);

          let fileMsg: any = {
            senderId: user.uid,
            senderDeviceId: currentDevice.id,
            senderName: (currentDevice as any).nickname || currentDevice.name || 'Mobile',
            senderPlatform: (currentDevice as any).platform || 'android',
            receiverId: user.uid,
            content: caption.trim() || (isImage ? 'ðŸ“· Image' : isVideo ? 'ðŸŽ¥ Video' : `ðŸ“Ž ${fileName}`),
            type: fileType,
            fileUrl: downloadUrl,
            fileName,
            read: false,
            timestamp: Date.now(),
            participants: [user.uid],
          };
          fileMsg = await encryptChatMessage(fileMsg, user.uid);

          await Promise.all(
            (targetDeviceIds.length ? targetDeviceIds : [undefined]).map((dId) =>
              firestore().collection('chats').add(
                dId ? { ...fileMsg, receiverDeviceId: dId } : fileMsg,
              ),
            ),
          );
        }
      }

    } catch (e: any) {
      // Modal is already closed; error is silent
    }
  }, [user, currentDevice, selectedDeviceId, otherDevices, uris, isImage, isVideo, isText, caption, data, onClose]);

  const surfaceBg = isDarkMode ? colors.surface : '#fff';
  const deviceBorder = isDarkMode ? colors.border : '#e5e7eb';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: surfaceBg }]}>

          {/* Handle bar */}
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Send via Chat</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* Image preview */}
            {(isImage || isVideo) && uris.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageRow}>
                {uris.map((uri, i) => (
                  <View key={i} style={styles.thumbWrap}>
                    {isImage ? (
                      <Image source={{ uri }} style={styles.thumbnail} resizeMode="cover" />
                    ) : (
                      <View style={[styles.thumbnail, styles.videoThumb, { backgroundColor: colors.surfaceSecondary }]}>
                        <Ionicons name="videocam" size={32} color={colors.textSecondary} />
                        <Text style={[styles.videoLabel, { color: colors.textSecondary }]}>Video</Text>
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}

            {/* Text preview */}
            {isText && !!data.text && (
              <View style={[styles.textPreview, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="text" size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
                <Text style={[styles.previewText, { color: colors.text }]} numberOfLines={4}>{data.text}</Text>
              </View>
            )}

            {/* Message input — only for text shares */}
            {isText && (
              <>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Message</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}
                  value={caption}
                  onChangeText={setCaption}
                  placeholder="Type a message..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  textAlignVertical="top"
                />
              </>
            )}

            {/* Device selector */}
            <Text style={[styles.label, { color: colors.textSecondary }]}>Send to device</Text>

            {otherDevices.length === 0 ? (
              <View style={[styles.noDevice, { backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name="laptop-outline" size={20} color={colors.textSecondary} />
                <Text style={[styles.noDeviceText, { color: colors.textSecondary }]}>
                  No other devices found. Message will be saved to your account.
                </Text>
              </View>
            ) : (
              <View style={styles.deviceList}>
                {/* All devices option */}
                <TouchableOpacity
                  style={[
                    styles.deviceRow,
                    { borderColor: deviceBorder },
                    selectedDeviceId === null && { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
                  ]}
                  onPress={() => setSelectedDeviceId(null)}
                >
                  <Ionicons
                    name="layers-outline"
                    size={20}
                    color={selectedDeviceId === null ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[styles.deviceName, { color: selectedDeviceId === null ? colors.primary : colors.text }]}>
                    All devices
                  </Text>
                  {selectedDeviceId === null && (
                    <Ionicons name="checkmark-circle" size={18} color={colors.primary} style={{ marginLeft: 'auto' }} />
                  )}
                </TouchableOpacity>

                {otherDevices.map(device => (
                  <TouchableOpacity
                    key={device.id}
                    style={[
                      styles.deviceRow,
                      { borderColor: deviceBorder },
                      selectedDeviceId === device.id && { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
                    ]}
                    onPress={() => setSelectedDeviceId(device.id)}
                  >
                    <Ionicons
                      name={(device as any).platform === 'chrome' ? 'globe-outline' : 'laptop-outline'}
                      size={20}
                      color={selectedDeviceId === device.id ? colors.primary : colors.textSecondary}
                    />
                    <Text style={[styles.deviceName, { color: selectedDeviceId === device.id ? colors.primary : colors.text }]}>
                      {(device as any).nickname || device.name}
                    </Text>
                    {selectedDeviceId === device.id && (
                      <Ionicons name="checkmark-circle" size={18} color={colors.primary} style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Send button */}
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: colors.primary }]}
              onPress={handleSend}
            >
              <Ionicons name="send" size={16} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.sendBtnText}>Send to Chat</Text>
            </TouchableOpacity>

          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 36,
    maxHeight: '90%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  imageRow: {
    marginBottom: 16,
  },
  thumbWrap: {
    marginRight: 8,
  },
  thumbnail: {
    width: 130,
    height: 130,
    borderRadius: 12,
  },
  videoThumb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  textPreview: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  previewText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 20,
    minHeight: 60,
    maxHeight: 120,
  },
  deviceList: {
    marginBottom: 20,
    gap: 8,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '500',
  },
  noDevice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  noDeviceText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  errorText: {
    color: '#e53935',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  sentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  sentText: {
    fontSize: 14,
    fontWeight: '600',
  },
  sendBtn: {
    flexDirection: 'row',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
