/**
 * Notifications Service
 * Handles app notifications loading and rendering
 */

import {
  db,
  collection,
  getDocs,
  doc,
  deleteDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "../config/firebase.js";

import { notificationsList } from "../ui/dom.js";
import {
  formatTime,
  getNotificationIcon,
  escapeHtml,
} from "../utils/helpers.js";
import { renderAppIcon } from "../utils/appIcons.js";
import * as state from "../state/index.js";
import { updateTabBadges } from "./badges.js";
import { getCachedNotifications, cacheNotificationsData } from "./cache.js";

export async function loadNotifications() {
  const user = state.currentUser;
  if (!user) return;

  // === STEP 1: Show cached notifications instantly ===
  try {
    const cached = await getCachedNotifications();
    if (cached && cached.byDevice) {
      let hasData = false;
      for (const [deviceId, notifs] of Object.entries(cached.byDevice)) {
        if (notifs.length > 0) {
          state.setNotificationsData(deviceId, notifs);
          hasData = true;
        }
      }
      if (hasData) {
        const merged = getMergedNotifications();
        renderNotifications(merged.slice(0, 200));
        updateTabBadges();
        // Hide the loading spinner since we showed cached data
        if (notificationsList && notificationsList.querySelector('.loading-spinner')) {
          // spinner will be replaced by the rendered list above
        }
        console.log("[Notifications] 📦 Showed cached notifications instantly");
      }
    }
  } catch (e) {
    console.warn("[Notifications] Cache load failed:", e);
  }

  const userNotificationsQuery = query(
    collection(db, "users", user.uid, "notifications"),
    orderBy("createdAt", "desc"),
    limit(200),
  );

  const userNotifUnsub = onSnapshot(userNotificationsQuery, (snapshot) => {
    const notifications = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const firestoreId = doc.id; // Save the actual Firestore document ID
      notifications.push({
        ...data,
        id: firestoreId, // Use Firestore ID, not data.id
        deviceId: "user",
        receivedAt:
          data.timestamp || data.createdAt?.toMillis?.() || Date.now(),
      });
    });
    updateNotificationsList("_user_notifications", notifications);
    // Persist to cache after each update
    cacheNotificationsData(state.allNotifications).catch(() => {});
  });
  state.addUnsubscriber(userNotifUnsub);

  // === STEP 2: Fetch devices and subscribe to device notifications ===
  const devicesQuery = query(
    collection(db, "devices"),
    where("userId", "==", user.uid),
  );

  const devicesSnapshot = await getDocs(devicesQuery);
  const devicesList = [];
  devicesSnapshot.forEach((doc) => {
    const data = doc.data();
    let friendlyName = data.nickname;
    if (!friendlyName) {
      if (
        data.name &&
        /[a-zA-Z]/.test(data.name) &&
        !/^[A-Z0-9]+$/.test(data.name)
      ) {
        friendlyName = data.name;
      } else {
        const platform = (data.platform || "").toLowerCase();
        friendlyName =
          platform === "ios"
            ? "iPhone"
            : platform === "android"
              ? "Android"
              : "Device";
      }
    }
    devicesList.push({
      id: data.id,
      name: friendlyName,
    });
  });

  // Subscribe to notifications from each device
  devicesList.forEach((device) => {
    const q = query(
      collection(db, "users", user.uid, "devices", device.id, "notifications"),
      orderBy("timestamp", "desc"),
      limit(200),
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const notifications = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const firestoreId = docSnap.id; // Save the actual Firestore document ID
          console.log(
            `[Notifications] Loaded: id=${firestoreId}, read=${data.read}, title=${data.title?.substring(0, 20)}`,
          );
          notifications.push({
            ...data,
            id: firestoreId, // Use Firestore ID, not data.id
            deviceId: device.id,
            deviceName: device.name,
          });
        });
        updateNotificationsList(device.id, notifications);
        // Persist to cache after each device update
        cacheNotificationsData(state.allNotifications).catch(() => {});
      },
      // (error) => {
      //   console.error(
      //     "❌ Error loading notifications for device",
      //     device.id,
      //     ":",
      //     error,
      //   );
      // },
    );

    state.addUnsubscriber(unsub);
  });
}

function getMergedNotifications() {
  let merged = [];
  Object.values(state.allNotifications).forEach((notifs) => {
    merged = merged.concat(notifs);
  });
  const seen = new Set();
  merged = merged.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
  merged.sort((a, b) => {
    const timeA = a.receivedAt || a.timestamp || 0;
    const timeB = b.receivedAt || b.timestamp || 0;
    return timeB - timeA;
  });
  return merged;
}

