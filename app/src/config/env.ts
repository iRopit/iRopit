/**
 * Environment Configuration
 *
 * Manages environment-specific settings for the app.
 * In production, these values should come from environment variables.
 */

export type Environment = 'development' | 'staging' | 'production';

// Current environment
export const ENV: Environment = __DEV__ ? 'development' : 'production';

// Environment-specific configurations
const envConfigs: Record<Environment, EnvironmentConfig> = {
  development: {
    apiBaseUrl: 'http://localhost:3000/api',
    wsBaseUrl: 'ws://localhost:3000',
    firebaseConfig: {
      // Development Firebase config
      enabled: true,
    },
    logging: {
      enabled: true,
      level: 'debug',
    },
    features: {
      enableDevTools: true,
      enableMockData: true,
      enableCrashReporting: false,
      enableAnalytics: false,
    },
  },
  staging: {
    apiBaseUrl: 'https://staging-api.zyncit.app/api',
    wsBaseUrl: 'wss://staging-api.zyncit.app',
    firebaseConfig: {
      enabled: true,
    },
    logging: {
      enabled: true,
      level: 'warn',
    },
    features: {
      enableDevTools: true,
      enableMockData: false,
      enableCrashReporting: true,
      enableAnalytics: true,
    },
  },
  production: {
    apiBaseUrl: 'https://api.zyncit.app/api',
    wsBaseUrl: 'wss://api.zyncit.app',
    firebaseConfig: {
      enabled: true,
    },
    logging: {
      enabled: false,
      level: 'error',
    },
    features: {
      enableDevTools: false,
      enableMockData: false,
      enableCrashReporting: true,
      enableAnalytics: true,
    },
  },
};

// Types
interface EnvironmentConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  firebaseConfig: {
    enabled: boolean;
  };
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
  features: {
    enableDevTools: boolean;
    enableMockData: boolean;
    enableCrashReporting: boolean;
    enableAnalytics: boolean;
  };
}

// Current config based on environment
export const config = envConfigs[ENV];

// Helper functions
export const isDevelopment = () => ENV === 'development';
export const isStaging = () => ENV === 'staging';
export const isProduction = () => ENV === 'production';

// App Info
export const APP_INFO = {
  name: 'iRopit',
  bundleId: 'com.iropit.app',
  version: '1.1.15',
  buildNumber: '1',
};

// Storage Keys
export const STORAGE_KEYS = {
  AUTH_TOKEN: '@iropit_auth_token',
  REFRESH_TOKEN: '@iropit_refresh_token',
  USER_DATA: '@iropit_user_data',
  THEME: '@iropit_theme',
  LANGUAGE: '@iropit_language',
  ONBOARDING_COMPLETED: '@iropit_onboarding_completed',
  ONBOARDING_STEP: '@iropit_onboarding_step',
  DEVICE_ID: '@iropit_device_id',
  PUSH_TOKEN: '@iropit_push_token',
  LAST_SYNC: '@iropit_last_sync',
  SETTINGS: '@iropit_settings',
} as const;

// Timeouts and Intervals
export const TIMEOUTS = {
  API_REQUEST: 30000, // 30 seconds
  WEBSOCKET_RECONNECT: 5000, // 5 seconds
  SYNC_INTERVAL: 60000, // 1 minute
  TOKEN_REFRESH_THRESHOLD: 300000, // 5 minutes before expiry
  DEBOUNCE_SEARCH: 300, // 300ms
  THROTTLE_SCROLL: 100, // 100ms
} as const;

// Limits
export const LIMITS = {
  MAX_MESSAGE_LENGTH: 5000,
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_IMAGE_SIZE: 5 * 1024 * 1024, // 5MB
  MAX_AVATAR_SIZE: 2 * 1024 * 1024, // 2MB
  MESSAGES_PER_PAGE: 50,
  CALLS_PER_PAGE: 50,
  CONTACTS_PER_PAGE: 100,
  SEARCH_RESULTS_LIMIT: 20,
} as const;

// Export everything
export default {
  ENV,
  config,
  isDevelopment,
  isStaging,
  isProduction,
  APP_INFO,
  STORAGE_KEYS,
  TIMEOUTS,
  LIMITS,
};
