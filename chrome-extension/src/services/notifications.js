/**
 * Notifications Service
 * Handles app notifications loading and rendering
 */

import {
  db,
  collection,
  getDocs,
  getDocsFromServer,
  doc,
  deleteDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
} from "../config/firebase.js";

import { notificationsList } from "../ui/dom.js";
import { showToast, showConfirmDialog, showListLoading } from "../ui/toasts.js";
import {
  formatTime,
  getNotificationIcon,
  getPlatformIcon,
  escapeHtml,
} from "../utils/helpers.js";
import { renderAppIcon } from "../utils/appIcons.js";
import * as state from "../state/index.js";
import { updateTabBadges } from "./badges.js";
import { getCurrentLanguage } from "../utils/i18n.js";
import { getCachedNotifications, cacheNotificationsData, flushNotificationsCache } from "./cache.js";
import { decryptNotification } from "./cryptoService.js";
import { wireHoverPreview } from "../utils/hoverPreview.js";

// Convert any timestamp shape (number, Firestore Timestamp, plain
// {seconds,nanoseconds} after JSON serialization) to milliseconds.
// Returns 0 if not a valid timestamp.
function tsMs(raw) {
  if (raw == null) return 0;
  if (typeof raw === "number") return raw < 1e12 ? raw * 1000 : raw;
  if (typeof raw.toMillis === "function") return raw.toMillis();
  if (typeof raw === "object" && typeof raw.seconds === "number") {
    return raw.seconds * 1000 + Math.floor((raw.nanoseconds || 0) / 1e6);
  }
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

function isUnavailableError(error) {
  const code = String(error?.code || "").toLowerCase();
  const msg = String(error?.message || "").toLowerCase();
  return code.includes("unavailable") || msg.includes("failed to get documents from server");
}

const notifUnavailableLogKeys = new Set();
function logNotifUnavailableOnce(key, message, details) {
  if (notifUnavailableLogKeys.has(key)) return;
  notifUnavailableLogKeys.add(key);
  if (details !== undefined) {
    console.info(message, details);
  } else {
    console.info(message);
  }
}

// Linkify URLs in notification body text
function linkifyText(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="sms-link">$1</a>'
  );
}

// ── Sync state ───────────────────────────────────────────────────────────────
let isSyncingNotif = false;
let pendingNotifSnapshots = 0;
let suppressNotifSyncIndicator = false;
let notifHydrated = false;
let sharedNotifListenerUnsubs = [];

function stopSharedNotificationsListeners() {
  sharedNotifListenerUnsubs.forEach((unsub) => {
    try { unsub(); } catch (_) {}
  });
  sharedNotifListenerUnsubs = [];
}

function hasSharedNotificationsPermission(share) {
  if (!share || !share.deviceId || !share.ownerUid) return false;
  const perms = share.permissions;
  if (perms == null) {
    if (typeof share.shareNotifications === "boolean") return share.shareNotifications;
    return true;
  }
  if (typeof perms === "object" && !Array.isArray(perms)) {
    return perms.notifications !== false;
  }
  if (Array.isArray(perms)) {
    return perms.includes("notifications") || perms.includes("all");
  }
  if (typeof perms === "string") {
    const p = perms.toLowerCase();
    return p === "notifications" || p === "all" || p.includes("notification");
  }
  return false;
}

export function isNotificationsSyncing() {
  return isSyncingNotif;
}

// ── Pagination state ──────────────────────────────────────────────────────────
const NOTIF_INITIAL_LIMIT = 500; // first load per device (matches legacy)
const NOTIF_PAGE_SIZE = 200; // subsequent "load more" page size
let notifPaginationState = {}; // { deviceId: { lastTimestamp, hasMore, loading } }
let isLoadingMoreNotif = false;
let notifScrollHandlerAttached = false;

function updateNotifSyncIndicator() {
  // Remove stale indicator first (renderNotifications replaces innerHTML)
  document.getElementById("notifSyncIndicator")?.remove();

  if (!isSyncingNotif) return;
  if (suppressNotifSyncIndicator) {
    const hasNotifContent = Object.values(state.allNotifications || {}).some(
      (arr) => Array.isArray(arr) && arr.length > 0,
    );
    if (hasNotifContent) return;
  }

  const container = document.getElementById("notificationsList");
  if (!container) return;
  const indicator = document.createElement("div");
  indicator.id = "notifSyncIndicator";
  indicator.className = "sms-count-indicator";
  indicator.innerHTML = `<span class="sync-badge"><span class="sync-spinner"></span> Syncing...</span>`;
  container.appendChild(indicator);
}

function notifSnapshotReady() {
  pendingNotifSnapshots--;
  if (pendingNotifSnapshots <= 0) {
    pendingNotifSnapshots = 0;
    isSyncingNotif = false;
    updateNotifSyncIndicator();
    // Atomically publish the fully-loaded flat list for the dashboard.
    // This is equivalent to state.allSMSMessages for SMS — only set once all
    // devices have reported, so loadRawData never sees a partial set.
    state.setAllNotificationsMessages(getMergedNotifications());
    // Notify the Insights dashboard so it re-renders with the final count.
    document.dispatchEvent(new CustomEvent("notificationsDataUpdated"));
  }
}

// ── Selection mode state ──────────────────────────────────────────────────────
let notifSelectionMode = false;
let selectedNotifApps = new Set(); // keyed by app key (packageName or appName)

const NOTIF_SNOOZE_STORAGE_KEY = "notifSnoozedGroups";
let notifSnoozedGroups = {}; // { [appKey]: epochMs | "permanent" }
let notifSnoozeHydrated = false;
const NOTIF_PIN_STORAGE_KEY = "notifPinnedGroups";
let notifPinnedGroups = {}; // { [appKey]: true }
let notifPinHydrated = false;

function tr(en, ar) {
  return getCurrentLanguage() === "ar" ? ar : en;
}

async function hydrateNotifSnoozedGroups() {
  if (notifSnoozeHydrated) return;
  notifSnoozeHydrated = true;
  try {
    if (!chrome?.storage?.local) return;
    const result = await new Promise((resolve) => {
      chrome.storage.local.get([NOTIF_SNOOZE_STORAGE_KEY], resolve);
    });
    const map = result?.[NOTIF_SNOOZE_STORAGE_KEY];
    if (map && typeof map === "object") notifSnoozedGroups = map;
  } catch (_) {}
}

async function persistNotifSnoozedGroups() {
  try {
    if (!chrome?.storage?.local) return;
    await new Promise((resolve) => {
      chrome.storage.local.set({ [NOTIF_SNOOZE_STORAGE_KEY]: notifSnoozedGroups }, resolve);
    });
  } catch (_) {}
}

async function hydrateNotifPinnedGroups() {
  if (notifPinHydrated) return;
  notifPinHydrated = true;
  try {
    if (!chrome?.storage?.local) return;
    const result = await new Promise((resolve) => {
      chrome.storage.local.get([NOTIF_PIN_STORAGE_KEY], resolve);
    });
    const map = result?.[NOTIF_PIN_STORAGE_KEY];
    if (map && typeof map === "object") notifPinnedGroups = map;
  } catch (_) {}
}

async function persistNotifPinnedGroups() {
  try {
    if (!chrome?.storage?.local) return;
    await new Promise((resolve) => {
      chrome.storage.local.set({ [NOTIF_PIN_STORAGE_KEY]: notifPinnedGroups }, resolve);
    });
  } catch (_) {}
}

