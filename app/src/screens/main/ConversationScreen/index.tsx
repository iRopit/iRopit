import React, { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Container } from '../../../components';

import { ConversationScreenProps } from './types';
import { styles } from './styles';
import { getInitials } from './helper';
import MessageBubble from './components/MessageBubble';
import { useConversationScreen } from './useConversationScreen';
import { AppNotification } from '../../../services/notificationService';

const ConversationScreen = ({ route, navigation }: ConversationScreenProps) => {
  const { title, appName, type, phoneNumber } = route.params;
  const insets = useSafeAreaInsets();
  const listBottomPadding = Math.max(insets.bottom + 28, 48);

  const {
    conversationNotifications,
    smsMessages,
    isSmsLoading,
    isSMSType,
    isRTL,
    isDarkMode,
    colors,
    bgColor,
    textColor,
    secondaryTextColor,
    bubbleColor,
    headerBgColor,
    borderColor,
    flatListRef,
    handleDelete,
    goBack,
  } = useConversationScreen({ title, appName, type, phoneNumber }, navigation);

  const renderMessage = useCallback(({ item }: { item: AppNotification }) => (
    <MessageBubble
      item={item}
      onDelete={handleDelete}
      isRTL={isRTL}
      textColor={textColor}
      secondaryTextColor={secondaryTextColor}
      bubbleColor={bubbleColor}
      bgColor={bgColor}
      primaryColor={colors.primary}
      textInverseColor={colors.textInverse}
    />
  ), [handleDelete, isRTL, textColor, secondaryTextColor, bubbleColor, bgColor, colors.primary, colors.textInverse]);

  const keyExtractor = useCallback((item: AppNotification) => item.id, []);

  return (
    <Container
      isDark={isDarkMode}
      noPaddingHorizontal
      backgroundColor={bgColor}
      edges={['top', 'bottom']}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { backgroundColor: headerBgColor, borderBottomColor: borderColor },
        ]}
      >
        <TouchableOpacity onPress={goBack} style={styles.backButton}>
          <Text style={[styles.backIcon, { color: colors.primaryText }]}>
            ‹
          </Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <View style={styles.nameContainer}>
            <Text
              style={[styles.headerName, { color: textColor }]}
              numberOfLines={1}
            >
              {title}
            </Text>
          </View>
          {isSMSType && phoneNumber && title !== phoneNumber ? (
            <Text style={{ color: secondaryTextColor, fontSize: 13, textAlign: 'center', marginBottom: 2, writingDirection: 'ltr' }}>
              {phoneNumber}
            </Text>
          ) : null}
          <Text style={[styles.headerSubtitle, { color: secondaryTextColor }]}>
            {isSMSType ? 'Text Message • SMS' : appName}
          </Text>
        </View>
      </View>

      {/* Messages */}
      {isSmsLoading && smsMessages.length === 0 && type === 'sms' ? (
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ color: secondaryTextColor }}>Loading messages...</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={conversationNotifications}
          renderItem={renderMessage}
          keyExtractor={keyExtractor}
          style={{ flex: 1, backgroundColor: bgColor }}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: isSMSType ? listBottomPadding : 20 },
          ]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
        />
      )}
    </Container>
  );
};

export default ConversationScreen;
