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
import { showToast, showConfirmDialog } from "../ui/toasts.js";
import {
  formatTime,
  getNotificationIcon,
  escapeHtml,
} from "../utils/helpers.js";
import { renderAppIcon } from "../utils/appIcons.js";
import * as state from "../state/index.js";
import { updateTabBadges } from "./badges.js";
import { getCurrentLanguage } from "../utils/i18n.js";
import { getCachedNotifications, cacheNotificationsData } from "./cache.js";
import { decryptNotification } from "./cryptoService.js";

// ── Selection mode state ──────────────────────────────────────────────────────
let notifSelectionMode = false;
let selectedNotifApps = new Set(); // keyed by app key (packageName or appName)

function _updateNotifSelectionToolbar(totalApps) {
  const deleteBtn = document.getElementById("deleteAllNotifBtn");
  const countSpan = document.getElementById("notifSelectedCount");
  const selectAllCb = document.getElementById("notifSelectAll");
  if (deleteBtn) deleteBtn.disabled = selectedNotifApps.size === 0;
  if (countSpan) countSpan.textContent = selectedNotifApps.size;
  if (selectAllCb) {
    selectAllCb.checked = selectedNotifApps.size === totalApps && totalApps > 0;
    selectAllCb.indeterminate = selectedNotifApps.size > 0 && selectedNotifApps.size < totalApps;
  }
}

