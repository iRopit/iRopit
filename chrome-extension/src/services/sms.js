/**
 * SMS Service
 * Handles SMS loading, rendering, and management
 */

import {
  db,
  collection,
  doc,
  getDocs,
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
  getDeviceId,
  getFriendlyDeviceName,
  escapeHtml,
} from "../utils/helpers.js";
import * as state from "../state/index.js";
import { updateTabBadges } from "./badges.js";
import { decryptSMS } from "./cryptoService.js";
import { getContactName } from "./contacts.js";
import { getCachedSMS, cacheSMSData } from "./cache.js";
import { getCurrentLanguage } from "../utils/i18n.js";

// Store unsubscribe functions for real-time listeners
let smsUnsubscribeFunctions = [];
// Track processed message IDs to avoid duplicates
let processedMessageIds = new Set();
// Decryption cache - avoid re-decrypting same messages
const decryptionCache = new Map();

// Pagination state
const PAGE_SIZE = 500;
let paginationState = {}; // { deviceId: { lastTimestamp, hasMore, loading } }
let isLoadingMore = false;
let scrollHandlerAttached = false;
let totalLoadedCount = 0;
let isSyncing = false;

// Selection mode state
let selectionMode = false;
let selectedConversations = new Set();

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
  // Add leading 0 if missing for local numbers
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
 * Resolve phone number from raw SMS data
 * @param {Object} data - SMS data
 * @returns {string}
 */
function resolvePhoneNumber(data) {
  if (!data) return "";
  const candidates = [
    data.phoneNumber,
    data.sender,
    data.address,
    data.number,
    data.phone,
  ];

  const candidate = candidates.find((c) => c && isPhoneNumberLike(c));

  if (candidate) return candidate;

  if (data.title && isPhoneNumberLike(data.title)) {
    return data.title;
  }

  return (
    data.phoneNumber ||
    data.sender ||
    data.address ||
    data.number ||
    data.phone ||
    ""
  );
}

/**
 * Resolve contact name from raw SMS data
 * @param {Object} data - SMS data
 * @param {string} phoneNumber - Resolved phone number
 * @returns {string}
 */
function resolveContactName(data, phoneNumber) {
  if (!data) return "";

  // Priority: explicit contactName > displayName > title (if not a phone number) > contacts lookup
  if (data.contactName && data.contactName.trim()) return data.contactName;
  if (data.displayName && data.displayName.trim()) return data.displayName;

  // title from Google Messages notification = contact name or phone number
  if (data.title && data.title.trim() && !isPhoneNumberLike(data.title)) {
    return data.title;
  }

  // Lookup in local contacts map (handles multiple numbers per contact)
  const fromContacts = getContactName(phoneNumber);
  if (fromContacts) return fromContacts;

  // Last resort: check if title is different from phoneNumber (might be a name in another language)
  if (data.title && data.title.trim() && data.title !== phoneNumber) {
    // Title has non-digit chars = likely a name
    const nonDigits = data.title.replace(/[\d\s\-+().]/g, "");
    if (nonDigits.length > 0) return data.title;
  }

  return "";
}

/**
 * Stop all SMS listeners
 */
