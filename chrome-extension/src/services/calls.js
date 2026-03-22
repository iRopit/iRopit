/**
 * Calls Service
 * Handles call history loading, rendering, and management
 */

import {
  db,
  collection,
  doc,
  getDocs,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
} from "../config/firebase.js";

import { callsList } from "../ui/dom.js";
import { showListLoading, showToast, showConfirmDialog } from "../ui/toasts.js";
import {
  formatTime,
  formatDuration,
  getInitials,
  getCallIcon,
  getFriendlyDeviceName,
  getDeviceId,
} from "../utils/helpers.js";
import { getCurrentLanguage } from "../utils/i18n.js";
import * as state from "../state/index.js";
import { updateTabBadges } from "./badges.js";
import { decryptCall } from "./cryptoService.js";
import { getContactName } from "./contacts.js";
import { getCachedCalls, cacheCallsData } from "./cache.js";

// ── Selection mode state ──────────────────────────────────────────────────────
let callsSelectionMode = false;
let selectedCallGroups = new Set(); // keyed by group.phoneNumber

function _updateCallsSelectionToolbar(totalGroups) {
  const deleteBtn = document.getElementById("deleteAllCallsBtn");
  const countSpan = document.getElementById("callsSelectedCount");
  const selectAllCb = document.getElementById("callsSelectAll");
  if (deleteBtn) deleteBtn.disabled = selectedCallGroups.size === 0;
  if (countSpan) countSpan.textContent = selectedCallGroups.size;
  if (selectAllCb) {
    selectAllCb.checked = selectedCallGroups.size === totalGroups && totalGroups > 0;
    selectAllCb.indeterminate = selectedCallGroups.size > 0 && selectedCallGroups.size < totalGroups;
  }
}

/**
 * Normalize phone number for consistent grouping
 * @param {string} phone - Raw phone number
 * @returns {string}
 */
function normalizePhoneNumber(phone) {
  if (!phone || !phone.trim()) return "";

  let normalized = phone.replace(/[^\d+]/g, "").trim();
  normalized = normalized.replace(/^\+/, "");

  if (normalized.startsWith("20") && normalized.length > 10) {
    normalized = normalized.substring(2);
  }

  if (!normalized.startsWith("0") && normalized.length === 10) {
    normalized = "0" + normalized;
  }

  return normalized;
}

/**
 * Check if a string looks like a phone number
 * @param {string} value - Value to check
 * @returns {boolean}
 */
function isPhoneNumberLike(value) {
  if (!value || !value.trim) return false;
  const digits = value.replace(/[\s\-().]/g, "");
  return /\d{3,}/.test(digits);
}

/**
 * Mark all missed calls as viewed when entering calls tab
 */
export async function markAllCallsAsViewed() {
  const user = state.currentUser;
  if (!user) return;

  const missedToMark = state.allCallsData.filter(
    (call) => call.type === "missed" && !call.viewed,
  );

  if (missedToMark.length === 0) return;

  const updatedCalls = state.allCallsData.map((call) =>
    call.type === "missed" && !call.viewed ? { ...call, viewed: true } : call,
  );
  state.setAllCallsData(updatedCalls);

  // Re-render calls list to update UI
  renderCalls(updatedCalls);

  try {
    const batch = writeBatch(db);
    missedToMark.forEach((call) => {
      if (call.deviceId) {
        const callRef = doc(
          db,
          "users",
          user.uid,
          "devices",
          call.deviceId,
          "calls",
          call.id,
        );
        batch.set(callRef, { viewed: true }, { merge: true });
      }
    });
    await batch.commit();
  } catch (error) {
    console.error("Failed to mark calls as viewed:", error);
  }
}

// Decryption cache for calls
const callDecryptionCache = new Map();
let callListenerUnsubs = [];
let isSyncingCalls = false;

/**
 * Decrypt call with caching
 */
