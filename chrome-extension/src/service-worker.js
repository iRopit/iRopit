// ZyncIT Background Service Worker
// Handles notifications, real-time sync, and background tasks

import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  GoogleAuthProvider,
} from "firebase/auth/web-extension";
import {
  getFirestore,
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  getDocsFromServer,
  getDoc,
  addDoc,
  setDoc,
} from "firebase/firestore";
// Firebase config - imported from external file
import firebaseConfig from "../firebase-config.js";
import { decrypt, decryptCall } from "./services/cryptoService.js";

console.log("ZyncIT: Service Worker starting...");

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

console.log("ZyncIT: Firebase initialized");

// Globally swallow Firestore permission-denied errors that happen during sign-out.
// These are expected: in-flight queries fail when the auth token is revoked.
self.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  if (
    reason?.code === "permission-denied" ||
    /Missing or insufficient permissions/i.test(reason?.message || "")
  ) {
    event.preventDefault();
  }
});

let currentUser = null;
let currentDeviceId = null;
const SMS_CACHE_CAP = 10000;
const CALLS_CACHE_CAP = 2000;
let isStartingListeners = false;
let activeListenersUserUid = null;
// Store last timestamp to avoid duplicate notifications
let lastNotificationTimestamp = Date.now() - 5 * 60 * 1000; // 5 minutes ago
let unsubscribeNotifications = [];
let seenNotifications = new Set(); // Track seen notifications
const NOTIFICATION_DEDUPE_WINDOW_MS = 30 * 1000;
const NOTIFICATION_DEDUPE_MAX_KEYS = 400;
let recentNotificationFingerprints = {};
let lastChatPollTimestamp = Date.now() - 2 * 60 * 1000; // 2 minutes ago
let seenChatMessageIds = new Set(); // Track seen chat message IDs for smart actions
let isInitialLoad = true; // Flag to skip initial snapshot
let serviceWorkerStartTime = Date.now(); // Track when SW started

// Badge count for unread notifications
let badgeCount = 0;
// Per-source unread ID sets maintained from Firestore snapshots
// (keys: deviceId and "_user_notifications").
let unreadIdsBySource = new Map();
// Locally-marked read IDs from popup cache (optimistic read state).
let locallyReadNotificationIds = new Set();
// Snooze: notifications suppressed until this timestamp (0 = not snoozed)
let snoozeUntil = 0;

// Smart action settings (kept in sync with chrome.storage.local)
const smartActions = {
  copyOtp: true,         // Copy OTP from SMS (default ON)
  copyOtpEmail: true,    // Copy OTP from email (default ON)
  openImages: true,      // Open received images in new tab (default ON)
  openUrls: true,        // Open received URLs in new tab (default ON)
  universalCopy: true,   // Universal Copy text from mobile (default ON)
};

// Load timestamp from storage
chrome.storage.local.get(
  ["lastNotificationTimestamp", "seenNotifications", "badgeCount", "snoozeUntil",
   "smartAction_copyOtp", "smartAction_copyOtpEmail", "smartAction_openImages", "smartAction_openUrls", "smartAction_universalCopy",
   "smartAction_incomingCallPopup", "smartAction_outgoingCallPopup",
  "lastChatPollTimestamp", "seenChatMessageIds", "recentNotificationFingerprints"],
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
    if (result.recentNotificationFingerprints && typeof result.recentNotificationFingerprints === "object") {
      recentNotificationFingerprints = result.recentNotificationFingerprints;
    }
    // Prefer recalculating from cached notifications (same source popup uses)
    // to avoid stale badge values when SW restarts while listeners are idle.
    refreshBadgeFromCachedNotifications(result.badgeCount);
    if (result.snoozeUntil) {
      snoozeUntil = result.snoozeUntil;
    }
    // Load smart action settings (all default ON; stored value overrides)
    if ("smartAction_copyOtp" in result) smartActions.copyOtp = result.smartAction_copyOtp !== false;
    if ("smartAction_copyOtpEmail" in result) smartActions.copyOtpEmail = result.smartAction_copyOtpEmail !== false;
    if ("smartAction_openImages" in result) smartActions.openImages = result.smartAction_openImages !== false;
    if ("smartAction_openUrls" in result) smartActions.openUrls = result.smartAction_openUrls !== false;
    if ("smartAction_universalCopy" in result) smartActions.universalCopy = result.smartAction_universalCopy !== false;
    // Restore chat poll state
    if (result.lastChatPollTimestamp) lastChatPollTimestamp = result.lastChatPollTimestamp;
    if (result.seenChatMessageIds) seenChatMessageIds = new Set(result.seenChatMessageIds);
    // Update snooze title only — menus persist between SW restarts, no need to recreate
    updateSnoozeMenuTitle();
    // Also restore badge display
    updateBadge();
  },
);

// Track whether the popup is currently open. When true, the popup owns the badge
// and the SW should not override it from storage.onChanged (which causes the badge
// to jump back to the SW's stale getLiveUnreadCount() value after the popup sends
// syncBadge with the correct, lower count).
let popupIsOpen = false;

// Keep badge aligned with popup whenever cached notification data changes.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.cached_notifications_data) {
    // Only refresh badge from cache when popup is closed. When popup is open it
    // sends syncBadge with the authoritative count; overriding it here causes the
    // badge to flicker back to the SW's getLiveUnreadCount() (e.g. 20 vs 1).
    if (!popupIsOpen) {
      refreshBadgeFromCachedNotifications();
    }
  }
  // Keep smart action settings in sync
  if (changes.smartAction_copyOtp !== undefined) smartActions.copyOtp = changes.smartAction_copyOtp.newValue !== false;
  if (changes.smartAction_copyOtpEmail !== undefined) smartActions.copyOtpEmail = changes.smartAction_copyOtpEmail.newValue !== false;
  if (changes.smartAction_openImages !== undefined) smartActions.openImages = changes.smartAction_openImages.newValue === true;
  if (changes.smartAction_openUrls !== undefined) smartActions.openUrls = changes.smartAction_openUrls.newValue === true;
  if (changes.smartAction_universalCopy !== undefined) smartActions.universalCopy = changes.smartAction_universalCopy.newValue !== false;
});

// Listen for auth state changes
onAuthStateChanged(auth, async (user) => {
  console.log("ZyncIT: Auth state changed", user ? user.email : "(logged out)");
  if (user) {
    currentUser = user;
    await loadDeviceId();
    await loadLocallyReadNotificationIds();
    console.log("ZyncIT: Starting listeners for user:", user.uid);
    startListening();
    // Keep the offscreen document alive so its 20s heartbeat can wake the SW
    // even when Chrome's 1-min alarm floor would otherwise leave listeners dead.
    ensureOffscreenDocument().catch(() => {});
    // Warm the popup cache immediately so next popup open shows fresh data
    refreshPopupCache();
  } else {
    currentUser = null;
    currentDeviceId = null;
    console.log("ZyncIT: User logged out, stopping listeners");
    // Cleanup all listeners
    unsubscribeNotifications.forEach((unsub) => unsub());
    unsubscribeNotifications = [];
    unreadIdsBySource.clear();
    locallyReadNotificationIds.clear();
    setBadgeCount(0);
  }
});

async function loadLocallyReadNotificationIds() {
  try {
    const result = await chrome.storage.local.get(["cached_notifications_data"]);
    const byDevice = result.cached_notifications_data?.byDevice || {};
    const ids = new Set();
    Object.values(byDevice).forEach((items) => {
      (items || []).forEach((n) => {
        if (n?.read === true && n?.id) ids.add(n.id);
      });
    });
    locallyReadNotificationIds = ids;
  } catch {
    locallyReadNotificationIds = new Set();
  }
}

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
async function startListening(forceRestart = false) {
  refreshContextMenuDevices();
  if (!currentUser) {
    console.log("ZyncIT: Cannot start listening - no user");
    return;
  }

  // Ignore duplicate start requests while listeners are already healthy.
  if (
    !forceRestart &&
    activeListenersUserUid === currentUser.uid &&
    unsubscribeNotifications.length > 0
  ) {
    console.log("ZyncIT: Listeners already active; skipping duplicate start");
    return;
  }

  // Prevent overlapping restarts from auth + popup + alarms racing together.
  if (isStartingListeners) {
    console.log("ZyncIT: Listener start already in progress; skipping");
    return;
  }

  isStartingListeners = true;

  console.log("ZyncIT: Starting real-time listeners...");

  try {
    // Stop previous listeners
    unsubscribeNotifications.forEach((unsub) => unsub());
    unsubscribeNotifications = [];
    unreadIdsBySource.clear();
    // Reset stale badge immediately; snapshot callbacks below will repopulate
    // with current unread counts from Firestore.
    setBadgeCount(0);

    // 1. Listen to user-level notifications (WhatsApp, Telegram, etc.)
    listenToUserNotifications();

    // 2. Chat realtime bridge for instant popup updates + smart actions.
    // Poll remains as backup when realtime listeners are throttled/dropped.
    listenToChatMessages();

    // 3. Get all user devices
    const devicesQuery = query(
      collection(db, "devices"),
      where("userId", "==", currentUser.uid),
    );

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
    activeListenersUserUid = currentUser.uid;
  } catch (error) {
    console.error("ZyncIT: Error getting devices:", error);
  } finally {
    isStartingListeners = false;
  }
}

// Listen to chat messages for smart actions (open images, universal copy)
const PENDING_CHAT_PUSHES_KEY = "pendingChatPushes";

function toChatTimestampMs(ts) {
  if (typeof ts === "number") return ts;
  if (ts && typeof ts.toMillis === "function") {
    try {
      return ts.toMillis();
    } catch (_) {}
  }
  if (ts && typeof ts.seconds === "number") {
    const nanos = typeof ts.nanoseconds === "number" ? ts.nanoseconds : 0;
    return ts.seconds * 1000 + Math.floor(nanos / 1e6);
  }
  return 0;
}

async function enqueuePendingChatPush(message) {
  try {
    const result = await chrome.storage.local.get([PENDING_CHAT_PUSHES_KEY]);
    const existing = Array.isArray(result[PENDING_CHAT_PUSHES_KEY])
      ? result[PENDING_CHAT_PUSHES_KEY]
      : [];
    const now = Date.now();
    const normalized = {
      ...message,
      timestamp: toChatTimestampMs(message?.timestamp),
      _queuedAt: now,
    };
    const dedup = new Map();
    [...existing, normalized].forEach((item) => {
      if (!item?.id) return;
      // Keep only recent queued pushes to avoid unbounded growth.
      if ((item._queuedAt || now) < now - 10 * 60 * 1000) return;
      dedup.set(item.id, item);
    });
    const compact = [...dedup.values()].slice(-300);
    await chrome.storage.local.set({ [PENDING_CHAT_PUSHES_KEY]: compact });
  } catch (_) {}
}

function pushChatToPopup(message) {
  if (!message?.id) return;
  const normalized = {
    ...message,
    timestamp: toChatTimestampMs(message.timestamp),
  };
  chrome.runtime.sendMessage({ type: "newChat", data: normalized }).catch(() => {});
  enqueuePendingChatPush(normalized).catch(() => {});
}

function listenToChatMessages() {
  if (!currentUser) return;

  let isFirstChatSnapshot = true;
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  const q = query(
    collection(db, "chats"),
    where("participants", "array-contains", currentUser.uid),
    orderBy("timestamp", "desc"),
    limit(50),
  );

  const unsub = onSnapshot(q, (snapshot) => {
    if (isFirstChatSnapshot) {
      isFirstChatSnapshot = false;
      // On first load, process very recent messages that arrived while SW was inactive
      snapshot.docs.forEach((d) => {
        // Skip messages already handled in a previous SW lifetime.
        if (seenChatMessageIds.has(d.id)) return;
        seenChatMessageIds.add(d.id);
        const msg = d.data();
        const ts =
          typeof msg.timestamp === "number"
            ? msg.timestamp
            : typeof msg.timestamp?.toMillis === "function"
              ? msg.timestamp.toMillis()
              : 0;
        if (ts < fiveMinutesAgo) return;
        pushChatToPopup({ id: d.id, ...msg });
        // Smart actions are only for messages received from other devices.
        if (msg.senderPlatform === "chrome-extension") return;
        if ((msg.senderDeviceId || "").startsWith("ext_")) return;
        processChatMessageSmartActions(msg);
      });
      return;
    }

    snapshot.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const docId = change.doc.id;
      if (seenChatMessageIds.has(docId)) return;
      seenChatMessageIds.add(docId);

      const msg = change.doc.data();
      pushChatToPopup({ id: docId, ...msg });
      // Smart actions are only for messages received from other devices.
      if (msg.senderPlatform === "chrome-extension") return;
      if ((msg.senderDeviceId || "").startsWith("ext_")) return;
      processChatMessageSmartActions(msg);
    });

    const seenArray = Array.from(seenChatMessageIds).slice(-500);
    chrome.storage.local.set({ seenChatMessageIds: seenArray });
  }, (error) => {
    if (error?.code === "permission-denied") return;
    console.error("ZyncIT: Chat listener error:", error);
  });

  unsubscribeNotifications.push(unsub);
}