function isNotifGroupPinned(appKey) {
  if (!appKey) return false;
  return !!notifPinnedGroups[appKey];
}

async function toggleNotifGroupPin(appKey) {
  if (!appKey) return false;
  if (notifPinnedGroups[appKey]) {
    delete notifPinnedGroups[appKey];
    await persistNotifPinnedGroups();
    return false;
  }
  notifPinnedGroups[appKey] = true;
  await persistNotifPinnedGroups();
  return true;
}

function isNotifGroupSnoozed(appKey) {
  if (!appKey) return false;
  const raw = notifSnoozedGroups[appKey];
  if (raw === "permanent") return true;
  const until = Number(raw || 0);
  if (!until) return false;
  if (until <= Date.now()) {
    delete notifSnoozedGroups[appKey];
    persistNotifSnoozedGroups();
    return false;
  }
  return true;
}

async function snoozeNotifGroup(appKey, durationMs) {
  if (!appKey) return;
  if (durationMs === "permanent") {
    notifSnoozedGroups[appKey] = "permanent";
  } else {
    notifSnoozedGroups[appKey] = Date.now() + Number(durationMs || 0);
  }
  await persistNotifSnoozedGroups();
}

async function unsnoozeNotifGroup(appKey) {
  if (!appKey) return;
  delete notifSnoozedGroups[appKey];
  await persistNotifSnoozedGroups();
}

// Returns a human-friendly app label. If appName looks like a package id
// (e.g. "com.pushbullet.android"), derive a pretty name from the last segment
// of the packageName instead. Falls back to whichever value is least ugly.
function _looksLikePackageId(s) {
  return typeof s === "string" && /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,}$/i.test(s);
}
function _prettifyPackage(pkg) {
  if (!pkg) return "";
  const last = String(pkg).split(".").pop() || "";
  const spaced = last.replace(/[-_]+/g, " ").trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}
function prettyAppName(appName, packageName) {
  if (appName && !_looksLikePackageId(appName)) return appName;
  const pretty = _prettifyPackage(packageName);
  if (pretty) return pretty;
  if (appName) return appName;
  return "Unknown App";
}

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

/**
 * Inject a notification pushed from the service worker directly into popup
 * state and re-render — without a getDocs call, loading spinner, or listener
 * re-registration. The SW already captured the doc (it has its own reliable
 * Firestore listener), so this keeps the popup in sync even when the popup's
 * own onSnapshot listeners are throttled or broken by quota limits.
 */
export async function injectPushedNotification(data) {
  const user = state.currentUser;
  if (!user || !data || !data.id) return;
  const deviceId = data.deviceId || "user";
  let decrypted = data;
  try {
    decrypted = await decryptNotification(data, user.uid);
  } catch {
    /* fall back to raw data if decryption fails */
  }
  const notif = {
    ...decrypted,
    id: data.id,
    deviceId,
    deviceName: data.deviceName || decrypted.deviceName,
    receivedAt:
      tsMs(decrypted.timestamp) || tsMs(decrypted.createdAt) || Date.now(),
  };
  const existing = state.allNotifications[deviceId] || [];
  if (existing.some((n) => n.id === notif.id)) {
    // Update existing entry in place (e.g. WhatsApp re-uses the same docId).
    updateNotificationsList(
      deviceId,
      existing.map((n) => (n.id === notif.id ? notif : n)),
    );
  } else {
    updateNotificationsList(deviceId, [notif, ...existing]);
  }
  // Cache is flushed on pagehide (popup.js) which reliably captures full state.
  // We do NOT flush here to avoid overwriting historical cache when state is
  // temporarily empty (e.g. auth init window between showCachedDataBeforeAuth
  // and loadNotifications seeding state). The isSyncingNotif guard below is a
  // secondary safety net for the brief window while loadNotifications is running.
  // Guard against cache clobber on popup startup: before notifications are
  // hydrated from cache/server, a single SW push would otherwise overwrite the
  // historical cache with just that one item.
  if (!isSyncingNotif && notifHydrated) {
    cacheNotificationsData(state.allNotifications).catch(() => {});
  }
}

