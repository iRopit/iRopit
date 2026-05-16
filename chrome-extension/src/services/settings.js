/**
 * Settings Service
 * Handles user settings and profile management
 */

import {
  db,
  auth,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  signOut,
  signInWithEmailAndPassword,
  updatePassword,
} from "../config/firebase.js"

import { settingsBtn, settingsModal, closeSettingsBtn } from "../ui/dom.js"
import { showToast, showLoadingOverlay, hideLoading, showConfirmDialog } from "../ui/toasts.js"
import {
  getCurrentLanguage,
  setCurrentLanguage,
  applyTranslations,
} from "../utils/i18n.js"
import * as state from "../state/index.js"
import { reRenderNotifications } from "./notifications.js"
import { renderCalls } from "./calls.js"
import { renderSMS } from "./sms.js"

/**
 * Load user settings from Firebase
 */
export async function loadUserSettings() {
  const user = state.currentUser
  if (!user) return

  // Fill display name immediately from cached storage (avoids Firestore delay)
  chrome.storage.local.get(["cachedDisplayName", "cachedEmail"], (cached) => {
    const displayNameInput = document.getElementById("settingsDisplayName")
    const emailInput = document.getElementById("settingsEmail")
    if (displayNameInput && cached.cachedDisplayName) displayNameInput.value = cached.cachedDisplayName
    if (emailInput && cached.cachedEmail) emailInput.value = cached.cachedEmail
  })

  // Then fetch fresh from Firestore and update cache
  const userDoc = await getDoc(doc(db, "users", user.uid))
  if (userDoc.exists()) {
    const userData = userDoc.data()
    const displayNameInput = document.getElementById("settingsDisplayName")
    const emailInput = document.getElementById("settingsEmail")

    if (displayNameInput) displayNameInput.value = userData.displayName || ""
    if (emailInput) emailInput.value = userData.email || ""

    // Cache for instant display next time
    chrome.storage.local.set({
      cachedDisplayName: userData.displayName || "",
      cachedEmail: userData.email || "",
    })
  }

  // Load smart action toggle states from local storage
  const TOGGLE_KEYS = {
    settingsAutoCopyOtp: "smartAction_copyOtp",
    settingsAutoOpenSms: "smartAction_openImages",
    settingsAutoOpenUrl: "smartAction_openUrls",
    settingsUniversalCopy: "smartAction_universalCopy",
    settingsIncomingCallPopup: "smartAction_incomingCallPopup",
    settingsOutgoingCallPopup: "smartAction_outgoingCallPopup",
  }
  const storageKeys = Object.values(TOGGLE_KEYS)
  chrome.storage.local.get(storageKeys, (result) => {
    for (const [elId, storageKey] of Object.entries(TOGGLE_KEYS)) {
      const el = document.getElementById(elId)
      if (!el) continue
      // Default: copyOtp, universalCopy, incomingCallPopup, outgoingCallPopup default ON, others OFF
      const defaultOn = elId === "settingsAutoCopyOtp" || elId === "settingsUniversalCopy" || elId === "settingsIncomingCallPopup" || elId === "settingsOutgoingCallPopup"
      el.checked = storageKey in result ? result[storageKey] : defaultOn
    }
  })
}

/**
 * Save display name
 */
async function saveDisplayName() {
  const user = state.currentUser
  const newName = document.getElementById("settingsDisplayName")?.value.trim()

  if (!newName) {
    showToast("Display name cannot be empty", "error")
    return
  }

  showLoadingOverlay()
  try {
    await updateDoc(doc(db, "users", user.uid), {
      displayName: newName,
      updatedAt: Date.now(),
    })

    // Update cache so next open is instant
    chrome.storage.local.set({ cachedDisplayName: newName })

    const userNameElement = document.getElementById("userName")
    if (userNameElement) userNameElement.textContent = newName

    showToast("Display name updated", "success")
  } catch (error) {
    showToast("Failed to update display name", "error")
  }
  hideLoading()
}

/**
 * Show change password modal
 */
function showChangePasswordModal() {
  const modal = document.createElement("div")
  modal.className = "modal"
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 400px;">
      <div class="modal-header">
        <h3 data-i18n="change_password_title">Change Password</h3>
        <button class="close-modal">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="currentPassword">Current Password</label>
          <input type="password" id="currentPassword" placeholder="Enter current password">
        </div>
        <div class="form-group">
          <label for="newPassword">New Password</label>
          <input type="password" id="newPassword" placeholder="Enter new password">
        </div>
        <div class="form-group">
          <label for="confirmPassword">Confirm New Password</label>
          <input type="password" id="confirmPassword" placeholder="Confirm new password">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary cancel-btn">Cancel</button>
        <button class="btn btn-primary save-password-btn">Change Password</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)

  const closeBtn = modal.querySelector(".close-modal")
  const cancelBtn = modal.querySelector(".cancel-btn")
  const saveBtn = modal.querySelector(".save-password-btn")

  closeBtn.addEventListener("click", () => modal.remove())
  cancelBtn.addEventListener("click", () => modal.remove())
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove()
  })

  saveBtn.addEventListener("click", async () => {
    const currentPassword = modal.querySelector("#currentPassword").value
    const newPassword = modal.querySelector("#newPassword").value
    const confirmPassword = modal.querySelector("#confirmPassword").value

    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast("Please fill all fields", "error")
      return
    }

    if (newPassword !== confirmPassword) {
      showToast("New passwords don't match", "error")
      return
    }

    if (newPassword.length < 6) {
      showToast("Password must be at least 6 characters", "error")
      return
    }

    showLoadingOverlay()
    try {
      const user = state.currentUser
      const credential = await signInWithEmailAndPassword(
        auth,
        user.email,
        currentPassword
      )
      await updatePassword(credential.user, newPassword)
      showToast("Password changed successfully", "success")
      modal.remove()
    } catch (error) {
      console.error("Change password error:", error)
      if (error.code === "auth/wrong-password") {
        showToast("Current password is incorrect", "error")
      } else {
        showToast("Failed to change password", "error")
      }
    }
    hideLoading()
  })
}

