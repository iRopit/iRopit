/**
 * Contacts Service
 * Handles fetching contacts from Firebase for each device
 */

import {
  db,
  collection,
  getDocs,
  query,
  orderBy,
  onSnapshot,
} from "../config/firebase.js";
import * as state from "../state/index.js";

// Store unsubscribe functions for contacts listeners
let contactsUnsubscribeFunctions = [];
const CONTACTS_PHONE_MAP_CACHE_KEY = "contactsPhoneMapCache_v1";

function sanitizePhoneMap(map) {
  if (!map || typeof map !== "object") return {};
  const cleaned = {};
  Object.entries(map).forEach(([phone, name]) => {
    if (!phone || typeof phone !== "string") return;
    if (!name || typeof name !== "string") return;
    const normalized = normalizePhoneNumber(phone);
    const trimmedName = name.trim();
    if (!normalized || !trimmedName) return;
    if (!cleaned[normalized]) cleaned[normalized] = trimmedName;
  });
  return cleaned;
}

async function persistPhoneMap(phoneMap) {
  try {
    if (!chrome?.storage?.local) return;
    await new Promise((resolve) => {
      chrome.storage.local.set({ [CONTACTS_PHONE_MAP_CACHE_KEY]: phoneMap }, resolve);
    });
  } catch (_) {}
}

export async function hydrateCachedContactsMap() {
  try {
    if (!chrome?.storage?.local) return;
    if (state.phoneToContactMap && Object.keys(state.phoneToContactMap).length > 0) return;

    const result = await new Promise((resolve) => {
      chrome.storage.local.get([CONTACTS_PHONE_MAP_CACHE_KEY], resolve);
    });
    const cachedMap = sanitizePhoneMap(result?.[CONTACTS_PHONE_MAP_CACHE_KEY]);
    if (Object.keys(cachedMap).length === 0) return;

    state.setPhoneToContactMap(cachedMap);
    console.log(`[Contacts] Hydrated cached phone map: ${Object.keys(cachedMap).length} entries`);
  } catch (_) {}
}

/**
 * Normalize phone number for matching
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

/**
 * Load contacts for a specific device from Firebase
 * @param {string} deviceId - The device ID to load contacts for
 * @returns {Promise<Array>} Array of contacts
 */
export async function loadContactsForDevice(deviceId) {
  const user = state.currentUser;
  if (!user || !deviceId) {
    console.log("[Contacts] No user or device ID");
    return [];
  }

  try {
    const contactsRef = collection(
      db,
      "users",
      user.uid,
      "devices",
      deviceId,
      "contacts",
    );

    const q = query(contactsRef, orderBy("name", "asc"));
    const snapshot = await getDocs(q);

    const contacts = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      contacts.push({
        id: doc.id,
        name: data.name || "Unknown",
        phoneNumber: data.phoneNumber || "",
        phoneNumbers: data.phoneNumbers || [data.phoneNumber],
      });
    });

    console.log(
      `[Contacts] Loaded ${contacts.length} contacts for device ${deviceId}`,
    );
    return contacts;
  } catch (error) {
    if (error?.code === "permission-denied") return [];
    console.error("[Contacts] Error loading contacts:", error);
    return [];
  }
}

/**
 * Get all contacts for all devices and build phone-to-contact map
 * Uses real-time listeners so contacts update automatically when synced from phone
 * @returns {Promise<Object>} Object with deviceId as key and contacts array as value
 */
