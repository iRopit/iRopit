/**
 * DOM Elements module
 * Centralized access to all DOM elements
 */

// Auth containers
export const authContainer = document.getElementById("authContainer");
export const mainContainer = document.getElementById("mainContainer");
export const loginForm = document.getElementById("loginForm");
export const signupForm = document.getElementById("signupForm");
export const loadingOverlay = document.getElementById("loadingOverlay");
export const toastContainer = document.getElementById("toastContainer");

// Auth elements
export const loginEmail = document.getElementById("loginEmail");
export const loginPassword = document.getElementById("loginPassword");
export const loginBtn = document.getElementById("loginBtn");
export const googleLoginBtn = document.getElementById("googleLoginBtn");
export const showSignup = document.getElementById("showSignup");
export const signupName = document.getElementById("signupName");
export const signupEmail = document.getElementById("signupEmail");
export const signupPassword = document.getElementById("signupPassword");
export const signupBtn = document.getElementById("signupBtn");
export const googleSignupBtn = document.getElementById("googleSignupBtn");
export const showLogin = document.getElementById("showLogin");
export const logoutBtn = document.getElementById("logoutBtn");

// User info elements (inside Chat tab)
export const userAvatarChat = document.getElementById("userAvatarChat");
export const userNameChat = document.getElementById("userNameChat");
export const userEmailChat = document.getElementById("userEmailChat");
export const logoutBtnChat = document.getElementById("logoutBtnChat");

// Tabs
export const tabs = document.querySelectorAll(".tab");
export const tabContents = document.querySelectorAll(".tab-content");

// Chat elements
export const chatInput = document.getElementById("chatInput");
export const sendChatBtn = document.getElementById("sendChatBtn");
export const chatMessages = document.getElementById("chatMessages");

// Action buttons
export const markAllReadBtn = document.getElementById("markAllReadBtn");
export const deleteAllSmsBtn = document.getElementById("deleteAllSmsBtn");

// Settings Modal
export const settingsBtn = document.getElementById("settingsBtn");
export const settingsModal = document.getElementById("settingsModal");
export const closeSettingsBtn = document.getElementById("closeSettingsBtn");

// Lists
export const smsList = document.getElementById("smsList");
export const callsList = document.getElementById("callsList");
export const devicesList = document.getElementById("devicesList");
export const notificationsList = document.getElementById("notificationsList");

// Theme toggle
export const themeToggleBtn = document.getElementById("themeToggleBtn");
export const themeIconLight = document.getElementById("themeIconLight");
export const themeIconDark = document.getElementById("themeIconDark");

// Language toggle
export const langToggleBtn = document.getElementById("langToggleBtn");
export const langToggleLabel = document.getElementById("langToggleLabel");
