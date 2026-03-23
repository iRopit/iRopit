// ZyncIT Background Service Worker
// Handles notifications, real-time sync, and background tasks

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  addDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
// Firebase config - imported from external file
import firebaseConfig from "../firebase-config.js";

console.log("ZyncIT: Service Worker starting...");

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

console.log("ZyncIT: Firebase initialized");

let currentUser = null;
let currentDeviceId = null;
// Store last timestamp to avoid duplicate notifications
let lastNotificationTimestamp = Date.now() - 5 * 60 * 1000; // 5 minutes ago
let unsubscribeNotifications = [];
let seenNotifications = new Set(); // Track seen notifications
let isInitialLoad = true; // Flag to skip initial snapshot
let serviceWorkerStartTime = Date.now(); // Track when SW started

// Load timestamp from storage
chrome.storage.local.get(
  ["lastNotificationTimestamp", "seenNotifications"],
  (result) => {
    console.log(
      "ZyncIT: Loading stored data - seenNotifications:",
      result.seenNotifications?.length || 0,
    );
    if (result.lastNotificationTimestamp) {
      lastNotificationTimestamp = result.lastNotificationTimestamp;
    }
    if (result.seenNotifications) {
      seenNotifications = new Set(result.seenNotifications);
    }
  },
);

// Listen for auth state changes
onAuthStateChanged(auth, async (user) => {
  console.log("ZyncIT: Auth state changed", user ? user.email : "(logged out)");
  if (user) {
    currentUser = user;
    await loadDeviceId();
    console.log("ZyncIT: Starting listeners for user:", user.uid);
    startListening();
  } else {
    currentUser = null;
    currentDeviceId = null;
    console.log("ZyncIT: User logged out, stopping listeners");
    // Cleanup all listeners
    unsubscribeNotifications.forEach((unsub) => unsub());
    unsubscribeNotifications = [];
  }
});

// Load device ID from storage
async function loadDeviceId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["deviceId"], (result) => {
      currentDeviceId = result.deviceId;
      resolve(currentDeviceId);
    });
  });
}

// Start listening for new notifications from ALL user devices
async function startListening() {
  refreshContextMenuDevices();
  if (!currentUser) {
    console.log("ZyncIT: Cannot start listening - no user");
    return;
  }

  console.log("ZyncIT: Starting real-time listeners...");

  // Stop previous listeners
  unsubscribeNotifications.forEach((unsub) => unsub());
  unsubscribeNotifications = [];

  // 1. Listen to user-level notifications (WhatsApp, Telegram, etc.)
  listenToUserNotifications();

  // 2. Get all user devices
  const devicesQuery = query(
    collection(db, "devices"),
    where("userId", "==", currentUser.uid),
  );

  try {
    const devicesSnapshot = await getDocs(devicesQuery);

    devicesSnapshot.forEach((doc) => {
      const device = doc.data();
      // Only listen to mobile devices (not extension)
      if (
        device.platform !== "chrome" &&
        device.platform !== "chrome-extension" &&
        !device.id?.startsWith("ext_")
      ) {
        // Prefer nickname, then name if human-readable
        let friendlyName = device.nickname;
        if (!friendlyName) {
          if (
            device.name &&
            /[a-zA-Z]/.test(device.name) &&
            !/^[A-Z0-9]+$/.test(device.name)
          ) {
            friendlyName = device.name;
          } else {
            const platform = (device.platform || "").toLowerCase();
            friendlyName =
              platform === "ios"
                ? "iPhone"
                : platform === "android"
                  ? "Android"
                  : "Device";
          }
        }
        console.log("ZyncIT: Listening to device:", device.id, friendlyName);
        listenToDevice(device.id, friendlyName);
      } else {
        console.log("ZyncIT: Skipping extension device:", device.id);
      }
    });
    console.log(
      "ZyncIT: Total listeners active:",
      unsubscribeNotifications.length,
    );
  } catch (error) {
    console.error("ZyncIT: Error getting devices:", error);
  }
}

