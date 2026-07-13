/**
 * Badge Service
 * Handles tab badge updates
 */

import * as state from "../state/index.js"

const NOTIF_MIRROR_MAX_DRIFT_MS = 2500

function normalizeNotifTsMs(n) {
  const raw = Number(n?.receivedAt || n?.timestamp || n?.createdAt || 0)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return raw < 1e12 ? raw * 1000 : raw
}

function buildNotifContentKey(n) {
  if (!n) return null
  const app = String(n.packageName || n.appName || "").trim().toLowerCase()
  const title = String(n.title || "").trim().toLowerCase()
  const body = String(n.text || n.body || "").trim().toLowerCase()
  if (!app && !title && !body) return null
  const device = String(n.deviceId || "user")
  return `${device}|${app}|${title}|${body}`
}

function countDistinctUnreadNotifications(notifs) {
  const sorted = [...(notifs || [])].sort(
    (a, b) => normalizeNotifTsMs(b) - normalizeNotifTsMs(a),
  )
  const seenIds = new Set()
  const seenByContent = new Map()
  let count = 0

  for (const n of sorted) {
    if (!n || !n.id || n.read) continue

    // Fast-path dedup for exact duplicates.
    if (seenIds.has(n.id)) continue
    seenIds.add(n.id)

    // Secondary dedup for dual-writer / mirror duplicates with different ids.
    // Keep legitimate repeated notifications unless they are near-identical in time.
    const contentKey = buildNotifContentKey(n)
    const ts = normalizeNotifTsMs(n)
    if (contentKey && ts > 0) {
      const prevTs = seenByContent.get(contentKey)
      if (typeof prevTs === "number" && Math.abs(prevTs - ts) <= NOTIF_MIRROR_MAX_DRIFT_MS) {
        continue
      }
      seenByContent.set(contentKey, ts)
    }

    count += 1
  }

  return count
}

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

  // Keep top badges aligned with tab filtering rules (known linked devices,
  // sync preferences, and stale-cache pruning behavior).
  const smsUnread = getSmsCount("all")
  updateBadge("smsBadge", smsUnread)

  const missedCalls = getCallsCount("all")
  updateBadge("callsBadge", missedCalls)

  const notifUnread = getNotifsCount("all")
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
  const ownSmsDeviceIds = new Set(
    (state.devices || [])
      .filter(
        (d) =>
          (d.type === "mobile" ||
            d.type === "phone" ||
            d.platform === "android" ||
            d.platform === "Android" ||
            d.platform === "ios") &&
          d.id &&
          state.getDeviceSyncPref(d.id, "sms")
      )
      .map((d) => d.id)
  )
  const sharedSmsDeviceIds = new Set(
    (state.sharedWithMeDevices || [])
      .filter((s) => s?.deviceId && s?.permissions?.sms !== false)
      .map((s) => s.deviceId)
  )
  const hasAnyLinkedSmsDevice =
    ownSmsDeviceIds.size > 0 || sharedSmsDeviceIds.size > 0

  if (deviceId === "all") {
    if (!hasAnyLinkedSmsDevice) return 0
    return (state.allSMSMessages || []).filter((m) => {
      if (m.read) return false
      if (!m.deviceId) return false
      if (ownSmsDeviceIds.has(m.deviceId)) return true
      if (sharedSmsDeviceIds.has(m.deviceId)) return true
      return false
    }).length
  }
  return state.allSMSMessages.filter(m => m.deviceId === deviceId && !m.read).length
}

function getCallsCount(deviceId) {
  const calls = state.allCallsData || []

  // Keep calls badge at zero until Firestore confirms calls data. Cached calls
  // can be stale during startup and cause transient wrong counts (e.g. 2 -> 99+ -> 27).
  if (!state.callsDataConfirmed) return 0

  const sharedCallsDeviceIds = new Set(
    (state.sharedWithMeDevices || [])
      .filter((s) => s?.deviceId && s?.permissions?.calls !== false)
      .map((s) => s.deviceId)
  )

  const ownCallsDeviceIds = new Set(
    (state.devices || [])
      .filter(
        (d) =>
          (d.type === "mobile" ||
            d.type === "phone" ||
            d.platform === "android" ||
            d.platform === "Android" ||
            d.platform === "ios") &&
          d.id &&
          state.getDeviceSyncPref(d.id, "calls")
      )
      .map((d) => d.id)
  )
  const hasAnyLinkedCallsDevice =
    ownCallsDeviceIds.size > 0 || sharedCallsDeviceIds.size > 0

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

  const getCallBadgeKey = (c) => {
    const owner = String(c?.ownerUid || state.currentUser?.uid || "")
    const root = String(c?.sharedRootDeviceId || c?.deviceId || "")
    const docId = String(c?.id || "")
    if (docId) return `${owner}::${root}::${docId}`

    // Fallback for rare rows lacking doc id.
    const ts = Number(c?.timestamp || 0) || 0
    const normalizedPhone = normalizePhone(String(c?.phoneNumber || ""))
    const duration = Number(c?.duration || 0) || 0
    const callType = String(c?.type || "")
    return `${owner}::${root}::${callType}::${normalizedPhone}::${ts}::${duration}`
  }

  const countDistinctUnreadMissed = (rows) => {
    const seen = new Set()
    let count = 0
    ;(rows || []).forEach((c) => {
      if (!isUnreadMissed(c)) return
      const key = getCallBadgeKey(c)
      if (seen.has(key)) return
      seen.add(key)
      count += 1
    })
    return count
  }

  // Count from the merged render source so the badge matches what's visible,
  // including shared devices that may not exist in state.devices.
  if (deviceId === "all") {
    if (!hasAnyLinkedCallsDevice) return 0
    const visibleUnread = calls.filter((c) => {
      if (!c.deviceId) return false
      // While shared calls hydration is still pending, do not hide already-known
      // unread calls. We still count own calls immediately and include shared calls
      // that are already present in merged state.
      if (sharedCallsDeviceIds.has(c.deviceId)) return true
      return ownCallsDeviceIds.has(c.deviceId)
    })
    return countDistinctUnreadMissed(visibleUnread)
  }

  return countDistinctUnreadMissed(calls.filter(c => c.deviceId === deviceId))
}

function getNotifsCount(deviceId) {
  const ownNotifDeviceIds = new Set(
    (state.devices || [])
      .filter(
        (d) =>
          (d.type === "mobile" ||
            d.type === "phone" ||
            d.platform === "android" ||
            d.platform === "Android" ||
            d.platform === "ios") &&
          d.id &&
          state.getDeviceSyncPref(d.id, "notifications")
      )
      .map((d) => d.id)
  )
  const sharedNotifDeviceIds = new Set(
    (state.sharedWithMeDevices || [])
      .filter((s) => s?.deviceId && s?.permissions?.notifications !== false)
      .map((s) => s.deviceId)
  )
  const hasAnyLinkedNotifDevice =
    ownNotifDeviceIds.size > 0 || sharedNotifDeviceIds.size > 0

  if (deviceId === "all") {
    if (!hasAnyLinkedNotifDevice) return 0
    const unread = Object.values(state.allNotifications)
      .flat()
      .filter((n) => {
        if (!n || !n.id || n.read) return false
        if (ownNotifDeviceIds.has(n.deviceId)) return true
        if (sharedNotifDeviceIds.has(n.deviceId)) return true
        return false
      })
    return countDistinctUnreadNotifications(unread)
  }
  return countDistinctUnreadNotifications(state.allNotifications[deviceId] || [])
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
