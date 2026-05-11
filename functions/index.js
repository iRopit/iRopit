/**
 * Firebase Cloud Functions for iRopit
 * Handles push notifications via FCM
 */

const { onDocumentCreated, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

// Initialize Firebase Admin SDK
initializeApp();

const db = getFirestore();
const messaging = getMessaging();

// Encryption helpers (must match client cryptoService)
const ENCRYPTION_PREFIX = "ENC:";
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

function simpleHash(str) {
  const hash = [];
  for (let i = 0; i < 32; i++) {
    let h = 0;
    for (let j = 0; j < str.length; j++) {
      h = (h * 31 + str.charCodeAt(j) + i) % 2147483647;
    }
    hash.push(Math.abs(h) % 256);
  }
  return hash;
}

function deriveKey(userId, salt) {
  const combined =
    userId +
    Array.from(salt)
      .map((b) => String.fromCharCode(b))
      .join("");
  const hash = simpleHash(combined);
  return new Uint8Array(hash);
}

function xorDecrypt(data, key, iv) {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const keyByte = key[i % key.length];
    const ivByte = iv[i % iv.length];
    const combinedKey = (keyByte + ivByte + i) % 256;
    result[i] = (data[i] - combinedKey + 256) % 256;
  }
  return result;
}

function base64ToArray(base64) {
  const buffer = Buffer.from(base64, "base64");
  return new Uint8Array(buffer);
}

function bytesToString(bytes) {
  return Buffer.from(bytes).toString("utf8");
}

function decryptString(encryptedData, userId) {
  if (!encryptedData || !userId) return encryptedData;
  if (typeof encryptedData !== "string") return encryptedData;
  if (!encryptedData.startsWith(ENCRYPTION_PREFIX)) return encryptedData;

  try {
    const combined = base64ToArray(
      encryptedData.slice(ENCRYPTION_PREFIX.length),
    );

    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

    const key = deriveKey(userId, salt);
    const decrypted = xorDecrypt(ciphertext, key, iv);

    return bytesToString(decrypted);
  } catch (error) {
    console.error("[Crypto] Decryption error:", error);
    return encryptedData;
  }
}

/**
 * Safe decrypt: returns empty string if decryption fails or result is still encrypted
 */
function safeDecrypt(value, userId) {
  if (!value) return "";
  const result = decryptString(value, userId);
  if (!result || (typeof result === "string" && result.startsWith(ENCRYPTION_PREFIX))) return "";
  return result;
}

/**
 * Cloud Function: Process push notification requests
 * Triggered when a new document is created in push_notifications collection
 */
exports.sendPushNotification = onDocumentCreated(
  "push_notifications/{notificationId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return null;

    const notification = snap.data();
    const notificationId = event.params.notificationId;

    // Skip if already processed
    if (notification.status !== "pending") {
      console.log(`Notification ${notificationId} already processed`);
      return null;
    }

    // Chat notifications are handled exclusively by onNewChatMessage (data-only FCM).
    // If this document is for a chat message, mark it delivered and bail out to
    // prevent a duplicate system notification without action buttons.
    if (notification.data?.type === "chat") {
      console.log(`Notification ${notificationId} is chat type — handled by onNewChatMessage, skipping`);
      await snap.ref.update({ status: "delivered", deliveredAt: new Date() });
      return null;
    }

    const fcmToken = notification.fcmToken;

    if (!fcmToken) {
      console.log(`No FCM token for notification ${notificationId}`);
      await snap.ref.update({ status: "failed", error: "No FCM token" });
      return null;
    }

    // Decrypt title/body if they were stored encrypted
    const userId = notification.userId;
    const rawTitle = notification.notification?.title || "New Message";
    const rawBody = notification.notification?.body || "";
    const notifTitle = safeDecrypt(rawTitle, userId) || rawTitle;
    const notifBody = safeDecrypt(rawBody, userId) || rawBody;

    // Build the FCM message
    const message = {
      token: fcmToken,
      notification: {
        title: notifTitle,
        body: notifBody,
      },
      data: {
        type: notification.data?.type || "chat",
        senderId: notification.data?.senderId || "",
        senderDeviceId: notification.data?.senderDeviceId || "",
        timestamp: notification.data?.timestamp || Date.now().toString(),
        click_action: "FLUTTER_NOTIFICATION_CLICK",
      },
      android: {
        priority: "high",
        notification: {
          channelId:
            notification.data?.type === "sms"
              ? "iropit_sms"
              : notification.data?.type === "call"
                ? "iropit_calls"
                : "iropit_chat",
          priority: "high",
          defaultSound: true,
          defaultVibrateTimings: true,
          icon: "ic_notification",
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: notification.notification?.title || "New Message",
              body: notification.notification?.body || "",
            },
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    try {
      // Send the FCM message
      const response = await messaging.send(message);
      console.log(
        `Successfully sent notification ${notificationId}:`,
        response,
      );

      // Update status to delivered
      await snap.ref.update({
        status: "delivered",
        deliveredAt: FieldValue.serverTimestamp(),
        fcmResponse: response,
      });

      return { success: true, messageId: response };
    } catch (error) {
      console.error(`Error sending notification ${notificationId}:`, error);

      // Handle invalid token
      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        // Remove invalid FCM token from device
        try {
          const devicesRef = db.collection("devices");
          const deviceQuery = await devicesRef
            .where("fcmToken", "==", fcmToken)
            .get();

          deviceQuery.forEach(async (doc) => {
            await doc.ref.update({
              fcmToken: FieldValue.delete(),
            });
            console.log(`Removed invalid FCM token from device ${doc.id}`);
          });
        } catch (cleanupError) {
          console.error("Error cleaning up invalid token:", cleanupError);
        }
      }

      // Update notification status to failed
      await snap.ref.update({
        status: "failed",
        error: error.message,
        errorCode: error.code,
        failedAt: FieldValue.serverTimestamp(),
      });

      return { success: false, error: error.message };
    }
  },
);

