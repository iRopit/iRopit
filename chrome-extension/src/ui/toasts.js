/**
 * Toast notifications module
 */

import { toastContainer, loadingOverlay } from "./dom.js"
import { getCurrentLanguage } from "../utils/i18n.js"

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type: 'info', 'success', 'error', 'warning'
 */
export function showToast(message, type = "info") {
  const toast = document.createElement("div")
  toast.className = `toast ${type}`
  toast.textContent = message
  toastContainer.appendChild(toast)
  setTimeout(() => toast.remove(), 3000)
}

/**
 * Show a custom confirm dialog (replaces window.confirm to avoid browser suppression)
 * @param {string} message - Confirmation message
 * @returns {Promise<boolean>} - Resolves true if confirmed, false if cancelled
 */
export function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const isAr = getCurrentLanguage() === "ar"
    const overlay = document.createElement("div")
    overlay.className = "confirm-overlay"

    overlay.innerHTML = `
      <div class="confirm-dialog" dir="${isAr ? "rtl" : "ltr"}">
        <p class="confirm-message">${message}</p>
        <div class="confirm-actions">
          <button class="confirm-btn confirm-cancel">${isAr ? "إلغاء" : "Cancel"}</button>
          <button class="confirm-btn confirm-ok">${isAr ? "موافق" : "OK"}</button>
        </div>
      </div>
    `

    const cleanup = (result) => {
      overlay.remove()
      resolve(result)
    }

    overlay.querySelector(".confirm-ok").addEventListener("click", () => cleanup(true))
    overlay.querySelector(".confirm-cancel").addEventListener("click", () => cleanup(false))
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false) })

    document.body.appendChild(overlay)
    overlay.querySelector(".confirm-ok").focus()
  })
}

/**
 * Show loading overlay
 */
export function showLoadingOverlay() {
  loadingOverlay.classList.remove("hidden")
}

/**
 * Hide loading overlay
 */
export function hideLoading() {
  loadingOverlay.classList.add("hidden")
}

/**
 * Show loading indicator in a list element
 * @param {HTMLElement} listElement - List element to show loading in
 * @param {string} [message] - Optional custom message (defaults to "Loading...")
 */
export function showListLoading(listElement, message) {
  if (listElement) {
    const lang = getCurrentLanguage();
    const label =
      message || (lang === "ar" ? "جارٍ التحميل..." : "Loading...");
    listElement.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>${label}</p>
      </div>
    `;
  }
}
