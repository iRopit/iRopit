import "./config/firebase.js";

// Globally swallow Firestore permission-denied errors during sign-out.
window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  if (
    reason?.code === "permission-denied" ||
    /Missing or insufficient permissions/i.test(reason?.message || "")
  ) {
    event.preventDefault();
  }
});

import * as state from "./state/index.js";

import {
  smsList,
  callsList,
  notificationsList,
  markAllReadBtn,
  deleteAllSmsBtn,
  authContainer,
  mainContainer,
} from "./ui/dom.js";
import { showToast, showListLoading, showLoadingOverlay, hideLoading } from "./ui/toasts.js";
import { initTabs } from "./ui/tabs.js";
import { initDashboard } from "./ui/dashboard.js";
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
import { loadCalls, renderCalls, exportCallsToCSV, markAllCallsAsViewed, toggleCallsSelectionMode, setCallsSelectAll, deleteSelectedCallGroups } from "./services/calls.js";
import { loadNotifications, reRenderNotifications, exportNotificationsToCSV, markAllNotificationsAsRead, toggleNotifSelectionMode, setNotifSelectAll, deleteSelectedNotifications } from "./services/notifications.js";
import { subscribeToChat, initChatListeners } from "./services/chat.js";
import {
  loadUserSettings,
  initSettingsListeners,
} from "./services/settings.js";
import { loadAllContacts } from "./services/contacts.js";
import { initTheme } from "./services/theme.js";
import { clearCache, getCachedSMS, getCachedCalls, getCachedNotifications } from "./services/cache.js";

// Import utilities
import { applyTranslations, getCurrentLanguage, setCurrentLanguage } from "./utils/i18n.js";

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

/**
 * Show cached data before Firebase Auth fires, so the popup feels instant.
 * Only activates when we detect the user was previously logged in (cache exists).
 * Auth observer will either confirm the session or switch to login UI.
 */
async function showCachedDataBeforeAuth() {
  try {
    const [smsCache, callsCache, notifCache] = await Promise.all([
      getCachedSMS(),
      getCachedCalls(),
      getCachedNotifications(),
    ]);

    const hasAnyCache =
      (smsCache?.allMessages?.length > 0) ||
      (callsCache?.allCalls?.length > 0) ||
      (notifCache?.byDevice && Object.values(notifCache.byDevice).some((n) => n.length > 0));

    if (!hasAnyCache) return; // No cache → keep loading overlay, wait for auth

    // Show main UI immediately with stale cache data
    hideLoading();
    if (authContainer) authContainer.classList.add("hidden");
    if (mainContainer) mainContainer.classList.remove("hidden");

    if (smsCache?.allMessages?.length > 0) {
      if (smsCache.byDevice) {
        for (const [deviceId, msgs] of Object.entries(smsCache.byDevice)) {
          state.setSMSData(deviceId, msgs);
        }
      }
      state.setAllSMSMessages(smsCache.allMessages);
      renderSMS(smsCache.allMessages);
    }

    if (callsCache?.allCalls?.length > 0) {
      if (callsCache.byDevice) {
        for (const [deviceId, calls] of Object.entries(callsCache.byDevice)) {
          state.setCallsByDevice(deviceId, calls);
        }
      }
      state.setAllCallsData(callsCache.allCalls);
      renderCalls(callsCache.allCalls.slice(0, 100));
    }

    if (notifCache?.byDevice) {
      for (const [deviceId, notifs] of Object.entries(notifCache.byDevice)) {
        if (notifs.length > 0) state.setNotificationsData(deviceId, notifs);
      }
      reRenderNotifications();
    }

    console.log("[Popup] ⚡ Pre-auth cache displayed");
  } catch (e) {
    // Non-critical — auth will load data regardless
    console.warn("[Popup] Pre-auth cache display failed:", e);
  }
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
 * Language toggle — switches between EN and AR
 */
function initLangToggle() {
  const btn = document.getElementById("langToggleBtn");
  const label = document.getElementById("langToggleLabel");
  if (!btn || !label) return;

  const updateLabel = (lang) => {
    label.textContent = lang === "ar" ? "EN" : "AR";
    btn.title = lang === "ar" ? "Switch to English" : "Switch to Arabic";
    document.documentElement.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  };

  updateLabel(getCurrentLanguage());

  btn.addEventListener("click", () => {
    const current = getCurrentLanguage();
    const next = current === "ar" ? "en" : "ar";
    setCurrentLanguage(next);
    updateLabel(next);
    applyTranslations();
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

  // Initialize language toggle
  initLangToggle();

  // Apply translations
  applyTranslations();

  // Initialize UI
  initTabs();
  initDashboard();
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

  // Badge is synced to actual unread count by updateTabBadges() once data loads.

  // Show cached data immediately (before auth fires) for instant feel
  showCachedDataBeforeAuth();

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
