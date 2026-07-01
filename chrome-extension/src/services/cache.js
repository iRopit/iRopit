/**
 * Local Cache Service
 * Caches SMS and Calls data in chrome.storage.local for instant loading
 */

const CACHE_KEYS = {
  SMS: "cached_sms_data",
  CALLS: "cached_calls_data",
  NOTIFICATIONS: "cached_notifications_data",
  TIMESTAMP: "cache_timestamp",
  FULL_LOAD_TS: "sms_full_load_ts",  // timestamp of last full (non-delta) Firestore fetch
  SHARED_DEVICES: "cached_shared_devices", // sharedWithMeDevices list
  DEVICES: "cached_devices", // own devices list for instant reopen render
};

// Max cache age: 7 days
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// How long delta mode is allowed before forcing a fresh full load.
// Kept intentionally SHORT (1 hour) so a full no-limit server fetch runs on most
// popup opens. Delta mode only looks back a fixed window from the newest cached
// message; if the mobile app backfills messages with old timestamps (e.g. weeks
// of ADIB history synced at once) those messages fall outside the delta window
// and only a full load (jan1LastYear, no limit) can surface them. A 1-hour window
// means users who open the popup occasionally still get the full history fill on
// the next open after the backfill happens — without having to press Refresh.
const FULL_LOAD_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SMS_CACHE_CAP = 10000;
const CALLS_CACHE_CAP = 2000;

/**
 * Strip non-serializable fields from messages before caching
 * (docRef is a Firestore reference object that can't be serialized)
 */
function stripNonSerializable(items) {
  return items.map((item) => {
    const { docRef, ...rest } = item;
    return rest;
  });
}

/**
 * Save SMS data to local cache.
 *
 * Debounced: per-device Firestore listeners fire one after another, each calling this
 * with an incomplete merge (fresh device-N + stale data for not-yet-synced devices).
 * If we wrote on every call, the cache would be polluted by partial snapshots that
 * persist across sessions. Holding the write for 3 seconds lets all device listeners
 * settle so we cache the complete merged result.
 *
 * @param {Object} smsByDevice - SMS data keyed by deviceId
 * @param {Array} allMessages - All merged/deduped messages
 */
let smsCacheWriteTimer = null;
let smsCachePending = null;

/**
 * Guard: never overwrite an already-populated cache with an EMPTY payload.
 * A transient sign-out / permission race can momentarily empty in-memory state;
 * persisting that would make history "disappear" and reload from scratch on the
 * next open. Returns true when the write should be SKIPPED.
 */
async function wouldClobberWithEmpty(cacheKey, incomingCount) {
  if (incomingCount > 0) return false;
  try {
    const existing = await chrome.storage.local.get([cacheKey]);
    const data = existing[cacheKey];
    const existingCount =
      (data?.allMessages?.length || 0) + (data?.allCalls?.length || 0);
    if (existingCount > 0) {
      console.warn(
        `[Cache] Skipped empty write to ${cacheKey} — existing cache has ${existingCount} items`,
      );
      return true;
    }
  } catch (_) {}
  return false;
}

export async function cacheSMSData(smsByDevice, allMessages) {
  // Capture latest call's payload; the timer flushes the most recent one.
  smsCachePending = { smsByDevice, allMessages };
  if (smsCacheWriteTimer) clearTimeout(smsCacheWriteTimer);
  smsCacheWriteTimer = setTimeout(async () => {
    smsCacheWriteTimer = null;
    const payload = smsCachePending;
    smsCachePending = null;
    if (!payload) return;
    if (await wouldClobberWithEmpty(CACHE_KEYS.SMS, payload.allMessages?.length || 0)) return;
    try {
      const cacheData = {
        byDevice: {},
        allMessages: stripNonSerializable(payload.allMessages).slice(0, SMS_CACHE_CAP),
      };
      for (const [deviceId, msgs] of Object.entries(payload.smsByDevice)) {
        cacheData.byDevice[deviceId] = stripNonSerializable(msgs).slice(0, SMS_CACHE_CAP);
      }
      await chrome.storage.local.set({
        [CACHE_KEYS.SMS]: cacheData,
        [CACHE_KEYS.TIMESTAMP]: Date.now(),
      });
      console.log(`[Cache] ✅ Saved ${payload.allMessages.length} SMS messages to cache (debounced)`);
    } catch (error) {
      console.warn("[Cache] Failed to save SMS cache:", error);
    }
  }, 3000);
}

/**
 * Force an immediate write of any pending SMS cache data, bypassing the debounce.
 * Call this at the end of the initial sync so the cache is persisted even if the
 * popup is closed before the 3-second debounce timer fires.
 */