// Dedupe map: URL/fileUrl → timestamp. Prevents re-opening the same target
// when mobile sends one chat doc per recipient device (e.g. "Send to All Devices").
const recentlyOpened = new Map();
const DEDUPE_WINDOW_MS = 30 * 1000;
function shouldOpen(target) {
  if (!target) return false;
  const now = Date.now();
  // Cleanup expired entries
  for (const [k, t] of recentlyOpened) {
    if (now - t > DEDUPE_WINDOW_MS) recentlyOpened.delete(k);
  }
  if (recentlyOpened.has(target)) return false;
  recentlyOpened.set(target, now);
  return true;
}

function processChatMessageSmartActions(msg, freshSettings) {
  const uid = currentUser?.uid;
  const sa = freshSettings || smartActions;

  // Open received images in a new tab (fileUrl may also be encrypted)
  if (sa.openImages && msg.type === "image" && msg.fileUrl) {
    decrypt(msg.fileUrl, uid).then((url) => {
      const safeUrl = url && url.startsWith("http") ? url : null;
      if (safeUrl && shouldOpen(safeUrl)) {
        console.log("ZyncIT: 🖼️ Opening received image:", safeUrl);
        chrome.tabs.create({ url: safeUrl, active: false }).catch(() => {});
      }
    }).catch(() => {});
    return; // image handled
  }

  // For text messages: decrypt content first, then apply smart actions
  if (msg.type === "text" && msg.content) {
    decrypt(msg.content, uid).then((content) => {
      if (!content) return;

      // Open URLs from chat text
      if (sa.openUrls) {
        const urlMatch = content.match(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i);
        if (urlMatch) {
          const href = urlMatch[1].startsWith("http") ? urlMatch[1] : `https://${urlMatch[1]}`;
          if (shouldOpen(href)) {
            console.log("ZyncIT: 🔗 Opening received URL from chat:", href);
            chrome.tabs.create({ url: href, active: false }).catch(() => {});
          }
        }
      }

      // Universal Copy (dedupe by full content)
      if (sa.universalCopy && shouldOpen("copy:" + content)) {
        sendTextToClipboard(content);
      }
    }).catch(() => {});
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
      const unreadIds = new Set(
        snapshot.docs
          .filter((docSnap) => !docSnap.data()?.read && !locallyReadNotificationIds.has(docSnap.id))
          .map((docSnap) => docSnap.id),
      );
      setUnreadIdsForSource("_user_notifications", unreadIds);

      console.log(
        "ZyncIT: User notifications snapshot - changes:",
        snapshot.docChanges().length,
        "- total:",
        snapshot.size,
        "- isFirstSnapshot:",
        isFirstSnapshot,
      );

      // Process the initial snapshot: show any recent notifications that
      // arrived while the service worker was inactive (Chrome MV3 service
      // workers are terminated after ~30 s of inactivity, so notifications
      // written to Firestore during that gap would otherwise be swallowed by
      // the "mark all as seen" logic and never displayed).
      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        snapshot.docs.forEach((doc) => {
          const docId = doc.id;
          const notification = doc.data();
          const notificationTime =
            notification.timestamp ||
            notification.createdAt?.toMillis?.() ||
            Date.now();
          const timeDiff = Date.now() - notificationTime;

          // Skip only if we've already shown this exact doc AND the doc
          // timestamp is NOT newer than the last notification we processed.
          // Android apps (e.g. Gmail) reuse notification IDs, so the same
          // docId can appear in seenNotifications but refer to a different
          // (newer) email — we must show it in that case.
          if (seenNotifications.has(docId) && notificationTime <= lastNotificationTimestamp) {
            return;
          }

          seenNotifications.add(docId); // always mark as seen
          seenNotifications.add(`${docId}_${notificationTime}`); // pre-mark modified dedup key
          if (timeDiff < 5 * 60 * 1000) {
            // Missed while SW was inactive — show as catch-up notification.
            console.log(
              "ZyncIT: 🔔 Catch-up user notification:",
              notification.title,
              "age:",
              Math.round(timeDiff / 1000),
              "s",
            );
            if (notificationTime > lastNotificationTimestamp) {
              lastNotificationTimestamp = notificationTime;
            }
            showNotification(notification);
            // Also push to popup so the Notifications tab updates without waiting
            // for the 5-minute cache refresh cycle.
            chrome.runtime.sendMessage({ type: "newNotification", data: { ...notification, id: docId, deviceId: notification.deviceId || "user" } }).catch(() => {});
          }
        });
        console.log(
          "ZyncIT: Initial load - marked",
          snapshot.size,
          "notifications as seen",
        );
        const seenArray = Array.from(seenNotifications).slice(-1000);
        chrome.storage.local.set({ seenNotifications: seenArray, lastNotificationTimestamp });
        return;
      }

      snapshot.docChanges().forEach((change) => {
        // Only process "added" events — "modified" events are Android re-fires of
        // the same notification with a different postTime, not new notifications.
        // All docIds are minute-bucketed so new messages always produce new added events.
        if (change.type === "added") {
          const notification = change.doc.data();
          const docId = change.doc.id;
          const notificationTime =
            notification.timestamp ||
            notification.createdAt?.toMillis?.() ||
            Date.now();

          const seenKey = docId;

          console.log(
            `ZyncIT: 🆕 ${change.type.toUpperCase()} notification - time:`,
            new Date(notificationTime).toLocaleString(),
            "docId:",
            docId,
          );

          // Skip if already seen
          if (seenNotifications.has(seenKey)) {
            console.log("ZyncIT: Skipping already seen notification:", seenKey);
            return;
          }

          // Add to seen list
          seenNotifications.add(seenKey);

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

          // OTP detection from email/app notifications
          const uid = currentUser?.uid;
          Promise.all([
            decrypt(notification.title || notification.contactName || "", uid),
            decrypt(notification.body || notification.text || notification.content || "", uid),
          ]).then(([decTitle, decBody]) => {
            const combined = `${decTitle} ${decBody}`;

            // Copy OTP
            if (smartActions.copyOtp) {
              const otp = extractOTP(combined);
              if (otp) {
                const pkg = notification.packageName || notification.appPackage || "";
                const appName = notification.appName || notification.app || "";
                console.log("ZyncIT: 🔑 OTP detected from user notification:", otp, "app:", appName || pkg);
                const isEmail = /mail|email|gmail|outlook/i.test(pkg) || /mail|email|gmail|outlook/i.test(appName);
                // Skip email OTPs when the email OTP setting is disabled
                if (isEmail && !smartActions.copyOtpEmail) return;
                const notifId = `iropit_otp_user_${Date.now()}`;
                createNotificationIfNotSnoozed(notifId, {
                  type: "basic",
                  iconUrl: chrome.runtime.getURL("assets/icon128.png"),
                  title: isEmail ? `Email OTP from ${appName || "Email"}` : `OTP from ${appName || decTitle}`,
                  message: `${otp} — Copied to clipboard`,
                  priority: 2,
                });
                sendOTPToActiveTab(otp, appName || decTitle, decBody);
              }
            }
          }).catch(() => {});

          // Send update to popup
          chrome.runtime
            .sendMessage({
              type: "newNotification",
              data: { ...notification, id: docId, deviceId: notification.deviceId || "user" },
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
      if (!unreadIdsBySource.has(deviceId)) {
        // First time we've seen this device: initialize from the full window of docs.
        const unreadIds = new Set(
          snapshot.docs
            .filter((docSnap) => !docSnap.data()?.read && !locallyReadNotificationIds.has(docSnap.id))
            .map((docSnap) => docSnap.id),
        );
        setUnreadIdsForSource(deviceId, unreadIds);
      } else {
        // Subsequent snapshots: update incrementally so that new unread notifications
        // always raise the badge even when the limit(50) window evicts an old unread doc.
        const currentUnreadIds = new Set(unreadIdsBySource.get(deviceId) || []);
        snapshot.docChanges().forEach((change) => {
          const docId = change.doc.id;
          const data = change.doc.data();
          if (change.type === "added") {
            if (!data?.read && !locallyReadNotificationIds.has(docId)) {
              currentUnreadIds.add(docId);
            }
          } else if (change.type === "modified") {
            if (data?.read || locallyReadNotificationIds.has(docId)) {
              currentUnreadIds.delete(docId);
            } else {
              currentUnreadIds.add(docId);
            }
          } else if (change.type === "removed") {
            currentUnreadIds.delete(docId);
          }
        });
        setUnreadIdsForSource(deviceId, currentUnreadIds);
      }

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

      // Process the initial snapshot: show any recent notifications that
      // arrived while the service worker was inactive (Chrome MV3 SW lifecycle).
      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        snapshot.docs.forEach((doc) => {
          const docId = doc.id;
          const notification = doc.data();
          const docTimestamp =
            notification.timestamp || notification.receivedAt || Date.now();
          const timeDiff = Date.now() - docTimestamp;

          // Skip only if we've already shown this exact doc AND the doc
          // timestamp is NOT newer than the last notification we processed.
          // Android apps (e.g. Gmail) reuse notification IDs, so the same
          // docId can appear in seenNotifications but refer to a different
          // (newer) email — we must show it in that case.
          if (seenNotifications.has(docId) && docTimestamp <= lastNotificationTimestamp) {
            return;
          }

          seenNotifications.add(docId); // always mark as seen
          seenNotifications.add(`${docId}_${docTimestamp}`); // pre-mark modified dedup key
          if (timeDiff < 5 * 60 * 1000) {
            // Missed while SW was inactive — show as catch-up notification.
            console.log(
              "ZyncIT: 🔔 Catch-up from",
              deviceName,
              ":",
              notification.title,
              "age:",
              Math.round(timeDiff / 1000),
              "s",
            );
            if (docTimestamp > lastNotificationTimestamp) {
              lastNotificationTimestamp = docTimestamp;
            }
            showNotification({ ...notification, deviceName });
            // Also push to popup so the Notifications tab updates without waiting
            // for the 5-minute cache refresh cycle.
            chrome.runtime.sendMessage({ type: "newNotification", data: { ...notification, id: docId, deviceId, deviceName } }).catch(() => {});
          }
        });
        console.log(
          "ZyncIT: Initial load for",
          deviceName,
          "- marked",
          snapshot.size,
          "notifications as seen",
        );
        const seenArray = Array.from(seenNotifications).slice(-500);
        chrome.storage.local.set({ seenNotifications: seenArray, lastNotificationTimestamp });
        return;
      }

      snapshot.docChanges().forEach((change) => {
        console.log(
          "ZyncIT: Change type:",
          change.type,
          "docId:",
          change.doc.id,
        );

        // Process "added" and "modified" events. WhatsApp (and other chat apps)
        // reuse the same docId for multiple messages in the same chat within a
        // minute bucket, so a new message arrives as a "modified" event, not
        // "added". We use a timestamp-aware dedup key (docId_timestamp) so a
        // genuinely new message (newer timestamp) is shown, while a noise re-fire
        // of the exact same notification (same timestamp) is skipped.
        if (change.type === "added" || change.type === "modified") {
          const notification = change.doc.data();
          const docId = change.doc.id;
          const docTimestamp =
            notification.timestamp || notification.receivedAt || Date.now();

          const notificationTime = docTimestamp;

          const seenKey = `${docId}_${docTimestamp}`;

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

          // Skip if already seen (exact same notification + timestamp)
          if (seenNotifications.has(seenKey)) {
            console.log("ZyncIT: ⏭️ Skipping already seen:", seenKey);
            return;
          }

          // Skip if this is just a read-status update (modified to read=true),
          // not a new incoming message.
          if (notification.read === true) {
            console.log("ZyncIT: ⏭️ Skipping read-status update:", docId);
            seenNotifications.add(seenKey);
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

          // Mark as seen (both composite key and plain docId for catch-up dedup)
          seenNotifications.add(seenKey);
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

          // OTP detection from email/app notifications
          const uid = currentUser?.uid;
          Promise.all([
            decrypt(notification.title || notification.contactName || "", uid),
            decrypt(notification.body || notification.text || notification.content || "", uid),
          ]).then(([decTitle, decBody]) => {
            const combined = `${decTitle} ${decBody}`;

            // Copy OTP
            if (smartActions.copyOtp) {
              const otp = extractOTP(combined);
              if (otp) {
                const pkg = notification.packageName || notification.appPackage || "";
                const appName = notification.appName || notification.app || "";
                console.log("ZyncIT: 🔑 OTP detected from device notification:", otp, "app:", appName || pkg);
                const isEmail = /mail|email|gmail|outlook/i.test(pkg) || /mail|email|gmail|outlook/i.test(appName);
                // Skip email OTPs when the email OTP setting is disabled
                if (isEmail && !smartActions.copyOtpEmail) return;
                const notifId = `iropit_otp_dev_${Date.now()}`;
                createNotificationIfNotSnoozed(notifId, {
                  type: "basic",
                  iconUrl: chrome.runtime.getURL("assets/icon128.png"),
                  title: isEmail ? `Email OTP from ${appName || "Email"}` : `OTP from ${appName || decTitle}`,
                  message: `${otp} — Copied to clipboard`,
                  priority: 2,
                });
                sendOTPToActiveTab(otp, appName || decTitle, decBody);
              }
            }
          }).catch(() => {});

          // Send update to popup
          chrome.runtime
            .sendMessage({
              type: "newNotification",
              data: { ...notification, id: docId, deviceId, deviceName },
            })
            .catch(() => {
              // Popup may not be open, ignore error
            });
        }
      });
    },
    (error) => {
      if (error?.code === "permission-denied") return;
      console.error(
        "ZyncIT: Firestore listener error for device",
        deviceId,
        ":",
        error,
      );
    },
  );

  unsubscribeNotifications.push(unsub);

  // Also listen for live ringing calls and completed calls/SMS from this device
  listenForRingingCallFromDevice(deviceId, deviceName);
  listenForOutgoingCallFromDevice(deviceId, deviceName);
  listenForCallsFromDevice(deviceId, deviceName);
  listenForSMSFromDevice(deviceId, deviceName);
}

// ── Incoming call popup window + notification ────────────────────────────────

/**
 * Listen for the live ringing_call document for a device.
 * When set (status === "ringing") → open a real Chrome popup window AND a system notification.
 * When deleted → close popup + clear notification.
 */
// Track active incoming-call popup window IDs per device
const incomingCallWindowIds = new Map(); // deviceId → windowId
const incomingCallLastKey = new Map(); // deviceId → "phone|contact|timestamp"
const incomingCallLastTs = new Map(); // deviceId → last processed ringing_call timestamp
const incomingCallRunSeq = new Map(); // deviceId → latest async processing sequence
// Track active incoming-call notification IDs per device (fallback)
const incomingCallNotifIds = new Map(); // deviceId → notificationId
const incomingCallNotifKeys = new Map(); // deviceId → last notification call key

function clearIncomingCallNotificationsForDevice(deviceId, keepId) {
  const prefix = `iropit_incoming_call_${deviceId}`;
  try {
    chrome.notifications.getAll((items) => {
      Object.keys(items || {}).forEach((id) => {
        if (!id.startsWith(prefix)) return;
        if (keepId && id === keepId) return;
        try { chrome.notifications.clear(id); } catch (_) {}
      });
    });
  } catch (_) {}
}

async function closeIncomingCallPopupWindowsForDevice(deviceId, keepWindowId) {
  try {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] });
    const marker = `deviceId=${encodeURIComponent(deviceId)}`;
    for (const win of windows || []) {
      if (!win?.id) continue;
      if (keepWindowId && win.id === keepWindowId) continue;
      const tabs = win.tabs || [];
      const hasIncomingForDevice = tabs.some((tab) => {
        const url = tab?.url || "";
        return url.includes("/popup/incoming-call.html") && url.includes(marker);
      });
      if (!hasIncomingForDevice) continue;
      try { await chrome.windows.remove(win.id); } catch (_) {}
    }
  } catch (_) {}
}

