/**
 * Handles Copy / Delete / Share actions from chat message notifications.
 * Used by both the foreground (NotificationContext) and background (index.js) handlers.
 */

import Clipboard from '@react-native-clipboard/clipboard';
import { Share } from 'react-native';
import firestore from '@react-native-firebase/firestore';
// @ts-ignore – no type declarations for this package in this project
import notifee from '@notifee/react-native';

export async function handleChatNotificationAction(
  actionId: string,
  notificationData: Record<string, string>,
  notificationId?: string,
): Promise<void> {
  const messageBody = notificationData?.messageBody || '';
  const pushDocId   = notificationData?.pushDocId   || '';
  const chatId      = notificationData?.chatId      || '';

  switch (actionId) {
    case 'copy_message':
      if (messageBody) {
        Clipboard.setString(messageBody);
      }
      if (notificationId) {
        await notifee.cancelNotification(notificationId);
      }
      break;

    case 'delete_message':
      try {
        if (chatId) {
          await firestore().collection('chats').doc(chatId).delete();
        }
        if (pushDocId) {
          await firestore().collection('push_notifications').doc(pushDocId).delete();
        }
        if (notificationId) {
          await notifee.cancelNotification(notificationId);
        }
      } catch (err) {
        console.error('[ChatNotificationActions] Delete failed:', err);
      }
      break;

    case 'share_message':
      if (messageBody) {
        try {
          await Share.share({ message: messageBody });
        } catch (err) {
          console.error('[ChatNotificationActions] Share failed:', err);
        }
      }
      break;
  }
}