/**
 * Cloud Function: Clean up old notifications
 * Runs daily at midnight
 */
exports.cleanupOldNotifications = onSchedule("0 0 * * *", async (event) => {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  try {
    const oldNotifications = await db
      .collection("push_notifications")
      .where("createdAt", "<", oneDayAgo)
      .get();

    const batch = db.batch();
    let count = 0;

    oldNotifications.forEach((doc) => {
      batch.delete(doc.ref);
      count++;
    });

    if (count > 0) {
      await batch.commit();
      console.log(`Cleaned up ${count} old notifications`);
    }

    return { cleaned: count };
  } catch (error) {
    console.error("Error cleaning up notifications:", error);
    return { error: error.message };
  }
});

/**
 * Cloud Function: Listen for new chat messages and send notifications
 * Alternative approach - trigger directly from chats collection
 */
exports.onNewChatMessage = onDocumentCreated(
  "chats/{messageId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return null;

    const message = snap.data();
    const messageId = event.params.messageId;

    const userId = message.senderId;
    const senderName = message.senderName || "Device";
    const rawContent = message.content || "";
    const content = decryptString(rawContent, userId) || "";

    // Truncate message preview
    const truncatedContent =
      content.length > 100 ? content.substring(0, 100) + "..." : content;

    // Get all devices for this user
    try {
      const devicesSnapshot = await db
        .collection("devices")
        .where("userId", "==", userId)
        .get();

      const sendPromises = [];

      devicesSnapshot.forEach((doc) => {
        const device = doc.data();

        // Skip the sender device
        if (device.id === message.senderDeviceId) {
          return;
        }

        // If message targets a specific device, only send to that device
        if (
          message.receiverDeviceId &&
          device.id !== message.receiverDeviceId
        ) {
          return;
        }

        const isExtension =
          device.platform === "chrome" ||
          device.platform === "chrome-extension";

        if (isExtension) {
          // Chrome extension has no FCM token — write to push_notifications
          // so the extension's Firestore listener picks it up
          sendPromises.push(
            db.collection("push_notifications").add({
              userId: userId,
              deviceId: device.id,
              fcmToken: device.fcmToken || null,
              notification: {
                title: `💬 ${senderName}`,
                body: truncatedContent || "New message",
              },
              data: {
                type: "chat",
                messageId: messageId,
                senderId: userId,
                senderName: senderName,
                chatId: messageId,
              },
              status: "pending",
              createdAt: Date.now(),
            }).catch((err) => {
              console.error(`Failed to write push_notification for extension device ${device.id}:`, err.message);
            })
          );
          return;
        }

        // Mobile device — send data-only FCM
        if (!device.fcmToken) return;

        const fcmMessage = {
          token: device.fcmToken,
          // Truly data-only — no top-level notification, no android.notification:
          // - Android FCM SDK will NOT auto-show a system notification → setBackgroundMessageHandler
          //   is the only path → notifee shows exactly 1 notification with Copy/Delete/Share actions.
          // - iOS: apns content-available (priority 5) wakes the background handler → notifee shows
          //   1 notification with the registered chat_actions category (Copy/Delete/Share).
          data: {
            type: "chat",
            messageId: messageId,
            senderId: userId,
            senderName: senderName,
            messagePreview: truncatedContent || "New message",
            click_action: "FLUTTER_NOTIFICATION_CLICK",
          },
          android: {
            priority: "high",
          },
          apns: {
            headers: {
              "apns-push-type": "background",
              "apns-priority": "5",
            },
            payload: {
              aps: {
                contentAvailable: true,
              },
            },
          },
        };

        sendPromises.push(
          messaging.send(fcmMessage).catch((error) => {
            console.error(
              `Failed to send to device ${device.id}:`,
              error.message,
            );
          }),
        );
      });

      await Promise.all(sendPromises);
      console.log(`Chat notification sent for message ${messageId}`);

      return { success: true };
    } catch (error) {
      console.error("Error sending chat notifications:", error);
      return { error: error.message };
    }
  },
);