// Listen to user-level notifications (WhatsApp, Telegram, etc.)
function listenToUserNotifications() {
  if (!currentUser) return;

  let isFirstSnapshot = true;

  const userNotificationsQuery = query(
    collection(db, "users", currentUser.uid, "notifications"),
    orderBy("timestamp", "desc"),
    limit(50),
  );

  const unsub = onSnapshot(
    userNotificationsQuery,
    (snapshot) => {
      console.log(
        "ZyncIT: User notifications snapshot - changes:",
        snapshot.docChanges().length,
        "- total:",
        snapshot.size,
        "- isFirstSnapshot:",
        isFirstSnapshot,
      );

      // Skip the initial snapshot (all existing docs come as 'added')
      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        // Mark all existing docs as seen
        snapshot.docs.forEach((doc) => seenNotifications.add(doc.id));
        console.log(
          "ZyncIT: Initial load - marked",
          snapshot.size,
          "notifications as seen",
        );
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const notification = change.doc.data();
          const docId = change.doc.id;
          const notificationTime =
            notification.timestamp ||
            notification.createdAt?.toMillis?.() ||
            Date.now();

          console.log(
            "ZyncIT: 🆕 NEW notification received - time:",
            new Date(notificationTime).toLocaleString(),
            "docId:",
            docId,
          );

          // Skip if already seen
          if (seenNotifications.has(docId)) {
            console.log("ZyncIT: Skipping already seen notification:", docId);
            return;
          }

          // Add to seen list
          seenNotifications.add(docId);

          // Save to storage (keep last 200)
          const seenArray = Array.from(seenNotifications).slice(-1000);
          chrome.storage.local.set({
            seenNotifications: seenArray,
            lastNotificationTimestamp: Date.now(),
          });

          // Show notification immediately for new ones!
          console.log(
            "ZyncIT: 🔔 Showing Chrome notification for:",
            notification.title,
          );
          showNotification(notification);

          // Send update to popup
          chrome.runtime
            .sendMessage({
              type: "newNotification",
              data: notification,
            })
            .catch(() => {
              // Popup may not be open, ignore error
            });
        }
      });
    },
    (error) => {
      console.error("ZyncIT: User notifications listener error:", error);
    },
  );

  unsubscribeNotifications.push(unsub);
}

// Listen to notifications from a specific device
function listenToDevice(deviceId, deviceName) {
  let isFirstSnapshot = true;

  const notificationsQuery = query(
    collection(
      db,
      "users",
      currentUser.uid,
      "devices",
      deviceId,
      "notifications",
    ),
    orderBy("timestamp", "desc"),
    limit(50), // Limit to most recent notifications
  );

  const unsub = onSnapshot(
    notificationsQuery,
    (snapshot) => {
      console.log(
        "ZyncIT: Device snapshot [",
        deviceName,
        "] - changes:",
        snapshot.docChanges().length,
        "- total:",
        snapshot.size,
        "- isFirstSnapshot:",
        isFirstSnapshot,
      );

      // Skip the initial snapshot (all existing docs come as 'added')
      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        // Mark all existing docs as seen
        snapshot.docs.forEach((doc) => seenNotifications.add(doc.id));
        console.log(
          "ZyncIT: Initial load for",
          deviceName,
          "- marked",
          snapshot.size,
          "notifications as seen",
        );
        return;
      }

      snapshot.docChanges().forEach((change) => {
        console.log(
          "ZyncIT: Change type:",
          change.type,
          "docId:",
          change.doc.id,
        );

        // Only show Chrome notifications for NEW documents
        // 'modified' = existing doc was updated (e.g. Google apps refreshing notifications)
        // We should NOT re-show notifications that were just updated
        if (change.type === "added") {
          const notification = change.doc.data();
          const docId = change.doc.id;
          const notificationTime =
            notification.timestamp || notification.receivedAt || Date.now();

          const timeDiff = Date.now() - notificationTime;
          const isRecent = timeDiff < 5 * 60 * 1000; // 5 minutes

          console.log(
            "ZyncIT: 🆕 Notification from",
            deviceName,
            "- title:",
            notification.title,
            "- time:",
            new Date(notificationTime).toLocaleString(),
            "- age:",
            Math.round(timeDiff / 1000),
            "seconds",
            "- isRecent:",
            isRecent,
          );

          // Skip if already seen (use docId only - not timestamp - to prevent
          // re-showing when the same doc is updated with a new timestamp)
          if (seenNotifications.has(docId)) {
            console.log("ZyncIT: ⏭️ Skipping already seen:", docId);
            return;
          }

          // Only show if notification is recent (last 5 minutes)
          if (!isRecent) {
            console.log(
              "ZyncIT: ⏭️ Skipping old notification (age:",
              Math.round(timeDiff / 1000),
              "seconds)",
            );
            return;
          }

          // Mark as seen by docId
          seenNotifications.add(docId);
          console.log("ZyncIT: ✅ Marked as seen, showing notification...");

          // Keep only last 500 seen
          const seenArray = Array.from(seenNotifications).slice(-500);
          chrome.storage.local.set({
            seenNotifications: seenArray,
            lastNotificationTimestamp: Date.now(),
          });

          // Show notification immediately!
          console.log(
            "ZyncIT: 🔔 CREATING Chrome notification for:",
            notification.title || notification.contactName,
          );
          const notificationWithDevice = {
            ...notification,
            deviceName: deviceName || notification.deviceName,
          };
          showNotification(notificationWithDevice);

          // Send update to popup
          chrome.runtime
            .sendMessage({
              type: "newNotification",
              data: notification,
            })
            .catch(() => {
              // Popup may not be open, ignore error
            });
        }
      });
    },
    (error) => {
      console.error(
        "ZyncIT: Firestore listener error for device",
        deviceId,
        ":",
        error,
      );
    },
  );

  unsubscribeNotifications.push(unsub);

  // Also listen for calls and SMS from this device
  listenForCallsFromDevice(deviceId, deviceName);
  listenForSMSFromDevice(deviceId, deviceName);
}

