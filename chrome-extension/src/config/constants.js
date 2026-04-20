/**
 * iRopit Chrome Extension - Constants
 * Centralized configuration and constants
 */

// App Info
export const APP_NAME = "iRopit";
export const APP_VERSION = "1.0.8";

// Firebase Collections
export const COLLECTIONS = {
  USERS: "users",
  DEVICES: "devices",
  SMS: "sms",
  CALLS: "calls",
  NOTIFICATIONS: "notifications",
  SMS_REQUESTS: "sms_requests",
  CHATS: "chats",
};

// Sync Settings
export const SYNC_CONFIG = {
  POLLING_INTERVAL: 30000, // 30 seconds
  MAX_SMS_LOAD: 50,
  MAX_CALLS_LOAD: 50,
  MAX_NOTIFICATIONS_LOAD: 50,
};

// UI Settings
export const UI_CONFIG = {
  TOAST_DURATION: 3000,
  LOADING_DELAY: 300,
};

// Device Types
export const DEVICE_TYPES = {
  MOBILE: "mobile",
  EXTENSION: "chrome-extension",
};

// Platform Types
export const PLATFORMS = {
  ANDROID: "android",
  IOS: "ios",
  CHROME: "chrome",
};
