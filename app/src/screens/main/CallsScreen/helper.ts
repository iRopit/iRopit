import { CallLog } from '../../../../types';
import { ColorTheme } from '../../../theme/colors';

export const ACTION_WIDTH = 75;

export const formatTime = (timestamp: number) => {
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

export const getInitials = (name: string, phone: string) => {
  if (name && name !== phone) {
    const words = name.trim().split(' ');
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
  return '??';
};

export const getCallTypeIndicator = (
  type: CallLog['type'],
  colors?: ColorTheme,
) => {
  switch (type) {
    case 'incoming':
      return { icon: 'arrow-down', color: colors?.incoming || '#30D158' };
    case 'outgoing':
      return { icon: 'arrow-up', color: colors?.primary || '#D5C19E' };
    case 'missed':
      return {
        icon: 'close-circle',
        color: colors?.missed || colors?.error || '#FF3B30',
      };
    case 'rejected':
      return {
        icon: 'close',
        color: colors?.missed || colors?.error || '#FF3B30',
      };
    default:
      return { icon: 'call', color: colors?.textSecondary || '#8E8E93' };
  }
};