export async function loadNotifications() {
  const user = state.currentUser;
  if (!user) return;

  await hydrateNotifSnoozedGroups();
  await hydrateNotifPinnedGroups();

  // Reset per-load UI suppression state.
  suppressNotifSyncIndicator = false;
  notifHydrated = false;

  // Mark syncing immediately (before any await) so injectPushedNotification
  // skips flushing during the initial load window when state may be empty.
  isSyncingNotif = true;

  // Show spinner only if list is genuinely empty. If cached notifications are
  // already rendered (pre-auth cache path), keep them visible and sync silently.
  const listHasContent =
    notificationsList &&
    !notificationsList.querySelector(".loading-state") &&
    notificationsList.children.length > 0 &&
    !notificationsList.querySelector(".empty-state");
  if (notificationsList && !listHasContent) showListLoading(notificationsList);

  // === STEP 1: Show cached notifications instantly ===
  let hasCachedData = false;
  // Track newest cached timestamp per device for delta loading
  const cachedNewestTimestamps = {};
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
            hasData = true;
            // Record newest timestamp per device for delta fetch.
            // NOTE: Do NOT permanently seed state.allNotifications[deviceId] from cache.
            // updateNotificationsList merges Object.values(state.allNotifications) when
            // each device's listener fires; pre-populating causes fresh dev1 + stale-cached
            // dev2 to be mixed before dev2's listener has a chance to run.
            cachedNewestTimestamps[deviceId] = Math.max(
              ...notifs.map((n) => tsMs(n.timestamp) || n.receivedAt || 0),
            );
          }
        }
        if (hasData) {
          hasCachedData = true;
          suppressNotifSyncIndicator = true;
          notifHydrated = true;
          // Seed state from cache and render immediately (instant load).
          // Do NOT clear state afterwards — the delta-merge in Step 3 reads
          // state.allNotifications[deviceId] to combine cached items with newly
          // arrived ones. Clearing it causes the merge to see an empty slice,
          // so all pre-cache notifications disappear after the refresh completes.
          // Each device slot will be overwritten by getDocs (Step 3) once fresh
          // data arrives; until then cached data remains visible and correct.
          for (const [deviceId, notifs] of Object.entries(cached.byDevice)) {
            if (notifs.length > 0) state.setNotificationsData(deviceId, notifs);
          }
          const merged = getMergedNotifications();
          renderNotifications(merged);
          updateTabBadges();
          console.log("[Notifications] 📦 Showed cached notifications instantly");
        }
      }
    }
  } catch (e) {
    console.warn("[Notifications] Cache load failed:", e);
  }

  // === STEP 2: Get devices list FIRST so we know the total snapshot count
  //             before registering any listeners (avoids race condition where
  //             user-notif snapshot fires while we still await getDocs, causing
  //             the counter to hit 0 too early and clearing isSyncingNotif).
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
      id: data.id || doc.id,  // Fall back to Firestore document ID if data.id field is absent
      name: friendlyName,
    });
  });

  // === STEP 3: getDocs fast-path for device notifications (like SMS/Calls) ===
  // Fetch fresh data with one-time queries before starting realtime listeners.
  // Delta fetch: only load notifications newer than cached data.
  isSyncingNotif = true;
  updateNotifSyncIndicator();

  // Reset pagination state for this load cycle
  notifPaginationState = {};
  notifScrollHandlerAttached = false;

  const notifFetchPromises = devicesList.map(async (device) => {
    // Initialize pagination state for this device
    notifPaginationState[device.id] = { lastTimestamp: null, hasMore: true, loading: false };

    const cachedNewestTs = cachedNewestTimestamps[device.id];
    const isDelta = !!cachedNewestTs;

    let q;
    if (isDelta) {
      q = query(
        collection(db, "users", user.uid, "devices", device.id, "notifications"),
        where("timestamp", ">", cachedNewestTs),
        orderBy("timestamp", "desc"),
        limit(NOTIF_INITIAL_LIMIT),
      );
    } else {
      q = query(
        collection(db, "users", user.uid, "devices", device.id, "notifications"),
        orderBy("timestamp", "desc"),
        limit(NOTIF_INITIAL_LIMIT),
      );
    }

    try {
      // Use getDocsFromServer (NOT getDocs) for the initial/delta fetch. After
      // the popup has been closed for a while, brand-new notifications aren't in
      // Firestore's local IndexedDB cache yet, so the default cache-first getDocs
      // returns 0 rows and the newest notifications never appear. Forcing a server
      // read guarantees we pick up everything written while the popup was closed.
      let snapshot;
      try {
        snapshot = await getDocsFromServer(q);
      } catch (serverErr) {
        if (!isUnavailableError(serverErr)) throw serverErr;
        logNotifUnavailableOnce(
          `initial:${device.id}`,
          `[Notifications] Server unavailable for ${device.id}, using local cache fallback`,
        );
        snapshot = await getDocs(q);
      }
      console.log(
        `[Notifications] ${isDelta ? "🔄 Delta" : "📥 Full"}: ${snapshot.size} from device ${device.id}`,
      );

      const notifications = await Promise.all(
        snapshot.docs.map(async (docSnap) => {
          let data = docSnap.data();
          data = await decryptNotification(data, user.uid);
          return {
            ...data,
            id: docSnap.id,
            deviceId: device.id,
            deviceName: device.name,
            receivedAt: tsMs(data.timestamp) || tsMs(data.createdAt) || Date.now(),
          };
        }),
      );

      if (isDelta && notifications.length > 0) {
        // Merge new notifications with cached ones
        const cached = state.allNotifications[device.id] || [];
        const cachedIds = new Set(cached.map((n) => n.id));
        const brandNew = notifications.filter((n) => !cachedIds.has(n.id));
        if (brandNew.length > 0) {
          console.log(`[Notifications] 🔄 Delta: ${brandNew.length} new for device ${device.id}`);
          updateNotificationsList(device.id, [...brandNew, ...cached]);
        }
      } else if (!isDelta) {
        if (notifications.length > 0) {
          updateNotificationsList(device.id, notifications);
        }
      }

      // Pagination cursor — ALWAYS set, regardless of whether delta found new
      // items. Previously this lived inside the `isDelta && notifications.length>0`
      // branch, so when a reopened popup had up-to-date cache the delta query
      // returned 0 items and the cursor never got initialized → loadMoreNotifications
      // saw `lastTimestamp === null` and immediately disabled pagination, making it
      // impossible to fetch anything older than what was already in cache.
      //
      // Strategy: use the oldest item currently in state as the cursor and assume
      // there may be more older items on the server. loadMoreNotifications will
      // flip hasMore=false when its own paginated query actually comes back empty.
      if (notifPaginationState[device.id]) {
        const all = state.allNotifications[device.id] || [];
        if (all.length > 0) {
          // IMPORTANT: store the RAW timestamp value (Firestore Timestamp /
          // whatever shape the doc has), not a converted millisecond number.
          // Firestore's startAfter() requires the same type as the orderBy
          // field — passing a number when the field is a Timestamp returns
          // 0 results and pagination silently stops. Same pattern as SMS.
          let oldestRaw = null;
          let oldestMs = null;
          for (const n of all) {
            const t = tsMs(n.timestamp) || n.receivedAt || 0;
            if (t > 0 && (oldestMs === null || t < oldestMs)) {
              oldestMs = t;
              oldestRaw = n.timestamp != null ? n.timestamp : n.receivedAt;
            }
          }
          notifPaginationState[device.id].lastTimestamp = oldestRaw;
          notifPaginationState[device.id].hasMore = true;
        } else {
          notifPaginationState[device.id].hasMore = false;
        }
      }
    } catch (error) {
      if (error?.code !== "permission-denied") {
        if (isUnavailableError(error)) {
          logNotifUnavailableOnce(
            `after-fallback:${device.id}`,
            `[Notifications] Device ${device.id} server unavailable after fallback`,
            error?.message || error,
          );
          return;
        }
        console.error(`[Notifications] getDocs error for device ${device.id}:`, error);
      }
    }
  });

  // Run all device fetches in parallel, then persist cache
  Promise.all(notifFetchPromises).then(() => {
    cacheNotificationsData(state.allNotifications).catch(() => {});
    notifHydrated = true;
    isSyncingNotif = false;
    updateNotifSyncIndicator();
    // Pagination state is now fully configured. Kick off autoFill explicitly:
    // if delta returned 0 new items there was no render and autoFill never ran,
    // so older pages would never be pulled. attachNotifScrollHandler+autoFill
    // are safe to call repeatedly (both are idempotent / guarded).
    try {
      attachNotifScrollHandler();
    } catch (e) {
      console.warn("[Notifications] post-fetch autofill kickoff failed:", e);
    }
  });

  // === STEP 4: Set total pending snapshots BEFORE registering any listeners ===
  pendingNotifSnapshots = 1 + devicesList.length; // 1 = user notifications
  isSyncingNotif = true;
  updateNotifSyncIndicator();

  // === STEP 5: Subscribe to user-level notifications ===
  const userNotificationsQuery = query(
    collection(db, "users", user.uid, "notifications"),
    orderBy("createdAt", "desc"),
    limit(500),
  );

  let userNotifFirstSnap = true;
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
          receivedAt: tsMs(data.timestamp) || tsMs(data.createdAt) || Date.now(),
        };
      }),
    );
    updateNotificationsList("_user_notifications", notifications);
    if (userNotifFirstSnap) { userNotifFirstSnap = false; notifSnapshotReady(); }
    // Persist to cache after each update
    cacheNotificationsData(state.allNotifications).catch(() => {});
  });
  state.addUnsubscriber(userNotifUnsub);

  // === STEP 6: Subscribe to device notifications (realtime updates only) ===
  devicesList.forEach((device) => {
    // Only listen to the latest few messages for realtime updates
    const q = query(
      collection(db, "users", user.uid, "devices", device.id, "notifications"),
      orderBy("timestamp", "desc"),
      limit(10),
    );

    let deviceFirstSnap = true;
    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        // Always map the fresh top-N window and merge it with existing data.
        // Previously the first snapshot was skipped when cache existed, which
        // discarded brand-new notifications that arrived between the cache write
        // and listener registration (the cause of "popup flashes but no update").
        const freshNotifs = await Promise.all(
          snapshot.docs.map(async (docSnap) => {
            let data = docSnap.data();
            data = await decryptNotification(data, user.uid);
            return {
              ...data,
              id: docSnap.id,
              deviceId: device.id,
              deviceName: device.name,
              receivedAt: tsMs(data.timestamp) || tsMs(data.createdAt) || Date.now(),
            };
          }),
        );
        // Merge with existing data — only replace the top-N window.
        // Preserve locally-optimistic read:true so the badge doesn't reset
        // when Firestore re-fires with stale read:false before the write confirms.
        const existing = state.allNotifications[device.id] || [];
        const freshIds = new Set(freshNotifs.map((n) => n.id));
        const existingById = new Map(existing.map((n) => [n.id, n]));
        const mergedFresh = freshNotifs.map((n) => {
          const ex = existingById.get(n.id);
          return (ex && ex.read === true && !n.read) ? { ...n, read: true } : n;
        });
        const olderNotifs = existing.filter((n) => !freshIds.has(n.id));
        updateNotificationsList(device.id, [...mergedFresh, ...olderNotifs]);
        cacheNotificationsData(state.allNotifications).catch(() => {});

        if (deviceFirstSnap) {
          deviceFirstSnap = false;
          notifSnapshotReady();
        }
      },
    );

    state.addUnsubscriber(unsub);
  });
}