async function decryptCallCached(data, userId, docId) {
  const cached = callDecryptionCache.get(docId);
  if (cached && cached.timestamp === data.timestamp) {
    return cached.data;
  }
  const decrypted = await decryptCall(data, userId);
  callDecryptionCache.set(docId, {
    data: decrypted,
    timestamp: data.timestamp,
  });
  return decrypted;
}

/**
 * Process a raw call document into a normalized call object
 */
function processCallDoc(data, firestoreId, deviceId, deviceName) {
  const titleLower = (data.title || "").toLowerCase().trim();
  const isTitleCallDescription =
    titleLower === "call" ||
    titleLower === "calling" ||
    titleLower === "incoming call" ||
    titleLower === "outgoing call" ||
    titleLower === "missed call" ||
    titleLower === "missed calls" ||
    titleLower === "ongoing call" ||
    titleLower === "on hold" ||
    titleLower === "dialing" ||
    titleLower === "ringing" ||
    titleLower.includes("missed call") ||
    titleLower === "مكالمة" ||
    titleLower === "مكالمة فائتة" ||
    titleLower === "مكالمات فائتة" ||
    titleLower === "مكالمة واردة" ||
    titleLower === "مكالمة صادرة" ||
    titleLower === "اتصال" ||
    /^\d{1,2}$/.test(titleLower);

  let rawContactName = data.contactName || data.displayName || "";
  const contactLower = rawContactName.toLowerCase().trim();
  const isContactCallDescription =
    contactLower === "call" ||
    contactLower === "calling" ||
    contactLower === "incoming call" ||
    contactLower === "outgoing call" ||
    contactLower === "missed call" ||
    contactLower === "missed calls" ||
    contactLower === "ongoing call" ||
    contactLower === "مكالمة" ||
    contactLower === "مكالمة فائتة" ||
    contactLower === "مكالمات فائتة" ||
    /^\d{1,2}$/.test(contactLower);

  if (isContactCallDescription) {
    rawContactName = "";
  }

  const resolvedPhone =
    data.phoneNumber ||
    data.number ||
    data.address ||
    (data.title && !isTitleCallDescription && isPhoneNumberLike(data.title)
      ? data.title
      : "") ||
    "";
  const resolvedContact =
    rawContactName ||
    (data.title && !isTitleCallDescription && !isPhoneNumberLike(data.title)
      ? data.title
      : "") ||
    getContactName(resolvedPhone) ||
    "";

  return {
    ...data,
    id: firestoreId,
    deviceId: deviceId,
    deviceName: deviceName,
    phoneNumber: resolvedPhone || data.phoneNumber || "",
    contactName: resolvedContact,
    type: data.type || data.callType || "incoming",
    simSlot: data.simSlot != null ? data.simSlot : -1,
  };
}

/**
 * Load calls from Firebase
 */
