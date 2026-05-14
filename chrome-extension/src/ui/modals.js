/**
 * Modals Module
 * Handles SMS modal and other modal functionality
 */

import {
  smsModal,
  newSmsBtn,
  closeSmsModal,
  cancelSmsBtn,
  sendSmsBtn,
  smsDevice,
  smsPhone,
  smsMessage,
  charCount,
  callModal,
  newCallBtn,
  closeCallModal,
  cancelCallBtn,
  sendCallBtn,
  callDevice,
  callPhone,
} from "./dom.js";

import { db, collection, addDoc } from "../config/firebase.js";
import { showToast, showLoadingOverlay, hideLoading } from "./toasts.js";
import { getDeviceId, escapeHtml } from "../utils/helpers.js";
import * as state from "../state/index.js";
import { renderSMS } from "../services/sms.js";
import { loadContactsForDevice, searchContacts } from "../services/contacts.js";

// Store loaded contacts
let deviceContacts = [];
let isContactsLoading = false;
let lastContactsDeviceId = null;
let lastContactsLoadedAt = 0;

/**
 * Refresh contacts for the selected device
 * @param {boolean} force - Force reload even if recently loaded
 */
async function refreshContactsForSelectedDevice(force = false) {
  const deviceId = smsDevice?.value;
  if (!deviceId) return;

  // Look up DOM elements by ID — this function lives outside initSmsModal so
  // it cannot rely on closures; getElementById is the safe cross-scope approach.
  const contactsGroup  = document.getElementById("contactsGroup");
  const contactsSearch = document.getElementById("contactsSearch");
  const phoneHint      = document.getElementById("phoneHint");

  const isRecentLoad =
    lastContactsDeviceId === deviceId &&
    Date.now() - lastContactsLoadedAt < 3000;

  if (!force && isRecentLoad) return;

  // Show contacts group
  if (contactsGroup) contactsGroup.style.display = "block";
  if (phoneHint) phoneHint.style.display = "block";

  // Clear previous data
  if (contactsSearch) contactsSearch.value = "";
  deviceContacts = [];
  renderContacts([]);

  // Use the live in-memory contacts (kept fresh by the real-time subscription)
  // so the modal always shows the same data as the rest of the extension.
  // Fall back to a direct Firestore query only when state cache is empty.
  isContactsLoading = true;
  if (contactsSearch) contactsSearch.placeholder = "⏳ Loading contacts...";

  const cached = state.allContacts?.[deviceId];
  deviceContacts = (cached && cached.length > 0)
    ? cached
    : await loadContactsForDevice(deviceId);

  isContactsLoading = false;
  lastContactsDeviceId = deviceId;
  lastContactsLoadedAt = Date.now();

  if (deviceContacts.length > 0) {
    if (contactsSearch) contactsSearch.placeholder = `Search ${deviceContacts.length} contacts...`;
    renderContacts(deviceContacts);
  } else {
    if (contactsSearch) contactsSearch.placeholder = "No contacts found";
  }
}

/**
 * Initialize SMS modal event listeners
 */
