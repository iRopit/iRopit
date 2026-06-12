/**
 * Badge Service
 * Handles tab badge updates
 */

import * as state from "../state/index.js"

/**
 * Update all tab badges
 */
export function updateTabBadges() {
  const user = state.currentUser
  if (!user) return

  // Chat badge - count unread messages
  const chatUnread = state.cachedChatMessages.filter(
    (msg) => !msg.read && msg.senderId !== user.uid
  ).length
  updateBadge("chatBadge", chatUnread)

  // Count unread from the deduplicated merged list so the badge matches what
  // the "Show Unread" filter actually finds (avoids phantom counts from duplicates
  // in the per-device allSMS maps that were deduped out of allSMSMessages).
  const smsUnread = state.allSMSMessages.filter(m => !m.read).length;
  updateBadge("smsBadge", smsUnread)

  const missedCalls = getCallsCount("all")
  updateBadge("callsBadge", missedCalls)

  // Deduplicate by ID before counting — same notification can appear in both
  // "_user_notifications" and a device-specific collection, matching what
  // getMergedNotifications() shows in the UI.
  const seenIds = new Set();
  const notifUnread = Object.values(state.allNotifications)
    .flat()
    .filter(n => {
      if (seenIds.has(n.id)) return false;
      seenIds.add(n.id);
      return !n.read;
    }).length;
  updateBadge("notificationsBadge", notifUnread)

  // Update the extension icon badge directly from the popup context — this is
  // always reliable regardless of SW sleep state.
  const badgeText = notifUnread > 0 ? "●" : "";
  chrome.action.setBadgeText({ text: badgeText });
  if (notifUnread > 0) chrome.action.setBadgeBackgroundColor({ color: "#43A047" }); // green dot
  chrome.storage.local.set({ badgeCount: notifUnread });
  // Also update the SW's in-memory counter (best-effort; SW may be sleeping).
  chrome.runtime.sendMessage({ type: "syncBadge", count: notifUnread }, () => {
    void chrome.runtime.lastError;
  });

  // Refresh device tab counts in the left panel
  refreshDeviceTabCounts()
}

/**
 * Refresh unread counts shown next to device names in device tab panels.
 * Called automatically from updateTabBadges() so all mark-as-read actions stay in sync.
 */
function refreshDeviceTabCounts() {
  const sections = [
    { containerId: "smsDeviceTabs",           countFn: (id) => getSmsCount(id) },
    { containerId: "callsDeviceTabs",         countFn: (id) => getCallsCount(id) },
    { containerId: "notificationsDeviceTabs", countFn: (id) => getNotifsCount(id) },
  ]

  sections.forEach(({ containerId, countFn }) => {
    const container = document.getElementById(containerId)
    if (!container) return
    container.querySelectorAll(".device-tab").forEach(tab => {
      const deviceId = tab.dataset.device
      const count = countFn(deviceId)
      let countSpan = tab.querySelector(".device-tab-count")
      if (count > 0) {
        if (!countSpan) {
          countSpan = document.createElement("span")
          countSpan.className = "device-tab-count"
          tab.appendChild(countSpan)
        }
        countSpan.textContent = `(${count > 99 ? "99+" : count})`
      } else {
        countSpan?.remove()
      }
    })
  })
}

function getSmsCount(deviceId) {
  if (deviceId === "all") return state.allSMSMessages.filter(m => !m.read).length
  return state.allSMSMessages.filter(m => m.deviceId === deviceId && !m.read).length
}

function getCallsCount(deviceId) {
  const calls = state.allCallsData || []

  const normalizePhone = (phone) => {
    if (!phone || !phone.trim()) return ""
    let normalized = phone.replace(/[^\d+]/g, "").trim()
    normalized = normalized.replace(/^\+/, "")
    if (normalized.startsWith("20") && normalized.length > 10) normalized = normalized.substring(2)
    if (normalized.startsWith("971") && normalized.length > 10) normalized = normalized.substring(3)
    if (!normalized.startsWith("0") && (normalized.length === 9 || normalized.length === 10)) normalized = "0" + normalized
    return normalized
  }

  const isVisibleCall = (c) => {
    const phone = (c.phoneNumber || "").trim()
    const app = (c.appName || "").trim()
    const isPhantomVoIP = (!phone || phone.toLowerCase() === "unknown" || !normalizePhone(phone)) && !app
    return !isPhantomVoIP
  }

  const isUnreadMissed = (c) => c.type === "missed" && !c.viewed && isVisibleCall(c)

  // Count from the merged render source so the badge matches what's visible,
  // including shared devices that may not exist in state.devices.
  if (deviceId === "all") {
    return calls.filter(c => isUnreadMissed(c) && (!c.deviceId || state.getDeviceSyncPref(c.deviceId, "calls"))).length
  }

  return calls.filter(c => c.deviceId === deviceId && isUnreadMissed(c)).length
}

function getNotifsCount(deviceId) {
  if (deviceId === "all") return Object.values(state.allNotifications).flat().filter(n => !n.read).length
  return (state.allNotifications[deviceId] || []).filter(n => !n.read).length
}

function getDeviceCount(deviceId) {
  if (deviceId === "all") {
    return state.devices.reduce((total, d) => total + getDeviceCount(d.id), 0)
  }
  return getSmsCount(deviceId) + getCallsCount(deviceId) + getNotifsCount(deviceId)
}

/**
 * Update a single badge
 * @param {string} badgeId - Badge element ID
 * @param {number} count - Count to display
 */
function updateBadge(badgeId, count) {
  const badge = document.getElementById(badgeId)
  if (!badge) return

  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : count
    badge.style.display = "flex"
  } else {
    badge.style.display = "none"
  }
}
