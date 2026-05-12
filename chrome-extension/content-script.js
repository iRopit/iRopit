// iRopit Content Script - OTP Auto-Paste
// Receives OTP codes detected from mobile SMS and copies/pastes them

(function () {
  "use strict";

  // Guard against duplicate injection — the service worker may inject this
  // script programmatically in addition to the manifest content_scripts entry.
  if (window.__iropitOtpContentScriptLoaded) return;
  window.__iropitOtpContentScriptLoaded = true;

  // Listen for messages from the background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "otpDetected") {
      console.log("iRopit: 🔑 OTP message received", message.otp);
      handleOTP(message.otp, message.sender, message.body);
      sendResponse({ success: true });
    }
    if (message.type === "universalCopy" && message.text) {
      navigator.clipboard.writeText(message.text).catch(() => {
        fallbackCopy(message.text);
      });
      sendResponse({ success: true });
    }
    return false;
  });

  function handleOTP(otp, sender, body) {
    // The service worker already copied OTP to clipboard via offscreen API.
    // Show toast and auto-paste IMMEDIATELY — do NOT gate them on
    // navigator.clipboard.writeText which fails when page isn't focused.
    showOTPToast(otp, sender);
    autoPasteOTP(otp);

    // Best-effort secondary clipboard write (succeeds when page is focused)
    navigator.clipboard.writeText(otp).catch(() => fallbackCopy(otp));
  }

  function autoPasteOTP(otp) {
    // Bring the window into focus so input events are accepted
    window.focus();

    // Priority 1: input with autocomplete="one-time-code"
    const otcInput = document.querySelector('input[autocomplete="one-time-code"]');
    if (otcInput && isVisible(otcInput)) {
      fillInput(otcInput, otp);
      return;
    }

    // Priority 2: multiple single-character inputs (digit-by-digit OTP boxes)
    // e.g. 6 inputs each with maxLength=1 — common on banking/auth sites
    const singleBoxes = [...document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type])')].filter(
      (el) => isVisible(el) && el.maxLength === 1
    );
    if (singleBoxes.length >= 4 && singleBoxes.length <= 8 && otp.length <= singleBoxes.length) {
      singleBoxes.slice(0, otp.length).forEach((el, i) => fillInput(el, otp[i]));
      return;
    }

    // Priority 3: currently focused input that accepts text/numbers
    const focused = document.activeElement;
    if (focused && isTextInput(focused) && isVisible(focused)) {
      fillInput(focused, otp);
      return;
    }

    // Priority 4: visible input that looks like an OTP field (short max-length 4-8)
    const candidates = [...document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type])')];
    const otpField = candidates.find(
      (el) => isVisible(el) && el.maxLength >= 4 && el.maxLength <= 8
    );
    if (otpField) {
      fillInput(otpField, otp);
      return;
    }

    // Priority 5: any visible text-like input as last resort
    const anyInput = candidates.find((el) => isVisible(el) && isTextInput(el));
    if (anyInput) fillInput(anyInput, otp);
  }

  function fillInput(el, value) {
    el.focus();

    // React/Angular/Vue-compatible value setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (nativeInputValueSetter && nativeInputValueSetter.set) {
      nativeInputValueSetter.set.call(el, value);
    } else {
      el.value = value;
    }

    // Dispatch keyboard and input events so all frameworks detect the change
    el.dispatchEvent(new KeyboardEvent("keydown",  { bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup",    { bubbles: true, cancelable: true }));
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

    // Inject keyframe animation once
    if (!document.getElementById("iropit-otp-style")) {
      const style = document.createElement("style");
      style.id = "iropit-otp-style";
      style.textContent = `
        @keyframes iropit-slide-in {
          from { transform: translateX(calc(100% + 20px)); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    const toast = document.createElement("div");
    toast.id = "iropit-otp-toast";
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
      border-left: 4px solid #6c63ff;
      border-radius: 10px;
      padding: 14px 18px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      display: flex;
      flex-direction: column;
      gap: 5px;
      min-width: 230px;
      animation: iropit-slide-in 0.25s ease forwards;
      pointer-events: none;
    `;

    const label = document.createElement("div");
    label.style.cssText = "font-size: 10px; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600;";
    label.textContent = sender ? `OTP from ${sender}` : "OTP Copied";

    const code = document.createElement("div");
    code.style.cssText = "font-size: 24px; font-weight: 800; letter-spacing: 6px; color: #a78bfa; line-height: 1.2;";
    code.textContent = otp;

    const hint = document.createElement("div");
    hint.style.cssText = "font-size: 11px; opacity: 0.55;";
    hint.textContent = "✓ Copied to clipboard";

    toast.appendChild(label);
    toast.appendChild(code);
    toast.appendChild(hint);
    document.body.appendChild(toast);

    // Auto-dismiss: visible for ~2.5 s, then 0.5 s fade out
    setTimeout(() => {
      toast.style.transition = "opacity 0.5s ease, transform 0.5s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateX(calc(100% + 20px))";
      setTimeout(() => toast.remove(), 500);
    }, 2500);
  }
})();