// Listen for calls from a specific device
function listenForCallsFromDevice(deviceId, deviceName) {
  if (!currentUser) return;

  const callsQuery = query(
    collection(db, "users", currentUser.uid, "devices", deviceId, "calls"),
    limit(10),
  );

  const unsub = onSnapshot(
    callsQuery,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const call = change.doc.data();
          const docId = change.doc.id;
          const callTime = call.timestamp || Date.now();

          // Skip if already seen
          const callKey = `call_${docId}`;
          if (seenNotifications.has(callKey)) {
            return;
          }

          // Only show recent calls (last 5 minutes)
          const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
          if (callTime > fiveMinutesAgo) {
            seenNotifications.add(callKey);

            // Add device name
            const callWithDevice = {
              ...call,
              deviceName: deviceName || call.deviceName,
            };
            showCallNotification(callWithDevice);
          }
        }
      });
    },
    (error) => {
      console.error(
        "ZyncIT: Call listener error for device",
        deviceId,
        ":",
        error,
      );
    },
  );

  unsubscribeNotifications.push(unsub);
}

// ─── OTP Detection & Forwarding ──────────────────────────────────────────────

/**
 * Extract OTP code from SMS text.
 * Returns the first 4-8 digit sequence found near OTP-related keywords,
 * or null if no OTP pattern matches.
 */
function extractOTP(text) {
  if (!text || typeof text !== "string") return null;

  // Must contain an OTP-related keyword (English or Arabic)
  const hasOTPKeyword =
    /\b(otp|code|رمز|pin|كود|verify|verification|confirm|token|one.time|passcode|تحقق|secret|مفتاح)\b/i
      .test(text);
  if (!hasOTPKeyword) return null;

  // Extract standalone 4-8 digit number (prefer longer codes first, e.g. 6-digit)
  const match = text.match(/\b(\d{4,8})\b/);
  return match ? match[1] : null;
}

/**
 * Send the detected OTP to the content script running in the active focused tab.
 */
async function sendOTPToActiveTab(otp, sender, body) {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab || !activeTab.id) return;

    // content scripts cannot run on chrome:// or other restricted URLs
    if (!activeTab.url || activeTab.url.startsWith("chrome")) return;

    chrome.tabs.sendMessage(
      activeTab.id,
      { type: "otpDetected", otp, sender, body },
      () => {
        if (chrome.runtime.lastError) {
          // Content script not injected yet on this page — ignore
        }
      }
    );
  } catch (err) {
    console.warn("ZyncIT: Could not send OTP to active tab:", err);
  }
}

