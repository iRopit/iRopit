/**
 * SMS Service
 * Handles SMS loading, rendering, and management
 */

import {
  db,
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  getDocsFromServer,
  addDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  limit,
  orderBy,
  startAfter,
  onSnapshot,
} from "../config/firebase.js";

import { COLLECTIONS, SYNC_CONFIG } from "../config/constants.js";
import { parseFirestoreError, logError } from "../utils/errors.js";
import { smsLogger as logger } from "../utils/logger.js";
import { smsList } from "../ui/dom.js";
import {
  showToast,
  showLoadingOverlay,
  hideLoading,
  showListLoading,
  showConfirmDialog,
} from "../ui/toasts.js";
import {
  formatTime,
  getInitials,
  getAppIcon,
  getPlatformIcon,
  getDeviceId,
  getFriendlyDeviceName,
  escapeHtml,
} from "../utils/helpers.js";
import * as state from "../state/index.js";
import { updateTabBadges } from "./badges.js";
import { decryptSMS } from "./cryptoService.js";
import { getContactName } from "./contacts.js";
import { getCachedSMS, cacheSMSData, flushSMSCache, isFullLoadRecent, markFullLoadDone } from "./cache.js";
import { getCurrentLanguage } from "../utils/i18n.js";
import { wireHoverPreview } from "../utils/hoverPreview.js";

// Linkify plain-text URLs in a message body (escapes HTML first, then wraps URLs)
function linkifyText(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(https?:\/\/[^\s<>"'\u0022\u0027]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="sms-link">$1</a>'
  );
}

function isUnavailableError(error) {
  const code = String(error?.code || "").toLowerCase();
  const msg = String(error?.message || "").toLowerCase();
  return code.includes("unavailable") || msg.includes("failed to get documents from server");
}

const smsUnavailableLogKeys = new Set();
function logSMSUnavailableOnce(key, message, details) {
  if (smsUnavailableLogKeys.has(key)) return;
  smsUnavailableLogKeys.add(key);
  if (details !== undefined) {
    console.info(message, details);
  } else {
    console.info(message);
  }
}

// Store unsubscribe functions for real-time listeners
let smsUnsubscribeFunctions = [];
let sharedSmsUnsubscribeByKey = new Map();
let sharedSmsSourceDataByKey = new Map();
let sharedSmsServerProbeTsByKey = new Map();

function stopSharedSMSListeners(keepKeys = null) {
  for (const [key, unsubs] of sharedSmsUnsubscribeByKey.entries()) {
    if (keepKeys && keepKeys.has(key)) continue;
    if (Array.isArray(unsubs)) {
      unsubs.forEach((unsub) => {
        try { unsub(); } catch (_) {}
      });
    } else {
      try { unsubs(); } catch (_) {}
    }
    sharedSmsUnsubscribeByKey.delete(key);
    sharedSmsSourceDataByKey.delete(key);
    sharedSmsServerProbeTsByKey.delete(key);
  }
}

function isLikelySMSPayload(data) {
  if (!data || typeof data !== "object") return false;
  if (data.type === "sms" || data.smsType) return true;
  if (data.type && data.type !== "sms") return false;
  if (data.callType || data.duration != null) return false;

  const appName = String(data.appName || "").toLowerCase();
  const isSmsApp = appName === "sms" || appName.includes("message");
  const hasText = !!stripEnc(data.text || data.body || data.content);
  const hasParty = !!stripEnc(data.phoneNumber || data.sender || data.address || data.number);
  const direction = String(data.direction || "").toLowerCase();

  if (isSmsApp && (hasText || hasParty)) return true;
  if ((direction === "incoming" || direction === "outgoing") && hasText && hasParty) {
    return true;
  }
  return false;
}

function hasSharedSmsPermission(share) {
  if (!share || !share.deviceId || !share.ownerUid) return false;
  const perms = share.permissions;

  // Backward-compatible with old share schemas.
  if (perms == null) {
    if (typeof share.shareSms === "boolean") return share.shareSms;
    return true;
  }
  if (typeof perms === "object" && !Array.isArray(perms)) {
    return perms.sms !== false;
  }
  if (Array.isArray(perms)) {
    return perms.includes("sms") || perms.includes("all");
  }
  if (typeof perms === "string") {
    const p = perms.toLowerCase();
    return p === "sms" || p === "all" || p.includes("sms");
  }
  return false;
}

function resolveSMSOwnerUid(deviceId, ownerUidHint = null) {
  if (ownerUidHint) return ownerUidHint;
  if (!deviceId) return state.currentUser?.uid || null;
  const shared = (state.sharedWithMeDevices || []).find(
    (s) => s?.deviceId === deviceId && s?.ownerUid,
  );
  return shared?.ownerUid || state.currentUser?.uid || null;
}

function getOwnSmsDeviceIds() {
  return new Set(
    (state.devices || [])
      .filter(
        (d) =>
          (d.type === "mobile" ||
            d.type === "phone" ||
            d.platform === "android" ||
            d.platform === "Android" ||
            d.platform === "ios") &&
          d.id &&
          state.getDeviceSyncPref(d.id, "sms"),
      )
      .map((d) => d.id),
  );
}

function getSharedSmsDeviceIds() {
  return new Set(
    (state.sharedWithMeDevices || [])
      .filter((s) => hasSharedSmsPermission(s))
      .map((s) => s.deviceId)
      .filter(Boolean),
  );
}

function rebuildMergedSMSFromState() {
  let merged = [];
  Object.values(state.allSMS || {}).forEach((msgs) => {
    if (Array.isArray(msgs) && msgs.length > 0) merged = merged.concat(msgs);
  });
  merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  state.setAllSMSMessages(merged);
  return merged;
}

function pruneSMSForAllowedDevices(allowedDeviceIds) {
  const allowed = allowedDeviceIds instanceof Set ? allowedDeviceIds : new Set();
  let changed = false;

  Object.keys(state.allSMS || {}).forEach((deviceId) => {
    if (!allowed.has(deviceId)) {
      delete state.allSMS[deviceId];
      changed = true;
    }
  });

  if (!changed) return false;
  rebuildMergedSMSFromState();
  return true;
}

/**
 * Resolve the best device name for an SMS message at render time.
 * Looks up state.devices so user-set nicknames and raw model names are used
 * instead of the generic "Android" baked in at load time.
 */
function resolveSMSDeviceName(msg) {
  const isShared =
    !!msg.deviceId &&
    (state.sharedWithMeDevices || []).some((s) => s.deviceId === msg.deviceId);
  const withSharedBadge = (name) => {
    if (!name) return name;
    if (!isShared) return name;
    return /\(Shared\)\s*$/i.test(name) ? name : `${name} (Shared)`;
  };

  if (msg.deviceId) {
    const device = state.devices.find((d) => d.id === msg.deviceId);
    if (device) return withSharedBadge(device.nickname || device.name || msg.deviceName || null);
  }
  return withSharedBadge(msg.deviceName || null);
}

function renderSMSDeviceTag(msg) {
  const name = resolveSMSDeviceName(msg);
  if (!name) return "";
  const device = msg?.deviceId
    ? state.devices.find((d) => d.id === msg.deviceId)
    : null;
  const platform = device?.platform || "android";
  return `<span class="device-tag"><span class="device-tag-icon" aria-hidden="true">${getPlatformIcon(platform)}</span><span>${escapeHtml(name)}</span></span>`;
}
// Track processed message IDs to avoid duplicates
let processedMessageIds = new Set();
// Decryption cache - avoid re-decrypting same messages
const decryptionCache = new Map();

// Pagination state
const PAGE_SIZE = 10000;
let paginationState = {}; // { deviceId: { lastTimestamp, hasMore, loading } }

// ── Starred SMS persistence ──────────────────────────────────────────────────
// Starred message IDs stored in localStorage (fast cache) and backed by
// Firestore at users/{uid}.smsStarredMessageIds so they survive reinstalls.

const SMS_STARRED_LS_KEY = "smsStarredMessages";

function getSmsStarredMessages() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SMS_STARRED_LS_KEY) || "[]"));
  } catch { return new Set(); }
}

function _saveSmsStarredLocal(starredSet) {
  localStorage.setItem(SMS_STARRED_LS_KEY, JSON.stringify([...starredSet]));
}

async function _getSmsStarredDocRef() {
  const user = state.currentUser;
  if (!user) return null;
  return doc(db, "users", user.uid);
}

export async function loadSmsStarredMessagesFromFirestore() {
  try {
    const ref = await _getSmsStarredDocRef();
    if (!ref) return;
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const ids = snap.data().smsStarredMessageIds || [];
      _saveSmsStarredLocal(new Set(ids));
    }
  } catch (e) {
    console.debug("[SMS] Could not load starred messages from Firestore:", e);
  }
}

async function saveSmsStarredMessages(starredSet) {
  _saveSmsStarredLocal(starredSet);
  try {
    const ref = await _getSmsStarredDocRef();
    if (!ref) return;
    await setDoc(ref, { smsStarredMessageIds: [...starredSet] }, { merge: true });
  } catch (e) {
    console.warn("[SMS] Could not persist starred messages to Firestore:", e);
  }
}

function toggleStarSmsMessage(msgId) {
  const starred = getSmsStarredMessages();
  if (starred.has(msgId)) {
    starred.delete(msgId);
  } else {
    starred.add(msgId);
  }
  saveSmsStarredMessages(starred);
}
// ────────────────────────────────────────────────────────────────────────────
let isLoadingMore = false;
let scrollHandlerAttached = false;
let totalLoadedCount = 0;
let isSyncing = false;

/** Returns true while loadSMS() is still fetching from Firestore. */
export function isSMSSyncing() {
  return isSyncing;
}

// Selection mode state
let selectionMode = false;
let selectedConversations = new Set();
const SMS_PIN_STORAGE_KEY = "smsPinnedConversations";
let smsPinnedConversations = {};
let smsPinHydrated = false;

async function hydrateSmsPinnedConversations() {
  if (smsPinHydrated) return;
  smsPinHydrated = true;
  try {
    if (!chrome?.storage?.local) return;
    const result = await new Promise((resolve) => {
      chrome.storage.local.get([SMS_PIN_STORAGE_KEY], resolve);
    });
    const map = result?.[SMS_PIN_STORAGE_KEY];
    if (map && typeof map === "object") smsPinnedConversations = map;
  } catch (_) {}
}

async function persistSmsPinnedConversations() {
  try {
    if (!chrome?.storage?.local) return;
    await new Promise((resolve) => {
      chrome.storage.local.set({ [SMS_PIN_STORAGE_KEY]: smsPinnedConversations }, resolve);
    });
  } catch (_) {}
}

function isSmsConversationPinned(key) {
  return !!smsPinnedConversations[key];
}

async function toggleSmsConversationPin(key) {
  if (!key) return false;
  if (smsPinnedConversations[key]) {
    delete smsPinnedConversations[key];
    await persistSmsPinnedConversations();
    return false;
  }
  smsPinnedConversations[key] = true;
  await persistSmsPinnedConversations();
  return true;
}

// Per-message selection mode (inside an open conversation)
let messageSelectionMode = false;
let selectedMessages = new Set();
let _msgClickHandler = null; // stored reference for removal

/**
 * Decrypt SMS with caching - avoids re-decrypting unchanged messages
 */
async function decryptSMSCached(data, userId, docId) {
  // Check cache first
  const cached = decryptionCache.get(docId);
  if (cached && cached.timestamp === data.timestamp) {
    return cached.data;
  }
  // Decrypt and cache
  const decrypted = await decryptSMS(data, userId);
  decryptionCache.set(docId, { data: decrypted, timestamp: data.timestamp });
  return decrypted;
}

// Unicode bidi/format characters that Android wraps around contact display names
// (e.g. "⁨HSBC⁩" with U+2068/U+2069 isolates). Stripping these is essential so
// dedup and grouping keys match across writers that include vs. omit the marks.
const BIDI_MARKS_RE = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
function stripBidi(s) {
  return typeof s === "string" ? s.replace(BIDI_MARKS_RE, "") : s;
}

