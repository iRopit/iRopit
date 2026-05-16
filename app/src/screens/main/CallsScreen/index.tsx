import React from 'react';
import {
  View,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Text,
  TouchableOpacity,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  SelectableHeader,
  ScreenTitle,
  SearchBar,
  EmptyState,
  ConfirmDeleteBottomSheet,
  DeviceFilterDropdown,
} from '../../../components/shared';
import { Container, AnimatedListItem } from '../../../components';
import { styles } from './styles';
import { GroupedCall } from './types';
import SwipeableCallItem from './components/SwipeableCallItem';
import { useCallsScreen } from './useCallsScreen';

/**
 * CallsScreen - Displays grouped call logs
 * UI-only component - all business logic is handled by useCallsScreen hook
 */
const CallsScreen = () => {
  const {
    // Data
    groupedCalls,
    calls,
    searchQuery,
    isSelectMode,
    selectedCalls,
    isLoading,
    isSyncing,

    // Theme
    isRTL,
    isDarkMode,
    colors,
    bgColor,
    textColor,
    secondaryTextColor,
    avatarBgColor,

    // Device filter
    devices,
    currentDevice,
    selectedDeviceId,
    setSelectedDeviceId,

    // Handlers
    setSearchQuery,
    handlePress,
    handleDelete,
    toggleSelectCall,
    toggleSelectAll,
    handleDeleteSelected,
    handleDeleteAllCalls,
    cancelSelectMode,
    enterSelectMode,
    loadCalls,

    // Delete sheet state
    showDeleteSheet,
    setShowDeleteSheet,
    deleteTarget,
    singleDeleteItem,
    confirmDelete,
  } = useCallsScreen();

  const renderItem = ({
    item,
    index,
  }: {
    item: GroupedCall;
    index: number;
  }) => (
    <AnimatedListItem index={index}>
      <SwipeableCallItem
        item={item}
        onPress={() => handlePress(item)}
        onDelete={() => handleDelete(item)}
        isRTL={isRTL}
        isDarkMode={isDarkMode}
        textColor={textColor}
        secondaryTextColor={secondaryTextColor}
        bgColor={bgColor}
        avatarBgColor={avatarBgColor}
        colors={colors}
        isSelectMode={isSelectMode}
        isSelected={selectedCalls.includes(item.phoneNumber)}
        onToggleSelect={() => toggleSelectCall(item.phoneNumber)}
      />
    </AnimatedListItem>
  );

  const renderDeleteAllButton = () => (
    <TouchableOpacity
      onPress={handleDeleteAllCalls}
      style={styles.deleteAllButton}
    >
      <Ionicons name="trash-outline" size={22} color={colors.error} />
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <EmptyState
      icon="📞"
      title={isRTL ? 'لا توجد مكالمات' : 'No Calls'}
      subtitle={
        isRTL
          ? 'المكالمات الجديدة ستظهر هنا بعد حدوثها'
          : 'New calls will appear here after they occur'
      }
      isDarkMode={isDarkMode}
    />
  );

  // Show loading indicator while initial historical sync is running and we
  // don't have any calls yet (avoids the "No Calls" flash on fresh install).
  if ((isLoading || isSyncing) && calls.length === 0) {
    return (
      <Container
        isDark={isDarkMode}
        noPaddingHorizontal
        backgroundColor={bgColor}
      >
        <SelectableHeader
          isSelectMode={isSelectMode}
          selectedCount={selectedCalls.length}
          totalCount={groupedCalls.length}
          onCancel={cancelSelectMode}
          onSelectAll={toggleSelectAll}
          onEnterSelectMode={enterSelectMode}
          isRTL={isRTL}
          isDarkMode={isDarkMode}
        />
        <ScreenTitle
          title={isRTL ? 'المكالمات' : 'Calls'}
          isDarkMode={isDarkMode}
          isRTL={isRTL}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: secondaryTextColor }]}>
            {isRTL ? 'جاري تحميل المكالمات...' : 'Loading calls...'}
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
      {/* Header with Select/Cancel buttons */}
      <SelectableHeader
        isSelectMode={isSelectMode}
        selectedCount={selectedCalls.length}
        totalCount={groupedCalls.length}
        onCancel={cancelSelectMode}
        onSelectAll={toggleSelectAll}
        onEnterSelectMode={enterSelectMode}
        isRTL={isRTL}
        isDarkMode={isDarkMode}
      />

      {/* Screen Title with Delete button */}
      <ScreenTitle
        title={isRTL ? 'المكالمات' : 'Calls'}
        isDarkMode={isDarkMode}
        isSelectMode={isSelectMode}
        selectedCount={selectedCalls.length}
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

      {/* Calls List */}
      <FlatList
        data={groupedCalls}
        renderItem={renderItem}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyState}
        removeClippedSubviews={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={loadCalls}
            tintColor={colors.primary}
          />
        }
      />

      {/* Delete Confirmation Bottom Sheet */}
      <ConfirmDeleteBottomSheet
        visible={showDeleteSheet}
        onClose={() => setShowDeleteSheet(false)}
        onConfirm={confirmDelete}
        title={
          deleteTarget === 'all'
            ? isRTL
              ? 'حذف كل المكالمات'
              : 'Delete All Calls'
            : deleteTarget === 'selected'
            ? isRTL
              ? 'حذف المكالمات المحددة'
              : 'Delete Selected Calls'
            : isRTL
            ? 'حذف المكالمة'
            : 'Delete Call'
        }
        message={
          deleteTarget === 'all'
            ? isRTL
              ? 'هل أنت متأكد من حذف كل سجل المكالمات؟'
              : 'Are you sure you want to delete all call logs?'
            : deleteTarget === 'selected'
            ? isRTL
              ? `هل أنت متأكد من حذف ${selectedCalls.length} مكالمة؟`
              : `Are you sure you want to delete ${selectedCalls.length} calls?`
            : isRTL
            ? `هل أنت متأكد من حذف مكالمات ${
                singleDeleteItem?.contactName || singleDeleteItem?.phoneNumber
              }؟`
            : `Are you sure you want to delete calls with ${
                singleDeleteItem?.contactName || singleDeleteItem?.phoneNumber
              }?`
        }
        confirmText={
          deleteTarget === 'all'
            ? isRTL
              ? 'حذف الكل'
              : 'Delete All'
            : isRTL
            ? 'حذف'
            : 'Delete'
        }
        isDark={isDarkMode}
        isRTL={isRTL}
        itemCount={
          deleteTarget === 'all'
            ? groupedCalls.length
            : deleteTarget === 'selected'
            ? selectedCalls.length
            : singleDeleteItem?.count || 1
        }
      />
    </Container>
  );
};

export default CallsScreen;