/**
 * Normalize a phone number for cross-format matching.
 * Strips all non-digits, then keeps the last 9 digits (covers most
 * country-code variations: +14432566519 → 432566519).
 */
function normalizePhoneForMatch(phone) {
  if (!phone || typeof phone !== "string") return "";
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 9 ? digits.slice(-9) : digits;
}

/**
 * Look up a contact name for the given phone number.
 * Strategy:
 *   1. Search the originating device's contacts subcollection in Firestore.
 *   2. Fall back to the locally cached calls (chrome.storage.local) so that
 *      previously seen callers are recognised even if the contact wasn't
 *      synced from the phonebook.
 *   3. Finally check the cached SMS data for a matching sender.
 * Returns "" if nothing matches.
 */
async function lookupContactNameByPhone(deviceId, phone) {
  if (!phone || !currentUser) return "";
  const target = normalizePhoneForMatch(phone);
  if (!target) return "";
  // Short codes / emergency numbers (≤ 4 digits) are not real contacts —
  // skip lookup to avoid false matches from call/SMS history.
  if (target.length <= 4) return "";

  // 1) Device's contacts subcollection
  try {
    const contactsRef = collection(
      db,
      "users", currentUser.uid,
      "devices", deviceId,
      "contacts",
    );
    const snap = await getDocs(contactsRef);
    let match = "";
    snap.forEach((d) => {
      if (match) return;
      const data = d.data() || {};
      const candidates = [];
      if (Array.isArray(data.phoneNumbers)) candidates.push(...data.phoneNumbers);
      if (data.phoneNumber) candidates.push(data.phoneNumber);
      for (const p of candidates) {
        if (!p || typeof p !== "string") continue;
        if (normalizePhoneForMatch(p) === target) {
          match = data.name || "";
          break;
        }
      }
    });
    if (match) return match;
  } catch (e) {
    // ignore
  }

  // Only Firestore contacts are authoritative — cached call/SMS history can
  // contain stale or wrong name associations, so we do not fall back to them.
  return "";
}

// Debounce rapid-fire ringing_call snapshots. The phone overwrites the single
// ringing_call/current doc several times within ~25ms (dial → resolve contact
// name → SIM, sometimes two calls back-to-back). Without debouncing, multiple
// async handlers interleave and the popup vs the Chrome notification end up
// built from DIFFERENT snapshots — showing two different callers. We collect the
// newest snapshot and process it exactly ONCE after a short quiet period so the
// popup and the notification are always built from the SAME final state.
const incomingCallPending = new Map();        // deviceId → { data, docTs }
const incomingCallDebounceTimers = new Map(); // deviceId → timeout id
const INCOMING_CALL_DEBOUNCE_MS = 300;

function listenForRingingCallFromDevice(deviceId, deviceName) {
  if (!currentUser) return;

  console.log("ZyncIT: 📞 Setting up ringing_call listener for device:", deviceId, deviceName);

  const ringingDocRef = doc(
    db,
    "users", currentUser.uid,
    "devices", deviceId,
    "ringing_call", "current",
  );

  const unsub = onSnapshot(
    ringingDocRef,
    (snap) => {
      console.log("ZyncIT: 📞 ringing_call snapshot — exists:", snap.exists(), "device:", deviceId);

      // Doc deleted or no longer ringing → clean up immediately (no debounce).
      if (!snap.exists()) {
        handleRingingCallCleanup(deviceId);
        return;
      }

      const data = snap.data();
      if (data.status !== "ringing") {
        handleRingingCallCleanup(deviceId);
        return;
      }

      const docTs = typeof data.timestamp === "number" ? data.timestamp : 0;
      // Reject clearly stale docs (mobile failed to clear a previous call).
      if (docTs > 0 && Date.now() - docTs > 60_000) {
        console.warn(
          "ZyncIT: 📞 Ignoring stale ringing_call doc — age:",
          Math.round((Date.now() - docTs) / 1000),
          "s",
        );
        return;
      }

      // Keep only the NEWEST snapshot as the pending state. An older snapshot
      // arriving after a newer one (Firestore cache replay) is ignored.
      const pending = incomingCallPending.get(deviceId);
      if (pending && docTs > 0 && pending.docTs > docTs) {
        console.log("ZyncIT: 📞 Ignoring out-of-order ringing snapshot — docTs:", docTs, "pendingTs:", pending.docTs);
        return;
      }
      incomingCallPending.set(deviceId, { data, docTs });

      // (Re)start the debounce timer; process only after snapshots settle so
      // popup + notification are built once, from the same final caller.
      const prevTimer = incomingCallDebounceTimers.get(deviceId);
      if (prevTimer) clearTimeout(prevTimer);
      incomingCallDebounceTimers.set(deviceId, setTimeout(() => {
        incomingCallDebounceTimers.delete(deviceId);
        const latest = incomingCallPending.get(deviceId);
        if (!latest) return;
        processRingingCall(deviceId, deviceName, latest.data, latest.docTs)
          .catch((e) => console.error("ZyncIT: 📞 processRingingCall error:", e));
      }, INCOMING_CALL_DEBOUNCE_MS));
    },
    (error) => {
      if (error?.code === "permission-denied") {
        console.warn("ZyncIT: 📞 Permission denied for ringing_call on device:", deviceId);
        return;
      }
      console.error("ZyncIT: Ringing call listener error for device", deviceId, ":", error);
    },
  );

  unsubscribeNotifications.push(unsub);
}

/**
 * Process a single, settled ringing_call state. Builds the popup AND the system
 * notification from the SAME data object so the two can never diverge.
 */
