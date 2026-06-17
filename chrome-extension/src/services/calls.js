/**
 * Calls Service
 * Handles call history loading, rendering, and management
 */

import {
  db,
  collection,
  doc,
  getDocs,
  getDocsFromServer,
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
import { setCallsDataConfirmed } from "../state/index.js";
import { updateTabBadges } from "./badges.js";
import { decryptCall } from "./cryptoService.js";
import { getContactName } from "./contacts.js";
import { getCachedCalls, cacheCallsData } from "./cache.js";
import { wireHoverPreview } from "../utils/hoverPreview.js";

const CALLS_FETCH_LIMIT = 2000;

function isUnavailableError(error) {
  const code = String(error?.code || "").toLowerCase();
  const msg = String(error?.message || "").toLowerCase();
  return code.includes("unavailable") || msg.includes("failed to get documents from server");
}

const callsUnavailableLogKeys = new Set();
function logCallsUnavailableOnce(key, message, details) {
  if (callsUnavailableLogKeys.has(key)) return;
  callsUnavailableLogKeys.add(key);
  if (details !== undefined) {
    console.info(message, details);
  } else {
    console.info(message);
  }
}

// ── Call type label (i18n) ──────────────────────────────────────────────────
function getCallTypeLabel(type) {
  const ar = getCurrentLanguage() === "ar";
  switch (type) {
    case "incoming": return ar ? "واردة"   : "Incoming";
    case "outgoing": return ar ? "صادرة"   : "Outgoing";
    case "missed":   return ar ? "فائتة"   : "Missed";
    case "rejected": return ar ? "مرفوضة" : "Rejected";
    default:         return type;
  }
}

// ── Selection mode state ──────────────────────────────────────────────────────
let callsSelectionMode = false;
let selectedCallGroups = new Set(); // keyed by group.phoneNumber
const CALLS_PIN_STORAGE_KEY = "callsPinnedGroups";
let callsPinnedGroups = {};
let callsPinHydrated = false;

async function hydrateCallsPinnedGroups() {
  if (callsPinHydrated) return;
  callsPinHydrated = true;
  try {
    if (!chrome?.storage?.local) return;
    const result = await new Promise((resolve) => {
      chrome.storage.local.get([CALLS_PIN_STORAGE_KEY], resolve);
    });
    const map = result?.[CALLS_PIN_STORAGE_KEY];
    if (map && typeof map === "object") callsPinnedGroups = map;
  } catch (_) {}
}

async function persistCallsPinnedGroups() {
  try {
    if (!chrome?.storage?.local) return;
    await new Promise((resolve) => {
      chrome.storage.local.set({ [CALLS_PIN_STORAGE_KEY]: callsPinnedGroups }, resolve);
    });
  } catch (_) {}
}

function isCallGroupPinned(key) {
  return !!callsPinnedGroups[key];
}

async function toggleCallGroupPin(key) {
  if (!key) return false;
  if (callsPinnedGroups[key]) {
    delete callsPinnedGroups[key];
    await persistCallsPinnedGroups();
    return false;
  }
  callsPinnedGroups[key] = true;
  await persistCallsPinnedGroups();
  return true;
}

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

  // Remove UAE country code (971) if present
  if (normalized.startsWith("971") && normalized.length > 10) {
    normalized = normalized.substring(3);
  }

  // Add leading 0 if missing (Egypt local = 10 digits, UAE local = 9 digits)
  if (!normalized.startsWith("0") && (normalized.length === 9 || normalized.length === 10)) {
    normalized = "0" + normalized;
  }

  return normalized;
}

function getBaseCallGroupKey(call) {
  const safePhone = (call.phoneNumber && call.phoneNumber.startsWith("ENC:")) ? "" : (call.phoneNumber || "");
  const safeContact = (call.contactName && call.contactName.startsWith("ENC:")) ? "" : (call.contactName || "");
  const normalizedPhone = normalizePhoneNumber(safePhone);
  return normalizedPhone
    ? normalizedPhone
    : safeContact
      ? `contact_${safeContact}`
      : "unknown";
}

function buildScopedCallGroupKey(call, selectedTab) {
  const baseKey = getBaseCallGroupKey(call);
  // In All Devices mode, keep groups device-scoped so unread counts and
  // device tags always refer to the same device.
  if (selectedTab === "all") {
    return `${baseKey}||${call.deviceId || "_no_device"}`;
  }
  return baseKey;
}

