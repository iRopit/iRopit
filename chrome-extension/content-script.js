// iRopit Content Script - OTP Auto-Paste
// Receives OTP codes detected from mobile SMS and copies/pastes them

(function () {
  "use strict";

  // Listen for messages from the background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "otpDetected") {
      handleOTP(message.otp, message.sender, message.body);
      sendResponse({ success: true });
    }
    return false;
  });

  function handleOTP(otp, sender, body) {
    // 1. Copy OTP to clipboard
    navigator.clipboard
      .writeText(otp)
      .then(() => {
        // 2. Try to auto-paste into focused / OTP input
        autoPasteOTP(otp);
        // 3. Show in-page toast
        showOTPToast(otp, sender);
      })
      .catch((err) => {
        // Fallback: use execCommand
        fallbackCopy(otp);
        autoPasteOTP(otp);
        showOTPToast(otp, sender);
      });
  }

  function autoPasteOTP(otp) {
    // Priority 1: input with autocomplete="one-time-code"
    const otcInput = document.querySelector('input[autocomplete="one-time-code"]');
    if (otcInput) {
      fillInput(otcInput, otp);
      return;
    }

    // Priority 2: currently focused input that accepts text/numbers
    const focused = document.activeElement;
    if (focused && isTextInput(focused)) {
      fillInput(focused, otp);
      return;
    }

    // Priority 3: visible input that looks like an OTP field (short max-length)
    const candidates = [...document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type])')];
    const otpField = candidates.find(
      (el) => isVisible(el) && el.maxLength >= 4 && el.maxLength <= 8
    );
    if (otpField) {
      fillInput(otpField, otp);
    }
  }

  function fillInput(el, value) {
    el.focus();
    // React-friendly value setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    );
    if (nativeInputValueSetter) {
      nativeInputValueSetter.set.call(el, value);
    } else {
      el.value = value;
    }
    // Fire change/input events so frameworks (React, Angular, Vue) pick it up
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isTextInput(el) {
    if (!el || el.tagName !== "INPUT") return false;
    const type = (el.type || "text").toLowerCase();
    return ["text", "number", "tel", "password", ""].includes(type) && !el.disabled && !el.readOnly;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
      window.getComputedStyle(el).visibility !== "hidden" &&
      window.getComputedStyle(el).display !== "none";
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function showOTPToast(otp, sender) {
    // Remove existing toast
    const existing = document.getElementById("iropit-otp-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "iropit-otp-toast";
    toast.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #1a1a2e;
      color: #fff;
      border-left: 4px solid #6c63ff;
      border-radius: 8px;
      padding: 12px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 220px;
      animation: iropit-slide-in 0.3s ease;
    `;

    const style = document.createElement("style");
    style.textContent = `
      @keyframes iropit-slide-in {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);

    const label = document.createElement("div");
    label.style.cssText = "font-size: 11px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.5px;";
    label.textContent = sender ? `OTP from ${sender}` : "OTP Detected";

    const code = document.createElement("div");
    code.style.cssText = "font-size: 22px; font-weight: 700; letter-spacing: 4px; color: #a78bfa;";
    code.textContent = otp;

    const hint = document.createElement("div");
    hint.style.cssText = "font-size: 11px; opacity: 0.6;";
    hint.textContent = "Copied to clipboard";

    toast.appendChild(label);
    toast.appendChild(code);
    toast.appendChild(hint);
    document.body.appendChild(toast);

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      toast.style.transition = "opacity 0.4s";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    }, 8000);
  }
})();