async function processRingingCall(deviceId, deviceName, data, docTs) {
  const uid = currentUser?.uid;
  if (!uid) return;

  // Decrypt phone + contact for this (final) snapshot.
  const phoneRaw = data.phoneNumber || "";
  const phone = await decrypt(phoneRaw, uid).catch(() => phoneRaw);

  if (!phone) {
    console.log("ZyncIT: 📞 No phone number in ringing_call doc (likely VoIP/Meet) — clearing stale call UI");
    // Prevent stale PSTN caller popups/toasts from staying visible when the
    // device reports a non-telephony ringing event without a phone number.
    handleRingingCallCleanup(deviceId);
    return;
  }

  const contactRaw = data.contactName || "";
  let contact = contactRaw ? await decrypt(contactRaw, uid).catch(() => contactRaw) : "";
  if (!contact || contact.startsWith("ENC:") || contact === phone) contact = "";
  if (!contact) {
    try {
      const resolved = await lookupContactNameByPhone(deviceId, phone);
      if (resolved && resolved !== phone) {
        contact = resolved;
        console.log("ZyncIT: 📞 Resolved contact from local lookup:", contact);
      }
    } catch (e) {
      console.warn("ZyncIT: 📞 Contact lookup failed:", e);
    }
  }

  // If a NEWER snapshot arrived while we were decrypting/looking up, abandon this
  // run — the debounce for the newer state will rebuild BOTH popup + notification.
  const stillLatest = incomingCallPending.get(deviceId);
  if (stillLatest && docTs > 0 && stillLatest.docTs > docTs) {
    console.log("ZyncIT: 📞 Newer ringing snapshot arrived during processing — abandoning stale run");
    return;
  }

  // Skip if we've already rendered this exact ringing event.
  const callKey = `${phone}|${Math.round((docTs || Date.now()) / 5000)}`;
  if (incomingCallLastKey.get(deviceId) === callKey) {
    console.log("ZyncIT: 📞 Same ringing event — already shown, skipping");
    return;
  }
  incomingCallLastKey.set(deviceId, callKey);
  incomingCallLastTs.set(deviceId, docTs);

  const deviceLabel = deviceName || data.deviceName || "Android Device";
  const simSlot = data.simSlot;
  const simLabel = (simSlot === 0 || simSlot === 1) ? `SIM ${simSlot + 1}` : "SIM";
  const callerLine = contact ? `${contact} • ${phone}` : (phone || "Unknown");
  const subtitle = `${deviceLabel} • ${simLabel}`;

  // ── System notification FIRST (synchronous — cannot be reordered) ─────────
  const notificationId = `iropit_incoming_call_${deviceId}_${docTs || Date.now()}`;
  incomingCallNotifIds.set(deviceId, notificationId);
  incomingCallNotifKeys.set(deviceId, callKey);
  clearIncomingCallNotificationsForDevice(deviceId, notificationId);

  if (isSnoozed()) {
    console.log("ZyncIT: 🔕 Incoming call notification suppressed (snoozed):", callerLine);
  } else {
    chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon128.png"),
      title: `📞 Incoming call: ${callerLine}`,
      message: subtitle,
      contextMessage: subtitle,
      priority: 2,
      requireInteraction: true,
      silent: false,
    }, (createdId) => {
      console.log("ZyncIT: ✅ Incoming call notification created:", createdId);
    });
  }

  // ── Popup window (built from the SAME data object) ────────────────────────
  const { smartAction_incomingCallPopup } = await chrome.storage.local.get("smartAction_incomingCallPopup");
  const popupEnabled = smartAction_incomingCallPopup !== false; // default ON
  if (!popupEnabled) return;

  // Abandon opening the popup if a newer ring superseded this state.
  const stillLatest2 = incomingCallPending.get(deviceId);
  if (stillLatest2 && docTs > 0 && stillLatest2.docTs > docTs) return;

  const params = new URLSearchParams({
    contact: contact || "Unknown",
    phone: phone || "",
    device: deviceLabel,
    deviceId,
    sim: String(simSlot ?? -1),
  });
  const url = chrome.runtime.getURL(`popup/incoming-call.html?${params}`);
  console.log("ZyncIT: 📞 Opening popup window:", url);

  // Close any tracked + orphan incoming popups for this device first.
  const existingWindowId = incomingCallWindowIds.get(deviceId);
  if (existingWindowId) {
    try { await chrome.windows.remove(existingWindowId); } catch (_) {}
    incomingCallWindowIds.delete(deviceId);
  }
  await closeIncomingCallPopupWindowsForDevice(deviceId);

  try {
    const win = await chrome.windows.create({
      url, type: "popup", width: 360, height: 360, focused: true, top: 80, left: 80,
    });
    if (win?.id) {
      // If superseded while opening, close this now-stale popup.
      const latestNow = incomingCallPending.get(deviceId);
      if (latestNow && docTs > 0 && latestNow.docTs > docTs) {
        try { await chrome.windows.remove(win.id); } catch (_) {}
        return;
      }
      incomingCallWindowIds.set(deviceId, win.id);
      console.log("ZyncIT: ✅ Popup window opened — id:", win.id);
      const onRemoved = (removedId) => {
        if (removedId === win.id) {
          incomingCallWindowIds.delete(deviceId);
          chrome.windows.onRemoved.removeListener(onRemoved);
        }
      };
      chrome.windows.onRemoved.addListener(onRemoved);
    }
  } catch (e) {
    console.error("ZyncIT: ❌ Could not open popup window:", e);
  }
}

/** Tear down popup + notification + all per-device ringing state. */
function handleRingingCallCleanup(deviceId) {
  const prevTimer = incomingCallDebounceTimers.get(deviceId);
  if (prevTimer) { clearTimeout(prevTimer); incomingCallDebounceTimers.delete(deviceId); }
  incomingCallPending.delete(deviceId);
  incomingCallLastKey.delete(deviceId);
  incomingCallLastTs.delete(deviceId);
  incomingCallRunSeq.delete(deviceId);
  incomingCallNotifKeys.delete(deviceId);
  clearIncomingCallNotificationsForDevice(deviceId);

  const windowId = incomingCallWindowIds.get(deviceId);
  if (windowId) {
    incomingCallWindowIds.delete(deviceId);
    chrome.windows.remove(windowId)
      .then(() => console.log("ZyncIT: 📞 Closed popup window for device:", deviceId))
      .catch(() => {});
  }
  closeIncomingCallPopupWindowsForDevice(deviceId);

  const notifId = incomingCallNotifIds.get(deviceId);
  if (notifId) {
    incomingCallNotifIds.delete(deviceId);
    try {
      chrome.notifications.clear(notifId);
      console.log("ZyncIT: 📞 Cleared incoming call notification for device:", deviceId);
    } catch (_) {}
  }
}

// ── Outgoing call popup window + notification ─────────────────────────────────

// Track active outgoing-call popup window IDs per device
const outgoingCallWindowIds = new Map(); // deviceId → windowId
const outgoingCallLastTs = new Map();    // deviceId → last-seen doc timestamp
const outgoingCallNotifIds = new Map();  // deviceId → notificationId
const outgoingCallShown = new Set();     // deviceIds with an active call already popped up

function listenForOutgoingCallFromDevice(deviceId, deviceName) {
  if (!currentUser) return;

  console.log("ZyncIT: 📲 Setting up outgoing_call listener for device:", deviceId, deviceName);

  const outgoingDocRef = doc(
    db,
    "users", currentUser.uid,
    "devices", deviceId,
    "outgoing_call", "current",
  );

  const unsub = onSnapshot(
    outgoingDocRef,
    async (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        console.log("ZyncIT: 📲 outgoing_call doc received:", deviceId, "status=", data.status, "hasPhone=", !!data.phoneNumber, "hasContact=", !!data.contactName);
        if (data.status === "dialing" || data.status === "started") {
          const docTs = typeof data.timestamp === "number" ? data.timestamp : 0;
          if (docTs > 0 && Date.now() - docTs > 60_000) {
            console.warn("ZyncIT: 📲 Ignoring stale outgoing_call doc");
            return;
          }

          const uid = currentUser.uid;
          const phoneRaw = data.phoneNumber || "";
          const phone = await decrypt(phoneRaw, uid).catch(() => phoneRaw);
          const contactRaw = data.contactName || "";
          let contact = contactRaw ? await decrypt(contactRaw, uid).catch(() => contactRaw) : "";
          if (!contact || contact.startsWith("ENC:") || contact === phone) contact = "";

          if (!contact && phone) {
            try {
              const resolved = await lookupContactNameByPhone(deviceId, phone);
              if (resolved && resolved !== phone) contact = resolved;
            } catch (_) {}
          }

          // Don't show popup if mobile didn't send a phone number
          if (!phone) {
            console.log("ZyncIT: 📲 Skipping popup — no phone number in outgoing_call doc");
            return;
          }

          const deviceLabel = deviceName || data.deviceName || "Android Device";
          const simSlot = data.simSlot;
          const simLabel = (simSlot === 0 || simSlot === 1) ? `SIM ${simSlot + 1}` : "SIM";
          const callerLine = contact ? `${contact} • ${phone}` : (phone || "Unknown");
          const subtitle = `${deviceLabel} • ${simLabel}`;

          const { smartAction_outgoingCallPopup } = await chrome.storage.local.get("smartAction_outgoingCallPopup");
          const popupEnabled = smartAction_outgoingCallPopup !== false; // default ON

          // Dedup by doc timestamp instead of phone|contact — on Android 10+
          // outgoing calls often have empty phone, so two consecutive calls
          // would collide on "|" and the old popup would never refresh.
          if (outgoingCallLastTs.get(deviceId) === docTs) return;
          outgoingCallLastTs.set(deviceId, docTs);

          const openPopup = async () => {
            const params = new URLSearchParams({
              contact: contact || "Unknown",
              phone: phone || "",
              device: deviceLabel,
              sim: String(simSlot ?? -1),
            });
            const url = chrome.runtime.getURL(`popup/outgoing-call.html?${params}`);
            try {
              const win = await chrome.windows.create({
                url, type: "popup", width: 360, height: 360,
                focused: true, top: 80, left: 80,
              });
              if (win?.id) {
                outgoingCallShown.add(deviceId); // mark shown only AFTER the window actually opens
                outgoingCallWindowIds.set(deviceId, win.id);
                console.log("ZyncIT: 📲 ✅ Outgoing-call popup window opened for", deviceId, "win=", win.id);
                const onRemoved = (removedId) => {
                  if (removedId === win.id) {
                    outgoingCallWindowIds.delete(deviceId);
                    chrome.windows.onRemoved.removeListener(onRemoved);
                  }
                };
                chrome.windows.onRemoved.addListener(onRemoved);
              }
            } catch (e) {
              console.error("ZyncIT: ❌ Could not open outgoing popup window:", e);
            }
          };

          // Open the popup ONCE per active call. When dialing a saved contact the
          // Android app writes the outgoing_call doc twice (dial, then again after
          // resolving the contact name) with a new timestamp — the second write
          // must NOT close+reopen (or close after a manual dismiss) the popup,
          // which previously caused it to flicker/fail ~90% for known contacts.
          // The popup is closed only when the call doc is deleted (call ends).
          // NOTE: outgoingCallShown is added INSIDE openPopup() only after the
          // window successfully opens — so a blocked/failed open can retry on the
          // next snapshot instead of being permanently suppressed by a pre-set flag.
          if (popupEnabled && !outgoingCallShown.has(deviceId)) {
            await openPopup();
          } else {
            console.log("ZyncIT: 📲 Popup not opened — popupEnabled=", popupEnabled, "alreadyShown=", outgoingCallShown.has(deviceId));
          }

          if (!outgoingCallNotifIds.has(deviceId)) {
            const notificationId = `iropit_outgoing_call_${deviceId}_${Date.now()}`;
            outgoingCallNotifIds.set(deviceId, notificationId);
            createNotificationIfNotSnoozed(notificationId, {
              type: "basic",
              iconUrl: chrome.runtime.getURL("assets/icon128.png"),
              title: `📲 Outgoing call: ${callerLine}`,
              message: subtitle,
              contextMessage: subtitle,
              priority: 2,
              requireInteraction: true,
              silent: true,
            }, (createdId) => {
              console.log("ZyncIT: ✅ Outgoing call notification created:", createdId);
            });
          }
        }
      } else {
        outgoingCallLastTs.delete(deviceId);
        outgoingCallShown.delete(deviceId);
        const windowId = outgoingCallWindowIds.get(deviceId);
        if (windowId) {
          outgoingCallWindowIds.delete(deviceId);
          try { await chrome.windows.remove(windowId); } catch (_) {}
        }
        const notifId = outgoingCallNotifIds.get(deviceId);
        if (notifId) {
          outgoingCallNotifIds.delete(deviceId);
          try { chrome.notifications.clear(notifId); } catch (_) {}
        }
      }
    },
    (error) => {
      if (error?.code === "permission-denied") {
        console.warn("ZyncIT: 📲 Permission denied for outgoing_call on device:", deviceId, "— retrying in 10s");
        // Self-heal: Firestore tears down the listener on permission-denied, so it
        // never recovers even after rules are fixed server-side. Retry after a delay.
        setTimeout(() => {
          if (currentUser) listenForOutgoingCallFromDevice(deviceId, deviceName);
        }, 10000);
        return;
      }
      console.error("ZyncIT: Outgoing call listener error for device", deviceId, ":", error);
    },
  );

  unsubscribeNotifications.push(unsub);
}

