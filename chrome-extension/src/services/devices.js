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
} from "../config/firebase.js";

import { devicesList, smsDevice, callDevice } from "../ui/dom.js";
import { showToast, showLoadingOverlay, hideLoading, showConfirmDialog } from "../ui/toasts.js";
import {
  formatTime,
  getDeviceId,
  getPlatformIcon,
  getFriendlyDeviceName,
  escapeHtml,
} from "../utils/helpers.js";
import { getCurrentLanguage } from "../utils/i18n.js";
import * as state from "../state/index.js";
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

  const q = query(collection(db, "devices"), where("userId", "==", user.uid));

  const unsub = onSnapshot(
    q,
    (snapshot) => {
      const newDevices = [];
      snapshot.forEach((doc) => {
        newDevices.push({
          ...doc.data(),
          docId: doc.id,
        });
      });

      state.setDevices(newDevices);
      renderDevices();
      updateDeviceSelects();
    },
    (error) => {
      console.error("[Device] loadDevices onSnapshot error:", error?.code, error?.message);
    },
  );

  state.addUnsubscriber(unsub);
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
          <button class="edit-name-btn" data-device-doc-id="${escapeHtml(
            device.docId,
          )}" title="Edit name">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
        <div class="list-item-subtitle">
          ${escapeHtml(device.model || device.platform || "Phone")} • ${escapeHtml(
            device.platform || "",
          )} • ${device.isOnline ? "Online" : "Offline"}
        </div>
        ${batteryMarkup}
        <div class="device-id-info">${escapeHtml(device.id)}</div>
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
}

/**
 * Update device select dropdowns
 */
export function updateDeviceSelects() {
  const devices = state.devices;

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
      '<option value="">Select device...</option>' + smsOptions;
  }

  if (callDevice) {
    callDevice.innerHTML =
      '<option value="">Select device...</option>' + smsOptions;
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
      <span>All Devices</span>
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
  if (deviceId === "all") return mobileDevicesOnly().reduce((t, d) => t + getSmsDeviceCount(d.id), 0);
  return (state.allSMS[deviceId] || []).filter(m => !m.read).length;
}

function getCallsDeviceCount(deviceId) {
  if (deviceId === "all") return mobileDevicesOnly().reduce((t, d) => t + getCallsDeviceCount(d.id), 0);
  // Use allCallsData (render source) to stay in sync with what's actually displayed
  return (state.allCallsData || []).filter(c => c.deviceId === deviceId && c.type === "missed" && !c.viewed).length;
}

function getNotifsDeviceCount(deviceId) {
  if (deviceId === "all") return mobileDevicesOnly().reduce((t, d) => t + getNotifsDeviceCount(d.id), 0);
  return (state.allNotifications[deviceId] || []).filter(n => !n.read).length;
}

/**
 * Update SMS device tabs (filter SMS by device)
 */
export function updateSmsDeviceTabs() {
  const devices = state.devices;
  const smsDeviceTabs = document.getElementById("smsDeviceTabs");
  if (!smsDeviceTabs) return;

  // Show only mobile devices (same filter as SMS device select)
  const mobileDevices = devices.filter(
    (d) =>
      d.type === "mobile" ||
      d.type === "phone" ||
      d.platform === "android" ||
      d.platform === "ios" ||
      d.platform === "Android",
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

  const allActive = currentSelected === "all" ? " active" : "";
  const allCount = getSmsDeviceCount("all");
  const allCountHtml = allCount > 0 ? ` <span class="device-tab-count">(${allCount})</span>` : "";

  smsDeviceTabs.innerHTML = `
    <button class="device-tab${allActive || (!mobileDevices.some((d) => d.id === currentSelected) ? " active" : "")}" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>All Devices</span>${allCountHtml}
    </button>
    ${deviceTabsHTML}
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

  // Show only mobile devices
  const mobileDevices = devices.filter(
    (d) =>
      d.type === "mobile" ||
      d.type === "phone" ||
      d.platform === "android" ||
      d.platform === "ios" ||
      d.platform === "Android",
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

  const allActive = currentSelected === "all" ? " active" : "";
  const allCount = getCallsDeviceCount("all");
  const allCountHtml = allCount > 0 ? ` <span class="device-tab-count">(${allCount})</span>` : "";

  callsDeviceTabs.innerHTML = `
    <button class="device-tab${allActive || (!mobileDevices.some((d) => d.id === currentSelected) ? " active" : "")}" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>All Devices</span>${allCountHtml}
    </button>
    ${deviceTabsHTML}
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

  // Show only mobile devices
  const mobileDevices = devices.filter(
    (d) =>
      d.type === "mobile" ||
      d.type === "phone" ||
      d.platform === "android" ||
      d.platform === "ios" ||
      d.platform === "Android",
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

  const allActive = currentSelected === "all" ? " active" : "";
  const allCount = getNotifsDeviceCount("all");
  const allCountHtml = allCount > 0 ? ` <span class="device-tab-count">(${allCount})</span>` : "";

  notificationsDeviceTabs.innerHTML = `
    <button class="device-tab${allActive || (!mobileDevices.some((d) => d.id === currentSelected) ? " active" : "")}" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>All Devices</span>${allCountHtml}
    </button>
    ${deviceTabsHTML}
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
