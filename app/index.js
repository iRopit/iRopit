import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { EventType, AndroidImportance } from '@notifee/react-native';
import App from './src/App';
import { name as appName } from './app.json';
import { handleChatNotificationAction } from './src/services/chatNotificationActions';

// Register iOS notification category so Copy/Delete/Share action buttons appear on iOS.
// Must be called before setBackgroundMessageHandler and before AppRegistry.registerComponent.
notifee.setNotificationCategories([
  {
    id: 'chat_actions',
    actions: [
      { id: 'copy_message',   title: 'Copy' },
      { id: 'delete_message', title: 'Delete',         destructive: true },
      { id: 'share_message',  title: 'Share' },
    ],
  },
]);

// Handle FCM messages when app is in background or quit state.
// Always create the channel here — NotificationContext hasn't mounted yet in this state.
messaging().setBackgroundMessageHandler(async remoteMessage => {
  const title   = remoteMessage.notification?.title || remoteMessage.data?.senderName || 'New Message';
  const msgBody = remoteMessage.notification?.body  || remoteMessage.data?.messagePreview || '';

  // Nothing to display
  if (!title && !msgBody) return;

  // Ensure channel exists (idempotent — safe to call every time)
  await notifee.createChannel({
    id: 'iropit_chat',
    name: 'Chat Messages',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });

  const chatId    = remoteMessage.data?.chatId    || remoteMessage.data?.messageId || '';
  const pushDocId = remoteMessage.data?.pushDocId || '';

  await notifee.displayNotification({
    title,
    body: msgBody,
    data: { messageBody: msgBody, pushDocId, chatId },
    android: {
      channelId: 'iropit_chat',
      importance: AndroidImportance.HIGH,
      smallIcon: 'ic_notification',
      pressAction: { id: 'default' },
      actions: [
        { title: 'Copy',   pressAction: { id: 'copy_message' } },
        { title: 'Delete', pressAction: { id: 'delete_message' } },
        { title: 'Share',  pressAction: { id: 'share_message', launchActivity: 'default' } },
      ],
    },
    ios: {
      categoryId: 'chat_actions',
      sound: 'default',
    },
  });
});

// Handle notifee action button presses when app is in background/quit
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.ACTION_PRESS && detail.pressAction?.id && detail.notification) {
    await handleChatNotificationAction(
      detail.pressAction.id,
      (detail.notification.data || {}),
      detail.notification.id,
    );
  }
});

AppRegistry.registerComponent(appName, () => App);