function toSmsTimestampMs(raw) {
  if (raw == null) return 0;
  if (typeof raw === "number") return raw < 1e12 ? raw * 1000 : raw;
  if (typeof raw?.toMillis === "function") return raw.toMillis();
  if (typeof raw === "object" && typeof raw.seconds === "number") {
    return raw.seconds * 1000 + Math.floor((raw.nanoseconds || 0) / 1e6);
  }
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

/**
 * Normalize phone number for consistent grouping/matching
 * @param {string} phone - Raw phone number
 * @returns {string} - Normalized phone number
 */
function normalizePhoneNumber(phone) {
  if (!phone || !phone.trim()) return "";

  // Remove all non-digit characters except +
  let normalized = phone.replace(/[^\d+]/g, "").trim();

  // Remove + and leading country codes
  normalized = normalized.replace(/^\+/, "");

  // Remove Egypt country code (20) if present
  if (normalized.startsWith("20") && normalized.length > 10) {
    normalized = normalized.substring(2);
  }
  // Remove UAE country code (971) if present
  if (normalized.startsWith("971") && normalized.length > 10) {
    normalized = normalized.substring(3);
  }
  // Add leading 0 if missing for local numbers (Egypt=10 digits, UAE=9 digits)
  if (!normalized.startsWith("0") && (normalized.length === 9 || normalized.length === 10)) {
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
 * Strip an ENC: value (failed decryption) so it never lands in cache or UI
 */
function stripEnc(v) {
  if (typeof v === "string" && v.startsWith("ENC:")) return "";
  return v || "";
}

/**
 * Resolve phone number from raw SMS data
 * @param {Object} data - SMS data
 * @returns {string}
 */
function resolvePhoneNumber(data) {
  if (!data) return "";
  const candidates = [
    stripEnc(data.phoneNumber),
    stripEnc(data.sender),
    stripEnc(data.address),
    stripEnc(data.number),
    stripEnc(data.phone),
  ];

  const candidate = candidates.find((c) => c && isPhoneNumberLike(c));

  if (candidate) return candidate;

  const title = stripEnc(data.title);
  if (title && isPhoneNumberLike(title)) {
    return title;
  }

  return candidates.find((c) => c) || "";
}

/**
 * Resolve contact name from raw SMS data
 * @param {Object} data - SMS data
 * @param {string} phoneNumber - Resolved phone number
 * @returns {string}
 */
function resolveContactName(data, phoneNumber) {
  if (!data) return "";

  const cName = stripEnc(data.contactName);
  const dName = stripEnc(data.displayName);
  const title = stripEnc(data.title);

  // Priority: explicit contactName > displayName > title (if not a phone number) > contacts lookup
  if (cName && cName.trim()) return cName;
  if (dName && dName.trim()) return dName;

  // title from Google Messages notification = contact name or phone number
  if (title && title.trim() && !isPhoneNumberLike(title)) {
    return title;
  }

  // Lookup in local contacts map (handles multiple numbers per contact)
  const fromContacts = getContactName(phoneNumber);
  if (fromContacts) return fromContacts;

  // Last resort: check if title is different from phoneNumber (might be a name in another language)
  if (title && title.trim() && title !== phoneNumber) {
    // Title has non-digit chars = likely a name
    const nonDigits = title.replace(/[\d\s\-+().]/g, "");
    if (nonDigits.length > 0) return title;
  }

  return "";
}

/**
 * Stop all SMS listeners
 */
export function stopSMSListener() {
  smsUnsubscribeFunctions.forEach((unsub) => unsub());
  smsUnsubscribeFunctions = [];
  stopSharedSMSListeners();
  // Clear processed IDs, cache, and pagination state when stopping listeners
  processedMessageIds.clear();
  decryptionCache.clear();
  paginationState = {};
  isLoadingMore = false;
  scrollHandlerAttached = false;
}

/**
 * Load SMS from all user devices using real-time listeners
 */
export async function loadSMS() {
  console.log("[SMS] loadSMS called");
  const user = state.currentUser;
  if (!user) {
    console.warn("[WARN] No current user - cannot load SMS");
    logger.warn("No current user");
    return;
  }

  await hydrateSmsPinnedConversations();

  // Stop any previous listeners first
  stopSMSListener();

  // Only show the loading spinner if the list is genuinely empty.
  // The pre-auth cache path (popup.js → displayPreAuthCache) may have already
  // rendered cached SMS items before we get here. Wiping them with a spinner
  // causes a visible flicker that makes the load feel slower than it is.
  const listHasContent =
    smsList &&
    !smsList.querySelector(".loading-state") &&
    smsList.children.length > 0 &&
    !smsList.querySelector(".empty-state");
  if (smsList && !listHasContent) {
    const lang = getCurrentLanguage();
    const syncingMsg =
      lang === "ar"
        ? "جارٍ مزامنة الرسائل من هاتفك…"
        : "Syncing messages from your phone…";
    showListLoading(smsList, syncingMsg);
  }

  // === STEP 1: Show cached data instantly ===
  let hasCachedData = false;
  let forceFullFetch = false;
  let hadSuccessfulFullOwnServerFetch = false;
  // Track newest cached timestamp per device for delta loading
  const cachedNewestTimestamps = {};
  let cachedSMSData = null; // hoisted so lambda below can check per-device counts
  // Check if a full Firestore load was done within the last 24h.
  // If not, isDelta will be forced false to catch any backfilled historical messages.
  const fullLoadRecent = await isFullLoadRecent();

  try {
    const cached = await getCachedSMS();
    cachedSMSData = cached;
    if (cached && cached.allMessages && cached.allMessages.length > 0) {
      // Detect cached messages still in encrypted form (ENC: prefix).
      // This can happen for individual records whose key changed or whose decryption
      // legitimately failed. Only treat the cache as corrupted (and force a full
      // re-fetch) when the vast majority of entries are encrypted â€” otherwise the
      // healthy entries are shown instantly and the bad ones are silently skipped.
      const isEnc = (msg) =>
        (msg.title && typeof msg.title === "string" && msg.title.startsWith("ENC:")) ||
        (msg.contactName && typeof msg.contactName === "string" && msg.contactName.startsWith("ENC:")) ||
        (msg.text && typeof msg.text === "string" && msg.text.startsWith("ENC:")) ||
        (msg.body && typeof msg.body === "string" && msg.body.startsWith("ENC:")) ||
        (msg.phoneNumber && typeof msg.phoneNumber === "string" && msg.phoneNumber.startsWith("ENC:"));
      const encCount = cached.allMessages.filter(isEnc).length;
      const hasEncryptedCache = encCount > 0 && encCount / cached.allMessages.length >= 0.8;

      if (hasEncryptedCache) {
        console.debug(
          `[SMS] Cache mostly encrypted (${encCount}/${cached.allMessages.length}) - forcing full re-fetch`,
        );
        forceFullFetch = true;
      }
      console.log(
        `[SMS] ðŸ“¦ Showing ${cached.allMessages.length} cached messages instantly`,
      );
      hasCachedData = true;
      // Sanitize any lingering ENC: values that slipped through decryption on the cached items.
      // Messages with ENC: fields (typically body) get their encrypted bits collected so we can
      // re-decrypt them in the BACKGROUND right after the cached list is painted — this fixes
      // the UX where a row shows the contact name (header) but the body stays blank until the
      // server delta fetch completes (which can be several seconds when there are many devices).
      const encMessagesToRedecrypt = []; // { id, original } pairs (original still has ENC: values)
      const sanitizeMsg = (m) => {
        const hasEnc =
          (m.contactName && typeof m.contactName === "string" && m.contactName.startsWith("ENC:")) ||
          (m.phoneNumber && typeof m.phoneNumber === "string" && m.phoneNumber.startsWith("ENC:")) ||
          (m.title && typeof m.title === "string" && m.title.startsWith("ENC:")) ||
          (m.body && typeof m.body === "string" && m.body.startsWith("ENC:")) ||
          (m.text && typeof m.text === "string" && m.text.startsWith("ENC:")) ||
          (m.sender && typeof m.sender === "string" && m.sender.startsWith("ENC:")) ||
          (m.displayName && typeof m.displayName === "string" && m.displayName.startsWith("ENC:"));
        if (!hasEnc) return m;
        if (m.id) encMessagesToRedecrypt.push(m);
        return {
          ...m,
          contactName: (m.contactName && m.contactName.startsWith("ENC:")) ? "" : (m.contactName || ""),
          phoneNumber: (m.phoneNumber && m.phoneNumber.startsWith("ENC:")) ? "" : (m.phoneNumber || ""),
          title: (m.title && m.title.startsWith("ENC:")) ? "" : (m.title || ""),
          body: (m.body && m.body.startsWith("ENC:")) ? "" : (m.body || (m.text && !m.text.startsWith("ENC:") ? m.text : "") || (m.content && !m.content.startsWith("ENC:") ? m.content : "") || ""),
          text: (m.text && m.text.startsWith("ENC:")) ? "" : (m.text || ""),
          sender: (m.sender && m.sender.startsWith("ENC:")) ? "" : (m.sender || ""),
          displayName: (m.displayName && m.displayName.startsWith("ENC:")) ? "" : (m.displayName || ""),
        };
      };
      // Restore state from cache (both the flat list AND the per-device map).
      // The delta-fetch path below reads cachedMessages from `state.getSMSData(device.id)`
      // and merges them with newly-arrived messages. If we don't seed the per-device map,
      // the merge drops all cached messages — the UI flickers from "570 cached" down to
      // just the few new delta messages. `updateSMSList` already dedupes by id and content,
      // so any overlap between cache and fresh fetch is handled safely.
      if (cached.byDevice) {
        for (const [deviceId, msgs] of Object.entries(cached.byDevice)) {
          if (msgs && msgs.length > 0) {
            if (!forceFullFetch) {
              cachedNewestTimestamps[deviceId] = Math.max(
                ...msgs.map((m) => m.timestamp || 0),
              );
            }
            state.setSMSData(deviceId, msgs.map(sanitizeMsg));
          }
        }
      }
      const sanitizedCachedMessages = cached.allMessages.map(sanitizeMsg);
      state.setAllSMSMessages(sanitizedCachedMessages);
      renderSMS(sanitizedCachedMessages);
      updateTabBadges();

      // === Background re-decryption of cached ENC: items ===
      // The list above renders instantly with empty bodies for any cached message whose
      // body/title is still in ENC: form. Kick off decryption now (off the render path)
      // so those rows fill in within a few hundred ms — well before the Firestore delta
      // fetch returns. We don't await; the IIFE updates state + re-renders when done.
      if (encMessagesToRedecrypt.length > 0) {
        (async () => {
          try {
            const uid = user.uid;
            const fixed = await Promise.all(
              encMessagesToRedecrypt.map(async (m) => {
                try {
                  const d = await decryptSMS(m, uid);
                  return {
                    ...m,
                    contactName: stripEnc(d.contactName) || m.contactName,
                    phoneNumber: stripEnc(d.phoneNumber) || m.phoneNumber,
                    title: stripEnc(d.title) || m.title,
                    body: stripEnc(d.body) || stripEnc(d.text) || "",
                    text: stripEnc(d.text) || "",
                    sender: stripEnc(d.sender) || m.sender,
                    displayName: stripEnc(d.displayName) || m.displayName,
                  };
                } catch {
                  return null;
                }
              }),
            );
            const byId = new Map();
            for (const m of fixed) {
              if (m && m.id && (m.body || m.title || m.contactName)) byId.set(m.id, m);
            }
            if (byId.size === 0) return;

            // Merge decrypted versions into per-device state and the flat list
            const deviceIds = Object.keys(state.allSMS || {});
            for (const deviceId of deviceIds) {
              const list = state.getSMSData(deviceId) || [];
              let changed = false;
              const merged = list.map((m) => {
                const fix = byId.get(m.id);
                if (!fix) return m;
                changed = true;
                return { ...m, ...fix };
              });
              if (changed) state.setSMSData(deviceId, merged);
            }
            const flat = (state.allSMSMessages || sanitizedCachedMessages).map((m) => {
              const fix = byId.get(m.id);
              return fix ? { ...m, ...fix } : m;
            });
            state.setAllSMSMessages(flat);
            renderSMS(flat);
            console.log(`[SMS] 🔓 Background re-decrypted ${byId.size} cached message(s)`);
          } catch (err) {
            console.warn("[SMS] Background re-decrypt failed:", err);
          }
        })();
      }
    }
  } catch (e) {
    console.warn("[SMS] Cache load failed:", e);
  }

  // === STEP 2: Fetch fresh data from Firebase in background ===
  isSyncing = true;
  showSyncIndicator();
  console.log(`[SMS] Loading fresh SMS for user: ${user.uid}`);
  logger.info(`Loading SMS for user: ${user.uid}`);

  // When there's no custom cache (e.g. after logout+re-login, clearCache() was called),
  // Firestore's own offline IndexedDB cache would otherwise return stale data via getDocs().
  // Force a server fetch in that case so messages always reflect the latest state.
  const fetchDocs = hasCachedData ? getDocs : getDocsFromServer;

  try {
    // First, get all user devices
    const devicesQuery = query(
      collection(db, COLLECTIONS.DEVICES),
      where("userId", "==", user.uid),
    );

    logger.debug("Fetching devices...");
    const devicesSnapshot = await fetchDocs(devicesQuery);
    console.log(
      `[SMS] Found ${devicesSnapshot.size} devices for user ${user.uid}`,
    );
    logger.debug(`Found ${devicesSnapshot.size} devices`);

    const devicesList = [];
    devicesSnapshot.forEach((doc) => {
      const data = doc.data();
      if (
        data.platform !== "chrome-extension" &&
        data.platform !== "chrome" &&
        !data.id?.startsWith("ext_")
      ) {
        devicesList.push({
          id: data.id,
          name: getFriendlyDeviceName(data),
        });
      }
    });

    const sharedSmsDeviceIds = getSharedSmsDeviceIds();
    const allowedSmsDeviceIds = new Set([
      ...devicesList.map((d) => d.id).filter(Boolean),
      ...sharedSmsDeviceIds,
    ]);
    if (pruneSMSForAllowedDevices(allowedSmsDeviceIds)) {
      updateTabBadges();
      renderSMS(state.allSMSMessages || []);
    }

    if (devicesList.length === 0) {
      console.info(
        "[SMS] No mobile devices found for SMS loading; showing empty state",
      );
      isSyncing = false;
      updateSMSCountIndicator();
      renderSMS([]);
      try { window.dispatchEvent(new CustomEvent("iropit:sms-sync-done")); } catch (_) {}
      return;
    }

    // Load SMS using getDocs (one-time) for fast initial load
    // Then start realtime listeners for new messages only
    const loadPromises = devicesList.map(async (device) => {
      // Initialize pagination state for this device
      // Capture local ref so a paginationState reset mid-flight doesn't crash us
      const devicePagState = {
        lastTimestamp: null,
        hasMore: true,
        loading: false,
      };
      paginationState[device.id] = devicePagState;

      // Delta fetch: only use when cache is sufficiently populated for this device
      // AND a full load was done within the last 24 hours.
      // If the full load is stale (> 24h), force a full reload to catch any messages
      // that were backfilled to Firestore with old timestamps by the mobile app —
      // those are older than cachedNewestTs and will never appear in a delta query.
      const cachedNewestTs = cachedNewestTimestamps[device.id];
      const cachedDeviceCount = (cachedSMSData?.byDevice?.[device.id]?.length) || 0;
      // Guard against sparse/partial cache (e.g. fallback cache or first-run cache pollution).
      // With very small cache, delta mode makes it look like only a few messages exist.
      const MIN_CACHE_FOR_DELTA = 200;
      const isDelta =
        !!cachedNewestTs &&
        cachedDeviceCount >= MIN_CACHE_FOR_DELTA &&
        fullLoadRecent &&
        !forceFullFetch;

      // When in delta mode, look back 24h from the newest cached timestamp to catch
      // messages that the mobile app backfilled to Firestore with old timestamps
      // (e.g. messages received offline and synced later). Without this window, a
      // message from 2:44 PM would be missed if the cache already has a 5:20 PM
      // message — the strict "> cachedNewestTs" filter would skip it entirely.
      const DELTA_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24h lookback for backfilled msgs
      const deltaFromTs = isDelta ? Math.max(0, cachedNewestTs - DELTA_LOOKBACK_MS) : 0;

      let q;
      if (isDelta) {
        // Fetch messages newer than (cachedNewestTs - 24h) to catch backfilled messages
        q = query(
          collection(
            db,
            "users",
            user.uid,
            "devices",
            device.id,
            "notifications",
          ),
          where("type", "==", "sms"),
          where("timestamp", ">", deltaFromTs),
          orderBy("timestamp", "desc"),
          limit(PAGE_SIZE),
        );
      }

      try {
        // One-time fetch - much faster than onSnapshot for bulk data
        // Delta queries MUST hit the server — the whole point is to find messages
        // newer than the cache, which Firestore's local IndexedDB won't have yet.
        // Full fetches MUST also use getDocsFromServer unconditionally — Firestore's
        // persistentLocalCache (IndexedDB) only holds a truncated window; using getDocs
        // on a full load silently cuts off history older than that window (e.g. stops
        // at May 25 even though older messages exist in Firestore).
        let snapshot;
        if (isDelta) {
          try {
            snapshot = await getDocsFromServer(q);
          } catch (serverErr) {
            if (!isUnavailableError(serverErr)) throw serverErr;
            logSMSUnavailableOnce(
              `delta:${device.id}`,
              `[SMS] Server unavailable for delta ${device.id}, using local cache fallback`,
            );
            snapshot = await getDocs(q);
          }
        } else {
          // Full load: fetch up to 30,000 messages per device (3 × 10,000 pages).
          // Firestore hard-limits each query to 10,000 docs, so we paginate with
          // startAfter. Stops early if the device has fewer than 30,000 messages.
          const MAX_PAGES = 1; // 1 × 10,000 per device (prevents Firestore & chrome.storage quota exhaustion)
          const allDocs = [];
          let afterCursor = null;
          let pagesLoaded = 0;
          let hitPageCap = false;
          while (pagesLoaded < MAX_PAGES) {
            const pageQuery = afterCursor
              ? query(
                  collection(db, "users", user.uid, "devices", device.id, "notifications"),
                  where("type", "==", "sms"),
                  orderBy("timestamp", "desc"),
                  startAfter(afterCursor),
                  limit(PAGE_SIZE),
                )
              : query(
                  collection(db, "users", user.uid, "devices", device.id, "notifications"),
                  where("type", "==", "sms"),
                  orderBy("timestamp", "desc"),
                  limit(PAGE_SIZE),
                );
            let pageSnap;
            try {
              pageSnap = await getDocsFromServer(pageQuery);
              hadSuccessfulFullOwnServerFetch = true;
            } catch (serverErr) {
              if (!isUnavailableError(serverErr)) throw serverErr;
              logSMSUnavailableOnce(
                `full:${device.id}`,
                `[SMS] Server unavailable for full page ${device.id}, using local cache fallback`,
              );
              pageSnap = await getDocs(pageQuery);
            }
            allDocs.push(...pageSnap.docs);
            pagesLoaded++;
            if (pageSnap.size < PAGE_SIZE) break; // ran out of data
            afterCursor = pageSnap.docs[pageSnap.docs.length - 1];
            if (pagesLoaded >= MAX_PAGES) { hitPageCap = true; break; }
          }
          snapshot = { docs: allDocs, size: allDocs.length, empty: allDocs.length === 0, hitPageCap };
        }
        console.log(
          `[SMS] ${isDelta ? "ðŸ”„ Delta" : "ðŸ“¥ Full"}: ${snapshot.size} messages from device ${device.id}`,
        );

        // Decrypt and render messages in small batches so the UI stays responsive.
        // First batch of 20 renders immediately; remaining in groups of 50 with a
        // setTimeout(0) yield between each so the browser can paint + handle events.
        const FIRST_BATCH = 20;
        const BATCH_SIZE = 50;
        const docs = snapshot.docs;
        const allMessages = [];

        const decryptDoc = async (docSnap) => {
          let data = docSnap.data();
          const messageId = docSnap.id;

          // Use cached decryption
          data = await decryptSMSCached(data, user.uid, messageId);

          const resolvedPhone = resolvePhoneNumber(data);
          const resolvedContact = resolveContactName(data, resolvedPhone);

          return {
            ...data,
            id: messageId,
            docId: messageId,
            docRef: docSnap.ref,
            deviceId: device.id,
            deviceName: device.name,
            phoneNumber: resolvedPhone,
            contactName: resolvedContact,
            title: stripEnc(data.title),
            body: stripEnc(data.text) || stripEnc(data.content) || stripEnc(data.body) || "",
            timestamp: data.timestamp || data.receivedAt || Date.now(),
            read: data.read === true,
            type: data.type || "sms",
          };
        };

        // Process first batch and render immediately so the list appears fast
        const firstBatch = await Promise.all(docs.slice(0, FIRST_BATCH).map(decryptDoc));
        allMessages.push(...firstBatch);

        // Helper: merge bulk-loaded messages with any messages the realtime listener
        // already added to state (e.g. a new SMS that arrived while getDocs was in
        // flight). Without this, each progressive render would wipe realtime updates.
        const mergeWithRealtime = (bulk) => {
          const bulkIds = new Set(bulk.map((m) => m.id));
          const realtimeOnly = (state.getSMSData(device.id) || []).filter(
            (m) => !bulkIds.has(m.id),
          );
          return [...realtimeOnly, ...bulk];
        };

        if (!isDelta && firstBatch.length > 0) {
          devicePagState.lastTimestamp = firstBatch[firstBatch.length - 1].timestamp;
          if (paginationState[device.id])
            paginationState[device.id].lastTimestamp = devicePagState.lastTimestamp;
          devicePagState.hasMore = docs.length >= PAGE_SIZE || docs.length > FIRST_BATCH;
          if (paginationState[device.id])
            paginationState[device.id].hasMore = devicePagState.hasMore;
          updateSMSList(device.id, mergeWithRealtime(allMessages));
        }

        // Remaining docs in batches, yielding between each to stay responsive
        let offset = FIRST_BATCH;
        while (offset < docs.length) {
          await new Promise((r) => setTimeout(r, 0));
          const batch = await Promise.all(docs.slice(offset, offset + BATCH_SIZE).map(decryptDoc));
          allMessages.push(...batch);
          offset += BATCH_SIZE;

          if (!isDelta) {
            devicePagState.lastTimestamp = allMessages[allMessages.length - 1].timestamp;
            if (paginationState[device.id])
              paginationState[device.id].lastTimestamp = devicePagState.lastTimestamp;
            devicePagState.hasMore = docs.length >= PAGE_SIZE || offset < docs.length;
            if (paginationState[device.id])
              paginationState[device.id].hasMore = devicePagState.hasMore;
            updateSMSList(device.id, mergeWithRealtime(allMessages));
          }
        }

        const messages = allMessages;

        if (isDelta) {
          // Delta merge: combine new messages with cached ones
          const cachedMessages = state.getSMSData(device.id) || [];
          const cachedIds = new Set(cachedMessages.map((m) => m.id));
          const brandNew = messages.filter((m) => !cachedIds.has(m.id));
          console.log(
            `[SMS] Delta: ${brandNew.length} new messages since cache for device ${device.id}`,
          );
          const merged = [...brandNew, ...cachedMessages];

          if (cachedMessages.length > 0) {
            const oldestCached = cachedMessages[cachedMessages.length - 1];
            devicePagState.lastTimestamp = oldestCached.timestamp;
            if (paginationState[device.id])
              paginationState[device.id].lastTimestamp = oldestCached.timestamp;
          }
          devicePagState.hasMore = cachedMessages.length >= PAGE_SIZE;
          if (paginationState[device.id])
            paginationState[device.id].hasMore = cachedMessages.length >= PAGE_SIZE;

          updateSMSList(device.id, merged);
        } else {
          // Final cursor and hasMore after all batches
          if (messages.length > 0) {
            const oldestMsg = messages[messages.length - 1];
            devicePagState.lastTimestamp = oldestMsg.timestamp;
            if (paginationState[device.id])
              paginationState[device.id].lastTimestamp = oldestMsg.timestamp;
          }
          devicePagState.hasMore = !!snapshot.hitPageCap;
          if (paginationState[device.id])
            paginationState[device.id].hasMore = !!snapshot.hitPageCap;
          updateSMSList(device.id, messages);
        }
      } catch (error) {
        if (error?.code === "permission-denied") return;
        if (isUnavailableError(error)) {
          logSMSUnavailableOnce(
            `after-fallback:${device.id}`,
            `[SMS] Device ${device.id} server unavailable after fallback`,
            error?.message || error,
          );
          return;
        }
        console.error(`âŒ SMS load error for device ${device.id}:`, error);
      }
    });

    // Start realtime listeners immediately so new messages appear within ~1s
    // The first snapshot will show the latest messages even before getDocs completes
    startSMSRealtimeListeners(user.uid, devicesList);

    // Load all devices in parallel (full history runs in background)
    await Promise.all(loadPromises);
    console.log("[SMS] âœ… Initial load complete");

    isSyncing = false;
    updateSMSCountIndicator();
    renderSMS(state.allSMSMessages || []);
    // Flush the cache immediately so the popup closing before the 3s debounce
    // doesn't lose the persisted snapshot â€” otherwise every reopen does a full re-fetch.
    flushSMSCache().catch(() => {});
    // Record that a full load ran (at least one device was non-delta).
    // This allows isDelta for the next 24h; after that a fresh full load will run
    // again to pick up any messages backfilled with old timestamps by the mobile app.
    // Only stamp full-load freshness when we actually completed at least one
    // own-device full page from Firestore server (not cache fallback).
    if (hadSuccessfulFullOwnServerFetch) markFullLoadDone().catch(() => {});
    try { window.dispatchEvent(new CustomEvent("iropit:sms-sync-done")); } catch (_) {}
  } catch (error) {
    if (error?.code !== "permission-denied") {
      console.error("loadSMS error:", error);
    }
    isSyncing = false;
    updateSMSCountIndicator();
    renderSMS(state.allSMSMessages || []);
    try { window.dispatchEvent(new CustomEvent("iropit:sms-sync-done")); } catch (_) {}
  }
}

/**
 * Start lightweight realtime listeners that only handle NEW/changed messages
 * Called after initial getDocs load completes
 */
function startSMSRealtimeListeners(userId, devicesList) {
  for (const device of devicesList) {
    // Only listen to the latest few messages for realtime updates
    const q = query(
      collection(db, "users", userId, "devices", device.id, "notifications"),
      where("type", "==", "sms"),
      orderBy("timestamp", "desc"),
      limit(10),
    );

    let initialSnapshotDone = false;

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
        // First snapshot: process latest messages immediately
        // This shows new messages within ~1s of connection, before getDocs completes
        if (!initialSnapshotDone) {
          initialSnapshotDone = true;
          const messages = await Promise.all(
            snapshot.docs.map(async (docSnap) => {
              const messageId = docSnap.id;
              let data = docSnap.data();
              data = await decryptSMSCached(data, userId, messageId);
              const resolvedPhone = resolvePhoneNumber(data);
              const resolvedContact = resolveContactName(data, resolvedPhone);
              processedMessageIds.add(messageId);
              return {
                ...data,
                id: messageId,
                docId: messageId,
                docRef: docSnap.ref,
                deviceId: device.id,
                deviceName: device.name,
                phoneNumber: resolvedPhone,
                contactName: resolvedContact,
                title: stripEnc(data.title),                body: stripEnc(data.text) || stripEnc(data.content) || stripEnc(data.body) || "",
                timestamp: data.timestamp || data.receivedAt || Date.now(),
                read: data.read === true,
                type: data.type || "sms",
              };
            }),
          );
          if (messages.length > 0) {
            const existing = state.getSMSData(device.id) || [];
            const existingIds = new Set(existing.map((m) => m.id));
            const brandNew = messages.filter((m) => !existingIds.has(m.id));
            if (brandNew.length > 0 || existing.length === 0) {
              updateSMSList(device.id, [
                ...messages,
                ...existing.filter((m) => !messages.some((n) => n.id === m.id)),
              ]);
            }
          }
          return;
        }

        // Subsequent snapshots: handle real-time changes only
        let hasNewMessages = false;
        for (const change of snapshot.docChanges()) {
          if (change.type === "added" || change.type === "modified") {
            const messageId = change.doc.id;
            if (processedMessageIds.has(messageId) && change.type === "added")
              continue;

            let data = change.doc.data();
            data = await decryptSMSCached(data, userId, messageId);

            const resolvedPhone = resolvePhoneNumber(data);
            const resolvedContact = resolveContactName(data, resolvedPhone);

            const message = {
              ...data,
              id: messageId,
              docId: messageId,
              docRef: change.doc.ref,
              deviceId: device.id,
              deviceName: device.name,
              phoneNumber: resolvedPhone,
              contactName: resolvedContact,
              title: stripEnc(data.title),              body: stripEnc(data.text) || stripEnc(data.content) || stripEnc(data.body) || "",
              timestamp: data.timestamp || data.receivedAt || Date.now(),
              read: data.read === true,
              type: data.type || "sms",
            };

            processedMessageIds.add(messageId);
            const currentSMS = state.getSMSData(device.id) || [];
            const existingIdx = currentSMS.findIndex((m) => m.id === messageId);
            if (existingIdx >= 0) {
              // Preserve locally-optimistic read:true. The popup may have marked
              // this message as read and updated state, but the Firestore snapshot
              // can re-fire with the OLD read:false data before the batch.commit()
              // is acknowledged. Overwriting state here would reset the badge.
              const existingMsg = currentSMS[existingIdx];
              const preserved = (existingMsg.read === true && message.read === false)
                ? { ...message, read: true }
                : message;
              currentSMS[existingIdx] = preserved;
            } else {
              currentSMS.unshift(message);
            }
            updateSMSList(device.id, currentSMS);
            hasNewMessages = true;
          }
        }

        if (hasNewMessages) {
          console.log(`[SMS] âœ¨ Realtime update from device ${device.id}`);
        }
      },
      (error) => {
        if (error?.code === "permission-denied") return;
        console.error(
          `âŒ SMS realtime listener error for device ${device.id}:`,
          error,
        );
      },
    );

    smsUnsubscribeFunctions.push(unsub);
  }
}

/**
 * Load more SMS messages (infinite scroll pagination)
 * Fetches the next page of messages from all devices
 */
export async function loadMoreSMS() {
  const user = state.currentUser;
  if (!user || isLoadingMore) return;

  // Check if any device has more to load
  const devicesWithMore = Object.entries(paginationState).filter(
    ([_, s]) => s.hasMore && !s.loading,
  );
  if (devicesWithMore.length === 0) {
    console.log("[SMS] No more messages to load from any device");
    return;
  }

  isLoadingMore = true;
  console.log(
    `[SMS] ðŸ“¥ Loading more SMS from ${devicesWithMore.length} devices...`,
  );

  try {
    for (const [deviceId, deviceState] of devicesWithMore) {
      if (!deviceState.lastTimestamp) continue;
      deviceState.loading = true;

      const q = query(
        collection(db, "users", user.uid, "devices", deviceId, "notifications"),
        where("type", "==", "sms"),
        orderBy("timestamp", "desc"),
        startAfter(deviceState.lastTimestamp),
        limit(PAGE_SIZE),
      );

      try {
        const snapshot = await getDocs(q);
        console.log(
          `[SMS] ðŸ“¥ Loaded ${snapshot.size} more messages from device ${deviceId}`,
        );

        if (snapshot.empty) {
          deviceState.hasMore = false;
          deviceState.loading = false;
          continue;
        }

        const existingMessages = state.getSMSData(deviceId) || [];
        const existingIds = new Set(existingMessages.map((m) => m.id));

        // Look up device name once
        const deviceInfo = Object.values(state.allSMS)
          .flat()
          .find((m) => m.deviceId === deviceId);
        const cachedDeviceName = deviceInfo?.deviceName || "";

        // Decrypt all messages in parallel
        const newMessages = await Promise.all(
          snapshot.docs
            .filter((docSnap) => !existingIds.has(docSnap.id))
            .map(async (docSnap) => {
              const messageId = docSnap.id;
              let data = docSnap.data();
              data = await decryptSMSCached(data, user.uid, messageId);

              const resolvedPhone = resolvePhoneNumber(data);
              const resolvedContact = resolveContactName(data, resolvedPhone);

              return {
                ...data,
                id: messageId,
                docId: messageId,
                docRef: docSnap.ref,
                deviceId: deviceId,
                deviceName: cachedDeviceName,
                phoneNumber: resolvedPhone,
                contactName: resolvedContact,
                title: stripEnc(data.title),                body: stripEnc(data.text) || stripEnc(data.content) || stripEnc(data.body) || "",
                timestamp: data.timestamp || data.receivedAt || Date.now(),
                read: data.read === true,
                type: data.type || "sms",
              };
            }),
        );

        // Update pagination cursor
        if (newMessages.length > 0) {
          const oldestMsg = newMessages[newMessages.length - 1];
          deviceState.lastTimestamp = oldestMsg.timestamp;
        }
        deviceState.hasMore = snapshot.size >= PAGE_SIZE;
        deviceState.loading = false;

        // Merge with existing messages
        if (newMessages.length > 0) {
          const merged = [...existingMessages, ...newMessages];
          updateSMSList(deviceId, merged);
        }
      } catch (error) {
        console.error(`âŒ Error loading more SMS from ${deviceId}:`, error);
        deviceState.loading = false;
      }
    }
  } finally {
    isLoadingMore = false;
  }
}

/**
 * Check if there are more SMS to load
 * @returns {boolean}
 */
export function hasMoreSMS() {
  return Object.values(paginationState).some((s) => s.hasMore);
}

/**
 * Update SMS list with messages from a device
 * @param {string} deviceId - Device ID
 * @param {Array} newMessages - Array of SMS messages
 */
export function updateSMSList(deviceId, newMessages) {
  console.log(
    `[SMS] updateSMSList called - device: ${deviceId}, messages: ${newMessages.length}`,
  );

  const normalizedMessages = newMessages.map((msg) => {
    const resolvedPhone =
      msg.phoneNumber || resolvePhoneNumber(msg) || msg.sender || msg.address;
    const resolvedContact =
      msg.contactName || resolveContactName(msg, resolvedPhone);

    // Back-fill deviceName if missing (e.g. older cached messages)
    const resolvedDeviceName =
      msg.deviceName ||
      (() => {
        const d = state.devices.find((d) => d.id === (msg.deviceId || deviceId));
        return d ? getFriendlyDeviceName(d) : "";
      })();

    return {
      ...msg,
      phoneNumber: resolvedPhone || msg.phoneNumber || "",
      contactName: resolvedContact || msg.contactName || "",
      deviceName: resolvedDeviceName,
      deviceId: msg.deviceId || deviceId,
      timestamp: toSmsTimestampMs(msg.timestamp) || toSmsTimestampMs(msg.receivedAt) || Date.now(),
    };
  });

  // Store SMS by device â€” but preserve any locally-optimistic read:true status.
  // If the user opened a conversation and we wrote read:true to Firestore, there is
  // a window where the Firestore snapshot can re-fire with the OLD read:false data
  // (before the server acknowledges the write).  Overwriting state here would reset
  // the badge back to 1.  We keep the local read:true until Firestore confirms it.
  const existingById = new Map(
    (state.getSMSData(deviceId) || []).map((m) => [m.id, m]),
  );
  const readPreservedMessages = normalizedMessages.map((msg) => {
    const existing = existingById.get(msg.id);
    if (existing && existing.read === true && msg.read === false) {
      return { ...msg, read: true };
    }
    return msg;
  });
  state.setSMSData(deviceId, readPreservedMessages);

  // Merge all SMS from all devices
  let merged = [];
  Object.values(state.allSMS).forEach((msgs) => {
    merged = merged.concat(msgs);
  });

  // Keep newest copies when dedupe collisions happen (same content, different docs).
  // Dedup loop below keeps the first seen item, so we sort first.
  merged.sort(
    (a, b) =>
      (toSmsTimestampMs(b.timestamp) || toSmsTimestampMs(b.receivedAt) || 0) -
      (toSmsTimestampMs(a.timestamp) || toSmsTimestampMs(a.receivedAt) || 0),
  );

  // Ø¥Ø²Ø§Ù„Ø© Ø§Ù„ØªÙƒØ±Ø§Ø± - Ø§Ù„Ø§Ø­ØªÙØ§Ø¸ Ø¨Ù†Ø³Ø®Ø© ÙˆØ§Ø­Ø¯Ø© ÙÙ‚Ø· Ù…Ù† ÙƒÙ„ Ø±Ø³Ø§Ù„Ø©
  // Two-pass dedup: first by document path, then by content (phone+timestamp+body)
  // Content dedup handles the case where NotificationService and BackgroundSmsService
  // created separate Firestore documents for the same SMS
  const uniqueMessages = [];
  const seenIds = new Set();
  const seenContentTs = new Map();
  const DEDUP_WINDOW_MS = 10 * 60 * 1000;

  for (const msg of merged) {
    // Pass 1: Deduplicate by document ID (consistent between cache and Firebase)
    // Use docId/id first (same in both cached and fresh data)
    // docRef.path differs between cache (stripped) and fresh (full path)
    const uniqueId =
      msg.docId ||
      msg.id ||
      msg.docRef?.path ||
      `${msg.timestamp}_${msg.phoneNumber}`;

    if (seenIds.has(uniqueId)) continue;
    seenIds.add(uniqueId);

    // Pass 2: Content-based dedup - suppress only near-time duplicates from
    // dual writers. Keep legitimate later messages even if body text repeats.
    const rawPhoneSrc = stripBidi(msg.phoneNumber || msg.sender || "");
    // Use normalized phone for numeric numbers, raw for text senders (HSBC, Orange, etc.)
    const phone =
      normalizePhoneNumber(rawPhoneSrc) || rawPhoneSrc.trim().toLowerCase();
    const body = stripBidi(msg.body || msg.text || "").trim().substring(0, 100);

    // Skip content dedupe for very short/empty bodies to avoid false positives.
    if (phone && body.length >= 8) {
      const contentKey = `${phone}_${body}`;
      const msgTs = toSmsTimestampMs(msg.timestamp) || toSmsTimestampMs(msg.receivedAt) || 0;
      const seenTs = seenContentTs.get(contentKey);
      if (seenTs != null && Math.abs(seenTs - msgTs) <= DEDUP_WINDOW_MS) continue;
      seenContentTs.set(contentKey, msgTs);
    }

    uniqueMessages.push(msg);
  }

  // Sort by timestamp descending
  uniqueMessages.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  state.setAllSMSMessages(uniqueMessages);
  renderSMS(uniqueMessages);
  updateTabBadges();
  updateSMSCountIndicator();

  // Save to cache in background (don't await)
  cacheSMSData(state.allSMS, uniqueMessages).catch(() => {});
}

/**
 * Render SMS conversations list
 * @param {Array} messages - Array of SMS messages
 */
export function renderSMS(messages) {
  // If a conversation is currently open, don't re-render the conversation list.
  // This prevents the conversation detail view from being overwritten when
  // onSnapshot fires (e.g., after marking messages as read).
  // Data is already updated in state, so the list will be correct when the user goes back.
  if (state.currentConversation) {
    // Only update badges (unread counts) without touching the DOM
    updateTabBadges();
    return;
  }

  // Filter by selected device tab
  const selectedTab =
    document.querySelector("#smsDeviceTabs .device-tab.active")?.dataset
      .device || "all";

  let filteredMessages = messages;
  if (selectedTab !== "all") {
    filteredMessages = messages.filter((msg) => msg.deviceId === selectedTab);
  } else {
    // Exclude stale messages from unknown/removed devices. Keep user-level
    // messages (no deviceId), own devices with SMS enabled, and active shared devices.
    const ownSmsDeviceIds = getOwnSmsDeviceIds();
    const sharedDeviceIds = getSharedSmsDeviceIds();
    filteredMessages = messages.filter((msg) => {
      if (!msg.deviceId) return true;
      if (ownSmsDeviceIds.has(msg.deviceId)) return true;
      if (sharedDeviceIds.has(msg.deviceId)) return true;
      return false;
    });
  }

  // Filter by search query
  const searchQuery = (document.getElementById("smsSearchInput")?.value || "").trim().toLowerCase();

  // Wire search input once
  const searchInput = document.getElementById("smsSearchInput");
  if (searchInput && !searchInput.dataset.wired) {
    searchInput.dataset.wired = "1";
    searchInput.addEventListener("input", () => renderSMS(state.allSMSMessages));
  }

  // Wire unread filter checkbox once
  const smsUnreadCb = document.getElementById("smsShowUnread");
  if (smsUnreadCb && !smsUnreadCb.dataset.wired) {
    smsUnreadCb.dataset.wired = "1";
    smsUnreadCb.addEventListener("change", () => renderSMS(state.allSMSMessages));
  }

  // Wire starred filter checkbox once — also loads starred IDs from Firestore on first open
  const smsStarredCb = document.getElementById("smsShowStarred");
  if (smsStarredCb && !smsStarredCb.dataset.wired) {
    smsStarredCb.dataset.wired = "1";
    smsStarredCb.addEventListener("change", () => renderSMS(state.allSMSMessages));
    // Load starred IDs silently on first open (no re-render needed — checkbox not checked yet)
    loadSmsStarredMessagesFromFirestore();
  }

  const smsListElement = document.getElementById("smsList");

  if (!smsListElement) {
    return;
  }

  if (filteredMessages.length === 0) {
    // On fresh install we are still syncing while the list is empty.
    // Don't replace the "Syncing messages…" spinner with the empty state
    // until sync actually finishes — otherwise the user sees "No messages yet"
    // before any data has had a chance to load.
    if (isSyncing && !searchQuery && selectedTab === "all") {
      const lang = getCurrentLanguage();
      const syncingMsg =
        lang === "ar"
          ? "جارٍ مزامنة الرسائل من هاتفك…"
          : "Syncing messages from your phone…";
      smsListElement.innerHTML = `
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <p>${syncingMsg}</p>
        </div>
      `;
      updateTabBadges();
      return;
    }
    smsListElement.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        <p>No messages yet</p>
        <span>Messages from your phone will appear here</span>
      </div>
    `;
    updateTabBadges();
    return;
  }

  // Apply search filter
  if (searchQuery) {
    filteredMessages = filteredMessages.filter((msg) => {
      const contact = (msg.contactName || msg.title || "").toLowerCase();
      const phone = (msg.phoneNumber || msg.sender || "").toLowerCase();
      const body = (msg.body || msg.text || msg.content || "").toLowerCase();
      return contact.includes(searchQuery) || phone.includes(searchQuery) || body.includes(searchQuery);
    });
  }

  // Build reverse map: contactName -> all normalized phone numbers for that contact
  // This merges conversations for the same contact with different phone numbers
  const contactToPhones = {};
  const phoneToContact = {};

  // First pass: collect contact names from messages and contacts map
  filteredMessages.forEach((msg) => {
    const rawPhone = stripBidi(msg.phoneNumber || msg.sender || "");
    const normPhone = rawPhone ? normalizePhoneNumber(rawPhone) : "";
    const contactName = stripBidi(
      msg.contactName || msg.title || getContactName(rawPhone) || ""
    );

    if (normPhone && contactName && !isPhoneNumberLike(contactName)) {
      if (!contactToPhones[contactName]) {
        contactToPhones[contactName] = new Set();
      }
      contactToPhones[contactName].add(normPhone);
      phoneToContact[normPhone] = contactName;
    }
  });

  // Also add from the contacts map (state.phoneToContactMap)
  if (state.phoneToContactMap) {
    Object.entries(state.phoneToContactMap).forEach(([phone, name]) => {
      if (name && phone) {
        if (!contactToPhones[name]) {
          contactToPhones[name] = new Set();
        }
        contactToPhones[name].add(phone);
        phoneToContact[phone] = name;
      }
    });
  }

  // Group messages by phone number or contact name
  const grouped = {};
  filteredMessages.forEach((msg, index) => {
    let rawPhone = stripBidi(msg.phoneNumber || msg.sender || "");
    let contactName = stripBidi(msg.contactName || msg.title || "");

    // Try to resolve contact name from phone lookup
    const normPhone = rawPhone ? normalizePhoneNumber(rawPhone) : "";
    if ((!contactName || isPhoneNumberLike(contactName)) && normPhone) {
      contactName = phoneToContact[normPhone] || getContactName(rawPhone) || "";
    }

    // Normalize phone number using shared function
    let key;
    if (rawPhone && rawPhone.trim()) {
      key = normalizePhoneNumber(rawPhone);

      // If normalizePhoneNumber returns empty (text sender like "HSBC", "Orange"),
      // use the raw sender name as the key to keep them as separate conversations
      if (!key) {
        key = "sender_" + rawPhone.trim().toLowerCase();
      }

      // Check if this phone belongs to a known contact with multiple numbers
      // Group all numbers of the same contact together under the contact name key
      if (
        contactName &&
        !isPhoneNumberLike(contactName) &&
        contactToPhones[contactName]?.size > 1
      ) {
        key = "contact_" + contactName.trim();
      }
    } else if (contactName && contactName.trim()) {
      key = "contact_" + contactName.trim();
      rawPhone = contactName;
    } else {
      key = "Unknown";
      rawPhone = "Unknown";
    }

    if (!grouped[key]) {
      grouped[key] = {
        normalizedPhone: key,
        phoneNumber: rawPhone,
        contactName: contactName,
        messages: [],
        messageIds: new Set(), // Ù„ØªØªØ¨Ø¹ IDs Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…Ø©
        lastMessage: msg,
        unreadCount: 0,
      };
    }

    // ØªØ¬Ù†Ø¨ Ø¥Ø¶Ø§ÙØ© Ù†ÙØ³ Ø§Ù„Ø±Ø³Ø§Ù„Ø© Ù…Ø±ØªÙŠÙ†
    if (!grouped[key].messageIds.has(msg.id)) {
      grouped[key].messages.push(msg);
      grouped[key].messageIds.add(msg.id);

      if (!msg.read) grouped[key].unreadCount++;
      if (msg.timestamp > (grouped[key].lastMessage.timestamp || 0)) {
        grouped[key].lastMessage = msg;
        if (msg.contactName || msg.title) {
          grouped[key].contactName = msg.contactName || msg.title;
        }
      }
    }
  });

  // Sort by last message timestamp
  let conversations = Object.values(grouped).sort(
    (a, b) => (b.lastMessage.timestamp || 0) - (a.lastMessage.timestamp || 0),
  );

  // Apply unread filter
  if (document.getElementById("smsShowUnread")?.checked) {
    conversations = conversations.filter(c => c.unreadCount > 0);
  }

  // Apply starred filter — show only conversations that contain at least one starred message
  if (document.getElementById("smsShowStarred")?.checked) {
    const smsStarred = getSmsStarredMessages();
    conversations = conversations.filter(c => c.messages.some(m => smsStarred.has(m.id)));
  }

  conversations.sort((a, b) => {
    const aPinned = isSmsConversationPinned(a.normalizedPhone) ? 1 : 0;
    const bPinned = isSmsConversationPinned(b.normalizedPhone) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return (b.lastMessage.timestamp || 0) - (a.lastMessage.timestamp || 0);
  });

  if (conversations.length === 0) {
    const lang = getCurrentLanguage();
    const isStarredFilter = document.getElementById("smsShowStarred")?.checked;
    const emptyTitle = isStarredFilter
      ? (lang === "ar" ? "لا توجد رسائل مميزة" : "No starred messages")
      : (lang === "ar" ? "لا توجد رسائل غير مقروءة" : "No unread messages");
    const emptySub = isStarredFilter
      ? (lang === "ar" ? "قم بتمييز رسائل من داخل المحادثة" : "Star messages inside a conversation")
      : (lang === "ar" ? "تمت قراءة جميع المحادثات" : "All conversations have been read");
    smsListElement.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        <p>${emptyTitle}</p>
        <span>${emptySub}</span>
      </div>
    `;
    updateTabBadges();
    return;
  }

  smsListElement.innerHTML = conversations
    .map(
      (conv) => {
    // Extract a real phone number for hover actions — use the most recent message's phone so
    // that multi-number contacts show the number that most recently sent a message
    let hoverPhone = conv.phoneNumber;
    if (!hoverPhone || hoverPhone.startsWith("contact_") || !isPhoneNumberLike(hoverPhone)) {
      // Prefer lastMessage phone (already the most recent), then fall back to first found
      const lm = conv.lastMessage;
      if (lm && lm.phoneNumber && isPhoneNumberLike(lm.phoneNumber)) {
        hoverPhone = lm.phoneNumber;
      } else {
        const msgWithPhone = conv.messages.find(m => m.phoneNumber && isPhoneNumberLike(m.phoneNumber));
        hoverPhone = msgWithPhone ? msgWithPhone.phoneNumber : "";
      }
    }
    const showHoverActions = !selectionMode && hoverPhone && isPhoneNumberLike(hoverPhone);
    const lastBody = (conv.lastMessage.body || conv.lastMessage.text || conv.lastMessage.content || "").trim();
    const lastTime = formatTime(conv.lastMessage.timestamp);
    const lastLabel = getCurrentLanguage() === "ar" ? "آخر رسالة" : "Last SMS";
    const lastFallback = getCurrentLanguage() === "ar" ? "بدون نص" : "No text";
    const listHoverPreview = `${lastLabel}: ${lastTime}${lastBody ? ` - ${lastBody}` : ` - ${lastFallback}`}`;
    const isPinned = isSmsConversationPinned(conv.normalizedPhone);
    return `
    <div class="list-item sms-conversation${selectionMode && selectedConversations.has(conv.normalizedPhone) ? " selected" : ""}" data-phone="${escapeHtml(conv.normalizedPhone)}" data-hover-phone="${escapeHtml(hoverPhone)}">
      ${selectionMode ? `<div class="conv-checkbox-wrap"><input type="checkbox" class="conv-checkbox" ${selectedConversations.has(conv.normalizedPhone) ? "checked" : ""} tabindex="-1" /></div>` : ""}
      <div class="list-item-avatar">
        ${getInitials(conv.contactName || conv.phoneNumber)}
      </div>
      <div class="list-item-content">
        <div class="list-item-title">
          ${getAppIcon(conv.lastMessage.type || "sms")}
          ${escapeHtml(conv.contactName || conv.phoneNumber)}
        </div>
        <div class="list-item-subtitle" data-hover-preview="${escapeHtml(listHoverPreview)}">${
          (() => { const _b = conv.lastMessage.body || conv.lastMessage.text || conv.lastMessage.content || ""; return _b ? escapeHtml(_b.substring(0, 80)) : '<span class="sms-body-loading" aria-label="Loading message…"></span>'; })()
        }</div>
        ${resolveSMSDeviceName(conv.lastMessage) ? `<div class="list-item-device-row">${renderSMSDeviceTag(conv.lastMessage)}</div>` : ""}
      </div>
      ${showHoverActions ? `<div class="sms-list-hover-actions">
        <button class="call-list-hover-btn sms-hover-call" title="${getCurrentLanguage() === 'ar' ? 'اتصال' : 'Call'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 12.72 19.79 19.79 0 01.15 4.1 2 2 0 012 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
        </button>
        <button class="call-list-hover-btn sms-hover-wa" title="WhatsApp">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
        </button>
      </div>` : ""}
      <div class="list-item-meta">
        <button class="sms-pin-btn${isPinned ? " pinned" : ""}" type="button" title="${getCurrentLanguage() === "ar" ? (isPinned ? "إلغاء التثبيت" : "تثبيت") : (isPinned ? "Unpin" : "Pin")}" aria-label="${getCurrentLanguage() === "ar" ? (isPinned ? "إلغاء التثبيت" : "تثبيت") : (isPinned ? "Unpin" : "Pin")}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 3h6l-1 5 3 3v2H7v-2l3-3-1-5z"></path>
            <path d="M12 13v8"></path>
          </svg>
        </button>
        <span class="list-item-time">${formatTime(
          conv.lastMessage.timestamp,
        )}</span>
        ${
          conv.unreadCount > 0
            ? `<div class="list-item-badge">${conv.unreadCount}</div>`
            : ""
        }
      </div>
    </div>
  `; },
    )
    .join("");

  // Add click handlers using event delegation
  // Replace the node to remove any stale listeners from previous renders
  const oldSmsList = document.getElementById("smsList");
  if (oldSmsList) {
    const newSmsList = oldSmsList.cloneNode(true);
    oldSmsList.parentNode.replaceChild(newSmsList, oldSmsList);
  }

  const smsList2 = document.getElementById("smsList");
  wireHoverPreview(smsList2);

  // Long-press to enter selection mode
  let longPressTimer = null;
  smsList2?.addEventListener("pointerdown", (e) => {
    const conversation = e.target.closest(".sms-conversation");
    if (!conversation || selectionMode) return;
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      const phoneNumber = conversation.dataset.phone;
      // Enter selection mode and pre-select this item
      selectionMode = true;
      selectedConversations.clear();
      const selectBtn = document.getElementById("smsSelectBtn");
      selectBtn?.classList.add("active");
      const toolbar = document.getElementById("smsSelectToolbar");
      if (toolbar) toolbar.style.display = "flex";
      renderSMS(state.allSMSMessages);
      // After re-render, tick the long-pressed item
      setTimeout(() => {
        const el = document.querySelector(`.sms-conversation[data-phone="${CSS.escape(phoneNumber)}"]`);
        if (el) {
          selectedConversations.add(phoneNumber);
          el.classList.add("selected");
          const cb = el.querySelector(".conv-checkbox");
          if (cb) cb.checked = true;
          _updateSelectionToolbar(document.querySelectorAll(".sms-conversation[data-phone]").length);
        }
      }, 0);
    }, 500);
  });
  smsList2?.addEventListener("pointerup", () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });
  smsList2?.addEventListener("pointercancel", () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });
  smsList2?.addEventListener("pointermove", () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });

  smsList2?.addEventListener("click", async (e) => {
    const pinBtn = e.target.closest(".sms-pin-btn");
    if (pinBtn) {
      e.stopPropagation();
      const conv = pinBtn.closest(".sms-conversation");
      const key = conv?.dataset?.phone;
      const name = conv?.querySelector(".list-item-title")?.textContent?.trim() || key || "Conversation";
      const pinned = await toggleSmsConversationPin(key);
      showToast(
        getCurrentLanguage() === "ar"
          ? (pinned ? `تم تثبيت ${name}` : `تم إلغاء تثبيت ${name}`)
          : (pinned ? `${name} pinned` : `${name} unpinned`),
        "success",
      );
      renderSMS(state.allSMSMessages);
      return;
    }
    // Handle hover action buttons
    const callBtn = e.target.closest(".sms-hover-call");
    if (callBtn) {
      e.stopPropagation();
      const conv = callBtn.closest(".sms-conversation");
      const phone = conv?.dataset.hoverPhone;
      if (phone) {
        import("./calls.js").then(m => m.initiateDialRequest(phone, null));
      }
      return;
    }
    const waBtn = e.target.closest(".sms-hover-wa");
    if (waBtn) {
      e.stopPropagation();
      const conv = waBtn.closest(".sms-conversation");
      let phone = conv?.dataset.hoverPhone;
      if (phone) {
        let clean = phone.replace(/[^\d+]/g, "");
        if (clean.startsWith("+")) clean = clean.slice(1);
        else if (clean.startsWith("00")) clean = clean.slice(2);
        else if (clean.startsWith("0")) clean = "20" + clean.slice(1);
        window.open(`https://wa.me/${clean}`, "_blank");
      }
      return;
    }
    const conversation = e.target.closest(".sms-conversation");
    if (conversation) {
      const phoneNumber = conversation.dataset.phone;
      if (selectionMode) {
        // Toggle selection
        if (selectedConversations.has(phoneNumber)) {
          selectedConversations.delete(phoneNumber);
          conversation.classList.remove("selected");
          const cb = conversation.querySelector(".conv-checkbox");
          if (cb) cb.checked = false;
        } else {
          selectedConversations.add(phoneNumber);
          conversation.classList.add("selected");
          const cb = conversation.querySelector(".conv-checkbox");
          if (cb) cb.checked = true;
        }
        _updateSelectionToolbar(conversations.length);
      } else {
        showConversation(phoneNumber);
      }
    }
  });

  // Attach infinite scroll handler ONCE (not on every render)
  attachSMSScrollHandler();

  updateTabBadges();
}

