/**
 * Device Management Service
 */

import {
  db,
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
} from "../config/firebase.js";

import { devicesList, smsDevice } from "../ui/dom.js";
import { showToast, showLoadingOverlay, hideLoading } from "../ui/toasts.js";
import {
  formatTime,
  getDeviceId,
  getPlatformIcon,
  getFriendlyDeviceName,
  escapeHtml,
} from "../utils/helpers.js";
import * as state from "../state/index.js";

/**
 * Register this extension as a device
 */
export async function registerDevice() {
  const user = state.currentUser;
  if (!user) return;

  const deviceId = await getDeviceId();

  // Check if device already exists to avoid duplicates
  const existingDeviceRef = doc(db, "devices", deviceId);
  const existingDevice = await getDoc(existingDeviceRef);

  await setDoc(
    existingDeviceRef,
    {
      id: deviceId,
      userId: user.uid,
      name: "Chrome Extension",
      type: "chrome-extension",
      platform: "chrome-extension",
      model: navigator.userAgent,
      lastActiveAt: Date.now(),
      isOnline: true,
    },
    { merge: true },
  );

  console.log(
    `[Device] Registered/updated Chrome extension device: ${deviceId}`,
    {
      existed: existingDevice.exists(),
    },
  );

  // Clean up any duplicate extension devices (devices with same userId and type but different IDs)
  await cleanupDuplicateExtensions(user.uid, deviceId);
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

  const unsub = onSnapshot(q, (snapshot) => {
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
  });

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
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
        </svg>
        <p>No devices connected</p>
        <span>Install iRopit on your phone to get started</span>
      </div>
    `;
    return;
  }

  devicesList.innerHTML = devices
    .map(
      (device) => `
    <div class="list-item device-item ${
      device.isOnline ? "device-online" : ""
    }" data-device-id="${device.id}" data-device-doc-id="${device.docId}">
      <div class="list-item-icon">
        ${
          device.type === "mobile" || device.platform === "android"
            ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
          </svg>`
            : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
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
        <div class="device-id-info">${escapeHtml(device.id)}</div>
      </div>
      <div class="device-actions">
        <span class="list-item-time">${formatTime(
          device.lastActiveAt || device.lastSeen,
        )}</span>
        <button class="delete-device-btn" data-device-id="${
          device.id
        }" data-device-doc-id="${device.docId}" title="Delete device">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `,
    )
    .join("");

  // Add delete handlers
  document.querySelectorAll(".delete-device-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const deviceId = btn.dataset.deviceId;
      const docId = btn.dataset.deviceDocId;
      if (
        confirm(`Delete device "${deviceId}"? This will remove all its data.`)
      ) {
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

  // Update device tabs for all tabs
  updateChatDeviceTabs();
  updateSmsDeviceTabs();
  updateCallsDeviceTabs();
  updateNotificationsDeviceTabs();
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
      <span>All</span>
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
      return `
        <button class="device-tab${isActive}" data-device="${escapeHtml(d.id)}">
          ${platformIcon}
          <span>${escapeHtml(deviceName)}</span>
        </button>
      `;
    })
    .join("");

  const allActive = currentSelected === "all" ? " active" : "";

  smsDeviceTabs.innerHTML = `
    <button class="device-tab${allActive || (!mobileDevices.some((d) => d.id === currentSelected) ? " active" : "")}" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>All</span>
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
      return `
        <button class="device-tab${isActive}" data-device="${escapeHtml(d.id)}">
          ${platformIcon}
          <span>${escapeHtml(deviceName)}</span>
        </button>
      `;
    })
    .join("");

  const allActive = currentSelected === "all" ? " active" : "";

  callsDeviceTabs.innerHTML = `
    <button class="device-tab${allActive || (!mobileDevices.some((d) => d.id === currentSelected) ? " active" : "")}" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>All</span>
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
      return `
        <button class="device-tab${isActive}" data-device="${escapeHtml(d.id)}">
          ${platformIcon}
          <span>${escapeHtml(deviceName)}</span>
        </button>
      `;
    })
    .join("");

  const allActive = currentSelected === "all" ? " active" : "";

  notificationsDeviceTabs.innerHTML = `
    <button class="device-tab${allActive || (!mobileDevices.some((d) => d.id === currentSelected) ? " active" : "")}" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>All</span>
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

  showLoadingOverlay();
  try {
    // Delete device document
    await deleteDoc(doc(db, "devices", docId));

    // Also delete notifications subcollection for this device
    const notifPath = `users/${user.uid}/devices/${deviceId}/notifications`;
    const notifQuery = query(collection(db, notifPath));
    const notifSnapshot = await getDocs(notifQuery);

    const batch = writeBatch(db);
    notifSnapshot.forEach((notifDoc) => {
      batch.delete(notifDoc.ref);
    });

    if (notifSnapshot.size > 0) {
      await batch.commit();
    }

    showToast(`Device "${deviceId}" deleted`, "success");
    state.removeDevice(docId);
    renderDevices();
    updateDeviceSelects();
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
    showToast("Device name updated in all records", "success");
  } catch (error) {
    console.error("Update device name error:", error);
    showToast("Failed to update device name", "error");
  }
  hideLoading();
}
