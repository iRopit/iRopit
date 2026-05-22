import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
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
    isSyncing,
    isLoadingMore,
    hasMoreMessages,
    initialLoading,
    permissionGranted,
    colors,
    isDarkMode,
    isRTL,
    bgColor,
    secondaryTextColor,
    loadFromDevice,
    loadMoreMessages,
    handleMarkAllAsRead,
    handleDeleteAll,
  } = useSMSScreen();

  // Show loading state when either the initial native read or the historical
  // Firestore sync is still in progress and we don't have any conversations yet.
  const showInitialLoader =
    conversations.length === 0 && (initialLoading || isSyncing || isLoading);

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

  if (showInitialLoader) {
    return (
      <Container
        isDark={isDarkMode}
        noPaddingHorizontal
        backgroundColor={bgColor}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: secondaryTextColor }]}>
            {isRTL ? 'جاري تحميل الرسائل...' : 'Loading messages...'}
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
    </Container>
  );
};

export default SMSScreen;