function resolveDeviceName(notif) {
  const isShared =
    !!notif.deviceId &&
    (state.sharedWithMeDevices || []).some((s) => s.deviceId === notif.deviceId);
  const withSharedBadge = (name) => {
    if (!name) return name;
    if (!isShared) return name;
    return /\(Shared\)\s*$/i.test(name) ? name : `${name} (Shared)`;
  };

  // Always prefer the live device name from state.devices so that renames
  // are reflected immediately — even on old notifications with a stale deviceName.
  if (notif.deviceId && notif.deviceId !== "user" && notif.deviceId !== "_user_notifications") {
    const device = state.devices.find((d) => d.id === notif.deviceId);
    if (device) return withSharedBadge(device.nickname || device.name || notif.deviceName || null);
  }
  // Device not in state (deleted or user-level) — fall back to stored name.
  return withSharedBadge(notif.deviceName || null);
}

function renderNotificationDeviceTag(notif) {
  const name = resolveDeviceName(notif);
  if (!name) return "";
  const device = notif?.deviceId
    ? state.devices.find((d) => d.id === notif.deviceId)
    : null;
  const platform = device?.platform || "android";
  return `<span class="notification-device"><span class="device-tag-icon" aria-hidden="true">${getPlatformIcon(platform)}</span><span>${escapeHtml(name)}</span></span>`;
}

function getMergedNotifications() {
  // Dedup strategy:
  //   * Real-device entries are keyed by `${deviceId}:${id}` so two devices
  //     that received the same logical notification both keep their own copy
  //     (the per-device tab filter `n.deviceId === selectedDevice` would
  //     otherwise hide notifications from devices whose copy lost the dedup
  //     race, while the per-device badge — which reads
  //     `state.allNotifications[deviceId]` directly — still counts them).
  //   * User-level entries (deviceId === "user" / "_user_notifications" /
  //     anything not in state.devices) are merged by `id` alone, but only
  //     accepted when no real-device entry already exists for that id, so
  //     the device tab can still show them.
  const realDeviceIds = new Set([
    ...state.devices.map((d) => d.id),
    ...(state.sharedWithMeDevices || []).map((s) => s.deviceId),
  ]);
  const realIds = new Set(); // ids that have at least one real-device entry
  const byKey = new Map();

  // Pass 1 — real-device entries first.
  Object.entries(state.allNotifications).forEach(([, notifs]) => {
    notifs.forEach((n) => {
      if (!realDeviceIds.has(n.deviceId)) return;
      const key = `${n.deviceId}:${n.id}`;
      if (!byKey.has(key)) {
        byKey.set(key, n);
        realIds.add(n.id);
      }
    });
  });

  // Pass 2 — user-level entries only if no real-device copy exists.
  Object.entries(state.allNotifications).forEach(([, notifs]) => {
    notifs.forEach((n) => {
      if (realDeviceIds.has(n.deviceId)) return;
      if (realIds.has(n.id)) return;
      const key = `user:${n.id}`;
      if (!byKey.has(key)) byKey.set(key, n);
    });
  });

  const merged = Array.from(byKey.values());
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
  let filtered;
  if (selectedDevice === "all") {
    // Exclude own-device notifications where sync is disabled, but never hide
    // shared-device notifications via local sync preferences.
    const sharedDeviceIds = new Set(
      (state.sharedWithMeDevices || []).map((s) => s.deviceId).filter(Boolean),
    );
    filtered = merged.filter((n) => {
      if (!n.deviceId) return true;
      if (sharedDeviceIds.has(n.deviceId)) return true;
      return state.getDeviceSyncPref(n.deviceId, "notifications");
    });
  } else {
    filtered = merged.filter((n) => n.deviceId === selectedDevice);
  }
  renderNotifications(filtered);
}

// ── Infinite scroll – load older notifications ─────────────────────────────────
function hasMoreNotifications() {
  return Object.values(notifPaginationState).some((s) => s.hasMore && !s.loading);
}

async function loadMoreNotifications() {
  const user = state.currentUser;
  if (!user || isLoadingMoreNotif) return;

  const devicesWithMore = Object.entries(notifPaginationState).filter(
    ([, s]) => s.hasMore && !s.loading,
  );
  if (devicesWithMore.length === 0) return;

  isLoadingMoreNotif = true;
  console.log(`[Notifications] 📜 Loading more from ${devicesWithMore.length} device(s)...`);

  try {
    for (const [deviceId, deviceState] of devicesWithMore) {
      if (!deviceState.lastTimestamp) {
        deviceState.hasMore = false;
        continue;
      }
      deviceState.loading = true;

      const q = query(
        collection(db, "users", user.uid, "devices", deviceId, "notifications"),
        orderBy("timestamp", "desc"),
        startAfter(deviceState.lastTimestamp),
        limit(NOTIF_PAGE_SIZE),
      );

      try {
        let snapshot;
        try {
          snapshot = await getDocsFromServer(q);
        } catch (serverErr) {
          if (!isUnavailableError(serverErr)) throw serverErr;
          logNotifUnavailableOnce(
            `loadMore:${deviceId}`,
            `[Notifications] Server unavailable while loading more for ${deviceId}, using local cache fallback`,
          );
          snapshot = await getDocs(q);
        }
        console.log(`[Notifications] 📜 Loaded ${snapshot.size} more from device ${deviceId}`);

        if (snapshot.empty) {
          deviceState.hasMore = false;
          deviceState.loading = false;
          continue;
        }

        const existing = state.allNotifications[deviceId] || [];
        const existingIds = new Set(existing.map((n) => n.id));

        const newNotifs = await Promise.all(
          snapshot.docs
            .filter((docSnap) => !existingIds.has(docSnap.id))
            .map(async (docSnap) => {
              let data = docSnap.data();
              data = await decryptNotification(data, user.uid);
              return {
                ...data,
                id: docSnap.id,
                deviceId,
                deviceName: existing[0]?.deviceName || "",
                receivedAt: tsMs(data.timestamp) || tsMs(data.createdAt) || Date.now(),
              };
            }),
        );

        // Update pagination cursor — use the oldest RAW timestamp from this
        // page (Firestore Timestamp shape), not a converted ms number, so
        // that startAfter() against orderBy("timestamp") works correctly.
        if (newNotifs.length > 0) {
          let oldestRaw = null;
          let oldestMs = null;
          for (const n of newNotifs) {
            const t = tsMs(n.timestamp) || n.receivedAt || 0;
            if (t > 0 && (oldestMs === null || t < oldestMs)) {
              oldestMs = t;
              oldestRaw = n.timestamp != null ? n.timestamp : n.receivedAt;
            }
          }
          if (oldestRaw != null) deviceState.lastTimestamp = oldestRaw;
        }
        deviceState.hasMore = snapshot.size >= NOTIF_PAGE_SIZE;
        deviceState.loading = false;

        if (newNotifs.length > 0) {
          updateNotificationsList(deviceId, [...existing, ...newNotifs]);
        }
      } catch (err) {
        console.error(`[Notifications] loadMore error for device ${deviceId}:`, err);
        deviceState.loading = false;
      }
    }
  } finally {
    isLoadingMoreNotif = false;
    // Persist older items to cache IMMEDIATELY (bypassing the 3 s debounce) so
    // they survive cleanupSubscriptions() on the next refresh/popup-open.
    // The debounced cacheNotificationsData would lose this write if the user
    // clicked Refresh or closed the popup within 3 s.
    flushNotificationsCache(state.allNotifications).catch(() => {});
  }
}

