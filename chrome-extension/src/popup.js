import "./config/firebase.js";

// Globally swallow Firestore permission-denied errors during sign-out.
window.addEventListener("unhandledrejection", (event) => {
  const reason = event?.reason;
  if (
    reason?.code === "permission-denied" ||
    /Missing or insufficient permissions/i.test(reason?.message || "") ||
    reason?.code === "resource-exhausted" ||
    /quota\s+exceeded/i.test(reason?.message || "")
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
import { initProfileFooter } from "./ui/modals.js";
import { initNavigation } from "./ui/navigation.js";
import { initTour } from "./ui/tour.js";

// Import services
import { initAuthObserver, initAuthListeners } from "./services/auth.js";
import { registerDevice, loadDevices, updateDeviceSelects, renderDevices } from "./services/devices.js";
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
import { loadNotifications, injectPushedNotification, reRenderNotifications, exportNotificationsToCSV, markAllNotificationsAsRead, toggleNotifSelectionMode, setNotifSelectAll, deleteSelectedNotifications, snoozeVisibleNotificationGroups, unsnoozeVisibleNotificationGroups } from "./services/notifications.js";
import { subscribeToChat, initChatListeners, injectPushedChatMessage, refreshChatNow, exportChatToCSV } from "./services/chat.js";
import {
  loadUserSettings,
  initSettingsListeners,
} from "./services/settings.js";
import { loadAllContacts, hydrateCachedContactsMap } from "./services/contacts.js";
import { initTheme } from "./services/theme.js";
import { clearCache, getCachedSMS, getCachedCalls, getCachedNotifications, flushSMSCache, flushNotificationsCache } from "./services/cache.js";
import QRCode from "qrcode";

// Import utilities
import { applyTranslations, getCurrentLanguage, setCurrentLanguage } from "./utils/i18n.js";

let hasLoadedCalls = false;
let hasLoadedNotifications = false;
let lazyTabLoadsWired = false;
let hadAuthenticatedSession = false;
let initialDataLoadedForUid = null;
const INSTALL_ANDROID_PROMPT_KEY = "installAndroidPromptPending";
const INSTALL_ANDROID_PROMPT_SHOWN_KEY = "installAndroidPromptShown_v1";
const ANDROID_APP_URL = "https://play.google.com/store/apps/details?id=com.IRopit";

async function drainPendingChatPushes() {
  const key = "pendingChatPushes";
  try {
    const result = await chrome.storage.local.get([key]);
    const pending = Array.isArray(result[key]) ? result[key] : [];
    if (pending.length === 0) return;

    const ordered = pending
      .filter((m) => m?.id)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    for (const msg of ordered) {
      // eslint-disable-next-line no-await-in-loop
      await injectPushedChatMessage(msg);
    }

    await refreshChatNow().catch(() => {});
    await chrome.storage.local.set({ [key]: [] });
  } catch (_) {}
}

function loadCallsIfNeeded(force = false) {
  if (!force && hasLoadedCalls) return;
  hasLoadedCalls = true;
  loadCalls();
}

function loadNotificationsIfNeeded(force = false) {
  if (!force && hasLoadedNotifications) return;
  hasLoadedNotifications = true;
  loadNotifications();
}

function wireLazyTabLoads() {
  if (lazyTabLoadsWired) return;
  const callsTabBtn = document.querySelector('.tab[data-tab="calls"]');
  const notificationsTabBtn = document.querySelector('.tab[data-tab="notifications"]');

  callsTabBtn?.addEventListener("click", () => loadCallsIfNeeded(false));
  notificationsTabBtn?.addEventListener("click", () =>
    loadNotificationsIfNeeded(false),
  );
  lazyTabLoadsWired = true;
}

async function showAndroidAppInstallPromptIfNeeded() {
  try {
    const result = await chrome.storage.local.get([
      INSTALL_ANDROID_PROMPT_KEY,
      INSTALL_ANDROID_PROMPT_SHOWN_KEY,
    ]);
    if (!result?.[INSTALL_ANDROID_PROMPT_KEY] || result?.[INSTALL_ANDROID_PROMPT_SHOWN_KEY]) {
      return false;
    }

    document.getElementById("androidInstallPromptOverlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "androidInstallPromptOverlay";
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "background:rgba(8,12,26,0.72)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "z-index:10000",
      "padding:16px",
    ].join(";");

    const card = document.createElement("div");
    card.style.cssText = [
      "width:min(520px,100%)",
      "background:var(--surface,#182341)",
      "border:1px solid var(--border,#2a3558)",
      "border-radius:14px",
      "box-shadow:0 18px 48px rgba(0,0,0,0.38)",
      "padding:18px",
      "color:var(--text,#f4f6ff)",
    ].join(";");

    const title = document.createElement("h3");
    title.textContent = "Complete installation";
    title.style.cssText = "margin:0 0 10px 0;font-size:18px;font-weight:700;";

    const body = document.createElement("p");
    body.textContent =
      "One more step! Install the iRopit Android app using the link below to connect your phone with the browser extension and enable synchronization.";
    body.style.cssText = "margin:0 0 14px 0;line-height:1.5;font-size:13px;color:var(--text-secondary,#c7d0e8);";

    const qrWrap = document.createElement("div");
    qrWrap.style.cssText = "display:flex;justify-content:center;margin-bottom:12px;";

    const qrImg = document.createElement("img");
    qrImg.alt = "Android app QR code";
    qrImg.style.cssText = "width:170px;height:170px;border-radius:10px;background:#fff;padding:8px;";
    try {
      qrImg.src = await QRCode.toDataURL(ANDROID_APP_URL, {
        width: 170,
        margin: 1,
      });
    } catch (_) {
      qrImg.style.display = "none";
    }
    qrWrap.appendChild(qrImg);

    const link = document.createElement("a");
    link.href = ANDROID_APP_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = ANDROID_APP_URL;
    link.style.cssText = "display:block;margin-bottom:14px;font-size:12px;word-break:break-all;color:#8ec5ff;";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;justify-content:flex-end;";

    const laterBtn = document.createElement("button");
    laterBtn.textContent = "Close";
    laterBtn.style.cssText =
      "border:1px solid var(--border,#2a3558);background:var(--surface-secondary,#111a34);color:var(--text,#f4f6ff);padding:8px 12px;border-radius:8px;cursor:pointer;";

    const installBtn = document.createElement("button");
    installBtn.textContent = "Install Android App";
    installBtn.style.cssText =
      "border:0;background:var(--primary,#d3bd92);color:#000;padding:8px 12px;border-radius:8px;font-weight:700;cursor:pointer;";

    const markShownAndClose = async () => {
      await chrome.storage.local.set({
        [INSTALL_ANDROID_PROMPT_KEY]: false,
        [INSTALL_ANDROID_PROMPT_SHOWN_KEY]: true,
      });
      overlay.remove();
      try {
        window.dispatchEvent(new CustomEvent("iropit:android-install-prompt-closed"));
      } catch (_) {}
    };

    laterBtn.addEventListener("click", () => {
      markShownAndClose().catch(() => overlay.remove());
    });

    installBtn.addEventListener("click", async () => {
      try {
        await chrome.tabs.create({ url: ANDROID_APP_URL });
      } catch (_) {
        window.open(ANDROID_APP_URL, "_blank");
      }
      await markShownAndClose();
    });

    actions.appendChild(laterBtn);
    actions.appendChild(installBtn);

    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(qrWrap);
    card.appendChild(link);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    return true;
  } catch (_) {
    return false;
  }
}

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
    await hydrateCachedContactsMap();

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
      // NOTE: Do NOT seed state.allSMS (per-device map) from cache here.
      // The realtime Firestore listeners merge Object.values(state.allSMS) when
      // each device fires. If we pre-populate the per-device map from cache and
      // then dev1's listener fires with fresh data, the merge mixes fresh dev1
      // + stale-cached dev2 → polluted state.allSMSMessages and a polluted
      // cache write that persists the bad data into the next session.
      // Only populate the flat list for instant rendering.
      // Sanitize any ENC: values that slipped into the cache before display.
      const sanitizeSmsMsg = (m) => {
        const hasEnc =
          (m.contactName && typeof m.contactName === "string" && m.contactName.startsWith("ENC:")) ||
          (m.phoneNumber && typeof m.phoneNumber === "string" && m.phoneNumber.startsWith("ENC:")) ||
          (m.title && typeof m.title === "string" && m.title.startsWith("ENC:")) ||
          (m.body && typeof m.body === "string" && m.body.startsWith("ENC:")) ||
          (m.text && typeof m.text === "string" && m.text.startsWith("ENC:")) ||
          (m.sender && typeof m.sender === "string" && m.sender.startsWith("ENC:")) ||
          (m.displayName && typeof m.displayName === "string" && m.displayName.startsWith("ENC:"));
        if (!hasEnc) return m;
        return {
          ...m,
          contactName: (m.contactName && m.contactName.startsWith("ENC:")) ? "" : (m.contactName || ""),
          phoneNumber: (m.phoneNumber && m.phoneNumber.startsWith("ENC:")) ? "" : (m.phoneNumber || ""),
          title: (m.title && m.title.startsWith("ENC:")) ? "" : (m.title || ""),
          body: (m.body && m.body.startsWith("ENC:")) ? "" : (m.body || ""),
          text: (m.text && m.text.startsWith("ENC:")) ? "" : (m.text || ""),
          sender: (m.sender && m.sender.startsWith("ENC:")) ? "" : (m.sender || ""),
          displayName: (m.displayName && m.displayName.startsWith("ENC:")) ? "" : (m.displayName || ""),
        };
      };
      const sanitizedSmsMessages = smsCache.allMessages.map(sanitizeSmsMsg);
      state.setAllSMSMessages(sanitizedSmsMessages);
      renderSMS(sanitizedSmsMessages);
    }

    if (callsCache?.allCalls?.length > 0) {
      if (callsCache.byDevice) {
        for (const [deviceId, calls] of Object.entries(callsCache.byDevice)) {
          state.setCallsByDevice(deviceId, calls);
        }
      }
      state.setCallsDataConfirmed(true);
      state.setAllCallsData(callsCache.allCalls);
      renderCalls(callsCache.allCalls.slice(0, 100));
    }

    if (notifCache?.byDevice) {
      // Seed state for instant rendering. Keep state seeded (do NOT clear afterwards)
      // so that if the SW pushes a notification before loadNotifications() re-seeds
      // state, injectPushedNotification finds the full history instead of []
      // and avoids overwriting the cache with just 1 item.
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

function loadData(options = {}) {
  cleanupSubscriptions();
  hasLoadedCalls = false;
  hasLoadedNotifications = false;

  // Warm phone->contact map from local cache as early as possible.
  hydrateCachedContactsMap().catch(() => {});

  // Prioritize SMS on startup so first-install history loads before lower-priority tabs.
  loadSMS(options.smsOptions || {});

  // Preload calls on startup so call history and missed-call badges are ready
  // before the user opens the Calls tab.
  loadCallsIfNeeded(true);

  // Load devices first, then contacts (contacts need devices to be loaded)
  loadDevices();
  loadDevicesAndContacts();

  loadUserSettings();
  subscribeToChat();
  drainPendingChatPushes().catch(() => {});

  // If user refreshes while already inside Notifications, refresh that tab too.
  const activeTab = document.querySelector(".tab.active")?.dataset?.tab;
  if (activeTab === "notifications") loadNotificationsIfNeeded(true);
}

function cleanupSubscriptions() {
  state.clearUnsubscribers();
  stopPolling();
  stopSMSListener();
  // Don't clear SMS/calls/notifications data here - their loaders can show
  // cached data first, which keeps badge counts responsive on popup open.
  // state.clearAllSMS(); // Removed to preserve cache
  // state.clearAllNotifications(); // Removed to preserve cache
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

      // Inject the pushed notification directly into popup state + re-render.
      // No spinner, no listener churn, no extra Firestore read (avoids quota).
      // This keeps the popup in sync even when its own onSnapshot listeners are
      // throttled/broken by Firestore quota limits.
      injectPushedNotification(notification).catch(() => {});

      // Note: SMS updates are handled by real-time listener in sms.js
      // No need to call loadSMS() here as it would cause duplicate processing
      if (notification.type === "sms") {
        console.log(
          "📱 SMS notification - real-time listener will handle UI update",
        );
      }
      sendResponse({ received: true });
      return true;
    }
    if (message.type === "newCall") {
      console.log("📞 New call received in popup from:", message.deviceName);
      // Avoid extra reads while user is on non-calls tabs; preload calls only
      // after the tab is opened once or when it's currently active.
      const activeTab = document.querySelector(".tab.active")?.dataset?.tab;
      if (activeTab === "calls" || hasLoadedCalls) {
        loadCallsIfNeeded(true);
      }
      sendResponse({ received: true });
      return true;
    }
    if (message.type === "newChat") {
      injectPushedChatMessage(message.data).catch(() => {});
      refreshChatNow().catch(() => {});
      sendResponse({ received: true });
      return true;
    }
    // For all other messages (e.g. offscreen-copy), don't respond —
    // let the intended recipient (offscreen document) handle them.
    return false;
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
    // Re-render dynamic sections that contain language-dependent strings.
    renderDevices();
    updateDeviceSelects();
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
      hadAuthenticatedSession = true;
      // Do not block UI/data loading on registerDevice network latency.
      // Register in background while tabs start loading immediately.
      registerDevice().catch((err) =>
        console.error("[Popup] registerDevice error:", err),
      );
      const sameUidSessionReload = initialDataLoadedForUid === user.uid;
      // Some re-auth flows (token races / quick sign-out+sign-in) can emit a
      // same-UID login while no popup listeners are active. In that case,
      // bootstrap again so shared SMS/calls history does not wait for manual refresh.
      const hasActiveSubscriptions =
        Array.isArray(state.unsubscribers) && state.unsubscribers.length > 0;
      if (!sameUidSessionReload || !hasActiveSubscriptions) {
        loadData();
        initialDataLoadedForUid = user.uid;
      }
      wireLazyTabLoads();
      // Show first-install Android app prompt once after first login.
      const promptShown = await showAndroidAppInstallPromptIfNeeded();
      // Show first-time tour after login (only on fresh install).
      // If Android install prompt is shown, start the tour as soon as user closes it
      // so onboarding continues in the same popup session.
      if (!promptShown) {
        initTour();
      } else {
        window.addEventListener(
          "iropit:android-install-prompt-closed",
          () => {
            initTour();
          },
          { once: true },
        );
      }
    },
    // On logout
    (info) => {
      const explicit = info?.explicit === true;
      hadAuthenticatedSession = false;

      // Always detach live Firestore listeners to avoid permission-denied noise
      // while auth is null.
      cleanupSubscriptions();

      // CRITICAL: Only wipe in-memory state AND the local cache on an EXPLICIT,
      // user-initiated (or forced account-removal) sign-out.
      //
      // Transient auth-null events during an active session (Firebase token
      // refresh, MV3 service-worker restarts, network blips) previously called
      // state.resetState() here, which cleared allSMS/allSMSMessages/allCallsData.
      // That made the SMS/Calls lists visibly DISAPPEAR, and then RELOAD from
      // scratch the instant auth returned — the exact "stayed a while → wiped →
      // reloaded" symptom. Keeping the data through a transient flap avoids it.
      if (explicit) {
        initialDataLoadedForUid = null;
        state.resetState();
        clearCache();
      }
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
  document.getElementById("exportChatBtn")?.addEventListener("click", exportChatToCSV);

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
  document.getElementById("notifMainSnoozeBtn")?.addEventListener("click", snoozeVisibleNotificationGroups);
  document.getElementById("notifMainUnsnoozeBtn")?.addEventListener("click", unsnoozeVisibleNotificationGroups);

  // Refresh button
  document.getElementById("refreshBtn")?.addEventListener("click", () => {
    showToast(getCurrentLanguage() === "ar" ? "...جارٍ التحديث" : "Refreshing...", "info");
    // Manual refresh must do a full SMS fetch so history is preserved and
    // backfilled messages are not lost to delta-only cache windows.
    loadData({ smsOptions: { forceFull: true } });
  });
}

// Start the extension
init();

// Clean up Firestore listeners when popup closes to avoid WebChannel transport errors
window.addEventListener("pagehide", () => {
  // Flush any pending SMS / notification cache writes so the next popup open
  // shows fully cached data instead of starting empty and re-filling from Firestore.
  // Without this flush, the 3s debounce in cacheNotificationsData drops the latest
  // SW-pushed notifications whenever the popup closes within 3s of an update.
  try { flushSMSCache(); } catch (_) {}
  // Only flush notifications cache after the notifications tab has hydrated.
  // Flushing when unopened can persist partial SW-pushed state (e.g. 1 item)
  // and hide historical notifications on next popup open.
  if (hasLoadedNotifications) {
    try { flushNotificationsCache(state.allNotifications); } catch (_) {}
  }
  // Tell the SW the popup is closed so it can resume badge management from cache.
  chrome.runtime.sendMessage({ type: "popupClosed" }).catch(() => {});
  cleanupSubscriptions();
});