// Listen for calls from a specific device
function listenForCallsFromDevice(deviceId, deviceName) {
  if (!currentUser) return;

  // MUST include orderBy("timestamp","desc") so limit(10) targets the NEWEST
  // calls. Without it Firestore sorts by document ID ascending, so new call
  // docs (call_1749xxxxx_…) land at the end of the collection and are never
  // included in the first 10 — meaning this onSnapshot NEVER fires for new
  // calls on any device with more than 10 existing calls.
  const callsQuery = query(
    collection(db, "users", currentUser.uid, "devices", deviceId, "calls"),
    orderBy("timestamp", "desc"),
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

          // Update local cache immediately so the popup sees the new call without waiting
          updateCallsCache(deviceId, deviceName, { ...call, id: docId });

          // Push to the open popup so the Calls list updates live for ANY new
          // call doc, without relying solely on the popup's own onSnapshot
          // (which can lag under MV3/Firestore cache timing, forcing a manual
          // refresh). This is independent of the 5-minute notification window.
          chrome.runtime
            .sendMessage({ type: "newCall", deviceId, deviceName })
            .catch(() => {
              // Popup may not be open, ignore error
            });

          // Only show a system notification for recent calls (last 5 minutes)
          const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
          if (callTime > fiveMinutesAgo) {
            // Live incoming-call notifications are handled by ringing_call/current.
            // The calls collection can arrive late/out-of-order, which may surface
            // a previous caller as a fresh "Incoming call" toast during a new ring.
            // Suppress call-log incoming toasts to keep Chrome notifications aligned
            // with the active incoming-call popup/toast source of truth.
            if ((call.type || "").toLowerCase() === "incoming") {
              return;
            }

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
      if (error?.code === "permission-denied") return;
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
 * Extract OTP code from SMS, email, or app notification text.
 * Returns the first 4-8 digit sequence found near OTP-related keywords,
 * or null if no OTP pattern matches.
 */
function extractOTP(text) {
  if (!text || typeof text !== "string") return null;

  // Strip HTML tags/entities (emails may be HTML), normalise whitespace
  const clean = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

  // Must contain an OTP-related keyword (English or Arabic, including email patterns)
  const keywordRe =
    /(otp|verification.?code|one.?time.?pass(?:word|code)?|one.?time.?code|passcode|access.?code|security.?code|auth(?:entication)?.?code|login.?code|sign.?in.?code|activation.?code|reset.?code|password.?reset|temporary.?password|temp.?pass|2fa|two.?factor|2-factor|confirmation.?code|verify|verification|token|pin\b|\bcode\b|رمز|كود|تحقق|مفتاح|رمز المرور|كلمة السر المؤقتة)/i;
  const kwMatch = clean.match(keywordRe);
  if (!kwMatch) return null;

  // Prefer a 4-8 digit code appearing within 40 chars after the keyword
  // (covers patterns like "Your OTP is 123456" / "Verification code: 987654")
  const kwIdx = kwMatch.index + kwMatch[0].length;
  const window = clean.slice(kwIdx, kwIdx + 80);
  const nearby = window.match(/\b(\d{4,8})\b/);
  if (nearby) return nearby[1];

  // Also check 40 chars BEFORE the keyword (e.g. "123456 is your OTP")
  const before = clean.slice(Math.max(0, kwMatch.index - 40), kwMatch.index);
  const beforeMatch = before.match(/\b(\d{4,8})\b/);
  if (beforeMatch) {
    // Exclude card/account masking numbers — e.g. "ending 7396", "last 4 digits 1234",
    // "card (ending 7396)", "account no. 1234" — these are identifiers, not OTPs.
    const maskedCardRe = /(?:ending|ending in|last\s+\d+\s+digits?|card|account|no\.?|number|acct|a\/c)[^\d]{0,15}$/i;
    if (!maskedCardRe.test(before.slice(0, beforeMatch.index + beforeMatch[0].length))) {
      return beforeMatch[1];
    }
  }

  // Fallback: first 4-8 digit number in the whole text, but not a masked card/account number
  const anyMatch = clean.match(/\b(\d{4,8})\b/);
  if (anyMatch) {
    const precedingText = clean.slice(Math.max(0, anyMatch.index - 30), anyMatch.index);
    const maskedCardFallbackRe = /(?:ending|ending in|last\s+\d+\s+digits?|card|account|no\.?|number|acct|a\/c)[^\d]{0,15}$/i;
    if (!maskedCardFallbackRe.test(precedingText)) return anyMatch[1];
  }
  return null;
}

/**
 * Send the detected OTP to the content script running in the active focused tab.
 */
async function sendOTPToActiveTab(otp, sender, body) {
  // Copy OTP to clipboard via offscreen (works even when browser is not focused).
  // Fire-and-forget — must not block delivery to content script.
  try { sendTextToClipboard(otp); } catch (e) { /* ignore */ }

  try {
    // Try multiple queries — browser may be unfocused (user on phone) so
    // lastFocusedWindow can return empty. Fall back progressively.
    let activeTab = null;
    let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs && tabs.length) activeTab = tabs[0];
    if (!activeTab) {
      tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length) activeTab = tabs[0];
    }
    if (!activeTab) {
      tabs = await chrome.tabs.query({ active: true });
      if (tabs && tabs.length) activeTab = tabs[0];
    }
    if (!activeTab || !activeTab.id) {
      console.warn("ZyncIT: No active tab found for OTP delivery");
      return;
    }

    // content scripts cannot run on chrome:// / edge:// / about: / extension pages
    const url = activeTab.url || "";
    if (!url || /^(chrome|edge|about|chrome-extension|moz-extension|file|devtools|view-source):/i.test(url)) {
      console.warn("ZyncIT: Active tab URL not scriptable:", url);
      return;
    }

    const payload = { type: "otpDetected", otp, sender, body };
    console.log("ZyncIT: 📨 Sending OTP to tab", activeTab.id, url);

    // Always inject the content script first — this is idempotent for our use
    // case (the IIFE registers an onMessage listener; duplicate listeners are
    // harmless because handleOTP de-duplicates the toast and the paste is
    // value-replacement). Inject explicitly so the message is guaranteed to
    // have a listener even on tabs opened before the extension was reloaded.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ["content-script.js"],
      });
    } catch (injErr) {
      console.warn("ZyncIT: content-script inject failed (will still try sendMessage):", injErr?.message || injErr);
    }

    try {
      await chrome.tabs.sendMessage(activeTab.id, payload);
      console.log("ZyncIT: ✅ OTP delivered to content script");
    } catch (sendErr) {
      console.warn("ZyncIT: tabs.sendMessage failed:", sendErr?.message || sendErr);
    }
  } catch (err) {
    console.warn("ZyncIT: Could not send OTP to active tab:", err);
  }
}

/**
 * Copy arbitrary text to clipboard using the Offscreen API (MV3).
 * This bypasses the focus/user-gesture requirement that affects content-script approach.
 * Used for Universal Copy feature.
 */
// Singleton promise for offscreen document creation — prevents race condition
// where concurrent calls to hasDocument()+createDocument() try to create twice.
let offscreenCreationPromise = null;
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (offscreenCreationPromise) return offscreenCreationPromise;
  offscreenCreationPromise = chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: [chrome.offscreen.Reason.CLIPBOARD],
    justification: "Write received message text to clipboard for Universal Copy feature",
  }).catch((err) => {
    // Another call may have already created it — ignore "single document" error
    if (!/single offscreen document/i.test(err?.message || "")) throw err;
  }).finally(() => {
    offscreenCreationPromise = null;
  });
  return offscreenCreationPromise;
}

async function sendTextToClipboard(text) {
  try {
    await ensureOffscreenDocument();
    // Fire-and-forget: offscreen will write to clipboard.
    // Don't await the response — multiple listeners (popup, SW) compete and
    // can make `response.ok` undefined even when the write succeeds.
    chrome.runtime.sendMessage({ type: "offscreen-copy", text }).catch(() => {});
    console.log("ZyncIT: 📋 Sent text to offscreen clipboard:", text.slice(0, 60));
  } catch (err) {
    console.warn("ZyncIT: Could not copy to clipboard:", err);
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
      // On first load, process very recent SMS through smart actions (catches missed messages
      // while the service worker was inactive), then mark all as seen.
      if (isFirstSMSSnapshot) {
        isFirstSMSSnapshot = false;
        const uid = currentUser?.uid;
        const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
        snapshot.docs.forEach((d) => {
          seenSMSIds.add(d.id);
          const sms = d.data();
          // Only process incoming (received) SMS — skip outgoing/sent messages
          if (sms.smsType === "sent" || sms.direction === "outgoing") return;
          const ts = sms.timestamp || sms.receivedAt || 0;
          if (ts < twoMinutesAgo) return; // skip old messages
          const rawBody = sms.body || sms.message || sms.content || sms.text || "";
          const rawSender = sms.sender || sms.address || sms.phoneNumber || sms.title || "";
          Promise.all([decrypt(rawBody, uid), decrypt(rawSender, uid)])
            .then(([body, sender]) => {
              if (smartActions.copyOtp) {
                const otp = extractOTP(body);
                if (otp) {
                  const notifId = `iropit_otp_catchup_${Date.now()}`;
                  createNotificationIfNotSnoozed(notifId, {
                    type: "basic",
                    iconUrl: chrome.runtime.getURL("assets/icon128.png"),
                    title: `OTP from ${sender || deviceName}`,
                    message: `${otp} — Copied to clipboard`,
                    priority: 2,
                  });
                  sendOTPToActiveTab(otp, sender, body);
                }
              }
              // openUrls is intentionally NOT applied to SMS — chat messages only
              if (smartActions.universalCopy && body) {
                sendTextToClipboard(body);
              }
            })
            .catch(() => {});
        });
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type !== "added") return;

        const docId = change.doc.id;
        if (seenSMSIds.has(docId)) return;
        seenSMSIds.add(docId);

        const sms = change.doc.data();

        // Update local cache immediately for ALL new SMS (sent and received)
        // so the popup sees the message without waiting for the 5-minute cache refresh
        updateSMSCache(deviceId, deviceName, { ...sms, id: docId });

        // Only process incoming (received) SMS for OTP/smart-actions
        if (sms.smsType === "sent" || sms.direction === "outgoing") return;
        const rawBody = sms.body || sms.message || sms.content || sms.text || "";
        const rawSender = sms.sender || sms.address || sms.phoneNumber || sms.title || "";

        // Decrypt fields (they may be encrypted with ENC: prefix)
        const uid = currentUser?.uid;
        Promise.all([
          decrypt(rawBody, uid),
          decrypt(rawSender, uid),
        ]).then(([body, sender]) => {
          // Copy OTP from SMS
          if (smartActions.copyOtp) {
            const otp = extractOTP(body);
            if (otp) {
              console.log("ZyncIT: 🔑 OTP detected from", deviceName, ":", otp, "sender:", sender);
              const notifId = `iropit_otp_${Date.now()}`;
              createNotificationIfNotSnoozed(notifId, {
                type: "basic",
                iconUrl: chrome.runtime.getURL("assets/icon128.png"),
                title: `OTP from ${sender || deviceName}`,
                message: `${otp} — Copied to clipboard`,
                priority: 2,
              });
              sendOTPToActiveTab(otp, sender, body);
            }
          }
        }).catch((err) => console.warn("ZyncIT: OTP decrypt error:", err));
      });
    },
    (error) => {
      if (error?.code === "permission-denied") return;
      console.error("ZyncIT: SMS OTP listener error for device", deviceId, ":", error);
    },
  );

  unsubscribeNotifications.push(unsub);
}

// ─── Background Cache Helpers ────────────────────────────────────────────────

/**
 * Merge a single new SMS message into chrome.storage.local immediately.
 * Called by the real-time SMS listener so the popup cache is always fresh.
 */
async function updateSMSCache(deviceId, deviceName, newMsg) {
  try {
    const result = await chrome.storage.local.get(["cached_sms_data"]);
    const smsByDevice = result.cached_sms_data?.byDevice || {};
    const existing = smsByDevice[deviceId] || [];
    if (existing.some((m) => m.id === newMsg.id)) return; // already cached
    smsByDevice[deviceId] = [{ ...newMsg, deviceId, deviceName }, ...existing].slice(0, SMS_CACHE_CAP);
    const allMessages = Object.values(smsByDevice).flat()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, SMS_CACHE_CAP);
    await chrome.storage.local.set({
      cached_sms_data: { byDevice: smsByDevice, allMessages },
      cache_timestamp: Date.now(),
    });
  } catch (e) {
    console.warn("ZyncIT: Failed to update SMS cache:", e);
  }
}

/**
 * Merge a single new call into chrome.storage.local immediately.
 * Called by the real-time calls listener so the popup cache is always fresh.
 */
