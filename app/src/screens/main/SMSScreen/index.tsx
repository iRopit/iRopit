import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { EmptyState } from '../../../components/shared';
import { Container, AnimatedListItem } from '../../../components';
import { styles } from './styles';
import { formatTime } from './helper';
import { Conversation } from './types';
import { useSMSScreen } from './useSMSScreen';

const SMSScreen = () => {
  const {
    conversations,
    isLoading,
    isLoadingMore,
    hasMoreMessages,
    initialLoading,
    permissionGranted,
    showCompose,
    phoneNumber,
    messageText,
    isSending,
    colors,
    isDarkMode,
    isRTL,
    bgColor,
    secondaryTextColor,
    setPhoneNumber,
    setMessageText,
    openCompose,
    closeCompose,
    loadFromDevice,
    loadMoreMessages,
    handleSendMessage,
    handleMarkAllAsRead,
    handleDeleteAll,
  } = useSMSScreen();

  const renderConversation = ({
    item,
    index,
  }: {
    item: Conversation;
    index: number;
  }) => (
    <AnimatedListItem index={index}>
      <TouchableOpacity
        style={[styles.messageItem, { backgroundColor: colors.surface }]}
      >
        <View style={styles.avatarContainer}>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor:
                  item.unreadCount > 0 ? colors.primary : colors.primaryLight,
              },
            ]}
          >
            <Text
              style={[
                styles.avatarText,
                {
                  color:
                    item.unreadCount > 0
                      ? colors.textInverse
                      : colors.primaryText,
                },
              ]}
            >
              {(item.contactName || item.phoneNumber || '?')
                .charAt(0)
                .toUpperCase()}
            </Text>
          </View>
        </View>
        <View style={styles.messageContent}>
          <View style={styles.messageHeader}>
            <Text
              style={[
                styles.senderName,
                { color: colors.text },
                item.unreadCount > 0 && styles.unreadText,
              ]}
              numberOfLines={1}
            >
              {item.contactName || item.phoneNumber || 'Unknown'}
            </Text>
            <Text style={[styles.messageTime, { color: colors.textSecondary }]}>
              {formatTime(item.lastMessage.timestamp)}
            </Text>
          </View>
          <View style={styles.messagePreview}>
            <Text
              style={[
                styles.messageBody,
                { color: colors.textSecondary },
                item.unreadCount > 0 && styles.unreadText,
              ]}
              numberOfLines={2}
            >
              {item.lastMessage.type === 'sent' && '↩ '}
              {item.lastMessage.body}
            </Text>
            {item.unreadCount > 0 && (
              <View
                style={[
                  styles.unreadBadge,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </AnimatedListItem>
  );

  const renderEmptyComponent = () => (
    <EmptyState
      icon="💬"
      title={isRTL ? 'لا توجد رسائل' : 'No Messages'}
      subtitle={
        permissionGranted
          ? isRTL
            ? 'اسحب للأسفل للتحديث'
            : 'Pull down to refresh'
          : isRTL
          ? 'الرجاء السماح بأذونات الرسائل'
          : 'Please allow SMS permissions'
      }
      isDarkMode={isDarkMode}
    />
  );

  const renderHeader = () => (
    <View style={[styles.headerActions, { backgroundColor: colors.surface }]}>
      <TouchableOpacity
        style={[styles.actionButton, { backgroundColor: colors.primaryLight }]}
        onPress={handleMarkAllAsRead}
      >
        <Text style={[styles.actionButtonText, { color: colors.primaryText }]}>
          {isRTL ? '✓ تعليم الكل كمقروء' : '✓ Mark All Read'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.actionButton, { backgroundColor: colors.errorLight }]}
        onPress={handleDeleteAll}
      >
        <Text style={[styles.actionButtonText, { color: colors.error }]}>
          {isRTL ? '🗑 حذف الكل' : '🗑 Delete All'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  if (initialLoading && conversations.length === 0) {
    return (
      <Container
        isDark={isDarkMode}
        noPaddingHorizontal
        backgroundColor={bgColor}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: secondaryTextColor }]}>
            {isRTL ? 'جاري التحميل...' : 'Loading...'}
          </Text>
        </View>
      </Container>
    );
  }

  return (
    <Container
      isDark={isDarkMode}
      noPaddingHorizontal
      backgroundColor={bgColor}
    >
      {conversations.length > 0 && renderHeader()}
      <FlatList
        data={conversations}
        renderItem={renderConversation}
        keyExtractor={item => item.phoneNumber}
        contentContainerStyle={[
          styles.listContent,
          conversations.length === 0 && styles.emptyList,
        ]}
        ListEmptyComponent={renderEmptyComponent}
        onEndReached={() => hasMoreMessages && loadMoreMessages()}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          isLoadingMore ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={loadFromDevice}
            colors={[colors.primary]}
          />
        }
      />
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={openCompose}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>

      <Modal
        visible={showCompose}
        animationType="slide"
        transparent
        onRequestClose={closeCompose}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View
            style={[styles.modalContent, { backgroundColor: colors.surface }]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                {isRTL ? 'رسالة جديدة' : 'New Message'}
              </Text>
              <TouchableOpacity onPress={closeCompose}>
                <Text style={[styles.closeButton, { color: colors.error }]}>
                  ✕
                </Text>
              </TouchableOpacity>
            </View>
            <View
              style={[styles.inputContainer, { borderColor: colors.border }]}
            >
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder={isRTL ? 'رقم الهاتف' : 'Phone Number'}
                placeholderTextColor={colors.textSecondary}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                keyboardType="phone-pad"
              />
            </View>
            <View
              style={[
                styles.messageInputContainer,
                { borderColor: colors.border },
              ]}
            >
              <TextInput
                style={[styles.messageInput, { color: colors.text }]}
                placeholder={isRTL ? 'اكتب رسالتك...' : 'Type your message...'}
                placeholderTextColor={colors.textSecondary}
                value={messageText}
                onChangeText={setMessageText}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
            <Text style={[styles.charCount, { color: colors.textSecondary }]}>
              {messageText.length} / 160
            </Text>
            <TouchableOpacity
              style={[
                styles.sendButton,
                { backgroundColor: colors.primary },
                isSending && styles.sendButtonDisabled,
              ]}
              onPress={handleSendMessage}
              disabled={isSending}
            >
              <Text style={styles.sendButtonText}>
                {isSending
                  ? isRTL
                    ? 'جاري الإرسال...'
                    : 'Sending...'
                  : isRTL
                  ? 'إرسال'
                  : 'Send'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Container>
  );
};

export default SMSScreen;