/**
 * Attach infinite scroll handler to smsList (only once)
 */
function attachSMSScrollHandler() {
  if (scrollHandlerAttached) return;
  const smsContainer = document.getElementById("smsList");
  if (!smsContainer) return;

  scrollHandlerAttached = true;
  smsContainer.addEventListener("scroll", () => {
    const { scrollTop, scrollHeight, clientHeight } = smsContainer;
    // Load more when user is within 150px of the bottom
    if (
      scrollHeight - scrollTop - clientHeight < 150 &&
      hasMoreSMS() &&
      !isLoadingMore
    ) {
      console.log("[SMS] ðŸ“œ Infinite scroll triggered - loading more...");
      showSMSScrollLoader();
      loadMoreSMS().then(() => {
        hideSMSScrollLoader();
      });
    }
  });
}

/**
 * Show loading spinner at bottom of SMS list
 */
function showSMSScrollLoader() {
  const smsContainer = document.getElementById("smsList");
  if (!smsContainer || document.getElementById("smsScrollLoader")) return;
  const loader = document.createElement("div");
  loader.className = "scroll-loader";
  loader.id = "smsScrollLoader";
  loader.innerHTML =
    '<div class="spinner-small"></div> Loading more messages...';
  smsContainer.appendChild(loader);
}