async function updateCallsCache(deviceId, deviceName, newCall) {
  try {
    const result = await chrome.storage.local.get(["cached_calls_data"]);
    const callsByDevice = result.cached_calls_data?.byDevice || {};
    const existing = callsByDevice[deviceId] || [];
    if (existing.some((c) => c.id === newCall.id)) return; // already cached
    // Decrypt before caching — otherwise the popup reads an ENC: call from cache,
    // blanks out its name/number, and the delta fetch (timestamp > newest) skips it,
    // so the just-ended call never shows correctly until a full cache-clear refresh.
    let decrypted = newCall;
    try { decrypted = await decryptCall(newCall, currentUser?.uid); } catch (_) {}
    callsByDevice[deviceId] = [{ ...decrypted, id: newCall.id, deviceId, deviceName }, ...existing].slice(0, CALLS_CACHE_CAP);
    const allCalls = Object.values(callsByDevice).flat()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, CALLS_CACHE_CAP);
    await chrome.storage.local.set({
      cached_calls_data: { byDevice: callsByDevice, allCalls },
    });
  } catch (e) {
    console.warn("ZyncIT: Failed to update calls cache:", e);
  }
}

// ─── Chrome Notification Display ─────────────────────────────────────────────

// Show Chrome notification
async function showNotification(data) {
  const uid = currentUser?.uid;
  const appName = data.appName || data.packageName || "App";
  // Decrypt title (header) and body in parallel so the body is loaded at the
  // same time as the header, rather than waiting for the title to finish first.
  const [title, message] = await Promise.all([
    decrypt(data.title || data.contactName || "New Notification", uid),
    decrypt(data.body || data.text || data.content || "", uid),
  ]);
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
    activeListenersUserUid = null;
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

  createNotificationIfNotSnoozed(
    notificationId,
    notificationOptions,
    (createdId) => {
      console.log("ZyncIT: ✅ Chrome notification created:", createdId);
    },
  );
}

async function showCallNotification(call) {
  const uid = currentUser?.uid;
  const contactInfo = await decrypt(call.contactName || call.phoneNumber || "Unknown", uid);
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

  createNotificationIfNotSnoozed(
    notificationId,
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon128.png"),
      title: title,
      message: message,
      priority: 2,
      requireInteraction: callType === "missed",
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
chrome.alarms.create("refreshCache", { periodInMinutes: 5 }); // Every 5 minutes

// Read smart action settings fresh from chrome.storage.local (avoids stale defaults on SW cold start)
async function getSmartActionsFresh() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["smartAction_copyOtp", "smartAction_openImages", "smartAction_openUrls", "smartAction_universalCopy"],
      (result) => {
        resolve({
          copyOtp: result.smartAction_copyOtp !== false,
          openImages: result.smartAction_openImages === true,
          openUrls: result.smartAction_openUrls === true,
          universalCopy: result.smartAction_universalCopy !== false,
        });
      },
    );
  });
}

// Poll for new chat messages and apply smart actions (URL open, universal copy, image open)
async function pollForChatSmartActions() {
  if (!currentUser || !auth.currentUser) return;
  // Read settings fresh — avoids stale defaults if SW just woke up and storage load hasn't completed
  const sa = await getSmartActionsFresh();
  if (!sa.openUrls && !sa.openImages && !sa.universalCopy) return;

  try {
    const uid = currentUser.uid;
    const q = query(
      collection(db, "chats"),
      where("participants", "array-contains", uid),
      where("timestamp", ">", lastChatPollTimestamp),
      orderBy("timestamp", "desc"),
      limit(20),
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return;

    console.log(`ZyncIT: 📬 Chat poll found ${snapshot.size} new message(s)`);
    // Process in chronological order (oldest first)
    const docs = snapshot.docs.slice().reverse();
    let latestTs = lastChatPollTimestamp;
    for (const docSnap of docs) {
      const msg = docSnap.data();
      const docId = docSnap.id;
      if (seenChatMessageIds.has(docId)) continue;
      seenChatMessageIds.add(docId);

      pushChatToPopup({ id: docId, ...msg });

      const ts =
        typeof msg.timestamp === "number"
          ? msg.timestamp
          : typeof msg.timestamp?.toMillis === "function"
            ? msg.timestamp.toMillis()
            : 0;
      if (ts > latestTs) latestTs = ts;

      // Smart actions are only for messages received from other devices.
      if (msg.senderPlatform === "chrome-extension") continue;
      if ((msg.senderDeviceId || "").startsWith("ext_")) continue;
      await processChatMessageSmartActions(msg, sa);
    }

    // Persist updated state
    if (latestTs > lastChatPollTimestamp) {
      lastChatPollTimestamp = latestTs;
    }
    const seenArray = Array.from(seenChatMessageIds).slice(-500);
    chrome.storage.local.set({ lastChatPollTimestamp, seenChatMessageIds: seenArray });
  } catch (error) {
    if (error?.code === "permission-denied" || !auth.currentUser) return;
    console.error("ZyncIT: Chat poll error:", error);
  }
}

// Poll for new notifications (backup for when onSnapshot fails)
async function pollForNewNotifications() {
  // Double-check auth: local cache AND live Firebase auth state.
  // Prevents permission-denied races right after signOut().
  if (!currentUser || !auth.currentUser) return;

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

      // Use getDocsFromServer (NOT getDocs) for this delta query. A brand-new
      // notification isn't in Firestore's local IndexedDB cache yet, so the
      // default cache-first getDocs returns nothing until the cache syncs,
      // delaying the toast by several seconds ("wait till receiving it").
      // Forcing the server read makes the ~10s poll catch new notifications
      // immediately even when the MV3 SW just woke up.
      const notifSnapshot = await getDocsFromServer(notifQuery);

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
            data: { ...notification, id: docId, deviceId: device.id, deviceName: device.nickname || device.name || "Android" },
          })
          .catch(() => {});
      });
    }
  } catch (error) {
    // Silently ignore permission errors that occur during sign-out race.
    // Also ignore unavailable errors (offline / Firestore quota exceeded) —
    // these are transient and the next poll cycle will retry automatically.
    if (
      error?.code === "permission-denied" ||
      error?.code === "unavailable" ||
      !auth.currentUser
    ) {
      return;
    }
    console.error("ZyncIT: Poll error:", error);
  }
}

/**
 * Refresh the popup's chrome.storage.local cache with the latest SMS, calls,
 * and notifications so the popup shows near-current data even after a long gap.
 * This runs every 5 minutes in the background.
 */
async function refreshPopupCache() {
  if (!currentUser || !auth.currentUser) return;

  try {
    const devicesQuery = query(
      collection(db, "devices"),
      where("userId", "==", currentUser.uid),
    );
    const devicesSnapshot = await getDocs(devicesQuery);

    const mobileDevices = [];
    devicesSnapshot.forEach((docSnap) => {
      const d = docSnap.data();
      if (d.platform !== "chrome" && d.platform !== "chrome-extension" && !d.id?.startsWith("ext_")) {
        let friendlyName = d.nickname;
        if (!friendlyName) {
          const platform = (d.platform || "").toLowerCase();
          friendlyName = platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "Device";
        }
        mobileDevices.push({ id: d.id, name: friendlyName });
      }
    });

    if (mobileDevices.length === 0) return;

    // Read existing caches so we only fetch newer items (delta)
    const [existingSMS, existingCalls, existingNotifs] = await Promise.all([
      chrome.storage.local.get(["cached_sms_data", "cache_timestamp"]),
      chrome.storage.local.get(["cached_calls_data"]),
      chrome.storage.local.get(["cached_notifications_data"]),
    ]);

    // Per-device newest timestamp helpers
    function newestTs(byDevice, deviceId, field) {
      const items = byDevice?.[deviceId] || [];
      if (!items.length) return null;
      return Math.max(...items.map((x) => x[field] || x.timestamp || 0));
    }

    const smsByDevice = existingSMS.cached_sms_data?.byDevice || {};
    const callsByDevice = existingCalls.cached_calls_data?.byDevice || {};
    const notifsByDevice = existingNotifs.cached_notifications_data?.byDevice || {};

    const newSmsByDevice = { ...smsByDevice };
    const newCallsByDevice = { ...callsByDevice };
    const newNotifsByDevice = { ...notifsByDevice };

    await Promise.all(mobileDevices.map(async (device) => {
      // ── SMS ──────────────────────────────────────────────────────────────
      const smsNewest = newestTs(smsByDevice, device.id, "timestamp");
      // When there is no existing per-device SMS cache this is a FULL fetch.
      // It MUST hit the server (getDocsFromServer): a cold/just-woken service
      // worker's IndexedDB only holds a truncated window, so cache-first getDocs
      // would write a tiny SMS set and clobber the popup's full cache — which is
      // exactly what makes loaded SMS "disappear" on the next popup open.
      const smsIsFullFetch = !smsNewest;
      const smsQ = smsNewest
        ? query(collection(db, "users", currentUser.uid, "devices", device.id, "notifications"),
            where("type", "==", "sms"), where("timestamp", ">", smsNewest),
            orderBy("timestamp", "desc"), limit(100))
        : query(collection(db, "users", currentUser.uid, "devices", device.id, "notifications"),
          where("type", "==", "sms"), orderBy("timestamp", "desc"), limit(SMS_CACHE_CAP));

      // ── Calls ─────────────────────────────────────────────────────────────
      const callsNewest = newestTs(callsByDevice, device.id, "timestamp");
      const callsQ = callsNewest
        ? query(collection(db, "users", currentUser.uid, "devices", device.id, "calls"),
            where("timestamp", ">", callsNewest), orderBy("timestamp", "desc"), limit(100))
        : query(collection(db, "users", currentUser.uid, "devices", device.id, "calls"),
          orderBy("timestamp", "desc"), limit(CALLS_CACHE_CAP));

      // ── Notifications ─────────────────────────────────────────────────────
      const notifNewest = newestTs(notifsByDevice, device.id, "timestamp");
      const notifQ = notifNewest
        ? query(collection(db, "users", currentUser.uid, "devices", device.id, "notifications"),
            where("timestamp", ">", notifNewest), orderBy("timestamp", "desc"), limit(100))
        : query(collection(db, "users", currentUser.uid, "devices", device.id, "notifications"),
            orderBy("timestamp", "desc"), limit(200));

      try {
        const [smsSnap, callsSnap, notifSnap] = await Promise.all([
          smsIsFullFetch ? getDocsFromServer(smsQ) : getDocs(smsQ),
          getDocs(callsQ),
          getDocs(notifQ),
        ]);

        // Merge SMS — cap to agreed bulk size to keep cache consistent with popup full loads.
        {
          const newMsgs = smsSnap.docs.map((d) => ({ ...d.data(), id: d.id, deviceId: device.id, deviceName: device.name }));
          const existing = smsByDevice[device.id] || [];
          const existingIds = new Set(existing.map((m) => m.id));
          const brandNew = newMsgs.filter((m) => !existingIds.has(m.id));
          newSmsByDevice[device.id] = [...brandNew, ...existing].slice(0, SMS_CACHE_CAP);
        }

        // Merge Calls — cap to calls cache size
        {
          const newCalls = callsSnap.docs.map((d) => ({ ...d.data(), id: d.id, deviceId: device.id, deviceName: device.name }));
          const existing = callsByDevice[device.id] || [];
          const existingIds = new Set(existing.map((c) => c.id));
          const brandNew = newCalls.filter((c) => !existingIds.has(c.id));
          newCallsByDevice[device.id] = [...brandNew, ...existing].slice(0, CALLS_CACHE_CAP);
        }

        // Merge Notifications (non-SMS) — always cap to 200
        {
          const newNotifs = notifSnap.docs.map((d) => ({ ...d.data(), id: d.id, deviceId: device.id, deviceName: device.name }));
          const existing = notifsByDevice[device.id] || [];
          const existingIds = new Set(existing.map((n) => n.id));
          const brandNew = newNotifs.filter((n) => !existingIds.has(n.id));
          newNotifsByDevice[device.id] = [...brandNew, ...existing].slice(0, 200);
        }
      } catch (err) {
        if (err?.code !== "permission-denied") {
          console.warn(`ZyncIT: Cache refresh error for device ${device.id}:`, err);
        }
      }
    }));

    // Re-read current SMS cache just before writing to preserve any read-status
    // updates the popup may have written while we were fetching from Firestore.
    const latestSMSCache = await chrome.storage.local.get(["cached_sms_data"]);
    const latestSmsByDevice = latestSMSCache.cached_sms_data?.byDevice || {};
    for (const deviceId of Object.keys(newSmsByDevice)) {
      const latestMsgs = latestSmsByDevice[deviceId];
      if (!latestMsgs || latestMsgs.length === 0) continue;
      const latestById = new Map(latestMsgs.map((m) => [m.id, m]));
      newSmsByDevice[deviceId] = newSmsByDevice[deviceId].map((m) => {
        const latest = latestById.get(m.id);
        // Prefer the popup's read=true over our stale read=false
        return (latest && latest.read === true && !m.read) ? { ...m, read: true } : m;
      });
    }

    // Re-read current calls cache just before writing to preserve any viewed-status
    // updates the popup may have written while we were fetching from Firestore.
    const latestCallsCache = await chrome.storage.local.get(["cached_calls_data"]);
    const latestCallsByDevice = latestCallsCache.cached_calls_data?.byDevice || {};
    for (const deviceId of Object.keys(newCallsByDevice)) {
      const latestCalls = latestCallsByDevice[deviceId];
      if (!latestCalls || latestCalls.length === 0) continue;
      const latestById = new Map(latestCalls.map((c) => [c.id, c]));
      newCallsByDevice[deviceId] = newCallsByDevice[deviceId].map((c) => {
        const latest = latestById.get(c.id);
        // Prefer the popup's viewed=true over our stale viewed=false
        return (latest && latest.viewed === true && !c.viewed) ? { ...c, viewed: true } : c;
      });
    }

    // Re-read current notifications cache just before writing to preserve any
    // read=true updates the popup may have written while we fetched Firestore.
    const latestNotifCache = await chrome.storage.local.get(["cached_notifications_data"]);
    const latestNotifsByDevice = latestNotifCache.cached_notifications_data?.byDevice || {};
    for (const deviceId of Object.keys(newNotifsByDevice)) {
      const latestNotifs = latestNotifsByDevice[deviceId];
      if (!latestNotifs || latestNotifs.length === 0) continue;
      const latestById = new Map(latestNotifs.map((n) => [n.id, n]));
      newNotifsByDevice[deviceId] = newNotifsByDevice[deviceId].map((n) => {
        const latest = latestById.get(n.id);
        return (latest && latest.read === true && !n.read) ? { ...n, read: true } : n;
      });
    }

    // Refresh the locally-read index so background badge counting matches popup.
    const readIds = new Set();
    Object.values(newNotifsByDevice).forEach((items) => {
      (items || []).forEach((n) => {
        if (n?.read === true && n?.id) readIds.add(n.id);
      });
    });
    locallyReadNotificationIds = readIds;

    // Rebuild allMessages / allCalls arrays for the popup
    const allMessages = Object.values(newSmsByDevice).flat()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, SMS_CACHE_CAP);
    const allCalls = Object.values(newCallsByDevice).flat()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, CALLS_CACHE_CAP);

    // Persist all caches atomically
    await chrome.storage.local.set({
      cached_sms_data: { byDevice: newSmsByDevice, allMessages },
      cache_timestamp: Date.now(),
      cached_calls_data: { byDevice: newCallsByDevice, allCalls },
      cached_notifications_data: { byDevice: newNotifsByDevice, savedAt: Date.now() },
    });

    // Keep action badge synced in background even if popup is closed.
    // Use setBadgeCountFromCache so the badge never drops below the live
    // incremental count tracked by onSnapshot (avoids shrink on popup open).
    setBadgeCountFromCache(computeUnreadCountFromByDevice(newNotifsByDevice));

    console.log(
      `ZyncIT: ✅ Cache refreshed — SMS: ${allMessages.length}, Calls: ${allCalls.length}`,
    );
  } catch (error) {
    if (error?.code !== "permission-denied") {
      console.warn("ZyncIT: Cache refresh failed:", error);
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkNotifications") {
    console.log("ZyncIT: 🔍 Polling for new notifications...");
    pollForNewNotifications();
    pollForChatSmartActions();
  }

  if (alarm.name === "keepAlive") {
    console.log("ZyncIT: Keep-alive ping", new Date().toLocaleTimeString());
    // Re-establish listeners if they were lost
    if (currentUser && unsubscribeNotifications.length === 0) {
      console.log("ZyncIT: Listeners lost, restarting...");
      startListening();
    }
  }

  if (alarm.name === "refreshCache") {
    console.log("ZyncIT: 🔄 Refreshing popup cache in background...");
    refreshPopupCache();
  }
});

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  // Full menu build on install/update — guaranteed to run synchronously in this event
  buildContextMenus();

  const callPopupKeys = ["smartAction_incomingCallPopup", "smartAction_outgoingCallPopup"];

  if (details.reason === "install") {
    // Fresh install: explicitly set call popups ON.
    const defaults = {};
    callPopupKeys.forEach((k) => (defaults[k] = true));
    defaults.installAndroidPromptPending = true;
    defaults.installAndroidPromptShown_v1 = false;
    chrome.storage.local.set(defaults);
  } else if (details.reason === "update") {
    // Extension update: do not override existing or missing call popup keys.
    // This keeps update behavior unchanged and only applies the ON default to fresh installs.
    // NOTE: one-time cache bloat migration was done in v1.2.19 (removed here
    // to avoid wiping the cache — and delta eligibility — on every future update).
  }
});