export async function loadCalls() {
  const user = state.currentUser;
  if (!user) return;

  // === STEP 1: Show cached calls instantly ===
  let hasCachedData = false;
  try {
    const cached = await getCachedCalls();
    if (cached && cached.allCalls && cached.allCalls.length > 0) {
      console.log(
        `[Calls] 📦 Showing ${cached.allCalls.length} cached calls instantly`,
      );
      hasCachedData = true;
      if (cached.byDevice) {
        for (const [deviceId, calls] of Object.entries(cached.byDevice)) {
          state.setCallsByDevice(deviceId, calls);
        }
      }
      state.setAllCallsData(cached.allCalls);
      renderCalls(cached.allCalls.slice(0, 100));
      updateTabBadges();
    }
  } catch (e) {
    console.warn("[Calls] Cache load failed:", e);
  }

  // Show loading spinner only if no cached data
  if (!hasCachedData && callsList) {
    showListLoading(callsList);
  }

  // === STEP 2: Fetch fresh data from Firebase ===
  isSyncingCalls = true;
  updateCallsCountIndicator();
  // Stop previous call listeners
  callListenerUnsubs.forEach((unsub) => unsub());
  callListenerUnsubs = [];
  callDecryptionCache.clear();

  const devicesQuery = query(
    collection(db, "devices"),
    where("userId", "==", user.uid),
  );

  const devicesSnapshot = await getDocs(devicesQuery);
  const devicesList = [];
  devicesSnapshot.forEach((doc) => {
    const data = doc.data();
    // Skip chrome extension device entries
    if (
      data.platform === "chrome-extension" ||
      data.platform === "chrome" ||
      (data.id && data.id.startsWith("ext_"))
    ) {
      return;
    }
    devicesList.push({
      id: data.id,
      name: getFriendlyDeviceName(data),
    });
  });

  // No mobile devices found — show empty state instead of infinite spinner
  if (devicesList.length === 0) {
    console.warn("[Calls] No mobile devices found - showing empty state");
    isSyncingCalls = false;
    updateCallsCountIndicator();
    renderCalls([]);
    return;
  }

  // Load all devices in parallel with getDocs (one-time, fast)
  const loadPromises = devicesList.map(async (device) => {
    const q = query(
      collection(db, "users", user.uid, "devices", device.id, "calls"),
      orderBy("timestamp", "desc"),
      limit(200),
    );

    try {
      const snapshot = await getDocs(q);
      console.log(
        `[Calls] Loaded ${snapshot.size} calls from device ${device.id}`,
      );

      const calls = await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          let data = docSnap.data();
          data = await decryptCallCached(data, user.uid, docSnap.id);
          return processCallDoc(data, docSnap.id, device.id, device.name);
        }),
      );
      updateCallsList(device.id, calls);
    } catch (error) {
      console.error(`❌ Calls load error for device ${device.id}:`, error);
    }
  });

  await Promise.all(loadPromises);
  console.log(
    "[Calls] ✅ Initial load complete, starting realtime listeners...",
  );

  isSyncingCalls = false;
  updateCallsCountIndicator();

  // Start lightweight realtime listeners for new calls only
  for (const device of devicesList) {
    const q = query(
      collection(db, "users", user.uid, "devices", device.id, "calls"),
      orderBy("timestamp", "desc"),
      limit(5),
    );

    let isInitialSnapshot = true;

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        if (isInitialSnapshot) {
          isInitialSnapshot = false;
          return;
        }

        for (const change of snapshot.docChanges()) {
          if (change.type === "added" || change.type === "modified") {
            let data = change.doc.data();
            data = await decryptCallCached(data, user.uid, change.doc.id);
            const call = processCallDoc(
              data,
              change.doc.id,
              device.id,
              device.name,
            );

            const currentCalls = state.allCallsByDevice[device.id] || [];
            const existingIdx = currentCalls.findIndex((c) => c.id === call.id);
            if (existingIdx >= 0) {
              currentCalls[existingIdx] = call;
            } else {
              currentCalls.unshift(call);
            }
            updateCallsList(device.id, currentCalls);
          }
        }
      },
      (error) => {
        console.error(
          `❌ Calls realtime error for device ${device.id}:`,
          error,
        );
      },
    );

    callListenerUnsubs.push(unsub);
    state.addUnsubscriber(unsub);
  }
}

/**
 * Update calls list with data from a device
 * @param {string} deviceId - Device ID
 * @param {Array} newCalls - Array of calls
 */
function updateCallsList(deviceId, newCalls) {
  // Store calls by device using setter
  state.setCallsByDevice(deviceId, newCalls);

  // Merge all calls from all devices
  let merged = [];
  Object.values(state.allCallsByDevice).forEach((calls) => {
    merged = merged.concat(calls);
  });

  // Remove duplicates by id
  const seen = new Set();
  merged = merged.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // Sort by timestamp descending
  merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  state.setAllCallsData(merged);
  renderCalls(merged.slice(0, 100));

  // Save to cache in background
  cacheCallsData(state.allCallsByDevice, merged).catch(() => {});

  updateCallsCountIndicator();
}

/**
 * Update calls count indicator with sync status
 */