/**
 * Delete account: remove all devices, history, user doc, then sign out
 */
async function deleteAccount() {
  const user = state.currentUser
  if (!user) return

  showLoadingOverlay()
  try {
    // 1. Delete all device documents (Cloud Function handles subcollection cleanup)
    const devicesSnap = await getDocs(
      query(collection(db, "devices"), where("userId", "==", user.uid))
    )
    const deviceDeletes = devicesSnap.docs.map((d) => deleteDoc(d.ref))
    await Promise.all(deviceDeletes)

    // 2. Delete user document
    await deleteDoc(doc(db, "users", user.uid))

    // 3. Delete Firebase Auth account
    await auth.currentUser.delete()

    // 4. Revoke Chrome identity token & sign out
    if (typeof chrome !== "undefined" && chrome.identity) {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (token) chrome.identity.removeCachedAuthToken({ token })
      })
    }
    await signOut(auth)

    showToast("Account deleted", "success")
  } catch (error) {
    console.error("Delete account error:", error)
    if (error.code === "auth/requires-recent-login") {
      showToast("Please sign out and sign in again before deleting your account", "error")
    } else {
      showToast("Failed to delete account", "error")
    }
    hideLoading()
  }
}

/**
 * Initialize settings event listeners
 */
export function initSettingsListeners() {
  // Settings modal open/close
  settingsBtn?.addEventListener("click", () => {
    // Load latest toggle states before showing modal to avoid flash of wrong state
    const TOGGLE_KEYS = {
      settingsAutoCopyOtp: "smartAction_copyOtp",
      settingsAutoOpenSms: "smartAction_openImages",
      settingsAutoOpenUrl: "smartAction_openUrls",
      settingsUniversalCopy: "smartAction_universalCopy",
      settingsIncomingCallPopup: "smartAction_incomingCallPopup",
      settingsOutgoingCallPopup: "smartAction_outgoingCallPopup",
    }
    const storageKeys = Object.values(TOGGLE_KEYS)
    chrome.storage.local.get(storageKeys, (result) => {
      for (const [elId, storageKey] of Object.entries(TOGGLE_KEYS)) {
        const el = document.getElementById(elId)
        if (!el) continue
        const defaultOn = elId === "settingsAutoCopyOtp" || elId === "settingsUniversalCopy" || elId === "settingsIncomingCallPopup" || elId === "settingsOutgoingCallPopup"
        el.checked = storageKey in result ? result[storageKey] : defaultOn
      }
      settingsModal.classList.remove("hidden")
    })
  })

  closeSettingsBtn?.addEventListener("click", () => {
    settingsModal.classList.add("hidden")
  })

  settingsModal?.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add("hidden")
    }
  })

  // Save display name
  document
    .getElementById("saveDisplayNameBtn")
    ?.addEventListener("click", saveDisplayName)

  // Smart action toggles — persist to chrome.storage.local so service worker can read them
  const SMART_TOGGLES = {
    settingsAutoCopyOtp: "smartAction_copyOtp",
    settingsAutoOpenSms: "smartAction_openImages",
    settingsAutoOpenUrl: "smartAction_openUrls",
    settingsUniversalCopy: "smartAction_universalCopy",
    settingsIncomingCallPopup: "smartAction_incomingCallPopup",
    settingsOutgoingCallPopup: "smartAction_outgoingCallPopup",
  }
  for (const [elId, storageKey] of Object.entries(SMART_TOGGLES)) {
    document.getElementById(elId)?.addEventListener("change", (e) => {
      chrome.storage.local.set({ [storageKey]: e.target.checked })
    })
  }

  // Delete account
  document.getElementById("deleteAccountBtn")?.addEventListener("click", async () => {
    if (
      await showConfirmDialog(
        "Are you sure you want to permanently delete your account? All devices, SMS history, call logs, and notifications will be erased. This cannot be undone."
      )
    ) {
      await deleteAccount()
    }
  })

  // Language selection
  const languageSelect = document.getElementById("languageSelect")
  if (languageSelect) {
    languageSelect.value = getCurrentLanguage()
    languageSelect.addEventListener("change", (e) => {
      const newLang = e.target.value
      setCurrentLanguage(newLang)
      applyTranslations()
      // Re-render all lists so dynamic timestamps update
      reRenderNotifications()
      renderCalls(state.allCallsData)
      renderSMS(state.allSMSMessages)
      showToast(
        newLang === "ar" ? "تم تغيير اللغة" : "Language changed",
        "success"
      )
    })
  }
}