function attachNotifScrollHandler() {
  const container = document.getElementById("notificationsList");
  if (!container) return;
  if (!notifScrollHandlerAttached) {
    notifScrollHandlerAttached = true;
    container.addEventListener("scroll", () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 150 && hasMoreNotifications() && !isLoadingMoreNotif) {
        console.log("[Notifications] 📜 Infinite scroll triggered");
        showNotifScrollLoader();
        loadMoreNotifications().then(() => hideNotifScrollLoader());
      }
    });
  }

  // Auto-fill: notifications are grouped by app, so 500 raw items can collapse
  // into <20 rows that fit without scrolling — meaning the scroll handler can
  // never fire. Keep pulling pages until the container actually overflows OR
  // pagination is exhausted (bounded to a few iterations to avoid runaway loops).
  autoFillNotifications().catch((e) =>
    console.warn("[Notifications] auto-fill error:", e),
  );
}

let isAutoFilling = false;
async function autoFillNotifications() {
  if (isAutoFilling) return;
  const container = document.getElementById("notificationsList");
  if (!container) return;
  isAutoFilling = true;
  try {
    let safety = 10; // cap so we never loop forever
    while (
      safety-- > 0 &&
      hasMoreNotifications() &&
      !isLoadingMoreNotif &&
      container.scrollHeight <= container.clientHeight + 20
    ) {
      // Stop runaway: grouping collapses N raw items into ~M group rows.
      // Once we have a healthy raw count (≥1000) OR plenty of groups (≥30),
      // bail even if scrollHeight hasn't exceeded clientHeight — pulling more
      // raw items will just inflate unread counts, not add new group rows.
      const rawCount = Object.values(state.allNotifications).reduce(
        (n, arr) => n + (arr?.length || 0), 0);
      const groupCount = container.querySelectorAll(".notification-item").length;
      if (rawCount >= 1000 || groupCount >= 30) break;
      showNotifScrollLoader();
      await loadMoreNotifications();
      hideNotifScrollLoader();
      // Yield so the next render can update scrollHeight before we re-check
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    isAutoFilling = false;
  }
}

function showNotifScrollLoader() {
  const container = document.getElementById("notificationsList");
  if (!container || document.getElementById("notifScrollLoader")) return;
  const loader = document.createElement("div");
  loader.id = "notifScrollLoader";
  loader.className = "scroll-loader";
  loader.innerHTML = '<div class="spinner-small"></div> Loading more...';
  container.appendChild(loader);
}

function hideNotifScrollLoader() {
  document.getElementById("notifScrollLoader")?.remove();
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
    // Keep history visible on tab open; user can still enable unread-only.
    notifUnreadCb.checked = false;
    notifUnreadCb.addEventListener("change", () => {
      reRenderNotifications();
    });
  }

  const notifMutedCb = document.getElementById("notifShowMuted");
  if (notifMutedCb) {
    // Hidden by default so list focuses on active groups.
    notifMutedCb.checked = false;
    notifMutedCb.addEventListener("change", () => {
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
  const detailSearchInput = document.getElementById("notifDetailSearchInput");
  const detailSnoozeSelect = document.getElementById("notifDetailSnoozeSelect");
  const detailSnoozeBtn = document.getElementById("notifDetailSnoozeBtn");
  const detailUnsnoozeBtn = document.getElementById("notifDetailUnsnoozeBtn");
  if (!mainView || !detailView || !detailList) return;

  detailTitle.textContent = appName;
  mainView.style.display = "none";
  detailView.style.display = "flex";

  // Mark ALL unread notifications in this app group as read (not just a
  // deduplicated subset). Group unread badges are computed from the raw group
  // items, so only marking deduped rows can leave the app unread count > 0.
  const unreadInGroup = notifications.filter((n) => !n.read);
  if (unreadInGroup.length > 0) {
    const seen = new Set();
    unreadInGroup.forEach((n) => {
      const key = `${n.deviceId || ""}:${n.id || ""}`;
      if (!n.id || seen.has(key)) return;
      seen.add(key);
      markNotificationAsRead(n.deviceId, n.id);
    });
  }

  // Deduplicate noisy repeated notifications from the same app/content.
  // Keep only the newest entry when identical title/body repeats within 15 min.
  const DEDUP_WINDOW_MS = 15 * 60 * 1000;
  const byContent = new Map();
  notifications.forEach((n) => {
    const ts = Number(n.receivedAt || n.timestamp || 0);
    const contentKey = `${(n.title || "").trim()}|${(n.text || n.body || "").trim()}`;
    const current = byContent.get(contentKey);
    if (!current) {
      byContent.set(contentKey, n);
      return;
    }

    const currentTs = Number(current.receivedAt || current.timestamp || 0);
    const sameBurst = Math.abs(ts - currentTs) <= DEDUP_WINDOW_MS;
    if (sameBurst) {
      if (ts >= currentTs) byContent.set(contentKey, n);
      return;
    }

    // Outside dedupe window: keep both by extending key with time bucket.
    const bucketKey = `${contentKey}|${Math.floor(ts / DEDUP_WINDOW_MS)}`;
    const bucketCurrent = byContent.get(bucketKey);
    if (!bucketCurrent || ts >= Number(bucketCurrent.receivedAt || bucketCurrent.timestamp || 0)) {
      byContent.set(bucketKey, n);
    }
  });
  const dedupedNotifications = Array.from(byContent.values());

  // Treat everything as read for rendering — state was already updated above
  const displayNotifications = dedupedNotifications.map(n => ({ ...n, read: true }));

  const renderDetailRows = () => {
    const q = (detailSearchInput?.value || "").trim().toLowerCase();
    const filteredRows = q
      ? displayNotifications.filter((n) =>
          (n.title || "").toLowerCase().includes(q) ||
          (n.text || n.body || "").toLowerCase().includes(q) ||
          (n.appName || "").toLowerCase().includes(q),
        )
      : displayNotifications;

    if (filteredRows.length === 0) {
      detailList.innerHTML = `
        <div class="empty-state">
          <p>${tr("No matching notifications", "لا توجد إشعارات مطابقة")}</p>
        </div>
      `;
      return;
    }

    detailList.innerHTML = filteredRows.map(notif => `
      <div class="notif-detail-bubble ${notif.read ? "" : "unread"}"
           data-notif-id="${notif.id}" data-device-id="${notif.deviceId}">
        <div class="notif-bubble-title">${escapeHtml(notif.title || notif.appName || "Notification")}${notif.read ? "" : ' <span class="unread-dot">●</span>'}</div>
        <div class="notif-bubble-body">${linkifyText(notif.text || notif.body || "")}</div>
        <div class="notif-bubble-footer">
          ${resolveDeviceName(notif) ? renderNotificationDeviceTag(notif) : `<span></span>`}
          <span class="notif-bubble-time">${formatTime(notif.receivedAt || notif.timestamp)}</span>
        </div>
      </div>
    `).join("");

    bindDetailRowActions();
  };

  const isWhatsApp = appKey && (appKey.includes("whatsapp") || appKey.includes("WhatsApp"));

  const bindDetailRowActions = () => {
    detailList.querySelectorAll(".notif-detail-bubble[data-notif-id]").forEach(item => {
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
            let phone = cleanTitle.replace(/[^\d+]/g, "");
            if (phone.startsWith("+")) phone = phone.slice(1);
            else if (phone.startsWith("00")) phone = phone.slice(2);
            else if (phone.startsWith("0")) phone = "20" + phone.slice(1);
            window.open(`https://wa.me/${phone}`, "_blank");
          } else {
            window.open("https://web.whatsapp.com/", "_blank");
          }
        }
      });
    });
  };

  if (detailSearchInput) {
    detailSearchInput.value = "";
    detailSearchInput.oninput = () => renderDetailRows();
  }

  const refreshSnoozeButtons = () => {
    const snoozed = isNotifGroupSnoozed(appKey);
    if (detailSnoozeBtn) detailSnoozeBtn.style.display = snoozed ? "none" : "inline-flex";
    if (detailUnsnoozeBtn) detailUnsnoozeBtn.style.display = snoozed ? "inline-flex" : "none";
  };

  if (detailSnoozeBtn) {
    detailSnoozeBtn.onclick = async () => {
      const selected = detailSnoozeSelect?.value || "86400000";
      const durationMs = selected === "permanent" ? "permanent" : Number(selected);
      await snoozeNotifGroup(appKey, durationMs);
      showToast(tr(`${appName} notifications muted`, `تم كتم إشعارات ${appName}`), "success");
      refreshSnoozeButtons();
      hideNotifDetail();
    };
  }

  if (detailUnsnoozeBtn) {
    detailUnsnoozeBtn.onclick = async () => {
      await unsnoozeNotifGroup(appKey);
      showToast(tr(`${appName} notifications unmuted`, `تم إلغاء كتم إشعارات ${appName}`), "success");
      refreshSnoozeButtons();
      reRenderNotifications();
    };
  }

  refreshSnoozeButtons();
  renderDetailRows();
}

