/**
 * Utility helper functions
 */

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - Raw string to escape
 * @returns {string} HTML-safe string
 */
export function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Sanitize a URL - only allow http/https protocols
 * @param {string} url - URL to sanitize
 * @returns {string} Sanitized URL or empty string
 */
export function sanitizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return url;
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Get friendly device name (prefer nickname, then human-readable name)
 * @param {Object} device - Device object with nickname, name, model, platform, id
 * @returns {string} Human-readable device name
 */
export function getFriendlyDeviceName(device) {
  if (!device) return "Device";

  // First priority: nickname set by user
  if (device.nickname) return device.nickname;

  // Second priority: name if it looks human-readable (contains letters, not just model number)
  if (
    device.name &&
    /[a-zA-Z]/.test(device.name) &&
    !/^[A-Z0-9]+$/.test(device.name)
  ) {
    return device.name;
  }

  // Third priority: platform-based friendly name (case-insensitive)
  const platform = (device.platform || "").toLowerCase();
  if (platform === "ios") return "iPhone";
  if (platform === "android") return "Android";

  // Last resort
  return "Device";
}

/**
 * Format timestamp to human-readable time
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted time string
 */
export function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();

  const time = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  // Today
  if (date.toDateString() === now.toDateString()) return `Today ${time}`;

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;

  // Older: date + time
  return `${date.toLocaleDateString("en-GB")} ${time}`;
}

/**
 * Format duration in seconds to mm:ss format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
export function formatDuration(seconds) {
  if (!seconds) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Get initials from a name
 * @param {string} name - Full name
 * @returns {string} Initials (2 characters)
 */
export function getInitials(name) {
  if (!name) return "?";
  const words = name.trim().split(" ");
  if (words.length >= 2) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

/**
 * Generate unique device ID for this extension
 * @returns {Promise<string>} Device ID
 */
export async function getDeviceId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["deviceId"], (result) => {
      if (result.deviceId) {
        resolve(result.deviceId);
      } else {
        const newId = "ext_" + Math.random().toString(36).substr(2, 9);
        chrome.storage.local.set({ deviceId: newId });
        resolve(newId);
      }
    });
  });
}

/**
 * Get platform icon SVG for device
 * @param {string} platform - Platform name
 * @returns {string} SVG HTML
 */
export function getPlatformIcon(platform) {
  const isPhone =
    platform === "android" ||
    platform === "Android" ||
    platform === "ios" ||
    platform === "phone";

  if (isPhone) {
    // phone-portrait-outline (Ionicons style)
    return `<svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
      <rect x="128" y="16" width="256" height="480" rx="48" ry="48"/>
      <line x1="256" y1="432" x2="256.01" y2="432" stroke-width="48" stroke-linecap="round"/>
    </svg>`;
  } else {
    // laptop-outline (Ionicons style)
    return `<svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round">
      <rect x="48" y="80" width="416" height="288" rx="32" ry="32"/>
      <line x1="16" y1="416" x2="496" y2="416"/>
    </svg>`;
  }
}

/**
 * Get app icon based on notification type
 * @param {string} type - Notification type
 * @returns {string} SVG HTML
 */
export function getAppIcon(type) {
  const icons = {
    sms: `<svg width="20" height="20" viewBox="0 0 24 24" fill="#4CAF50" stroke="none">
      <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 11H7V9h2v2zm4 0h-2V9h2v2zm4 0h-2V9h2v2z"/>
    </svg>`,
    whatsapp: `<svg width="20" height="20" viewBox="0 0 24 24" fill="#25D366" stroke="none">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
    </svg>`,
    telegram: `<svg width="20" height="20" viewBox="0 0 24 24" fill="#0088cc" stroke="none">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>`,
  };
  return icons[type] || icons.sms;
}

/**
 * Get call icon based on call type
 * @param {string} type - Call type (incoming, outgoing, missed)
 * @returns {string} SVG HTML
 */
export function getCallIcon(type) {
  if (type === "incoming") {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--incoming)" stroke-width="2">
      <polyline points="7 17 17 7"/><polyline points="7 7 7 17 17 17"/>
    </svg>`;
  } else if (type === "outgoing") {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--outgoing)" stroke-width="2">
      <polyline points="17 7 7 17"/><polyline points="17 17 17 7 7 7"/>
    </svg>`;
  } else {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--missed)" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;
  }
}

/**
 * Get notification icon based on type or app name
 * @param {string} type - Notification type
 * @param {string} appName - App name
 * @returns {string} Emoji icon
 */
export function getNotificationIcon(type, appName) {
  const appLower = (appName || "").toLowerCase();
  if (appLower.includes("whatsapp")) return "📱";
  if (appLower.includes("telegram")) return "✈️";
  if (appLower.includes("messenger")) return "💬";
  if (appLower.includes("mail") || appLower.includes("gmail")) return "📧";
  if (appLower.includes("phone") || appLower.includes("call")) return "📞";
  if (appLower.includes("message") || appLower.includes("sms")) return "💬";
  if (appLower.includes("calendar")) return "📅";

  if (type === "sms") return "💬";
  if (type === "call") return "📞";
  if (type === "whatsapp") return "📱";
  if (type === "telegram") return "✈️";

  return "🔔";
}