/**
 * Hide scroll loader and update message count
 */
function hideSMSScrollLoader() {
  document.getElementById("smsScrollLoader")?.remove();
  updateSMSCountIndicator();
}

/**
 * Update the message count indicator below SMS list
 */
function updateSMSCountIndicator() {
  const total = state.allSMSMessages?.length || 0;
  const moreAvailable = hasMoreSMS();
  let indicator = document.getElementById("smsCountIndicator");

  if (total === 0) {
    indicator?.remove();
    return;
  }

  const smsContainer = document.getElementById("smsList");
  if (!smsContainer) return;

  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "smsCountIndicator";
    indicator.className = "sms-count-indicator";
  }

  // Always place the indicator at the bottom, below all messages.
  indicator.classList.remove("indicator-top");
  smsContainer.appendChild(indicator);

  const syncBadge = isSyncing
    ? `<span class="sync-badge"><span class="sync-spinner"></span> Syncing...</span>`
    : "";

  if (moreAvailable) {
    indicator.innerHTML = `<span>${total} messages loaded</span>${syncBadge}<button class="load-more-btn" id="loadMoreSmsBtn">Load more</button>`;
    indicator
      .querySelector("#loadMoreSmsBtn")
      ?.addEventListener("click", () => {
        showSMSScrollLoader();
        loadMoreSMS().then(() => hideSMSScrollLoader());
      });
  } else {
    indicator.innerHTML = isSyncing
      ? `<span>${total} messages</span>${syncBadge}`
      : `<span>${total} messages · All loaded</span>`;
  }
}


/**
 * Show sync indicator while fetching from Firebase
 */
function showSyncIndicator() {
  updateSMSCountIndicator();
}

/**
 * Go back from the conversation detail view to the conversation list.
 * Extracted so it can be called both by the direct listener on #backToSMS
 * and by the permanent delegated listener set up in initSMSNavigation().
 */
function _goBackFromConversation() {
  // Guard: already on list view (prevents double-execution when both the direct
  // listener and the delegated listener fire for the same click).
  if (!state.currentConversation) return;

  // Reset per-message selection mode if active
  if (messageSelectionMode) {
    messageSelectionMode = false;
    selectedMessages.clear();
    _exitMessageSelectionMode();
    document.getElementById("smsSelectBtn")?.classList.remove("active");
    const toolbar = document.getElementById("smsSelectToolbar");
    if (toolbar) toolbar.style.display = "none";
  }
  document.getElementById("smsList")?.classList.remove("conversation-open");
  state.setCurrentConversation(null);
  const deleteAllBtn = document.getElementById("deleteAllSmsBtn");
  if (deleteAllBtn) {
    deleteAllBtn.title = "Delete selected";
    deleteAllBtn.disabled = true;
  }
  // Reset search box for list view
  const si = document.getElementById("smsSearchInput");
  if (si) {
    si.value = "";
    si.placeholder = getCurrentLanguage() === "ar" ? "...بحث في الرسائل" : "Search messages...";
    delete si.dataset.convWired;
    si.dataset.wired = ""; // will be re-wired by renderSMS
    delete si.dataset.wired;
  }
  // Clean up starred-checkbox conv listener so it re-registers on next showConversation
  const starredCb = document.getElementById("smsShowStarred");
  if (starredCb) delete starredCb.dataset.convWired;
  renderSMS(state.allSMSMessages);
}

/**
 * Set up a permanent delegated click listener for the SMS back button.
 * Must be called once at init time from popup.js.
 * This acts as a reliable fallback in case the direct listener on #backToSMS
 * (set dynamically inside showConversation) is ever not attached.
 */
export function initSMSNavigation() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#backToSMS")) {
      _goBackFromConversation();
    }
  });
}

/**
 * Show conversation detail view
 * @param {string} phoneNumber - Phone number or contact key
 */

