import { getAppIconInfo } from '../../../utils/appIcons';

export const SCREEN_WIDTH_THRESHOLD = 60;
export const ACTION_WIDTH = 75;

export const getAppIconName = (type: string, packageName?: string): string => {
  const iconInfo = getAppIconInfo(packageName, type);
  return iconInfo.iconName;
};

export const getAppIconColor = (type: string, packageName?: string): string => {
  const iconInfo = getAppIconInfo(packageName, type);
  return iconInfo.color;
};

export const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  const diff = now.getTime() - date.getTime();
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const getInitials = (name: string | number | null | undefined): string => {
  if (name == null) return '?';
  const safeName = String(name).trim();
  if (!safeName) return '?';
  const words = safeName.split(' ');
  if (words.length >= 2) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }
  return safeName.substring(0, 2).toUpperCase();
};

export const normalizePhoneNumber = (phone: string | number | null | undefined): string => {
  const safePhone = phone == null ? '' : String(phone);
  let normalized = safePhone.replace(/[\s\-\(\)\+]/g, '').trim();
  if (normalized.startsWith('20') && normalized.length > 10) {
    normalized = normalized.substring(2);
  }
  if (normalized.startsWith('0') && normalized.length > 10) {
    normalized = normalized.substring(1);
  }
  return normalized;
};

export const sanitizeFirestoreKey = (key: string): string => {
  return key
    .replace(/[/|\\=\n\r\t]/g, '_')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .substring(0, 200);
};
