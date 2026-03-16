import { CallLog } from '../../../types';

export const getInitials = (name: string): string => {
  if (!name) return '?';
  const words = name.trim().split(' ');
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

export const formatDateTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isToday) {
    return `Today · ${timeStr}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday · ${timeStr}`;
  }

  return `${date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} · ${timeStr}`;
};

export const formatDuration = (seconds: number): string => {
  if (seconds === 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

export const getCallTypeLabel = (type: CallLog['type']): string => {
  switch (type) {
    case 'incoming':
      return 'Incoming Call';
    case 'outgoing':
      return 'Outgoing Call';
    case 'missed':
      return 'Missed Call';
    case 'rejected':
      return 'Rejected Call';
    default:
      return 'Call';
  }
};

export const getCallTypeIcon = (type: CallLog['type']): string => {
  switch (type) {
    case 'incoming':
      return 'arrow-down';
    case 'outgoing':
      return 'arrow-up';
    case 'missed':
      return 'close-circle';
    case 'rejected':
      return 'close';
    default:
      return 'call';
  }
};