export function stopSMSListener() {
  smsUnsubscribeFunctions.forEach((unsub) => unsub());
  smsUnsubscribeFunctions = [];
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

  // Stop any previous listeners first
  stopSMSListener();

  // === STEP 1: Show cached data instantly ===
  let hasCachedData = false;
  try {
    const cached = await getCachedSMS();
    if (cached && cached.allMessages && cached.allMessages.length > 0) {
      console.log(
        `[SMS] 📦 Showing ${cached.allMessages.length} cached messages instantly`,
      );
      hasCachedData = true;
      // Restore state from cache
      if (cached.byDevice) {
        for (const [deviceId, msgs] of Object.entries(cached.byDevice)) {
          state.setSMSData(deviceId, msgs);
        }
      }
      state.setAllSMSMessages(cached.allMessages);
      renderSMS(cached.allMessages);
      updateTabBadges();
    }
  } catch (e) {
    console.warn("[SMS] Cache load failed:", e);
  }

  // Show loading spinner only if no cached data
  if (!hasCachedData && smsList) {
    showListLoading(smsList);
  }

  // === STEP 2: Fetch fresh data from Firebase in background ===
  isSyncing = true;
  showSyncIndicator();
  console.log(`[SMS] Loading fresh SMS for user: ${user.uid}`);
  logger.info(`Loading SMS for user: ${user.uid}`);

  try {
    // First, get all user devices
    const devicesQuery = query(
      collection(db, COLLECTIONS.DEVICES),
      where("userId", "==", user.uid),
    );

    logger.debug("Fetching devices...");
    const devicesSnapshot = await getDocs(devicesQuery);
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

    if (devicesList.length === 0) {
      console.warn(
        "⚠️ No mobile devices found for SMS loading - showing empty state",
      );
      renderSMS([]);
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

      const q = query(
        collection(
          db,
          "users",
          user.uid,
          "devices",
          device.id,
          "notifications",
        ),
        where("type", "==", "sms"),
        orderBy("timestamp", "desc"),
        limit(PAGE_SIZE),
      );

      try {
        // One-time fetch - much faster than onSnapshot for bulk data
        const snapshot = await getDocs(q);
        console.log(
          `[SMS] Loaded ${snapshot.size} messages from device ${device.id}`,
        );

        // Decrypt all messages in parallel with caching
        const messages = await Promise.all(
          snapshot.docs.map(async (docSnap) => {
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
              body: data.text || data.content || data.body || "",
              timestamp: data.timestamp || data.receivedAt || Date.now(),
              read: data.read === true,
              type: data.type || "sms",
            };
          }),
        );

        // Track pagination cursor
        if (messages.length > 0) {
          const oldestMsg = messages[messages.length - 1];
          devicePagState.lastTimestamp = oldestMsg.timestamp;
          if (paginationState[device.id]) paginationState[device.id].lastTimestamp = oldestMsg.timestamp;
        }
        devicePagState.hasMore = snapshot.size >= PAGE_SIZE;
        if (paginationState[device.id]) paginationState[device.id].hasMore = snapshot.size >= PAGE_SIZE;
        updateSMSList(device.id, messages);
      } catch (error) {
        console.error(`❌ SMS load error for device ${device.id}:`, error);
      }
    });

    // Start realtime listeners immediately so new messages appear within ~1s
    // The first snapshot will show the latest messages even before getDocs completes
    startSMSRealtimeListeners(user.uid, devicesList);

    // Load all devices in parallel (full history runs in background)
    await Promise.all(loadPromises);
    console.log("[SMS] ✅ Initial load complete");

    isSyncing = false;
    updateSMSCountIndicator();
  } catch (error) {
    console.error("❌ loadSMS error:", error);
    isSyncing = false;
    updateSMSCountIndicator();
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
                body: data.text || data.content || data.body || "",
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
              body: data.text || data.content || data.body || "",
              timestamp: data.timestamp || data.receivedAt || Date.now(),
              read: data.read === true,
              type: data.type || "sms",
            };

            processedMessageIds.add(messageId);
            const currentSMS = state.getSMSData(device.id) || [];
            const existingIdx = currentSMS.findIndex((m) => m.id === messageId);
            if (existingIdx >= 0) {
              currentSMS[existingIdx] = message;
            } else {
              currentSMS.unshift(message);
            }
            updateSMSList(device.id, currentSMS);
            hasNewMessages = true;
          }
        }

        if (hasNewMessages) {
          console.log(`[SMS] ✨ Realtime update from device ${device.id}`);
        }
      },
      (error) => {
        console.error(
          `❌ SMS realtime listener error for device ${device.id}:`,
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
    `[SMS] 📥 Loading more SMS from ${devicesWithMore.length} devices...`,
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
          `[SMS] 📥 Loaded ${snapshot.size} more messages from device ${deviceId}`,
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
        const cachedDeviceName = deviceInfo?.deviceName || "Android";

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
                body: data.text || data.content || data.body || "",
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
        console.error(`❌ Error loading more SMS from ${deviceId}:`, error);
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
    };
  });

  // Store SMS by device
  state.setSMSData(deviceId, normalizedMessages);

  // Merge all SMS from all devices
  let merged = [];
  Object.values(state.allSMS).forEach((msgs) => {
    merged = merged.concat(msgs);
  });

  // إزالة التكرار - الاحتفاظ بنسخة واحدة فقط من كل رسالة
  // Two-pass dedup: first by document path, then by content (phone+timestamp+body)
  // Content dedup handles the case where NotificationService and BackgroundSmsService
  // created separate Firestore documents for the same SMS
  const uniqueMessages = [];
  const seenIds = new Set();
  const seenContent = new Set();

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

    // Pass 2: Content-based dedup - catches dual-writer duplicates where
    // NotificationService and BackgroundSmsService create separate Firestore docs
    // with different timestamps (PDU vs System.currentTimeMillis()) and different
    // sender formats (raw PDU address vs notification-extracted phone/name)
    const rawPhoneSrc = msg.phoneNumber || msg.sender || "";
    // Use normalized phone for numeric numbers, raw for text senders (HSBC, Orange, etc.)
    const phone =
      normalizePhoneNumber(rawPhoneSrc) || rawPhoneSrc.trim().toLowerCase();
    const body = (msg.body || msg.text || "").trim().substring(0, 100);

    // Use 5-minute window since Android dual-writers can have very different timestamps
    const timeWindow = Math.floor((msg.timestamp || 0) / 300000);
    const contentKey = `${phone}_${timeWindow}_${body}`;

    // Also check body-only dedup with wider window for cases where phone format differs
    // between writers (e.g. "+20100xxx" vs "Orange")
    const bodyOnlyWindow = Math.floor((msg.timestamp || 0) / 300000);
    const bodyKey = body.length > 20 ? `body_${bodyOnlyWindow}_${body}` : null;

    if (seenContent.has(contentKey)) continue;
    if (bodyKey && seenContent.has(bodyKey)) continue;
    seenContent.add(contentKey);
    if (bodyKey) seenContent.add(bodyKey);

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

  const smsListElement = document.getElementById("smsList");

  if (!smsListElement) {
    return;
  }

  if (filteredMessages.length === 0) {
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
    const rawPhone = msg.phoneNumber || msg.sender || "";
    const normPhone = rawPhone ? normalizePhoneNumber(rawPhone) : "";
    const contactName =
      msg.contactName || msg.title || getContactName(rawPhone) || "";

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
    let rawPhone = msg.phoneNumber || msg.sender || "";
    let contactName = msg.contactName || msg.title || "";

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
        messageIds: new Set(), // لتتبع IDs المستخدمة
        lastMessage: msg,
        unreadCount: 0,
      };
    }

    // تجنب إضافة نفس الرسالة مرتين
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

  if (conversations.length === 0) {
    smsListElement.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        <p>No unread messages</p>
        <span>All conversations have been read</span>
      </div>
    `;
    updateTabBadges();
    return;
  }

  smsListElement.innerHTML = conversations
    .map(
      (conv) => {
    // Extract a real phone number for hover actions
    let hoverPhone = conv.phoneNumber;
    if (!hoverPhone || hoverPhone.startsWith("contact_") || !isPhoneNumberLike(hoverPhone)) {
      const msgWithPhone = conv.messages.find(m => m.phoneNumber && isPhoneNumberLike(m.phoneNumber));
      hoverPhone = msgWithPhone ? msgWithPhone.phoneNumber : "";
    }
    const showHoverActions = !selectionMode && hoverPhone && isPhoneNumberLike(hoverPhone);
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
        <div class="list-item-subtitle">${escapeHtml((conv.lastMessage.body || "").substring(0, 80))}</div>
        ${conv.lastMessage.deviceName ? `<div class="list-item-device-row"><span class="device-tag">${escapeHtml(conv.lastMessage.deviceName)}</span></div>` : ""}
      </div>
      ${showHoverActions ? `<div class="sms-list-hover-actions">
        <button class="call-list-hover-btn sms-hover-call" title="Call">
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

  smsList2?.addEventListener("click", (e) => {
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
      console.log("[SMS] 📜 Infinite scroll triggered - loading more...");
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

  if (!indicator) {
    const smsContainer = document.getElementById("smsList");
    if (!smsContainer) return;
    indicator = document.createElement("div");
    indicator.id = "smsCountIndicator";
    indicator.className = "sms-count-indicator";
    smsContainer.appendChild(indicator);
  }

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

  let conversation = state.allSMSMessages
    .filter((msg) => {
      const rawPhone = msg.phoneNumber || msg.sender || "";
      let msgNormalized = normalizePhoneNumber(rawPhone);
      // For text senders (HSBC, Orange), use sender_ prefix
      if (!msgNormalized && rawPhone.trim()) {
        msgNormalized = "sender_" + rawPhone.trim().toLowerCase();
      }

      // Also check for contact_* keys
      const contactKey =
        msg.contactName || msg.title
          ? "contact_" + (msg.contactName || msg.title).trim()
          : "";

      const matches =
        msgNormalized === normalizedInput || contactKey === normalizedInput;
      return matches;
    })
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  console.log(`[SMS] showConversation: found ${conversation.length} messages`);

  // إزالة التكرار في المحادثة
  const uniqueConversation = [];
  const seenIds = new Set();
  for (const msg of conversation) {
    if (!seenIds.has(msg.id)) {
      seenIds.add(msg.id);
      uniqueConversation.push(msg);
    }
  }
  conversation = uniqueConversation;

  if (conversation.length === 0) {
    return;
  }

  markConversationAsRead(conversation);

  const contactName =
    conversation.find(m => m.contactName && m.contactName.trim() && !isPhoneNumberLike(m.contactName))?.contactName ||
    conversation.find(m => m.title && m.title.trim() && !isPhoneNumberLike(m.title))?.title ||
    getContactName(conversation.find(m => m.phoneNumber && isPhoneNumberLike(m.phoneNumber))?.phoneNumber || phoneNumber) ||
    (phoneNumber.startsWith("contact_") ? phoneNumber.replace("contact_", "") : null) ||
    conversation[0].phoneNumber ||
    phoneNumber;
  // Extract the real phone number from messages (the key might be contact_Name or sender_Name)
  const realPhoneNumber = conversation.find(m => {
    const p = m.phoneNumber || m.sender || "";
    return p && !p.startsWith("contact_") && !p.startsWith("sender_") && /\d/.test(p);
  });
  const displayPhone = realPhoneNumber ? (realPhoneNumber.phoneNumber || realPhoneNumber.sender || "") : "";
  state.setCurrentConversation(phoneNumber);

  // Update the global delete button to reflect "delete this conversation" context
  const deleteAllBtn = document.getElementById("deleteAllSmsBtn");
  if (deleteAllBtn) {
    deleteAllBtn.title = "Delete this conversation";
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
          <div class="conversation-name sms-expand-btn" title="Open in full window" style="cursor:pointer;text-decoration:underline dotted;">${escapeHtml(contactName)}</div>
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
          <button class="call-action-btn call-action-call" id="smsConvCallBtn" title="Call">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 12.72 19.79 19.79 0 01.15 4.1 2 2 0 012 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
            </svg>
            <span>Call</span>
          </button>
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
        ${conversation
          .map(
            (msg) => `
          <div class="message-bubble ${
            msg.direction === "outgoing" || msg.type === "sent"
              ? "sent"
              : "received"
          }" data-msg-id="${escapeHtml(msg.id)}">
            <div class="message-text">${escapeHtml(msg.body || "")}</div>
            <div class="message-footer">
              <span class="message-time">${formatTime(msg.timestamp)}</span>
              ${
                msg.deviceName
                  ? `<span class="message-device">📱 ${escapeHtml(msg.deviceName)}</span>`
                  : ""
              }
              ${msg.simSlot != null && msg.simSlot >= 0 ? `<span class="sim-badge sim-${msg.simSlot}">${msg.simSlot + 1}</span>` : ""}
              <button class="delete-msg-btn" data-id="${escapeHtml(msg.id)}" title="Delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
      <div class="conversation-input">
        <input type="text" id="conversationMessageInput" placeholder="Type a message..." />
        <button class="send-btn" id="sendConversationSms">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  // Scroll to bottom
  const messagesContainer = document.querySelector(".conversation-messages");
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Infinite scroll - load older messages when scrolling to top
    messagesContainer.addEventListener("scroll", () => {
      if (messagesContainer.scrollTop < 50 && hasMoreSMS() && !isLoadingMore) {
        console.log(
          "[SMS] 📜 Conversation scroll-up triggered - loading more...",
        );
        const previousHeight = messagesContainer.scrollHeight;

        // Show loading at top
        const loader = document.createElement("div");
        loader.className = "scroll-loader";
        loader.id = "convScrollLoader";
        loader.innerHTML =
          '<div class="spinner-small"></div> Loading older messages...';
        if (!document.getElementById("convScrollLoader")) {
          messagesContainer.prepend(loader);
        }

        loadMoreSMS().then(() => {
          document.getElementById("convScrollLoader")?.remove();
          // After loading, re-render the conversation with new messages
          if (
            hasMoreSMS() ||
            state.allSMSMessages.length > conversation.length
          ) {
            // Preserve scroll position after new messages are prepended
            const newHeight = messagesContainer.scrollHeight;
            messagesContainer.scrollTop = newHeight - previousHeight;
          }
        });
      }
    });
  }

  // Add back button handler (also covered by the permanent delegation in initSMSNavigation)
  document.getElementById("backToSMS")?.addEventListener("click", () => {
    _goBackFromConversation();
  });

  // Call button handler in conversation header
  document.getElementById("smsConvCallBtn")?.addEventListener("click", () => {
    const actionsDiv = document.querySelector(".conv-header-actions");
    const phone = actionsDiv?.dataset.actionPhone;
    if (phone) {
      import("./calls.js").then(m => m.initiateDialRequest(phone, null));
    }
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
    convSearch.placeholder = "Search in conversation...";
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

  // Open full window when sender name is clicked
  document.querySelector(".sms-expand-btn")?.addEventListener("click", () => {
    // Store conversation data in chrome.storage.local so the new window can read it
    const payload = {
      smsWindowPhone: displayPhone || phoneNumber,
      smsWindowContact: contactName,
      smsWindowMessages: conversation.map(m => ({
        id: m.id,
        body: m.body || "",
        timestamp: m.timestamp || 0,
        direction: m.direction || "",
        type: m.type || "",
        deviceName: m.deviceName || "",
      })),
    };
    chrome.storage.local.set(payload, () => {
      chrome.windows.create({
        url: chrome.runtime.getURL("popup/sms-window.html"),
        type: "popup",
        width: 800,
        height: 700,
      });
    });
  });

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
      if (await showConfirmDialog(getCurrentLanguage() === "ar" ? "حذف هذه الرسالة؟" : "Delete this message?")) {
        deleteSingleSms(msgId);
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
  const message = inputElement.value.trim();
  if (!message) return;

  const user = state.currentUser;

  // Resolve the actual phone number from the conversation grouping key.
  // The grouping key can be:
  //   - "contact_<name>" for contacts with multiple numbers (strip prefix → still a name!)
  //   - "sender_<name>" for text/shortcode senders like "Orange", "HSBC"
  //   - A normalized numeric string e.g. "0501234567"
  let actualPhoneNumber;

  if (phoneNumber.startsWith("sender_")) {
    // Text/shortcode senders cannot receive SMS replies
    showToast("Cannot send SMS to this type of sender", "error");
    return;
  } else if (phoneNumber.startsWith("contact_")) {
    // Contact grouped by name (has multiple numbers) – look up the real phone from messages
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
      showToast("Cannot determine phone number for this contact", "error");
      return;
    }
  } else {
    // Numeric key – find raw phone from messages to preserve country code format
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
    showToast("No Android device available to send SMS", "error");
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

    // Derive contactName from the conversation key (contact_Name → Name)
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
    showToast("SMS sent!", "success");

    // Listen for status update from Android device
    const unsubStatus = onSnapshot(
      doc(db, "sms_requests", docRef.id),
      (snapshot) => {
        const data = snapshot.data();
        if (!data) return;
        if (data.status === "sent") {
          showToast("SMS delivered to carrier", "success");
          unsubStatus();
        } else if (data.status === "failed") {
          showToast("SMS failed to send from phone", "error");
          unsubStatus();
        }
      },
    );
    // Auto-cleanup after 30 seconds
    setTimeout(() => unsubStatus(), 30000);
  } catch (error) {
    console.error("SMS send error:", error);
    showToast("Failed to send SMS", "error");
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
        const notifRef = doc(
          db,
          "users",
          user.uid,
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

  try {
    const batch = writeBatch(db);
    let count = 0;

    for (const msg of conversation) {
      if (!msg.read && msg.id && msg.deviceId) {
        const notifRef = doc(
          db,
          "users",
          user.uid,
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
      const msgIds = conversation.map((m) => m.id);
      const updatedMessages = state.allSMSMessages.map((msg) =>
        msgIds.includes(msg.id) ? { ...msg, read: true } : msg,
      );
      state.setAllSMSMessages(updatedMessages);

      // Update allSMS state
      Object.keys(state.allSMS).forEach((deviceId) => {
        const updated = state.allSMS[deviceId].map((msg) =>
          msgIds.includes(msg.id) ? { ...msg, read: true } : msg,
        );
        state.setSMSData(deviceId, updated);
      });

      updateTabBadges();
    }
  } catch (error) {
    console.error("Mark conversation read error:", error);
  }
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
      showToast("No messages in this conversation", "info");
      return;
    }

    if (!(await showConfirmDialog(getCurrentLanguage() === "ar"
      ? `حذف هذه المحادثة (${msgsToDelete.length} رسالة)؟`
      : `Delete this conversation (${msgsToDelete.length} message${msgsToDelete.length > 1 ? "s" : ""})?`
    ))) return;

    showLoadingOverlay();
    try {
      const batch = writeBatch(db);
      for (const msg of msgsToDelete) {
        if (msg.docRef) batch.delete(msg.docRef);
      }
      await batch.commit();

      const deletedIds = new Set(msgsToDelete.map((m) => m.id));
      const updatedMessages = state.allSMSMessages.filter((m) => !deletedIds.has(m.id));
      state.setAllSMSMessages(updatedMessages);
      showToast(`${msgsToDelete.length} messages deleted`, "success");
      state.setCurrentConversation(null);
      renderSMS(updatedMessages);
    } catch (error) {
      console.error("Delete conversation error:", error);
      showToast("Failed to delete conversation", "error");
    }
    hideLoading();
    return;
  }

  // On the list view: only act if selection mode is active
  if (selectionMode) {
    return deleteSelectedConversations();
  }

  // Nothing selected and not in a conversation
  showToast("Tap the select button to choose messages to delete", "info");
}

/**
 * Delete single SMS
 * @param {string} msgId - Message ID to delete
 */
async function deleteSingleSms(msgId) {
  const user = state.currentUser;
  if (!user) return;

  const msg = state.allSMSMessages.find((m) => m.id === msgId);
  if (!msg || !msg.docRef) {
    showToast("Message not found", "error");
    return;
  }

  try {
    await deleteDoc(msg.docRef);
    showToast("Message deleted", "success");

    const updatedMessages = state.allSMSMessages.filter((m) => m.id !== msgId);
    state.setAllSMSMessages(updatedMessages);

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
    showToast("Failed to delete message", "error");
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
  const count = selectedMessages.size;
  if (!(await showConfirmDialog(getCurrentLanguage() === "ar"
    ? `حذف ${count} رسالة؟`
    : `Delete ${count} message${count > 1 ? "s" : ""}?`
  ))) return;
  showLoadingOverlay();
  try {
    const msgsToDelete = state.allSMSMessages.filter((m) => selectedMessages.has(m.id));
    const batch = writeBatch(db);
    let deletedCount = 0;
    for (const msg of msgsToDelete) {
      if (msg.docRef) {
        batch.delete(msg.docRef);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      await batch.commit();
      showToast(`${deletedCount} message${deletedCount > 1 ? "s" : ""} deleted`, "success");
      const deletedIds = new Set(msgsToDelete.map((m) => m.id));
      const updatedMessages = state.allSMSMessages.filter((m) => !deletedIds.has(m.id));
      state.setAllSMSMessages(updatedMessages);
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

  const count = selectedConversations.size;
  if (!(await showConfirmDialog(getCurrentLanguage() === "ar"
    ? `حذف ${count} محادثة؟ سيتم حذف جميع رسائلها.`
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
      if (msg.docRef) {
        batch.delete(msg.docRef);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      await batch.commit();
      showToast(`${deletedCount} messages deleted`, "success");

      const deletedIds = new Set(msgsToDelete.map((m) => m.id));
      const updatedMessages = state.allSMSMessages.filter((m) => !deletedIds.has(m.id));
      state.setAllSMSMessages(updatedMessages);
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
    showToast("Failed to delete selected conversations", "error");
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
  let messages = state.allSMSMessages || [];
  let filename = `iRopit-SMS-${new Date().toISOString().slice(0, 10)}.csv`;

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
    filename = `iRopit-SMS-${contactName}-${new Date().toISOString().slice(0, 10)}.csv`;
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
    const device = m.deviceName || "";
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
