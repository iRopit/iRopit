// iRopit Shared Types

// Re-export generics from organized modules
export * from './generic';

export interface User {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: number;
  lastLoginAt: number;
}

export interface Device {
  id: string;
  userId: string;
  name: string;
  type: 'mobile' | 'chrome-extension' | 'tablet';
  platform: 'android' | 'ios' | 'chrome';
  model?: string;
  lastActiveAt: number;
  fcmToken?: string;
  isOnline: boolean;
}

export interface SMS {
  id: string;
  threadId: string;
  userId: string;
  deviceId: string;
  phoneNumber: string;
  contactName?: string;
  body: string;
  type: 'inbox' | 'sent' | 'draft' | 'outbox';
  read: boolean;
  timestamp: number;
  syncedAt: number;
  simSlot?: number; // 0 = SIM 1, 1 = SIM 2, -1 = unknown
}

export interface CallLog {
  id: string;
  userId: string;
  deviceId: string;
  phoneNumber: string;
  contactName?: string;
  type: 'incoming' | 'outgoing' | 'missed' | 'rejected';
  duration: number;
  timestamp: number;
  syncedAt: number;
  source?: 'phone' | 'whatsapp' | 'telegram'; // مصدر المكالمة
  simSlot?: number; // 0 = SIM 1, 1 = SIM 2, -1 = unknown
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderDeviceId: string;
  receiverId: string;
  receiverDeviceId?: string;
  content: string;
  type: 'text' | 'image' | 'file';
  fileUrl?: string;
  fileName?: string;
  read: boolean;
  timestamp: number;
}

export interface Conversation {
  id: string;
  participants: string[];
  lastMessage?: ChatMessage;
  updatedAt: number;
}

export interface SendSMSRequest {
  id: string;
  userId: string;
  fromDeviceId: string;
  toDeviceId: string;
  phoneNumber: string;
  message: string;
  status: 'pending' | 'sent' | 'failed';
  timestamp: number;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'sms' | 'call' | 'chat' | 'device';
  title: string;
  body: string;
  data: Record<string, any>;
  read: boolean;
  timestamp: number;
}

import { AppNotification } from '../services/notificationService';

// Navigation types
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Conversation: {
    title: string;
    appName: string;
    type: string;
    notifications: AppNotification[];
  };
  CallDetail: {
    call: CallLog;
  };
};

export type AuthStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
};

export type MainTabParamList = {
  SMS: undefined;
  Chat: undefined;
  Calls: undefined;
  Notifications: undefined;
  Menu: undefined;
};

export type SMSStackParamList = {
  SMSList: undefined;
  SMSDetail: { threadId: string; phoneNumber: string; contactName?: string };
  NewSMS: { phoneNumber?: string };
};

export type ChatStackParamList = {
  ChatList: undefined;
  ChatConversation: { conversationId: string; deviceId?: string };
};