export async function flushSMSCache() {
  if (smsCacheWriteTimer) {
    clearTimeout(smsCacheWriteTimer);
    smsCacheWriteTimer = null;
  }
  const payload = smsCachePending;
  smsCachePending = null;
  if (!payload) return;
  if (await wouldClobberWithEmpty(CACHE_KEYS.SMS, payload.allMessages?.length || 0)) return;
  try {
    const cacheData = {
      byDevice: {},
      allMessages: stripNonSerializable(payload.allMessages).slice(0, SMS_CACHE_CAP),
    };
    for (const [deviceId, msgs] of Object.entries(payload.smsByDevice)) {
      cacheData.byDevice[deviceId] = stripNonSerializable(msgs).slice(0, SMS_CACHE_CAP);
    }
    await chrome.storage.local.set({
      [CACHE_KEYS.SMS]: cacheData,
      [CACHE_KEYS.TIMESTAMP]: Date.now(),
    });
    console.log(`[Cache] ✅ Flushed ${payload.allMessages.length} SMS messages to cache (immediate)`);
  } catch (error) {
    console.warn("[Cache] Failed to flush SMS cache:", error);
  }
}

/**
 * Save calls data to local cache
 * @param {Object} callsByDevice - Calls data keyed by deviceId
 * @param {Array} allCalls - All merged calls
 */
export async function cacheCallsData(callsByDevice, allCalls) {
  try {
    if (await wouldClobberWithEmpty(CACHE_KEYS.CALLS, allCalls?.length || 0)) return;
    const cacheData = {
      byDevice: {},
      allCalls: stripNonSerializable(allCalls).slice(0, CALLS_CACHE_CAP),
    };

    for (const [deviceId, calls] of Object.entries(callsByDevice)) {
      cacheData.byDevice[deviceId] = stripNonSerializable(calls).slice(0, CALLS_CACHE_CAP);
    }

    await chrome.storage.local.set({
      [CACHE_KEYS.CALLS]: cacheData,
    });
    console.log(`[Cache] ✅ Saved ${allCalls.length} calls to cache`);
  } catch (error) {
    console.warn("[Cache] Failed to save calls cache:", error);
  }
}

/**
 * Save notifications data to local cache. Debounced 3 s so partial per-device
 * updates don't pollute the cache before all listeners have settled.
 *
 * Sort newest-first and keep a generous cap (5000/device). The previous 500
 * cap silently dropped older items pulled by pagination — so every cache write
 * after autoFill threw away the older history, making it impossible to
 * accumulate notifications older than the newest 500.
 *
 * @param {Object} notifsByDevice - Notifications keyed by deviceId
 */
const NOTIF_CACHE_CAP_PER_DEVICE = 2000;
function _serializeNotifs(notifsByDevice) {
  const out = {};
  for (const [key, notifs] of Object.entries(notifsByDevice)) {
    const sorted = [...notifs].sort((a, b) => {
      const ta = a.timestamp || a.receivedAt || 0;
      const tb = b.timestamp || b.receivedAt || 0;
      return tb - ta;
    });
    out[key] = sorted.slice(0, NOTIF_CACHE_CAP_PER_DEVICE);
  }
  return out;
}

let notifCacheWriteTimer = null;
let notifCachePending = null;
export async function cacheNotificationsData(notifsByDevice) {
  notifCachePending = notifsByDevice;
  if (notifCacheWriteTimer) clearTimeout(notifCacheWriteTimer);
  notifCacheWriteTimer = setTimeout(async () => {
    notifCacheWriteTimer = null;
    const payload = notifCachePending;
    notifCachePending = null;
    if (!payload) return;
    try {
      const serializable = _serializeNotifs(payload);
      await chrome.storage.local.set({
        [CACHE_KEYS.NOTIFICATIONS]: { byDevice: serializable, savedAt: Date.now() },
      });
    } catch (error) {
      console.warn("[Cache] Failed to save notifications cache:", error);
    }
  }, 3000);
}

/**
 * Force an immediate write of any pending notification cache, bypassing the
 * debounce. Call after loadMoreNotifications so paginated older items survive
 * a fast refresh / popup close.
 */
export async function flushNotificationsCache(notifsByDevice) {
  if (notifCacheWriteTimer) {
    clearTimeout(notifCacheWriteTimer);
    notifCacheWriteTimer = null;
  }
  notifCachePending = null;
  if (!notifsByDevice) return;
  try {
    const serializable = _serializeNotifs(notifsByDevice);
    await chrome.storage.local.set({
      [CACHE_KEYS.NOTIFICATIONS]: { byDevice: serializable, savedAt: Date.now() },
    });
  } catch (error) {
    console.warn("[Cache] Failed to flush notifications cache:", error);
  }
}

/**
 * Load cached notifications data
 * @returns {Object|null} { byDevice } or null if no cache
 */