function hideNotifDetail() {
  const mainView = document.getElementById("notifMainView");
  const detailView = document.getElementById("notifDetailView");
  if (!mainView || !detailView) return;
  detailView.style.display = "none";
  mainView.style.display = "flex";
  reRenderNotifications();
}

function updateNotificationsList(deviceId, newNotifications) {
  // Preserve locally-optimistic read:true. Any snapshot (device or user-level)
  // can re-fire with stale read:false before the Firestore write is confirmed.
  // Keep read:true for any notification already marked read in current state.
  const existingById = new Map(
    (state.allNotifications[deviceId] || []).map((n) => [n.id, n]),
  );
  const preserved = newNotifications.map((n) => {
    const existing = existingById.get(n.id);
    return (existing && existing.read === true && !n.read) ? { ...n, read: true } : n;
  });
  state.setNotificationsData(deviceId, preserved);
  // Keep flat array in sync for dashboard — but only after initial load is done
  // (pendingNotifSnapshots === 0). During initial loading the flat array is empty
  // so loadRawData falls back to cache, giving a stable number.
  if (pendingNotifSnapshots === 0) {
    state.setAllNotificationsMessages(getMergedNotifications());
  }
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
    // === DIAG (v1.2.2.10): expose render state to console ===
    try {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayTs = todayStart.getTime();
      const perSlot = {};
      Object.entries(state.allNotifications).forEach(([slot, arr]) => {
        const todays = (arr || []).filter((n) => (n.receivedAt || n.timestamp || 0) >= todayTs);
        const newest = (arr || []).reduce((m, n) => Math.max(m, n.receivedAt || n.timestamp || 0), 0);
        perSlot[slot] = {
          total: arr?.length || 0,
          todayCount: todays.length,
          newestIso: newest ? new Date(newest).toISOString() : "—",
          todaySample: todays.slice(0, 3).map((n) => ({
            id: n.id, app: n.appName || n.packageName, title: n.title,
            deviceId: n.deviceId, ts: new Date(n.receivedAt || n.timestamp || 0).toISOString(),
          })),
        };
      });
      const mergedToday = merged.filter((n) => (n.receivedAt || n.timestamp || 0) >= todayTs);
      const filteredToday = filtered.filter((n) => (n.receivedAt || n.timestamp || 0) >= todayTs);
      const diag = {
        selectedDevice,
        knownDevices: state.devices.map((d) => ({ id: d.id, nickname: d.nickname, name: d.name })),
        perSlot,
        mergedTotal: merged.length,
        mergedToday: mergedToday.length,
        filteredTotal: filtered.length,
        filteredToday: filteredToday.length,
        filteredTodayTop5: filteredToday.slice(0, 5).map((n) => ({
          app: n.appName || n.packageName, title: n.title,
          deviceId: n.deviceId, ts: new Date(n.receivedAt || n.timestamp || 0).toISOString(),
        })),
        mergedTodayTop5: mergedToday.slice(0, 5).map((n) => ({
          app: n.appName || n.packageName, title: n.title,
          deviceId: n.deviceId, ts: new Date(n.receivedAt || n.timestamp || 0).toISOString(),
        })),
      };
      window.__iropitNotifDiag = diag;
      // No-paste DOM inspector: type `__iropitDomCheck()` in console.
      window.__iropitDomCheck = function () {
        const items = document.querySelectorAll("#notificationsList .notification-item");
        const out = {
          domItemCount: items.length,
          firstTitles: [...items].slice(0, 10).map((el) => el.querySelector(".list-item-title")?.innerText?.trim()),
          firstTimes: [...items].slice(0, 10).map((el) => el.querySelector(".list-item-time")?.innerText?.trim()),
          firstDevices: [...items].slice(0, 10).map((el) => el.querySelector(".notification-device")?.innerText?.trim() || ""),
          tabActive: document.getElementById("notificationsTab")?.classList.contains("active"),
          notifListVisible: !!document.getElementById("notificationsList")?.offsetParent,
          notifListHeight: document.getElementById("notificationsList")?.clientHeight,
          notifListScrollHeight: document.getElementById("notificationsList")?.scrollHeight,
          showUnread: document.getElementById("notifShowUnread")?.checked,
          showMuted: document.getElementById("notifShowMuted")?.checked,
          searchVal: document.getElementById("notifSearch")?.value || "",
          selectedDeviceTab: document.querySelector("#notificationsDeviceTabs .device-tab.active")?.dataset.device,
        };
        console.log("[DOM-CHECK]\n" + JSON.stringify(out, null, 2));
        return out;
      };
      console.log("[NOTIF-DIAG-JSON]\n" + JSON.stringify(diag, null, 2));
    } catch (e) { console.warn("[NOTIF-DIAG] failed", e); }
    renderNotifications(filtered);
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
    updateNotifSyncIndicator();
    return;
  }

  // Group by app (packageName or appName)
  const groups = {};
  notifications.forEach(n => {
    const key = n.packageName || n.appName || "unknown";
    if (!groups[key]) groups[key] = { appName: null, packageName: n.packageName, appIcon: n.appIcon, items: [] };
    groups[key].items.push(n);
    // Track the best (non-package-looking) appName seen across all items.
    if (!groups[key].appName && n.appName && !_looksLikePackageId(n.appName)) {
      groups[key].appName = n.appName;
    }
    if (!groups[key].appIcon && n.appIcon) groups[key].appIcon = n.appIcon;
    if (!groups[key].packageName && n.packageName) groups[key].packageName = n.packageName;
  });
  // Finalize display name per group (after scanning all items).
  Object.values(groups).forEach((g) => {
    g.appName = prettyAppName(g.appName, g.packageName || (g.items[0] && g.items[0].appName));
  });

  // Apply unread filter
  let groupEntries = Object.entries(groups);
  if (document.getElementById("notifShowUnread")?.checked) {
    groupEntries = groupEntries.filter(([, group]) => group.items.some(n => !n.read));
  }
  const showMutedOnly = document.getElementById("notifShowMuted")?.checked;
  if (showMutedOnly) {
    groupEntries = groupEntries.filter(([key]) => isNotifGroupSnoozed(key));
  } else {
    groupEntries = groupEntries.filter(([key]) => !isNotifGroupSnoozed(key));
  }

  groupEntries.sort((a, b) => {
    const aPinned = isNotifGroupPinned(a[0]) ? 1 : 0;
    const bPinned = isNotifGroupPinned(b[0]) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    const aTs = Number(a[1]?.items?.[0]?.receivedAt || a[1]?.items?.[0]?.timestamp || 0);
    const bTs = Number(b[1]?.items?.[0]?.receivedAt || b[1]?.items?.[0]?.timestamp || 0);
    return bTs - aTs;
  });

  if (groupEntries.length === 0) {
    const hasUnreadFilter = document.getElementById("notifShowUnread")?.checked;
    const emptyTitle = hasUnreadFilter
      ? tr("No unread notifications", "لا توجد إشعارات غير مقروءة")
      : tr("No notifications match current filters", "لا توجد إشعارات مطابقة للفلاتر الحالية");
    const emptySub = hasUnreadFilter
      ? tr("All notifications have been read", "تمت قراءة جميع الإشعارات")
      : tr("Try changing search or filter options", "جرّب تغيير خيارات البحث أو الفلترة");
    notificationsList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        <p>${emptyTitle}</p>
        <span>${emptySub}</span>
      </div>
    `;
    updateTabBadges();
    updateNotifSyncIndicator();
    return;
  }

  notificationsList.innerHTML = groupEntries.map(([key, group]) => {
    const latest = group.items[0];
    const isSnoozed = isNotifGroupSnoozed(key);
    const isPinned = isNotifGroupPinned(key);
    const unreadCount = group.items.filter(n => !n.read).length;
    const hasUnread = unreadCount > 0;
    const isSelected = notifSelectionMode && selectedNotifApps.has(key);
    const isAr = getCurrentLanguage() === "ar";
    const latestTime = formatTime(latest.receivedAt || latest.timestamp);
    const latestTitle = (latest.title || "").trim();
    const latestDetail = (latest.text || latest.body || "").trim();
    const latestCombined = latestTitle && latestDetail
      ? (latestDetail.toLowerCase() === latestTitle.toLowerCase() ? latestTitle : `${latestTitle} - ${latestDetail}`)
      : (latestTitle || latestDetail);
    const notifLabel = isAr ? "آخر إشعار" : "Last Notification";
    const notifFallback = isAr ? "بدون نص" : "No text";
    const notifHoverPreview = `${notifLabel}: ${latestTime}${latestCombined ? ` - ${latestCombined}` : ` - ${notifFallback}`}`;
    // Find device name from any item in the group (latest may be a user-level entry with no deviceName)
    const groupDeviceName = resolveDeviceName(latest) || group.items.map(resolveDeviceName).find(Boolean) || null;
    return `
      <div class="list-item notification-item ${hasUnread ? "unread" : ""}${isSelected ? " selected" : ""}${isSnoozed ? " snoozed" : ""}"
           data-app-key="${escapeHtml(key)}"
           data-app-name="${escapeHtml(group.appName)}">
        ${notifSelectionMode ? `<div class="conv-checkbox-wrap"><input type="checkbox" class="notif-checkbox" ${isSelected ? "checked" : ""} tabindex="-1" /></div>` : ""}
        <div class="list-item-icon notification-icon">
          ${renderAppIcon(group.packageName, group.appIcon, 40)}
        </div>
        <div class="list-item-content">
          <div class="list-item-title">
            ${escapeHtml(group.appName)}
            ${isSnoozed ? `<span class="notification-snoozed-badge">${tr("Muted", "مكتوم")}</span>` : ""}
            ${hasUnread ? `<span class="unread-dot">●</span>` : ""}
          </div>
          <div class="list-item-subtitle" data-hover-preview="${escapeHtml(notifHoverPreview)}">${escapeHtml(latest.title || latest.text || "")}</div>
          <div class="notification-app">
            ${groupDeviceName ? renderNotificationDeviceTag(latest) : ""}
            ${isSnoozed ? `<button class="notif-unsnooze-btn" type="button">${tr("Unmute", "إلغاء الكتم")}</button>` : ""}
          </div>
        </div>
        <div class="notification-right-meta">
          <button class="notif-pin-btn${isPinned ? " pinned" : ""}" type="button" title="${isPinned ? tr("Unpin", "إلغاء التثبيت") : tr("Pin", "تثبيت")}" aria-label="${isPinned ? tr("Unpin", "إلغاء التثبيت") : tr("Pin", "تثبيت")}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 3h6l-1 5 3 3v2H7v-2l3-3-1-5z"></path>
              <path d="M12 13v8"></path>
            </svg>
          </button>
          <span class="list-item-time">${formatTime(latest.receivedAt || latest.timestamp)}</span>
          <div class="notification-badge-row">
            ${isSnoozed ? `<span class="notification-muted-icon" aria-label="${tr("Muted", "مكتوم")}" title="${tr("Muted", "مكتوم")}" >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 01-3.46 0"></path>
                <line x1="4" y1="4" x2="20" y2="20"></line>
              </svg>
            </span>` : ""}
            ${unreadCount > 0 ? `<span class="list-item-badge missed">${unreadCount}</span>` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");

  wireHoverPreview(notificationsList);

  const appKeys = groupEntries.map(([key]) => key);

  // Click → toggle selection or show detail
  notificationsList.querySelectorAll(".notif-unsnooze-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const item = e.target.closest(".notification-item");
      const key = item?.dataset?.appKey;
      const appName = item?.dataset?.appName || key || "App";
      if (!key) return;
      await unsnoozeNotifGroup(key);
      showToast(tr(`${appName} notifications unmuted`, `تم إلغاء كتم إشعارات ${appName}`), "success");
      reRenderNotifications();
    });
  });

  notificationsList.querySelectorAll(".notif-pin-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const item = e.target.closest(".notification-item");
      const key = item?.dataset?.appKey;
      const appName = item?.dataset?.appName || key || "App";
      if (!key) return;
      const pinned = await toggleNotifGroupPin(key);
      showToast(
        pinned
          ? tr(`${appName} pinned`, `تم تثبيت ${appName}`)
          : tr(`${appName} unpinned`, `تم إلغاء تثبيت ${appName}`),
        "success",
      );
      reRenderNotifications();
    });
  });

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
  updateNotifSyncIndicator();

  // Attach infinite-scroll handler (no-op if already attached)
  attachNotifScrollHandler();
}