export function initSmsModal() {
  const contactsGroup = document.getElementById("contactsGroup");
  const contactsDropdown = document.getElementById("contactsDropdown");
  const contactsSearch = document.getElementById("contactsSearch");
  const contactsList = document.getElementById("contactsList");
  const phoneHint = document.getElementById("phoneHint");

  newSmsBtn?.addEventListener("click", () => {
    smsModal.classList.remove("hidden");
    // Reset contacts group visibility based on device selection
    if (smsDevice.value) {
      contactsGroup.style.display = "block";
      phoneHint.style.display = "block";
      refreshContactsForSelectedDevice(true);
    }
  });

  closeSmsModal?.addEventListener("click", () => {
    smsModal.classList.add("hidden");
    contactsDropdown?.classList.add("hidden");
    resetContactsUI();
  });

  cancelSmsBtn?.addEventListener("click", () => {
    smsModal.classList.add("hidden");
    contactsDropdown?.classList.add("hidden");
    resetContactsUI();
  });

  smsMessage?.addEventListener("input", () => {
    charCount.textContent = smsMessage.value.length;
  });

  sendSmsBtn?.addEventListener("click", sendNewSms);

  // When device changes, load its contacts and show contacts group
  smsDevice?.addEventListener("change", async () => {
    const deviceId = smsDevice.value;

    if (deviceId) {
      await refreshContactsForSelectedDevice(true);
      console.log(
        `[Modal] Loaded ${deviceContacts.length} contacts for device`,
      );
    } else {
      // Hide contacts group
      contactsGroup.style.display = "none";
      phoneHint.style.display = "none";
      deviceContacts = [];
      renderContacts([]);
    }
  });

  // Refresh contacts when user focuses the search input
  contactsSearch?.addEventListener("focus", () => {
    refreshContactsForSelectedDevice();
  });

  contactsSearch?.addEventListener("click", () => {
    refreshContactsForSelectedDevice();
  });

  // Search contacts - show dropdown on focus/input
  contactsSearch?.addEventListener("focus", () => {
    if (deviceContacts.length > 0 && !isContactsLoading) {
      contactsDropdown?.classList.remove("hidden");
    }
  });

  contactsSearch?.addEventListener("input", () => {
    const term = contactsSearch.value;
    const filtered = searchContacts(deviceContacts, term);
    renderContacts(filtered);

    if (filtered.length > 0) {
      contactsDropdown?.classList.remove("hidden");
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (
      !e.target.closest(".contacts-select-wrapper") &&
      !e.target.closest("#contactsSearch")
    ) {
      contactsDropdown?.classList.add("hidden");
    }
  });
}

/**
 * Reset contacts UI
 */
function resetContactsUI() {
  const contactsGroup = document.getElementById("contactsGroup");
  const contactsSearch = document.getElementById("contactsSearch");
  const phoneHint = document.getElementById("phoneHint");

  if (contactsGroup) contactsGroup.style.display = "none";
  if (contactsSearch) {
    contactsSearch.value = "";
    contactsSearch.placeholder = "Search contacts by name or number...";
  }
  if (phoneHint) phoneHint.style.display = "none";
  deviceContacts = [];
}

/**
 * Render contacts list
 */
function renderContacts(contacts) {
  const contactsList = document.getElementById("contactsList");
  if (!contactsList) return;

  if (contacts.length === 0) {
    contactsList.innerHTML = '<div class="no-contacts">No contacts found</div>';
    return;
  }

  // Expand contacts with multiple phone numbers into one row per number
  const rows = [];
  contacts.forEach((contact) => {
    const phones =
      contact.phoneNumbers && contact.phoneNumbers.length > 0
        ? contact.phoneNumbers
        : [contact.phoneNumber];
    const uniquePhones = [...new Set(phones.filter(Boolean))];
    uniquePhones.forEach((phone) => {
      rows.push({ contact, phone });
    });
  });

  contactsList.innerHTML = rows
    .map(
      ({ contact, phone }) => `
    <div class="contact-item" data-phone="${escapeHtml(phone)}" data-name="${escapeHtml(contact.name)}">
      <div class="contact-avatar">${getInitials(contact.name)}</div>
      <div class="contact-info">
        <div class="contact-name">${escapeHtml(contact.name)}</div>
        <div class="contact-phone">${escapeHtml(phone)}</div>
      </div>
    </div>
  `,
    )
    .join("");

  // Add click handlers
  contactsList.querySelectorAll(".contact-item").forEach((item) => {
    item.addEventListener("click", () => {
      const phone = item.dataset.phone;
      const name = item.dataset.name;
      smsPhone.value = phone;

      // Update search field with selected contact
      const contactsSearch = document.getElementById("contactsSearch");
      if (contactsSearch) {
        contactsSearch.value = `${name} (${phone})`;
      }

      document.getElementById("contactsDropdown")?.classList.add("hidden");
    });
  });
}

/**
 * Get initials from name
 */
function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// escapeHtml is now imported from ../utils/helpers.js

/**
 * Send new SMS from modal
 */
async function sendNewSms() {
  const user = state.currentUser;
  const deviceId = smsDevice.value;
  const phone = smsPhone.value.trim();
  const message = smsMessage.value.trim();

  if (!deviceId) {
    showToast("Please select a device", "error");
    return;
  }

  if (!phone) {
    showToast("Please enter a phone number", "error");
    return;
  }

  if (!message) {
    showToast("Please enter a message", "error");
    return;
  }

  showLoadingOverlay();

  try {
    const timestamp = Date.now();
    const selectedDevice = state.devices.find((d) => d.id === deviceId);
    const deviceName =
      selectedDevice?.nickname || selectedDevice?.name || "Android";

    // Create SMS request for the mobile device to process
    const docRef = await addDoc(collection(db, "sms_requests"), {
      userId: user.uid,
      fromDeviceId: await getDeviceId(),
      toDeviceId: deviceId,
      phoneNumber: phone,
      message: message,
      status: "pending",
      timestamp: timestamp,
    });

    // Add to local SMS list
    const newSmsMessage = {
      id: docRef.id,
      phoneNumber: phone,
      body: message,
      type: "sent",
      direction: "outgoing",
      timestamp: timestamp,
      read: true,
      deviceId: deviceId,
      deviceName: deviceName,
    };

    // Update per-device dict (so the message appears in the conversation view)
    const currentDeviceSMS = state.getSMSData(deviceId) || [];
    state.setSMSData(deviceId, [...currentDeviceSMS, newSmsMessage]);

    const updatedMessages = [...state.allSMSMessages, newSmsMessage];
    state.setAllSMSMessages(updatedMessages);
    renderSMS(updatedMessages);

    showToast("SMS request sent to device", "success");
    smsModal.classList.add("hidden");
    smsPhone.value = "";
    smsMessage.value = "";
    charCount.textContent = "0";
  } catch (error) {
    showToast("Failed to send SMS request", "error");
  }

  hideLoading();
}

/**
 * Initialize Call modal event listeners
 */
export function initCallModal() {
  const contactsGroup = document.getElementById("callContactsGroup");
  const contactsDropdown = document.getElementById("callContactsDropdown");
  const contactsSearch = document.getElementById("callContactsSearch");
  const contactsList = document.getElementById("callContactsList");
  const phoneHint = document.getElementById("callPhoneHint");

  // Local state for call modal contacts
  let callDeviceContacts = [];
  let isCallContactsLoading = false;
  let lastCallContactsDeviceId = null;
  let lastCallContactsLoadedAt = 0;

  async function refreshCallContacts(force = false) {
    const deviceId = callDevice?.value;
    if (!deviceId) return;

    const isRecent =
      lastCallContactsDeviceId === deviceId &&
      Date.now() - lastCallContactsLoadedAt < 3000;
    if (!force && isRecent) return;

    contactsGroup.style.display = "block";
    phoneHint.style.display = "block";
    contactsSearch.value = "";
    callDeviceContacts = [];
    renderCallContacts([]);

    isCallContactsLoading = true;
    contactsSearch.placeholder = "⏳ Loading contacts...";

    callDeviceContacts = await loadContactsForDevice(deviceId);

    isCallContactsLoading = false;
    lastCallContactsDeviceId = deviceId;
    lastCallContactsLoadedAt = Date.now();

    if (callDeviceContacts.length > 0) {
      contactsSearch.placeholder = `Search ${callDeviceContacts.length} contacts...`;
      renderCallContacts(callDeviceContacts);
    } else {
      contactsSearch.placeholder = "No contacts found";
    }
  }

  function renderCallContacts(contacts) {
    if (!contactsList) return;
    if (contacts.length === 0) {
      contactsList.innerHTML = '<div class="no-contacts">No contacts found</div>';
      return;
    }
    const rows = [];
    contacts.forEach((contact) => {
      const phones =
        contact.phoneNumbers && contact.phoneNumbers.length > 0
          ? contact.phoneNumbers
          : [contact.phoneNumber];
      const uniquePhones = [...new Set(phones.filter(Boolean))];
      uniquePhones.forEach((phone) => rows.push({ contact, phone }));
    });
    contactsList.innerHTML = rows
      .map(
        ({ contact, phone }) => `
      <div class="contact-item" data-phone="${escapeHtml(phone)}" data-name="${escapeHtml(contact.name)}">
        <div class="contact-avatar">${getInitials(contact.name)}</div>
        <div class="contact-info">
          <div class="contact-name">${escapeHtml(contact.name)}</div>
          <div class="contact-phone">${escapeHtml(phone)}</div>
        </div>
      </div>
    `,
      )
      .join("");
    contactsList.querySelectorAll(".contact-item").forEach((item) => {
      item.addEventListener("click", () => {
        const phone = item.dataset.phone;
        const name = item.dataset.name;
        if (callPhone) callPhone.value = phone;
        if (contactsSearch) contactsSearch.value = `${name} (${phone})`;
        contactsDropdown?.classList.add("hidden");
      });
    });
  }

  function resetCallContactsUI() {
    if (contactsGroup) contactsGroup.style.display = "none";
    if (contactsSearch) {
      contactsSearch.value = "";
      contactsSearch.placeholder = "Search contacts by name or number...";
    }
    if (phoneHint) phoneHint.style.display = "none";
    callDeviceContacts = [];
  }

  function closeModal() {
    callModal?.classList.add("hidden");
    contactsDropdown?.classList.add("hidden");
    resetCallContactsUI();
  }

  newCallBtn?.addEventListener("click", () => {
    callModal?.classList.remove("hidden");
    if (callDevice?.value) {
      contactsGroup.style.display = "block";
      phoneHint.style.display = "block";
      refreshCallContacts(true);
    }
  });

  closeCallModal?.addEventListener("click", closeModal);
  cancelCallBtn?.addEventListener("click", closeModal);

  callDevice?.addEventListener("change", async () => {
    if (callDevice.value) {
      await refreshCallContacts(true);
    } else {
      contactsGroup.style.display = "none";
      phoneHint.style.display = "none";
      callDeviceContacts = [];
      renderCallContacts([]);
    }
  });

  contactsSearch?.addEventListener("focus", () => refreshCallContacts());
  contactsSearch?.addEventListener("click", () => refreshCallContacts());
  contactsSearch?.addEventListener("focus", () => {
    if (callDeviceContacts.length > 0 && !isCallContactsLoading) {
      contactsDropdown?.classList.remove("hidden");
    }
  });
  contactsSearch?.addEventListener("input", () => {
    const filtered = searchContacts(callDeviceContacts, contactsSearch.value);
    renderCallContacts(filtered);
    if (filtered.length > 0) contactsDropdown?.classList.remove("hidden");
  });

  document.addEventListener("click", (e) => {
    if (
      !e.target.closest("#callContactsGroup") &&
      !e.target.closest("#callContactsSearch")
    ) {
      contactsDropdown?.classList.add("hidden");
    }
  });

  sendCallBtn?.addEventListener("click", async () => {
    const user = state.currentUser;
    const deviceId = callDevice?.value;
    const phone = callPhone?.value.trim();

    if (!deviceId) {
      showToast("Please select a device", "error");
      return;
    }
    if (!phone) {
      showToast("Please enter a phone number", "error");
      return;
    }

    showLoadingOverlay();
    try {
      await addDoc(collection(db, "call_requests"), {
        userId: user.uid,
        fromDeviceId: await getDeviceId(),
        toDeviceId: deviceId,
        phoneNumber: phone,
        status: "pending",
        timestamp: Date.now(),
      });

      showToast("Call request sent to device", "success");
      closeModal();
      if (callPhone) callPhone.value = "";
    } catch (error) {
      showToast("Failed to send call request", "error");
    }
    hideLoading();
  });
}

/**
 * Initialize profile footer toggle
 */
export function initProfileFooter() {
  // Always read version from the installed manifest so it's always current
  const manifest = chrome.runtime.getManifest();
  const versionStr = `v${manifest.version}`;
  const versionEl = document.getElementById("extensionVersion");
  if (versionEl) versionEl.textContent = versionStr;
  document.querySelectorAll(".settings-version").forEach((el) => {
    el.textContent = `iRopit ${versionStr}`;
  });

  const toggleProfileBtn = document.getElementById("toggleProfileBtn");
  const profileFooter = document.getElementById("profileFooter");

  if (toggleProfileBtn && profileFooter) {
    toggleProfileBtn.addEventListener("click", () => {
      profileFooter.classList.toggle("collapsed");
      const isCollapsed = profileFooter.classList.contains("collapsed");
      localStorage.setItem("profileCollapsed", isCollapsed);
    });

    // Restore state on load
    const isCollapsed = localStorage.getItem("profileCollapsed") === "true";
    if (isCollapsed) {
      profileFooter.classList.add("collapsed");
    }
  }
}
