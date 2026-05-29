/**
 * Device Management Service
 */

import {
  db,
  auth,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  onSnapshot,
  signOut,
  addDoc,
} from "../config/firebase.js";

import { devicesList } from "../ui/dom.js";
import { showToast, showLoadingOverlay, hideLoading, showConfirmDialog } from "../ui/toasts.js";
import {
  formatTime,
  getDeviceId,
  getPlatformIcon,
  getFriendlyDeviceName,
  escapeHtml,
} from "../utils/helpers.js";
import { getCurrentLanguage, translations } from "../utils/i18n.js";

function t(key) {
  const lang = getCurrentLanguage();
  return translations[lang]?.[key] || translations["en"][key] || key;
}
import * as state from "../state/index.js";

// ── Per-device version cache ──────────────────────────────────────────────────
// Persists the last known appVersion for each device so it can be shown even
// when the device is offline or the field is missing from the Firestore doc.
const _deviceVersionCache = {};

async function _loadVersionCache() {
  try {
    const result = await chrome.storage.local.get("deviceVersionCache");
    if (result.deviceVersionCache && typeof result.deviceVersionCache === "object") {
      Object.assign(_deviceVersionCache, result.deviceVersionCache);
    }
  } catch (_) {}
}

function _saveVersionCache() {
  try {
    chrome.storage.local.set({ deviceVersionCache: { ..._deviceVersionCache } });
  } catch (_) {}
}

// ── Per-device sync preferences ───────────────────────────────────────────────
// { [deviceId]: { sms: bool, calls: bool, notifications: bool } }

async function loadDeviceSyncPrefs() {
  try {
    const result = await chrome.storage.local.get("deviceSyncPrefs");
    state.setDeviceSyncPrefs(result.deviceSyncPrefs || {});
  } catch (_) {}
}

async function saveDeviceSyncPref(deviceId, type, value) {
  try {
    const prefs = { ...state.deviceSyncPrefs };
    if (!prefs[deviceId]) prefs[deviceId] = {};
    prefs[deviceId][type] = value;
    state.setDeviceSyncPrefs(prefs);
    await chrome.storage.local.set({ deviceSyncPrefs: prefs });
  } catch (_) {}
}
import { updateInsightsDeviceTabs } from "../ui/dashboard.js";
import { reRenderNotifications } from "./notifications.js";
import { renderCalls } from "./calls.js";
import { renderSMS } from "./sms.js";

/**
 * Register this extension as a device
 */
export async function registerDevice() {
  const user = state.currentUser;
  if (!user) return;

  try {
    // Pass user.uid so each account gets its own persistent device ID
    const deviceId = await getDeviceId(user.uid);

    const deviceData = {
      id: deviceId,
      userId: user.uid,
      name: "Chrome Extension",
      type: "chrome-extension",
      platform: "chrome-extension",
      model: navigator.userAgent,
      lastActiveAt: Date.now(),
      isOnline: true,
    };

    const existingDeviceRef = doc(db, "devices", deviceId);

    // Try merge first (preserves existing fields like nickname)
    try {
      await setDoc(existingDeviceRef, deviceData, { merge: true });
    } catch (mergeError) {
      // merge can fail if doc belongs to another user; overwrite entirely
      console.warn("[Device] merge write failed, overwriting:", mergeError?.code);
      await setDoc(existingDeviceRef, deviceData);
    }

    console.log(`[Device] Registered/updated Chrome extension device: ${deviceId}`);

    // Clean up duplicates fire-and-forget — never block or throw here
    cleanupDuplicateExtensions(user.uid, deviceId).catch((e) =>
      console.warn("[Device] cleanup duplicates failed (non-critical):", e?.code),
    );
  } catch (error) {
    console.error("[Device] registerDevice failed:", error?.code, error?.message);
  }
}

/**
 * Clean up duplicate Chrome extension devices
 * Keep only the current device ID
 */
async function cleanupDuplicateExtensions(userId, currentDeviceId) {
  try {
    const q = query(collection(db, "devices"), where("userId", "==", userId));

    const snapshot = await getDocs(q);
    const toDelete = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const isExtensionDevice =
        data.platform === "chrome-extension" ||
        data.platform === "chrome" ||
        data.type === "chrome-extension" ||
        data.id?.startsWith("ext_") ||
        doc.id?.startsWith("ext_");

      if (
        isExtensionDevice &&
        doc.id !== currentDeviceId &&
        data.id !== currentDeviceId
      ) {
        toDelete.push(doc);
      }
    });

    if (toDelete.length > 0) {
      console.log(
        `[Device] Found ${toDelete.length} duplicate extension device(s), cleaning up...`,
      );
      const batch = writeBatch(db);
      toDelete.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(
        `[Device] Cleaned up ${toDelete.length} duplicate extension device(s)`,
      );
    }
  } catch (error) {
    if (error?.code === "permission-denied") return;
    console.error("[Device] Error cleaning up duplicates:", error);
  }
}

/**
 * Load user's devices
 */