function parseScopedCallGroupKey(groupKey) {
  const idx = groupKey.lastIndexOf("||");
  if (idx <= 0) return { baseKey: groupKey, scopedDeviceId: null };
  return {
    baseKey: groupKey.slice(0, idx),
    scopedDeviceId: groupKey.slice(idx + 2),
  };
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

  const activeDevice = document.querySelector("#callsDeviceTabs .device-tab.active")?.dataset.device || "all";

  const missedToMark = state.allCallsData.filter(
    (call) => call.type === "missed" && !call.viewed &&
      (activeDevice === "all" || call.deviceId === activeDevice),
  );

  if (missedToMark.length === 0) return;

  const updatedCalls = state.allCallsData.map((call) =>
    call.type === "missed" && !call.viewed &&
    (activeDevice === "all" || call.deviceId === activeDevice)
      ? { ...call, viewed: true } : call,
  );
  state.setAllCallsData(updatedCalls);

  // Also update allCallsByDevice so any future updateCallsList() merge
  // doesn't overwrite the viewed flags back to false.
  const deviceIds = activeDevice === "all" ? Object.keys(state.allCallsByDevice) : [activeDevice];
  for (const deviceId of deviceIds) {
    const deviceCalls = state.allCallsByDevice[deviceId].map((call) =>
      call.type === "missed" && !call.viewed ? { ...call, viewed: true } : call,
    );
    state.setCallsByDevice(deviceId, deviceCalls);
  }

  // FIX: Re-save the cache immediately so that if the popup is closed before
  // Firestore batch.commit() returns, the next open still shows viewed: true.
  cacheCallsData(state.allCallsByDevice, updatedCalls).catch(() => {});

  // Update badges and re-render
  updateTabBadges();
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
let suppressCallsSyncIndicator = false;

/** Returns true while loadCalls() is still fetching from Firestore. */
export function isCallsSyncing() {
  return isSyncingCalls;
}

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
  // Strip any un-decrypted ENC: prefix from title before using it
  if (data.title && typeof data.title === "string" && data.title.startsWith("ENC:")) data = { ...data, title: "" };
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
  if (typeof rawContactName === "string" && rawContactName.startsWith("ENC:")) rawContactName = "";
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

  const rawPhoneNumber = (data.phoneNumber && typeof data.phoneNumber === "string" && data.phoneNumber.startsWith("ENC:")) ? "" : (data.phoneNumber || "");
  const rawNumber = (data.number && typeof data.number === "string" && data.number.startsWith("ENC:")) ? "" : (data.number || "");
  const rawAddress = (data.address && typeof data.address === "string" && data.address.startsWith("ENC:")) ? "" : (data.address || "");
  // The Android/RN side falls back to the literal string "unknown" when a VoIP
  // call (Messenger / Teams / Meet / etc.) has no real phone number. Treat it
  // as empty so the rest of the pipeline routes it through the "unknown" group.
  const cleanPhone = (val) => (typeof val === "string" && val.trim().toLowerCase() === "unknown") ? "" : val;
  const resolvedPhone =
    cleanPhone(rawPhoneNumber) ||
    cleanPhone(rawNumber) ||
    cleanPhone(rawAddress) ||
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
    phoneNumber: resolvedPhone || cleanPhone(rawPhoneNumber) || "",
    contactName: resolvedContact,
    type: data.type || data.callType || "incoming",
    simSlot: data.simSlot != null ? data.simSlot : -1,
    // App name for VoIP / 3rd-party app calls (Messenger, Teams, Meet, etc.)
    appName: (data.appName && typeof data.appName === "string" && !data.appName.startsWith("ENC:"))
      ? data.appName
      : "",
    // Strip any remaining encrypted fields so they don't persist in cache
    name: (data.name && typeof data.name === "string" && data.name.startsWith("ENC:")) ? "" : (data.name || ""),
    displayName: (data.displayName && typeof data.displayName === "string" && data.displayName.startsWith("ENC:")) ? "" : (data.displayName || ""),
  };
}

/**
 * Resolve the best available device name for a call at render time.
 * Prefers state.devices lookup (respects user-set nicknames and raw model names)
 * over the potentially-generic name baked in at load time (e.g. "Android").
 */
function resolveCallDeviceName(call) {
  const isShared =
    !!call.deviceId &&
    (state.sharedWithMeDevices || []).some((s) => s.deviceId === call.deviceId);
  const withSharedBadge = (name) => {
    if (!name) return name;
    if (!isShared) return name;
    return /\(Shared\)\s*$/i.test(name) ? name : `${name} (Shared)`;
  };

  if (call.deviceId) {
    const device = state.devices.find((d) => d.id === call.deviceId);
    if (device) return withSharedBadge(device.nickname || device.name || call.deviceName || null);
  }
  return withSharedBadge(call.deviceName || null);
}

/**
 * Load calls from Firebase
 */
