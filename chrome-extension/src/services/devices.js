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
  getDocsFromServer,
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

function isUnavailableError(error) {
  const code = String(error?.code || "").toLowerCase();
  const msg = String(error?.message || "").toLowerCase();
  return code.includes("unavailable") || msg.includes("failed to get documents from server");
}

function isPermissionDeniedError(error) {
  const code = String(error?.code || "").toLowerCase();
  const msg = String(error?.message || "").toLowerCase();
  return code.includes("permission-denied") || msg.includes("missing or insufficient permissions");
}

const deviceUnavailableLogKeys = new Set();
function logDeviceUnavailableOnce(key, message, details) {
  if (deviceUnavailableLogKeys.has(key)) return;
  deviceUnavailableLogKeys.add(key);
  if (details !== undefined) {
    console.info(message, details);
  } else {
    console.info(message);
  }
}

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
import { cacheSharedDevices, getCachedSharedDevices, cacheOwnDevices, getCachedOwnDevices } from "./cache.js";

let pendingSharedSmsShares = null;
let sharedSmsDeferredListenerAttached = false;
let pendingSharedCallsShares = null;
let sharedCallsDeferredListenerAttached = false;
let pendingSharedNotifsShares = null;
let sharedNotifsDeferredListenerAttached = false;
const processedIncomingShareReqIds = new Set();
const incomingShareModalByKey = new Map();
const acceptingShareRequestIds = new Set();
const handledIncomingShareKeys = new Map();
let handledIncomingShareKeysLoaded = false;
let handledIncomingShareKeysLoadPromise = null;

function getIncomingShareReqKey(req) {
  return `${req?.ownerUid || ""}::${req?.deviceId || ""}::${req?.sharedWithUid || ""}`;
}

function normalizeHandledIncomingShareKeys(raw) {
  const normalized = {};
  if (!raw || typeof raw !== "object") return normalized;

  Object.entries(raw).forEach(([key, value]) => {
    if (!key) return;
    const ts = Number(value);
    if (!Number.isFinite(ts) || ts <= 0) return;
    normalized[key] = ts;
  });

  return normalized;
}

async function ensureHandledIncomingShareKeysLoaded() {
  if (handledIncomingShareKeysLoaded) return;
  if (handledIncomingShareKeysLoadPromise) {
    await handledIncomingShareKeysLoadPromise;
    return;
  }

  handledIncomingShareKeysLoadPromise = (async () => {
    try {
      const result = await chrome.storage.local.get("handledIncomingShareKeys");
      const normalized = normalizeHandledIncomingShareKeys(result.handledIncomingShareKeys);
      Object.entries(normalized).forEach(([key, ts]) => {
        handledIncomingShareKeys.set(key, ts);
      });
    } catch (_) {
      // Ignore storage read failures; this is only a UX safeguard.
    } finally {
      handledIncomingShareKeysLoaded = true;
      handledIncomingShareKeysLoadPromise = null;
    }
  })();

  await handledIncomingShareKeysLoadPromise;
}

function persistHandledIncomingShareKeys() {
  try {
    const payload = {};
    handledIncomingShareKeys.forEach((ts, key) => {
      if (Number.isFinite(ts) && ts > 0) {
        payload[key] = ts;
      }
    });
    chrome.storage.local.set({ handledIncomingShareKeys: payload });
  } catch (_) {
    // Best-effort persistence only.
  }
}

function markIncomingShareKeyHandled(reqOrKey, handledAt = Date.now()) {
  const key = typeof reqOrKey === "string" ? reqOrKey : getIncomingShareReqKey(reqOrKey);
  if (!key) return;
  const existing = Number(handledIncomingShareKeys.get(key) || 0);
  const nextTs = Math.max(existing, Number(handledAt) || Date.now());
  handledIncomingShareKeys.set(key, nextTs);
  persistHandledIncomingShareKeys();
}

function shouldSuppressIncomingShareRequest(req) {
  const key = getIncomingShareReqKey(req);
  if (!key) return false;

  const handledAt = Number(handledIncomingShareKeys.get(key) || 0);
  if (!Number.isFinite(handledAt) || handledAt <= 0) return false;

  const createdAt = toEpochMs(req?.createdAt);
  // If request timestamp is unavailable, prefer suppressing old repeats.
  if (!createdAt) return true;

  return createdAt <= handledAt;
}

function getSharedWithMeKey(share) {
  const ownerUid = share?.ownerUid || "";
  const deviceId = share?.deviceId || "";
  const sharedWithUid = share?.sharedWithUid || "";
  if (!ownerUid || !deviceId || !sharedWithUid) {
    return `shareId::${share?.shareId || ""}`;
  }
  return `${ownerUid}::${deviceId}::${sharedWithUid}`;
}