export async function loadDevices() {
  const user = state.currentUser;
  if (!user) return;

  await _loadVersionCache();
  await loadDeviceSyncPrefs();

  const q = query(collection(db, "devices"), where("userId", "==", user.uid));

  const unsub = onSnapshot(
    q,
    (snapshot) => {
      const newDevices = [];
      let cacheUpdated = false;
      snapshot.forEach((doc) => {
        const data = doc.data();
        newDevices.push({ ...data, docId: doc.id });
        // Cache appVersion whenever it is present so offline devices still show it
        if (data.appVersion && data.id && _deviceVersionCache[data.id] !== data.appVersion) {
          _deviceVersionCache[data.id] = data.appVersion;
          cacheUpdated = true;
        }
      });
      if (cacheUpdated) _saveVersionCache();

      state.setDevices(newDevices);
      renderDevices();
      updateDeviceSelects();
    },
    (error) => {
      console.error("[Device] loadDevices onSnapshot error:", error?.code, error?.message);
    },
  );

  state.addUnsubscriber(unsub);

  // ── Subscribe to devices shared WITH the current user ──────────────────────
  const sharesQ = query(
    collection(db, "deviceShares"),
    where("sharedWithUid", "==", user.uid),
  );
  const sharesUnsub = onSnapshot(
    sharesQ,
    async (snapshot) => {
      const shares = [];
      for (const shareDoc of snapshot.docs) {
        const share = { shareId: shareDoc.id, ...shareDoc.data() };
        // Fetch the live device document
        try {
          const deviceSnap = await getDoc(doc(db, "devices", share.deviceDocId));
          share.device = deviceSnap.exists() ? { ...deviceSnap.data(), docId: deviceSnap.id } : null;
        } catch (_) {
          share.device = null;
        }
        shares.push(share);
      }
      state.setSharedWithMeDevices(shares);
      renderDevices();
      updateDeviceSelects(); // Rebuild filter tabs to include shared devices
      // Load SMS/Calls/Notifications data for shared devices
      Promise.all([
        import("./sms.js").then(m => { if (m.loadSharedDevicesSMS) m.loadSharedDevicesSMS(shares); }).catch(() => {}),
        import("./calls.js").then(m => { if (m.loadSharedDevicesCalls) m.loadSharedDevicesCalls(shares); }).catch(() => {}),
        import("./notifications.js").then(m => { if (m.loadSharedDevicesNotifications) m.loadSharedDevicesNotifications(shares); }).catch(() => {}),
      ]);
    },
    (error) => {
      console.error("[Device] shared-with-me snapshot error:", error?.code);
    },
  );
  state.addUnsubscriber(sharesUnsub);

  // ── Own-device shares listener (to show "(Shared)" badge on device list) ──
  const mySharesQ = query(
    collection(db, "deviceShares"),
    where("ownerUid", "==", user.uid),
  );
  const mySharesUnsub = onSnapshot(mySharesQ, (snapshot) => {
    const map = {};
    snapshot.docs.forEach((d) => {
      const data = d.data();
      if (!map[data.deviceId]) map[data.deviceId] = [];
      map[data.deviceId].push({ shareId: d.id, ...data });
    });
    state.setMyDeviceShares(map);
    renderDevices();
  }, () => {});
  state.addUnsubscriber(mySharesUnsub);

  // ── Own pending share requests (to show "(Pending)" badge on device list) ─
  const myPendingReqQ = query(
    collection(db, "deviceShareRequests"),
    where("ownerUid", "==", user.uid),
    where("status", "==", "pending"),
  );
  const myPendingReqUnsub = onSnapshot(myPendingReqQ, (snapshot) => {
    const pendingIds = new Set(snapshot.docs.map((d) => d.data().deviceId));
    state.setMyPendingShareDeviceIds(pendingIds);
    renderDevices();
  }, () => {});
  state.addUnsubscriber(myPendingReqUnsub);

  // ── Incoming share requests listener (recipient side) ─────────────────────
  const incomingReqQ = query(
    collection(db, "deviceShareRequests"),
    where("sharedWithUid", "==", user.uid),
    where("status", "==", "pending"),
  );
  const incomingReqUnsub = onSnapshot(incomingReqQ, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        _showIncomingShareRequestModal({ requestId: change.doc.id, ...change.doc.data() });
      }
    });
  }, () => {});
  state.addUnsubscriber(incomingReqUnsub);

  // ── Outgoing request response listener (owner sees accept/reject) ──────────
  const outgoingRespQ = query(
    collection(db, "deviceShareRequests"),
    where("ownerUid", "==", user.uid),
    where("status", "in", ["accepted", "rejected"]),
  );
  const outgoingRespUnsub = onSnapshot(outgoingRespQ, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added" || change.type === "modified") {
        const req = { requestId: change.doc.id, ...change.doc.data() };
        const isAr = getCurrentLanguage() === "ar";
        if (req.status === "accepted") {
          showToast(
            isAr
              ? `\u0642\u0628\u0650\u0644 ${escapeHtml(req.sharedWithEmail)} \u0637\u0644\u0628 \u0645\u0634\u0627\u0631\u0643\u0629 \u062c\u0647\u0627\u0632\u0643`
              : `${req.sharedWithEmail} accepted your device share request`,
            "success",
          );
        } else {
          showToast(
            isAr
              ? `\u0631\u0641\u0636 ${escapeHtml(req.sharedWithEmail)} \u0637\u0644\u0628 \u0645\u0634\u0627\u0631\u0643\u0629 \u062c\u0647\u0627\u0632\u0643`
              : `${req.sharedWithEmail} declined your device share request`,
            "error",
          );
        }
        deleteDoc(doc(db, "deviceShareRequests", req.requestId)).catch(() => {});
      }
    });
  }, () => {});
  state.addUnsubscriber(outgoingRespUnsub);
}

/**
 * Render devices list
 */