export async function loadCalls() {
  const user = state.currentUser;
  if (!user) return;

  await hydrateCallsPinnedGroups();

  // Reset per-load UI suppression state.
  suppressCallsSyncIndicator = false;

  // Show spinner only if list is genuinely empty. If cached calls are already
  // rendered (pre-auth cache path), keep them visible and sync in background.
  const listHasContent =
    callsList &&
    !callsList.querySelector(".loading-state") &&
    callsList.children.length > 0 &&
    !callsList.querySelector(".empty-state");
  if (callsList && !listHasContent) {
    const lang = getCurrentLanguage();
    const syncingMsg =
      lang === "ar"
        ? "جارٍ مزامنة المكالمات من هاتفك…"
        : "Syncing calls from your phone…";
    showListLoading(callsList, syncingMsg);
  }

  // === STEP 1: Show cached calls instantly ===
  let hasCachedData = false;
  // Track newest cached timestamp per device for delta loading
  const cachedNewestTimestamps = {};
  const cachedCallCounts = {};
  try {
    const cached = await getCachedCalls();
    if (cached && cached.allCalls && cached.allCalls.length > 0) {
      // Detect cached calls still in encrypted form (ENC: prefix).
      // Some individual records may legitimately fail to decrypt (e.g. records
      // synced with an old key). Only treat the cache as corrupted and force a
      // full re-fetch when most entries are encrypted — otherwise just skip the
      // bad ones on the instant-render path.
      const isEnc = (call) =>
        (call.contactName && typeof call.contactName === "string" && call.contactName.startsWith("ENC:")) ||
        (call.phoneNumber && typeof call.phoneNumber === "string" && call.phoneNumber.startsWith("ENC:"));
      const encCount = cached.allCalls.filter(isEnc).length;
      const hasEncryptedCache = encCount > 0 && encCount / cached.allCalls.length >= 0.8;

      if (hasEncryptedCache) {
        console.debug(
          `[Calls] Cache mostly encrypted (${encCount}/${cached.allCalls.length}) - forcing full re-fetch`,
        );
        // Only clear calls cache; keep SMS/notifications caches intact.
        await chrome.storage.local.remove(["cached_calls_data"]).catch(() => {});
        // hasCachedData stays false → full (non-delta) fetch will be used
      } else {
        console.log(
          `[Calls] 📦 Showing ${cached.allCalls.length} cached calls instantly`,
        );
        hasCachedData = true;
        if (cached.byDevice) {
          for (const [deviceId, calls] of Object.entries(cached.byDevice)) {
            state.setCallsByDevice(deviceId, calls);
            cachedCallCounts[deviceId] = calls?.length || 0;
            // Record newest timestamp per device for delta fetch
            if (calls && calls.length > 0) {
              cachedNewestTimestamps[deviceId] = Math.max(
                ...calls.map((c) => c.timestamp || 0),
              );
            }
          }
        }
        // Sanitize any lingering ENC: values that slipped through decryption on the cached items
        const sanitizeCall = (c) => {
          const hasEnc =
            (c.contactName && typeof c.contactName === "string" && c.contactName.startsWith("ENC:")) ||
            (c.phoneNumber && typeof c.phoneNumber === "string" && c.phoneNumber.startsWith("ENC:")) ||
            (c.displayName && typeof c.displayName === "string" && c.displayName.startsWith("ENC:")) ||
            (c.name && typeof c.name === "string" && c.name.startsWith("ENC:"));
          if (!hasEnc) return c;
          return {
            ...c,
            contactName: (c.contactName && c.contactName.startsWith("ENC:")) ? "" : (c.contactName || ""),
            phoneNumber: (c.phoneNumber && c.phoneNumber.startsWith("ENC:")) ? "" : (c.phoneNumber || ""),
            displayName: (c.displayName && c.displayName.startsWith("ENC:")) ? "" : (c.displayName || ""),
            name: (c.name && c.name.startsWith("ENC:")) ? "" : (c.name || ""),
          };
        };
        const sanitizedCachedCalls = cached.allCalls.map(sanitizeCall);
        state.setAllCallsData(sanitizedCachedCalls);
        suppressCallsSyncIndicator = true;
        // Reset confirmed flag — badge stays 0 until Firestore validates the viewed state
        setCallsDataConfirmed(false);
        renderCalls(sanitizedCachedCalls.slice(0, 100));
        // Don't call updateTabBadges() here — stale cache may have viewed:false, causing phantom badge
      } // end hasEncryptedCache else
    }
  } catch (e) {
    console.warn("[Calls] Cache load failed:", e);
  }

  // === STEP 2: Fetch fresh data from Firebase ===
  isSyncingCalls = true;
  updateCallsCountIndicator();
  // Stop previous call listeners
  callListenerUnsubs.forEach((unsub) => unsub());
  callListenerUnsubs = [];
  callDecryptionCache.clear();

  try {
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
        id: data.id || doc.id,  // Fall back to Firestore document ID if data.id field is absent
        name: getFriendlyDeviceName(data),
      });
    });

    // No mobile devices found — show empty state instead of infinite spinner
    if (devicesList.length === 0) {
      console.warn("[Calls] No mobile devices found - showing empty state");
      renderCalls([]);
      return;
    }

    // Load all devices in parallel with getDocs (one-time, fast)
    const loadPromises = devicesList.map(async (device) => {
    // Delta fetch: if we have cached data, only query calls newer than cache
    const cachedNewestTs = cachedNewestTimestamps[device.id];
    const cachedDeviceCount = cachedCallCounts[device.id] || 0;
    // If cached history is still below target, force full fetch to backfill older calls.
    const isDelta = !!cachedNewestTs && cachedDeviceCount >= CALLS_FETCH_LIMIT;

    let q;
    if (isDelta) {
      // Only fetch calls newer than the newest cached call
      q = query(
        collection(db, "users", user.uid, "devices", device.id, "calls"),
        where("timestamp", ">", cachedNewestTs),
        orderBy("timestamp", "desc"),
        limit(CALLS_FETCH_LIMIT),
      );
    } else {
      // No cache - full fetch
      q = query(
        collection(db, "users", user.uid, "devices", device.id, "calls"),
        orderBy("timestamp", "desc"),
        limit(CALLS_FETCH_LIMIT),
      );
    }

    try {
      // Delta queries must hit the server — new calls won't be in Firestore's
      // local IndexedDB cache yet, causing a multi-second delay before the
      // realtime listener eventually delivers them.
      let snapshot;
      if (isDelta) {
        try {
          snapshot = await getDocsFromServer(q);
        } catch (serverErr) {
          if (!isUnavailableError(serverErr)) throw serverErr;
          logCallsUnavailableOnce(
            `delta:${device.id}`,
            `[Calls] Server unavailable for delta ${device.id}, using local cache fallback`,
          );
          snapshot = await getDocs(q);
        }
      } else {
        try {
          snapshot = await getDocsFromServer(q);
        } catch (serverErr) {
          if (!isUnavailableError(serverErr)) throw serverErr;
          logCallsUnavailableOnce(
            `full:${device.id}`,
            `[Calls] Server unavailable for full ${device.id}, using local cache fallback`,
          );
          snapshot = await getDocs(q);
        }
      }
      console.log(
        `[Calls] ${isDelta ? "🔄 Delta" : "📥 Full"}: ${snapshot.size} calls from device ${device.id}`,
      );

      const calls = await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          let data = docSnap.data();
          data = await decryptCallCached(data, user.uid, docSnap.id);
          return processCallDoc(data, docSnap.id, device.id, device.name);
        }),
      );

      if (isDelta) {
        // Delta merge: combine new calls with cached ones
        const cachedCalls = state.allCallsByDevice[device.id] || [];
        const cachedIds = new Set(cachedCalls.map((c) => c.id));
        const brandNew = calls.filter((c) => !cachedIds.has(c.id));
        console.log(
          `[Calls] 🔄 Delta: ${brandNew.length} new calls since cache for device ${device.id}`,
        );
        const merged = [...brandNew, ...cachedCalls];
        updateCallsList(device.id, merged);
      } else {
        updateCallsList(device.id, calls);
      }
    } catch (error) {
      if (error?.code !== "permission-denied") {
        if (isUnavailableError(error)) {
          logCallsUnavailableOnce(
            `after-fallback:${device.id}`,
            `[Calls] Device ${device.id} server unavailable after fallback`,
            error?.message || error,
          );
          return;
        }
        console.error(`❌ Calls load error for device ${device.id}:`, error);
      }
    }
    });

    await Promise.all(loadPromises);
    console.log(
      "[Calls] ✅ Initial load complete, starting realtime listeners...",
    );

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
                // Preserve locally-optimistic viewed:true before the Firestore write
                // is acknowledged (snapshot can re-fire with stale viewed:false).
                const existingCall = currentCalls[existingIdx];
                const preserved = (existingCall.viewed === true && !call.viewed)
                  ? { ...call, viewed: true }
                  : call;
                currentCalls[existingIdx] = preserved;
              } else {
                currentCalls.unshift(call);
              }
              updateCallsList(device.id, currentCalls);
            }
          }
        },
        (error) => {
          if (error?.code !== "permission-denied") {
            console.error(
              `❌ Calls realtime error for device ${device.id}:`,
              error,
            );
          }
        },
      );

      callListenerUnsubs.push(unsub);
      state.addUnsubscriber(unsub);
    }
  } catch (error) {
    if (error?.code !== "permission-denied") {
      console.error("[Calls] loadCalls top-level error:", error);
    }
  } finally {
    isSyncingCalls = false;
    // If sync finished but no fresh snapshot toggled confirmation, fall back
    // to the currently available calls data so badges/device counts don't stay
    // permanently at zero for shared/cached calls.
    if (!state.callsDataConfirmed && (state.allCallsData || []).length > 0) {
      setCallsDataConfirmed(true);
      updateTabBadges();
    }
    updateCallsCountIndicator();
    try { window.dispatchEvent(new CustomEvent("iropit:calls-sync-done")); } catch (_) {}
  }
}