function updateCallsCountIndicator() {
  const total = state.allCallsData?.length || 0;
  let indicator = document.getElementById("callsCountIndicator");

  if (total === 0 && !isSyncingCalls) {
    indicator?.remove();
    return;
  }

  if (!indicator) {
    const callsContainer = document.getElementById("callsList");
    if (!callsContainer) return;
    indicator = document.createElement("div");
    indicator.id = "callsCountIndicator";
    indicator.className = "sms-count-indicator";
    callsContainer.appendChild(indicator);
  }

  if (isSyncingCalls) {
    const countText = total > 0 ? `${total} calls` : "";
    indicator.innerHTML = `<span>${countText}</span><span class="sync-badge"><span class="sync-spinner"></span> Syncing...</span>`;
  } else {
    indicator.innerHTML = `<span>${total} calls · All loaded</span>`;
  }
}

/**
 * Render calls list grouped by phone number
 * @param {Array} calls - Array of call records
 */
export function renderCalls(calls) {
  // Normalize calls to ensure viewed flag exists
  const normalizedCalls = calls.map((call) => ({
    ...call,
    viewed: call.viewed ?? false,
  }));

  state.setAllCallsData(normalizedCalls);

  // Filter by selected device tab
  const selectedTab =
    document.querySelector("#callsDeviceTabs .device-tab.active")?.dataset
      .device || "all";

  let filteredCalls = normalizedCalls;
  if (selectedTab !== "all") {
    filteredCalls = normalizedCalls.filter(
      (call) => call.deviceId === selectedTab,
    );
  }

  // Wire search input once
  const callsSearch = document.getElementById("callsSearchInput");
  if (callsSearch && !callsSearch.dataset.wired) {
    callsSearch.dataset.wired = "1";
    callsSearch.addEventListener("input", () => renderCalls(state.allCallsData));
  }

  // Apply search filter
  const searchQuery = (document.getElementById("callsSearchInput")?.value || "").trim().toLowerCase();
  if (searchQuery) {
    filteredCalls = filteredCalls.filter((call) => {
      const contact = (call.contactName || "").toLowerCase();
      const phone = (call.phoneNumber || "").toLowerCase();
      return contact.includes(searchQuery) || phone.includes(searchQuery);
    });
  }

  if (filteredCalls.length === 0) {
    callsList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
        </svg>
        <p>No calls yet</p>
        <span>Call history from your phone will appear here</span>
      </div>
    `;
    updateTabBadges();
    return;
  }

  // Group calls by phone number
  const grouped = {};
  filteredCalls.forEach((call) => {
    const normalizedPhone = normalizePhoneNumber(call.phoneNumber || "");
    const key = normalizedPhone
      ? normalizedPhone
      : call.contactName
        ? `contact_${call.contactName}`
        : "Unknown";
    if (!grouped[key]) {
      grouped[key] = {
        key: key,
        phoneNumber: call.phoneNumber || "Unknown",
        contactName: call.contactName || "",
        calls: [],
        lastCall: call,
        missedCount: 0,
        unviewedMissedCount: 0,
      };
    }
    grouped[key].calls.push(call);
    if (call.type === "missed") {
      grouped[key].missedCount++;
      if (!call.viewed) grouped[key].unviewedMissedCount++;
    }
    if (call.timestamp > (grouped[key].lastCall.timestamp || 0)) {
      grouped[key].lastCall = call;
    }
  });

  // Sort by last call timestamp
  const callGroups = Object.values(grouped).sort(
    (a, b) => (b.lastCall.timestamp || 0) - (a.lastCall.timestamp || 0),
  );

  callsList.innerHTML = callGroups
    .map(
      (group) => `
    <div class="list-item call-group call-${group.lastCall.type}${callsSelectionMode && selectedCallGroups.has(group.phoneNumber) ? " selected" : ""}" data-phone="${
      group.phoneNumber
    }" data-group-key="${group.phoneNumber}">
      ${callsSelectionMode ? `<div class="conv-checkbox-wrap"><input type="checkbox" class="call-checkbox" ${selectedCallGroups.has(group.phoneNumber) ? "checked" : ""} tabindex="-1" /></div>` : ""}
      <div class="list-item-avatar">
        ${getInitials(group.contactName || group.phoneNumber)}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">
          <span class="call-contact-name">${group.contactName || group.phoneNumber}</span>
        </div>
        <div class="list-item-subtitle">${group.calls.length} calls • ${group.lastCall.type}</div>
        ${group.lastCall.deviceName ? `<div class="call-device-row"><span class="device-tag">${group.lastCall.deviceName}</span></div>` : ""}
      </div>
      <div class="call-list-hover-actions">
        <button class="call-list-hover-btn call-list-hover-call" title="Call">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 12.72 19.79 19.79 0 01.15 4.1 2 2 0 012 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
        </button>
        <button class="call-list-hover-btn call-list-hover-wa" title="WhatsApp">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
        </button>
      </div>
      <div class="list-item-meta">
        <span class="list-item-time">${formatTime(
          group.lastCall.timestamp,
        )}</span>
        ${
          group.unviewedMissedCount > 0
            ? `<div class="list-item-badge missed">${group.unviewedMissedCount}</div>`
            : ""
        }
      </div>
    </div>
  `,
    )
    .join("");

  // Add click handlers for call groups
  document.querySelectorAll(".call-group").forEach((el) => {
    el.addEventListener("click", (e) => {
      const phoneNumber = el.dataset.phone;
      if (callsSelectionMode) {
        // Toggle selection
        const cb = el.querySelector(".call-checkbox");
        if (selectedCallGroups.has(phoneNumber)) {
          selectedCallGroups.delete(phoneNumber);
          el.classList.remove("selected");
          if (cb) cb.checked = false;
        } else {
          selectedCallGroups.add(phoneNumber);
          el.classList.add("selected");
          if (cb) cb.checked = true;
        }
        _updateCallsSelectionToolbar(callGroups.length);
        return;
      }
      showCallHistory(phoneNumber);
    });

    const phoneNumber = el.dataset.phone;

    el.querySelector(".call-list-hover-call")?.addEventListener("click", (e) => {
      e.stopPropagation();
      initiateDialRequest(phoneNumber, null);
    });

    el.querySelector(".call-list-hover-wa")?.addEventListener("click", (e) => {
      e.stopPropagation();
      let clean = phoneNumber.replace(/[^\d+]/g, "");
      if (clean.startsWith("+")) clean = clean.slice(1);
      else if (clean.startsWith("0")) clean = "20" + clean.slice(1);
      window.open(`https://wa.me/${clean}`, "_blank");
    });
  });

  _updateCallsSelectionToolbar(callGroups.length);

  // Long-press to enter selection mode
  let callLongPressTimer = null;
  callsList.addEventListener("pointerdown", (e) => {
    const group = e.target.closest(".call-group");
    if (!group || callsSelectionMode) return;
    callLongPressTimer = setTimeout(() => {
      callLongPressTimer = null;
      const phoneNumber = group.dataset.phone;
      callsSelectionMode = true;
      selectedCallGroups.clear();
      document.getElementById("callsSelectBtn")?.classList.add("active");
      const toolbar = document.getElementById("callsSelectToolbar");
      if (toolbar) toolbar.style.display = "flex";
      renderCalls(state.allCallsData);
      setTimeout(() => {
        const el = document.querySelector(`.call-group[data-phone="${CSS.escape(phoneNumber)}"]`);
        if (el) {
          selectedCallGroups.add(phoneNumber);
          el.classList.add("selected");
          const cb = el.querySelector(".call-checkbox");
          if (cb) cb.checked = true;
          _updateCallsSelectionToolbar(document.querySelectorAll(".call-group[data-phone]").length);
        }
      }, 0);
    }, 500);
  });
  callsList.addEventListener("pointerup", () => { if (callLongPressTimer) { clearTimeout(callLongPressTimer); callLongPressTimer = null; } });
  callsList.addEventListener("pointercancel", () => { if (callLongPressTimer) { clearTimeout(callLongPressTimer); callLongPressTimer = null; } });
  callsList.addEventListener("pointermove", () => { if (callLongPressTimer) { clearTimeout(callLongPressTimer); callLongPressTimer = null; } });

  updateTabBadges();
}