export function showConversation(phoneNumber) {
  // Use same normalization as grouping for consistent matching
  let normalizedInput;
  if (phoneNumber.startsWith("contact_") || phoneNumber.startsWith("sender_")) {
    normalizedInput = phoneNumber;
  } else {
    normalizedInput = normalizePhoneNumber(phoneNumber);
    // If normalization returns empty (text sender), use sender_ prefix
    if (!normalizedInput && phoneNumber.trim()) {
      normalizedInput = "sender_" + phoneNumber.trim().toLowerCase();
    }
  }

  console.log(
    `[SMS] showConversation: input="${phoneNumber}", normalized="${normalizedInput}"`,
  );

  const normalizedContactInput =
    normalizedInput && normalizedInput.startsWith("contact_")
      ? stripBidi(normalizedInput.slice("contact_".length)).trim().toLowerCase()
      : "";

  let conversation = state.allSMSMessages
    .filter((msg) => {
      const rawPhone = stripBidi(msg.phoneNumber || msg.sender || "");
      let msgNormalized = normalizePhoneNumber(rawPhone);
      // For text senders (HSBC, Orange), use sender_ prefix
      if (!msgNormalized && rawPhone.trim()) {
        msgNormalized = "sender_" + rawPhone.trim().toLowerCase();
      }

      // Resolve contact name the same way as list grouping (including contacts map fallback)
      const mappedContact = msgNormalized
        ? (state.phoneToContactMap && state.phoneToContactMap[msgNormalized]) || getContactName(rawPhone)
        : "";
      const contactName = stripBidi(msg.contactName || msg.title || mappedContact || "");
      const contactKey = contactName && !isPhoneNumberLike(contactName)
        ? "contact_" + contactName.trim()
        : "";

      // For contact_* rows, also match by normalized contact text (handles formatting/bidi differences)
      const matchesContactName =
        !!normalizedContactInput &&
        contactName.trim().toLowerCase() === normalizedContactInput;

      const matches =
        msgNormalized === normalizedInput ||
        contactKey === normalizedInput ||
        matchesContactName;
      return matches;
    })
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  // Respect the currently selected SMS device tab in conversation detail.
  // If a specific device is selected (e.g. MM-MOB-A57), do not mix messages
  // from other devices in the same contact thread.
  const activeDevice =
    document.querySelector("#smsDeviceTabs .device-tab.active")?.dataset.device || "all";
  if (activeDevice !== "all") {
    conversation = conversation.filter((msg) => msg.deviceId === activeDevice);
  }

  console.log(`[SMS] showConversation: found ${conversation.length} messages`);

  // Ø¥Ø²Ø§Ù„Ø© Ø§Ù„ØªÙƒØ±Ø§Ø± ÙÙŠ Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø©
  const uniqueConversation = [];
  const seenIds = new Set();
  for (const msg of conversation) {
    if (!seenIds.has(msg.id)) {
      seenIds.add(msg.id);
      uniqueConversation.push(msg);
    }
  }
  const fullConversation = uniqueConversation;
  conversation = uniqueConversation;

  // Apply unread filter if enabled while inside the conversation detail
  const isUnreadDetailFilter = !!document.getElementById("smsShowUnread")?.checked;
  if (isUnreadDetailFilter) {
    conversation = conversation.filter((msg) => !msg.read);
  }

  // Apply starred filter if the checkbox is checked while inside the conversation detail
  const isStarredDetailFilter = !!document.getElementById("smsShowStarred")?.checked;
  if (isStarredDetailFilter) {
    const _starred = getSmsStarredMessages();
    conversation = conversation.filter(msg => _starred.has(msg.id));
  }

  if (conversation.length === 0) {
    if (fullConversation.length === 0) return;
  }

  if (conversation.length > 0) {
    markConversationAsRead(conversation);
  }

  const headerConversation = conversation.length > 0 ? conversation : fullConversation;

  const contactName =
    headerConversation.find(m => m.contactName && m.contactName.trim() && !isPhoneNumberLike(m.contactName))?.contactName ||
    headerConversation.find(m => m.title && m.title.trim() && !isPhoneNumberLike(m.title))?.title ||
    getContactName(headerConversation.find(m => m.phoneNumber && isPhoneNumberLike(m.phoneNumber))?.phoneNumber || phoneNumber) ||
    (phoneNumber.startsWith("contact_") ? phoneNumber.replace("contact_", "") : null) ||
    headerConversation[0].phoneNumber ||
    phoneNumber;
  // Extract the real phone number from messages (the key might be contact_Name or sender_Name)
  // Use the most recent message's phone so we reflect the actual last sender (a contact
  // may have multiple numbers; conversation is sorted ascending so the newest is last)
  const realPhoneNumber = [...headerConversation]
    .reverse()
    .find(m => {
      const p = m.phoneNumber || m.sender || "";
      return p && !p.startsWith("contact_") && !p.startsWith("sender_") && /\d/.test(p);
    });
  const displayPhone = realPhoneNumber ? (realPhoneNumber.phoneNumber || realPhoneNumber.sender || "") : "";
  state.setCurrentConversation(phoneNumber);

  const latestMsg = conversation[conversation.length - 1] || null;
  const latestMsgBody = (latestMsg?.body || latestMsg?.text || latestMsg?.content || "").trim();
  const latestMsgTime = latestMsg ? formatTime(latestMsg.timestamp) : "";
  const latestMsgLabel = getCurrentLanguage() === "ar" ? "آخر رسالة" : "Last SMS";
  const latestMsgFallback = getCurrentLanguage() === "ar" ? "بدون نص" : "No text";
  const latestMsgPreview = `${latestMsgLabel}: ${latestMsgTime}${latestMsgBody ? ` - ${latestMsgBody}` : ` - ${latestMsgFallback}`}`;

  // Update the global delete button to reflect "delete this conversation" context
  const deleteAllBtn = document.getElementById("deleteAllSmsBtn");
  if (deleteAllBtn) {
    deleteAllBtn.title = getCurrentLanguage() === "ar" ? "حذف هذه المحادثة" : "Delete this conversation";
    deleteAllBtn.disabled = false;
  }

  const smsListElement = document.getElementById("smsList");
  smsListElement.classList.add("conversation-open");
  smsListElement.innerHTML = `
    <div class="conversation-view">
      <div class="conversation-header">
        <button class="back-btn" id="backToSMS">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div class="conversation-avatar">
          ${getInitials(contactName)}
        </div>
        <div class="conversation-info">
          <div class="conversation-name">${escapeHtml(contactName)}</div>
          <div class="conversation-phone">${
            displayPhone
              ? escapeHtml(displayPhone)
              : (phoneNumber !== contactName &&
                 !phoneNumber.startsWith("contact_") &&
                 !phoneNumber.startsWith("sender_")
                  ? escapeHtml(phoneNumber)
                  : "")
          }</div>
        </div>
        ${(() => {
          const actionPhone = displayPhone || (!phoneNumber.startsWith("contact_") && !phoneNumber.startsWith("sender_") && isPhoneNumberLike(phoneNumber) ? phoneNumber : "");
          return actionPhone ? `<div class="conv-header-actions" data-action-phone="${escapeHtml(actionPhone)}">
          <button class="call-action-btn call-action-whatsapp" id="smsConvWaBtn" title="WhatsApp">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            <span>WhatsApp</span>
          </button>
        </div>` : "";
        })()}
      </div>
      <div class="conversation-messages">
        ${conversation.length === 0
          ? `<div class="empty-state"><p>${
              isUnreadDetailFilter
                ? (getCurrentLanguage() === "ar" ? "لا توجد رسائل غير مقروءة" : "No unread messages")
                : (getCurrentLanguage() === "ar" ? "لا توجد رسائل مميزة" : "No starred messages")
            }</p><span>${
              isUnreadDetailFilter
                ? (getCurrentLanguage() === "ar" ? "تمت قراءة كل الرسائل في هذه المحادثة" : "All messages in this conversation are read")
                : (getCurrentLanguage() === "ar" ? "قم بتمييز رسائل من داخل المحادثة" : "Star messages inside this conversation")
            }</span></div>`
          : conversation
          .map(
            (msg) => {
          const isStarred = getSmsStarredMessages().has(msg.id);
          return `
          <div class="chat-message-wrapper ${
            msg.direction === "outgoing" || msg.type === "sent"
              ? "sent"
              : "received"
          }${isStarred ? " has-starred" : ""}">
            <div class="message-bubble ${
              msg.direction === "outgoing" || msg.type === "sent"
                ? "sent"
                : "received"
            }" data-msg-id="${escapeHtml(msg.id)}" data-msg-content="${escapeHtml(msg.body || msg.text || msg.content || "")}">
              <div class="message-text">${(msg.body || msg.text || msg.content) ? linkifyText(msg.body || msg.text || msg.content) : '<span class="sms-body-loading" aria-label="Loading message…"></span>'}</div>
              <div class="message-footer">
                <span class="message-time">${formatTime(msg.timestamp)}</span>
                ${resolveSMSDeviceName(msg)
                    ? `<span class="message-device"><svg width="11" height="11" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><rect x="128" y="16" width="256" height="480" rx="48" ry="48"/><line x1="256" y1="432" x2="256.01" y2="432" stroke-width="48"/></svg>${escapeHtml(resolveSMSDeviceName(msg))}</span>`
                    : ""}
                ${msg.simSlot != null && msg.simSlot >= 0 ? `<span class="sim-badge sim-${msg.simSlot}">${msg.simSlot + 1}</span>` : ""}
                <button class="delete-msg-btn" data-id="${escapeHtml(msg.id)}" title="${getCurrentLanguage() === 'ar' ? 'حذف' : 'Delete'}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="chat-message-actions">
              <button class="chat-action-btn star-msg-btn${isStarred ? " starred" : ""}" data-msg-id="${escapeHtml(msg.id)}" title="${getCurrentLanguage() === 'ar' ? (isStarred ? 'إلغاء تمييز الرسالة' : 'تمييز الرسالة') : (isStarred ? 'Unstar message' : 'Star message')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${isStarred ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
              <button class="chat-action-btn copy-msg-btn" title="${getCurrentLanguage() === 'ar' ? 'نسخ النص' : 'Copy text'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
              </button>
            </div>
          </div>
        `;}
          )
          .join("")}
      </div>
  `;

  // Scroll to bottom (newest messages) since we sort ascending now
  const messagesContainer = document.querySelector(".conversation-messages");
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Track which message IDs are already rendered so scroll-up only prepends new ones
    const renderedIds = new Set(conversation.map((m) => m.id));

    // Build the HTML for a single message bubble (matches the template above)
    const buildMessageHtml = (msg) => {
      const isStarred = getSmsStarredMessages().has(msg.id);
      return `
          <div class="chat-message-wrapper ${
            msg.direction === "outgoing" || msg.type === "sent" ? "sent" : "received"
          }${isStarred ? " has-starred" : ""}">
            <div class="message-bubble ${
              msg.direction === "outgoing" || msg.type === "sent" ? "sent" : "received"
            }" data-msg-id="${escapeHtml(msg.id)}" data-msg-content="${escapeHtml(msg.body || msg.text || msg.content || "")}">
              <div class="message-text">${(msg.body || msg.text || msg.content) ? linkifyText(msg.body || msg.text || msg.content) : '<span class="sms-body-loading" aria-label="Loading message…"></span>'}</div>
              <div class="message-footer">
                <span class="message-time">${formatTime(msg.timestamp)}</span>
                ${resolveSMSDeviceName(msg)
                    ? `<span class="message-device"><svg width="11" height="11" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><rect x="128" y="16" width="256" height="480" rx="48" ry="48"/><line x1="256" y1="432" x2="256.01" y2="432" stroke-width="48"/></svg>${escapeHtml(resolveSMSDeviceName(msg))}</span>`
                    : ""}
                ${msg.simSlot != null && msg.simSlot >= 0 ? `<span class="sim-badge sim-${msg.simSlot}">${msg.simSlot + 1}</span>` : ""}
                <button class="delete-msg-btn" data-id="${escapeHtml(msg.id)}" title="${getCurrentLanguage() === 'ar' ? 'حذف' : 'Delete'}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="chat-message-actions">
              <button class="chat-action-btn star-msg-btn${isStarred ? " starred" : ""}" data-msg-id="${escapeHtml(msg.id)}" title="${getCurrentLanguage() === 'ar' ? (isStarred ? 'إلغاء تمييز الرسالة' : 'تمييز الرسالة') : (isStarred ? 'Unstar message' : 'Star message')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${isStarred ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
              <button class="chat-action-btn copy-msg-btn" title="${getCurrentLanguage() === 'ar' ? 'نسخ النص' : 'Copy text'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
              </button>
            </div>
          </div>`;
    };

    // Recompute the conversation list from current state (fresh after loadMoreSMS)
    // and prepend any messages that weren't rendered yet, preserving scroll position.
    const prependNewMessages = () => {
      const fresh = state.allSMSMessages
        .filter((msg) => {
          const msgPhone = (msg.phoneNumber || msg.sender || "")
            .replace(/[\s\-\(\)\.]/g, "")
            .trim();
          const msgNormalized = normalizePhoneNumber(msgPhone);
          const contactKey =
            msg.contactName || msg.title
              ? "contact_" + (msg.contactName || msg.title).trim()
              : "";
          return msgNormalized === normalizedInput || contactKey === normalizedInput;
        })
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      const toPrepend = [];
      for (const m of fresh) {
        if (!renderedIds.has(m.id)) {
          toPrepend.push(m);
          renderedIds.add(m.id);
        }
      }
      if (toPrepend.length === 0) return;

      // Find the first existing wrapper so we can insert before it.
      // Sorted ascending, so older messages go at the top (before the existing first child).
      const firstWrapper = messagesContainer.querySelector(".chat-message-wrapper");
      const tmp = document.createElement("div");
      tmp.innerHTML = toPrepend.map(buildMessageHtml).join("");

      const prevScrollHeight = messagesContainer.scrollHeight;
      const prevScrollTop = messagesContainer.scrollTop;

      // Move the new wrappers into the container, inserted before the first existing one
      const newWrappers = [];
      while (tmp.firstChild) {
        const node = tmp.firstChild;
        if (node.nodeType === 1) newWrappers.push(node);
        if (firstWrapper) {
          messagesContainer.insertBefore(node, firstWrapper);
        } else {
          messagesContainer.appendChild(node);
        }
      }

      // Wire delete + copy handlers on the newly added bubbles
      newWrappers.forEach((wrapper) => {
        wrapper.querySelector(".delete-msg-btn")?.addEventListener("click", async (e) => {
          e.stopPropagation();
          const msgId = wrapper.querySelector(".delete-msg-btn")?.dataset.id;
          if (msgId && (await showConfirmDialog(getCurrentLanguage() === "ar" ? "حذف هذه الرسالة؟" : "Delete this message?"))) {
            deleteSingleSms(msgId);
          }
        });
        wrapper.querySelector(".copy-msg-btn")?.addEventListener("click", (e) => {
          e.stopPropagation();
          const msgBubble = wrapper.querySelector(".message-bubble");
          const text = msgBubble?.dataset.msgContent || "";
          if (text) {
            navigator.clipboard.writeText(text).then(() => {
              showToast(getCurrentLanguage() === "ar" ? "تم النسخ" : "Copied!", "success");
            }).catch(() => {
              showToast(getCurrentLanguage() === "ar" ? "فشل النسخ" : "Copy failed", "error");
            });
          }
        });
        wrapper.querySelector(".star-msg-btn")?.addEventListener("click", (e) => {
          e.stopPropagation();
          const btn = wrapper.querySelector(".star-msg-btn");
          const msgId = btn?.dataset.msgId;
          if (!msgId) return;
          toggleStarSmsMessage(msgId);
          const nowStarred = getSmsStarredMessages().has(msgId);
          btn.classList.toggle("starred", nowStarred);
          wrapper.classList.toggle("has-starred", nowStarred);
          const lang = getCurrentLanguage();
          btn.title = lang === "ar"
            ? (nowStarred ? "إلغاء تمييز الرسالة" : "تمييز الرسالة")
            : (nowStarred ? "Unstar message" : "Star message");
          btn.querySelector("svg")?.setAttribute("fill", nowStarred ? "currentColor" : "none");

          // Keep starred-only conversation filter strict: once unstarred, hide immediately.
          if (document.getElementById("smsShowStarred")?.checked) {
            showConversation(phoneNumber);
          }
        });
      });

      // Preserve visual position: scroll down by the height of newly-prepended content
      const heightDelta = messagesContainer.scrollHeight - prevScrollHeight;
      messagesContainer.scrollTop = prevScrollTop + heightDelta;
    };

    // If the conversation has too few messages to scroll, eagerly fetch older
    // pages and prepend them so the user sees their full history.
    const tooShortToScroll =
      messagesContainer.scrollHeight <= messagesContainer.clientHeight + 50;
    if (tooShortToScroll && hasMoreSMS() && !isLoadingMore) {
      (async () => {
        let rounds = 0;
        while (rounds < 3 && hasMoreSMS() && !isLoadingMore) {
          rounds += 1;
          await loadMoreSMS();
          if (state.currentConversation !== phoneNumber) return;
          prependNewMessages();
        }
      })();
    }

    // Infinite scroll - load older messages when scrolling near the top
    messagesContainer.addEventListener("scroll", () => {
      if (messagesContainer.scrollTop < 150 && hasMoreSMS() && !isLoadingMore) {
        console.log("[SMS] Conversation scroll-up triggered - loading more...");

        if (!document.getElementById("convScrollLoader")) {
          const loader = document.createElement("div");
          loader.className = "scroll-loader";
          loader.id = "convScrollLoader";
          loader.innerHTML =
            '<div class="spinner-small"></div> Loading older messages...';
          messagesContainer.insertBefore(loader, messagesContainer.firstChild);
        }

        loadMoreSMS().then(() => {
          document.getElementById("convScrollLoader")?.remove();
          if (state.currentConversation === phoneNumber) {
            prependNewMessages();
          }
        });
      }
    });
  }
  // Add back button handler (also covered by the permanent delegation in initSMSNavigation)
  document.getElementById("backToSMS")?.addEventListener("click", () => {
    _goBackFromConversation();
  });

  // WhatsApp button handler in conversation header
  document.getElementById("smsConvWaBtn")?.addEventListener("click", () => {
    const actionsDiv = document.querySelector(".conv-header-actions");
    const phone = actionsDiv?.dataset.actionPhone;
    if (phone) {
      let clean = phone.replace(/[^\d+]/g, "");
      if (clean.startsWith("+")) clean = clean.slice(1);
      else if (clean.startsWith("00")) clean = clean.slice(2);
      else if (clean.startsWith("0")) clean = "20" + clean.slice(1);
      window.open(`https://wa.me/${clean}`, "_blank");
    }
  });

  // Wire search box to filter within this conversation
  const convSearch = document.getElementById("smsSearchInput");
  if (convSearch) {
    convSearch.value = "";
    convSearch.placeholder = getCurrentLanguage() === "ar" ? "...بحث في المحادثة" : "Search in conversation...";
    // Remove list-view wiring so we can take over
    delete convSearch.dataset.wired;
    if (!convSearch.dataset.convWired) {
      convSearch.dataset.convWired = "1";
      convSearch.addEventListener("input", function _convSearch() {
        // If we've left conversation view, remove listener
        if (!state.currentConversation) {
          convSearch.removeEventListener("input", _convSearch);
          delete convSearch.dataset.convWired;
          return;
        }
        const q = this.value.trim().toLowerCase();
        document.querySelectorAll(".message-bubble").forEach((bubble) => {
          const text = bubble.querySelector(".message-text")?.textContent.toLowerCase() || "";
          bubble.style.display = !q || text.includes(q) ? "" : "none";
        });
      });
    }
  }
  // Wire smsShowStarred checkbox to re-render this conversation when toggled
  const convStarredCb = document.getElementById("smsShowStarred");
  if (convStarredCb && !convStarredCb.dataset.convWired) {
    convStarredCb.dataset.convWired = "1";
    convStarredCb.addEventListener("change", function _convStarred() {
      if (!state.currentConversation) {
        convStarredCb.removeEventListener("change", _convStarred);
        delete convStarredCb.dataset.convWired;
        return;
      }
      showConversation(phoneNumber);
    });
  }

  // Wire smsShowUnread checkbox to re-render this conversation when toggled
  const convUnreadCb = document.getElementById("smsShowUnread");
  if (convUnreadCb && !convUnreadCb.dataset.convWired) {
    convUnreadCb.dataset.convWired = "1";
    convUnreadCb.addEventListener("change", function _convUnread() {
      if (!state.currentConversation) {
        convUnreadCb.removeEventListener("change", _convUnread);
        delete convUnreadCb.dataset.convWired;
        return;
      }
      showConversation(phoneNumber);
    });
  }

  // Add send message handler
  const sendBtn = document.getElementById("sendConversationSms");
  const messageInput = document.getElementById("conversationMessageInput");

  sendBtn?.addEventListener("click", () =>
    sendConversationMessage(phoneNumber, messageInput),
  );
  messageInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendConversationMessage(phoneNumber, messageInput);
  });

  // Add delete message handlers
  document.querySelectorAll(".delete-msg-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const msgId = btn.dataset.id;
      if (await showConfirmDialog(getCurrentLanguage() === "ar" ? "حذف Ù‡Ø°Ù‡ Ø§Ù„Ø±Ø³Ø§Ù„Ø©ØŸ" : "Delete this message?")) {
        deleteSingleSms(msgId);
      }
    });
  });

  // Add copy message handlers
  document.querySelectorAll(".copy-msg-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const msgBubble = btn.closest(".chat-message-wrapper")?.querySelector(".message-bubble");
      const text = msgBubble?.dataset.msgContent || "";
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          showToast(getCurrentLanguage() === "ar" ? "ØªÙ… Ø§Ù„Ù†Ø³Ø®" : "Copied!", "success");
        }).catch(() => {
          showToast(getCurrentLanguage() === "ar" ? "ÙØ´Ù„ Ø§Ù„Ù†Ø³Ø®" : "Copy failed", "error");
        });
      }
    });
  });

  // Add star message handlers
  document.querySelectorAll(".star-msg-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const msgId = btn.dataset.msgId;
      if (!msgId) return;
      toggleStarSmsMessage(msgId);
      const nowStarred = getSmsStarredMessages().has(msgId);
      btn.classList.toggle("starred", nowStarred);
      btn.closest(".chat-message-wrapper")?.classList.toggle("has-starred", nowStarred);
      const lang = getCurrentLanguage();
      btn.title = lang === "ar"
        ? (nowStarred ? "\u0625\u0644\u063a\u0627\u0621 \u062a\u0645\u064a\u064a\u0632 \u0627\u0644\u0631\u0633\u0627\u0644\u0629" : "\u062a\u0645\u064a\u064a\u0632 \u0627\u0644\u0631\u0633\u0627\u0644\u0629")
        : (nowStarred ? "Unstar message" : "Star message");
      btn.querySelector("svg").setAttribute("fill", nowStarred ? "currentColor" : "none");

      // Keep starred-only conversation filter strict: once unstarred, hide immediately.
      if (document.getElementById("smsShowStarred")?.checked) {
        showConversation(phoneNumber);
      }
    });
  });
}

