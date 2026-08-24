import React, { useCallback } from 'react';
import {
  View,
  FlatList,
  RefreshControl,
  StatusBar,
  ActivityIndicator,
  Text,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../contexts/ThemeContext';

import {
  SelectableHeader,
  ScreenTitle,
  SearchBar,
  EmptyState,
  DeviceFilterDropdown,
} from '../../../components/shared';

import { GroupedNotification } from '../NotificationsScreen/types';
import { styles } from '../NotificationsScreen/styles';
import SwipeableItem from '../NotificationsScreen/components/SwipeableItem';
import { useNotificationsScreen } from '../NotificationsScreen/useNotificationsScreen';

const SMSNotificationsScreen = () => {
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
  } = useNotificationsScreen('sms');

  const renderItem = useCallback(({ item }: { item: GroupedNotification }) => (
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
  ), [handlePress, handleDelete, handleMute, isRTL, colors, isDarkMode, isSelectMode, selectedNotifications, toggleSelectNotification]);

  const keyExtractor = useCallback((item: GroupedNotification) => item.key, []);

  const renderEmptyState = () => {
    if (initialLoading) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 16 }}>
            {isRTL ? 'جاري تحميل الرسائل...' : 'Loading SMS...'}
          </Text>
        </View>
      );
    }

    if (!hasPermission) {
      return (
        <EmptyState
          iconComponent={
            <Ionicons
              name="chatbubble-outline"
              size={64}
              color={colors.primary}
              style={{ marginBottom: 16 }}
            />
          }
          title={isRTL ? 'تفعيل صلاحية الرسائل' : 'Enable SMS Access'}
          subtitle={
            isRTL
              ? 'يرجى تفعيل صلاحية قراءة الرسائل لعرضها هنا'
              : 'Please enable SMS permission to view messages here'
          }
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
        icon="💬"
        title={isRTL ? 'لا توجد رسائل بعد' : 'No SMS yet'}
        subtitle={
          isRTL ? 'ستظهر الرسائل النصية هنا' : 'SMS messages will appear here'
        }
        isDarkMode={isDarkMode}
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

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

      {/* Screen Title */}
      <ScreenTitle
        title={isRTL ? 'الرسائل' : 'SMS'}
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

      {/* SMS List */}
      <FlatList
        data={groupedNotifications}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyState}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={checkPermission}
            tintColor={colors.primary}
          />
        }
      />
    </View>
  );
};

export default SMSNotificationsScreen;
