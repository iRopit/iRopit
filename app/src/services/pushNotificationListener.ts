/**
 * Push Notifications Listener Service
 * Listens for push notification requests from Chrome Extension
 * and displays professional toast notifications when app is in foreground
 */

import firestore from '@react-native-firebase/firestore';
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
