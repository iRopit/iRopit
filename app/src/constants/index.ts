export const APP_NAME = 'iRopit';
export const APP_VERSION = '1.0.0';

// Sync intervals
export const SYNC_INTERVAL = 30000; // 30 seconds
export const PRESENCE_INTERVAL = 60000; // 1 minute

// Pagination
export const PAGE_SIZE = 20;
export const SMS_PAGE_SIZE = 200;
export const CALL_PAGE_SIZE = 50;

// Limits
export const MAX_SMS_LENGTH = 160;
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Tab names
export const TABS = {
  SMS: 'SMS',
  CALLS: 'Calls',
  CHAT: 'Chat',
  ACCOUNT: 'Account',
} as const;

// Firebase Collections
export const COLLECTIONS = {
  USERS: 'users',
  DEVICES: 'devices',
  SMS: 'sms',
  CALLS: 'calls',
  CHATS: 'chats',
  CONVERSATIONS: 'conversations',
  NOTIFICATIONS: 'notifications',
  SMS_REQUESTS: 'sms_requests',
} as const;

// Permissions - Only non-restricted permissions for Google Play compliance
// SMS and Call Log permissions removed - now using NotificationListenerService
export const PERMISSIONS_REQUIRED = {
  android: ['android.permission.READ_CONTACTS'],
  ios: [],
} as const;