/**
 * Send SMS message from conversation view
 * @param {string} phoneNumber - Phone number to send to
 * @param {HTMLInputElement} inputElement - Input element
 */
async function sendConversationMessage(phoneNumber, inputElement) {
  // SMS sending disabled per Google Play policy
  showToast(getCurrentLanguage() === "ar" ? "إرسال الرسائل النصية معطل" : "SMS sending is disabled", "error");
  return;
  // eslint-disable-next-line no-unreachable
  const message = inputElement.value.trim();
  if (!message) return;

  const user = state.currentUser;

  // Resolve the actual phone number from the conversation grouping key.
  // The grouping key can be:
  //   - "contact_<name>" for contacts with multiple numbers (strip prefix â†’ still a name!)
  //   - "sender_<name>" for text/shortcode senders like "Orange", "HSBC"
  //   - A normalized numeric string e.g. "0501234567"
  let actualPhoneNumber;

  if (phoneNumber.startsWith("sender_")) {
    // Text/shortcode senders cannot receive SMS replies
    showToast(getCurrentLanguage() === "ar" ? "لا يمكن إرسال رسالة إلى هذا النوع من المرسلين" : "Cannot send SMS to this type of sender", "error");
    return;
  } else if (phoneNumber.startsWith("contact_")) {
    // Contact grouped by name (has multiple numbers) â€“ look up the real phone from messages
    const contactName = phoneNumber.replace("contact_", "");
    const msgs = state.allSMSMessages.filter(
      (msg) => (msg.contactName || msg.title || "").trim() === contactName,
    );
    const recentMsg =
      msgs.length > 0
        ? msgs.reduce((latest, m) =>
            (m.timestamp || 0) > (latest.timestamp || 0) ? m : latest,
          )
        : null;
    actualPhoneNumber = recentMsg
      ? recentMsg.phoneNumber || recentMsg.sender || ""
      : "";
    if (!actualPhoneNumber || !isPhoneNumberLike(actualPhoneNumber)) {
      showToast(getCurrentLanguage() === "ar" ? "تعذّر تحديد رقم الهاتف لهذا الاتصال" : "Cannot determine phone number for this contact", "error");
      return;
    }
  } else {
    // Numeric key â€“ find raw phone from messages to preserve country code format
    const msgs = state.allSMSMessages.filter((msg) => {
      const rawPhone = msg.phoneNumber || msg.sender || "";
      return normalizePhoneNumber(rawPhone) === phoneNumber;
    });
    actualPhoneNumber =
      msgs.length > 0
        ? msgs[0].phoneNumber || msgs[0].sender || phoneNumber
        : phoneNumber;
  }

  const devicesQuery = query(
    collection(db, "devices"),
    where("userId", "==", user.uid),
  );
  const devicesSnapshot = await getDocs(devicesQuery);

  const androidDevices = devicesSnapshot.docs
    .filter((doc) => !doc.data().id.startsWith("ext_"))
    .sort((a, b) => (b.data().lastSeen || 0) - (a.data().lastSeen || 0));

  if (androidDevices.length === 0) {
    showToast(getCurrentLanguage() === "ar" ? "لا يوجد جهاز أندرويد متاح لإرسال الرسالة" : "No Android device available to send SMS", "error");
    return;
  }

  // Prefer the device that already has messages in this conversation,
  // so replying always uses the same phone that received the original messages.
  const normalizedActual = normalizePhoneNumber(actualPhoneNumber);
  const conversationMsgs = state.allSMSMessages.filter((msg) => {
    const msgPhone = normalizePhoneNumber(msg.phoneNumber || msg.sender || "");
    return msgPhone === normalizedActual && msg.deviceId;
  });
  let preferredDeviceId = null;
  if (conversationMsgs.length > 0) {
    const recentMsg = conversationMsgs.reduce((latest, m) =>
      (m.timestamp || 0) > (latest.timestamp || 0) ? m : latest,
    );
    preferredDeviceId = recentMsg.deviceId;
  }
  const selectedDevice =
    (preferredDeviceId && androidDevices.find((d) => d.data().id === preferredDeviceId)) ||
    androidDevices[0];

  const deviceId = selectedDevice.data().id;
  const deviceName =
    selectedDevice.data().nickname ||
    selectedDevice.data().name ||
    "Android";

  try {
    const timestamp = Date.now();
    const docRef = await addDoc(collection(db, "sms_requests"), {
      userId: user.uid,
      fromDeviceId: await getDeviceId(),
      toDeviceId: deviceId,
      phoneNumber: actualPhoneNumber,
      message: message,
      status: "pending",
      timestamp: timestamp,
    });

    // Derive contactName from the conversation key (contact_Name â†’ Name)
    const sentContactName = phoneNumber.startsWith("contact_")
      ? phoneNumber.replace("contact_", "")
      : undefined;

    const newSmsMessage = {
      id: docRef.id,
      docId: docRef.id,
      phoneNumber: actualPhoneNumber,
      body: message,
      type: "sent",
      direction: "outgoing",
      timestamp: timestamp,
      read: true,
      deviceId: deviceId,
      deviceName: deviceName,
      ...(sentContactName ? { contactName: sentContactName } : {}),
    };

    // Add to per-device dict so it survives realtime updateSMSList rebuilds
    const currentDeviceSMS = state.getSMSData(deviceId) || [];
    state.setSMSData(deviceId, [...currentDeviceSMS, newSmsMessage]);

    const updatedMessages = [...state.allSMSMessages, newSmsMessage];
    state.setAllSMSMessages(updatedMessages);

    if (state.currentConversation === phoneNumber) {
      showConversation(phoneNumber);
    }

    inputElement.value = "";
    showToast(getCurrentLanguage() === "ar" ? "تم إرسال الرسالة!" : "SMS sent!", "success");

    // Listen for status update from Android device
    const unsubStatus = onSnapshot(
      doc(db, "sms_requests", docRef.id),
      (snapshot) => {
        const data = snapshot.data();
        if (!data) return;
        if (data.status === "sent") {
          showToast(getCurrentLanguage() === "ar" ? "تم تسليم الرسالة للشبكة" : "SMS delivered to carrier", "success");
          unsubStatus();
        } else if (data.status === "failed") {
          showToast(getCurrentLanguage() === "ar" ? "فشل إرسال الرسالة من الهاتف" : "SMS failed to send from phone", "error");
          unsubStatus();
        }
      },
    );
    // Auto-cleanup after 30 seconds
    setTimeout(() => unsubStatus(), 30000);
  } catch (error) {
    console.error("SMS send error:", error);
    showToast(getCurrentLanguage() === "ar" ? "فشل إرسال الرسالة" : "Failed to send SMS", "error");
  }
}

/**
 * Mark all SMS as read
 */
export async function markAllSmsAsRead() {
  const user = state.currentUser;
  if (!user || state.allSMSMessages.length === 0) return;

  const activeDevice = document.querySelector("#smsDeviceTabs .device-tab.active")?.dataset.device || "all";

  showLoadingOverlay();
  try {
    const batch = writeBatch(db);
    let count = 0;

    for (const msg of state.allSMSMessages) {
      if (!msg.read && msg.id && msg.deviceId && (activeDevice === "all" || msg.deviceId === activeDevice)) {
        const ownerUid = resolveSMSOwnerUid(msg.deviceId, msg.ownerUid);
        if (!ownerUid) continue;
        const notifRef = doc(
          db,
          "users",
          ownerUid,
          "devices",
          msg.deviceId,
          "notifications",
          msg.id,
        );
        batch.set(notifRef, { read: true }, { merge: true });
        count++;
      }
    }

    if (count > 0) {
      await batch.commit();
      showToast(`${count} messages marked as read`, "success");
      const updatedMessages = state.allSMSMessages.map((msg) => (
        (activeDevice === "all" || msg.deviceId === activeDevice) ? { ...msg, read: true } : msg
      ));
      state.setAllSMSMessages(updatedMessages);

      // Also update state.allSMS (per-device dict) so updateTabBadges() sees correct counts
      const deviceIds = activeDevice === "all" ? Object.keys(state.allSMS) : [activeDevice];
      deviceIds.forEach((deviceId) => {
        const updatedDeviceMsgs = (state.allSMS[deviceId] || []).map((msg) => ({
          ...msg,
          read: true,
        }));
        state.setSMSData(deviceId, updatedDeviceMsgs);
      });

      // Update cache so reopening the popup shows correct unread count
      cacheSMSData(state.allSMS, state.allSMSMessages.map(m =>
        (activeDevice === "all" || m.deviceId === activeDevice) ? { ...m, read: true } : m
      )).catch(() => {});
      // Mark-all is often followed by closing popup quickly; flush now to persist.
      await flushSMSCache();

      updateTabBadges();

      if (state.currentConversation) {
        showConversation(state.currentConversation);
      } else {
        renderSMS(updatedMessages);
      }
    } else {
      showToast("No unread messages", "info");
    }
  } catch (error) {
    console.error("Mark all read error:", error);
    showToast("Failed to mark as read", "error");
  }
  hideLoading();
}

/**
 * Mark conversation messages as read
 * @param {Array} conversation - Array of messages in conversation
 */
async function markConversationAsRead(conversation) {
  const user = state.currentUser;
  if (!user) return;

  const unreadMsgs = conversation.filter((msg) => !msg.read && msg.id && msg.deviceId);
  if (unreadMsgs.length === 0) return;

  const msgIds = new Set(unreadMsgs.map((m) => m.id));

  // Optimistic update: update state IMMEDIATELY (synchronous) so the badge
  // reflects the change right away, regardless of any async work below.
  const updatedMessages = state.allSMSMessages.map((msg) =>
    msgIds.has(msg.id) ? { ...msg, read: true } : msg,
  );
  state.setAllSMSMessages(updatedMessages);

  Object.keys(state.allSMS).forEach((deviceId) => {
    const updated = state.allSMS[deviceId].map((msg) =>
      msgIds.has(msg.id) ? { ...msg, read: true } : msg,
    );
    state.setSMSData(deviceId, updated);
  });

  // Update badge IMMEDIATELY after state update â€” before any awaits â€” so the
  // count drops to 0 right when the conversation is opened, regardless of which
  // device tab is active ("All" or a specific device).
  updateTabBadges();

  // Persist to cache in background (non-blocking for badge update)
  cacheSMSData(state.allSMS, updatedMessages).catch(() => {});
  // Flush immediately so quick popup close/reopen won't restore stale unread flags.
  flushSMSCache().catch(() => {});

  // Write to Firestore (non-blocking for UI â€” state/cache already updated)
  try {
    const batch = writeBatch(db);
    for (const msg of unreadMsgs) {
      const ownerUid = resolveSMSOwnerUid(msg.deviceId, msg.ownerUid);
      if (!ownerUid) continue;
      const notifRef = doc(
        db,
        "users",
        ownerUid,
        "devices",
        msg.deviceId,
        "notifications",
        msg.id,
      );
      batch.set(notifRef, { read: true }, { merge: true });
    }
    await batch.commit();
  } catch (error) {
    console.error("Mark conversation read error:", error);
  }
}

/**
 * Remove a set of deleted message IDs from the per-device state map and
 * immediately flush the SMS cache so deleted items never reappear on the
 * next popup open (the delta query only fetches *new* items, not removals).
 *
 * @param {Set<string>} deletedIds  - IDs that were just removed from Firestore
 * @param {Array}       updatedMessages - the already-filtered allSMSMessages array
 */
function _purgeSMSFromCache(deletedIds, updatedMessages) {
  // Strip deleted items from every per-device bucket
  for (const deviceId of Object.keys(state.allSMS)) {
    const filtered = (state.allSMS[deviceId] || []).filter((m) => !deletedIds.has(m.id));
    state.setSMSData(deviceId, filtered);
  }
  // Queue the new data and force an immediate write (bypasses the 3 s debounce)
  cacheSMSData(state.allSMS, updatedMessages).catch(() => {});
  flushSMSCache().catch(() => {});
}

/**
 * Delete: conversation messages (if in conversation), selected conversations
 * (if in selection mode), or prompt user to select first.
 */
export async function deleteAllSms() {
  const user = state.currentUser;
  if (!user) return;

  // If a conversation is open, delete only that conversation's messages
  if (state.currentConversation) {
    const phoneKey = state.currentConversation;
    const msgsToDelete = state.allSMSMessages.filter((msg) => {
      const rawPhone = msg.phoneNumber || msg.sender || "";
      let key = normalizePhoneNumber(rawPhone);
      if (!key && rawPhone.trim()) key = "sender_" + rawPhone.trim().toLowerCase();
      const contactKey =
        msg.contactName || msg.title
          ? "contact_" + (msg.contactName || msg.title).trim()
          : "";
      return key === phoneKey || contactKey === phoneKey;
    });

    if (msgsToDelete.length === 0) {
      showToast(getCurrentLanguage() === "ar" ? "لا توجد رسائل في هذه المحادثة" : "No messages in this conversation", "info");
      return;
    }

    if (!(await showConfirmDialog(getCurrentLanguage() === "ar"
      ? `حذف Ù‡Ø°Ù‡ Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø© (${msgsToDelete.length} Ø±Ø³Ø§Ù„Ø©)ØŸ`
      : `Delete this conversation (${msgsToDelete.length} message${msgsToDelete.length > 1 ? "s" : ""})?`
    ))) return;

    showLoadingOverlay();
    try {
      const batch = writeBatch(db);
      for (const msg of msgsToDelete) {
        const ref = getSMSDocRef(user, msg);
        if (ref) batch.delete(ref);
      }
      await batch.commit();

      const deletedIds = new Set(msgsToDelete.map((m) => m.id));
      const updatedMessages = state.allSMSMessages.filter((m) => !deletedIds.has(m.id));
      state.setAllSMSMessages(updatedMessages);
      _purgeSMSFromCache(deletedIds, updatedMessages);
      showToast(getCurrentLanguage() === "ar" ? `تم حذف ${msgsToDelete.length} رسالة` : `${msgsToDelete.length} messages deleted`, "success");
      state.setCurrentConversation(null);
      renderSMS(updatedMessages);
    } catch (error) {
      console.error("Delete conversation error:", error);
      showToast(getCurrentLanguage() === "ar" ? "فشل حذف المحادثة" : "Failed to delete conversation", "error");
    }
    hideLoading();
    return;
  }

  // On the list view: only act if selection mode is active
  if (selectionMode) {
    return deleteSelectedConversations();
  }

  // Nothing selected and not in a conversation
  showToast(getCurrentLanguage() === "ar" ? "اضغط على زر التحديد لاختيار الرسائل للحذف" : "Tap the select button to choose messages to delete", "info");
}

