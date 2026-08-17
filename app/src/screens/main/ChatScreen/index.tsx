import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Image,
  Modal,
  Dimensions,
  Alert,
  ToastAndroid,
  Share,
  Linking,
} from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import Clipboard from '@react-native-clipboard/clipboard';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { EmptyState, ScreenTitle, SearchBar } from '../../../components/shared';
import { Container, AnimatedListItem } from '../../../components';
import { Message } from './types';
import { styles } from './styles';
import { useChatScreen } from './useChatScreen';


const URL_RE = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+|(?:www\.)[^\s<>"{}|\\^`\[\]]+)/gi;

const renderTextWithLinks = (
  content: string,
  textStyle: object,
  linkColor: string,
) => {
  const parts: { text: string; isLink: boolean }[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(content)) !== null) {
    if (match.index > last) {
      parts.push({ text: content.slice(last, match.index), isLink: false });
    }
    parts.push({ text: match[0], isLink: true });
    last = match.index + match[0].length;
  }
  if (last < content.length) {
    parts.push({ text: content.slice(last), isLink: false });
  }
  return (
    <Text style={textStyle}>
      {parts.map((part, i) =>
        part.isLink ? (
          <Text
            key={i}
            style={{ color: linkColor, textDecorationLine: 'underline' }}
            onPress={() => {
              const href = /^https?:\/\//i.test(part.text) ? part.text : `https://${part.text}`;
              Linking.openURL(href);
            }}
          >
            {part.text}
          </Text>
        ) : (
          <Text key={i}>{part.text}</Text>
        ),
      )}
    </Text>
  );
};