export function reRenderNotifications() {
  const merged = getMergedNotifications();
  const selectedDevice =
    document.querySelector("#notificationsDeviceTabs .device-tab.active")?.dataset.device || "all";
  const filtered =
    selectedDevice === "all"
      ? merged
      : merged.filter((n) => n.deviceId === selectedDevice);
  renderNotifications(filtered.slice(0, 200));
}

// ─── Search & Detail wiring (runs once after DOM is ready) ────────────────────
let _searchWired = false;
function wireSearchAndDetail() {
  if (_searchWired) return;
  _searchWired = true;

  const searchInput = document.getElementById("notifSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      reRenderNotifications();
    });
  }

  document.getElementById("notifBackBtn")?.addEventListener("click", () => {
    hideNotifDetail();
  });
}

function getSearchQuery() {
  return (document.getElementById("notifSearchInput")?.value || "").trim().toLowerCase();
}

function showNotifDetail(appKey, appName, notifications) {
  const mainView = document.getElementById("notifMainView");
  const detailView = document.getElementById("notifDetailView");
  const detailList = document.getElementById("notifDetailList");
  const detailTitle = document.getElementById("notifDetailTitle");
  if (!mainView || !detailView || !detailList) return;

  detailTitle.textContent = appName;
  mainView.style.display = "none";
  detailView.style.display = "flex";

  detailList.innerHTML = notifications.map(notif => `
    <div class="notif-detail-bubble ${notif.read ? "" : "unread"}"
         data-notif-id="${notif.id}" data-device-id="${notif.deviceId}">
      <div class="notif-bubble-title">${escapeHtml(notif.title || notif.appName || "Notification")}${notif.read ? "" : ' <span class="unread-dot">●</span>'}</div>
      <div class="notif-bubble-body">${escapeHtml(notif.text || notif.body || "")}</div>
      ${notif.deviceName ? `<div class="notif-bubble-time">📱 ${escapeHtml(notif.deviceName)} · ${formatTime(notif.receivedAt || notif.timestamp)}</div>` : `<div class="notif-bubble-time">${formatTime(notif.receivedAt || notif.timestamp)}</div>`}
    </div>
  `).join("");

  detailList.querySelectorAll(".notif-detail-bubble").forEach(item => {
    item.addEventListener("click", async () => {
      const notifId = item.dataset.notifId;
      const deviceId = item.dataset.deviceId;
      if (notifId && deviceId) {
        await markNotificationAsRead(deviceId, notifId);
        item.classList.remove("unread");
        item.querySelector(".unread-dot")?.remove();
      }
    });
  });
}

function hideNotifDetail() {
  const mainView = document.getElementById("notifMainView");
  const detailView = document.getElementById("notifDetailView");
  if (!mainView || !detailView) return;
  detailView.style.display = "none";
  mainView.style.display = "flex";
}

function updateNotificationsList(deviceId, newNotifications) {
  state.setNotificationsData(deviceId, newNotifications);
  const merged = getMergedNotifications();

  const selectedDevice =
    document.querySelector("#notificationsDeviceTabs .device-tab.active")?.dataset.device || "all";
  const filtered =
    selectedDevice === "all"
      ? merged
      : merged.filter((n) => n.deviceId === selectedDevice);

  renderNotifications(filtered.slice(0, 200));
  updateTabBadges();
}

/**
 * Render notifications list — grouped by app, with search filter.
 * @param {Array} notifications - Array of notifications
 */