/**
 * Show call history for a specific phone number
 * @param {string} phoneNumber - Phone number to show history for
 */
async function showCallHistory(phoneNumber) {
  const calls = state.allCallsData
    .filter((call) => call.phoneNumber === phoneNumber)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (calls.length === 0) return;

  const contactName = calls[0].contactName || phoneNumber;
  state.setCurrentCallConversation(phoneNumber);

  // Mark missed calls for this number as viewed
  const missedToMark = calls.filter(
    (call) => call.type === "missed" && !call.viewed,
  );

  if (missedToMark.length > 0) {
    // Update local state immediately
    const updatedCalls = state.allCallsData.map((call) =>
      call.phoneNumber === phoneNumber && call.type === "missed"
        ? { ...call, viewed: true }
        : call,
    );
    state.setAllCallsData(updatedCalls);
    updateTabBadges();

    try {
      const user = state.currentUser;
      if (user) {
        const batch = writeBatch(db);
        missedToMark.forEach((call) => {
          // Use the correct path: users/{userId}/devices/{deviceId}/calls/{callId}
          if (call.deviceId) {
            const callRef = doc(
              db,
              "users",
              user.uid,
              "devices",
              call.deviceId,
              "calls",
              call.id,
            );
            batch.set(callRef, { viewed: true }, { merge: true });
          }
        });
        await batch.commit();
      }
    } catch (error) {
      console.error("Failed to mark calls as viewed:", error);
    }
  }

  callsList.innerHTML = `
    <div class="conversation-view">
      <div class="conversation-header">
        <button class="back-btn" id="backToCalls">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div class="conversation-avatar">
          ${getInitials(contactName)}</div>
        <div class="conversation-info">
          <div class="conversation-name">${contactName}</div>
          <div class="conversation-phone">${
            phoneNumber !== contactName ? phoneNumber : ""
          }</div>
        </div>
        <div class="call-action-buttons">
          <button class="call-action-btn" id="dialPhoneBtn" title="Call on phone">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 12.72 19.79 19.79 0 01.15 4.1 2 2 0 012 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
            </svg>
            <span>Call</span>
          </button>
          <button class="call-action-btn call-action-whatsapp" id="whatsappPhoneBtn" title="Open in WhatsApp">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            <span>WhatsApp</span>
          </button>
        </div>
      </div>
      <div class="conversation-messages call-history">
        ${calls
          .map(
            (call) => `
          <div class="call-history-item call-${call.type}">
            <div class="call-icon">
              ${getCallIcon(call.type)}
            </div>
            <div class="call-info">
              <div class="call-type">${call.type}${call.simSlot != null && call.simSlot >= 0 ? `<span class="sim-badge sim-${call.simSlot}">${call.simSlot + 1}</span>` : ''}${call.deviceName ? ` <span class="device-tag">${call.deviceName}</span>` : ''}</div>
              <div class="call-duration">${formatDuration(call.duration)}</div>
            </div>
            <div class="call-time">${formatTime(call.timestamp)}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `;

  // Add back button handler
  document.getElementById("backToCalls")?.addEventListener("click", () => {
    state.setCurrentCallConversation(null);
    renderCalls(state.allCallsData);
  });

  // Dial button handler
  document.getElementById("dialPhoneBtn")?.addEventListener("click", () => {
    initiateDialRequest(phoneNumber, null);
  });

  // WhatsApp button handler
  document.getElementById("whatsappPhoneBtn")?.addEventListener("click", () => {
    let clean = phoneNumber.replace(/[^\d+]/g, "");
    if (clean.startsWith("+")) clean = clean.slice(1);
    else if (clean.startsWith("0")) clean = "20" + clean.slice(1);
    window.open(`https://wa.me/${clean}`, "_blank");
  });
}

