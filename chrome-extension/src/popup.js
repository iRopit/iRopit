import "./config/firebase.js";

import * as state from "./state/index.js";

import {
  smsList,
  callsList,
  notificationsList,
  markAllReadBtn,
  deleteAllSmsBtn,
} from "./ui/dom.js";
import { showToast, showListLoading, showLoadingOverlay } from "./ui/toasts.js";
import { initTabs } from "./ui/tabs.js";
import { initSmsModal, initCallModal, initProfileFooter } from "./ui/modals.js";
import { initNavigation } from "./ui/navigation.js";

// Import services
import { initAuthObserver, initAuthListeners } from "./services/auth.js";
import { registerDevice, loadDevices } from "./services/devices.js";
import {
  loadSMS,
  renderSMS,
  markAllSmsAsRead,
  toggleSelectionMode,
  setSelectAll,
  deleteSelectedConversations,
  exportSMSToCSV,
  startPolling,
  stopPolling,
  stopSMSListener,
  initSMSNavigation,
} from "./services/sms.js";
import { loadCalls, exportCallsToCSV, markAllCallsAsViewed, toggleCallsSelectionMode, setCallsSelectAll, deleteSelectedCallGroups } from "./services/calls.js";
import { loadNotifications, exportNotificationsToCSV, markAllNotificationsAsRead, toggleNotifSelectionMode, setNotifSelectAll, deleteSelectedNotifications } from "./services/notifications.js";
import { subscribeToChat, initChatListeners } from "./services/chat.js";
import {
  loadUserSettings,
  initSettingsListeners,
} from "./services/settings.js";
import { loadAllContacts } from "./services/contacts.js";
import { initTheme } from "./services/theme.js";
import { clearCache } from "./services/cache.js";

// Import utilities
import { applyTranslations } from "./utils/i18n.js";

/**
 * Wait for devices to load, then load contacts
 * This ensures contacts resolution has device data available
 */
async function loadDevicesAndContacts() {
  // Wait until devices are available (max 5 seconds)
  let attempts = 0;
  while (state.devices.length === 0 && attempts < 50) {
    await new Promise((r) => setTimeout(r, 100));
    attempts++;
  }
  await loadAllContacts();
}

function loadData() {
  cleanupSubscriptions();

  // Load SMS and Calls IMMEDIATELY - cache shows instantly, Firebase refreshes in background
  loadSMS();
  loadCalls();

  // Load devices first, then contacts (contacts need devices to be loaded)
  loadDevices();
  loadDevicesAndContacts();

  loadNotifications();
  loadUserSettings();
  subscribeToChat();
}

function cleanupSubscriptions() {
  state.clearUnsubscribers();
  stopPolling();
  stopSMSListener();
  // Don't clear SMS/calls data here - loadSMS/loadCalls will show cached data first
  // state.clearAllSMS(); // Removed to preserve cache
  state.clearAllNotifications();
  state.setDevices([]);
}

function setupServiceWorkerListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "newNotification") {
      const notification = message.data;
      console.log(
        "📨 New notification received in popup:",
        notification.type,
        notification.title,
      );

      // Reload notifications list
      loadNotifications();

      // Note: SMS updates are handled by real-time listener in sms.js
      // No need to call loadSMS() here as it would cause duplicate processing
      if (notification.type === "sms") {
        console.log(
          "📱 SMS notification - real-time listener will handle UI update",
        );
      }
    }

    sendResponse({ received: true });
    return true;
  });
}

/**
 * Initialize the extension
 */
function init() {
  // Show loading overlay while checking auth
  showLoadingOverlay();

  // Initialize theme (before any rendering)
  initTheme();

  // Apply translations
  applyTranslations();

  // Initialize UI
  initTabs();
  initSmsModal();
  initCallModal();
  initProfileFooter();
  initChatListeners();
  initSettingsListeners();
  initAuthListeners();
  initNavigation();
  initSMSNavigation();

  // Setup service worker listener
  setupServiceWorkerListener();

  // Initialize auth observer
  initAuthObserver(
    // On login
    async (user) => {
      // Register device first so loadDevices snapshot sees it
      await registerDevice().catch((err) =>
        console.error("[Popup] registerDevice error:", err),
      );
      loadData();
    },
    // On logout
    () => {
      cleanupSubscriptions();
      state.resetState();
      clearCache(); // Clear local cache on logout
    },
  );

  // Action buttons
  markAllReadBtn?.addEventListener("click", markAllSmsAsRead);
  deleteAllSmsBtn?.addEventListener("click", deleteSelectedConversations);

  // SMS selection mode buttons
  document.getElementById("smsSelectBtn")?.addEventListener("click", toggleSelectionMode);
  document.getElementById("smsSelectAll")?.addEventListener("change", (e) => setSelectAll(e.target.checked));
  // Export buttons
  document.getElementById("exportSmsBtn")?.addEventListener("click", exportSMSToCSV);
  document.getElementById("exportCallsBtn")?.addEventListener("click", exportCallsToCSV);
  document.getElementById("exportNotifBtn")?.addEventListener("click", exportNotificationsToCSV);

  // Calls selection mode buttons
  document.getElementById("callsSelectBtn")?.addEventListener("click", toggleCallsSelectionMode);
  document.getElementById("callsSelectAll")?.addEventListener("change", (e) => setCallsSelectAll(e.target.checked));
  document.getElementById("markAllCallsViewedBtn")?.addEventListener("click", markAllCallsAsViewed);
  document.getElementById("deleteAllCallsBtn")?.addEventListener("click", deleteSelectedCallGroups);

  // Notifications selection mode buttons
  document.getElementById("notifSelectBtn")?.addEventListener("click", toggleNotifSelectionMode);
  document.getElementById("notifSelectAll")?.addEventListener("change", (e) => setNotifSelectAll(e.target.checked));
  document.getElementById("markAllNotifReadBtn")?.addEventListener("click", markAllNotificationsAsRead);
  document.getElementById("deleteAllNotifBtn")?.addEventListener("click", deleteSelectedNotifications);

  // Refresh button
  document.getElementById("refreshBtn")?.addEventListener("click", () => {
    showToast("Refreshing...", "info");
    loadData();
  });
}

// Start the extension
init();

// Clean up Firestore listeners when popup closes to avoid WebChannel transport errors
window.addEventListener("pagehide", () => {
  cleanupSubscriptions();
});
