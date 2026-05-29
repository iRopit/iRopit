/**
 * Application State Management
 * Centralized state for the extension
 */

// Current authenticated user
export let currentUser = null;

// List of connected devices
export let devices = [];

// Firebase subscription unsubscribers
export let unsubscribers = [];

// Polling interval for real-time updates
export let pollingInterval = null;

// SMS Data
export let allSMS = {};
export let allSMSMessages = [];
export let currentConversation = null;

// Calls Data
export let allCallsData = [];
export let allCallsByDevice = {};
export let currentCallConversation = null;
// True once first Firestore calls update arrives; prevents stale-cache badge flash
export let callsDataConfirmed = false;

// Notifications Data
export let allNotifications = {};
export let allNotificationsMessages = []; // flat merged array, set atomically once all snapshots complete

// Chat Data
export let cachedChatMessages = [];
export let currentReplyTo = null;

// Contacts Data - cached contacts from all devices
export let allContacts = {}; // { deviceId: [contacts] }
export let phoneToContactMap = {}; // { normalizedPhone: contactName }

// Per-device sync preferences { [deviceId]: { sms: bool, calls: bool, notifications: bool } }
// Default (key absent) = all enabled
export let deviceSyncPrefs = {};

// Devices shared WITH the current user by other accounts
// Each entry: { shareId, ownerUid, ownerEmail, deviceId, deviceDocId, deviceName, permissions, device }
export let sharedWithMeDevices = [];

// State setters
export function setCurrentUser(user) {
  currentUser = user;
}

export function setDevices(newDevices) {
  devices = newDevices;
}

export function addDevice(device) {
  devices.push(device);
}

export function removeDevice(docId) {
  devices = devices.filter((d) => d.docId !== docId);
}

export function updateDevice(docId, updates) {
  const index = devices.findIndex((d) => d.docId === docId);
  if (index !== -1) {
    devices[index] = { ...devices[index], ...updates };
  }
}

export function addUnsubscriber(unsub) {
  unsubscribers.push(unsub);
}

export function clearUnsubscribers() {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];
}

export function setPollingInterval(interval) {
  pollingInterval = interval;
}

export function clearPollingInterval() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

export function setSMSData(deviceId, messages) {
  allSMS[deviceId] = messages;
}

export function getSMSData(deviceId) {
  return allSMS[deviceId];
}

export function clearAllSMS() {
  allSMS = {};
}

export function setAllSMSMessages(messages) {
  allSMSMessages = messages;
}

export function setCurrentConversation(conversation) {
  currentConversation = conversation;
}

export function setAllCallsData(calls) {
  allCallsData = calls;
}

export function setCallsByDevice(deviceId, calls) {
  allCallsByDevice[deviceId] = calls;
}

export function setCallsDataConfirmed(confirmed) {
  callsDataConfirmed = confirmed;
}

export function setCurrentCallConversation(conversation) {
  currentCallConversation = conversation;
}

export function setNotificationsData(deviceId, notifications) {
  allNotifications[deviceId] = notifications;
}

export function setAllNotificationsMessages(messages) {
  allNotificationsMessages = messages;
}

export function clearAllNotifications() {
  allNotifications = {};
}

export function setCachedChatMessages(messages) {
  cachedChatMessages = messages;
}

export function setCurrentReplyTo(reply) {
  currentReplyTo = reply;
}

export function setAllContacts(contacts) {
  allContacts = contacts;
}

export function setPhoneToContactMap(map) {
  phoneToContactMap = map;
}

export function setDeviceSyncPrefs(prefs) {
  deviceSyncPrefs = prefs || {};
}

export function setSharedWithMeDevices(list) {
  sharedWithMeDevices = list || [];
}

/**
 * Returns true if the given sync type is enabled for a device.
 * Defaults to true when no preference has been set (backward-compatible).
 */
export function getDeviceSyncPref(deviceId, type) {
  if (!deviceId) return true;
  return deviceSyncPrefs[deviceId]?.[type] !== false;
}

/**
 * Reset all state (on logout)
 */
export function resetState() {
  currentUser = null;
  devices = [];
  clearUnsubscribers();
  clearPollingInterval();
  allSMS = {};
  allSMSMessages = [];
  currentConversation = null;
  allCallsData = [];
  currentCallConversation = null;
  allNotifications = {};
  allNotificationsMessages = [];
  cachedChatMessages = [];
  currentReplyTo = null;
  allContacts = {};
  phoneToContactMap = {};
  deviceSyncPrefs = {};
  sharedWithMeDevices = [];
}
