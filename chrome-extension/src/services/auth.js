/**
 * Authentication Service
 */

import {
  auth,
  db,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
  updateProfile,
  updatePassword,
  doc,
  getDoc,
  setDoc,
} from "../config/firebase.js";

import { parseAuthError, logError } from "../utils/errors.js";
import { authLogger as logger } from "../utils/logger.js";

import {
  authContainer,
  mainContainer,
  loginForm,
  signupForm,
  loginEmail,
  loginPassword,
  loginBtn,
  signupName,
  signupEmail,
  signupPassword,
  signupBtn,
  googleLoginBtn,
  googleSignupBtn,
  showSignup,
  showLogin,
  logoutBtn,
  logoutBtnChat,
  userAvatarChat,
  userNameChat,
  userEmailChat,
} from "../ui/dom.js";

import { showToast, showLoadingOverlay, hideLoading } from "../ui/toasts.js";
import * as state from "../state/index.js";

// Track if initial auth check is done
let isInitialAuthCheckDone = false;

/**
 * Show authentication UI
 */
export function showAuthUI() {
  // Only show auth UI if initial check is complete
  if (!isInitialAuthCheckDone) return;
  authContainer.classList.remove("hidden");
  mainContainer.classList.add("hidden");
}

/**
 * Show main UI after login
 */
export function showMainUI() {
  authContainer.classList.add("hidden");
  mainContainer.classList.remove("hidden");

  const user = state.currentUser;
  if (!user) return;

  // Update user info in Chat tab
  const avatarUrl =
    user.photoURL ||
    "https://ui-avatars.com/api/?name=" +
      encodeURIComponent(user.displayName || "U");

  if (userAvatarChat) userAvatarChat.src = avatarUrl;
  if (userNameChat) userNameChat.textContent = user.displayName || "User";
  if (userEmailChat) userEmailChat.textContent = user.email;
}

/**
 * Handle email/password login
 */
async function handleLogin() {
  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email || !password) {
    showToast("Please fill in all fields", "error");
    return;
  }

  showLoadingOverlay();
  try {
    logger.info(`Signing in: ${email}`);
    await signInWithEmailAndPassword(auth, email, password);
    logger.info("Sign in successful");
    showToast("Signed in successfully", "success");
  } catch (error) {
    const parsed = parseAuthError(error);
    logError(error, "handleLogin");
    showToast(parsed.message, "error");
    hideLoading();
  }
}

/**
 * Handle email/password signup
 */
async function handleSignup() {
  const name = signupName.value.trim();
  const email = signupEmail.value.trim();
  const password = signupPassword.value;

  if (!name || !email || !password) {
    showToast("Please fill in all fields", "error");
    return;
  }

  showLoadingOverlay();
  try {
    logger.info(`Creating account: ${email}`);
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName: name });

    // Create user document
    await setDoc(doc(db, "users", result.user.uid), {
      uid: result.user.uid,
      email: email,
      displayName: name,
      photoURL: null,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    });

    logger.info("Account created successfully");
    showToast("Account created successfully", "success");
  } catch (error) {
    const parsed = parseAuthError(error);
    logError(error, "handleSignup");
    showToast(parsed.message, "error");
    hideLoading();
  }
}

/**
 * Clear all cached Google tokens and revoke from Google servers
 */