export function renderDevices() {
  const devices = state.devices;

  if (devices.length === 0) {
    devicesList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
          <rect x="128" y="16" width="256" height="480" rx="48" ry="48"/>
          <line x1="256" y1="432" x2="256.01" y2="432" stroke-width="48" stroke-linecap="round"/>
        </svg>
        <p>No devices connected</p>
        <span>Install iRopit on your phone to get started</span>
      </div>
    `;
    return;
  }

  devicesList.innerHTML = devices
    .map((device) => {
      const isMobileDevice =
        device.type === "mobile" ||
        device.type === "phone" ||
        device.type === "tablet" ||
        device.platform === "android" ||
        device.platform === "Android" ||
        device.platform === "ios";

      const batteryValue = Number(device.batteryLevel);
      const hasBattery = Number.isFinite(batteryValue);
      const batteryPct = hasBattery
        ? Math.max(0, Math.min(100, Math.round(batteryValue)))
        : null;
      
      // Debug: log battery value and update timestamp
      if (hasBattery) {
        const lastUpdated = device.batteryLastUpdatedAt 
          ? new Date(device.batteryLastUpdatedAt).toLocaleTimeString()
          : 'unknown';
        console.log(`[Device] ${getFriendlyDeviceName(device)} - Battery: ${batteryPct}% (last updated: ${lastUpdated})`);
      }

      const batteryMarkup =
        isMobileDevice && batteryPct !== null
          ? `<div class="device-battery ${device.isCharging ? "charging" : ""}"><span class="device-battery-icon">🔋</span> ${batteryPct}%${device.isCharging ? " ⚡" : ""}</div>`
          : "";

      return `
    <div class="list-item device-item ${
      device.isOnline ? "device-online" : ""
    }" data-device-id="${device.id}" data-device-doc-id="${device.docId}">
      <div class="list-item-icon">
        ${
          device.type === "mobile" || device.platform === "android" || device.platform === "Android" || device.platform === "ios" || device.type === "phone"
            ? `<!-- phone-portrait-outline (Ionicons) -->
              <svg width="20" height="20" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
                <rect x="128" y="16" width="256" height="480" rx="48" ry="48"/>
                <line x1="256" y1="432" x2="256.01" y2="432" stroke-width="48" stroke-linecap="round"/>
              </svg>`
            : `<!-- laptop-outline (Ionicons) -->
              <svg width="20" height="20" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
                <rect x="48" y="80" width="416" height="288" rx="32" ry="32"/>
                <line x1="16" y1="416" x2="496" y2="416"/>
              </svg>`
        }
      </div>
      <div class="list-item-content">
        <div class="list-item-title device-name-display">
          <span class="device-nickname">${escapeHtml(getFriendlyDeviceName(device))}</span>
          ${(state.myDeviceShares || {})[device.id]?.length > 0
            ? `<span class="device-owned-shared-badge">${t("device_shared_badge")}</span>`
            : (state.myPendingShareDeviceIds || new Set()).has(device.id)
              ? `<span class="device-pending-badge">${t("device_pending_badge")}</span>`
              : ""}
          <button class="edit-name-btn" data-device-doc-id="${escapeHtml(
            device.docId,
          )}" title="${t("device_edit_name")}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="share-device-btn" data-device-id="${escapeHtml(device.id)}" data-device-doc-id="${escapeHtml(device.docId)}" title="${t("device_share")}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
        </div>
        <div class="list-item-subtitle">
          ${escapeHtml(device.model || device.platform || "Phone")} • ${escapeHtml(
            device.platform || "",
          )} • ${device.isOnline ? "Online" : "Offline"}${(device.appVersion || _deviceVersionCache[device.id]) ? ` • v${escapeHtml(device.appVersion || _deviceVersionCache[device.id])}` : ""}
        </div>
        ${batteryMarkup}
        <div class="device-id-info">${escapeHtml(device.id)}</div>
        ${isMobileDevice ? `
        <div class="device-sync-prefs">
          <span class="sync-pref-title">${t("device_sync_label")}</span>
          <label class="sync-pref-label">
            <input type="checkbox" class="sync-pref-cb" data-sync-type="sms" data-device-id="${escapeHtml(device.id)}"${state.getDeviceSyncPref(device.id, "sms") ? " checked" : ""}>
            <span>${t("device_sync_sms")}</span>
          </label>
          <label class="sync-pref-label">
            <input type="checkbox" class="sync-pref-cb" data-sync-type="calls" data-device-id="${escapeHtml(device.id)}"${state.getDeviceSyncPref(device.id, "calls") ? " checked" : ""}>
            <span>${t("device_sync_calls")}</span>
          </label>
          <label class="sync-pref-label">
            <input type="checkbox" class="sync-pref-cb" data-sync-type="notifications" data-device-id="${escapeHtml(device.id)}"${state.getDeviceSyncPref(device.id, "notifications") ? " checked" : ""}>
            <span>${t("device_sync_notifications")}</span>
          </label>
        </div>` : ""}
      </div>
      <div class="device-actions">
        <span class="list-item-time">${formatTime(
          device.lastActiveAt || device.lastSeen,
        )}</span>
        <button class="delete-device-btn" data-device-id="${
          device.id
        }" data-device-doc-id="${device.docId}" data-device-name="${escapeHtml(device.nickname || device.name || device.id)}" title="${getCurrentLanguage() === 'ar' ? 'حذف الجهاز' : 'Delete device'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `;
    })
    .join("");

  // ── Append shared-with-me section ─────────────────────────────────────────
  const shared = state.sharedWithMeDevices;
  if (shared.length > 0) {
    const isAr = getCurrentLanguage() === "ar";
    const sharedHtml = shared.map((share) => {
      const d = share.device;
      const displayName = d
        ? escapeHtml(getFriendlyDeviceName(d))
        : escapeHtml(share.deviceName || share.deviceId);
      const perms = share.permissions || {};
      const permList = [
        perms.sms && t("device_sync_sms"),
        perms.calls && t("device_sync_calls"),
        perms.notifications && t("device_sync_notifications"),
      ].filter(Boolean).join(", ") || (isAr ? "لا شيء" : "None");
      return `
    <div class="list-item device-item device-shared-item" data-share-id="${escapeHtml(share.shareId)}">
      <div class="list-item-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
      </div>
      <div class="list-item-content">
        <div class="list-item-title">
          <span class="device-nickname">${displayName}</span>
          <span class="device-shared-badge">${t("device_shared_badge")}</span>
        </div>
        <div class="list-item-subtitle">
          ${isAr ? "مشارك من:" : "Shared by:"} ${escapeHtml(share.ownerEmail)} &nbsp;|&nbsp; ${t("device_sync_label")} ${permList}
        </div>
        ${d ? `<div class="device-id-info">${escapeHtml(d.id)}</div>` : ""}
      </div>
      <div class="device-actions">
        <button class="remove-shared-device-btn" data-share-id="${escapeHtml(share.shareId)}" title="${t("device_stop_sharing")}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
      `;
    }).join("");
    devicesList.innerHTML += `
      <div class="shared-devices-section">
        <div class="shared-devices-header">${t("device_shared_with_me")}</div>
        ${sharedHtml}
      </div>
    `;
  }

  // Add delete handlers
  document.querySelectorAll(".delete-device-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const deviceId = btn.dataset.deviceId;
      const docId = btn.dataset.deviceDocId;
      const deviceName = btn.dataset.deviceName || deviceId;
      const isAr = getCurrentLanguage() === "ar";
      const confirmMsg = isAr
        ? `حذف الجهاز "${deviceName}"؟ سيتم حذف جميع بياناته.`
        : `Delete device "${deviceName}"? This will remove all its data.`;
      if (await showConfirmDialog(confirmMsg)) {
        deleteDevice(docId, deviceId);
      }
    });
  });

  // Add edit name handlers
  document.querySelectorAll(".edit-name-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const docId = btn.dataset.deviceDocId;
      const device = state.devices.find((d) => d.docId === docId);
      if (device) {
        showEditDeviceNameModal(device);
      }
    });
  });

  // Add share button handlers
  document.querySelectorAll(".share-device-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const deviceId = btn.dataset.deviceId;
      const docId = btn.dataset.deviceDocId;
      const device = state.devices.find((d) => d.docId === docId);
      if (device) showShareDeviceModal(device);
    });
  });

  // Add stop-sharing handlers (recipient side — remove share from their list)
  document.querySelectorAll(".remove-shared-device-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const shareId = btn.dataset.shareId;
      const isAr = getCurrentLanguage() === "ar";
      const msg = isAr
        ? "إزالة هذا الجهاز المشترك من قائمتك؟"
        : "Remove this shared device from your list?";
      if (await showConfirmDialog(msg)) {
        try {
          await deleteDoc(doc(db, "deviceShares", shareId));
          showToast(isAr ? "تمت إزالة الجهاز المشترك" : "Shared device removed", "success");
        } catch (err) {
          console.error("[Share] remove shared device error:", err);
          showToast(isAr ? "فشل في الإزالة" : "Failed to remove", "error");
        }
      }
    });
  });

  // Add sync preference checkbox handlers
  document.querySelectorAll(".sync-pref-cb").forEach((cb) => {
    cb.addEventListener("change", async (e) => {
      e.stopPropagation();
      const deviceId = cb.dataset.deviceId;
      const type = cb.dataset.syncType;
      await saveDeviceSyncPref(deviceId, type, cb.checked);
      updateDeviceSelects();
    });
  });
}

/**
 * Update device select dropdowns
 */
export function updateDeviceSelects() {
  const devices = state.devices;

  // These select elements may not exist in the current popup layout (replaced by device tabs).
  // Resolving them locally ensures we never reference an undeclared variable.
  const smsDevice = document.getElementById("smsDevice");
  const callDevice = document.getElementById("callDevice");

  // For SMS, only show mobile devices
  const mobileDevices = devices.filter(
    (d) =>
      d.type === "mobile" ||
      d.type === "phone" ||
      d.platform === "android" ||
      d.platform === "ios" ||
      d.platform === "Android",
  );

  const smsOptions = mobileDevices
    .map((d) => {
      const deviceName = getFriendlyDeviceName(d);
      return `<option value="${escapeHtml(d.id)}">${escapeHtml(deviceName)}</option>`;
    })
    .join("");

  if (smsDevice) {
    smsDevice.innerHTML =
      `<option value="">${getCurrentLanguage() === 'ar' ? 'اختر جهاز...' : 'Select device...'}</option>` + smsOptions;
  }

  if (callDevice) {
    callDevice.innerHTML =
      `<option value="">${getCurrentLanguage() === 'ar' ? 'اختر جهاز...' : 'Select device...'}</option>` + smsOptions;
  }

  // Update device tabs for all tabs
  updateChatDeviceTabs();
  updateSmsDeviceTabs();
  updateCallsDeviceTabs();
  updateNotificationsDeviceTabs();
  updateInsightsDeviceTabs();
  // Re-render notifications so device tags resolve with fresh state.devices
  import("./notifications.js").then(m => m.reRenderNotifications()).catch(() => {});
}

/**
 * Update chat device tabs
 */
export function updateChatDeviceTabs() {
  const devices = state.devices;
  const chatDeviceTabs = document.getElementById("chatDeviceTabs");
  if (!chatDeviceTabs) return;

  // Show all devices except chrome extensions
  const otherDevices = devices.filter(
    (d) =>
      d.type !== "chrome-extension" &&
      d.platform !== "chrome-extension" &&
      d.platform !== "chrome" &&
      !d.id?.startsWith("ext_"),
  );

  const deviceTabsHTML = otherDevices
    .map((d) => {
      const deviceName = getFriendlyDeviceName(d);
      const platformIcon = getPlatformIcon(d.platform);
      return `
        <button class="device-tab" data-device="${escapeHtml(d.id)}">
          ${platformIcon}
          <span>${escapeHtml(deviceName)}</span>
        </button>
      `;
    })
    .join("");

  chatDeviceTabs.innerHTML = `
    <button class="device-tab active" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>${getCurrentLanguage() === 'ar' ? 'كل الأجهزة' : 'All Devices'}</span>
    </button>
    ${deviceTabsHTML}
  `;

  // Add click handlers to tabs
  chatDeviceTabs.querySelectorAll(".device-tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      chatDeviceTabs
        .querySelectorAll(".device-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      // Re-render messages to update device name visibility
      // Dynamic import to avoid circular dependency
      const chatModule = await import("./chat.js");
      if (state.cachedChatMessages.length > 0) {
        chatModule.renderChatMessages(state.cachedChatMessages);
      }
    });
  });
}

function mobileDevicesOnly() {
  return state.devices.filter(
    (d) =>
      d.type === "mobile" ||
      d.type === "phone" ||
      d.platform === "android" ||
      d.platform === "ios" ||
      d.platform === "Android",
  );
}

function getSmsDeviceCount(deviceId) {
  if (deviceId === "all") {
    const ownCount = mobileDevicesOnly().reduce((t, d) => t + getSmsDeviceCount(d.id), 0);
    const sharedCount = (state.sharedWithMeDevices || [])
      .filter(s => s.permissions?.sms)
      .reduce((t, s) => t + (state.allSMS[s.deviceId] || []).filter(m => !m.read).length, 0);
    return ownCount + sharedCount;
  }
  return (state.allSMS[deviceId] || []).filter(m => !m.read).length;
}

function getCallsDeviceCount(deviceId) {
  if (deviceId === "all") {
    const ownCount = mobileDevicesOnly().reduce((t, d) => t + getCallsDeviceCount(d.id), 0);
    const sharedCount = (state.sharedWithMeDevices || [])
      .filter(s => s.permissions?.calls)
      .reduce((t, s) => t + (state.allCallsData || []).filter(c => c.deviceId === s.deviceId && c.type === "missed" && !c.viewed).length, 0);
    return ownCount + sharedCount;
  }
  // Use allCallsData (render source) to stay in sync with what's actually displayed
  return (state.allCallsData || []).filter(c => c.deviceId === deviceId && c.type === "missed" && !c.viewed).length;
}

function getNotifsDeviceCount(deviceId) {
  if (deviceId === "all") {
    const ownCount = mobileDevicesOnly().reduce((t, d) => t + getNotifsDeviceCount(d.id), 0);
    const sharedCount = (state.sharedWithMeDevices || [])
      .filter(s => s.permissions?.notifications)
      .reduce((t, s) => t + (state.allNotifications[s.deviceId] || []).filter(n => !n.read).length, 0);
    return ownCount + sharedCount;
  }
  return (state.allNotifications[deviceId] || []).filter(n => !n.read).length;
}

/**
 * Update SMS device tabs (filter SMS by device)
 */
export function updateSmsDeviceTabs() {
  const devices = state.devices;
  const smsDeviceTabs = document.getElementById("smsDeviceTabs");
  if (!smsDeviceTabs) return;

  // Show only mobile devices that have SMS sync enabled
  const mobileDevices = devices.filter(
    (d) =>
      (d.type === "mobile" ||
      d.type === "phone" ||
      d.platform === "android" ||
      d.platform === "ios" ||
      d.platform === "Android") &&
      state.getDeviceSyncPref(d.id, "sms"),
  );

  // Remember currently selected tab
  const currentSelected =
    smsDeviceTabs.querySelector(".device-tab.active")?.dataset.device || "all";

  const deviceTabsHTML = mobileDevices
    .map((d) => {
      const deviceName = getFriendlyDeviceName(d);
      const platformIcon = getPlatformIcon(d.platform);
      const isActive = currentSelected === d.id ? " active" : "";
      const count = getSmsDeviceCount(d.id);
      const countHtml = count > 0 ? ` <span class="device-tab-count">(${count})</span>` : "";
      return `
        <button class="device-tab${isActive}" data-device="${escapeHtml(d.id)}">
          ${platformIcon}
          <span>${escapeHtml(deviceName)}</span>${countHtml}
        </button>
      `;
    })
    .join("");

  // Shared devices with SMS permission
  const sharedSmsDevices = (state.sharedWithMeDevices || []).filter(s => s.permissions?.sms && s.deviceId);
  const sharedSmsTabsHTML = sharedSmsDevices.map(s => {
    const deviceName = s.deviceName || getFriendlyDeviceName(s.device || {});
    const platformIcon = getPlatformIcon((s.device || {}).platform || "android");
    const isActive = currentSelected === s.deviceId ? " active" : "";
    const count = (state.allSMS[s.deviceId] || []).filter(m => !m.read).length;
    const countHtml = count > 0 ? ` <span class="device-tab-count">(${count})</span>` : "";
    return `
      <button class="device-tab${isActive}" data-device="${escapeHtml(s.deviceId)}">
        ${platformIcon}
        <span>${escapeHtml(deviceName)} <span class="tab-shared-label">(Shared)</span></span>${countHtml}
      </button>
    `;
  }).join("");

  const allActive = currentSelected === "all" ? " active" : "";
  const allCount = getSmsDeviceCount("all");
  const allCountHtml = allCount > 0 ? ` <span class="device-tab-count">(${allCount})</span>` : "";
  const isCurrentOwn = mobileDevices.some(d => d.id === currentSelected);
  const isCurrentShared = sharedSmsDevices.some(s => s.deviceId === currentSelected);

  smsDeviceTabs.innerHTML = `
    <button class="device-tab${allActive || ((!isCurrentOwn && !isCurrentShared) ? " active" : "")}" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>${getCurrentLanguage() === 'ar' ? 'كل الأجهزة' : 'All Devices'}</span>${allCountHtml}
    </button>
    ${deviceTabsHTML}
    ${sharedSmsTabsHTML}
  `;

  // Add click handlers to tabs
  smsDeviceTabs.querySelectorAll(".device-tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      smsDeviceTabs
        .querySelectorAll(".device-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // If a conversation is open, close it first so the new device's list is shown
      if (state.currentConversation) {
        document.getElementById("smsList")?.classList.remove("conversation-open");
        state.setCurrentConversation(null);
        const deleteAllBtn = document.getElementById("deleteAllSmsBtn");
        if (deleteAllBtn) deleteAllBtn.title = "Delete all";
        const si = document.getElementById("smsSearchInput");
        if (si) {
          si.value = "";
          si.placeholder = "Search messages...";
          delete si.dataset.convWired;
          delete si.dataset.wired;
        }
      }

      // Re-render SMS to apply device filter
      const smsModule = await import("./sms.js");
      if (state.allSMSMessages && state.allSMSMessages.length > 0) {
        smsModule.renderSMS(state.allSMSMessages);
      }
    });
  });
}

/**
 * Update Calls device tabs (filter calls by device)
 */
export function updateCallsDeviceTabs() {
  const devices = state.devices;
  const callsDeviceTabs = document.getElementById("callsDeviceTabs");
  if (!callsDeviceTabs) return;

  // Show only mobile devices that have Calls sync enabled
  const mobileDevices = devices.filter(
    (d) =>
      (d.type === "mobile" ||
      d.type === "phone" ||
      d.platform === "android" ||
      d.platform === "ios" ||
      d.platform === "Android") &&
      state.getDeviceSyncPref(d.id, "calls"),
  );

  // Remember currently selected tab
  const currentSelected =
    callsDeviceTabs.querySelector(".device-tab.active")?.dataset.device ||
    "all";

  const deviceTabsHTML = mobileDevices
    .map((d) => {
      const deviceName = getFriendlyDeviceName(d);
      const platformIcon = getPlatformIcon(d.platform);
      const isActive = currentSelected === d.id ? " active" : "";
      const count = getCallsDeviceCount(d.id);
      const countHtml = count > 0 ? ` <span class="device-tab-count">(${count})</span>` : "";
      return `
        <button class="device-tab${isActive}" data-device="${escapeHtml(d.id)}">
          ${platformIcon}
          <span>${escapeHtml(deviceName)}</span>${countHtml}
        </button>
      `;
    })
    .join("");

  // Shared devices with Calls permission
  const sharedCallsDevices = (state.sharedWithMeDevices || []).filter(s => s.permissions?.calls && s.deviceId);
  const sharedCallsTabsHTML = sharedCallsDevices.map(s => {
    const deviceName = s.deviceName || getFriendlyDeviceName(s.device || {});
    const platformIcon = getPlatformIcon((s.device || {}).platform || "android");
    const isActive = currentSelected === s.deviceId ? " active" : "";
    const count = (state.allCallsData || []).filter(c => c.deviceId === s.deviceId && c.type === "missed" && !c.viewed).length;
    const countHtml = count > 0 ? ` <span class="device-tab-count">(${count})</span>` : "";
    return `
      <button class="device-tab${isActive}" data-device="${escapeHtml(s.deviceId)}">
        ${platformIcon}
        <span>${escapeHtml(deviceName)} <span class="tab-shared-label">(Shared)</span></span>${countHtml}
      </button>
    `;
  }).join("");

  const allActive = currentSelected === "all" ? " active" : "";
  const allCount = getCallsDeviceCount("all");
  const allCountHtml = allCount > 0 ? ` <span class="device-tab-count">(${allCount})</span>` : "";
  const isCurrentCallsOwn = mobileDevices.some(d => d.id === currentSelected);
  const isCurrentCallsShared = sharedCallsDevices.some(s => s.deviceId === currentSelected);

  callsDeviceTabs.innerHTML = `
    <button class="device-tab${allActive || ((!isCurrentCallsOwn && !isCurrentCallsShared) ? " active" : "")}" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>${getCurrentLanguage() === 'ar' ? 'كل الأجهزة' : 'All Devices'}</span>${allCountHtml}
    </button>
    ${deviceTabsHTML}
    ${sharedCallsTabsHTML}
  `;

  // Add click handlers to tabs
  callsDeviceTabs.querySelectorAll(".device-tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      callsDeviceTabs
        .querySelectorAll(".device-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      // Re-render calls to apply device filter
      const callsModule = await import("./calls.js");
      if (state.allCallsData && state.allCallsData.length > 0) {
        callsModule.renderCalls(state.allCallsData);
      }
    });
  });
}

/**
 * Update Notifications device tabs (filter notifications by device)
 */
export function updateNotificationsDeviceTabs() {
  const devices = state.devices;
  const notificationsDeviceTabs = document.getElementById("notificationsDeviceTabs");
  if (!notificationsDeviceTabs) return;

  // Show only mobile devices that have Notifications sync enabled
  const mobileDevices = devices.filter(
    (d) =>
      (d.type === "mobile" ||
      d.type === "phone" ||
      d.platform === "android" ||
      d.platform === "ios" ||
      d.platform === "Android") &&
      state.getDeviceSyncPref(d.id, "notifications"),
  );

  // Remember currently selected tab
  const currentSelected =
    notificationsDeviceTabs.querySelector(".device-tab.active")?.dataset.device || "all";

  const deviceTabsHTML = mobileDevices
    .map((d) => {
      const deviceName = getFriendlyDeviceName(d);
      const platformIcon = getPlatformIcon(d.platform);
      const isActive = currentSelected === d.id ? " active" : "";
      const count = getNotifsDeviceCount(d.id);
      const countHtml = count > 0 ? ` <span class="device-tab-count">(${count})</span>` : "";
      return `
        <button class="device-tab${isActive}" data-device="${escapeHtml(d.id)}">
          ${platformIcon}
          <span>${escapeHtml(deviceName)}</span>${countHtml}
        </button>
      `;
    })
    .join("");

  // Shared devices with Notifications permission
  const sharedNotifsDevices = (state.sharedWithMeDevices || []).filter(s => s.permissions?.notifications && s.deviceId);
  const sharedNotifsTabsHTML = sharedNotifsDevices.map(s => {
    const deviceName = s.deviceName || getFriendlyDeviceName(s.device || {});
    const platformIcon = getPlatformIcon((s.device || {}).platform || "android");
    const isActive = currentSelected === s.deviceId ? " active" : "";
    const count = (state.allNotifications[s.deviceId] || []).filter(n => !n.read).length;
    const countHtml = count > 0 ? ` <span class="device-tab-count">(${count})</span>` : "";
    return `
      <button class="device-tab${isActive}" data-device="${escapeHtml(s.deviceId)}">
        ${platformIcon}
        <span>${escapeHtml(deviceName)} <span class="tab-shared-label">(Shared)</span></span>${countHtml}
      </button>
    `;
  }).join("");

  const allActive = currentSelected === "all" ? " active" : "";
  const allCount = getNotifsDeviceCount("all");
  const allCountHtml = allCount > 0 ? ` <span class="device-tab-count">(${allCount})</span>` : "";
  const isCurrentNotifsOwn = mobileDevices.some(d => d.id === currentSelected);
  const isCurrentNotifsShared = sharedNotifsDevices.some(s => s.deviceId === currentSelected);

  notificationsDeviceTabs.innerHTML = `
    <button class="device-tab${allActive || ((!isCurrentNotifsOwn && !isCurrentNotifsShared) ? " active" : "")}" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>${getCurrentLanguage() === 'ar' ? 'كل الأجهزة' : 'All Devices'}</span>${allCountHtml}
    </button>
    ${deviceTabsHTML}
    ${sharedNotifsTabsHTML}
  `;

  // Add click handlers to tabs
  notificationsDeviceTabs.querySelectorAll(".device-tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      notificationsDeviceTabs
        .querySelectorAll(".device-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      // If detail view is open, go back to main list first
      const detailView = document.getElementById("notifDetailView");
      const mainView = document.getElementById("notifMainView");
      if (detailView && detailView.style.display !== "none") {
        detailView.style.display = "none";
        if (mainView) mainView.style.display = "flex";
      }
      // Re-render notifications with device filter
      const notifsModule = await import("./notifications.js");
      notifsModule.reRenderNotifications();
    });
  });
}

/**
 * Delete a device
 * @param {string} docId - Firebase document ID
 * @param {string} deviceId - Device ID
 */
export async function deleteDevice(docId, deviceId) {
  const user = state.currentUser;
  if (!user || !docId) return;

  // Check if this is the current Chrome extension device
  const currentDeviceId = await getDeviceId(user.uid);
  const isOwnDevice = deviceId === currentDeviceId;

  showLoadingOverlay();
  try {
    // Delete the device document — Cloud Function handles subcollection cleanup
    await deleteDoc(doc(db, "devices", docId));

    if (isOwnDevice) {
      // Revoke Chrome identity token and sign out
      if (typeof chrome !== "undefined" && chrome.identity) {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          if (token) chrome.identity.removeCachedAuthToken({ token });
        });
      }
      await signOut(auth);
      showToast("Device removed and signed out", "success");
    } else {
      showToast(`Device "${deviceId}" deleted`, "success");
      state.removeDevice(docId);
      renderDevices();
      updateDeviceSelects();
    }
  } catch (error) {
    console.error("Delete device error:", error);
    showToast("Failed to delete device", "error");
  }
  hideLoading();
}

/**
 * Show edit device name modal
 * @param {Object} device - Device object
 */
export function showEditDeviceNameModal(device) {
  const currentName = getFriendlyDeviceName(device);

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.id = "editDeviceModal";
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Edit Device Name</h3>
        <button class="modal-close-btn" id="closeEditModal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="device-info-preview">
          <div class="info-row">
            <span class="info-label">Device ID:</span>
            <span class="info-value">${escapeHtml(device.id)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Model:</span>
            <span class="info-value">${escapeHtml(device.model || "Unknown")}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Platform:</span>
            <span class="info-value">${escapeHtml(device.platform || "Unknown")}</span>
          </div>
        </div>
        <div class="form-group">
          <label for="deviceNickname">Nickname</label>
          <input type="text" id="deviceNickname" value="${escapeHtml(currentName)}" placeholder="Enter device nickname..." />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancelEditDevice">Cancel</button>
        <button class="btn btn-primary" id="saveDeviceName">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Focus input
  document.getElementById("deviceNickname").focus();
  document.getElementById("deviceNickname").select();

  // Close handlers
  document
    .getElementById("closeEditModal")
    .addEventListener("click", () => modal.remove());
  document
    .getElementById("cancelEditDevice")
    .addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  // Save handler
  document
    .getElementById("saveDeviceName")
    .addEventListener("click", async () => {
      const newName = document.getElementById("deviceNickname").value.trim();
      if (newName) {
        await updateDeviceName(device.docId, newName);
        modal.remove();
      }
    });

  // Enter key to save
  document
    .getElementById("deviceNickname")
    .addEventListener("keypress", async (e) => {
      if (e.key === "Enter") {
        const newName = document.getElementById("deviceNickname").value.trim();
        if (newName) {
          await updateDeviceName(device.docId, newName);
          modal.remove();
        }
      }
    });
}

/**
 * Update device name in Firebase
 * @param {string} docId - Firebase document ID
 * @param {string} newName - New device name
 */
export async function updateDeviceName(docId, newName) {
  const user = state.currentUser;
  if (!user || !docId) return;

  showLoadingOverlay();
  try {
    // Update device document
    await updateDoc(doc(db, "devices", docId), {
      nickname: newName,
      name: newName,
    });

    // Get the device ID
    const deviceDoc = await getDoc(doc(db, "devices", docId));
    const deviceId = deviceDoc.data()?.id;

    if (deviceId) {
      // Update all messages from this device
      const messagesQuery = query(
        collection(db, "users", user.uid, "messages"),
        where("deviceId", "==", deviceId),
      );
      const messagesSnapshot = await getDocs(messagesQuery);
      const messageBatch = writeBatch(db);
      messagesSnapshot.forEach((doc) => {
        messageBatch.update(doc.ref, { deviceName: newName });
      });
      await messageBatch.commit();

      // Update all calls from this device
      const callsQuery = query(
        collection(db, "calls"),
        where("userId", "==", user.uid),
        where("deviceId", "==", deviceId),
      );
      const callsSnapshot = await getDocs(callsQuery);
      const callBatch = writeBatch(db);
      callsSnapshot.forEach((doc) => {
        callBatch.update(doc.ref, { deviceName: newName });
      });
      await callBatch.commit();

      // Update all notifications from this device
      const notificationsQuery = query(
        collection(db, "users", user.uid, "notifications"),
        where("deviceId", "==", deviceId),
      );
      const notificationsSnapshot = await getDocs(notificationsQuery);
      const notificationBatch = writeBatch(db);
      notificationsSnapshot.forEach((doc) => {
        notificationBatch.update(doc.ref, { deviceName: newName });
      });
      await notificationBatch.commit();
    }

    // Update local state
    state.updateDevice(docId, { nickname: newName, name: newName });

    renderDevices();
    updateDeviceSelects();
    reRenderNotifications();
    renderCalls(state.allCallsData);
    renderSMS(state.allSMSMessages);
    updateInsightsDeviceTabs();
    showToast("Device name updated in all records", "success");
  } catch (error) {
    console.error("Update device name error:", error);
    showToast("Failed to update device name", "error");
  }
  hideLoading();
}

// ── Device Sharing ────────────────────────────────────────────────────────────

/**
 * Show the share device modal
 */
export async function showShareDeviceModal(device) {
  const user = state.currentUser;
  if (!user) return;

  const isAr = getCurrentLanguage() === "ar";
  const deviceName = getFriendlyDeviceName(device);

  // Fetch existing shares for this device
  let existingShares = [];
  let pendingRequests = [];
  try {
    const sharesSnap = await getDocs(
      query(
        collection(db, "deviceShares"),
        where("ownerUid", "==", user.uid),
        where("deviceId", "==", device.id),
      )
    );
    existingShares = sharesSnap.docs.map((d) => ({ shareId: d.id, ...d.data() }));
  } catch (_) {}
  try {
    const pendingSnap = await getDocs(
      query(
        collection(db, "deviceShareRequests"),
        where("ownerUid", "==", user.uid),
        where("deviceId", "==", device.id),
        where("status", "==", "pending"),
      )
    );
    pendingRequests = pendingSnap.docs.map((d) => ({ requestId: d.id, ...d.data() }));
  } catch (_) {}

  const existingSharesHtml = (existingShares.length === 0 && pendingRequests.length === 0) ? "" : `
    <div class="share-existing-list">
      <div class="share-existing-title">${isAr ? "مشارك حالياً مع:" : "Currently shared with:"}</div>
      ${existingShares.map((s) => {
        const perms = s.permissions || {};
        const pList = [
          perms.sms && (isAr ? "الرسائل" : "SMS"),
          perms.calls && (isAr ? "المكالمات" : "Calls"),
          perms.notifications && (isAr ? "الإشعارات" : "Notifications"),
        ].filter(Boolean).join(", ") || (isAr ? "لا شيء" : "None");
        return `
          <div class="share-existing-row" data-share-id="${escapeHtml(s.shareId)}">
            <span class="share-existing-email">${escapeHtml(s.sharedWithEmail)}</span>
            <span class="share-existing-perms">(${pList})</span>
            <button class="stop-sharing-btn btn btn-danger-small" data-share-id="${escapeHtml(s.shareId)}" data-email="${escapeHtml(s.sharedWithEmail)}" data-device-id="${escapeHtml(s.deviceId)}" data-shared-uid="${escapeHtml(s.sharedWithUid)}">
              ${isAr ? "إيقاف المشاركة" : "Stop Sharing"}
            </button>
          </div>
        `;
      }).join("")}
      ${pendingRequests.map((r) => {
        const perms = r.permissions || {};
        const pList = [
          perms.sms && (isAr ? "الرسائل" : "SMS"),
          perms.calls && (isAr ? "المكالمات" : "Calls"),
          perms.notifications && (isAr ? "الإشعارات" : "Notifications"),
        ].filter(Boolean).join(", ") || (isAr ? "لا شيء" : "None");
        return `
          <div class="share-existing-row">
            <span class="share-existing-email">${escapeHtml(r.sharedWithEmail)}</span>
            <span class="share-existing-perms">(${pList})</span>
            <span class="device-pending-badge" style="font-size:11px;">${isAr ? "قيد الانتظار" : "Pending"}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.id = "shareDeviceModal";
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>${isAr ? "مشاركة الجهاز" : "Share Device"}: ${escapeHtml(deviceName)}</h3>
        <button class="modal-close" id="closeShareModal">&times;</button>
      </div>
      <div class="modal-body">
        ${existingSharesHtml}
        <div class="form-group">
          <label for="shareEmail">${isAr ? "البريد الإلكتروني للمستخدم" : "Recipient iRopit account (email)"}</label>
          <input type="email" id="shareEmail" placeholder="${isAr ? "example@email.com" : "example@email.com"}" autocomplete="off" />
        </div>
        <div class="form-group">
          <label>${isAr ? "ما الذي تريد مشاركته؟" : "What to share?"}</label>
          <div class="share-perms-row">
            <label class="sync-pref-label">
              <input type="checkbox" id="shareSms" checked>
              <span>${isAr ? "الرسائل" : "SMS"}</span>
            </label>
            <label class="sync-pref-label">
              <input type="checkbox" id="shareCalls" checked>
              <span>${isAr ? "المكالمات" : "Calls"}</span>
            </label>
            <label class="sync-pref-label">
              <input type="checkbox" id="shareNotifications" checked>
              <span>${isAr ? "الإشعارات" : "Notifications"}</span>
            </label>
          </div>
        </div>
        <div id="shareError" class="share-error" style="display:none;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancelShare">${isAr ? "إلغاء" : "Cancel"}</button>
        <button class="btn btn-primary" id="confirmShare">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          ${isAr ? "مشاركة" : "Share"}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById("shareEmail").focus();

  // Close handlers
  document.getElementById("closeShareModal").addEventListener("click", () => modal.remove());
  document.getElementById("cancelShare").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  // Stop sharing handlers
  modal.querySelectorAll(".stop-sharing-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const shareId = btn.dataset.shareId;
      const email = btn.dataset.email;
      const msg = isAr
        ? `إيقاف مشاركة الجهاز مع "${email}"؟`
        : `Stop sharing with "${email}"?`;
      if (await showConfirmDialog(msg)) {
        try {
          await deleteDoc(doc(db, "deviceShares", shareId));
          // Also remove from deviceShareIndex (for Firestore rules)
          if (btn.dataset.deviceId && btn.dataset.sharedUid) {
            deleteDoc(doc(db, "deviceShareIndex", `${btn.dataset.deviceId}_${btn.dataset.sharedUid}`)).catch(() => {});
          }
          btn.closest(".share-existing-row").remove();
          showToast(isAr ? "تم إيقاف المشاركة" : "Sharing stopped", "success");
        } catch (err) {
          console.error("[Share] stop sharing error:", err);
          showToast(isAr ? "فشل إيقاف المشاركة" : "Failed to stop sharing", "error");
        }
      }
    });
  });

  // Confirm share handler
  document.getElementById("confirmShare").addEventListener("click", async () => {
    const email = document.getElementById("shareEmail").value.trim().toLowerCase();
    const shareSms = document.getElementById("shareSms").checked;
    const shareCalls = document.getElementById("shareCalls").checked;
    const shareNotifs = document.getElementById("shareNotifications").checked;
    const errorEl = document.getElementById("shareError");

    const showError = (msg) => { errorEl.textContent = msg; errorEl.style.display = "block"; };
    errorEl.style.display = "none";

    if (!email) {
      showError(isAr ? "يرجى إدخال البريد الإلكتروني." : "Please enter a recipient email.");
      return;
    }
    if (email === user.email?.toLowerCase()) {
      showError(isAr ? "لا يمكنك مشاركة الجهاز مع نفسك." : "You cannot share a device with yourself.");
      return;
    }
    if (!shareSms && !shareCalls && !shareNotifs) {
      showError(isAr ? "يرجى تحديد نوع واحد على الأقل للمشاركة." : "Select at least one item to share.");
      return;
    }

    const confirmBtn = document.getElementById("confirmShare");
    confirmBtn.disabled = true;

    try {
      // Look up recipient by email
      const usersSnap = await getDocs(
        query(collection(db, "users"), where("email", "==", email))
      );
      if (usersSnap.empty) {
        showError(isAr ? "لم يتم العثور على مستخدم بهذا البريد الإلكتروني." : "No iRopit user found with this email.");
        confirmBtn.disabled = false;
        return;
      }

      const recipientDoc = usersSnap.docs[0];
      const recipientUid = recipientDoc.data().uid || recipientDoc.id;

      // Check if already shared or has pending request for this user
      const existing = existingShares.find((s) => s.sharedWithEmail === email);
      const pending = pendingRequests.find((r) => r.sharedWithEmail === email);
      if (existing) {
        showError(isAr ? "الجهاز مشارك بالفعل مع هذا المستخدم." : "Device is already shared with this user.");
        confirmBtn.disabled = false;
        return;
      }
      if (pending) {
        showError(isAr ? "تم إرسال طلب مشاركة بالفعل لهذا المستخدم." : "A share request is already pending for this user.");
        confirmBtn.disabled = false;
        return;
      }

      await addDoc(collection(db, "deviceShareRequests"), {
        ownerUid: user.uid,
        ownerEmail: user.email,
        ownerDisplayName: user.displayName || user.email,
        deviceId: device.id,
        deviceDocId: device.docId,
        deviceName: getFriendlyDeviceName(device),
        sharedWithEmail: email,
        sharedWithUid: recipientUid,
        permissions: { sms: shareSms, calls: shareCalls, notifications: shareNotifs },
        status: "pending",
        createdAt: Date.now(),
      });

      // Replace modal content with a success confirmation the user must dismiss
      const modalContent = modal.querySelector(".modal-content");
      modalContent.innerHTML = `
        <div class="modal-header">
          <h3>${isAr ? "تم إرسال الطلب" : "Request Sent"}</h3>
        </div>
        <div class="modal-body" style="text-align:center;padding:24px 20px 16px;">
          <div style="font-size:40px;margin-bottom:12px;">📤</div>
          <p style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:8px;">
            ${isAr
              ? `تم إرسال طلب مشاركة جهاز <strong>${escapeHtml(getFriendlyDeviceName(device))}</strong>`
              : `A share request for <strong>${escapeHtml(getFriendlyDeviceName(device))}</strong> has been sent`}
          </p>
          <p style="font-size:13px;color:var(--text-secondary);">
            ${isAr
              ? `إلى الحساب: <strong>${escapeHtml(email)}</strong>`
              : `to account: <strong>${escapeHtml(email)}</strong>`}
          </p>
          <p style="font-size:12px;color:var(--text-secondary);margin-top:8px;opacity:0.8;">
            ${isAr
              ? "سيتمكنون من قبول أو رفض الطلب."
              : "They can accept or decline the request."}
          </p>
        </div>
        <div class="modal-footer" style="justify-content:center;">
          <button class="btn btn-primary" id="shareSuccessOkBtn" style="min-width:100px;">
            ${isAr ? "حسناً" : "OK"}
          </button>
        </div>
      `;
      document.getElementById("shareSuccessOkBtn").addEventListener("click", () => {
        modal.remove();
      });
    } catch (err) {
      console.error("[Share] share device error:", err);
      showError(isAr ? "حدث خطأ. حاول مرة أخرى." : "An error occurred. Please try again.");
      confirmBtn.disabled = false;
    }
  });
}

/**
 * Show accept/reject modal for an incoming device share request (recipient side).
 */
async function _showIncomingShareRequestModal(req) {
  const user = state.currentUser;
  if (!user) return;

  // Avoid duplicate modals for the same request
  if (document.getElementById(`shareReqModal_${req.requestId}`)) return;

  const isAr = getCurrentLanguage() === "ar";
  const perms = req.permissions || {};
  const permList = [
    perms.sms && (isAr ? "الرسائل" : "SMS"),
    perms.calls && (isAr ? "المكالمات" : "Calls"),
    perms.notifications && (isAr ? "الإشعارات" : "Notifications"),
  ].filter(Boolean).join(", ") || (isAr ? "لا شيء" : "None");

  const ownerName = escapeHtml(req.ownerDisplayName || req.ownerEmail || "");
  const deviceName = escapeHtml(req.deviceName || req.deviceId || "");

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.id = `shareReqModal_${req.requestId}`;
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>${isAr ? "طلب مشاركة جهاز" : "Device Share Request"}</h3>
      </div>
      <div class="modal-body">
        <div class="share-request-info">
          <div class="share-request-device-name">
            <svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px">
              <rect x="128" y="16" width="256" height="480" rx="48" ry="48"/>
              <line x1="256" y1="432" x2="256.01" y2="432" stroke-width="48" stroke-linecap="round"/>
            </svg>${deviceName}
          </div>
          <div class="share-request-sender">
            ${isAr
              ? `يريد <strong>${ownerName}</strong> مشاركة هذا الجهاز معك`
              : `<strong>${ownerName}</strong> wants to share this device with you`}
          </div>
          <div class="share-request-perms">
            ${isAr ? "الصلاحيات:" : "Permissions:"} <strong>${permList}</strong>
          </div>
        </div>
        <div id="shareReqStatus_${req.requestId}" style="display:none;" class="share-error"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="shareReqReject_${req.requestId}">
          ${isAr ? "رفض" : "Reject"}
        </button>
        <button class="btn btn-primary" id="shareReqAccept_${req.requestId}">
          ${isAr ? "قبول" : "Accept"}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const acceptBtn = document.getElementById(`shareReqAccept_${req.requestId}`);
  const rejectBtn = document.getElementById(`shareReqReject_${req.requestId}`);

  const setStatus = (msg, isError) => {
    const el = document.getElementById(`shareReqStatus_${req.requestId}`);
    if (el) {
      el.textContent = msg;
      el.style.display = "block";
      el.style.background = isError ? "#c0392b" : "#276749";
    }
  };

  acceptBtn.addEventListener("click", async () => {
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    try {
      // Create the active deviceShare doc
      await addDoc(collection(db, "deviceShares"), {
        ownerUid: req.ownerUid,
        ownerEmail: req.ownerEmail,
        deviceId: req.deviceId,
        deviceDocId: req.deviceDocId,
        deviceName: req.deviceName || "",
        sharedWithEmail: req.sharedWithEmail,
        sharedWithUid: req.sharedWithUid,
        permissions: req.permissions || {},
        createdAt: Date.now(),
      });
      // Create deviceShareIndex entry for Firestore security rules
      await setDoc(doc(db, "deviceShareIndex", `${req.deviceId}_${user.uid}`), {
        ownerUid: req.ownerUid,
        deviceId: req.deviceId,
        sharedWithUid: user.uid,
      });
      // Set status to "accepted" so owner's listener shows a toast
      await updateDoc(doc(db, "deviceShareRequests", req.requestId), { status: "accepted" });
      setStatus(isAr ? "تم قبول الطلب" : "Request accepted!", false);
      setTimeout(() => modal.remove(), 1500);
    } catch (err) {
      console.error("[ShareReq] accept error:", err);
      acceptBtn.disabled = false;
      rejectBtn.disabled = false;
      setStatus(isAr ? "حدث خطأ. حاول مرة أخرى." : "An error occurred. Please try again.", true);
    }
  });

  rejectBtn.addEventListener("click", async () => {
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    try {
      // Set status to "rejected" so owner's listener shows a toast
      await updateDoc(doc(db, "deviceShareRequests", req.requestId), { status: "rejected" });
      setStatus(isAr ? "تم رفض الطلب" : "Request declined.", false);
      setTimeout(() => modal.remove(), 1200);
    } catch (err) {
      console.error("[ShareReq] reject error:", err);
      acceptBtn.disabled = false;
      rejectBtn.disabled = false;
      setStatus(isAr ? "حدث خطأ. حاول مرة أخرى." : "An error occurred. Please try again.", true);
    }
  });
}