/**
 * Update calls list with data from a device
 * @param {string} deviceId - Device ID
 * @param {Array} newCalls - Array of calls
 */
function updateCallsList(deviceId, newCalls) {
  // Preserve viewed:true for any calls already marked in current state.
  // This prevents a race where Firestore getDocs returns stale data (without
  // viewed:true) after markAllCallsAsViewed has already updated in-memory state.
  const existingById = new Map(
    (state.allCallsByDevice[deviceId] || []).map((c) => [c.id, c]),
  );
  const preservedCalls = newCalls.map((call) => {
    const existing = existingById.get(call.id);
    if (existing && existing.viewed && !call.viewed) {
      return { ...call, viewed: true };
    }
    return call;
  });

  // Store calls by device using setter
  state.setCallsByDevice(deviceId, preservedCalls);

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
  // Mark data as confirmed by Firestore so badge now reflects real viewed state
  setCallsDataConfirmed(true);
  updateTabBadges(); // update badge immediately, before renderCalls (which may exit early)
  renderCalls(merged.slice(0, 100));

  // Notify the Insights dashboard so it re-renders with fresh call counts
  // (calls use getDocs which is slower than SMS real-time snapshots; without
  // this the dashboard may read stale cached count if user clicked Apply early)
  document.dispatchEvent(new CustomEvent("callsDataUpdated"));

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

  const callsContainer = document.getElementById("callsList");
  if (!callsContainer) return;

  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "callsCountIndicator";
    indicator.className = "sms-count-indicator";
  }

  // Always place the indicator at the bottom, below all calls.
  indicator.classList.remove("indicator-top");
  callsContainer.appendChild(indicator);

  if (isSyncingCalls) {
    if (suppressCallsSyncIndicator && total > 0) {
      indicator.innerHTML = `<span>${total} calls</span>`;
      return;
    }
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
  } else {
    const sharedCallsDeviceIds = new Set(
      (state.sharedWithMeDevices || [])
        .filter((s) => s?.deviceId && s?.permissions?.calls !== false)
        .map((s) => s.deviceId),
    );
    // Exclude calls from devices where Calls sync is disabled
    filteredCalls = normalizedCalls.filter(
      (call) => !call.deviceId || sharedCallsDeviceIds.has(call.deviceId) || state.getDeviceSyncPref(call.deviceId, "calls"),
    );
  }

  // Drop phantom VoIP entries that carry no phone number and no app name.
  // These are mis-captured calls (e.g. Google Meet) that Android logged with
  // an empty NUMBER — they have zero actionable information and should not
  // appear in the call list.
  filteredCalls = filteredCalls.filter((call) => {
    const phone = (call.phoneNumber || "").trim();
    const app  = (call.appName   || "").trim();
    const isPhantomVoIP = (!phone || phone.toLowerCase() === "unknown" || !normalizePhoneNumber(phone)) && !app;
    return !isPhantomVoIP;
  });

  // Wire search input once
  const callsSearch = document.getElementById("callsSearchInput");
  if (callsSearch && !callsSearch.dataset.wired) {
    callsSearch.dataset.wired = "1";
    callsSearch.addEventListener("input", () => renderCalls(state.allCallsData));
  }

  // Wire unread filter checkbox once
  const callsUnreadCb = document.getElementById("callsShowUnread");
  if (callsUnreadCb && !callsUnreadCb.dataset.wired) {
    callsUnreadCb.dataset.wired = "1";
    callsUnreadCb.addEventListener("change", () => renderCalls(state.allCallsData));
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
    // On fresh install we are still syncing while the list is empty.
    // Don't replace the "Syncing calls…" spinner with the empty state until
    // sync actually finishes.
    if (isSyncingCalls && !searchQuery && selectedTab === "all") {
      const lang = getCurrentLanguage();
      const syncingMsg =
        lang === "ar"
          ? "جارٍ مزامنة المكالمات من هاتفك…"
          : "Syncing calls from your phone…";
      callsList.innerHTML = `
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <p>${syncingMsg}</p>
        </div>
      `;
      updateTabBadges();
      return;
    }
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
    // Strip any ENC: values that may have survived cache or failed decryption
    const safePhone = (call.phoneNumber && call.phoneNumber.startsWith("ENC:")) ? "" : (call.phoneNumber || "");
    const safeContact = (call.contactName && call.contactName.startsWith("ENC:")) ? "" : (call.contactName || "");
    const normalizedPhone = normalizePhoneNumber(safePhone);
    const key = buildScopedCallGroupKey(call, selectedTab);
    if (!grouped[key]) {
      grouped[key] = {
        key: key,
        phoneNumber: safePhone,           // raw value — empty for VoIP/unknown
        contactName: safeContact || getContactName(normalizedPhone) || "",
        appName: call.appName || "",      // populated for VoIP app calls
        calls: [],
        lastCall: call,
        missedCount: 0,
        unviewedMissedCount: 0,
      };
    }
    // Keep the best appName seen across calls in this group
    if (!grouped[key].appName && call.appName) grouped[key].appName = call.appName;
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
  let callGroups = Object.values(grouped).sort(
    (a, b) => (b.lastCall.timestamp || 0) - (a.lastCall.timestamp || 0),
  );

  // Apply unread filter
  if (document.getElementById("callsShowUnread")?.checked) {
    callGroups = callGroups.filter(g => g.unviewedMissedCount > 0);
  }

  callGroups.sort((a, b) => {
    const aPinned = isCallGroupPinned(a.key) ? 1 : 0;
    const bPinned = isCallGroupPinned(b.key) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return (b.lastCall.timestamp || 0) - (a.lastCall.timestamp || 0);
  });

  if (callGroups.length === 0) {
    // If unread filter is enabled while backend sync is still running, avoid
    // a misleading "No unread calls" state; data may not be fully loaded yet.
    if (isSyncingCalls && !searchQuery && selectedTab === "all") {
      const lang = getCurrentLanguage();
      const syncingMsg =
        lang === "ar"
          ? "جارٍ مزامنة المكالمات من هاتفك…"
          : "Syncing calls from your phone…";
      callsList.innerHTML = `
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <p>${syncingMsg}</p>
        </div>
      `;
      updateTabBadges();
      return;
    }

    callsList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
        </svg>
        <p>No unread calls</p>
        <span>No missed calls to review</span>
      </div>
    `;
    updateTabBadges();
    return;
  }

  callsList.innerHTML = callGroups
    .map(
      (group) => {
        const phoneStr = (group.phoneNumber || "").toString().trim();
        const isVoIP = !phoneStr || phoneStr.toLowerCase() === "unknown" || !normalizePhoneNumber(phoneStr);
        const unknownLabel = getCurrentLanguage() === "ar" ? "مجهول" : "Unknown";
        const displayName = group.contactName
          || (isVoIP ? (group.appName || unknownLabel) : phoneStr)
          || unknownLabel;
        // Calling method — shown on the subtitle so the user can tell at a
        // glance whether the call went through the regular phone line (and
        // which SIM) or via a VoIP app (WhatsApp / Messenger / Teams / …).
        const lastSim = group.lastCall.simSlot;
        const isAr = getCurrentLanguage() === "ar";
        const phoneLabel = isAr ? "هاتف" : "Phone";
        const simLabel = (lastSim != null && lastSim >= 0)
          ? ` · ${isAr ? "شريحة" : "SIM"} ${lastSim + 1}`
          : "";
        const methodLabel = isVoIP
          ? (group.appName || (isAr ? "تطبيق" : "VoIP"))
          : `${phoneLabel}${simLabel}`;
        const lastTime = formatTime(group.lastCall.timestamp);
        const lastLabel = isAr ? "آخر مكالمة" : "Last Call";
        const callTypeText = group.lastCall.type ? getCallTypeLabel(group.lastCall.type) : (isAr ? "غير معروف" : "Unknown");
        const callHoverPreview = `${lastLabel}: ${lastTime} - ${displayName} - ${callTypeText} · ${methodLabel}`;
        const isPinned = isCallGroupPinned(group.key);
        return `
    <div class="list-item call-group call-${group.lastCall.type}${callsSelectionMode && selectedCallGroups.has(group.key) ? " selected" : ""}" data-phone="${
      group.phoneNumber
    }" data-group-key="${group.key}">
      ${callsSelectionMode ? `<div class="conv-checkbox-wrap"><input type="checkbox" class="call-checkbox" ${selectedCallGroups.has(group.key) ? "checked" : ""} tabindex="-1" /></div>` : ""}
      <div class="list-item-avatar">
        ${getInitials(displayName)}
      </div>
      <div class="list-item-content" data-hover-preview="${String(callHoverPreview).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]))}">
        <div class="list-item-title" data-hover-preview="${String(callHoverPreview).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]))}">
          ${!isVoIP ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>` : ""}
          <span class="call-contact-name">${displayName}</span>
        </div>
        <div class="list-item-subtitle" data-hover-preview="${String(callHoverPreview).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]))}">${
          group.lastCall.type
            ? `${getCallTypeLabel(group.lastCall.type)} · ${String(methodLabel).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]))}`
            : isSyncingCalls
              ? '<span class="sms-body-loading"></span>'
              : ""
        }</div>
        ${resolveCallDeviceName(group.lastCall) ? `<div class="call-device-row"><span class="device-tag">${resolveCallDeviceName(group.lastCall)}</span></div>` : ""}
      </div>
      ${!isVoIP ? `<div class="call-list-hover-actions">
        <button class="call-list-hover-btn call-list-hover-wa" title="WhatsApp">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
        </button>
      </div>` : ""}
      <div class="list-item-meta">
        <button class="call-pin-btn${isPinned ? " pinned" : ""}" type="button" title="${isAr ? (isPinned ? "إلغاء التثبيت" : "تثبيت") : (isPinned ? "Unpin" : "Pin")}" aria-label="${isAr ? (isPinned ? "إلغاء التثبيت" : "تثبيت") : (isPinned ? "Unpin" : "Pin")}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 3h6l-1 5 3 3v2H7v-2l3-3-1-5z"></path>
            <path d="M12 13v8"></path>
          </svg>
        </button>
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
  `; })
    .join("");

  wireHoverPreview(callsList);

  // Add click handlers for call groups
  document.querySelectorAll(".call-pin-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const groupEl = btn.closest(".call-group");
      const key = groupEl?.dataset?.groupKey;
      const name = groupEl?.querySelector(".call-contact-name")?.textContent?.trim() || key || "Calls";
      const pinned = await toggleCallGroupPin(key);
      showToast(
        getCurrentLanguage() === "ar"
          ? (pinned ? `تم تثبيت ${name}` : `تم إلغاء تثبيت ${name}`)
          : (pinned ? `${name} pinned` : `${name} unpinned`),
        "success",
      );
      renderCalls(state.allCallsData);
    });
  });

  document.querySelectorAll(".call-group").forEach((el) => {
    el.addEventListener("click", (e) => {
      const groupKey = el.dataset.groupKey;
      if (callsSelectionMode) {
        // Toggle selection
        const cb = el.querySelector(".call-checkbox");
        if (selectedCallGroups.has(groupKey)) {
          selectedCallGroups.delete(groupKey);
          el.classList.remove("selected");
          if (cb) cb.checked = false;
        } else {
          selectedCallGroups.add(groupKey);
          el.classList.add("selected");
          if (cb) cb.checked = true;
        }
        _updateCallsSelectionToolbar(callGroups.length);
        return;
      }
      showCallHistory(groupKey);
    });

    const phoneNumber = el.dataset.phone;

    el.querySelector(".call-list-hover-wa")?.addEventListener("click", (e) => {
      e.stopPropagation();
      let clean = phoneNumber.replace(/[^\d+]/g, "");
      if (clean.startsWith("+")) clean = clean.slice(1);
      else if (clean.startsWith("00")) clean = clean.slice(2);
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
      callsSelectionMode = true;
      selectedCallGroups.clear();
      document.getElementById("callsSelectBtn")?.classList.add("active");
      const toolbar = document.getElementById("callsSelectToolbar");
      if (toolbar) toolbar.style.display = "flex";
      renderCalls(state.allCallsData);
      setTimeout(() => {
        const groupKey = group.dataset.groupKey;
        const el = document.querySelector(`.call-group[data-group-key="${CSS.escape(groupKey)}"]`);
        if (el) {
          selectedCallGroups.add(groupKey);
          el.classList.add("selected");
          const cb = el.querySelector(".call-checkbox");
          if (cb) cb.checked = true;
          _updateCallsSelectionToolbar(document.querySelectorAll(".call-group[data-group-key]").length);
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
 * Show call history for a specific call group
 * @param {string} groupKey - Group key (normalised phone, "contact_name", or "unknown")
 */
async function showCallHistory(groupKey) {
  const { baseKey, scopedDeviceId } = parseScopedCallGroupKey(groupKey);

  // Build the matching filter based on the group key type
  const matchesByGroupKey = (call) => {
    if (scopedDeviceId && (call.deviceId || "_no_device") !== scopedDeviceId) {
      return false;
    }

    const safePhone = (call.phoneNumber && call.phoneNumber.startsWith("ENC:")) ? "" : (call.phoneNumber || "");
    const safeContact = (call.contactName && call.contactName.startsWith("ENC:")) ? "" : (call.contactName || "");
    const normalizedPhone = normalizePhoneNumber(safePhone);
    if (baseKey === "unknown") {
      return !normalizedPhone && !safeContact;
    } else if (baseKey.startsWith("contact_")) {
      return safeContact === baseKey.slice(8);
    } else {
      return normalizePhoneNumber(safePhone) === baseKey;
    }
  };

  const calls = state.allCallsData
    .filter(matchesByGroupKey)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (calls.length === 0) return;

  // Determine display name and phone number from the first (most recent) call
  const rawPhone = (calls[0].phoneNumber || "").toString().trim();
  const isVoIP = !rawPhone || rawPhone.toLowerCase() === "unknown" || !normalizePhoneNumber(rawPhone);
  const phoneNumber = isVoIP ? "" : rawPhone;
  const contactName = calls[0].contactName ||
    (isVoIP ? (calls[0].appName || (getCurrentLanguage() === "ar" ? "مجهول" : "Unknown")) : phoneNumber);
  state.setCurrentCallConversation(groupKey);

  // Mark missed calls for this group as viewed
  const missedToMark = calls.filter(
    (call) => call.type === "missed" && !call.viewed,
  );

  if (missedToMark.length > 0) {
    const missedIds = new Set(missedToMark.map((c) => c.id));
    // Update local state immediately
    const updatedCalls = state.allCallsData.map((call) =>
      missedIds.has(call.id) ? { ...call, viewed: true } : call,
    );
    state.setAllCallsData(updatedCalls);

    // Also update allCallsByDevice so the snapshot handler's preservation check
    // keeps viewed:true when Firestore re-fires with stale viewed:false data.
    Object.keys(state.allCallsByDevice).forEach((deviceId) => {
      const updated = state.allCallsByDevice[deviceId].map((call) =>
        missedIds.has(call.id) ? { ...call, viewed: true } : call,
      );
      state.setCallsByDevice(deviceId, updated);
    });

    updateTabBadges();

    cacheCallsData(state.allCallsByDevice, updatedCalls).catch(() => {});

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
          <div class="conversation-name" style="display:flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            <span>${contactName}</span>
          </div>
          ${!isVoIP && phoneNumber !== contactName ? `<div class="conversation-phone">${phoneNumber}</div>` : ""}
        </div>
        ${!isVoIP ? `<button class="chat-action-btn copy-phone-btn" title="${getCurrentLanguage() === 'ar' ? 'نسخ الرقم' : 'Copy number'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
        </button>` : ""}
        ${!isVoIP ? `<div class="call-action-buttons">
          <button class="call-action-btn call-action-whatsapp" id="whatsappPhoneBtn" title="Open in WhatsApp">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            <span>WhatsApp</span>
          </button>
        </div>` : ""}
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
              <div class="call-type">${getCallTypeLabel(call.type)}</div>
              <div class="call-duration">${formatDuration(call.duration)}</div>
              ${(resolveCallDeviceName(call) || (call.simSlot != null && call.simSlot >= 0)) ? `<div class="call-detail-meta">${resolveCallDeviceName(call) ? `<span class="device-tag">${resolveCallDeviceName(call)}</span>` : ''}${call.simSlot != null && call.simSlot >= 0 ? `<span class="sim-badge sim-${call.simSlot}">${call.simSlot + 1}</span>` : ''}</div>` : ''}
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

  if (!isVoIP) {
    // Copy phone number handler
    document.querySelector(".copy-phone-btn")?.addEventListener("click", () => {
      navigator.clipboard.writeText(phoneNumber).then(() => {
        showToast(getCurrentLanguage() === "ar" ? "تم النسخ" : "Copied!", "success");
      }).catch(() => {
        showToast(getCurrentLanguage() === "ar" ? "فشل النسخ" : "Copy failed", "error");
      });
    });

    // WhatsApp button handler
    document.getElementById("whatsappPhoneBtn")?.addEventListener("click", () => {
      let clean = phoneNumber.replace(/[^\d+]/g, "");
      if (clean.startsWith("+")) clean = clean.slice(1);
      else if (clean.startsWith("00")) clean = clean.slice(2);
      else if (clean.startsWith("0")) clean = "20" + clean.slice(1);
      window.open(`https://wa.me/${clean}`, "_blank");
    });
  }
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
  const groups = document.querySelectorAll(".call-group[data-group-key]");
  groups.forEach((el) => {
    const key = el.dataset.groupKey;
    const cb = el.querySelector(".call-checkbox");
    if (checked) {
      selectedCallGroups.add(key);
      el.classList.add("selected");
      if (cb) cb.checked = true;
    } else {
      selectedCallGroups.delete(key);
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

  const selectedTab =
    document.querySelector("#callsDeviceTabs .device-tab.active")?.dataset.device || "all";

  try {
    const batch = writeBatch(db);
    let deletedCount = 0;
    // Find all calls matching the selected group keys
    state.allCallsData.forEach((call) => {
      const callKey = buildScopedCallGroupKey(call, selectedTab);
      if (selectedCallGroups.has(callKey) && call.deviceId && call.id) {
        const callRef = doc(db, "users", user.uid, "devices", call.deviceId, "calls", call.id);
        batch.delete(callRef);
        deletedCount++;
      }
    });
    if (deletedCount > 0) await batch.commit();

    // Update local state
    const remaining = state.allCallsData.filter((call) => {
      const callKey = buildScopedCallGroupKey(call, selectedTab);
      return !selectedCallGroups.has(callKey);
    });
    Object.keys(state.allCallsByDevice).forEach((deviceId) => {
      const updated = (state.allCallsByDevice[deviceId] || []).filter((call) => {
        const callKey = buildScopedCallGroupKey(call, selectedTab);
        return !selectedCallGroups.has(callKey);
      });
      state.setCallsByDevice(deviceId, updated);
    });
    state.setAllCallsData(remaining);
    cacheCallsData(state.allCallsByDevice, remaining).catch(() => {});
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
  cacheCallsData(state.allCallsByDevice, remaining).catch(() => {});
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
    const devicesSnapshot = await getDocs(query(collection(db, "devices"), where("userId", "==", user.uid)));
    const androidDevices = devicesSnapshot.docs
      .filter((d) => {
        const data = d.data();
        return !String(data.id || d.id).startsWith("ext_");
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
  const activeDevice =
    document.querySelector("#callsDeviceTabs .device-tab.active")?.dataset.device || "all";
  const knownDeviceIds = new Set([
    ...state.devices.map((d) => d.id),
    ...(state.sharedWithMeDevices || []).map((s) => s.deviceId),
  ]);
  let calls = (state.allCallsData || []).filter((c) => !c.deviceId || knownDeviceIds.has(c.deviceId));
  if (activeDevice !== "all") {
    calls = calls.filter((c) => c.deviceId === activeDevice);
  }
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
    const device = resolveCallDeviceName(c) || "";
    return [date, time, type, contact, phone, duration, device].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
  });

  const now = new Date();
  const localStamp = now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0") + "_" +
    String(now.getHours()).padStart(2, "0") + "-" +
    String(now.getMinutes()).padStart(2, "0");

  const csv = "\uFEFF" + [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `iRopit-Calls-${localStamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Load call logs for all shared devices and merge them into the calls list.
 */
export async function loadSharedDevicesCalls(shares) {
  const user = state.currentUser;
  if (!user) return;
  const callShares = (shares || []).filter(
    (s) => s.permissions?.calls && s.deviceId && s.ownerUid,
  );
  if (callShares.length === 0) return;
  for (const share of callShares) {
    try {
      const q = query(
        collection(db, "users", share.ownerUid, "devices", share.deviceId, "calls"),
        orderBy("timestamp", "desc"),
        limit(CALLS_FETCH_LIMIT),
      );
      const snapshot = await getDocs(q);
      const calls = await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          let data = docSnap.data();
          data = await decryptCall(data, share.ownerUid);
          return processCallDoc(data, docSnap.id, share.deviceId, share.deviceName || "");
        }),
      );
      updateCallsList(share.deviceId, calls);
    } catch (err) {
      if (err?.code !== "permission-denied") {
        console.warn(`[Calls] Failed to load shared device ${share.deviceId}:`, err?.code);
      }
    }
  }
}
