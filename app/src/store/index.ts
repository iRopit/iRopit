export { useAuthStore } from './authStore';
export { useDeviceStore } from './deviceStore';
export { useSMSStore } from './smsStore';
export { useCallStore } from './callStore';
export { useChatStore } from './chatStore';
export { useNotificationStore } from './notificationStore';
export { useSettingsStore } from './settingsStore';
export { useContactStore } from './contactStore';
export { useDeviceFilterStore } from './deviceFilterStore';

// Generic Store utilities
export {
  createGenericStore,
  mergeItems,
  deduplicateItems,
  groupItemsBy,
  sortByTimestamp,
  filterByDateRange,
  searchItems,
} from './generic';

export type {
  GenericStore,
  GenericStoreState,
  GenericStoreActions,
  CreateStoreOptions,
} from './generic';
