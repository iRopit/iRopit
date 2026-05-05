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

  const notifUnread = state.devices.reduce(
    (total, d) => total + (state.allNotifications[d.id] || []).filter(n => !n.read).length, 0
  )
  updateBadge("notificationsBadge", notifUnread)

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
  // Don't show badge until Firestore has confirmed the data (prevents stale-cache flash)
  if (!state.callsDataConfirmed) return 0
  if (deviceId === "all") return state.devices.reduce((t, d) => t + getCallsCount(d.id), 0)
  // Use allCallsData (render source) to stay in sync with what's actually displayed
  return (state.allCallsData || []).filter(c => c.deviceId === deviceId && c.type === "missed" && !c.viewed).length
}

function getNotifsCount(deviceId) {
  if (deviceId === "all") return state.devices.reduce((t, d) => t + getNotifsCount(d.id), 0)
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