// Rebuild context menus on browser startup (menus should persist but this is a
// safety net in case Chrome ever clears them between sessions)
chrome.runtime.onStartup.addListener(() => {
  buildContextMenus();
});

// ─── Context Menu: Send Page to Device ───────────────────────────────────────

// Tracked mobile devices for context menu [ { id, name } ]
let contextMenuDevices = [];

// ─── Badge & Snooze Helpers ──────────────────────────────────────────────────

/** Returns true if notifications are currently snoozed. */
function isSnoozed() {
  return Date.now() < snoozeUntil;
}

/** Set snooze for the given number of minutes (0 = clear snooze). */
function setSnooze(minutes) {
  snoozeUntil = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
  chrome.storage.local.set({ snoozeUntil });
  updateSnoozeMenuTitle();
  console.log("ZyncIT: 🔕 Snooze set for", minutes, "minutes");
}

/** Update just the snooze root menu title (menus persist between SW restarts). */
function updateSnoozeMenuTitle() {
  const title = isSnoozed()
    ? `🔕 Snoozed until ${new Date(snoozeUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "🔔 Snooze Notifications";
  chrome.contextMenus.update("iropit_snooze_root", { title }, () => { void chrome.runtime.lastError; });
}

/** Increment badge count for unread notifications. */
function incrementBadge() {
  setBadgeCount(badgeCount + 1);
}

/** Reset badge count to zero. */
function clearBadge() {
  unreadIdsBySource.clear();
  setBadgeCount(0);
}

function computeUnreadCountFromByDevice(byDevice) {
  if (!byDevice) return 0;
  const unreadIds = new Set();
  Object.values(byDevice).forEach((items) => {
    (items || []).forEach((n) => {
      if (!n?.id) return;
      if (n.read === true) return;
      unreadIds.add(n.id);
    });
  });
  return unreadIds.size;
}

/**
 * Return the live unread count tracked by onSnapshot incremental updates.
 * This is always >= the cache-window count because it accumulates across
 * the full Firestore history, not just the last N fetched docs.
 */
function getLiveUnreadCount() {
  const allUnreadIds = new Set();
  unreadIdsBySource.forEach((ids) => ids.forEach((id) => allUnreadIds.add(id)));
  return allUnreadIds.size;
}

/**
 * Set badge from a cache-derived count, but never let it drop below the
 * live incremental count tracked by onSnapshot (prevents badge shrinking
 * when the popup opens and refreshes from a limited fetch window).
 */
function setBadgeCountFromCache(cacheCount) {
  setBadgeCount(Math.max(cacheCount, getLiveUnreadCount()));
}

function refreshBadgeFromCachedNotifications(fallbackCount) {
  chrome.storage.local.get(["cached_notifications_data"], (result) => {
    const byDevice = result.cached_notifications_data?.byDevice;
    if (byDevice) {
      // Also refresh locally-read index from cache so realtime counting stays aligned.
      const readIds = new Set();
      Object.values(byDevice).forEach((items) => {
        (items || []).forEach((n) => {
          if (n?.id && n.read === true) readIds.add(n.id);
        });
      });
      locallyReadNotificationIds = readIds;

      setBadgeCountFromCache(computeUnreadCountFromByDevice(byDevice));
      return;
    }

    if (fallbackCount !== undefined) {
      setBadgeCountFromCache(fallbackCount);
    }
  });
}

function setBadgeCount(count) {
  badgeCount = Math.max(0, Number(count) || 0);
  chrome.storage.local.set({ badgeCount });
  updateBadge();
}

function normalizeNotificationText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildNotificationFingerprint(options) {
  const type = normalizeNotificationText(options?.type || "basic");
  const title = normalizeNotificationText(options?.title);
  const message = normalizeNotificationText(options?.message);
  const context = normalizeNotificationText(options?.contextMessage);
  return `${type}|${title}|${message}|${context}`;
}

function pruneRecentNotificationFingerprints(store, now) {
  const pruned = {};

  Object.entries(store || {}).forEach(([key, ts]) => {
    if (typeof ts !== "number") return;
    if (now - ts > NOTIFICATION_DEDUPE_WINDOW_MS) return;
    pruned[key] = ts;
  });

  const sorted = Object.entries(pruned)
    .sort((a, b) => b[1] - a[1])
    .slice(0, NOTIFICATION_DEDUPE_MAX_KEYS);

  return Object.fromEntries(sorted);
}

function setUnreadIdsForSource(sourceKey, unreadIds) {
  unreadIdsBySource.set(sourceKey, unreadIds || new Set());
  const allUnreadIds = new Set();
  unreadIdsBySource.forEach((ids) => {
    ids.forEach((id) => allUnreadIds.add(id));
  });
  setBadgeCount(allUnreadIds.size);
}

/** Update the extension action badge UI. */
function updateBadge() {
  const text = badgeCount > 0 ? "●" : "";
  chrome.action.setBadgeText({ text });
  if (badgeCount > 0) {
    chrome.action.setBadgeBackgroundColor({ color: "#43A047" }); // green dot
  }
}

/**
 * Create a Chrome notification unless snoozed, and increment the badge count.
 */
function createNotificationIfNotSnoozed(notifId, options, callback) {
  if (isSnoozed()) {
    console.log("ZyncIT: 🔕 Notification suppressed (snoozed):", options.title);
    return;
  }

  const now = Date.now();
  const fingerprint = buildNotificationFingerprint(options);
  const inMemoryTs = recentNotificationFingerprints[fingerprint];
  if (typeof inMemoryTs === "number" && now - inMemoryTs < NOTIFICATION_DEDUPE_WINDOW_MS) {
    console.log("ZyncIT: ⏭️ Duplicate notification suppressed (memory):", options.title);
    return;
  }

  chrome.storage.local.get(["recentNotificationFingerprints"], (result) => {
    const persisted = (result.recentNotificationFingerprints && typeof result.recentNotificationFingerprints === "object")
      ? result.recentNotificationFingerprints
      : {};

    const persistedTs = persisted[fingerprint];
    if (typeof persistedTs === "number" && now - persistedTs < NOTIFICATION_DEDUPE_WINDOW_MS) {
      console.log("ZyncIT: ⏭️ Duplicate notification suppressed (storage):", options.title);
      recentNotificationFingerprints = pruneRecentNotificationFingerprints(persisted, now);
      return;
    }

    const merged = {
      ...persisted,
      [fingerprint]: now,
    };
    recentNotificationFingerprints = pruneRecentNotificationFingerprints(merged, now);
    chrome.storage.local.set({ recentNotificationFingerprints });

    chrome.notifications.create(notifId, options, (createdId) => {
      // Do not increment badge here. This function is used for many toast types
      // (notifications, calls, OTP, etc.), and incrementing per toast causes the
      // action badge to drift far above the true unread notifications count.
      if (callback) callback(createdId);
    });
  });
}

/** Build (or rebuild) the right-click context menu entries. */
function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
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

    // ── Snooze menu (right-click extension toolbar icon) ──
    const snoozeTitle = isSnoozed()
      ? `🔕 Snoozed until ${new Date(snoozeUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "🔔 Snooze Notifications";
    chrome.contextMenus.create({
      id: "iropit_snooze_root",
      title: snoozeTitle,
      contexts: ["action"],
    }, () => { void chrome.runtime.lastError; });
    chrome.contextMenus.create({
      id: "iropit_snooze_30",
      parentId: "iropit_snooze_root",
      title: "⏱ 30 minutes",
      contexts: ["action"],
    }, () => { void chrome.runtime.lastError; });
    chrome.contextMenus.create({
      id: "iropit_snooze_60",
      parentId: "iropit_snooze_root",
      title: "⏱ 1 hour",
      contexts: ["action"],
    }, () => { void chrome.runtime.lastError; });
    chrome.contextMenus.create({
      id: "iropit_snooze_120",
      parentId: "iropit_snooze_root",
      title: "⏱ 2 hours",
      contexts: ["action"],
    }, () => { void chrome.runtime.lastError; });
    chrome.contextMenus.create({
      id: "iropit_snooze_480",
      parentId: "iropit_snooze_root",
      title: "⏱ 8 hours",
      contexts: ["action"],
    }, () => { void chrome.runtime.lastError; });
    chrome.contextMenus.create({
      id: "iropit_snooze_sep2",
      parentId: "iropit_snooze_root",
      type: "separator",
      contexts: ["action"],
    }, () => { void chrome.runtime.lastError; });
    chrome.contextMenus.create({
      id: "iropit_snooze_off",
      parentId: "iropit_snooze_root",
      title: "🔔 Turn off snooze",
      contexts: ["action"],
    }, () => { void chrome.runtime.lastError; });
  });
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
    // Always ensure menus exist even if the device fetch fails
    buildContextMenus();
  }
}