// ── Selection mode exports ────────────────────────────────────────────────────

/** Toggle calls selection mode on/off */
export function toggleCallsSelectionMode() {
  callsSelectionMode = !callsSelectionMode;
  selectedCallGroups.clear();

  const selectBtn = document.getElementById("callsSelectBtn");
  const toolbar = document.getElementById("callsSelectToolbar");

  if (callsSelectionMode) {
    selectBtn?.classList.add("active");
    if (toolbar) toolbar.style.display = "flex";
  } else {
    selectBtn?.classList.remove("active");
    if (toolbar) toolbar.style.display = "none";
  }
  renderCalls(state.allCallsData);
}

/** Toggle select-all for visible call groups */
export function setCallsSelectAll(checked) {
  const groups = document.querySelectorAll(".call-group[data-phone]");
  groups.forEach((el) => {
    const phone = el.dataset.phone;
    const cb = el.querySelector(".call-checkbox");
    if (checked) {
      selectedCallGroups.add(phone);
      el.classList.add("selected");
      if (cb) cb.checked = true;
    } else {
      selectedCallGroups.delete(phone);
      el.classList.remove("selected");
      if (cb) cb.checked = false;
    }
  });
  _updateCallsSelectionToolbar(groups.length);
}

/** Delete all selected call groups from Firestore */
export async function deleteSelectedCallGroups() {
  if (selectedCallGroups.size === 0) return;
  const count = selectedCallGroups.size;
  const isAr = getCurrentLanguage() === "ar";
  if (!(await showConfirmDialog(isAr
    ? `حذف مكالمات ${count} جهة اتصال؟ لا يمكن التراجع.`
    : `Delete calls for ${count} contact${count > 1 ? "s" : ""}? This cannot be undone.`
  ))) return;

  const user = state.currentUser;
  if (!user) return;

  try {
    const batch = writeBatch(db);
    let deletedCount = 0;
    // Find all calls matching the selected phone numbers
    state.allCallsData.forEach((call) => {
      if (selectedCallGroups.has(call.phoneNumber) && call.deviceId && call.id) {
        const callRef = doc(db, "users", user.uid, "devices", call.deviceId, "calls", call.id);
        batch.delete(callRef);
        deletedCount++;
      }
    });
    if (deletedCount > 0) await batch.commit();

    // Update local state
    const remaining = state.allCallsData.filter((c) => !selectedCallGroups.has(c.phoneNumber));
    Object.keys(state.allCallsByDevice).forEach((deviceId) => {
      const updated = (state.allCallsByDevice[deviceId] || []).filter((c) => !selectedCallGroups.has(c.phoneNumber));
      state.setCallsByDevice(deviceId, updated);
    });
    state.setAllCallsData(remaining);
    showToast(`Deleted calls for ${count} contact${count > 1 ? "s" : ""}`, "success");
  } catch (error) {
    console.error("[Calls] deleteSelectedCallGroups error:", error);
    showToast("Failed to delete selected calls", "error");
  }

  // Exit selection mode
  callsSelectionMode = false;
  selectedCallGroups.clear();
  document.getElementById("callsSelectBtn")?.classList.remove("active");
  const toolbar = document.getElementById("callsSelectToolbar");
  if (toolbar) toolbar.style.display = "none";
  renderCalls(state.allCallsData);
  updateTabBadges();
}

