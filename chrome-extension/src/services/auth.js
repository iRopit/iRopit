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
  onSnapshot,
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
let stopAccountDocWatcher = null;
let transientLogoutTimer = null;

// True only while an EXPLICIT sign-out is in progress (user pressed logout, or
// the account was deleted/revoked). Transient auth-null events (token refresh,
// MV3 service-worker restarts, network blips) must NOT be treated as explicit
// sign-outs, otherwise the cached SMS/Calls get wiped and reload from scratch.
let explicitSignOutInProgress = false;

/**
 * Whether the most recent logout was an explicit, user-initiated (or forced
 * account-removal) sign-out. Consumed by the auth observer's logout handler to
 * decide whether the local cache should be cleared.
 * @returns {boolean}
 */
export function isExplicitSignOut() {
  return explicitSignOutInProgress;
}

function teardownAccountDocWatcher() {
  if (typeof stopAccountDocWatcher === "function") {
    try {
      stopAccountDocWatcher();
    } catch (_) {}
    stopAccountDocWatcher = null;
  }
}

async function forceSignOutForDeletedAccount() {
  teardownAccountDocWatcher();
  // Account was deleted/revoked → this is a real sign-out, clear the cache.
  explicitSignOutInProgress = true;
  try {
    await signOut(auth);
  } catch (_) {}
}

// A single permission-denied / not-exists snapshot on the user profile is often
// TRANSIENT (auth-token race right after an update, service-worker restart, or
// token refresh). Signing out immediately tears down the session and forces a
// full SMS/Calls reload from scratch. Wait for the race to settle, then verify
// against the server before signing out.
async function verifyThenForceSignOut(userRef, uid) {
  await new Promise((r) => setTimeout(r, 6000));
  // User already changed / logged out while we waited — nothing to do.
  if (!state.currentUser || state.currentUser.uid !== uid) return;
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) return; // false alarm — profile readable, keep session
    await forceSignOutForDeletedAccount();
  } catch (error) {
    if (error?.code === "permission-denied") {
      await forceSignOutForDeletedAccount();
    }
    // Any other error (unavailable/network) → keep the session, do NOT sign out.
  }
}

function setupAccountDocWatcher(user) {
  teardownAccountDocWatcher();
  if (!user?.uid) return;

  const userRef = doc(db, "users", user.uid);
  stopAccountDocWatcher = onSnapshot(
    userRef,
    async (snap) => {
      if (!snap.exists()) {
        logger.info("User profile missing; verifying before sign-out");
        verifyThenForceSignOut(userRef, user.uid);
      }
    },
    async (error) => {
      if (error?.code === "permission-denied") {
        logger.warn(
          "Profile watch permission denied; verifying before sign-out",
          error?.message || "",
        );
        verifyThenForceSignOut(userRef, user.uid);
      }
    },
  );
}

function isOAuthUserCancelMessage(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("did not approve access") ||
    text.includes("access_denied") ||
    text.includes("user_denied") ||
    text.includes("cancel")
  );
}

function createOAuthCancelledError(message) {
  const err = new Error(message || "OAuth canceled by user");
  err.code = "auth/oauth-cancelled";
  return err;
}