/**
 * Cloud Function: Listen for new SMS/Call/Notification saved from Android device
 * Sends FCM push to ALL other devices (Extension + other phones)
 * so they receive real-time updates even when not actively looking at the app
 */
exports.onNewDeviceNotification = onDocumentCreated(
  "users/{userId}/devices/{deviceId}/notifications/{notificationId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return null;

    const data = snap.data();
    const { userId, deviceId, notificationId } = event.params;
    const type = data.type || "other";

    // Only process SMS, calls, and missed calls
    if (!["sms", "call", "missed_call"].includes(type)) {
      return null;
    }

    // Decrypt fields if encrypted (safeDecrypt returns "" if decryption fails,
    // preventing raw "ENC:..." strings from leaking into push notification titles)
    let title = safeDecrypt(data.title, userId) || "";
    let text = safeDecrypt(data.text, userId) || "";
    let body = safeDecrypt(data.body, userId) || text;
    let contactName = safeDecrypt(data.contactName, userId) || "";
    let phoneNumber = data.phoneNumber || "";

    // Build notification content based on type
    let notifTitle, notifBody, channelId;

    if (type === "sms") {
      notifTitle = `💬 ${contactName || phoneNumber || "SMS"}`;
      notifBody = body || text || "New message";
      channelId = "iropit_sms";
    } else if (type === "missed_call") {
      notifTitle = `📞 Missed call`;
      notifBody = contactName || phoneNumber || "Unknown";
      channelId = "iropit_calls";
    } else if (type === "call") {
      notifTitle = `📞 Call`;
      notifBody = contactName || phoneNumber || "Unknown";
      channelId = "iropit_calls";
    }

    console.log(
      `[onNewDeviceNotification] ${type} from device ${deviceId}: ${notifTitle} - ${notifBody}`,
    );

    try {
      // Get ALL devices for this user
      const devicesSnapshot = await db
        .collection("devices")
        .where("userId", "==", userId)
        .get();

      const sendPromises = [];

      devicesSnapshot.forEach((doc) => {
        const device = doc.data();

        // Skip the source device (the one that saved this notification)
        if (device.id === deviceId) {
          return;
        }

        // Skip devices without FCM token
        if (!device.fcmToken) {
          console.log(
            `[onNewDeviceNotification] Skipping device ${device.id} - no FCM token`,
          );
          return;
        }

        // Truncate body for notification
        const truncatedBody =
          notifBody.length > 150
            ? notifBody.substring(0, 150) + "..."
            : notifBody;

        const fcmMessage = {
          token: device.fcmToken,
          notification: {
            title: notifTitle,
            body: truncatedBody,
          },
          data: {
            type: type,
            notificationId: notificationId,
            sourceDeviceId: deviceId,
            phoneNumber: phoneNumber || "",
            contactName: contactName || "",
            timestamp: (data.timestamp || Date.now()).toString(),
            click_action: "FLUTTER_NOTIFICATION_CLICK",
          },
          android: {
            priority: "high",
            notification: {
              channelId: channelId,
              priority: "high",
              defaultSound: true,
              defaultVibrateTimings: true,
              icon: "ic_notification",
            },
          },
          webpush: {
            notification: {
              title: notifTitle,
              body: truncatedBody,
              icon: "/assets/icon128.png",
              requireInteraction: type === "missed_call",
            },
          },
        };

        sendPromises.push(
          messaging
            .send(fcmMessage)
            .then((response) => {
              console.log(
                `[onNewDeviceNotification] Sent to ${device.id} (${device.platform || "unknown"}): ${response}`,
              );
            })
            .catch((error) => {
              console.error(
                `[onNewDeviceNotification] Failed to send to ${device.id}:`,
                error.message,
              );

              // Clean up invalid tokens
              if (
                error.code === "messaging/invalid-registration-token" ||
                error.code === "messaging/registration-token-not-registered"
              ) {
                doc.ref
                  .update({ fcmToken: FieldValue.delete() })
                  .catch(() => {});
              }
            }),
        );
      });

      if (sendPromises.length > 0) {
        await Promise.all(sendPromises);
        console.log(
          `[onNewDeviceNotification] ${type} notification sent to ${sendPromises.length} devices`,
        );
      } else {
        console.log(
          `[onNewDeviceNotification] No other devices to notify for user ${userId}`,
        );
      }

      return { success: true, sentTo: sendPromises.length };
    } catch (error) {
      console.error("[onNewDeviceNotification] Error:", error);
      return { error: error.message };
    }
  },
);