async function markNotificationAsRead(deviceId, notifId) {
  const user = state.currentUser;
  if (!user) return;

  // Optimistic update: mark as read in state immediately before the Firestore
  // write so the badge drops right away (same pattern as SMS/calls).
  Object.keys(state.allNotifications).forEach((key) => {
    const updated = state.allNotifications[key].map((n) =>
      n.id === notifId ? { ...n, read: true } : n,
    );
    state.setNotificationsData(key, updated);
  });
  updateTabBadges();
  // Flush immediately so the read state survives popup close/SW cache refresh.
  flushNotificationsCache(state.allNotifications).catch(() => {});

  if (!notifId) {
    return;
  }

  const isNotFoundError = (err) =>
    String(err?.code || "").toLowerCase() === "not-found";

  const tryMarkRead = async (ref) => {
    try {
      await updateDoc(ref, { read: true });
      return true;
    } catch (err) {
      if (isNotFoundError(err)) return false;
      throw err;
    }
  };

  try {
    const hasDevicePath =
      !!deviceId && deviceId !== "user" && deviceId !== "_user_notifications";

    const deviceNotifRef = hasDevicePath
      ? doc(
        db,
        "users",
        user.uid,
        "devices",
        deviceId,
        "notifications",
        notifId,
      )
      : null;

    const userNotifRef = doc(db, "users", user.uid, "notifications", notifId);

    // Notifications can exist in either collection path depending on source.
    // Try primary path first, then fallback path. Missing docs are expected races.
    if (deviceNotifRef) {
      if (await tryMarkRead(deviceNotifRef)) return;
      await tryMarkRead(userNotifRef);
      return;
    }

    if (await tryMarkRead(userNotifRef)) return;
    if (deviceId) {
      const fallbackDeviceRef = doc(
        db,
        "users",
        user.uid,
        "devices",
        deviceId,
        "notifications",
        notifId,
      );
      await tryMarkRead(fallbackDeviceRef);
    }
  } catch (error) {
    // State already updated optimistically above; Firestore write failed but
    // the UI is already correct. Log and continue.
    console.error("markNotificationAsRead unexpected error:", error);
  }
}