export async function loadNotifications() {
  const user = state.currentUser;
  if (!user) return;

  // === STEP 1: Show cached notifications instantly ===
  try {
    const cached = await getCachedNotifications();
    if (cached && cached.byDevice) {
      // Skip cache if it still contains encrypted data (ENC: prefix)
      const firstNotif = Object.values(cached.byDevice).flat()[0];
      const isEncrypted =
        firstNotif &&
        (String(firstNotif.title || "").startsWith("ENC:") ||
          String(firstNotif.body || "").startsWith("ENC:") ||
          String(firstNotif.text || "").startsWith("ENC:"));
      if (isEncrypted) {
        console.log("[Notifications] 🔑 Cache has encrypted data — skipping, waiting for fresh decrypted data");
        // Skip stale encrypted cache; fresh decrypted data will arrive via onSnapshot
      } else {
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
          console.log("[Notifications] 📦 Showed cached notifications instantly");
        }
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

  const userNotifUnsub = onSnapshot(userNotificationsQuery, async (snapshot) => {
    const notifications = await Promise.all(
      snapshot.docs.map(async (doc) => {
        let data = doc.data();
        data = await decryptNotification(data, user.uid);
        const firestoreId = doc.id;
        return {
          ...data,
          id: firestoreId,
          deviceId: data.deviceId || "user",
          receivedAt: data.timestamp || data.createdAt?.toMillis?.() || Date.now(),
        };
      }),
    );
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
      async (snapshot) => {
        const notifications = await Promise.all(
          snapshot.docs.map(async (docSnap) => {
            let data = docSnap.data();
            data = await decryptNotification(data, user.uid);
            const firestoreId = docSnap.id;
            console.log(
              `[Notifications] Loaded: id=${firestoreId}, read=${data.read}, title=${data.title?.substring(0, 20)}`,
            );
            return {
              ...data,
              id: firestoreId,
              deviceId: device.id,
              deviceName: device.name,
            };
          }),
        );
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

function resolveDeviceName(notif) {
  if (notif.deviceName) return notif.deviceName;
  if (!notif.deviceId || notif.deviceId === "user" || notif.deviceId === "_user_notifications") return null;
  const device = state.devices.find((d) => d.id === notif.deviceId);
  if (!device) return null;
  return device.nickname || device.name || null;
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

  const notifUnreadCb = document.getElementById("notifShowUnread");
  if (notifUnreadCb) {
    notifUnreadCb.addEventListener("change", () => {
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

  // Auto-mark all unread notifications in this group as read
  const unreadInGroup = notifications.filter(n => !n.read);
  if (unreadInGroup.length > 0) {
    unreadInGroup.forEach(n => markNotificationAsRead(n.deviceId, n.id));
  }

  detailList.innerHTML = notifications.map(notif => `
    <div class="notif-detail-bubble ${notif.read ? "" : "unread"}"
         data-notif-id="${notif.id}" data-device-id="${notif.deviceId}">
      <div class="notif-bubble-title">${escapeHtml(notif.title || notif.appName || "Notification")}${notif.read ? "" : ' <span class="unread-dot">●</span>'}</div>
      <div class="notif-bubble-body">${escapeHtml(notif.text || notif.body || "")}</div>
      <div class="notif-bubble-footer">
        ${resolveDeviceName(notif) ? `<span class="notification-device">📱 ${escapeHtml(resolveDeviceName(notif))}</span>` : `<span></span>`}
        <span class="notif-bubble-time">${formatTime(notif.receivedAt || notif.timestamp)}</span>
      </div>
    </div>
  `).join("");

  const isWhatsApp = appKey && (appKey.includes("whatsapp") || appKey.includes("WhatsApp"));

  detailList.querySelectorAll(".notif-detail-bubble").forEach(item => {
    item.addEventListener("click", async () => {
      const notifId = item.dataset.notifId;
      const deviceId = item.dataset.deviceId;
      if (notifId && deviceId) {
        await markNotificationAsRead(deviceId, notifId);
        item.classList.remove("unread");
        item.querySelector(".unread-dot")?.remove();
      }
      if (isWhatsApp) {
        const title = item.querySelector(".notif-bubble-title")?.textContent?.trim() || "";
        const cleanTitle = title.replace(/●/g, "").trim();
        const phoneMatch = cleanTitle.match(/^\+?[\d\s\-().]{7,20}$/);
        if (phoneMatch) {
          const phone = cleanTitle.replace(/[^\d+]/g, "");
          window.open(`https://wa.me/${phone.startsWith("+") ? phone.slice(1) : phone}`, "_blank");
        } else {
          window.open("https://web.whatsapp.com/", "_blank");
        }
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
  scheduleRender();
  updateTabBadges();
}

let _renderTimer = null;
function scheduleRender() {
  if (_renderTimer) clearTimeout(_renderTimer);
  _renderTimer = setTimeout(() => {
    _renderTimer = null;
    const merged = getMergedNotifications();
    const selectedDevice =
      document.querySelector("#notificationsDeviceTabs .device-tab.active")?.dataset.device || "all";
    const filtered =
      selectedDevice === "all"
        ? merged
        : merged.filter((n) => n.deviceId === selectedDevice);
    renderNotifications(filtered.slice(0, 200));
  }, 80);
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

  // Apply unread filter
  let groupEntries = Object.entries(groups);
  if (document.getElementById("notifShowUnread")?.checked) {
    groupEntries = groupEntries.filter(([, group]) => group.items.some(n => !n.read));
  }

  if (groupEntries.length === 0) {
    notificationsList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        <p>No unread notifications</p>
        <span>All notifications have been read</span>
      </div>
    `;
    updateTabBadges();
    return;
  }

  notificationsList.innerHTML = groupEntries.map(([key, group]) => {
    const latest = group.items[0];
    const unreadCount = group.items.filter(n => !n.read).length;
    const hasUnread = unreadCount > 0;
    const isSelected = notifSelectionMode && selectedNotifApps.has(key);
    // Find device name from any item in the group (latest may be a user-level entry with no deviceName)
    const groupDeviceName = resolveDeviceName(latest) || group.items.map(resolveDeviceName).find(Boolean) || null;
    return `
      <div class="list-item notification-item ${hasUnread ? "unread" : ""}${isSelected ? " selected" : ""}"
           data-app-key="${escapeHtml(key)}"
           data-app-name="${escapeHtml(group.appName)}">
        ${notifSelectionMode ? `<div class="conv-checkbox-wrap"><input type="checkbox" class="notif-checkbox" ${isSelected ? "checked" : ""} tabindex="-1" /></div>` : ""}
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
            ${unreadCount > 0 ? `${unreadCount} unread` : ""}
            ${groupDeviceName ? `<span class="notification-device">📱 ${escapeHtml(groupDeviceName)}</span>` : ""}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          <span class="list-item-time">${formatTime(latest.receivedAt || latest.timestamp)}</span>
          ${unreadCount > 1 ? `<span class="tab-badge" style="position:static;display:inline-block;">${unreadCount}</span>` : ""}
        </div>
      </div>
    `;
  }).join("");

  const appKeys = groupEntries.map(([key]) => key);

  // Click → toggle selection or show detail
  notificationsList.querySelectorAll(".notification-item").forEach(item => {
    item.addEventListener("click", () => {
      const key = item.dataset.appKey;
      if (notifSelectionMode) {
        const cb = item.querySelector(".notif-checkbox");
        if (selectedNotifApps.has(key)) {
          selectedNotifApps.delete(key);
          item.classList.remove("selected");
          if (cb) cb.checked = false;
        } else {
          selectedNotifApps.add(key);
          item.classList.add("selected");
          if (cb) cb.checked = true;
        }
        _updateNotifSelectionToolbar(appKeys.length);
        return;
      }
      const name = item.dataset.appName;
      const group = groups[key];
      if (group) showNotifDetail(key, name, group.items);
    });
  });

  _updateNotifSelectionToolbar(appKeys.length);

  // Long-press to enter selection mode
  let notifLongPressTimer = null;
  notificationsList.addEventListener("pointerdown", (e) => {
    const item = e.target.closest(".notification-item");
    if (!item || notifSelectionMode) return;
    notifLongPressTimer = setTimeout(() => {
      notifLongPressTimer = null;
      const key = item.dataset.appKey;
      notifSelectionMode = true;
      selectedNotifApps.clear();
      document.getElementById("notifSelectBtn")?.classList.add("active");
      const toolbar = document.getElementById("notifSelectToolbar");
      if (toolbar) toolbar.style.display = "flex";
      reRenderNotifications();
      setTimeout(() => {
        const el = document.querySelector(`.notification-item[data-app-key="${CSS.escape(key)}"]`);
        if (el) {
          selectedNotifApps.add(key);
          el.classList.add("selected");
          const cb = el.querySelector(".notif-checkbox");
          if (cb) cb.checked = true;
          _updateNotifSelectionToolbar(document.querySelectorAll(".notification-item[data-app-key]").length);
        }
      }, 0);
    }, 500);
  });
  notificationsList.addEventListener("pointerup", () => { if (notifLongPressTimer) { clearTimeout(notifLongPressTimer); notifLongPressTimer = null; } });
  notificationsList.addEventListener("pointercancel", () => { if (notifLongPressTimer) { clearTimeout(notifLongPressTimer); notifLongPressTimer = null; } });
  notificationsList.addEventListener("pointermove", () => { if (notifLongPressTimer) { clearTimeout(notifLongPressTimer); notifLongPressTimer = null; } });

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
 * Update Firestore notifications as read — uses batched writes to avoid
 * triggering a separate onSnapshot for every single document.
 */
async function updateFirestoreNotifications(userId, unreadNotifs) {
  // Filter out invalid IDs
  const validNotifs = unreadNotifs.filter(n => n.id && !/^-?\d+$/.test(n.id));
  if (validNotifs.length === 0) return;

  let successCount = 0;
  let failCount = 0;

  // Split into batches of 500 (Firestore limit)
  const BATCH_SIZE = 500;
  for (let i = 0; i < validNotifs.length; i += BATCH_SIZE) {
    const chunk = validNotifs.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((notif) => {
      const deviceId = notif.actualDeviceId;
      let notifRef;
      if (deviceId && deviceId !== "user" && deviceId !== "_user_notifications") {
        notifRef = doc(db, "users", userId, "devices", deviceId, "notifications", notif.id);
      } else {
        notifRef = doc(db, "users", userId, "notifications", notif.id);
      }
      batch.update(notifRef, { read: true });
    });
    try {
      await batch.commit();
      successCount += chunk.length;
    } catch (e) {
      failCount += chunk.length;
      console.warn(`[Notifications] Batch update failed: ${e.message}`);
    }
  }

  console.log(`[Notifications] Done: ${successCount} success, ${failCount} failed`);
}

/**
 * Clear notifications from Firestore and local state for the selected device (or all)
 */
export async function clearAllNotifications() {
  const user = state.currentUser;
  if (!user) return;

  const selectedTab =
    document.querySelector("#notificationsDeviceTabs .device-tab.active")?.dataset.device || "all";
  const isAll = selectedTab === "all";
  const isAr = getCurrentLanguage() === "ar";
  const confirmMsg = isAll
    ? (isAr ? "حذف الإشعارات لجميع الأجهزة؟ لا يمكن التراجع." : "Clear notifications for ALL devices? This cannot be undone.")
    : (isAr ? "حذف إشعارات الجهاز المحدد؟ لا يمكن التراجع." : "Clear notifications for the selected device? This cannot be undone.");

  if (!(await showConfirmDialog(confirmMsg))) return;

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

// ── Selection mode exports ────────────────────────────────────────────────────

/** Toggle notifications selection mode on/off */
export function toggleNotifSelectionMode() {
  notifSelectionMode = !notifSelectionMode;
  selectedNotifApps.clear();

  const selectBtn = document.getElementById("notifSelectBtn");
  const toolbar = document.getElementById("notifSelectToolbar");

  if (notifSelectionMode) {
    selectBtn?.classList.add("active");
    if (toolbar) toolbar.style.display = "flex";
  } else {
    selectBtn?.classList.remove("active");
    if (toolbar) toolbar.style.display = "none";
  }
  reRenderNotifications();
  _updateNotifSelectionToolbar(document.querySelectorAll(".notification-item[data-app-key]").length);
}

/** Toggle select-all for visible notification app groups */
export function setNotifSelectAll(checked) {
  const items = document.querySelectorAll(".notification-item[data-app-key]");
  items.forEach((el) => {
    const key = el.dataset.appKey;
    const cb = el.querySelector(".notif-checkbox");
    if (checked) {
      selectedNotifApps.add(key);
      el.classList.add("selected");
      if (cb) cb.checked = true;
    } else {
      selectedNotifApps.delete(key);
      el.classList.remove("selected");
      if (cb) cb.checked = false;
    }
  });
  _updateNotifSelectionToolbar(items.length);
}

/** Delete all selected notification app groups from Firestore */
export async function deleteSelectedNotifications() {
  if (selectedNotifApps.size === 0) return;
  const count = selectedNotifApps.size;
  const isAr = getCurrentLanguage() === "ar";
  if (!(await showConfirmDialog(isAr
    ? `حذف إشعارات ${count} تطبيق؟ لا يمكن التراجع.`
    : `Delete notifications for ${count} app${count > 1 ? "s" : ""}? This cannot be undone.`
  ))) return;

  const user = state.currentUser;
  if (!user) return;

  try {
    const batch = writeBatch(db);
    let deletedCount = 0;
    Object.entries(state.allNotifications).forEach(([deviceKey, notifs]) => {
      notifs.forEach((n) => {
        const appKey = n.packageName || n.appName || "unknown";
        if (!selectedNotifApps.has(appKey) || !n.id || /^-?\d+$/.test(n.id)) return;
        const deviceId = n.deviceId || deviceKey;
        let notifRef;
        if (deviceId && deviceId !== "user" && deviceId !== "_user_notifications") {
          notifRef = doc(db, "users", user.uid, "devices", deviceId, "notifications", n.id);
        } else {
          notifRef = doc(db, "users", user.uid, "notifications", n.id);
        }
        batch.delete(notifRef);
        deletedCount++;
      });
    });
    if (deletedCount > 0) await batch.commit();

    // Update local state
    Object.keys(state.allNotifications).forEach((deviceKey) => {
      const filtered = (state.allNotifications[deviceKey] || []).filter((n) => {
        const appKey = n.packageName || n.appName || "unknown";
        return !selectedNotifApps.has(appKey);
      });
      state.setNotificationsData(deviceKey, filtered);
    });
    showToast(`Deleted notifications for ${count} app${count > 1 ? "s" : ""}`, "success");
  } catch (error) {
    console.error("[Notifications] deleteSelectedNotifications error:", error);
    showToast("Failed to delete selected notifications", "error");
  }

  // Exit selection mode
  notifSelectionMode = false;
  selectedNotifApps.clear();
  document.getElementById("notifSelectBtn")?.classList.remove("active");
  const toolbar = document.getElementById("notifSelectToolbar");
  if (toolbar) toolbar.style.display = "none";
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
  const csv = "\uFEFF" + [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `iRopit-Notifications-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