function renderNotifications(notifications) {
  wireSearchAndDetail();

  // Apply search filter
  const q = getSearchQuery();
  if (q) {
    notifications = notifications.filter(n =>
      (n.title || "").toLowerCase().includes(q) ||
      (n.text || "").toLowerCase().includes(q) ||
      (n.appName || "").toLowerCase().includes(q) ||
      (n.body || "").toLowerCase().includes(q)
    );
  }

  if (notifications.length === 0) {
    notificationsList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        <p>${q ? 'No results for "' + q + '"' : "No notifications yet"}</p>
        <span>${q ? "Try a different search term" : "Notifications from your phone will appear here"}</span>
      </div>
    `;
    updateTabBadges();
    return;
  }

  // Group by app (packageName or appName)
  const groups = {};
  notifications.forEach(n => {
    const key = n.packageName || n.appName || "unknown";
    if (!groups[key]) groups[key] = { appName: n.appName || "Unknown App", packageName: n.packageName, appIcon: n.appIcon, items: [] };
    groups[key].items.push(n);
  });

  notificationsList.innerHTML = Object.entries(groups).map(([key, group]) => {
    const latest = group.items[0];
    const unreadCount = group.items.filter(n => !n.read).length;
    const hasUnread = unreadCount > 0;
    return `
      <div class="list-item notification-item ${hasUnread ? "unread" : ""}"
           data-app-key="${escapeHtml(key)}"
           data-app-name="${escapeHtml(group.appName)}">
        <div class="list-item-icon notification-icon">
          ${renderAppIcon(group.packageName, group.appIcon, 40)}
        </div>
        <div class="list-item-content">
          <div class="list-item-title">
            ${escapeHtml(group.appName)}
            ${hasUnread ? `<span class="unread-dot">●</span>` : ""}
          </div>
          <div class="list-item-subtitle">${escapeHtml(latest.title || latest.text || "")}</div>
          <div class="notification-app">
            ${group.items.length} notification${group.items.length > 1 ? "s" : ""}
            ${latest.deviceName ? `<span class="notification-device">📱 ${escapeHtml(latest.deviceName)}</span>` : ""}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          <span class="list-item-time">${formatTime(latest.receivedAt || latest.timestamp)}</span>
          ${unreadCount > 1 ? `<span class="tab-badge" style="position:static;display:inline-block;">${unreadCount}</span>` : ""}
        </div>
      </div>
    `;
  }).join("");

  // Click → show detail view for that app group
  notificationsList.querySelectorAll(".notification-item").forEach(item => {
    item.addEventListener("click", () => {
      const key = item.dataset.appKey;
      const name = item.dataset.appName;
      const group = groups[key];
      if (group) showNotifDetail(key, name, group.items);
    });
  });

  // Wire the "Clear All" button (use onclick to avoid stacking listeners on re-renders)
  const clearNotifBtn = document.getElementById("clearAllNotifBtn");
  if (clearNotifBtn) clearNotifBtn.onclick = clearAllNotifications;

  updateTabBadges();
}

async function markNotificationAsRead(deviceId, notifId) {
  const user = state.currentUser;
  if (!user) return;

  if (!notifId || /^-?\d+$/.test(notifId)) {
    Object.keys(state.allNotifications).forEach((key) => {
      const updated = state.allNotifications[key].map((n) =>
        n.id === notifId ? { ...n, read: true } : n,
      );
      state.setNotificationsData(key, updated);
    });
    updateTabBadges();
    return;
  }

  try {
    if (deviceId && deviceId !== "user" && deviceId !== "_user_notifications") {
      const notifRef = doc(
        db,
        "users",
        user.uid,
        "devices",
        deviceId,
        "notifications",
        notifId,
      );
      await updateDoc(notifRef, { read: true });
    } else {
      const notifRef = doc(db, "users", user.uid, "notifications", notifId);
      await updateDoc(notifRef, { read: true });
    }

    Object.keys(state.allNotifications).forEach((key) => {
      const updated = state.allNotifications[key].map((n) =>
        n.id === notifId ? { ...n, read: true } : n,
      );
      state.setNotificationsData(key, updated);
    });
    updateTabBadges();
  } catch (error) {
    Object.keys(state.allNotifications).forEach((key) => {
      const updated = state.allNotifications[key].map((n) =>
        n.id === notifId ? { ...n, read: true } : n,
      );
      state.setNotificationsData(key, updated);
    });
    updateTabBadges();
  }
}

/**
 * Mark all notifications as read when entering notifications tab
 */
export async function markAllNotificationsAsRead() {
  const user = state.currentUser;
  if (!user) return;

  // Get all unread notifications with their correct deviceId
  let unreadNotifs = [];
  Object.entries(state.allNotifications).forEach(([stateKey, notifs]) => {
    notifs.forEach((n) => {
      if (!n.read) {
        // Use the deviceId stored in the notification itself, fallback to stateKey
        const actualDeviceId = n.deviceId || stateKey;
        unreadNotifs.push({ ...n, actualDeviceId });
      }
    });
  });

  console.log(
    `[Notifications] Found ${unreadNotifs.length} unread notifications to mark`,
  );

  if (unreadNotifs.length === 0) return;

  // Update local state IMMEDIATELY (for instant UI update)
  Object.keys(state.allNotifications).forEach((key) => {
    const updated = state.allNotifications[key].map((n) => ({
      ...n,
      read: true,
    }));
    state.setNotificationsData(key, updated);
  });

  // Update badge IMMEDIATELY
  updateTabBadges();

  // Re-render notifications list
  reRenderNotifications();

  // Update Firestore - await to ensure completion
  await updateFirestoreNotifications(user.uid, unreadNotifs);
}

/**
 * Update Firestore notifications as read
 */
async function updateFirestoreNotifications(userId, unreadNotifs) {
  let successCount = 0;
  let failCount = 0;

  const promises = unreadNotifs.map(async (notif) => {
    // Skip numeric-only IDs (not valid Firestore docs)
    if (/^-?\d+$/.test(notif.id)) {
      console.log(`[Notifications] Skipping numeric ID: ${notif.id}`);
      return;
    }

    const deviceId = notif.actualDeviceId;

    try {
      if (
        deviceId &&
        deviceId !== "user" &&
        deviceId !== "_user_notifications"
      ) {
        const notifRef = doc(
          db,
          "users",
          userId,
          "devices",
          deviceId,
          "notifications",
          notif.id,
        );
        await updateDoc(notifRef, { read: true });
        successCount++;
      } else {
        const notifRef = doc(db, "users", userId, "notifications", notif.id);
        await updateDoc(notifRef, { read: true });
        successCount++;
      }
    } catch (e) {
      failCount++;
      console.warn(`[Notifications] Failed ${notif.id}: ${e.message}`);
    }
  });

  await Promise.all(promises);
  console.log(
    `[Notifications] Done: ${successCount} success, ${failCount} failed`,
  );
}

/**
 * Clear notifications from Firestore and local state for the selected device (or all)
 */
async function clearAllNotifications() {
  const user = state.currentUser;
  if (!user) return;

  const selectedTab =
    document.querySelector("#notificationsDeviceTabs .device-tab.active")?.dataset.device || "all";
  const isAll = selectedTab === "all";
  const confirmMsg = isAll
    ? "Clear notifications for ALL devices? This cannot be undone."
    : "Clear notifications for the selected device? This cannot be undone.";

  if (!confirm(confirmMsg)) return;

  const targetKeys = isAll
    ? Object.keys(state.allNotifications)
    : Object.keys(state.allNotifications).filter((key) => {
        const notifs = state.allNotifications[key] || [];
        return notifs.some((n) => (n.deviceId || key) === selectedTab);
      });

  try {
    for (const deviceKey of targetKeys) {
      const notifs = (state.allNotifications[deviceKey] || []).filter(
        (n) => isAll || (n.deviceId || deviceKey) === selectedTab
      );
      if (notifs.length === 0) continue;
      const batch = writeBatch(db);
      notifs.forEach((n) => {
        if (!n.id || /^-?\d+$/.test(n.id)) return;
        const deviceId = n.deviceId || deviceKey;
        let notifRef;
        if (deviceId && deviceId !== "user" && deviceId !== "_user_notifications") {
          notifRef = doc(db, "users", user.uid, "devices", deviceId, "notifications", n.id);
        } else {
          notifRef = doc(db, "users", user.uid, "notifications", n.id);
        }
        batch.delete(notifRef);
      });
      await batch.commit();
    }
  } catch (error) {
    console.error("[Notifications] Failed to delete from Firestore:", error);
  }

  // Update local state — remove cleared notifications
  if (isAll) {
    state.clearAllNotifications();
  } else {
    Object.keys(state.allNotifications).forEach((key) => {
      const filtered = (state.allNotifications[key] || []).filter(
        (n) => (n.deviceId || key) !== selectedTab
      );
      state.setNotificationsData(key, filtered);
    });
  }

  reRenderNotifications();
  updateTabBadges();
}

/**
 * Export notifications to CSV
 */
export function exportNotificationsToCSV() {
  let notifications = getMergedNotifications();
  if (notifications.length === 0) {
    alert("No notifications to export.");
    return;
  }
  const header = ["Date", "Time", "App", "Title", "Body", "Device"];
  const rows = notifications.map((n) => {
    const d = new Date(n.receivedAt || n.timestamp || 0);
    const date = d.toLocaleDateString("en-GB");
    const time = d.toLocaleTimeString();
    const app = n.appName || n.packageName || "";
    const title = n.title || "";
    const body = n.text || n.body || "";
    const device = n.deviceName || "";
    return [date, time, app, title, body, device].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
  });
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `iRopit-Notifications-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
