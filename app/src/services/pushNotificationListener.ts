/**
 * Push Notifications Listener Service
 * Listens for push notification requests from Chrome Extension
 * and displays professional toast notifications when app is in foreground
 */

import firestore from '@react-native-firebase/firestore';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { useAuthStore } from '../store/authStore';
import { useDeviceStore } from '../store/deviceStore';
import { showGlobalNotification } from '../contexts/InAppNotificationContext';

/**
 * Start listening for push notification requests
 * Returns unsubscribe function
 */
export function startPushNotificationListener() {
  const user = useAuthStore.getState().user;
  const currentDevice = useDeviceStore.getState().currentDevice;

  if (!user || !currentDevice) {
    console.log(
      '[PushNotificationListener] No user or device, skipping listener',
    );
    return () => {};
  }

  console.log(
    '[PushNotificationListener] Starting listener for device:',
    currentDevice.id,
  );

  // Capture the time the listener was attached. Any 'added' document whose
  // createdAt is older than this is a stale notification left over from a
  // previous session (e.g. app reinstall). We silently mark those as
  // delivered so they don't flood the notification panel on startup.
  const listenerStartTime = Date.now();

  // Listen for push notifications targeted at this device
  const unsubscribe = firestore()
    .collection('push_notifications')
    .where('userId', '==', user.uid)
    .where('deviceId', '==', currentDevice.id)
    .where('status', '==', 'pending')
    .onSnapshot(
      async snapshot => {
        for (const change of snapshot.docChanges()) {
          if (change.type === 'added') {
            const notification = change.doc.data();

            // Silently dismiss notifications created before this listener
            // started — they are stale leftovers from a previous install/session.
            if (
              notification.createdAt &&
              notification.createdAt < listenerStartTime
            ) {
              try {
                await change.doc.ref.update({
                  status: 'delivered',
                  deliveredAt: Date.now(),
                });
              } catch (_) {}
              continue;
            }
            console.log(
              '[PushNotificationListener] New notification:',
              notification,
            );

            // Display professional toast notification (skip if user is on Chat screen)
            if (notification.notification) {
              showGlobalNotification({
                title: notification.notification.title || 'New Message',
                message: notification.notification.body || '',
                type: 'info',
                duration: 5000,
                skipIfOnChat: true,
              });
            }

            // Show native Android notification with action buttons
            try {
              const msgBody = notification.notification?.body || '';
              const chatId  = notification.data?.chatId || notification.data?.messageId || '';

              // Ensure channel exists before displaying — NotificationContext may not have
              // run yet if this fires early in the app lifecycle or from a background wake
              await notifee.createChannel({
                id: 'iropit_chat',
                name: 'Chat Messages',
                importance: AndroidImportance.HIGH,
                sound: 'default',
                vibration: true,
              });

              await notifee.displayNotification({
                id: change.doc.id,
                title: notification.notification?.title || 'New Message',
                body: msgBody,
                data: {
                  messageBody: msgBody,
                  pushDocId: change.doc.id,
                  chatId,
                },
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
              });
            } catch (notifErr) {
              console.error('[PushNotificationListener] Failed to show notification:', notifErr);
            }

            // Mark as delivered
            try {
              await change.doc.ref.update({
                status: 'delivered',
                deliveredAt: Date.now(),
              });
            } catch (err) {
              console.error(
                '[PushNotificationListener] Error updating status:',
                err,
              );
            }
          }
        }
      },
      error => {
        console.error('[PushNotificationListener] Error:', error);
      },
    );

  return unsubscribe;
}

/**
 * Clean up old notifications (older than 24 hours)
 */
export async function cleanupOldNotifications() {
  const user = useAuthStore.getState().user;
  if (!user) return;

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  try {
    const oldNotifications = await firestore()
      .collection('push_notifications')
      .where('userId', '==', user.uid)
      .where('createdAt', '<', oneDayAgo)
      .get();

    const batch = firestore().batch();
    oldNotifications.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(
      `[PushNotificationListener] Cleaned up ${oldNotifications.size} old notifications`,
    );
  } catch (error) {
    console.error('[PushNotificationListener] Error cleaning up:', error);
  }
}
