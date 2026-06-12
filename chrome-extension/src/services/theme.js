/**
 * Theme Service
 * Handles dark/light mode toggle and persistence
 */

import { themeToggleBtn, themeIconLight, themeIconDark } from "../ui/dom.js";

let isDark = false;

/**
 * Apply the current theme to the DOM
 */
function applyTheme() {
  if (isDark) {
    document.documentElement.classList.add("dark");
    if (themeIconLight) themeIconLight.style.display = "none";
    if (themeIconDark) themeIconDark.style.display = "block";
  } else {
    document.documentElement.classList.remove("dark");
    if (themeIconLight) themeIconLight.style.display = "block";
    if (themeIconDark) themeIconDark.style.display = "none";
  }
}

/**
 * Toggle between dark and light mode
 */
function toggleTheme() {
  isDark = !isDark;
  applyTheme();
  chrome.storage.local.set({ darkMode: isDark });
}

/**
 * Initialize theme from stored preference
 */
export function initTheme() {
  chrome.storage.local.get(["darkMode"], (result) => {
    // Default to dark mode on first install (when darkMode is undefined).
    isDark = result.darkMode !== false;
    if (typeof result.darkMode === "undefined") {
      chrome.storage.local.set({ darkMode: true });
    }
    applyTheme();
  });

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", toggleTheme);
  }
}