export async function getCachedNotifications() {
  try {
    const result = await chrome.storage.local.get([CACHE_KEYS.NOTIFICATIONS]);
    const data = result[CACHE_KEYS.NOTIFICATIONS];
    if (!data) return null;
    // Expire after 7 days
    if (Date.now() - (data.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) {
      await chrome.storage.local.remove([CACHE_KEYS.NOTIFICATIONS]);
      return null;
    }
    return data;
  } catch (error) {
    console.warn("[Cache] Failed to load notifications cache:", error);
    return null;
  }
}

/**
 * Returns true if a full Firestore load was done within the last FULL_LOAD_INTERVAL_MS.
 * When false, the caller must do a full load (not delta) to catch any messages that
 * were backfilled to Firestore with old timestamps by the mobile app.
 */
export async function isFullLoadRecent() {
  try {
    const result = await chrome.storage.local.get([CACHE_KEYS.FULL_LOAD_TS]);
    const ts = result[CACHE_KEYS.FULL_LOAD_TS] || 0;
    return (Date.now() - ts) < FULL_LOAD_INTERVAL_MS;
  } catch {
    return false;
  }
}

/**
 * Records the current time as the last full Firestore load timestamp.
 * Call this after every non-delta (full) load completes.
 */
export async function markFullLoadDone() {
  try {
    await chrome.storage.local.set({ [CACHE_KEYS.FULL_LOAD_TS]: Date.now() });
  } catch { /* non-critical */ }
}

/**
 * Load cached SMS data
 * @returns {Object|null} { byDevice, allMessages } or null if no cache
 */
export async function getCachedSMS() {
  try {
    const result = await chrome.storage.local.get([
      CACHE_KEYS.SMS,
      CACHE_KEYS.TIMESTAMP,
    ]);
    const timestamp = result[CACHE_KEYS.TIMESTAMP];
    const data = result[CACHE_KEYS.SMS];

    if (!data || !timestamp) return null;

    // Check if cache is too old
    if (Date.now() - timestamp > MAX_CACHE_AGE_MS) {
      console.log("[Cache] SMS cache expired, clearing...");
      await chrome.storage.local.remove([CACHE_KEYS.SMS]);
      return null;
    }

    console.log(
      `[Cache] 📦 Loaded ${data.allMessages?.length || 0} cached SMS messages`,
    );
    return data;
  } catch (error) {
    console.warn("[Cache] Failed to load SMS cache:", error);
    return null;
  }
}

/**
 * Load cached calls data
 * @returns {Object|null} { byDevice, allCalls } or null if no cache
 */
export async function getCachedCalls() {
  try {
    const result = await chrome.storage.local.get([CACHE_KEYS.CALLS]);
    const data = result[CACHE_KEYS.CALLS];

    if (!data) return null;

    console.log(`[Cache] 📦 Loaded ${data.allCalls?.length || 0} cached calls`);
    return data;
  } catch (error) {
    console.warn("[Cache] Failed to load calls cache:", error);
    return null;
  }
}

/**
 * Save shared-with-me devices list to local cache so the shared device tab
 * appears instantly on the next popup open without waiting for Firestore.
 */
export async function cacheSharedDevices(shares) {
  try {
    // Strip non-serializable Firestore refs from device sub-docs
    const safe = (shares || []).map(({ device, ...rest }) => ({
      ...rest,
      device: device ? (() => { const { docRef, ...d } = device; return d; })() : null,
    }));
    await chrome.storage.local.set({ [CACHE_KEYS.SHARED_DEVICES]: safe });
  } catch (e) {
    console.warn("[Cache] Failed to save shared devices:", e);
  }
}

/**
 * Load shared-with-me devices from local cache.
 * @returns {Array} cached shares array, or []
 */
export async function getCachedSharedDevices() {
  try {
    const result = await chrome.storage.local.get(CACHE_KEYS.SHARED_DEVICES);
    return result[CACHE_KEYS.SHARED_DEVICES] || [];
  } catch {
    return [];
  }
}

/**
 * Save own devices list to local cache so device tabs render instantly on reopen.
 */
export async function cacheOwnDevices(devices) {
  try {
    const safe = (devices || []).map((d) => {
      const { docRef, ...rest } = d || {};
      return rest;
    });
    await chrome.storage.local.set({ [CACHE_KEYS.DEVICES]: safe });
  } catch (e) {
    console.warn("[Cache] Failed to save own devices:", e);
  }
}

/**
 * Load own devices from local cache.
 * @returns {Array} cached own devices array, or []
 */
export async function getCachedOwnDevices() {
  try {
    const result = await chrome.storage.local.get(CACHE_KEYS.DEVICES);
    return result[CACHE_KEYS.DEVICES] || [];
  } catch {
    return [];
  }
}

/**
 * Clear all cached data
 */
export async function clearCache() {
  try {
    await chrome.storage.local.remove([
      CACHE_KEYS.SMS,
      CACHE_KEYS.CALLS,
      CACHE_KEYS.NOTIFICATIONS,
      CACHE_KEYS.TIMESTAMP,
      CACHE_KEYS.SHARED_DEVICES,
      CACHE_KEYS.DEVICES,
    ]);
    console.log("[Cache] 🗑️ Cache cleared");
  } catch (error) {
    console.warn("[Cache] Failed to clear cache:", error);
  }
}
