import React from 'react';
import { View, FlatList, RefreshControl, ActivityIndicator, Text } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../contexts/ThemeContext';
import { Container } from '../../../components';

import {
  SelectableHeader,
  ScreenTitle,
  SearchBar,
  EmptyState,
  DeviceFilterDropdown,
} from '../../../components/shared';

import { GroupedNotification } from './types';
import { styles } from './styles';
import SwipeableItem from './components/SwipeableItem';
import { useNotificationsScreen } from './useNotificationsScreen';

const NotificationsScreen = () => {
  const { t } = useTheme();
  const {
    // Data
    groupedNotifications,
    searchQuery,
    isSelectMode,
    selectedNotifications,
    isLoading,
    initialLoading,
    hasPermission,

    // Theme
    isRTL,
    isDarkMode,
    colors,
    bgColor,

    // Device filter
    devices,
    currentDevice,
    selectedDeviceId,
    setSelectedDeviceId,

    // Handlers
    setSearchQuery,
    handlePress,
    handleDelete,
    handleMute,
    toggleSelectNotification,
    toggleSelectAll,
    handleDeleteSelected,
    cancelSelectMode,
    enterSelectMode,
    checkPermission,
    requestPermission,
  } = useNotificationsScreen('notifications-only');

  const renderItem = ({
    item,
  }: {
    item: GroupedNotification;
    index: number;
  }) => (
    <SwipeableItem
      item={item}
      onPress={() => handlePress(item)}
      onDelete={() => handleDelete(item)}
      onMute={() => handleMute(item)}
      isRTL={isRTL}
      colors={colors}
      isDarkMode={isDarkMode}
      isSelectMode={isSelectMode}
      isSelected={selectedNotifications.includes(item.key)}
      onToggleSelect={() => toggleSelectNotification(item.key)}
    />
  );

  const renderEmptyState = () => {
    if (initialLoading) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 16 }}>
            {isRTL ? 'جاري تحميل الإشعارات...' : 'Loading notifications...'}
          </Text>
        </View>
      );
    }

    if (!hasPermission) {
      return (
        <EmptyState
          iconComponent={
            <Ionicons
              name="notifications-outline"
              size={64}
              color={colors.primary}
              style={{ marginBottom: 16 }}
            />
          }
          title={t('enableNotificationAccess')}
          subtitle={t('notificationPermissionDesc')}
          actionButton={{
            text: t('enableAccess'),
            onPress: requestPermission,
          }}
          isDarkMode={isDarkMode}
        />
      );
    }

    return (
      <EmptyState
        iconComponent={
          <Ionicons
            name="notifications-off-outline"
            size={64}
            color={colors.primary}
            style={{ marginBottom: 16 }}
          />
        }
        title={isRTL ? 'لا توجد إشعارات بعد' : 'No notifications yet'}
        subtitle={
          isRTL
            ? 'ستظهر الإشعارات هنا عند وصولها'
            : 'Your notifications will appear here when they arrive.'
        }
        isDarkMode={isDarkMode}
      />
    );
  };

  return (
    <Container
      isDark={isDarkMode}
      noPaddingHorizontal
      backgroundColor={bgColor}
    >
      {/* Header with Select/Cancel buttons */}
      <SelectableHeader
        isSelectMode={isSelectMode}
        selectedCount={selectedNotifications.length}
        totalCount={groupedNotifications.length}
        onCancel={cancelSelectMode}
        onSelectAll={toggleSelectAll}
        onEnterSelectMode={enterSelectMode}
        isRTL={isRTL}
        isDarkMode={isDarkMode}
      />

      {/* Screen Title with Delete button in select mode */}
      <ScreenTitle
        title={t('notifications')}
        isDarkMode={isDarkMode}
        isSelectMode={isSelectMode}
        selectedCount={selectedNotifications.length}
        onDeleteSelected={handleDeleteSelected}
        isRTL={isRTL}
      />

      {/* Search Bar */}
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        isRTL={isRTL}
        isDarkMode={isDarkMode}
      />

      {/* Device Filter */}
      <DeviceFilterDropdown
        devices={devices}
        currentDevice={currentDevice}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={setSelectedDeviceId}
        isRTL={isRTL}
        isDarkMode={isDarkMode}
        colors={colors}
      />

      {/* Notifications List */}
      <FlatList
        data={groupedNotifications}
        renderItem={renderItem}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyState}
        initialNumToRender={14}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={6}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={checkPermission}
            tintColor={colors.primary}
          />
        }
      />
    </Container>
  );
};

export default NotificationsScreen;
