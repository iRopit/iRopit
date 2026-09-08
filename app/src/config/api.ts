/**
 * API Configuration
 *
 * Centralized API endpoint definitions and request helpers.
 */

import { config, TIMEOUTS } from './env';

// API Endpoints
export const API_ENDPOINTS = {
  // Auth
  AUTH: {
    LOGIN: '/auth/login',
    LOGOUT: '/auth/logout',
    REGISTER: '/auth/register',
    REFRESH_TOKEN: '/auth/refresh',
    FORGOT_PASSWORD: '/auth/forgot-password',
    RESET_PASSWORD: '/auth/reset-password',
    VERIFY_EMAIL: '/auth/verify-email',
    VERIFY_PHONE: '/auth/verify-phone',
  },

  // User
  USER: {
    PROFILE: '/user/profile',
    UPDATE_PROFILE: '/user/profile',
    CHANGE_PASSWORD: '/user/change-password',
    DELETE_ACCOUNT: '/user/delete',
    UPLOAD_AVATAR: '/user/avatar',
    DEVICES: '/user/devices',
    REMOVE_DEVICE: '/user/devices/:id',
  },

  // Messages
  MESSAGES: {
    LIST: '/messages',
    GET: '/messages/:id',
    SEND: '/messages',
    DELETE: '/messages/:id',
    MARK_READ: '/messages/:id/read',
    CONVERSATIONS: '/messages/conversations',
    CONVERSATION: '/messages/conversations/:contactId',
    SYNC: '/messages/sync',
  },

  // Calls
  CALLS: {
    LIST: '/calls',
    GET: '/calls/:id',
    DELETE: '/calls/:id',
    SYNC: '/calls/sync',
  },

  // Contacts
  CONTACTS: {
    LIST: '/contacts',
    GET: '/contacts/:id',
    ADD: '/contacts',
    UPDATE: '/contacts/:id',
    DELETE: '/contacts/:id',
    SYNC: '/contacts/sync',
    IMPORT: '/contacts/import',
  },

  // Notifications
  NOTIFICATIONS: {
    LIST: '/notifications',
    MARK_READ: '/notifications/:id/read',
    MARK_ALL_READ: '/notifications/read-all',
    SETTINGS: '/notifications/settings',
    UPDATE_SETTINGS: '/notifications/settings',
    REGISTER_PUSH_TOKEN: '/notifications/push-token',
  },

  // Settings
  SETTINGS: {
    GET: '/settings',
    UPDATE: '/settings',
  },

  // Sync
  SYNC: {
    FULL: '/sync/full',
    INCREMENTAL: '/sync/incremental',
    STATUS: '/sync/status',
  },
} as const;

// HTTP Methods
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Request Options
export interface RequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
  withAuth?: boolean;
}

// Response Type
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

// Default headers
export const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-App-Version': '1.1.29',
  'X-Platform': 'mobile',
};

// Build URL with path parameters
export const buildUrl = (
  endpoint: string,
  params?: Record<string, string | number>,
): string => {
  let url = `${config.apiBaseUrl}${endpoint}`;

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url = url.replace(`:${key}`, String(value));
    });
  }

  return url;
};

// Build URL with query parameters
export const buildUrlWithQuery = (
  endpoint: string,
  params?: Record<string, string | number>,
  query?: Record<string, any>,
): string => {
  let url = buildUrl(endpoint, params);

  if (query) {
    const queryString = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      )
      .join('&');

    if (queryString) {
      url += `?${queryString}`;
    }
  }

  return url;
};

// Create request with timeout
export const createRequest = async <T>(
  url: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> => {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMEOUTS.API_REQUEST,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...DEFAULT_HEADERS,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: data.code || `HTTP_${response.status}`,
          message:
            data.message || `Request failed with status ${response.status}`,
          details: data.details,
        },
      };
    }

    return {
      success: true,
      data: data.data || data,
      meta: data.meta,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      return {
        success: false,
        error: {
          code: 'TIMEOUT',
          message: 'Request timed out',
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: error.message || 'Network error occurred',
      },
    };
  }
};

// Error codes
export const API_ERROR_CODES = {
  // Auth errors
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',

  // Resource errors
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',

  // Server errors
  SERVER_ERROR: 'SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
} as const;

export default {
  API_ENDPOINTS,
  DEFAULT_HEADERS,
  buildUrl,
  buildUrlWithQuery,
  createRequest,
  API_ERROR_CODES,
};