/**
 * Reconstruct a Firestore DocumentReference for an SMS message.
 * Messages loaded from cache don't have a live docRef (it can't be JSON-serialised),
 * so we rebuild it from docId + deviceId when needed.
 * @param {Object} user - current Firebase user
 * @param {Object} msg  - SMS message object
 * @returns {DocumentReference|null}
 */
function getSMSDocRef(user, msg) {
  if (msg.docRef) return msg.docRef;
  const id = msg.docId || msg.id;
  if (id && msg.deviceId) {
    return doc(db, "users", user.uid, "devices", msg.deviceId, "notifications", id);
  }
  return null;
}

/**
 * Delete single SMS
 * @param {string} msgId - Message ID to delete
 */
async function deleteSingleSms(msgId) {
  const user = state.currentUser;
  if (!user) return;

  const msg = state.allSMSMessages.find((m) => m.id === msgId);
  if (!msg) {
    showToast(getCurrentLanguage() === "ar" ? "الرسالة غير موجودة" : "Message not found", "error");
    return;
  }

  const msgRef = getSMSDocRef(user, msg);
  if (!msgRef) {
    showToast(getCurrentLanguage() === "ar" ? "الرسالة غير موجودة" : "Message not found", "error");
    return;
  }

  try {
    await deleteDoc(msgRef);
    showToast(getCurrentLanguage() === "ar" ? "تم حذف الرسالة" : "Message deleted", "success");

    const updatedMessages = state.allSMSMessages.filter((m) => m.id !== msgId);
    state.setAllSMSMessages(updatedMessages);
    _purgeSMSFromCache(new Set([msgId]), updatedMessages);

    if (state.currentConversation) {
      const remaining = updatedMessages.filter((m) => {
        const msgPhone = (m.phoneNumber || m.sender || "")
          .replace(/[\s\-\(\)\.]/g, "")
          .trim();
        const contactKey =
          m.contactName || m.title
            ? "contact_" + (m.contactName || m.title).trim()
            : "";
        return (
          msgPhone === state.currentConversation ||
          contactKey === state.currentConversation
        );
      });

      if (remaining.length === 0) {
        state.setCurrentConversation(null);
        renderSMS(updatedMessages);
      } else {
        showConversation(state.currentConversation);
      }
    } else {
      renderSMS(updatedMessages);
    }
  } catch (error) {
    console.error("Delete SMS error:", error);
    showToast(getCurrentLanguage() === "ar" ? "فشل حذف الرسالة" : "Failed to delete message", "error");
  }
}

/**
 * Enter per-message selection mode: add checkboxes to each message bubble
 * and wire a delegated click handler on the messages container.
 */
function _enterMessageSelectionMode() {
  document.querySelectorAll(".message-bubble[data-msg-id]").forEach((bubble) => {
    if (bubble.querySelector(".msg-checkbox-wrap")) return;
    const wrap = document.createElement("label");
    wrap.className = "msg-checkbox-wrap";
    wrap.addEventListener("click", (e) => e.stopPropagation());
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "msg-checkbox";
    cb.checked = selectedMessages.has(bubble.dataset.msgId);
    wrap.appendChild(cb);
    bubble.prepend(wrap);
  });

  const container = document.querySelector(".conversation-messages");
  if (container) {
    _msgClickHandler = (e) => {
      if (!messageSelectionMode) return;
      if (e.target.closest(".delete-msg-btn")) return;
      const bubble = e.target.closest(".message-bubble[data-msg-id]");
      if (!bubble) return;
      const msgId = bubble.dataset.msgId;
      const cb = bubble.querySelector(".msg-checkbox");
      if (selectedMessages.has(msgId)) {
        selectedMessages.delete(msgId);
        bubble.classList.remove("msg-selected");
        if (cb) cb.checked = false;
      } else {
        selectedMessages.add(msgId);
        bubble.classList.add("msg-selected");
        if (cb) cb.checked = true;
      }
      _updateMessageSelectionToolbar();
    };
    container.addEventListener("click", _msgClickHandler);
  }
  _updateMessageSelectionToolbar();
}

/**
 * Exit per-message selection mode: remove checkboxes and clean up listener.
 */
function _exitMessageSelectionMode() {
  document.querySelectorAll(".msg-checkbox-wrap").forEach((el) => el.remove());
  document.querySelectorAll(".message-bubble").forEach((bubble) => {
    bubble.classList.remove("msg-selected");
  });
  const container = document.querySelector(".conversation-messages");
  if (container && _msgClickHandler) {
    container.removeEventListener("click", _msgClickHandler);
    _msgClickHandler = null;
  }
}

/**
 * Update the selection toolbar for per-message selection mode.
 */
function _updateMessageSelectionToolbar() {
  const total = document.querySelectorAll(".message-bubble[data-msg-id]").length;
  const deleteBtn = document.getElementById("deleteAllSmsBtn");
  const countSpan = document.getElementById("smsSelectedCount");
  const selectAllCb = document.getElementById("smsSelectAll");
  if (deleteBtn) deleteBtn.disabled = selectedMessages.size === 0;
  if (countSpan) countSpan.textContent = selectedMessages.size;
  if (selectAllCb) {
    selectAllCb.checked = selectedMessages.size === total && total > 0;
    selectAllCb.indeterminate = selectedMessages.size > 0 && selectedMessages.size < total;
  }
}

/**
 * Update the selection toolbar state (count badge, delete button, select-all checkbox)
 * @param {number} totalConversations - Total number of visible conversations
 */
function _updateSelectionToolbar(totalConversations) {
  const deleteBtn = document.getElementById("deleteAllSmsBtn");
  const countSpan = document.getElementById("smsSelectedCount");
  const selectAllCb = document.getElementById("smsSelectAll");

  if (deleteBtn) deleteBtn.disabled = selectedConversations.size === 0;
  if (countSpan) countSpan.textContent = selectedConversations.size;
  if (selectAllCb) {
    selectAllCb.checked = selectedConversations.size === totalConversations && totalConversations > 0;
    selectAllCb.indeterminate = selectedConversations.size > 0 && selectedConversations.size < totalConversations;
  }
}

/**
 * Toggle SMS selection mode on/off
 */
export function toggleSelectionMode() {
  if (state.currentConversation) {
    // In conversation view: toggle per-message selection instead
    messageSelectionMode = !messageSelectionMode;
    selectedMessages.clear();

    const selectBtn = document.getElementById("smsSelectBtn");
    const toolbar = document.getElementById("smsSelectToolbar");

    if (messageSelectionMode) {
      selectBtn?.classList.add("active");
      if (toolbar) toolbar.style.display = "flex";
      _enterMessageSelectionMode();
    } else {
      selectBtn?.classList.remove("active");
      if (toolbar) toolbar.style.display = "none";
      _exitMessageSelectionMode();
    }
    return;
  }

  selectionMode = !selectionMode;
  selectedConversations.clear();

  const selectBtn = document.getElementById("smsSelectBtn");
  const toolbar = document.getElementById("smsSelectToolbar");

  if (selectionMode) {
    selectBtn?.classList.add("active");
    if (toolbar) toolbar.style.display = "flex";
  } else {
    selectBtn?.classList.remove("active");
    if (toolbar) toolbar.style.display = "none";
  }

  // Re-render to add or remove checkboxes
  renderSMS(state.allSMSMessages);
}

/**
 * Toggle select-all for visible conversations (or messages when in conversation view)
 * @param {boolean} checked - Whether to select or deselect all
 */
export function setSelectAll(checked) {
  if (messageSelectionMode) {
    const bubbles = document.querySelectorAll(".message-bubble[data-msg-id]");
    bubbles.forEach((bubble) => {
      const msgId = bubble.dataset.msgId;
      const cb = bubble.querySelector(".msg-checkbox");
      if (checked) {
        selectedMessages.add(msgId);
        bubble.classList.add("msg-selected");
        if (cb) cb.checked = true;
      } else {
        selectedMessages.delete(msgId);
        bubble.classList.remove("msg-selected");
        if (cb) cb.checked = false;
      }
    });
    _updateMessageSelectionToolbar();
    return;
  }

  const conversations = document.querySelectorAll(".sms-conversation[data-phone]");
  conversations.forEach((el) => {
    const phone = el.dataset.phone;
    const cb = el.querySelector(".conv-checkbox");
    if (checked) {
      selectedConversations.add(phone);
      el.classList.add("selected");
      if (cb) cb.checked = true;
    } else {
      selectedConversations.delete(phone);
      el.classList.remove("selected");
      if (cb) cb.checked = false;
    }
  });
  _updateSelectionToolbar(conversations.length);
}

/**
 * Delete selected individual messages from Firestore and state
 */