/**
 * Listen for new incoming SMS from a specific mobile device.
 * When an OTP is detected in the SMS body, forward it to the active tab
 * and show a Chrome notification.
 */
function listenForSMSFromDevice(deviceId, deviceName) {
  if (!currentUser) return;

  let isFirstSMSSnapshot = true;
  const seenSMSIds = new Set();

  const smsQuery = query(
    collection(db, "users", currentUser.uid, "devices", deviceId, "notifications"),
    where("type", "==", "sms"),
    orderBy("timestamp", "desc"),
    limit(20),
  );

  const unsub = onSnapshot(
    smsQuery,
    (snapshot) => {
      // On first load, mark everything as seen and exit
      if (isFirstSMSSnapshot) {
        isFirstSMSSnapshot = false;
        snapshot.docs.forEach((d) => seenSMSIds.add(d.id));
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type !== "added") return;

        const docId = change.doc.id;
        if (seenSMSIds.has(docId)) return;
        seenSMSIds.add(docId);

        const sms = change.doc.data();
        const body = sms.body || sms.message || sms.content || sms.text || "";
        const sender = sms.sender || sms.address || sms.phoneNumber || sms.title || "";

        const otp = extractOTP(body);
        if (!otp) return;

        console.log("ZyncIT: 🔑 OTP detected from", deviceName, ":", otp, "sender:", sender);

        // Show Chrome notification
        const notifId = `iropit_otp_${Date.now()}`;
        chrome.notifications.create(notifId, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("assets/icon128.png"),
          title: `OTP from ${sender || deviceName}`,
          message: `${otp} — Copied to clipboard`,
          priority: 2,
        }, () => { void chrome.runtime.lastError; });

        // Forward OTP to the active browser tab (content script handles clipboard + paste)
        sendOTPToActiveTab(otp, sender, body);
      });
    },
    (error) => {
      console.error("ZyncIT: SMS OTP listener error for device", deviceId, ":", error);
    },
  );

  unsubscribeNotifications.push(unsub);
}

// ─── Chrome Notification Display ─────────────────────────────────────────────