function isOAuthCancelledError(error) {
  return (
    error?.code === "auth/oauth-cancelled" ||
    isOAuthUserCancelMessage(error?.message)
  );
}

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
      const getTokenErr = chrome.runtime.lastError;
      if (getTokenErr) {
        const msg = String(getTokenErr.message || "");
        // Expected when there is no granted OAuth token yet.
        if (isOAuthUserCancelMessage(msg) || msg.toLowerCase().includes("not granted") || msg.toLowerCase().includes("revoked")) {
          logger.info("No active OAuth grant to clear");
        } else {
          logger.warn("getAuthToken(non-interactive) failed while clearing token:", msg);
        }
        resolve();
        return;
      }

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
        // Access runtime.lastError to prevent unchecked callback errors.
        const removeErr = chrome.runtime.lastError;
        if (removeErr) {
          logger.warn("removeCachedAuthToken warning:", removeErr.message);
        }
        logger.info("Token removed from Chrome cache");

        // Also try clearAllCachedAuthTokens if available
        if (chrome.identity.clearAllCachedAuthTokens) {
          chrome.identity.clearAllCachedAuthTokens(() => {
            const clearErr = chrome.runtime.lastError;
            if (clearErr) {
              logger.warn("clearAllCachedAuthTokens warning:", clearErr.message);
            }
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
 * Get Google OAuth token with account chooser.
 *
 * On Windows we use chrome.identity.getAuthToken which is fast and reliable.
 * On macOS that API closes the extension popup while the account chooser is
 * shown, which kills the JS context before signInWithCredential runs and the
 * user is dropped back on the login screen. We detect macOS and fall back to
 * chrome.identity.launchWebAuthFlow, which opens OAuth in a separate window
 * and leaves the popup alive.
 */
async function getGoogleTokenWithAccountChooser() {
  const platform = await new Promise((resolve) => {
    try {
      chrome.runtime.getPlatformInfo((info) => resolve(info?.os || ""));
    } catch (_) {
      resolve("");
    }
  });
  const isMac = platform === "mac";

  if (isMac) {
    return new Promise((resolve, reject) => {
      try {
        // Use the Web application OAuth client (not the manifest's Chrome
        // extension client) because launchWebAuthFlow requires a registered
        // redirect URI, which Chrome-extension type clients do not support.
        const clientId =
          "723637478368-8vceokc6jdb1uc9fbht1megnl9urrfnk.apps.googleusercontent.com";
        const manifest = chrome.runtime.getManifest();
        const scopes = (manifest?.oauth2?.scopes || []).join(" ");
        const redirectUri = chrome.identity.getRedirectURL();
        const authUrl =
          "https://accounts.google.com/o/oauth2/v2/auth" +
          "?client_id=" + encodeURIComponent(clientId) +
          "&response_type=token" +
          "&redirect_uri=" + encodeURIComponent(redirectUri) +
          "&scope=" + encodeURIComponent(scopes) +
          "&prompt=select_account";

        chrome.identity.launchWebAuthFlow(
          { url: authUrl, interactive: true },
          (responseUrl) => {
            if (chrome.runtime.lastError) {
              const msg = chrome.runtime.lastError.message;
              if (isOAuthUserCancelMessage(msg)) {
                logger.info("OAuth canceled by user");
                reject(createOAuthCancelledError(msg));
                return;
              }
              logger.error("OAuth error:", msg);
              reject(new Error(msg));
              return;
            }
            if (!responseUrl) {
              reject(new Error("No response from Google sign-in"));
              return;
            }
            const hash = responseUrl.split("#")[1] || "";
            const params = new URLSearchParams(hash);
            const token = params.get("access_token");
            if (!token) {
              reject(new Error("No access token in OAuth response"));
              return;
            }
            logger.info("Successfully obtained access token (web auth flow)");
            resolve(token);
          },
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  return new Promise((resolve, reject) => {
    // Add delay to ensure cache clearing completed
    setTimeout(() => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message;
          if (isOAuthUserCancelMessage(msg)) {
            logger.info("OAuth canceled by user");
            reject(createOAuthCancelledError(msg));
            return;
          }
          logger.error("OAuth error:", msg);
          reject(new Error(msg));
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
 * Handle Google Sign In - Always show account chooser.
 *
 * On macOS the browser-action popup is closed by Chrome as soon as the OAuth
 * account chooser window takes focus, which destroys the popup's JS context
 * mid-flow and drops the user back on the login screen. To survive that we
 * delegate the whole sign-in to the service worker (which is not tied to the
 * popup). On Windows the direct popup flow is fast and reliable, so we keep it.
 */
async function handleGoogleSignIn() {
  showLoadingOverlay();
  try {
    const platform = await new Promise((resolve) => {
      try {
        chrome.runtime.getPlatformInfo((info) => resolve(info?.os || ""));
      } catch (_) {
        resolve("");
      }
    });

    if (platform === "mac") {
      // Delegate to the service worker. If the popup is destroyed while the
      // chooser is open, this promise is lost but the worker still completes
      // the sign-in; the auth observer shows the main UI on next popup open.
      const response = await chrome.runtime.sendMessage({ type: "googleSignIn" });
      if (!response?.success) {
        throw new Error(response?.error || "Sign-in failed");
      }
      showToast("Signed in with Google", "success");
      return;
    }

    // Windows / other platforms: direct flow.
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
    if (isOAuthCancelledError(error)) {
      // User canceled account selection — expected path, no error toast/log.
      hideLoading();
      return;
    }
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
    teardownAccountDocWatcher();
    // User pressed logout → this is a real sign-out, clear the cache.
    explicitSignOutInProgress = true;

    // Revoke Google token
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      // Access runtime.lastError to prevent unchecked callback errors when no grant exists.
      const err = chrome.runtime.lastError;
      if (err) return;
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          void chrome.runtime.lastError;
        });
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
      if (transientLogoutTimer) {
        clearTimeout(transientLogoutTimer);
        transientLogoutTimer = null;
      }
      state.setCurrentUser(user);
      showMainUI();
      setupAccountDocWatcher(user);

      try {
        chrome.runtime
          .sendMessage({ type: "userLoggedIn", userId: user.uid })
          .catch(() => {});
      } catch (e) {}

      if (onLogin) await onLogin(user);
    } else {
      teardownAccountDocWatcher();
      // Snapshot + reset the explicit-signout flag so a later transient
      // auth-null event is not mistaken for a real sign-out.
      const wasExplicit = explicitSignOutInProgress;
      explicitSignOutInProgress = false;

      // If we previously had an authenticated session and this wasn't explicit,
      // treat auth-null as potentially transient (token refresh / MV3 wake race).
      // Wait briefly; only commit logout if auth is still null afterwards.
      if (!wasExplicit && state.currentUser) {
        if (!transientLogoutTimer) {
          transientLogoutTimer = setTimeout(() => {
            transientLogoutTimer = null;
            if (auth.currentUser) return;
            state.setCurrentUser(null);
            showAuthUI();
            if (onLogout) onLogout({ explicit: false });
          }, 4500);
        }
        return;
      }

      state.setCurrentUser(null);
      showAuthUI();
      if (onLogout) onLogout({ explicit: wasExplicit });
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