const ChatScreen = () => {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleDownloadImage = async (url: string) => {
    if (Platform.OS === 'android') {
      try {
        const fileName = `iRopit_${Date.now()}.jpg`;
        ToastAndroid.show('Downloading...', ToastAndroid.SHORT);
        await RNBlobUtil.config({
          addAndroidDownloads: {
            useDownloadManager: true,
            notification: true,
            path: `${RNBlobUtil.fs.dirs.DownloadDir}/${fileName}`,
            description: 'Image downloaded by iRopit',
            mime: 'image/jpeg',
            title: fileName,
          },
        }).fetch('GET', url);
        ToastAndroid.show('Image saved to Downloads', ToastAndroid.LONG);
      } catch {
        ToastAndroid.show('Download failed', ToastAndroid.SHORT);
      }
    } else {
      Share.share({ url }).catch(() => Linking.openURL(url));
    }
  };

  const {
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
    colors,
    isRTL,
    isDarkMode,
    bgColor,
    textColor,
    secondaryTextColor,
    surfaceColor,
    flatListRef,
    setSearchQuery,
    handleInputChange,
    clearReply,
    setReplyMessage,
    pickImage,
    takePhoto,
    pickDocument,
    sendMessage,
    deleteMessage,
    deleteAllMessages,
  } = useChatScreen();

  // Render message item
  const renderMessageItem = ({
    item,
    index,
  }: {
    item: Message;
    index: number;
  }) => {
    const isMyMessage = (item as any).senderDeviceId === currentDevice?.id;
    const msgType = (item as any).type;
    const fileUrl = (item as any).fileUrl;
    const bubbleAlign = isMyMessage ? 'flex-end' : 'flex-start';

    return (
      <AnimatedListItem index={index}>
        <View
          style={[
            styles.messageWrapper,
            isMyMessage && styles.myMessageWrapper,
            { alignSelf: bubbleAlign, alignItems: bubbleAlign },
          ]}
        >
          {!isMyMessage && (
            <Text style={[styles.senderName, { color: secondaryTextColor }]}>
              {(item as any).senderName || 'Unknown'} •{' '}
              {(item as any).senderPlatform === 'chrome-extension' ? 'Browser' : ((item as any).senderPlatform || 'device')}
            </Text>
          )}
          {item.replyTo && (
            <View
              style={[styles.replyContainer, { backgroundColor: surfaceColor }]}
            >
              <View
                style={[styles.replyBar, { backgroundColor: colors.primary }]}
              />
              <Text
                style={[styles.replyText, { color: secondaryTextColor }]}
                numberOfLines={1}
              >
                {item.replyTo.content}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[
              styles.messageBubble,
              { backgroundColor: colors.primary },
            ]}
            onLongPress={() => {
              const options: { text: string; onPress: () => void; style?: 'cancel' | 'default' | 'destructive' }[] = [];
              if ((!msgType || msgType === 'text') && item.content) {
                options.push({
                  text: 'Copy Text',
                  onPress: () => {
                    Clipboard.setString(item.content);
                    if (Platform.OS === 'android') {
                      ToastAndroid.show('Copied to clipboard', ToastAndroid.SHORT);
                    }
                  },
                });
                options.push({
                  text: 'Share',
                  onPress: () => {
                    Share.share({ message: item.content });
                  },
                });
              }
              if (msgType === 'image' && fileUrl) {
                options.push({
                  text: 'Save / Share Image',
                  onPress: () => {
                    Share.share(
                      Platform.OS === 'ios'
                        ? { url: fileUrl }
                        : { message: fileUrl, title: 'Save Image' },
                    ).catch(() => Linking.openURL(fileUrl));
                  },
                });
              }
              options.push({ text: 'Reply', onPress: () => setReplyMessage(item) });
              options.push({
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  Alert.alert(
                    'Delete Message',
                    'Delete this message?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteMessage(item.id) },
                    ],
                  );
                },
              });
              options.push({ text: 'Cancel', style: 'cancel', onPress: () => {} });
              Alert.alert('Message Options', undefined, options);
            }}
          >
            {msgType === 'image' && fileUrl && (
              <View>
                <TouchableOpacity onPress={() => setPreviewImage(fileUrl)}>
                  <Image
                    source={{ uri: fileUrl }}
                    style={styles.chatImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.imageDownloadBtn,
                    { backgroundColor: isMyMessage ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.25)' },
                  ]}
                  onPress={() => handleDownloadImage(fileUrl)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="download-outline" size={18} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            )}

            {msgType === 'file' && fileUrl && (
              <TouchableOpacity
                style={[
                  styles.fileLink,
                  {
                    backgroundColor: isMyMessage
                      ? colors.overlay
                      : 'rgba(0,0,0,0.05)',
                  },
                ]}
                onPress={() => {
                  import('react-native').then(({ Linking }) => {
                    Linking.openURL(fileUrl);
                  });
                }}
              >
                <Text style={{ fontSize: 24 }}>📄</Text>
                <Text
                  style={[
                    styles.fileName,
                    { color: '#1a1a1a' },
                  ]}
                >
                  {(item as any).fileName || 'File'}
                </Text>
              </TouchableOpacity>
            )}

            {(!msgType || msgType === 'text') && renderTextWithLinks(
              item.content || '',
              [
                styles.messageText,
                { color: '#1a1a1a', textAlign: isRTL ? 'right' : 'left' },
              ],
              '#5c3d1e',
            )}

            <Text
              style={[
                styles.messageTime,
                {
                  color: 'rgba(0,0,0,0.45)',
                },
              ]}
            >
              {new Date(item.timestamp).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </TouchableOpacity>
        </View>
      </AnimatedListItem>
    );
  };

  const renderHeader = () => <View style={styles.headerSpacer} />;

  const renderDeleteButton = () => (
    <TouchableOpacity
      onPress={deleteAllMessages}
      style={styles.deleteAllButton}
    >
      <Ionicons name="trash-outline" size={22} color={colors.error} />
    </TouchableOpacity>
  );

  if (!user || !currentDevice) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: bgColor }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const renderEmptyComponent = () => (
    // FlatList is inverted={true} which flips everything via scaleY(-1);
    // counter-rotate the empty state so text appears right-side up.
    <View style={{ transform: [{ scaleY: -1 }] }}>
      <EmptyState
        icon="💬"
        title={isRTL ? 'لا توجد رسائل' : 'No Messages'}
        subtitle={
          isRTL
            ? 'ابدأ محادثة مع أجهزتك الأخرى'
            : 'Start a conversation with your other devices'
        }
        isDarkMode={isDarkMode}
      />
    </View>
  );

  return (
    <Container
      isDark={isDarkMode}
      noPaddingHorizontal
      backgroundColor={bgColor}
    >
      {renderHeader()}

      {/* Screen Title */}
      <ScreenTitle
        title={isRTL ? 'الدردشة' : 'Chat'}
        isDarkMode={isDarkMode}
        isRTL={isRTL}
      />

      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        isRTL={isRTL}
        isDarkMode={isDarkMode}
      />

      <View style={{ flex: 1 }}>

      {/* Device selector dropdown */}
      {(() => {
        const availableDevices = devices.filter(d => d.id !== currentDevice?.id);
        const selectedDevice = availableDevices.find(d => d.id === selectedDeviceId);
        const selPlatform = (selectedDevice as any)?.platform || selectedDevice?.type || '';
        const selIcon = selectedDevice
          ? selPlatform.includes('chrome') ? 'laptop-outline' : 'phone-portrait-outline'
          : 'layers-outline';
        const selLabel = selectedDevice
          ? ((selectedDevice as any).nickname || selectedDevice.name || (selectedDevice as any).model || 'Device')
          : (isRTL ? 'كل الأجهزة' : 'All Devices');
        const selOnline = (selectedDevice as any)?.isOnline;

        return (
          <>
            {/* Trigger row */}
            <TouchableOpacity
              onPress={() => setDropdownOpen(true)}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginHorizontal: 12,
                marginVertical: 8,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: 10,
                backgroundColor: isDarkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
                borderWidth: 1,
                borderColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
              }}
            >
              <View style={{ position: 'relative', marginRight: 8 }}>
                <Ionicons name={selIcon} size={16} color={colors.primary} />
                {selectedDevice && (
                  <View style={{
                    position: 'absolute', bottom: -2, right: -3,
                    width: 7, height: 7, borderRadius: 4,
                    backgroundColor: selOnline ? '#22c55e' : '#9ca3af',
                    borderWidth: 1,
                    borderColor: isDarkMode ? '#1f2937' : '#ffffff',
                  }} />
                )}
              </View>
              <Text style={{ flex: 1, color: textColor, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
                {isRTL ? 'إرسال إلى: ' : 'Send to: '}{selLabel}
              </Text>
              <Ionicons name="chevron-down" size={14} color={secondaryTextColor} />
            </TouchableOpacity>

            {/* Dropdown Modal */}
            <Modal
              visible={dropdownOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setDropdownOpen(false)}
            >
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
                activeOpacity={1}
                onPress={() => setDropdownOpen(false)}
              >
                <View
                  style={{
                    margin: 16,
                    marginTop: 120,
                    borderRadius: 14,
                    backgroundColor: isDarkMode ? '#1e1e2e' : '#ffffff',
                    overflow: 'hidden',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.25,
                    shadowRadius: 12,
                    elevation: 8,
                  }}
                >
                  {/* Header */}
                  <View style={{
                    paddingHorizontal: 16, paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                  }}>
                    <Text style={{ color: secondaryTextColor, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {isRTL ? 'اختر الجهاز' : 'Select Device'}
                    </Text>
                  </View>

                  {/* All option */}
                  {[{ id: null, icon: 'layers-outline', label: isRTL ? 'كل الأجهزة' : 'All Devices', isOnline: true }]
                    .concat(
                      availableDevices.map(d => ({
                        id: d.id,
                        icon: ((d as any).platform || d.type || '').includes('chrome') ? 'laptop-outline' : 'phone-portrait-outline',
                        label:
                          ((d as any).nickname || d.name || (d as any).model || 'Device') +
                          (d.id === currentDevice?.id
                            ? (isRTL ? ' (الحالي)' : ' (Current)')
                            : ''),
                        isOnline: (d as any).isOnline,
                      })) as any[],
                    )
                    .map((opt: any, idx: number) => {
                      const isActive = opt.id === selectedDeviceId;
                      return (
                        <TouchableOpacity
                          key={opt.id ?? '__all__'}
                          onPress={() => { setSelectedDeviceId(opt.id); setDropdownOpen(false); }}
                          activeOpacity={0.7}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            paddingHorizontal: 16,
                            paddingVertical: 13,
                            backgroundColor: isActive
                              ? (isDarkMode ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.08)')
                              : 'transparent',
                            borderTopWidth: idx === 0 ? 0 : 1,
                            borderTopColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                          }}
                        >
                          <View style={{ position: 'relative', marginRight: 12 }}>
                            <Ionicons
                              name={opt.icon}
                              size={18}
                              color={isActive ? colors.primary : secondaryTextColor}
                            />
                            {opt.id !== null && (
                              <View style={{
                                position: 'absolute', bottom: -2, right: -3,
                                width: 8, height: 8, borderRadius: 4,
                                backgroundColor: opt.isOnline ? '#22c55e' : '#9ca3af',
                                borderWidth: 1.5,
                                borderColor: isDarkMode ? '#1e1e2e' : '#ffffff',
                              }} />
                            )}
                          </View>
                          <Text style={{
                            flex: 1,
                            color: isActive ? colors.primary : textColor,
                            fontSize: 15,
                            fontWeight: isActive ? '700' : '400',
                          }}>
                            {opt.label}
                          </Text>
                          {opt.id !== null && (
                            <Text style={{ color: opt.isOnline ? '#22c55e' : secondaryTextColor, fontSize: 11, fontWeight: '600' }}>
                              {opt.isOnline ? (isRTL ? 'متصل' : 'Online') : (isRTL ? 'غير متصل' : 'Offline')}
                            </Text>
                          )}
                          {isActive && (
                            <Ionicons name="checkmark" size={16} color={colors.primary} style={{ marginLeft: 8 }} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                </View>
              </TouchableOpacity>
            </Modal>
          </>
        );
      })()}

      {isLoading && messages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: secondaryTextColor }]}>
            {isRTL ? 'جاري التحميل...' : 'Loading...'}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          style={{ flex: 1 }}
          data={[...filteredMessages].reverse()}
          inverted={true}
          keyExtractor={item => item.id}
          renderItem={renderMessageItem}
          contentContainerStyle={[
            styles.messagesList,
            filteredMessages.length === 0 && styles.emptyListContent,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ListEmptyComponent={renderEmptyComponent}
        />
      )}

      {replyTo && (
        <View style={[styles.replyPreview, { backgroundColor: surfaceColor }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.replyLabel, { color: colors.primaryText }]}>
              {isRTL ? 'الرد على:' : 'Replying to:'}
            </Text>
            <Text
              style={[styles.replyPreviewText, { color: textColor }]}
              numberOfLines={1}
            >
              {replyTo.content}
            </Text>
          </View>
          <TouchableOpacity onPress={clearReply}>
            <Text style={{ color: secondaryTextColor, fontSize: 20 }}>×</Text>
          </TouchableOpacity>
        </View>
      )}

      <View
        style={[
          styles.inputContainer,
          { backgroundColor: surfaceColor },
        ]}
      >
        <TouchableOpacity
          style={styles.attachButton}
          onPress={pickImage}
          disabled={isUploading}
        >
          <Ionicons name="image-outline" size={24} color={secondaryTextColor} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.attachButton}
          onPress={takePhoto}
          disabled={isUploading}
        >
          <Ionicons
            name="camera-outline"
            size={24}
            color={secondaryTextColor}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.attachButton}
          onPress={pickDocument}
          disabled={isUploading}
        >
          <Ionicons
            name="attach-outline"
            size={24}
            color={secondaryTextColor}
          />
        </TouchableOpacity>

        <TextInput
          style={[
            styles.input,
            {
              color: textColor,
              backgroundColor: isDarkMode
                ? colors.surfaceSecondary
                : colors.surfaceTertiary,
            },
          ]}
          value={inputText}
          onChangeText={handleInputChange}
          placeholder={isRTL ? 'اكتب رسالة...' : 'Type a message...'}
          placeholderTextColor={secondaryTextColor}
          multiline
        />

        {isUploading ? (
          <View style={[styles.sendButton, { backgroundColor: colors.primary, opacity: 0.8 }]}>
            <Text style={{ color: colors.textInverse, fontSize: 11, fontWeight: 'bold' }}>
              {uploadProgress > 0 ? `${uploadProgress}%` : '…'}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.sendButton,
              {
                backgroundColor: colors.primary,
                opacity: inputText.trim() ? 1 : 0.5,
              },
            ]}
            onPress={sendMessage}
            disabled={!inputText.trim()}
          >
            <Text style={styles.sendButtonText}>↑</Text>
          </TouchableOpacity>
        )}
      </View>
      {Platform.OS === 'android' && keyboardHeight > 0 && (
        <View style={{ height: keyboardHeight + insets.bottom }} />
      )}
      </View>

      {/* Image Preview Modal */}
      <Modal
        visible={!!previewImage}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.95)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          activeOpacity={1}
          onPress={() => setPreviewImage(null)}
        >
          <TouchableOpacity
            style={{
              position: 'absolute',
              top: 50,
              right: 20,
              zIndex: 10,
              padding: 10,
            }}
            onPress={() => setPreviewImage(null)}
          >
            <Ionicons name="close" size={32} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Download button */}
          <TouchableOpacity
            style={{
              position: 'absolute',
              top: 50,
              left: 20,
              zIndex: 10,
              padding: 10,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: 'rgba(255,255,255,0.15)',
              borderRadius: 24,
              paddingHorizontal: 14,
              paddingVertical: 8,
            }}
            onPress={() => previewImage && handleDownloadImage(previewImage)}
          >
            <Ionicons name="download-outline" size={24} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>Save Image</Text>
          </TouchableOpacity>

          {previewImage && (
            <Image
              source={{ uri: previewImage }}
              style={{
                width: Dimensions.get('window').width - 40,
                height: Dimensions.get('window').height * 0.7,
              }}
              resizeMode="contain"
            />
          )}
        </TouchableOpacity>
      </Modal>
    </Container>
  );
};

export default ChatScreen;