// Show Chrome notification
function showNotification(data) {
  const appName = data.appName || data.packageName || "App";
  const title = data.title || data.contactName || "New Notification";
  const message = data.body || data.text || data.content || "";
  const iconUrl = chrome.runtime.getURL("assets/icon128.png");
  const notificationType = data.type || "notification";

  // Create unique notification ID using timestamp to avoid replacing previous notifications
  const notificationId = `zyncit_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  // Build notification options based on type
  let notificationOptions = {
    type: "basic",
    iconUrl: iconUrl,
    title: title,
    message: message,
    priority: 2,
    requireInteraction: false,
    silent: false,
  };

  // Customize based on notification type
  if (notificationType === "sms") {
    notificationOptions.title = `SMS: ${title}`;
    notificationOptions.contextMessage = "New SMS message";
  } else if (
    notificationType === "whatsapp" ||
    data.packageName === "com.whatsapp"
  ) {
    notificationOptions.title = `WhatsApp: ${title}`;
    notificationOptions.contextMessage = "WhatsApp message";
  } else if (data.packageName === "com.instagram.android") {
    notificationOptions.title = `Instagram: ${title}`;
  } else if (data.packageName === "com.snapchat.android") {
    notificationOptions.title = `Snapchat: ${title}`;
  } else if (data.packageName === "com.facebook.orca") {
    notificationOptions.title = `Messenger: ${title}`;
  } else if (data.packageName === "org.telegram.messenger") {
    notificationOptions.title = `Telegram: ${title}`;
  }

  // Add device info if available
  if (data.deviceName) {
    notificationOptions.contextMessage = `From: ${data.deviceName}`;
  }

  console.log(
    "ZyncIT: Creating Chrome notification:",
    notificationId,
    notificationOptions.title,
  );

  chrome.notifications.create(
    notificationId,
    notificationOptions,
    (createdId) => {
      if (chrome.runtime.lastError) {
        console.error(
          "ZyncIT: Error creating notification:",
          chrome.runtime.lastError,
        );
      } else {
        console.log("ZyncIT: ✅ Chrome notification created:", createdId);
      }
    },
  );
}

function showCallNotification(call) {
  const contactInfo = call.contactName || call.phoneNumber || "Unknown";
  const callType = call.type || "incoming";
  const deviceInfo = call.deviceName ? ` - ${call.deviceName}` : "";

  let title = "";
  let icon = "";

  switch (callType) {
    case "missed":
      title = `Missed call from ${contactInfo}`;
      break;
    case "incoming":
      title = `Incoming call from ${contactInfo}`;
      break;
    case "outgoing":
      title = `Outgoing call to ${contactInfo}`;
      break;
    case "rejected":
      title = `Rejected call from ${contactInfo}`;
      break;
    default:
      title = `Call: ${contactInfo}`;
  }

  const message = `Duration: ${formatDuration(call.duration || 0)}${deviceInfo}`;
  const notificationId = `zyncit_call_${call.id || Date.now()}`;

  chrome.notifications.create(
    notificationId,
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon128.png"),
      title: title,
      message: message,
      priority: 2,
      requireInteraction: callType === "missed", // Keep missed calls until user clicks
    },
    (createdId) => {
      if (chrome.runtime.lastError) {
        console.error(
          "ZyncIT: Error creating call notification:",
          chrome.runtime.lastError,
        );
      } else {
      }
    },
  );
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins + ":" + secs.toString().padStart(2, "0");
}

// Handle notification clicks - open extension or create new window
chrome.notifications.onClicked.addListener(async (notificationId) => {
  try {
    // Try to open the popup (only works if there's an active browser window)
    await chrome.action.openPopup();
  } catch (error) {
    try {
      // Find existing Chrome windows
      const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
      if (windows.length > 0) {
        // Focus the first window
        await chrome.windows.update(windows[0].id, { focused: true });
      } else {
        // Create a new window
        await chrome.windows.create({
          url: "chrome://extensions",
          type: "normal",
          focused: true,
        });
      }
    } catch (e) {
      console.error("ZyncIT: Error handling notification click:", e);
    }
  }

  // Clear the notification
  chrome.notifications.clear(notificationId);
});

// Keep service worker alive - CRITICAL for real-time notifications
chrome.alarms.create("keepAlive", { periodInMinutes: 0.25 }); // Every 15 seconds
chrome.alarms.create("checkNotifications", { periodInMinutes: 0.17 }); // Every ~10 seconds

// Poll for new notifications (backup for when onSnapshot fails)
async function pollForNewNotifications() {
  if (!currentUser) return;

  try {
    // Get devices
    const devicesQuery = query(
      collection(db, "devices"),
      where("userId", "==", currentUser.uid),
    );
    const devicesSnapshot = await getDocs(devicesQuery);

    for (const deviceDoc of devicesSnapshot.docs) {
      const device = deviceDoc.data();
      if (
        device.platform === "chrome" ||
        device.platform === "chrome-extension"
      )
        continue;

      // Check for new notifications from this device
      const notifQuery = query(
        collection(
          db,
          "users",
          currentUser.uid,
          "devices",
          device.id,
          "notifications",
        ),
        where("timestamp", ">", lastNotificationTimestamp),
        orderBy("timestamp", "desc"),
        limit(10),
      );

      const notifSnapshot = await getDocs(notifQuery);

      notifSnapshot.forEach((doc) => {
        const notification = doc.data();
        const docId = doc.id;

        // Skip if already seen (use docId directly)
        if (seenNotifications.has(docId)) return;

        console.log(
          "ZyncIT: 📬 POLL found new notification:",
          notification.title || notification.contactName,
        );

        // Mark as seen by docId
        seenNotifications.add(docId);
        const seenArray = Array.from(seenNotifications).slice(-500);
        chrome.storage.local.set({ seenNotifications: seenArray });

        // Update last timestamp
        if (notification.timestamp > lastNotificationTimestamp) {
          lastNotificationTimestamp = notification.timestamp;
          chrome.storage.local.set({
            lastNotificationTimestamp: notification.timestamp,
          });
        }

        // Show Chrome notification
        const notificationWithDevice = {
          ...notification,
          deviceName: device.nickname || device.name || "Android",
        };
        showNotification(notificationWithDevice);

        // Send to popup
        chrome.runtime
          .sendMessage({
            type: "newNotification",
            data: notification,
          })
          .catch(() => {});
      });
    }
  } catch (error) {
    console.error("ZyncIT: Poll error:", error);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkNotifications") {
    console.log("ZyncIT: 🔍 Polling for new notifications...");
    pollForNewNotifications();
  }

  if (alarm.name === "keepAlive") {
    console.log("ZyncIT: Keep-alive ping", new Date().toLocaleTimeString());
    // Re-establish listeners if they were lost
    if (currentUser && unsubscribeNotifications.length === 0) {
      console.log("ZyncIT: Listeners lost, restarting...");
      startListening();
    }
  }
});

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  // Context menus will be built when auth fires startListening
});

// ─── Context Menu: Send Page to Device ───────────────────────────────────────

// Tracked mobile devices for context menu [ { id, name } ]
let contextMenuDevices = [];
let _buildMenuTimer = null;

/** Build (or rebuild) the right-click context menu entries. Debounced to avoid duplicate-ID errors. */
function buildContextMenus() {
  if (_buildMenuTimer) clearTimeout(_buildMenuTimer);
  _buildMenuTimer = setTimeout(() => {
    _buildMenuTimer = null;
    chrome.contextMenus.removeAll(() => {
      // Root item — send page/link
      chrome.contextMenus.create({
        id: "iropit_root",
        title: "iRopit: Send page to...",
        contexts: ["page", "link"],
      }, () => { void chrome.runtime.lastError; });

      chrome.contextMenus.create({
        id: "iropit_all",
        parentId: "iropit_root",
        title: "📱 All devices",
        contexts: ["page", "link"],
      }, () => { void chrome.runtime.lastError; });

      if (contextMenuDevices.length > 0) {
        chrome.contextMenus.create({
          id: "iropit_sep",
          parentId: "iropit_root",
          type: "separator",
          contexts: ["page", "link"],
        }, () => { void chrome.runtime.lastError; });
        contextMenuDevices.forEach((device) => {
          chrome.contextMenus.create({
            id: `iropit_dev_${device.id}`,
            parentId: "iropit_root",
            title: device.name,
            contexts: ["page", "link"],
          }, () => { void chrome.runtime.lastError; });
        });
      }

      // Root item — send selected text
      chrome.contextMenus.create({
        id: "iropit_sel_root",
        title: "iRopit: Send selection to...",
        contexts: ["selection"],
      }, () => { void chrome.runtime.lastError; });

      chrome.contextMenus.create({
        id: "iropit_sel_all",
        parentId: "iropit_sel_root",
        title: "📱 All devices",
        contexts: ["selection"],
      }, () => { void chrome.runtime.lastError; });

      if (contextMenuDevices.length > 0) {
        chrome.contextMenus.create({
          id: "iropit_sel_sep",
          parentId: "iropit_sel_root",
          type: "separator",
          contexts: ["selection"],
        }, () => { void chrome.runtime.lastError; });
        contextMenuDevices.forEach((device) => {
          chrome.contextMenus.create({
            id: `iropit_sel_dev_${device.id}`,
            parentId: "iropit_sel_root",
            title: device.name,
            contexts: ["selection"],
          }, () => { void chrome.runtime.lastError; });
        });
      }

      // Root item — send image
      chrome.contextMenus.create({
        id: "iropit_img_root",
        title: "iRopit: Send image to...",
        contexts: ["image"],
      }, () => { void chrome.runtime.lastError; });

      chrome.contextMenus.create({
        id: "iropit_img_all",
        parentId: "iropit_img_root",
        title: "📱 All devices",
        contexts: ["image"],
      }, () => { void chrome.runtime.lastError; });

      if (contextMenuDevices.length > 0) {
        chrome.contextMenus.create({
          id: "iropit_img_sep",
          parentId: "iropit_img_root",
          type: "separator",
          contexts: ["image"],
        }, () => { void chrome.runtime.lastError; });
        contextMenuDevices.forEach((device) => {
          chrome.contextMenus.create({
            id: `iropit_img_dev_${device.id}`,
            parentId: "iropit_img_root",
            title: device.name,
            contexts: ["image"],
          }, () => { void chrome.runtime.lastError; });
        });
      }
    });
  }, 300);
}

/** Refresh device list and rebuild menus whenever devices change. */
async function refreshContextMenuDevices() {
  if (!currentUser) return;
  try {
    const snap = await getDocs(
      query(collection(db, "devices"), where("userId", "==", currentUser.uid)),
    );
    const mobile = [];
    snap.forEach((d) => {
      const dev = d.data();
      if (
        dev.platform !== "chrome" &&
        dev.platform !== "chrome-extension" &&
        !dev.id?.startsWith("ext_")
      ) {
        let name = dev.nickname;
        if (!name) {
          if (dev.name && /[a-zA-Z]/.test(dev.name) && !/^[A-Z0-9]+$/.test(dev.name)) {
            name = dev.name;
          } else {
            const p = (dev.platform || "").toLowerCase();
            name = p === "ios" ? "iPhone" : p === "android" ? "Android" : "Device";
          }
        }
        mobile.push({ id: dev.id, name });
      }
    });
    contextMenuDevices = mobile;
    buildContextMenus();
  } catch (e) {
    console.warn("ZyncIT: Could not refresh context menu devices:", e);
  }
}

/** Send text content (URL or selected text) as a chat message to one or all devices. */
async function sendTextToDevice(content, targetDeviceId) {
  if (!currentUser) return;
  const base = {
    senderId: currentUser.uid,
    senderDeviceId: currentDeviceId || "ext_sw",
    senderPlatform: "chrome-extension",
    senderName: currentUser.displayName || "Extension",
    receiverId: currentUser.uid,
    content,
    type: "text",
    read: false,
    timestamp: Date.now(),
    participants: [currentUser.uid],
  };

  try {
    if (!targetDeviceId) {
      if (contextMenuDevices.length === 0) {
        await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: null });
      } else {
        await Promise.all(
          contextMenuDevices.map((dev) =>
            addDoc(collection(db, "chats"), { ...base, receiverDeviceId: dev.id })
          )
        );
      }
    } else {
      await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: targetDeviceId });
    }
    console.log("ZyncIT: ✅ Text sent:", content.slice(0, 50), "→", targetDeviceId || "all");
  } catch (e) {
    console.error("ZyncIT: Failed to send text:", e);
  }
}

/** Send a URL as a chat message to one or all devices. */
async function sendPageToDevice(url, targetDeviceId) {
  if (!currentUser) return;
  const content = url;
  const base = {
    senderId: currentUser.uid,
    senderDeviceId: currentDeviceId || "ext_sw",
    senderPlatform: "chrome-extension",
    senderName: currentUser.displayName || "Extension",
    receiverId: currentUser.uid,
    content,
    type: "text",
    read: false,
    timestamp: Date.now(),
    participants: [currentUser.uid],
  };

  try {
    if (!targetDeviceId) {
      // Send to each mobile device individually
      if (contextMenuDevices.length === 0) {
        // Fallback: broadcast with no specific receiver
        await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: null });
      } else {
        await Promise.all(
          contextMenuDevices.map((dev) =>
            addDoc(collection(db, "chats"), { ...base, receiverDeviceId: dev.id })
          )
        );
      }
    } else {
      await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: targetDeviceId });
    }
    console.log("ZyncIT: ✅ Page sent:", url, "→", targetDeviceId || "all");
  } catch (e) {
    console.error("ZyncIT: Failed to send page:", e);
  }
}

/** Fetch image from srcUrl, upload to Firebase Storage, send as type:"image" message. */
async function sendImageToDevice(srcUrl, targetDeviceId) {
  if (!currentUser) return;
  try {
    // 1. Fetch the image bytes
    const imgResp = await fetch(srcUrl);
    if (!imgResp.ok) throw new Error(`Fetch failed: ${imgResp.status}`);
    const blob = await imgResp.blob();
    const contentType = blob.type || "image/jpeg";

    // 2. Upload to Firebase Storage via REST API (no SDK import needed)
    const idToken = await currentUser.getIdToken();
    const ext = (contentType.split("/")[1] || "jpg").split("+")[0];
    const storagePath = `chat_files/${currentUser.uid}/${Date.now()}.${ext}`;
    const bucket = "iropit-64ea0.firebasestorage.app";
    const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`;
    const uploadResp = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": contentType },
      body: blob,
    });
    if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);

    // 3. Build public download URL using the token from the upload response
    // (URLs with ?token= are publicly accessible without auth headers)
    const uploadData = await uploadResp.json();
    const downloadToken = uploadData.downloadTokens;
    const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

    // 4. Send Firestore message with type:"image" so chat renders it as an image
    const base = {
      senderId: currentUser.uid,
      senderDeviceId: currentDeviceId || "ext_sw",
      senderPlatform: "chrome-extension",
      senderName: currentUser.displayName || "Extension",
      receiverId: currentUser.uid,
      content: "📷 Image",
      type: "image",
      fileUrl,
      read: false,
      timestamp: Date.now(),
      participants: [currentUser.uid],
    };
    if (!targetDeviceId) {
      if (contextMenuDevices.length === 0) {
        await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: null });
      } else {
        await Promise.all(
          contextMenuDevices.map((dev) =>
            addDoc(collection(db, "chats"), { ...base, receiverDeviceId: dev.id })
          )
        );
      }
    } else {
      await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: targetDeviceId });
    }
    console.log("ZyncIT: ✅ Image uploaded & sent:", storagePath, "→", targetDeviceId || "all");
  } catch (e) {
    // Fallback: send the original URL as text (e.g. CORS-blocked CDN images)
    console.warn("ZyncIT: Image upload failed, sending URL as text:", e.message);
    await sendTextToDevice(srcUrl, targetDeviceId);
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = String(info.menuItemId);

  // Selected text menu
  if (menuId === "iropit_sel_all") {
    if (info.selectionText) sendTextToDevice(info.selectionText, null);
    return;
  }
  if (menuId.startsWith("iropit_sel_dev_")) {
    const deviceId = menuId.replace("iropit_sel_dev_", "");
    if (info.selectionText) sendTextToDevice(info.selectionText, deviceId);
    return;
  }

  // Image menu
  if (menuId === "iropit_img_all") {
    if (info.srcUrl) sendImageToDevice(info.srcUrl, null);
    return;
  }
  if (menuId.startsWith("iropit_img_dev_")) {
    const deviceId = menuId.replace("iropit_img_dev_", "");
    if (info.srcUrl) sendImageToDevice(info.srcUrl, deviceId);
    return;
  }

  // Page/link menu
  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!url) return;

  if (menuId === "iropit_all") {
    sendPageToDevice(url, null);
  } else if (menuId.startsWith("iropit_dev_")) {
    const deviceId = menuId.replace("iropit_dev_", "");
    sendPageToDevice(url, deviceId);
  }
});

// Message handler from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "setDeviceId") {
    currentDeviceId = message.deviceId;
    chrome.storage.local.set({ deviceId: message.deviceId });
    startListening();
    sendResponse({ success: true });
  }

  if (message.type === "getStatus") {
    sendResponse({
      user: currentUser
        ? { uid: currentUser.uid, email: currentUser.email }
        : null,
      deviceId: currentDeviceId,
      listening: unsubscribeNotifications.length > 0,
      listenersCount: unsubscribeNotifications.length,
      seenCount: seenNotifications.size,
    });
  }

  // Handle user login notification from popup
  if (message.type === "userLoggedIn") {
    // Auth state should update automatically, but force restart listening
    if (currentUser) {
      startListening();
      refreshContextMenuDevices();
    }
    sendResponse({ success: true });
  }

  // Clear seen notifications (for troubleshooting)
  if (message.type === "clearSeenNotifications") {
    seenNotifications.clear();
    chrome.storage.local.remove([
      "seenNotifications",
      "lastNotificationTimestamp",
    ]);
    sendResponse({ success: true });
  }

  // Restart listeners manually
  if (message.type === "restartListening") {
    startListening();
    sendResponse({ success: true, listening: true });
  }

  return true;
});