export async function loadAllContacts() {
  const user = state.currentUser;
  if (!user) return {};

  // Warm contact resolution from local cache so calls/SMS render with names
  // immediately while Firestore contacts are loading.
  await hydrateCachedContactsMap();

  // Stop any previous listeners
  stopContactsListeners();

  const allContacts = {};
  const phoneMap = {};

  for (const device of state.devices) {
    if (
      device.platform !== "chrome" &&
      device.platform !== "chrome-extension"
    ) {
      // Initial load
      const contacts = await loadContactsForDevice(device.id);
      if (contacts.length > 0) {
        allContacts[device.id] = contacts;
        contacts.forEach((contact) => {
          const phones = contact.phoneNumbers || [contact.phoneNumber];
          phones.forEach((phone) => {
            if (phone) {
              const normalizedPhone = normalizePhoneNumber(phone);
              if (normalizedPhone && !phoneMap[normalizedPhone]) {
                phoneMap[normalizedPhone] = contact.name;
              }
            }
          });
        });
      }

      // Set up real-time listener for this device's contacts
      const contactsRef = collection(
        db,
        "users",
        user.uid,
        "devices",
        device.id,
        "contacts",
      );
      const q = query(contactsRef, orderBy("name", "asc"));

      const unsub = onSnapshot(
        q,
        (snapshot) => {
          if (snapshot.empty) return;

          const updatedContacts = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            updatedContacts.push({
              id: docSnap.id,
              name: data.name || "Unknown",
              phoneNumber: data.phoneNumber || "",
              phoneNumbers: data.phoneNumbers || [data.phoneNumber],
            });
          });

          console.log(
            `[Contacts] Real-time update: ${updatedContacts.length} contacts for device ${device.id}`,
          );

          // Update this device's contacts in state
          const currentAllContacts = { ...state.allContacts };
          currentAllContacts[device.id] = updatedContacts;
          state.setAllContacts(currentAllContacts);

          // Rebuild entire phone map from all devices
          const newPhoneMap = {};
          Object.values(currentAllContacts).forEach((deviceContacts) => {
            deviceContacts.forEach((contact) => {
              const phones = contact.phoneNumbers || [contact.phoneNumber];
              phones.forEach((phone) => {
                if (phone) {
                  const normalized = normalizePhoneNumber(phone);
                  if (normalized && !newPhoneMap[normalized]) {
                    newPhoneMap[normalized] = contact.name;
                  }
                }
              });
            });
          });
          state.setPhoneToContactMap(newPhoneMap);
          persistPhoneMap(newPhoneMap).catch(() => {});
          console.log(
            `[Contacts] Updated phone map: ${Object.keys(newPhoneMap).length} entries`,
          );
          // Re-render calls with fresh contact names if calls are loaded
          if (state.allCallsData && state.allCallsData.length > 0) {
            import("./calls.js").then(({ renderCalls }) => {
              renderCalls(state.allCallsData);
            }).catch(() => {});
          }
        },
        (error) => {
          if (error?.code === "permission-denied") return;
          console.error(
            `[Contacts] Listener error for device ${device.id}:`,
            error,
          );
        },
      );

      contactsUnsubscribeFunctions.push(unsub);
    }
  }

  // Update state
  state.setAllContacts(allContacts);
  state.setPhoneToContactMap(phoneMap);
  persistPhoneMap(phoneMap).catch(() => {});

  console.log(
    `[Contacts] Loaded contacts from ${Object.keys(allContacts).length} devices`,
  );
  console.log(
    `[Contacts] Built phone map with ${Object.keys(phoneMap).length} entries`,
  );

  return allContacts;
}

/**
 * Stop all contacts real-time listeners
 */
export function stopContactsListeners() {
  contactsUnsubscribeFunctions.forEach((unsub) => unsub());
  contactsUnsubscribeFunctions = [];
}

/**
 * Get contact name from phone number using cached map
 * @param {string} phoneNumber - Phone number to lookup
 * @returns {string} Contact name or empty string
 */
export function getContactName(phoneNumber) {
  if (!phoneNumber) return "";
  const normalized = normalizePhoneNumber(phoneNumber);
  return state.phoneToContactMap[normalized] || "";
}

/**
 * Search contacts by name or phone number
 * @param {Array} contacts - Array of contacts to search
 * @param {string} searchTerm - Search term
 * @returns {Array} Filtered contacts
 */
export function searchContacts(contacts, searchTerm) {
  if (!searchTerm || !contacts) return contacts;

  const term = searchTerm.toLowerCase();
  return contacts.filter(
    (contact) =>
      contact.name.toLowerCase().includes(term) ||
      contact.phoneNumber.includes(term) ||
      (contact.phoneNumbers &&
        contact.phoneNumbers.some((p) => p.includes(term))),
  );
}