/**
 * Clear call logs from Firestore and local state for the selected device (or all)
 */
export async function clearAllCalls() {
  const user = state.currentUser;
  if (!user) return;

  const selectedTab =
    document.querySelector("#callsDeviceTabs .device-tab.active")?.dataset.device || "all";
  const isAll = selectedTab === "all";
  const isAr = getCurrentLanguage() === "ar";
  const confirmMsg = isAll
    ? (isAr ? "حذف سجل المكالمات لجميع الأجهزة؟ لا يمكن التراجع." : "Clear call history for ALL devices? This cannot be undone.")
    : (isAr ? "حذف سجل المكالمات للجهاز المحدد؟ لا يمكن التراجع." : "Clear call history for the selected device? This cannot be undone.");

  if (!(await showConfirmDialog(confirmMsg))) return;

  const deviceIds = isAll
    ? Object.keys(state.allCallsByDevice)
    : [selectedTab];

  try {
    for (const deviceId of deviceIds) {
      const calls = state.allCallsByDevice[deviceId] || [];
      if (calls.length === 0) continue;
      const batch = writeBatch(db);
      calls.forEach((call) => {
        const callRef = doc(
          db,
          "users",
          user.uid,
          "devices",
          deviceId,
          "calls",
          call.id,
        );
        batch.delete(callRef);
      });
      await batch.commit();
    }
  } catch (error) {
    console.error("[Calls] Failed to delete calls from Firestore:", error);
  }

  // Clear local state for affected devices
  deviceIds.forEach((id) => state.setCallsByDevice(id, []));
  // Rebuild merged allCallsData from remaining devices
  let remaining = [];
  Object.values(state.allCallsByDevice).forEach((calls) => { remaining = remaining.concat(calls); });
  remaining.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  state.setAllCallsData(remaining);
  renderCalls(remaining);
  updateTabBadges();
}

