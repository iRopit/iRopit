/**
 * Firebase Cloud Functions for iRopit
 * Handles push notifications via FCM and AI-powered features via GPT-4.1
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const OpenAI = require("openai");

const openaiApiKey = defineSecret("OPENAI_API_KEY");

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

    const fcmToken = notification.fcmToken;

    if (!fcmToken) {
      console.log(`No FCM token for notification ${notificationId}`);
      await snap.ref.update({ status: "failed", error: "No FCM token" });
      return null;
    }

    // Build the FCM message
    const message = {
      token: fcmToken,
      notification: {
        title: notification.notification?.title || "New Message",
        body: notification.notification?.body || "",
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

    // Only send notification for messages from chrome-extension
    if (message.senderPlatform !== "chrome-extension") {
      return null;
    }

    const userId = message.senderId;
    const senderName = message.senderName || "Chrome Extension";
    const rawContent = message.content || "";
    const content = decryptString(rawContent, userId) || "";

    // Get all mobile devices for this user
    try {
      const devicesSnapshot = await db
        .collection("devices")
        .where("userId", "==", userId)
        .get();

      const sendPromises = [];

      devicesSnapshot.forEach((doc) => {
        const device = doc.data();

        // Skip the sender device and devices without FCM token
        if (
          device.id === message.senderDeviceId ||
          !device.fcmToken ||
          device.platform === "chrome" ||
          device.platform === "chrome-extension"
        ) {
          return;
        }

        // If message targets a specific device, only send to that device
        if (
          message.receiverDeviceId &&
          device.id !== message.receiverDeviceId
        ) {
          return;
        }

        // Truncate message
        const truncatedContent =
          content.length > 100 ? content.substring(0, 100) + "..." : content;

        const fcmMessage = {
          token: device.fcmToken,
          notification: {
            title: `💬 ${senderName}`,
            body: truncatedContent || "New message",
          },
          data: {
            type: "chat",
            messageId: messageId,
            senderId: userId,
            click_action: "FLUTTER_NOTIFICATION_CLICK",
          },
          android: {
            priority: "high",
            notification: {
              channelId: "iropit_chat",
              priority: "high",
              defaultSound: true,
              defaultVibrateTimings: true,
              icon: "ic_notification",
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

    // Decrypt fields if encrypted
    let title = decryptString(data.title, userId) || data.title || "";
    let text = decryptString(data.text, userId) || data.text || "";
    let body = decryptString(data.body, userId) || data.body || text;
    let contactName =
      decryptString(data.contactName, userId) || data.contactName || "";
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
 * Cloud Function: Summarize notifications using GPT-4.1
 * Callable from the Chrome Extension and mobile app
 * Requires the OPENAI_API_KEY secret to be configured in Firebase
 */
exports.summarizeNotifications = onCall(
  { secrets: [openaiApiKey] },
  async (request) => {
    // Require authentication
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to use AI features.",
      );
    }

    const { notifications, language } = request.data;

    if (!Array.isArray(notifications) || notifications.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "notifications must be a non-empty array.",
      );
    }

    const MAX_NOTIFICATIONS = 50;
    const notificationsToSummarize = notifications.slice(0, MAX_NOTIFICATIONS);

    // Build a plain-text list of notifications for the prompt
    const notifText = notificationsToSummarize
      .map((n, i) => {
        const app = n.appName || n.packageName || "Unknown App";
        const title = n.title || "";
        const body = n.text || n.body || "";
        return `${i + 1}. [${app}] ${title}${body ? ": " + body : ""}`;
      })
      .join("\n");

    const isArabic = language === "ar";
    const systemPrompt = isArabic
      ? "أنت مساعد ذكي متخصص في تلخيص الإشعارات. قدم ملخصاً موجزاً وواضحاً للإشعارات المدرجة، مجمعاً التطبيقات المتشابهة معاً. أجب باللغة العربية فقط."
      : "You are a smart assistant specialized in summarizing phone notifications. Provide a concise, clear summary of the listed notifications, grouping similar apps together. Be brief and actionable.";

    const userPrompt = isArabic
      ? `لخّص الإشعارات التالية:\n\n${notifText}`
      : `Summarize these notifications:\n\n${notifText}`;

    try {
      const openai = new OpenAI({ apiKey: openaiApiKey.value() });

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0.5,
      });

      const summary = completion.choices[0]?.message?.content?.trim() || "";
      console.log(
        `[summarizeNotifications] Summary generated for user ${request.auth.uid}`,
      );

      return { summary };
    } catch (error) {
      console.error("[summarizeNotifications] OpenAI error:", error.message);
      throw new HttpsError(
        "internal",
        "Failed to generate summary. Please try again later.",
      );
    }
  },
);