/**
 * Helper: delete all docs returned by a Firestore query/collection ref in batches of 400.
 */
async function deleteInBatches(ref) {
  const snapshot = await ref.get();
  if (snapshot.empty) return 0;

  let count = 0;
  let batch = db.batch();
  let batchCount = 0;

  for (const docSnap of snapshot.docs) {
    batch.delete(docSnap.ref);
    batchCount++;
    count++;
    if (batchCount >= 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();
  return count;
}

/**
 * Cloud Function: Clean up all device data when a device document is deleted.
 * Triggered by deletions from both Chrome extension and mobile app.
 * Removes: SMS, calls, notifications, chats, and messages linked to the device.
 */
exports.onDeviceDeleted = onDocumentDeleted(
  "devices/{docId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return null;

    const device = snap.data();
    const userId = device.userId;
    const deviceId = device.id || event.params.docId;

    if (!userId || !deviceId) {
      console.log(`[onDeviceDeleted] Missing userId or deviceId for doc ${event.params.docId}`);
      return null;
    }

    console.log(`[onDeviceDeleted] Cleaning up data for device "${deviceId}" of user "${userId}"`);

    try {
      const userDeviceRef = db
        .collection("users").doc(userId)
        .collection("devices").doc(deviceId);

      const [
        notifSubCount,
        callsSubCount,
        smsCount,
        callsTopCount,
        chatsSentCount,
        chatsRecvCount,
        messagesCount,
        userNotifsCount,
      ] = await Promise.all([
        // Subcollection: users/{userId}/devices/{deviceId}/notifications
        deleteInBatches(userDeviceRef.collection("notifications")),
        // Subcollection: users/{userId}/devices/{deviceId}/calls
        deleteInBatches(userDeviceRef.collection("calls")),
        // Top-level sms collection
        deleteInBatches(
          db.collection("sms")
            .where("userId", "==", userId)
            .where("deviceId", "==", deviceId),
        ),
        // Top-level calls collection
        deleteInBatches(
          db.collection("calls")
            .where("userId", "==", userId)
            .where("deviceId", "==", deviceId),
        ),
        // Chats sent by this device
        deleteInBatches(
          db.collection("chats").where("senderDeviceId", "==", deviceId),
        ),
        // Chats received by this device
        deleteInBatches(
          db.collection("chats").where("receiverDeviceId", "==", deviceId),
        ),
        // users/{userId}/messages where deviceId matches
        deleteInBatches(
          db.collection("users").doc(userId)
            .collection("messages")
            .where("deviceId", "==", deviceId),
        ),
        // users/{userId}/notifications where deviceId matches
        deleteInBatches(
          db.collection("users").doc(userId)
            .collection("notifications")
            .where("deviceId", "==", deviceId),
        ),
      ]);

      // Delete the nested users/{userId}/devices/{deviceId} document itself
      await userDeviceRef.delete().catch(() => {});

      console.log(`[onDeviceDeleted] Cleanup complete for device "${deviceId}":`, {
        notificationsSubcollection: notifSubCount,
        callsSubcollection: callsSubCount,
        smsDocuments: smsCount,
        callsDocuments: callsTopCount,
        chatsSent: chatsSentCount,
        chatsReceived: chatsRecvCount,
        messages: messagesCount,
        userNotifications: userNotifsCount,
      });

      return { success: true };
    } catch (error) {
      console.error(`[onDeviceDeleted] Error cleaning up device "${deviceId}":`, error);
      return { error: error.message };
    }
  },
);