/**
 * Mark all notifications as read when entering notifications tab
 */
export async function markAllNotificationsAsRead() {
  const user = state.currentUser;
  if (!user) return;

  const activeDevice = document.querySelector("#notificationsDeviceTabs .device-tab.active")?.dataset.device || "all";

  // Get unread notifications filtered by active device
  let unreadNotifs = [];
  Object.entries(state.allNotifications).forEach(([stateKey, notifs]) => {
    notifs.forEach((n) => {
      if (!n.read) {
        const actualDeviceId = n.deviceId || stateKey;
        if (activeDevice === "all" || actualDeviceId === activeDevice) {
          unreadNotifs.push({ ...n, actualDeviceId });
        }
      }
    });
  });

  if (unreadNotifs.length === 0) return;

  // Update local state IMMEDIATELY (for instant UI update)
  Object.keys(state.allNotifications).forEach((key) => {
    const updated = state.allNotifications[key].map((n) => {
      const actualDeviceId = n.deviceId || key;
      if (!n.read && (activeDevice === "all" || actualDeviceId === activeDevice)) {
        return { ...n, read: true };
      }
      return n;
    });
    state.setNotificationsData(key, updated);
  });

  // Update badge IMMEDIATELY
  updateTabBadges();

  // Flush read state to cache immediately so it survives:
  // (a) popup closing before the 3s debounce fires, and
  // (b) SW's refreshPopupCache overwriting with stale read:false from Firestore.
  flushNotificationsCache(state.allNotifications).catch(() => {});

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
  const validNotifs = unreadNotifs.filter(n => n.id);
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
    // Immediately persist the deletion so items don't reappear on next refresh
    flushNotificationsCache(state.allNotifications).catch(() => {});
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
  const activeDevice =
    document.querySelector("#notificationsDeviceTabs .device-tab.active")?.dataset.device || "all";
  const isAr = getCurrentLanguage() === "ar";
  const locale = isAr ? "ar-EG" : "en-GB";
  const knownDeviceIds = new Set([
    ...state.devices.map((d) => d.id),
    ...(state.sharedWithMeDevices || []).map((s) => s.deviceId),
  ]);
  let notifications = getMergedNotifications().filter((n) => !n.deviceId || n.deviceId === "user" || n.deviceId === "_user_notifications" || knownDeviceIds.has(n.deviceId));
  if (activeDevice !== "all") {
    notifications = notifications.filter((n) => n.deviceId === activeDevice);
  }
  if (notifications.length === 0) {
    alert("No notifications to export.");
    return;
  }
  const header = isAr
    ? ["التاريخ", "الوقت", "التطبيق", "العنوان", "المحتوى", "الجهاز"]
    : ["Date", "Time", "App", "Title", "Body", "Device"];
  const rows = notifications.map((n) => {
    const d = new Date(n.receivedAt || n.timestamp || 0);
    const date = d.toLocaleDateString(locale);
    const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    const app = prettyAppName(n.appName, n.packageName);
    const title = n.title || "";
    const body = n.text || n.body || "";
    const isUserLevel = !n.deviceId || n.deviceId === "user" || n.deviceId === "_user_notifications";
    const device = resolveDeviceName(n) || (isUserLevel ? "(User)" : "");
    return [date, time, app, title, body, device].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
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
  a.download = `iRopit-Notifications-${localStamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Load notifications for all shared devices and merge them into the notifications list.
 */
export async function loadSharedDevicesNotifications(shares) {
  const user = state.currentUser;
  if (!user) return;
  const notifShares = (shares || []).filter((s) => hasSharedNotificationsPermission(s));
  stopSharedNotificationsListeners();
  if (notifShares.length === 0) return;

  for (const share of notifShares) {
    try {
      const q = query(
        collection(db, "users", share.ownerUid, "devices", share.deviceId, "notifications"),
        orderBy("timestamp", "desc"),
        limit(200),
      );

      const unsub = onSnapshot(
        q,
        async (snapshot) => {
          const notifs = await Promise.all(
            snapshot.docs.map(async (docSnap) => {
              let data = docSnap.data();
              data = await decryptNotification(data, share.ownerUid);
              return {
                ...data,
                id: docSnap.id,
                deviceId: share.deviceId,
                deviceName: share.deviceName || "",
                receivedAt: tsMs(data.timestamp) || tsMs(data.createdAt) || Date.now(),
              };
            }),
          );
          updateNotificationsList(share.deviceId, notifs);
        },
        (err) => {
          if (err?.code === "permission-denied") return;
          if (isUnavailableError(err)) {
            logNotifUnavailableOnce(
              `shared-listener:${share.deviceId}`,
              `[Notifs] Shared listener unavailable for ${share.deviceId}`,
              err?.message || err?.code,
            );
            return;
          }
          console.warn(`[Notifs] Shared listener failed for ${share.deviceId}:`, err?.code);
        },
      );

      sharedNotifListenerUnsubs.push(unsub);
      state.addUnsubscriber(unsub);
    } catch (err) {
      console.warn(`[Notifs] Failed to load shared device ${share.deviceId}:`, err?.code);
    }
  }
}