async function deleteSelectedMessages() {
  if (selectedMessages.size === 0) return;
  const user = state.currentUser;
  if (!user) return;
  const count = selectedMessages.size;
  if (!(await showConfirmDialog(getCurrentLanguage() === "ar"
    ? `حذف ${count} Ø±Ø³Ø§Ù„Ø©ØŸ`
    : `Delete ${count} message${count > 1 ? "s" : ""}?`
  ))) return;
  showLoadingOverlay();
  try {
    const msgsToDelete = state.allSMSMessages.filter((m) => selectedMessages.has(m.id));
    const batch = writeBatch(db);
    let deletedCount = 0;
    for (const msg of msgsToDelete) {
      const ref = getSMSDocRef(user, msg);
      if (ref) {
        batch.delete(ref);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      await batch.commit();
      showToast(`${deletedCount} message${deletedCount > 1 ? "s" : ""} deleted`, "success");
      const deletedIds = new Set(msgsToDelete.map((m) => m.id));
      const updatedMessages = state.allSMSMessages.filter((m) => !deletedIds.has(m.id));
      state.setAllSMSMessages(updatedMessages);
      _purgeSMSFromCache(deletedIds, updatedMessages);
    }
    // Exit message selection mode
    messageSelectionMode = false;
    selectedMessages.clear();
    document.getElementById("smsSelectBtn")?.classList.remove("active");
    const toolbar = document.getElementById("smsSelectToolbar");
    if (toolbar) toolbar.style.display = "none";
    showConversation(state.currentConversation);
  } catch (error) {
    console.error("Delete selected messages error:", error);
    showToast("Failed to delete messages", "error");
  }
  hideLoading();
}

/**
 * Delete all selected conversations from Firestore and state
 */
export async function deleteSelectedConversations() {
  if (messageSelectionMode) return deleteSelectedMessages();
  if (selectedConversations.size === 0) return;

  const user = state.currentUser;
  if (!user) return;

  const count = selectedConversations.size;
  if (!(await showConfirmDialog(getCurrentLanguage() === "ar"
    ? `حذف ${count} Ù…Ø­Ø§Ø¯Ø«Ø©ØŸ Ø³ÙŠØªÙ… حذف Ø¬Ù…ÙŠØ¹ Ø±Ø³Ø§Ø¦Ù„Ù‡Ø§.`
    : `Delete ${count} conversation${count > 1 ? "s" : ""}? All messages in them will be removed.`
  ))) return;

  showLoadingOverlay();
  try {
    const selected = new Set(selectedConversations);
    const msgsToDelete = state.allSMSMessages.filter((msg) => {
      const rawPhone = msg.phoneNumber || msg.sender || "";
      let key = normalizePhoneNumber(rawPhone);
      if (!key && rawPhone.trim()) key = "sender_" + rawPhone.trim().toLowerCase();
      const contactKey =
        msg.contactName || msg.title
          ? "contact_" + (msg.contactName || msg.title).trim()
          : "";
      return selected.has(key) || selected.has(contactKey);
    });

    const batch = writeBatch(db);
    let deletedCount = 0;
    for (const msg of msgsToDelete) {
      const ref = getSMSDocRef(user, msg);
      if (ref) {
        batch.delete(ref);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      await batch.commit();
      showToast(getCurrentLanguage() === "ar" ? `تم حذف ${deletedCount} رسالة` : `${deletedCount} messages deleted`, "success");

      const deletedIds = new Set(msgsToDelete.map((m) => m.id));
      const updatedMessages = state.allSMSMessages.filter((m) => !deletedIds.has(m.id));
      state.setAllSMSMessages(updatedMessages);
      _purgeSMSFromCache(deletedIds, updatedMessages);
    }

    // Exit selection mode
    selectionMode = false;
    selectedConversations.clear();
    const selectBtn = document.getElementById("smsSelectBtn");
    selectBtn?.classList.remove("active");
    const toolbar = document.getElementById("smsSelectToolbar");
    if (toolbar) toolbar.style.display = "none";

    renderSMS(state.allSMSMessages);
  } catch (error) {
    console.error("Delete selected conversations error:", error);
    showToast(getCurrentLanguage() === "ar" ? "فشل حذف المحادثات المختارة" : "Failed to delete selected conversations", "error");
  }
  hideLoading();
}

/**
 * Start polling for new SMS
 */
export function startPolling() {
  state.clearPollingInterval();
  const interval = setInterval(() => {
    loadSMS();
  }, 5000);
  state.setPollingInterval(interval);
}

/**
 * Stop polling
 */
export function stopPolling() {
  state.clearPollingInterval();
}

/**
 * Export SMS to a CSV file download.
 * When a conversation is open, exports only that conversation's messages.
 */
export function exportSMSToCSV() {
  const activeDevice =
    document.querySelector("#smsDeviceTabs .device-tab.active")?.dataset.device || "all";
  const knownDeviceIds = new Set([
    ...state.devices.map((d) => d.id),
    ...(state.sharedWithMeDevices || []).map((s) => s.deviceId),
  ]);
  let messages = (state.allSMSMessages || []).filter((m) => !m.deviceId || knownDeviceIds.has(m.deviceId));
  if (activeDevice !== "all") {
    messages = messages.filter((m) => m.deviceId === activeDevice);
  }
  const now = new Date();
  const localStamp = now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0") + "_" +
    String(now.getHours()).padStart(2, "0") + "-" +
    String(now.getMinutes()).padStart(2, "0");
  let filename = `iRopit-SMS-${localStamp}.csv`;

  if (state.currentConversation) {
    const phoneKey = state.currentConversation;
    messages = messages.filter((msg) => {
      const rawPhone = msg.phoneNumber || msg.sender || "";
      const normalized = normalizePhoneNumber(rawPhone);
      const contactKey =
        msg.contactName || msg.title
          ? "contact_" + (msg.contactName || msg.title).trim()
          : "";
      const senderKey = rawPhone.trim()
        ? "sender_" + rawPhone.trim().toLowerCase()
        : "";
      return (
        normalized === phoneKey ||
        contactKey === phoneKey ||
        senderKey === phoneKey
      );
    });
    const contactName =
      messages[0]?.contactName ||
      messages[0]?.title ||
      phoneKey.replace(/^(contact_|sender_)/, "");
    filename = `iRopit-SMS-${contactName}-${localStamp}.csv`;
  }

  if (messages.length === 0) {
    alert("No messages to export.");
    return;
  }

  const header = ["Date", "Time", "Direction", "Contact", "Phone Number", "Message", "SIM Card", "Device"];
  const rows = messages.map((m) => {
    const d = new Date(m.timestamp || 0);
    const date = d.toLocaleDateString("en-GB");
    const time = d.toLocaleTimeString();
    const direction = m.direction === "outgoing" || m.type === "sent" ? "Sent" : "Received";
    const contact = m.contactName || m.title || "";
    const phone = m.phoneNumber || m.sender || "";
    const body = m.body || m.text || m.content || "";
    const sim = m.simSlot != null && m.simSlot >= 0 ? `SIM ${m.simSlot + 1}` : "";
    const device = resolveSMSDeviceName(m) || "";
    return [date, time, direction, contact, phone, body, sim, device].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
  });

  const csv = "\uFEFF" + [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Load SMS messages for all shared devices and merge them into the SMS list.
 */
export async function loadSharedDevicesSMS(shares) {
  const user = state.currentUser;
  if (!user) {
    console.log("[SMS][shared] skip: no current user");
    return;
  }
  console.log("[SMS][shared] loader called, shares:", Array.isArray(shares) ? shares.length : 0);
  const smsShares = (shares || []).filter((s) => hasSharedSmsPermission(s));

  const allowedSmsDeviceIds = new Set([
    ...(state.devices || []).map((d) => d?.id).filter(Boolean),
    ...smsShares.map((s) => s?.deviceId).filter(Boolean),
  ]);
  if (pruneSMSForAllowedDevices(allowedSmsDeviceIds)) {
    updateTabBadges();
    renderSMS(state.allSMSMessages || []);
  }

  if (smsShares.length === 0) {
    console.log("[SMS][shared] no shares with SMS permission");
    stopSharedSMSListeners();
    return;
  }

  // Always reattach shared listeners from scratch. Reusing old handles can
  // leave stale/no-op listeners after auth/network churn in MV3 popup sessions.
  stopSharedSMSListeners();

  for (const share of smsShares) {
    const listenerKey = `${share.ownerUid}::${share.deviceId}`;

    try {
      const sharedSourceData = {
        strict: [],
        strictReceivedAt: [],
        relaxed: [],
        legacy: [],
        legacyWide: [],
        altStrict: [],
        altStrictReceivedAt: [],
        strictHeadProbeAt: 0,
      };
      sharedSmsSourceDataByKey.set(listenerKey, sharedSourceData);

      // ── One-shot RAW diagnostic ───────────────────────────────────────────
      // Dump the absolute newest docs in the shared device's notifications
      // collection straight from the SERVER, with NO type filter and NO stale
      // gating. This isolates whether the missing latest shared SMS is a
      // data-location problem (newest simply not in this path / not readable)
      // versus a type/filter/merge problem in our pipeline.
      (async () => {
        try {
          const rawNewestQ = query(
            collection(db, "users", share.ownerUid, "devices", share.deviceId, "notifications"),
            orderBy("timestamp", "desc"),
            limit(5),
          );
          const rawSnap = await getDocsFromServer(rawNewestQ);
          console.log(
            `[SMS][shared-raw:${share.deviceId}] server docs:`,
            rawSnap.size,
          );
          rawSnap.docs.forEach((d) => {
            const data = d.data() || {};
            console.log(
              `[SMS][shared-raw:${share.deviceId}]`,
              "ts=", new Date(toSmsTimestampMs(data.timestamp) || 0).toISOString(),
              "type=", String(data.type || ""),
              "smsType=", String(data.smsType || ""),
              "app=", String(data.appName || ""),
              "id=", d.id,
            );
          });
        } catch (rawErr) {
          if (rawErr?.code !== "permission-denied") {
            console.warn(
              `[SMS][shared-raw:${share.deviceId}] probe failed:`,
              rawErr?.code || rawErr?.message,
            );
          }
        }
      })();

      const publishSharedMerged = () => {
        const latest = sharedSmsSourceDataByKey.get(listenerKey);
        if (!latest) return;
        updateSMSList(share.deviceId, [
          ...latest.strict,
          ...latest.strictReceivedAt,
          ...latest.altStrict,
          ...latest.altStrictReceivedAt,
          ...latest.relaxed,
          ...latest.legacy,
          ...latest.legacyWide,
        ]);
      };

      const mergeByDocId = (current, incoming) => {
        const byId = new Map();
        [...(current || []), ...(incoming || [])].forEach((m) => {
          const k = m?.docId || m?.id;
          if (!k) return;
          const prev = byId.get(k);
          if (!prev || Number(m.timestamp || 0) >= Number(prev.timestamp || 0)) {
            byId.set(k, m);
          }
        });
        return Array.from(byId.values());
      };

      const resolveSharedCandidateDeviceIds = async () => {
        const ids = new Set([share.deviceId]);
        try {
          const idxQ = query(
            collection(db, "deviceShareIndex"),
            where("ownerUid", "==", share.ownerUid),
            where("sharedWithUid", "==", user.uid),
            limit(50),
          );
          const idxSnap = await getDocsFromServer(idxQ);
          idxSnap.docs.forEach((d) => {
            const data = d.data() || {};
            if (data.deviceId) {
              ids.add(String(data.deviceId));
              return;
            }
            const suffix = `_${user.uid}`;
            if (d.id && d.id.endsWith(suffix)) {
              ids.add(d.id.slice(0, -suffix.length));
            }
          });
        } catch (_) {}
        return Array.from(ids).filter(Boolean);
      };

      const candidateDeviceIds = await resolveSharedCandidateDeviceIds();
      const altDeviceIds = candidateDeviceIds.filter((id) => id !== share.deviceId);
      if (altDeviceIds.length > 0) {
        console.log(`[SMS][shared:${share.deviceId}] candidate deviceIds:`, candidateDeviceIds.join(", "));
      }

      const normalizeNameKey = (v) =>
        String(v || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");

      const belongsToSharedDevice = (msg) => {
        if (!msg) return false;
        const rawDeviceId = String(msg._rawDeviceId || "");
        if (rawDeviceId && rawDeviceId === share.deviceId) return true;

        const targetName = normalizeNameKey(share.deviceName);
        if (!targetName) return false;
        const rawDeviceName = normalizeNameKey(msg._rawDeviceName || msg.deviceName);
        return !!rawDeviceName && rawDeviceName === targetName;
      };

      const getNewestTs = (list) => {
        if (!Array.isArray(list) || list.length === 0) return 0;
        return list.reduce((maxTs, item) => {
          const ts = Number(item?.timestamp || 0);
          return ts > maxTs ? ts : maxTs;
        }, 0);
      };

      // Shared relaxed source can contain encrypted/untyped payloads. We classify
      // AFTER mapping/decryption so we do not drop valid SMS too early.
      const isLikelySMSMapped = (msg) => {
        if (!msg || typeof msg !== "object") return false;
        const rawType = String(msg._rawType || "").toLowerCase();
        const rawSmsType = String(msg._rawSmsType || "").toLowerCase();
        const appName = String(msg._rawAppName || "").toLowerCase();
        const direction = String(msg.direction || msg._rawDirection || "").toLowerCase();

        if (rawType === "sms" || rawSmsType) return true;
        if (msg._rawCallType || msg._rawDuration != null) return false;

        const hasBody = !!String(msg.body || "").trim();
        const hasParty = !!String(msg.phoneNumber || "").trim();
        const appLooksSms = appName === "sms" || appName.includes("message") || appName.includes("messaging");

        if (appLooksSms && (hasBody || hasParty)) return true;
        if ((direction === "incoming" || direction === "outgoing") && (hasBody || hasParty)) return true;
        return false;
      };

      // Resilient per-document mapper. A single doc that fails to decrypt must
      // NEVER reject the whole snapshot — otherwise the newest shared SMS can
      // permanently block the list from updating (every snapshot that contains
      // it rejects, freezing the shared view at older data).
      const mapSharedSmsDoc = async (docSnap) => {
        const rawTs =
          toSmsTimestampMs(docSnap.data()?.timestamp) ||
          toSmsTimestampMs(docSnap.data()?.receivedAt) ||
          Date.now();
        try {
          let data = docSnap.data();
          try {
            data = await decryptSMS(data, share.ownerUid);
          } catch (decErr) {
            // Keep the raw (possibly ENC:) data — stripEnc below blanks bad fields
            // but the row still renders so the newest message is not lost.
            console.warn(`[SMS] Shared decrypt failed for ${share.deviceId}/${docSnap.id}:`, decErr?.message || decErr);
          }
          const resolvedPhone = resolvePhoneNumber(data);
          const resolvedContact = resolveContactName(data, resolvedPhone);
          return {
            ...data,
            id: docSnap.id,
            docId: docSnap.id,
            docRef: docSnap.ref,
            ownerUid: share.ownerUid,
            _rawDeviceId: data.deviceId,
            _rawDeviceName: data.deviceName || data.device || data.model,
            _rawType: data.type,
            _rawSmsType: data.smsType,
            _rawAppName: data.appName,
            _rawCallType: data.callType,
            _rawDuration: data.duration,
            _rawDirection: data.direction,
            deviceId: share.deviceId,
            deviceName: share.deviceName || "",
            phoneNumber: resolvedPhone || stripEnc(data.phoneNumber) || "",
            contactName: resolvedContact || "",
            title: stripEnc(data.title),
            body: stripEnc(data.text) || stripEnc(data.content) || stripEnc(data.body) || "",
            timestamp: toSmsTimestampMs(data.timestamp) || toSmsTimestampMs(data.receivedAt) || rawTs,
            read: data.read === true,
            type: "sms",
          };
        } catch (mapErr) {
          console.warn(`[SMS] Shared map failed for ${share.deviceId}/${docSnap.id}:`, mapErr?.message || mapErr);
          // Minimal fallback record so the message still appears in the list.
          const raw = docSnap.data() || {};
          return {
            id: docSnap.id,
            docId: docSnap.id,
            docRef: docSnap.ref,
            ownerUid: share.ownerUid,
            _rawDeviceId: raw.deviceId,
            _rawDeviceName: raw.deviceName || raw.device || raw.model,
            _rawType: raw.type,
            _rawSmsType: raw.smsType,
            _rawAppName: raw.appName,
            _rawCallType: raw.callType,
            _rawDuration: raw.duration,
            _rawDirection: raw.direction,
            deviceId: share.deviceId,
            deviceName: share.deviceName || "",
            phoneNumber: stripEnc(raw.phoneNumber) || stripEnc(raw.sender) || "",
            contactName: "",
            title: "",
            body: "",
            timestamp: rawTs,
            read: raw.read === true,
            type: "sms",
          };
        }
      };

      const mapSharedDocsSafe = async (docs) => {
        const results = await Promise.allSettled(docs.map(mapSharedSmsDoc));
        return results
          .filter((r) => r.status === "fulfilled" && r.value)
          .map((r) => r.value);
      };

      const logNewestShared = (label, list) => {
        if (!list || list.length === 0) return;
        const newest = list.reduce((a, b) => (b.timestamp > a.timestamp ? b : a), list[0]);
        console.log(
          `[SMS][shared:${share.deviceId}] ${label} newest:`,
          new Date(newest.timestamp).toISOString(),
          (newest.contactName || newest.phoneNumber || "").toString().slice(0, 20),
          (newest.body || "").toString().slice(0, 30),
        );
      };

      const qStrict = query(
        collection(db, "users", share.ownerUid, "devices", share.deviceId, "notifications"),
        where("type", "==", "sms"),
        orderBy("timestamp", "desc"),
        limit(PAGE_SIZE),
      );

      const qStrictReceivedAt = query(
        collection(db, "users", share.ownerUid, "devices", share.deviceId, "notifications"),
        where("type", "==", "sms"),
        orderBy("receivedAt", "desc"),
        limit(1000),
      );

      const qStrictHead = query(
        collection(db, "users", share.ownerUid, "devices", share.deviceId, "notifications"),
        where("type", "==", "sms"),
        orderBy("timestamp", "desc"),
        limit(50),
      );

      const qStrictHeadReceivedAt = query(
        collection(db, "users", share.ownerUid, "devices", share.deviceId, "notifications"),
        where("type", "==", "sms"),
        orderBy("receivedAt", "desc"),
        limit(50),
      );

      const qRelaxed = query(
        collection(db, "users", share.ownerUid, "devices", share.deviceId, "notifications"),
        orderBy("timestamp", "desc"),
        limit(1000),
      );

      const qLegacy = query(
        collection(db, "sms"),
        where("userId", "==", share.ownerUid),
        where("deviceId", "==", share.deviceId),
        orderBy("timestamp", "desc"),
        limit(1000),
      );

      const qLegacyWide = query(
        collection(db, "sms"),
        where("userId", "==", share.ownerUid),
        orderBy("timestamp", "desc"),
        limit(2000),
      );

      const qLegacyWideUpper = query(
        collection(db, "SMS"),
        where("userId", "==", share.ownerUid),
        orderBy("timestamp", "desc"),
        limit(2000),
      );

      const listenerUnsubs = [];

      const unsubStrict = onSnapshot(
        qStrict,
        async (snapshot) => {
          const messages = await mapSharedDocsSafe(snapshot.docs);
          const source = sharedSmsSourceDataByKey.get(listenerKey);
          if (!source) return;
          source.strict = messages;
          logNewestShared("strict", messages);

          // If strict looks stale, probe server head once per minute to bypass
          // IndexedDB/local snapshot staleness for shared-account reads.
          const now = Date.now();
          const newestStrictTs = getNewestTs(messages);
          const looksStale = newestStrictTs > 0 && now - newestStrictTs > 15 * 60 * 1000;
          if (looksStale && now - (source.strictHeadProbeAt || 0) > 60 * 1000) {
            source.strictHeadProbeAt = now;
            try {
              const [headSnap, headReceivedAtSnap] = await Promise.allSettled([
                getDocsFromServer(qStrictHead),
                getDocsFromServer(qStrictHeadReceivedAt),
              ]);

              const strictHeadDocs =
                headSnap.status === "fulfilled" ? headSnap.value.docs : [];
              const receivedAtHeadDocs =
                headReceivedAtSnap.status === "fulfilled"
                  ? headReceivedAtSnap.value.docs
                  : [];

              const headMessages = await mapSharedDocsSafe([
                ...strictHeadDocs,
                ...receivedAtHeadDocs,
              ]);

              if (headMessages.length > 0) {
                const byId = new Map();
                [...source.strict, ...headMessages].forEach((m) => {
                  const k = m.docId || m.id;
                  if (!k) return;
                  const prev = byId.get(k);
                  if (!prev || Number(m.timestamp || 0) >= Number(prev.timestamp || 0)) {
                    byId.set(k, m);
                  }
                });
                source.strict = Array.from(byId.values());
                logNewestShared("strict-server", headMessages);
              }
            } catch (probeErr) {
              if (probeErr?.code !== "permission-denied" && !isUnavailableError(probeErr)) {
                console.warn(`[SMS] Shared strict server probe failed for ${share.deviceId}:`, probeErr?.code || probeErr?.message);
              }
            }
          }

          publishSharedMerged();
        },
        (err) => {
          if (err?.code === "permission-denied") {
            // Expected for stale/old shared device IDs; try other fallback sources silently.
            return;
          }
          if (isUnavailableError(err)) {
            logSMSUnavailableOnce(
              `shared-listener:${share.deviceId}`,
              `[SMS] Shared listener unavailable for ${share.deviceId}`,
              err?.message || err?.code,
            );
            return;
          }
          console.warn(`[SMS] Shared listener failed for ${share.deviceId}:`, err?.code);
        },
      );

      listenerUnsubs.push(unsubStrict);

      const unsubStrictReceivedAt = onSnapshot(
        qStrictReceivedAt,
        async (snapshot) => {
          const messages = await mapSharedDocsSafe(snapshot.docs);
          const source = sharedSmsSourceDataByKey.get(listenerKey);
          if (!source) return;
          source.strictReceivedAt = messages;
          logNewestShared("strict-receivedAt", messages);
          publishSharedMerged();
        },
        (err) => {
          if (err?.code === "permission-denied" || err?.code === "failed-precondition") {
            return;
          }
          if (isUnavailableError(err)) {
            return;
          }
          console.warn(`[SMS] Shared receivedAt listener failed for ${share.deviceId}:`, err?.code);
        },
      );

      listenerUnsubs.push(unsubStrictReceivedAt);

      const unsubRelaxed = onSnapshot(
        qRelaxed,
        async (snapshot) => {
          const mapped = await mapSharedDocsSafe(snapshot.docs);
          const messages = mapped.filter((m) => isLikelySMSMapped(m));
          const source = sharedSmsSourceDataByKey.get(listenerKey);
          if (!source) return;
          source.relaxed = messages;
          logNewestShared("relaxed", messages);
          publishSharedMerged();
        },
        (err) => {
          if (err?.code === "permission-denied") return;
          if (isUnavailableError(err)) return;
          console.warn(`[SMS] Shared relaxed listener failed for ${share.deviceId}:`, err?.code);
        },
      );

      listenerUnsubs.push(unsubRelaxed);

      const unsubLegacy = onSnapshot(
        qLegacy,
        async (snapshot) => {
          const messages = await mapSharedDocsSafe(snapshot.docs);
          const source = sharedSmsSourceDataByKey.get(listenerKey);
          if (!source) return;
          source.legacy = messages;
          logNewestShared("legacy", messages);
          publishSharedMerged();
        },
        (err) => {
          if (err?.code === "permission-denied" || err?.code === "failed-precondition") return;
          if (isUnavailableError(err)) return;
          console.warn(`[SMS] Shared legacy listener failed for ${share.deviceId}:`, err?.code);
        },
      );

      listenerUnsubs.push(unsubLegacy);

      const applyLegacyWide = async (snapshot, label) => {
        const source = sharedSmsSourceDataByKey.get(listenerKey);
        if (!source) return;
        const mapped = await mapSharedDocsSafe(snapshot.docs);
        const filtered = mapped.filter((m) => belongsToSharedDevice(m));
        // Merge both wide feeds (sms and SMS) by doc id.
        const byId = new Map();
        [...source.legacyWide, ...filtered].forEach((m) => {
          const k = m.docId || m.id;
          if (!k) return;
          const prev = byId.get(k);
          if (!prev || Number(m.timestamp || 0) >= Number(prev.timestamp || 0)) {
            byId.set(k, m);
          }
        });
        source.legacyWide = Array.from(byId.values());
        logNewestShared(label, source.legacyWide);
        publishSharedMerged();
      };

      const unsubLegacyWide = onSnapshot(
        qLegacyWide,
        (snapshot) => {
          applyLegacyWide(snapshot, "legacy-wide").catch(() => {});
        },
        (err) => {
          if (err?.code === "permission-denied" || err?.code === "failed-precondition") return;
          if (isUnavailableError(err)) return;
          console.warn(`[SMS] Shared legacy-wide listener failed for ${share.deviceId}:`, err?.code);
        },
      );

      listenerUnsubs.push(unsubLegacyWide);

      const unsubLegacyWideUpper = onSnapshot(
        qLegacyWideUpper,
        (snapshot) => {
          applyLegacyWide(snapshot, "legacy-wide-SMS").catch(() => {});
        },
        (err) => {
          if (err?.code === "permission-denied" || err?.code === "failed-precondition") return;
          if (isUnavailableError(err)) return;
          console.warn(`[SMS] Shared legacy-wide-SMS listener failed for ${share.deviceId}:`, err?.code);
        },
      );

      listenerUnsubs.push(unsubLegacyWideUpper);

      for (const altDeviceId of altDeviceIds) {
        const qAltStrict = query(
          collection(db, "users", share.ownerUid, "devices", altDeviceId, "notifications"),
          where("type", "==", "sms"),
          orderBy("timestamp", "desc"),
          limit(PAGE_SIZE),
        );

        const qAltStrictReceivedAt = query(
          collection(db, "users", share.ownerUid, "devices", altDeviceId, "notifications"),
          where("type", "==", "sms"),
          orderBy("receivedAt", "desc"),
          limit(1000),
        );

        const unsubAltStrict = onSnapshot(
          qAltStrict,
          async (snapshot) => {
            const messages = await mapSharedDocsSafe(snapshot.docs);
            const source = sharedSmsSourceDataByKey.get(listenerKey);
            if (!source) return;
            source.altStrict = mergeByDocId(source.altStrict, messages);
            logNewestShared(`alt-strict:${altDeviceId}`, messages);
            publishSharedMerged();
          },
          (err) => {
            if (err?.code === "permission-denied" || err?.code === "failed-precondition") return;
            if (isUnavailableError(err)) return;
            console.warn(`[SMS] Shared alt strict listener failed for ${share.deviceId}/${altDeviceId}:`, err?.code);
          },
        );

        listenerUnsubs.push(unsubAltStrict);

        const unsubAltStrictReceivedAt = onSnapshot(
          qAltStrictReceivedAt,
          async (snapshot) => {
            const messages = await mapSharedDocsSafe(snapshot.docs);
            const source = sharedSmsSourceDataByKey.get(listenerKey);
            if (!source) return;
            source.altStrictReceivedAt = mergeByDocId(source.altStrictReceivedAt, messages);
            logNewestShared(`alt-strict-receivedAt:${altDeviceId}`, messages);
            publishSharedMerged();
          },
          (err) => {
            if (err?.code === "permission-denied" || err?.code === "failed-precondition") return;
            if (isUnavailableError(err)) return;
            console.warn(`[SMS] Shared alt receivedAt listener failed for ${share.deviceId}/${altDeviceId}:`, err?.code);
          },
        );

        listenerUnsubs.push(unsubAltStrictReceivedAt);
      }

      sharedSmsUnsubscribeByKey.set(listenerKey, listenerUnsubs);
    } catch (err) {
      if (err?.code === "permission-denied") continue;
      if (isUnavailableError(err)) {
        logSMSUnavailableOnce(
          `shared-failed:${share.deviceId}`,
          `[SMS] Shared device ${share.deviceId} unavailable after fallback`,
          err?.message || err?.code,
        );
        continue;
      }
      console.warn(`[SMS] Failed to load shared device ${share.deviceId}:`, err?.code);
    }
  }
}