async function clearAllGoogleTokens() {
  return new Promise((resolve) => {
    // Get current token (non-interactive, won't show popup)
    chrome.identity.getAuthToken({ interactive: false }, async (token) => {
      if (!token) {
        logger.info("No cached token to clear");
        resolve();
        return;
      }

      logger.info("Found cached token, revoking...");

      // First revoke the token from Google servers
      try {
        await fetch(
          `https://accounts.google.com/o/oauth2/revoke?token=${token}`,
          {
            method: "POST",
          },
        );
        logger.info("Token revoked from Google servers");
      } catch (e) {
        logger.warn("Failed to revoke token from Google:", e.message);
      }

      // Then remove from Chrome's cache
      chrome.identity.removeCachedAuthToken({ token }, () => {
        logger.info("Token removed from Chrome cache");

        // Also try clearAllCachedAuthTokens if available
        if (chrome.identity.clearAllCachedAuthTokens) {
          chrome.identity.clearAllCachedAuthTokens(() => {
            logger.info("All cached auth tokens cleared");
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Get Google OAuth token with account chooser
 */
async function getGoogleTokenWithAccountChooser() {
  return new Promise((resolve, reject) => {
    // Add delay to ensure cache clearing completed
    setTimeout(() => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          logger.error("OAuth error:", chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!token) {
          reject(new Error("No token received"));
          return;
        }

        logger.info("Successfully obtained access token");
        resolve(token);
      });
    }, 100);
  });
}

/**
 * Handle Google Sign In - Always show account chooser
 */
async function handleGoogleSignIn() {
  showLoadingOverlay();
  try {
    // Clear all cached tokens to force account selection
    await clearAllGoogleTokens();

    // Use launchWebAuthFlow with prompt=select_account to always show account chooser
    const token = await getGoogleTokenWithAccountChooser();

    const credential = GoogleAuthProvider.credential(null, token);
    const result = await signInWithCredential(auth, credential);

    // Check if user document exists
    const userDoc = await getDoc(doc(db, "users", result.user.uid));
    if (!userDoc.exists()) {
      await setDoc(doc(db, "users", result.user.uid), {
        uid: result.user.uid,
        email: result.user.email,
        displayName: result.user.displayName,
        photoURL: result.user.photoURL,
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      });
    }

    showToast("Signed in with Google", "success");
  } catch (error) {
    const parsed = parseAuthError(error);
    logError(error, "handleGoogleSignIn");
    showToast(parsed.message, "error");
    hideLoading();
  }
}

/**
 * Handle logout
 */
async function handleLogout() {
  try {
    // Revoke Google token
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token });
      }
    });

    await signOut(auth);
    showToast("Signed out", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

/**
 * Change user password
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 */
export async function changePassword(currentPassword, newPassword) {
  const user = state.currentUser;
  if (!user) throw new Error("No user logged in");

  const credential = await signInWithEmailAndPassword(
    auth,
    user.email,
    currentPassword,
  );
  await updatePassword(credential.user, newPassword);
}

/**
 * Initialize auth state observer
 * @param {Function} onLogin - Callback when user logs in
 * @param {Function} onLogout - Callback when user logs out
 */
export function initAuthObserver(onLogin, onLogout) {
  onAuthStateChanged(auth, async (user) => {
    // Mark initial check as done
    isInitialAuthCheckDone = true;
    hideLoading();

    if (user) {
      state.setCurrentUser(user);
      showMainUI();

      try {
        chrome.runtime
          .sendMessage({ type: "userLoggedIn", userId: user.uid })
          .catch(() => {});
      } catch (e) {}

      if (onLogin) await onLogin(user);
    } else {
      state.setCurrentUser(null);
      showAuthUI();
      if (onLogout) onLogout();
    }
  });
}

/**
 * Initialize auth event listeners
 */
export function initAuthListeners() {
  // Show signup form
  showSignup?.addEventListener("click", (e) => {
    e.preventDefault();
    loginForm.classList.add("hidden");
    signupForm.classList.remove("hidden");
  });

  // Show login form
  showLogin?.addEventListener("click", (e) => {
    e.preventDefault();
    signupForm.classList.add("hidden");
    loginForm.classList.remove("hidden");
  });

  // Login button
  loginBtn?.addEventListener("click", handleLogin);

  // Signup button
  signupBtn?.addEventListener("click", handleSignup);

  // Google login buttons
  googleLoginBtn?.addEventListener("click", handleGoogleSignIn);
  googleSignupBtn?.addEventListener("click", handleGoogleSignIn);

  // Logout buttons
  logoutBtn?.addEventListener("click", handleLogout);
  logoutBtnChat?.addEventListener("click", handleLogout);

  // Password toggle
  document.querySelectorAll(".toggle-password").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      const eyeOpen = btn.querySelector(".eye-open");
      const eyeClosed = btn.querySelector(".eye-closed");
      if (input.type === "password") {
        input.type = "text";
        eyeOpen?.classList.add("hidden");
        eyeClosed?.classList.remove("hidden");
      } else {
        input.type = "password";
        eyeOpen?.classList.remove("hidden");
        eyeClosed?.classList.add("hidden");
      }
    });
  });
}
