/**
 * Navigation Module
 * Handles mobile system back button using the browser history API.
 *
 * - In a submenu / modal  → back closes it and returns to main menu
 * - On the main menu       → back minimises (closes) the popup
 */

import * as state from "../state/index.js";

/**
 * Detect the top-most open overlay / submenu and close it.
 * Returns true if something was closed, false otherwise.
 */
function closeTopView() {
  // --- Dynamic modals (edit device name, change password) ---
  const dynamicOverlay = document.querySelector(".modal-overlay");
  if (dynamicOverlay) {
    dynamicOverlay.remove();
    return true;
  }

  // --- File preview modal ---
  const filePreview = document.getElementById("filePreviewModal");
  if (filePreview && !filePreview.classList.contains("hidden")) {
    filePreview.classList.add("hidden");
    return true;
  }

  // --- SMS compose modal ---
  const smsModal = document.getElementById("smsModal");
  if (smsModal && !smsModal.classList.contains("hidden")) {
    smsModal.classList.add("hidden");
    return true;
  }

  // --- Settings modal ---
  const settingsModal = document.getElementById("settingsModal");
  if (settingsModal && !settingsModal.classList.contains("hidden")) {
    settingsModal.classList.add("hidden");
    return true;
  }

  // --- Notification detail view ---
  const notifDetail = document.getElementById("notifDetailView");
  if (notifDetail && notifDetail.style.display === "flex") {
    const notifMain = document.getElementById("notifMainView");
    notifDetail.style.display = "none";
    if (notifMain) notifMain.style.display = "flex";
    return true;
  }

  // --- SMS conversation view ---
  if (state.currentConversation) {
    document.getElementById("backToSMS")?.click();
    return true;
  }

  // --- Call history detail view ---
  if (state.currentCallConversation) {
    document.getElementById("backToCalls")?.click();
    return true;
  }

  return false;
}

/**
 * Initialise back-button navigation.
 * Call once during popup startup (after DOM is ready).
 */
export function initNavigation() {
  // Push a guard state so the first system-back triggers popstate
  // instead of navigating away from the popup page.
  history.pushState({ guard: true }, "");

  window.addEventListener("popstate", () => {
    if (closeTopView()) {
      // Something was closed – push a new guard for the next back press
      history.pushState({ guard: true }, "");
    } else {
      // Nothing open – close / minimise the popup
      window.close();
    }
  });
}