/** Send text content (URL or selected text) as a chat message to one or all devices. */
async function sendTextToDevice(content, targetDeviceId) {
  if (!currentUser) return;
  const base = {
    senderId: currentUser.uid,
    senderDeviceId: currentDeviceId || "ext_sw",
    senderPlatform: "chrome-extension",
    senderName: "Chrome Extension",
    receiverId: currentUser.uid,
    content,
    type: "text",
    read: false,
    timestamp: Date.now(),
    participants: [currentUser.uid],
  };

  try {
    let firstRef = null;
    if (!targetDeviceId) {
      if (contextMenuDevices.length === 0) {
        firstRef = await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: null });
      } else {
        const refs = await Promise.all(
          contextMenuDevices.map((dev) =>
            addDoc(collection(db, "chats"), { ...base, receiverDeviceId: dev.id })
          )
        );
        firstRef = refs[0] || null;
      }
    } else {
      firstRef = await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: targetDeviceId });
    }
    if (firstRef?.id) {
      pushChatToPopup({ ...base, id: firstRef.id, receiverDeviceId: targetDeviceId || null });
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
    senderName: "Chrome Extension",
    receiverId: currentUser.uid,
    content,
    type: "text",
    read: false,
    timestamp: Date.now(),
    participants: [currentUser.uid],
  };

  try {
    let firstRef = null;
    if (!targetDeviceId) {
      // Send to each mobile device individually
      if (contextMenuDevices.length === 0) {
        // Fallback: broadcast with no specific receiver
        firstRef = await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: null });
      } else {
        const refs = await Promise.all(
          contextMenuDevices.map((dev) =>
            addDoc(collection(db, "chats"), { ...base, receiverDeviceId: dev.id })
          )
        );
        firstRef = refs[0] || null;
      }
    } else {
      firstRef = await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: targetDeviceId });
    }
    if (firstRef?.id) {
      pushChatToPopup({ ...base, id: firstRef.id, receiverDeviceId: targetDeviceId || null });
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
      senderName: "Chrome Extension",
      receiverId: currentUser.uid,
      content: "📷 Image",
      type: "image",
      fileUrl,
      read: false,
      timestamp: Date.now(),
      participants: [currentUser.uid],
    };
    let firstRef = null;
    if (!targetDeviceId) {
      if (contextMenuDevices.length === 0) {
        firstRef = await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: null });
      } else {
        const refs = await Promise.all(
          contextMenuDevices.map((dev) =>
            addDoc(collection(db, "chats"), { ...base, receiverDeviceId: dev.id })
          )
        );
        firstRef = refs[0] || null;
      }
    } else {
      firstRef = await addDoc(collection(db, "chats"), { ...base, receiverDeviceId: targetDeviceId });
    }
    if (firstRef?.id) {
      pushChatToPopup({ ...base, id: firstRef.id, receiverDeviceId: targetDeviceId || null });
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

  // Snooze menu
  if (menuId === "iropit_snooze_30") { setSnooze(30); return; }
  if (menuId === "iropit_snooze_60") { setSnooze(60); return; }
  if (menuId === "iropit_snooze_120") { setSnooze(120); return; }
  if (menuId === "iropit_snooze_480") { setSnooze(480); return; }
  if (menuId === "iropit_snooze_off") { setSnooze(0); return; }

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

/**
 * Query Firestore directly for Insights data within a specific date range.
 * This bypasses chrome.storage.local so every machine gets identical results
 * regardless of its local cache state or installation date.
 */
async function fetchInsightsFromFirestore(fromTs, toTs) {
  if (!currentUser || !auth.currentUser) throw new Error("Not authenticated");

  // Get all mobile devices for this user
  const devicesSnap = await getDocs(query(
    collection(db, "devices"),
    where("userId", "==", currentUser.uid),
  ));

  const mobileDevices = [];
  devicesSnap.forEach((docSnap) => {
    const d = docSnap.data();
    if (d.platform !== "chrome" && d.platform !== "chrome-extension" && !d.id?.startsWith("ext_")) {
      let name = d.nickname;
      if (!name) {
        const platform = (d.platform || "").toLowerCase();
        name = platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "Device";
      }
      mobileDevices.push({ id: d.id, name });
    }
  });

  const allSms = [];
  const allCalls = [];
  const allNotifs = [];

  await Promise.all(mobileDevices.map(async (device) => {
    // Fetch all notifications (SMS + others) in date range — split by type client-side
    const [notifSnap, callsSnap] = await Promise.all([
      getDocs(query(
        collection(db, "users", currentUser.uid, "devices", device.id, "notifications"),
        where("timestamp", ">=", fromTs),
        where("timestamp", "<=", toTs),
        orderBy("timestamp", "desc"),
        limit(5000),
      )),
      getDocs(query(
        collection(db, "users", currentUser.uid, "devices", device.id, "calls"),
        where("timestamp", ">=", fromTs),
        where("timestamp", "<=", toTs),
        orderBy("timestamp", "desc"),
        limit(5000),
      )),
    ]);

    notifSnap.docs.forEach((d) => {
      const item = { ...d.data(), id: d.id, deviceId: device.id, deviceName: device.name };
      if (item.type === "sms") {
        allSms.push(item);
      }
      allNotifs.push(item);
    });

    callsSnap.docs.forEach((d) => {
      allCalls.push({ ...d.data(), id: d.id, deviceId: device.id, deviceName: device.name });
    });
  }));

  return { allSms, allCalls, allNotifs };
}

// Message handler from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Heartbeat from the persistent offscreen document — keeps the SW alive every
  // 20s so Firestore onSnapshot listeners are never lost due to the MV3 30s idle kill.
  if (message.type === "offscreen-heartbeat") {
    if (currentUser && unsubscribeNotifications.length === 0) {
      console.log("ZyncIT: 💓 Heartbeat: listeners lost, restarting...");
      startListening();
    }
    sendResponse({ ok: true });
    return true;
  }
  // Google Sign-In delegated from the popup on macOS. Chrome closes the
  // browser-action popup when the OAuth account chooser window takes focus,
  // which destroys the popup's JS context before sign-in completes. Running
  // the flow in the service worker (which is not tied to the popup) lets it
  // finish; Firebase persists the auth state and the popup's auth observer
  // picks it up on the next open. We deliberately do NOT revoke tokens here —
  // launchWebAuthFlow with prompt=select_account already forces the chooser,
  // and revoking would break the Firestore session used by SMS/calls sync.
  if (message.type === "googleSignIn") {
    (async () => {
      try {
        // Web application OAuth client (Chrome-extension clients can't register
        // the redirect URI that launchWebAuthFlow requires).
        const clientId =
          "723637478368-8vceokc6jdb1uc9fbht1megnl9urrfnk.apps.googleusercontent.com";
        const manifest = chrome.runtime.getManifest();
        const scopes = (manifest?.oauth2?.scopes || []).join(" ");
        const redirectUri = chrome.identity.getRedirectURL();
        const authUrl =
          "https://accounts.google.com/o/oauth2/v2/auth" +
          "?client_id=" + encodeURIComponent(clientId) +
          "&response_type=token" +
          "&redirect_uri=" + encodeURIComponent(redirectUri) +
          "&scope=" + encodeURIComponent(scopes) +
          "&prompt=select_account";

        const responseUrl = await new Promise((resolve, reject) => {
          chrome.identity.launchWebAuthFlow(
            { url: authUrl, interactive: true },
            (ru) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (!ru) {
                reject(new Error("No response from Google sign-in"));
                return;
              }
              resolve(ru);
            },
          );
        });

        const hash = responseUrl.split("#")[1] || "";
        const token = new URLSearchParams(hash).get("access_token");
        if (!token) throw new Error("No access token in OAuth response");

        const credential = GoogleAuthProvider.credential(null, token);
        const result = await signInWithCredential(auth, credential);

        // Ensure the user document exists
        try {
          const userRef = doc(db, "users", result.user.uid);
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            await setDoc(userRef, {
              uid: result.user.uid,
              email: result.user.email,
              displayName: result.user.displayName,
              photoURL: result.user.photoURL,
              createdAt: Date.now(),
              lastLoginAt: Date.now(),
            });
          }
        } catch (e) {
          console.warn("googleSignIn: setDoc failed", e?.message);
        }

        sendResponse({ success: true, uid: result.user.uid });
      } catch (err) {
        console.error("googleSignIn failed:", err?.message);
        sendResponse({ success: false, error: err?.message || "Sign-in failed" });
      }
    })();
    return true; // keep the message channel open for the async response
  }

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

  // Clear badge when popup opens
  if (message.type === "clearBadge") {
    clearBadge();
    sendResponse({ success: true });
  }

  // Popup closed — SW resumes badge management from cache
  if (message.type === "popupClosed") {
    popupIsOpen = false;
    sendResponse({ success: true });
  }

  // Sync badge to the real unread count (sent by popup's updateTabBadges)
  if (message.type === "syncBadge") {
    popupIsOpen = true;
    // Clear the SW's live unread tracking so getLiveUnreadCount() aligns with
    // the popup's authoritative view. Without this, setBadgeCountFromCache uses
    // Math.max(popupCount, swLiveCount) and the badge never drops below the SW's
    // accumulated count (e.g. 20) even when popup shows only 1 notification.
    // The next onSnapshot callback will rebuild unreadIdsBySource from scratch.
    unreadIdsBySource.clear();
    setBadgeCount(message.count);
    sendResponse({ success: true });
  }

  // Clear seen notifications (for troubleshooting)
  if (message.type === "clearSeenNotifications") {
    seenNotifications.clear();
    recentNotificationFingerprints = {};
    chrome.storage.local.remove([
      "seenNotifications",
      "lastNotificationTimestamp",
      "recentNotificationFingerprints",
    ]);
    sendResponse({ success: true });
  }

  // Restart listeners manually
  if (message.type === "restartListening") {
    startListening(true);
    sendResponse({ success: true, listening: true });
  }

  // Fetch Insights data directly from Firestore for a specific date range.
  // Bypasses the per-machine chrome.storage.local cache so results are consistent
  // across all computers regardless of when the extension was installed.
  if (message.type === "fetchInsightsData") {
    const { fromTs, toTs } = message;
    fetchInsightsFromFirestore(fromTs, toTs)
      .then((data) => sendResponse({ success: true, ...data }))
      .catch((err) => sendResponse({ success: false, error: err?.message || "Unknown error" }));
    return true; // keep channel open for async response
  }

  // Refresh popup cache on demand (called by Insights Apply button)
  if (message.type === "requestCacheRefresh") {
    refreshPopupCache()
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true; // keep channel open for async response
  }

  return true;
});