function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === "function") {
    try { return value.toMillis(); } catch (_) {}
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dedupeSharedWithMeShares(rawShares) {
  const byKey = new Map();

  (rawShares || []).forEach((share) => {
    const key = getSharedWithMeKey(share);
    const current = byKey.get(key);
    const nextShareId = share?.shareId;

    if (!current) {
      byKey.set(key, {
        ...share,
        shareIds: nextShareId ? [nextShareId] : [],
      });
      return;
    }

    const mergedIds = Array.from(new Set([
      ...(current.shareIds || []),
      ...(nextShareId ? [nextShareId] : []),
    ]));

    const currentTs = toEpochMs(current.createdAt);
    const nextTs = toEpochMs(share.createdAt);
    const keepNext = nextTs > currentTs;

    if (keepNext) {
      byKey.set(key, {
        ...current,
        ...share,
        shareIds: mergedIds,
      });
      return;
    }

    byKey.set(key, {
      ...current,
      device: current.device || share.device || null,
      deviceName: current.deviceName || share.deviceName || "",
      shareIds: mergedIds,
    });
  });

  return Array.from(byKey.values());
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label || "operation"} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function logShareDebug(...args) {
  try {
    const enabled = localStorage.getItem("iropitDebugShare") === "1";
    if (!enabled) return;
  } catch (_) {
    return;
  }
  console.debug(...args);
}

function removeSharedWithMeOptimistic({ shareIds = [], ownerUid = "", deviceId = "", sharedWithUid = "" }) {
  const ids = new Set((shareIds || []).filter(Boolean));
  const removeByLogicalKey = ownerUid && deviceId && sharedWithUid;
  const logicalKey = `${ownerUid}::${deviceId}::${sharedWithUid}`;

  const next = (state.sharedWithMeDevices || []).filter((s) => {
    if (!s) return false;
    if (ids.has(s.shareId)) return false;
    if (removeByLogicalKey && getSharedWithMeKey(s) === logicalKey) return false;
    return true;
  });

  state.setSharedWithMeDevices(next);
  renderDevices();
  updateDeviceSelects();
  cacheSharedDevices(next).catch(() => {});
}

function scheduleSharedSmsLoad(shares) {
  pendingSharedSmsShares = shares || [];

  import("./sms.js")
    .then((m) => {
      const runLatest = () => {
        const latest = pendingSharedSmsShares;
        pendingSharedSmsShares = null;
        if (!latest || latest.length === 0) return;
        if (m.loadSharedDevicesSMS) {
          m.loadSharedDevicesSMS(latest).catch(() => {});
        }
      };

      // Keep own-device SMS as priority. If primary SMS sync is still running,
      // defer shared-SMS preload until the sync-done event fires.
      if (m.isSMSSyncing && m.isSMSSyncing()) {
        if (sharedSmsDeferredListenerAttached) return;
        sharedSmsDeferredListenerAttached = true;
        let fallbackTimer = null;
        const onDone = () => {
          window.removeEventListener("iropit:sms-sync-done", onDone);
          sharedSmsDeferredListenerAttached = false;
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          runLatest();
        };
        window.addEventListener("iropit:sms-sync-done", onDone, { once: true });
        // Safety net: if the sync-done event is missed or a long sync stalls,
        // still start shared listeners so shared SMS is not permanently stale.
        fallbackTimer = setTimeout(() => {
          try { window.removeEventListener("iropit:sms-sync-done", onDone); } catch (_) {}
          sharedSmsDeferredListenerAttached = false;
          runLatest();
        }, 8000);
        return;
      }

      runLatest();
    })
    .catch(() => {});
}

function scheduleSharedCallsLoad(shares) {
  pendingSharedCallsShares = shares || [];

  import("./calls.js")
    .then((m) => {
      const runLatest = () => {
        const latest = pendingSharedCallsShares;
        pendingSharedCallsShares = null;
        if (!latest || latest.length === 0) return;
        if (m.loadSharedDevicesCalls) {
          m.loadSharedDevicesCalls(latest).catch(() => {});
        }
      };

      if (m.isCallsSyncing && m.isCallsSyncing()) {
        if (sharedCallsDeferredListenerAttached) return;
        sharedCallsDeferredListenerAttached = true;
        const onDone = () => {
          window.removeEventListener("iropit:calls-sync-done", onDone);
          sharedCallsDeferredListenerAttached = false;
          runLatest();
        };
        window.addEventListener("iropit:calls-sync-done", onDone, { once: true });
        return;
      }

      runLatest();
    })
    .catch(() => {});
}

function scheduleSharedNotificationsLoad(shares) {
  pendingSharedNotifsShares = shares || [];

  import("./notifications.js")
    .then((m) => {
      const runLatest = () => {
        const latest = pendingSharedNotifsShares;
        pendingSharedNotifsShares = null;
        if (!latest || latest.length === 0) return;
        if (m.loadSharedDevicesNotifications) {
          m.loadSharedDevicesNotifications(latest).catch(() => {});
        }
      };

      // notificationsDataUpdated fires when own notifications snapshots complete.
      if (m.isNotificationsSyncing && m.isNotificationsSyncing()) {
        if (sharedNotifsDeferredListenerAttached) return;
        sharedNotifsDeferredListenerAttached = true;
        const onDone = () => {
          document.removeEventListener("notificationsDataUpdated", onDone);
          sharedNotifsDeferredListenerAttached = false;
          runLatest();
        };
        document.addEventListener("notificationsDataUpdated", onDone, { once: true });
        return;
      }

      runLatest();
    })
    .catch(() => {});
}

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

  await ensureHandledIncomingShareKeysLoaded();

  const mapOwnDeviceDoc = (docSnap) => {
    const data = docSnap.data() || {};
    if (data?.userId && data.userId !== user.uid) return null;
    // Be defensive against soft-delete schemas used by other clients.
    if (data?.isDeleted === true || data?.deletedAt) return null;
    // Normalize to a single canonical device id used across UI/state.
    const normalizedId = data.id || docSnap.id;
    if (!normalizedId) return null;
    // Ignore malformed legacy duplicates that point to a different canonical id.
    if (data.id && data.id !== docSnap.id) return null;
    return { ...data, id: normalizedId, docId: docSnap.id };
  };

  const dedupeOwnDevices = (devices) => {
    const byId = new Map();
    (devices || []).forEach((device) => {
      if (!device?.id) return;
      const prev = byId.get(device.id);
      if (!prev) {
        byId.set(device.id, device);
        return;
      }
      const prevSeen = Number(prev.lastSeen || prev.lastActiveAt || 0);
      const curSeen = Number(device.lastSeen || device.lastActiveAt || 0);
      if (curSeen >= prevSeen) {
        byId.set(device.id, device);
      }
    });
    return Array.from(byId.values());
  };

  const applyOwnDevices = (devices) => {
    state.setDevices(devices);
    renderDevices();
    updateDeviceSelects();
    cacheOwnDevices(devices).catch(() => {});
  };

  let serverReconcileInFlight = false;
  let lastServerReconcileAt = 0;
  const SERVER_RECONCILE_MIN_INTERVAL_MS = 5000;

  // Restore cached own devices instantly so tabs/list are visible on reopen
  // before Firestore snapshot network round-trip finishes.
  getCachedOwnDevices().then((cached) => {
    if (cached && cached.length > 0) {
      const normalizedCached = dedupeOwnDevices(
        cached
          .map((d) => {
            if (!d || typeof d !== "object") return null;
            if (d?.userId && d.userId !== user.uid) return null;
            if (d?.isDeleted === true || d?.deletedAt) return null;
            const normalizedId = d.id || d.docId;
            if (!normalizedId) return null;
            return { ...d, id: normalizedId };
          })
          .filter(Boolean),
      );
      if (normalizedCached.length > 0) {
        state.setDevices(normalizedCached);
        renderDevices();
        updateDeviceSelects();
      }
    }
  }).catch(() => {});

  // Load local caches in background; never block realtime subscriptions.
  _loadVersionCache()
    .then(() => {
      if ((state.devices || []).length > 0) renderDevices();
    })
    .catch(() => {});
  loadDeviceSyncPrefs()
    .then(() => updateDeviceSelects())
    .catch(() => {});

  const q = query(collection(db, "devices"), where("userId", "==", user.uid));

  const reconcileOwnDevicesFromServer = async (reason, force = false) => {
    const now = Date.now();
    if (!force && now - lastServerReconcileAt < SERVER_RECONCILE_MIN_INTERVAL_MS) {
      return;
    }
    if (serverReconcileInFlight) return;
    serverReconcileInFlight = true;
    try {
      const serverSnap = await getDocsFromServer(q);
      const serverDevices = [];
      let cacheUpdated = false;
      serverSnap.forEach((doc) => {
        const mapped = mapOwnDeviceDoc(doc);
        if (!mapped) return;
        serverDevices.push(mapped);
        if (mapped.appVersion && mapped.id && _deviceVersionCache[mapped.id] !== mapped.appVersion) {
          _deviceVersionCache[mapped.id] = mapped.appVersion;
          cacheUpdated = true;
        }
      });
      if (cacheUpdated) _saveVersionCache();
      applyOwnDevices(dedupeOwnDevices(serverDevices));
    } catch (err) {
      if (isUnavailableError(err)) {
        logDeviceUnavailableOnce(
          `server-reconcile:${reason}`,
          `[Device] server reconcile skipped (${reason}) - backend unavailable`,
          err?.code || err?.message,
        );
      } else if (isPermissionDeniedError(err)) {
        logDeviceUnavailableOnce(
          `server-reconcile-permission:${reason}`,
          `[Device] server reconcile skipped (${reason}) - permission denied`,
          err?.code || err?.message,
        );
      } else {
        console.warn(`[Device] server reconcile failed (${reason}):`, err?.code || err?.message || err);
      }
    } finally {
      lastServerReconcileAt = Date.now();
      serverReconcileInFlight = false;
    }
  };

  const unsub = onSnapshot(
    q,
    (snapshot) => {
      const newDevices = [];
      let cacheUpdated = false;
      snapshot.forEach((doc) => {
        const mapped = mapOwnDeviceDoc(doc);
        if (!mapped) return;
        const data = mapped;
        newDevices.push(mapped);
        // Cache appVersion whenever it is present so offline devices still show it
        if (data.appVersion && data.id && _deviceVersionCache[data.id] !== data.appVersion) {
          _deviceVersionCache[data.id] = data.appVersion;
          cacheUpdated = true;
        }
      });
      if (cacheUpdated) _saveVersionCache();

      applyOwnDevices(dedupeOwnDevices(newDevices));

      // When snapshot is cache-sourced, force a near-term server reconcile to
      // drop stale devices deleted on another client.
      if (snapshot?.metadata?.fromCache) {
        reconcileOwnDevicesFromServer("cache-snapshot").catch(() => {});
      }
    },
    (error) => {
      if (isPermissionDeniedError(error)) {
        logDeviceUnavailableOnce(
          "loadDevices:onSnapshot:permission",
          "[Device] loadDevices onSnapshot skipped - permission denied",
          error?.code || error?.message,
        );
        return;
      }
      if (isUnavailableError(error)) {
        logDeviceUnavailableOnce(
          "loadDevices:onSnapshot",
          "[Device] loadDevices onSnapshot unavailable",
          error?.code || error?.message,
        );
        return;
      }
      console.error("[Device] loadDevices onSnapshot error:", error?.code, error?.message);
    },
  );

  state.addUnsubscriber(unsub);

  // One immediate authoritative server pass at startup.
  reconcileOwnDevicesFromServer("initial-load", true).catch(() => {});

  // ── Subscribe to devices shared WITH the current user ──────────────────────
  // Restore cached shared devices instantly so the tab appears before the snapshot fires.
  getCachedSharedDevices().then((cached) => {
    if (cached && cached.length > 0) {
      state.setSharedWithMeDevices(cached);
      renderDevices();
      updateDeviceSelects();
      // Pre-load SMS/calls/notifs from shared devices using cached share info
      Promise.all([
        Promise.resolve().then(() => scheduleSharedSmsLoad(cached)),
        Promise.resolve().then(() => scheduleSharedCallsLoad(cached)),
        Promise.resolve().then(() => scheduleSharedNotificationsLoad(cached)),
      ]);
    }
  }).catch(() => {});

  const sharesQ = query(
    collection(db, "deviceShares"),
    where("sharedWithUid", "==", user.uid),
  );

  const applySharedWithMeShares = (shares) => {
    state.setSharedWithMeDevices(shares);
    renderDevices();
    updateDeviceSelects();
    cacheSharedDevices(shares).catch(() => {});
    Promise.all([
      Promise.resolve().then(() => scheduleSharedSmsLoad(shares)),
      Promise.resolve().then(() => scheduleSharedCallsLoad(shares)),
      Promise.resolve().then(() => scheduleSharedNotificationsLoad(shares)),
    ]);
  };

  const enrichSharedWithMeShares = async (shares) => {
    const enrichedRaw = await Promise.all(shares.map(async (share) => {
      if (!share.deviceDocId) return share;
      try {
        const deviceSnap = await getDoc(doc(db, "devices", share.deviceDocId));
        return { ...share, device: deviceSnap.exists() ? { ...deviceSnap.data(), docId: deviceSnap.id } : null };
      } catch (_) {
        return share;
      }
    }));
    const enriched = dedupeSharedWithMeShares(enrichedRaw);
    state.setSharedWithMeDevices(enriched);
    renderDevices();
    cacheSharedDevices(enriched).catch(() => {});
  };

  let sharedServerReconcileInFlight = false;
  let lastSharedServerReconcileAt = 0;
  const SHARED_SERVER_RECONCILE_MIN_INTERVAL_MS = 2500;

  const reconcileSharedWithMeFromServer = async (reason, force = false) => {
    const now = Date.now();
    if (!force && now - lastSharedServerReconcileAt < SHARED_SERVER_RECONCILE_MIN_INTERVAL_MS) {
      return;
    }
    if (sharedServerReconcileInFlight) return;
    sharedServerReconcileInFlight = true;
    try {
      const serverSnap = await getDocsFromServer(sharesQ);
      const rawShares = serverSnap.docs.map((shareDoc) => ({
        shareId: shareDoc.id,
        ...shareDoc.data(),
        device: null,
      }));
      const shares = dedupeSharedWithMeShares(rawShares);
      applySharedWithMeShares(shares);
      enrichSharedWithMeShares(shares).catch(() => {});
    } catch (err) {
      if (isUnavailableError(err)) {
        logDeviceUnavailableOnce(
          `shared-server-reconcile:${reason}`,
          `[Device] shared-with-me server reconcile skipped (${reason}) - backend unavailable`,
          err?.code || err?.message,
        );
      } else if (isPermissionDeniedError(err)) {
        logDeviceUnavailableOnce(
          `shared-server-reconcile-permission:${reason}`,
          `[Device] shared-with-me server reconcile skipped (${reason}) - permission denied`,
          err?.code || err?.message,
        );
      } else {
        console.warn(`[Device] shared-with-me server reconcile failed (${reason}):`, err?.code || err?.message || err);
      }
    } finally {
      lastSharedServerReconcileAt = Date.now();
      sharedServerReconcileInFlight = false;
    }
  };

  const sharesUnsub = onSnapshot(
    sharesQ,
    async (snapshot) => {
      // Build shares immediately from snapshot docs — each doc already contains
      // deviceName, deviceId, ownerUid and permissions, which is everything needed
      // to render the tab and load SMS/calls data. Don't await getDoc here.
      const rawShares = snapshot.docs.map((shareDoc) => ({
        shareId: shareDoc.id,
        ...shareDoc.data(),
        device: null, // enriched below in background
      }));
      const shares = dedupeSharedWithMeShares(rawShares);

      // ── Render tabs + load data RIGHT AWAY ─────────────────────────────────
      applySharedWithMeShares(shares);

      // ── Enrich with live device docs in background (for Devices tab detail) ─
      // This runs AFTER the tab is already visible — no UX blocking.
      await enrichSharedWithMeShares(shares);

      // Cache snapshots can contain stale shares for a short time right after
      // owner-side stop sharing; force a quick authoritative server pass.
      if (snapshot?.metadata?.fromCache) {
        reconcileSharedWithMeFromServer("cache-snapshot").catch(() => {});
      }
    },
    (error) => {
      if (isPermissionDeniedError(error)) {
        logDeviceUnavailableOnce(
          "shared-with-me:onSnapshot:permission",
          "[Device] shared-with-me snapshot skipped - permission denied",
          error?.code || error?.message,
        );
        return;
      }
      if (isUnavailableError(error)) {
        logDeviceUnavailableOnce(
          "shared-with-me:onSnapshot:unavailable",
          "[Device] shared-with-me snapshot unavailable",
          error?.code || error?.message,
        );
        return;
      }
      console.error("[Device] shared-with-me snapshot error:", error?.code);
    },
  );
  state.addUnsubscriber(sharesUnsub);

  // Immediate authoritative shared-with-me pass on startup.
  reconcileSharedWithMeFromServer("initial-load", true).catch(() => {});

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
        const incomingReq = { requestId: change.doc.id, ...change.doc.data() };
        if (shouldSuppressIncomingShareRequest(incomingReq)) return;
        const incomingKey = getIncomingShareReqKey(incomingReq);
        if (processedIncomingShareReqIds.has(incomingReq.requestId)) return;
        const existingReqId = incomingShareModalByKey.get(incomingKey);
        if (existingReqId && existingReqId !== incomingReq.requestId) return;
        _showIncomingShareRequestModal(incomingReq);
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
        <button
          class="remove-shared-device-btn"
          data-share-id="${escapeHtml(share.shareId)}"
          data-share-ids="${escapeHtml((share.shareIds && share.shareIds.length > 0 ? share.shareIds : [share.shareId]).join(","))}"
          data-owner-uid="${escapeHtml(share.ownerUid || "")}"
          data-device-id="${escapeHtml(share.deviceId || "")}"
          data-shared-with-uid="${escapeHtml(share.sharedWithUid || "")}"
          title="${t("device_stop_sharing")}">
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
      const device = state.devices.find(
        (d) => (docId && d.docId === docId) || (deviceId && d.id === deviceId),
      );
      if (device) showShareDeviceModal(device);
    });
  });

  // Add stop-sharing handlers (recipient side — remove share from their list)
  document.querySelectorAll(".remove-shared-device-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const shareId = btn.dataset.shareId;
      const ownerUid = btn.dataset.ownerUid || "";
      const deviceId = btn.dataset.deviceId || "";
      const sharedWithUid = btn.dataset.sharedWithUid || "";
      const shareIdsFromUi = (btn.dataset.shareIds || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const isAr = getCurrentLanguage() === "ar";
      const msg = isAr
        ? "إزالة هذا الجهاز المشترك من قائمتك؟"
        : "Remove this shared device from your list?";
      if (await showConfirmDialog(msg)) {
        const previousSharedWithMe = [...(state.sharedWithMeDevices || [])];
        const incomingKey = getIncomingShareReqKey({ ownerUid, deviceId, sharedWithUid });
        markIncomingShareKeyHandled(incomingKey);
        removeSharedWithMeOptimistic({
          shareIds: [shareId, ...shareIdsFromUi],
          ownerUid,
          deviceId,
          sharedWithUid,
        });

        try {
          const deleteIds = new Set([...(shareId ? [shareId] : []), ...shareIdsFromUi]);

          // Query by logical share key to remove duplicates created by retries.
          if (ownerUid && deviceId && sharedWithUid) {
            const dupQ = query(
              collection(db, "deviceShares"),
              where("ownerUid", "==", ownerUid),
              where("deviceId", "==", deviceId),
              where("sharedWithUid", "==", sharedWithUid),
            );
            try {
              const dupSnap = await withTimeout(getDocs(dupQ), 4000, "query duplicate shares");
              dupSnap.docs.forEach((d) => deleteIds.add(d.id));
            } catch (dupErr) {
              logShareDebug("[Share] duplicate share query skipped:", dupErr?.message || dupErr);
            }
          }

          const ids = Array.from(deleteIds);
          if (ids.length === 0) {
            showToast(isAr ? "لا يوجد عنصر للحذف" : "Nothing to remove", "error");
            return;
          }

          const deleteResults = await Promise.allSettled(
            ids.map((id) => withTimeout(deleteDoc(doc(db, "deviceShares", id)), 5000, `delete share ${id}`)),
          );
          const deletedCount = deleteResults.filter((r) => r.status === "fulfilled").length;
          const rejectedReasons = deleteResults
            .filter((r) => r.status === "rejected")
            .map((r) => r.reason);
          const hasPermissionDenied = rejectedReasons.some(
            (reason) => reason?.code === "permission-denied" || String(reason?.message || "").toLowerCase().includes("permission-denied"),
          );

          if (deletedCount === 0) {
            if (hasPermissionDenied) {
              throw new Error("permission-denied while deleting share");
            }
            // Treat stale/missing docs as already removed to keep UI consistent.
            showToast(isAr ? "تمت الإزالة" : "Shared device removed", "success");
            return;
          }

          showToast(
            deletedCount < ids.length
              ? (isAr ? "تمت الإزالة جزئياً" : "Shared device removed (partial)")
              : (isAr ? "تمت إزالة الجهاز المشترك" : "Shared device removed"),
            "success",
          );

          // Best-effort: resolve any stale pending share requests so they do not
          // reopen every time the popup starts.
          if (ownerUid && deviceId && sharedWithUid) {
            const staleReqQ = query(
              collection(db, "deviceShareRequests"),
              where("ownerUid", "==", ownerUid),
              where("sharedWithUid", "==", sharedWithUid),
              where("deviceId", "==", deviceId),
              where("status", "==", "pending"),
            );

            withTimeout(getDocs(staleReqQ), 3500, "query stale share requests")
              .then((staleReqSnap) => Promise.allSettled(
                staleReqSnap.docs.map((d) => withTimeout(
                  updateDoc(d.ref, { status: "rejected", resolvedAt: Date.now() }),
                  3000,
                  `resolve stale request ${d.id}`,
                )),
              ))
              .catch((cleanupErr) => {
                logShareDebug("[Share] stale request cleanup skipped:", cleanupErr?.message || cleanupErr);
              });
          }
        } catch (err) {
          console.error("[Share] remove shared device error:", err);
          state.setSharedWithMeDevices(previousSharedWithMe);
          renderDevices();
          updateDeviceSelects();
          cacheSharedDevices(previousSharedWithMe).catch(() => {});
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
  // Re-render all list views so device tags (including Shared badges) resolve
  // immediately with fresh state.devices/sharedWithMeDevices on first open.
  import("./sms.js")
    .then((m) => {
      if (state.allSMSMessages && state.allSMSMessages.length > 0) {
        m.renderSMS(state.allSMSMessages);
      }
    })
    .catch(() => {});
  import("./calls.js")
    .then((m) => {
      if (state.allCallsData && state.allCallsData.length > 0) {
        m.renderCalls(state.allCallsData);
      }
    })
    .catch(() => {});
  import("./notifications.js").then((m) => m.reRenderNotifications()).catch(() => {});
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

function hasSharedPermission(share, type) {
  if (!share || !type) return false;
  const perms = share.permissions;
  if (perms == null) return true;
  if (typeof perms === "object" && !Array.isArray(perms)) {
    return perms[type] !== false;
  }
  if (Array.isArray(perms)) {
    return perms.includes(type) || perms.includes("all");
  }
  if (typeof perms === "string") {
    const p = perms.toLowerCase();
    return p === type || p === "all" || p.includes(type);
  }
  return false;
}

function getSmsDeviceCount(deviceId) {
  if (deviceId === "all") {
    const ownCount = mobileDevicesOnly().reduce((t, d) => t + getSmsDeviceCount(d.id), 0);
    const sharedCount = (state.sharedWithMeDevices || [])
      .filter(s => hasSharedPermission(s, "sms"))
      .reduce((t, s) => t + (state.allSMS[s.deviceId] || []).filter(m => !m.read).length, 0);
    return ownCount + sharedCount;
  }
  return (state.allSMS[deviceId] || []).filter(m => !m.read).length;
}

function getCallsDeviceCount(deviceId) {
  if (deviceId === "all") {
    const ownCount = mobileDevicesOnly().reduce((t, d) => t + getCallsDeviceCount(d.id), 0);
    const sharedCount = (state.sharedWithMeDevices || [])
      .filter(s => hasSharedPermission(s, "calls"))
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
      .filter(s => hasSharedPermission(s, "notifications"))
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
  const sharedSmsDevices = (state.sharedWithMeDevices || []).filter(
    (s) => hasSharedPermission(s, "sms") && s.deviceId,
  );
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
  const sharedCallsDevices = (state.sharedWithMeDevices || []).filter(
    (s) => hasSharedPermission(s, "calls") && s.deviceId,
  );
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
  const sharedNotifsDevices = (state.sharedWithMeDevices || []).filter(
    (s) => hasSharedPermission(s, "notifications") && s.deviceId,
  );
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
  const unknownText = t("device_unknown");

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.id = "editDeviceModal";
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>${t("device_edit_modal_title")}</h3>
        <button class="modal-close-btn" id="closeEditModal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="device-info-preview">
          <div class="info-row">
            <span class="info-label">${t("device_id_label")}:</span>
            <span class="info-value">${escapeHtml(device.id)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">${t("device_model_label")}:</span>
            <span class="info-value">${escapeHtml(device.model || unknownText)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">${t("device_platform_label")}:</span>
            <span class="info-value">${escapeHtml(device.platform || unknownText)}</span>
          </div>
        </div>
        <div class="form-group">
          <label for="deviceNickname">${t("device_nickname_label")}</label>
          <input type="text" id="deviceNickname" value="${escapeHtml(currentName)}" placeholder="${t("device_nickname_placeholder")}" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancelEditDevice">${t("sms_btn_cancel")}</button>
        <button class="btn btn-primary" id="saveDeviceName">${t("settings_save")}</button>
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
  let existingShares = [];
  let pendingRequests = [];

  const renderExistingSharesHtml = () => {
    if (existingShares.length === 0 && pendingRequests.length === 0) return "";
    return `
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
              <span class="device-pending-badge" style="font-size:11px;">${isAr ? "(قيد الانتظار)" : "(Pending)"}</span>
              <button class="stop-sharing-btn btn btn-danger-small" data-request-id="${escapeHtml(r.requestId)}" data-email="${escapeHtml(r.sharedWithEmail)}" data-device-id="${escapeHtml(r.deviceId || device.id)}" data-shared-uid="${escapeHtml(r.sharedWithUid || "")}">
                ${isAr ? "إلغاء الطلب" : "Cancel Request"}
              </button>
            </div>
          `;
        }).join("")}
      </div>
    `;
  };

  // Show modal immediately, then populate share history asynchronously.
  let resolveSharesLoaded;
  const sharesLoaded = new Promise((resolve) => {
    resolveSharesLoaded = resolve;
  });

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
        <div id="shareExistingContainer" style="min-height: 20px;">
          <div style="font-size:12px;color:var(--text-secondary);">${isAr ? "جارٍ تحميل المشاركات الحالية..." : "Loading current shares..."}</div>
        </div>
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

  const existingContainer = document.getElementById("shareExistingContainer");
  (async () => {
    try {
      const sharesSnap = await getDocs(
        query(
          collection(db, "deviceShares"),
          where("ownerUid", "==", user.uid),
          where("deviceId", "==", device.id),
        ),
      );
      existingShares = sharesSnap.docs.map((d) => ({ shareId: d.id, ...d.data() }));
    } catch (_) {
      existingShares = [];
    }

    try {
      const pendingSnap = await getDocs(
        query(
          collection(db, "deviceShareRequests"),
          where("ownerUid", "==", user.uid),
          where("deviceId", "==", device.id),
          where("status", "==", "pending"),
        ),
      );
      pendingRequests = pendingSnap.docs.map((d) => ({ requestId: d.id, ...d.data() }));
    } catch (_) {
      pendingRequests = [];
    }

    if (existingContainer) {
      existingContainer.innerHTML = renderExistingSharesHtml();
    }
    resolveSharesLoaded();
  })();

  // Close handlers
  document.getElementById("closeShareModal").addEventListener("click", () => modal.remove());
  document.getElementById("cancelShare").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

  // Stop sharing handler (event delegation so it works with async-rendered rows)
  modal.addEventListener("click", async (e) => {
    const btn = e.target.closest(".stop-sharing-btn");
    if (!btn || !modal.contains(btn)) return;
    const shareId = btn.dataset.shareId;
    const requestId = btn.dataset.requestId;
    const email = btn.dataset.email;
    const sharedUid = btn.dataset.sharedUid || "";
    const deviceId = btn.dataset.deviceId || device.id;
    const emailKey = String(email || "").trim().toLowerCase();
    const msg = requestId
      ? (isAr ? `إلغاء طلب المشاركة المرسل إلى "${email}"؟` : `Cancel pending request to "${email}"?`)
      : (isAr ? `إيقاف مشاركة الجهاز مع "${email}"؟` : `Stop sharing with "${email}"?`);
      if (await showConfirmDialog(msg)) {
        try {
          if (requestId) {
            const prevPending = [...pendingRequests];
            const prevExistingShares = [...existingShares];
            const optimisticRemovedIds = new Set();

            pendingRequests = pendingRequests.filter((r) => r.requestId !== requestId);

            if (sharedUid) {
              existingShares = existingShares.filter((s) => {
                if (s.sharedWithUid === sharedUid) {
                  if (s.shareId) optimisticRemovedIds.add(s.shareId);
                  return false;
                }
                return true;
              });
            } else {
              existingShares = existingShares.filter((s) => {
                const isMatch = String(s.sharedWithEmail || "").trim().toLowerCase() === emailKey;
                if (isMatch && s.shareId) optimisticRemovedIds.add(s.shareId);
                return !isMatch;
              });
            }

            if (existingContainer) {
              existingContainer.innerHTML = renderExistingSharesHtml();
            }

            try {
              await withTimeout(deleteDoc(doc(db, "deviceShareRequests", requestId)), 5000, "delete share request");

              // Cancel should also stop any already-active share (race-safe).
              const activeShareQ = sharedUid
                ? query(
                    collection(db, "deviceShares"),
                    where("ownerUid", "==", user.uid),
                    where("deviceId", "==", deviceId),
                    where("sharedWithUid", "==", sharedUid),
                  )
                : query(
                    collection(db, "deviceShares"),
                    where("ownerUid", "==", user.uid),
                    where("deviceId", "==", deviceId),
                    where("sharedWithEmail", "==", emailKey),
                  );

              const activeShareSnap = await withTimeout(getDocs(activeShareQ), 5000, "query active shares");
              if (!activeShareSnap.empty) {
                const shareDocs = activeShareSnap.docs;
                await Promise.allSettled(
                  shareDocs.map((d) => withTimeout(deleteDoc(d.ref), 5000, `delete active share ${d.id}`)),
                );

                const resolvedUids = new Set(
                  shareDocs.map((d) => d.data()?.sharedWithUid).filter(Boolean),
                );
                if (sharedUid) resolvedUids.add(sharedUid);
                resolvedUids.forEach((uid) => {
                  withTimeout(deleteDoc(doc(db, "deviceShareIndex", `${deviceId}_${uid}`)), 5000, "delete share index").catch(() => {});
                });

                shareDocs.forEach((d) => optimisticRemovedIds.add(d.id));
              }

              if (optimisticRemovedIds.size > 0) {
                removeSharedWithMeOptimistic({
                  shareIds: Array.from(optimisticRemovedIds),
                  ownerUid: user.uid,
                  deviceId,
                  sharedWithUid: sharedUid,
                });
              }
            } catch (requestErr) {
              pendingRequests = prevPending;
              existingShares = prevExistingShares;
              if (existingContainer) {
                existingContainer.innerHTML = renderExistingSharesHtml();
              }
              throw requestErr;
            }
          } else {
            const prevExistingShares = [...existingShares];
            const optimisticRemovedIds = new Set();

            const duplicateShareIds = existingShares
              .filter((s) => {
                if (!s) return false;
                if (sharedUid) return s.sharedWithUid === sharedUid;
                return String(s.sharedWithEmail || "").trim().toLowerCase() === emailKey;
              })
              .map((s) => s.shareId)
              .filter(Boolean);

            const uniqueDeleteIds = Array.from(new Set([
              ...(shareId ? [shareId] : []),
              ...duplicateShareIds,
            ]));

            if (sharedUid) {
              existingShares = existingShares.filter((s) => s.sharedWithUid !== sharedUid);
            } else {
              existingShares = existingShares.filter(
                (s) => String(s.sharedWithEmail || "").trim().toLowerCase() !== emailKey,
              );
            }
            uniqueDeleteIds.forEach((id) => optimisticRemovedIds.add(id));
            if (existingContainer) {
              existingContainer.innerHTML = renderExistingSharesHtml();
            }

            if (uniqueDeleteIds.length > 0) {
              const deleteResults = await Promise.allSettled(
                uniqueDeleteIds.map((id) => withTimeout(deleteDoc(doc(db, "deviceShares", id)), 5000, `delete share ${id}`)),
              );
              const deletedCount = deleteResults.filter((r) => r.status === "fulfilled").length;
              const rejectedReasons = deleteResults
                .filter((r) => r.status === "rejected")
                .map((r) => r.reason);
              const hasPermissionDenied = rejectedReasons.some(
                (reason) => reason?.code === "permission-denied" || String(reason?.message || "").toLowerCase().includes("permission-denied"),
              );
              if (deletedCount === 0) {
                if (!hasPermissionDenied) {
                  // All targets were likely stale/non-existent, keep optimistic removal.
                  // No rollback needed in this case.
                } else {
                  existingShares = prevExistingShares;
                  if (existingContainer) {
                    existingContainer.innerHTML = renderExistingSharesHtml();
                  }
                  throw new Error("permission-denied while deleting share");
                }
              }
            }

            // Also remove from deviceShareIndex (for Firestore rules)
            if (deviceId && sharedUid) {
              withTimeout(deleteDoc(doc(db, "deviceShareIndex", `${deviceId}_${sharedUid}`)), 5000, "delete share index").catch(() => {});
            }

            if (optimisticRemovedIds.size > 0) {
              removeSharedWithMeOptimistic({
                shareIds: Array.from(optimisticRemovedIds),
                ownerUid: user.uid,
                deviceId,
                sharedWithUid: sharedUid,
              });
            }
          }

          if (existingContainer) {
            existingContainer.innerHTML = renderExistingSharesHtml();
          }

          showToast(
            requestId
              ? (isAr ? "تم إلغاء الطلب" : "Request canceled")
              : (isAr ? "تم إيقاف المشاركة" : "Sharing stopped"),
            "success",
          );
        } catch (err) {
          console.error("[Share] stop/cancel sharing error:", err);
          showToast(
            requestId
              ? (isAr ? "فشل إلغاء الطلب" : "Failed to cancel request")
              : (isAr ? "فشل إيقاف المشاركة" : "Failed to stop sharing"),
            "error",
          );
        }
      }
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

      // Ensure duplicate checks include the latest asynchronously loaded lists.
      await sharesLoaded;

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

  const modalKey = getIncomingShareReqKey(req);

  // Avoid duplicate modals for the same request
  if (document.getElementById(`shareReqModal_${req.requestId}`)) return;
  const activeReqIdForKey = incomingShareModalByKey.get(modalKey);
  if (activeReqIdForKey && activeReqIdForKey !== req.requestId) return;

  processedIncomingShareReqIds.add(req.requestId);
  incomingShareModalByKey.set(modalKey, req.requestId);

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
        <button class="btn btn-primary share-req-accept-btn" id="shareReqAccept_${req.requestId}" style="color:#000 !important;">
          <span class="share-req-btn-label">${isAr ? "قبول" : "Accept"}</span>
          <span class="share-req-btn-spinner" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const acceptBtn = document.getElementById(`shareReqAccept_${req.requestId}`);
  const rejectBtn = document.getElementById(`shareReqReject_${req.requestId}`);

  const closeModal = () => {
    try { modal.remove(); } catch (_) {}
    if (incomingShareModalByKey.get(modalKey) === req.requestId) {
      incomingShareModalByKey.delete(modalKey);
    }
  };

  const setStatus = (msg, isError) => {
    const el = document.getElementById(`shareReqStatus_${req.requestId}`);
    if (el) {
      el.textContent = msg;
      el.style.display = "block";
      el.style.background = isError ? "#c0392b" : "#276749";
    }
  };

  const setAcceptWorking = (isWorking) => {
    if (!acceptBtn || !rejectBtn) return;
    acceptBtn.disabled = isWorking;
    rejectBtn.disabled = isWorking;
    acceptBtn.classList.toggle("is-working", isWorking);
  };

  acceptBtn.addEventListener("click", async () => {
    if (acceptingShareRequestIds.has(req.requestId)) return;
    acceptingShareRequestIds.add(req.requestId);
    setAcceptWorking(true);
    setStatus(isAr ? "جاري قبول الطلب..." : "Accepting request...", false);

    // Optimistic local state update so the shared device appears immediately,
    // without waiting for Firestore network latency.
    const previousSharedWithMe = [...(state.sharedWithMeDevices || [])];
    const optimisticShare = {
      shareId: req.requestId,
      ownerUid: req.ownerUid,
      ownerEmail: req.ownerEmail,
      sharedWithUid: user.uid,
      sharedWithEmail: req.sharedWithEmail,
      deviceId: req.deviceId,
      deviceDocId: req.deviceDocId,
      deviceName: req.deviceName || "",
      permissions: req.permissions || {},
      createdAt: Date.now(),
    };
    const optimisticShares = dedupeSharedWithMeShares([
      ...previousSharedWithMe,
      optimisticShare,
    ]);
    state.setSharedWithMeDevices(optimisticShares);
    renderDevices();
    updateDeviceSelects();
    cacheSharedDevices(optimisticShares).catch(() => {});

    // Keep UX snappy: show spinner briefly, then close while backend finalizes.
    setTimeout(closeModal, 150);

    try {
      const shareRef = doc(collection(db, "deviceShares"));
      const shareIndexRef = doc(db, "deviceShareIndex", `${req.deviceId}_${user.uid}`);
      const reqRef = doc(db, "deviceShareRequests", req.requestId);
      const criticalBatch = writeBatch(db);

      // Create the active deviceShare doc and share index first.
      // These are the critical writes required for access.
      criticalBatch.set(shareRef, {
        ownerUid: req.ownerUid,
        ownerEmail: req.ownerEmail,
        deviceId: req.deviceId,
        deviceDocId: req.deviceDocId,
        deviceName: req.deviceName || "",
        sharedWithEmail: req.sharedWithEmail,
        sharedWithUid: user.uid,
        permissions: req.permissions || {},
        createdAt: Date.now(),
      });

      // Create deviceShareIndex entry for Firestore security rules
      criticalBatch.set(shareIndexRef, {
        ownerUid: req.ownerUid,
        deviceId: req.deviceId,
        sharedWithUid: user.uid,
      }, { merge: true });

      // Mark this request as accepted in the same critical batch so it does not
      // remain pending if background cleanup fails.
      criticalBatch.set(reqRef, {
        status: "accepted",
        resolvedAt: Date.now(),
      }, { merge: true });

      await criticalBatch.commit();
      processedIncomingShareReqIds.add(req.requestId);
      markIncomingShareKeyHandled(req);
      showToast(isAr ? "تم قبول طلب المشاركة" : "Share request accepted", "success");

      // Start shared-data listeners right away for faster perceived completion.
      try {
        const acceptedShares = state.sharedWithMeDevices || [];
        const perms = req.permissions || {};
        if (perms.sms) scheduleSharedSmsLoad(acceptedShares);
        if (perms.calls) scheduleSharedCallsLoad(acceptedShares);
        if (perms.notifications) scheduleSharedNotificationsLoad(acceptedShares);
      } catch (_) {}

      // Best-effort request status updates without blocking UI close.
      (async () => {
        try {
          const duplicatePendingQ = query(
            collection(db, "deviceShareRequests"),
            where("ownerUid", "==", req.ownerUid),
            where("sharedWithUid", "==", user.uid),
            where("deviceId", "==", req.deviceId),
            where("status", "==", "pending"),
          );
          const duplicatePendingSnap = await getDocs(duplicatePendingQ);

          if (duplicatePendingSnap.empty) {
            await setDoc(reqRef, { status: "accepted" }, { merge: true });
            return;
          }

          const dedupeBatch = writeBatch(db);
          const seen = new Set();
          duplicatePendingSnap.docs.forEach((d) => {
            if (seen.has(d.id)) return;
            seen.add(d.id);
            dedupeBatch.update(d.ref, { status: "accepted" });
            processedIncomingShareReqIds.add(d.id);
          });

          if (!seen.has(req.requestId)) {
            dedupeBatch.set(reqRef, { status: "accepted" }, { merge: true });
          }

          await dedupeBatch.commit();
        } catch (dupErr) {
          logShareDebug("[ShareReq] duplicate cleanup skipped:", dupErr?.message || dupErr);
        }
      })();
    } catch (err) {
      console.error("[ShareReq] accept error:", err);

      // Roll back optimistic recipient state if acceptance failed.
      state.setSharedWithMeDevices(previousSharedWithMe);
      renderDevices();
      updateDeviceSelects();
      cacheSharedDevices(previousSharedWithMe).catch(() => {});

      // Allow the same request to be surfaced again after a failed attempt.
      processedIncomingShareReqIds.delete(req.requestId);
      if (incomingShareModalByKey.get(modalKey) === req.requestId) {
        incomingShareModalByKey.delete(modalKey);
      }

      showToast(
        isAr ? "فشل قبول الطلب. حاول مرة أخرى." : "Failed to accept share request. Please try again.",
        "error",
      );
    } finally {
      acceptingShareRequestIds.delete(req.requestId);
      setAcceptWorking(false);
    }
  });

  rejectBtn.addEventListener("click", async () => {
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    try {
      const duplicatePendingQ = query(
        collection(db, "deviceShareRequests"),
        where("ownerUid", "==", req.ownerUid),
        where("sharedWithUid", "==", user.uid),
        where("deviceId", "==", req.deviceId),
        where("status", "==", "pending"),
      );
      const duplicatePendingSnap = await withTimeout(getDocs(duplicatePendingQ), 4000, "query duplicate pending requests");
      if (duplicatePendingSnap.empty) {
        await withTimeout(updateDoc(doc(db, "deviceShareRequests", req.requestId), {
          status: "rejected",
          resolvedAt: Date.now(),
        }), 5000, "reject share request");
      } else {
        const rejectBatch = writeBatch(db);
        duplicatePendingSnap.docs.forEach((d) => {
          rejectBatch.update(d.ref, {
            status: "rejected",
            resolvedAt: Date.now(),
          });
          processedIncomingShareReqIds.add(d.id);
        });
        await rejectBatch.commit();
      }
      markIncomingShareKeyHandled(req);
      setStatus(isAr ? "تم رفض الطلب" : "Request declined.", false);
      setTimeout(closeModal, 1000);
    } catch (err) {
      console.error("[ShareReq] reject error:", err);
      acceptBtn.disabled = false;
      rejectBtn.disabled = false;
      setStatus(isAr ? "حدث خطأ. حاول مرة أخرى." : "An error occurred. Please try again.", true);
    }
  });
}