export async function initiateDialRequest(phoneNumber, preferredDeviceId = null) {
  const user = state.currentUser;
  if (!user) {
    console.warn("[Calls] initiateDialRequest: no user logged in");
    showToast("Not logged in", "error");
    return;
  }

  // Determine target device: always query Firestore for the most recent Android device
  let targetDeviceId = preferredDeviceId;
  if (!targetDeviceId) {
    const devicesSnapshot = await getDocs(collection(db, "devices"));
    const androidDevices = devicesSnapshot.docs
      .filter((d) => {
        const data = d.data();
        return data.userId === user.uid && !String(data.id || d.id).startsWith("ext_");
      })
      .sort((a, b) => (b.data().lastSeen || 0) - (a.data().lastSeen || 0));
    if (androidDevices.length === 0) {
      showToast("No Android device available", "error");
      return;
    }
    targetDeviceId = androidDevices[0].data().id || androidDevices[0].id;
  }

  console.log("[Calls] Sending dial request to device:", targetDeviceId, "phone:", phoneNumber);

  try {
    await addDoc(collection(db, "call_requests"), {
      userId: user.uid,
      fromDeviceId: await getDeviceId(),
      toDeviceId: targetDeviceId,
      phoneNumber: phoneNumber,
      status: "pending",
      timestamp: Date.now(),
    });
    console.log("[Calls] call_request created successfully for", targetDeviceId);
    showToast("Opening dialer on phone…", "success");
  } catch (err) {
    console.error("[Calls] initiateDialRequest error:", err);
    showToast("Failed to send dial request", "error");
  }
}

/**
 * Export all calls to a CSV file download
 */
export function exportCallsToCSV() {
  const calls = state.allCallsData || [];
  if (calls.length === 0) {
    alert("No calls to export.");
    return;
  }

  const header = ["Date", "Time", "Type", "Contact", "Phone Number", "Duration (s)", "Device"];
  const rows = calls.map((c) => {
    const d = new Date(c.timestamp || 0);
    const date = d.toLocaleDateString("en-GB");
    const time = d.toLocaleTimeString();
    const type = c.type || "";
    const contact = c.contactName || c.title || "";
    const phone = c.phoneNumber || c.number || c.sender || "";
    const duration = c.duration || 0;
    const device = c.deviceName || "";
    return [date, time, type, contact, phone, duration, device].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
  });

  const csv = "\uFEFF" + [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `iRopit-Calls-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
