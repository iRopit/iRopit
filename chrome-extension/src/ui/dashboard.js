/**
 * Dashboard Module
 * Shows summary stats (SMS, Calls, Notifications) filtered by date range
 * and a per-date breakdown of notifications.
 */

import { translations, getCurrentLanguage } from "../utils/i18n.js";
import * as state from "../state/index.js";
import { getFriendlyDeviceName, getPlatformIcon } from "../utils/helpers.js";

/** Shorthand translator */
function t(key) {
  const lang = getCurrentLanguage();
  return (translations[lang] && translations[lang][key]) || translations["en"][key] || key;
}

const CACHE_KEYS = {
  SMS: "cached_sms_data",
  CALLS: "cached_calls_data",
  NOTIFICATIONS: "cached_notifications_data",
};

// Guard against async render races: only latest render may update the UI.
let dashboardRenderSeq = 0;

/** Format a JS Date as YYYY-MM-DD */
function toDateStr(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format a date string (YYYY-MM-DD) to a readable label */
function formatDateLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const lang = getCurrentLanguage();
  const locale = lang === "ar" ? "ar-EG" : undefined;
  return d.toLocaleDateString(locale, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

/**
 * Load all raw data for the dashboard.
 * Prefer in-memory state (already decrypted by popup services) over
 * chrome.storage (which may contain raw encrypted Firestore docs from the
 * service-worker background refresh and have unreadable timestamps).
 * Falls back to chrome.storage only when state arrays are empty.
 */
async function loadRawData() {
  // SMS: union state.allSMSMessages with the local-storage cache and dedupe.
  //
  // Why a union: the per-device Firestore listeners fire incrementally. After dev1
  // fires, state.allSMSMessages is just dev1's messages; after dev2 fires the merge
  // is complete. The cache (debounced 3s) holds the last fully-merged snapshot.
  // Reading both and deduping by content gives the most complete picture regardless
  // of where in the load cycle we are, eliminating the count flip between popup
  // open and Apply press.
  const result = await chrome.storage.local.get([
    CACHE_KEYS.SMS,
    CACHE_KEYS.CALLS,
    CACHE_KEYS.NOTIFICATIONS,
  ]);

  const stateSms = state.allSMSMessages || [];
  const cacheSms = result[CACHE_KEYS.SMS]?.allMessages || [];

  const seenIds = new Set();
  const seenContent = new Set();
  const allSms = [];
  for (const msg of [...stateSms, ...cacheSms]) {
    const uniqueId = msg.docId || msg.id || msg.docRef?.path || `${msg.timestamp}_${msg.phoneNumber || msg.sender || ""}`;
    if (seenIds.has(uniqueId)) continue;
    seenIds.add(uniqueId);

    const phone = ((msg.phoneNumber || msg.sender || "") + "").trim().toLowerCase();
    const body = ((msg.body || msg.text || "") + "").trim().substring(0, 100);
    const timeWindow = Math.floor((msg.timestamp || 0) / 300000);
    const contentKey = `${phone}_${timeWindow}_${body}`;
    const bodyKey = body.length > 20 ? `body_${timeWindow}_${body}` : null;
    if (seenContent.has(contentKey)) continue;
    if (bodyKey && seenContent.has(bodyKey)) continue;
    seenContent.add(contentKey);
    if (bodyKey) seenContent.add(bodyKey);

    allSms.push(msg);
  }

  // --- Calls: merge from all in-memory sources to maximise coverage ---
  const callsFromFlat   = state.allCallsData || [];
  const callsByDeviceFlat = Object.values(state.allCallsByDevice || {}).flat();

  // --- Notifications: pick a SINGLE source for stability ---
  // The mobile app writes the same notification to TWO Firestore paths:
  //   1) users/{uid}/notifications              (user-level, deviceId:"user")
  //   2) users/{uid}/devices/{deviceId}/notifications   (per-device, real deviceId)
  //
  // Mixing state + cache caused counts to flap between refreshes because the
  // cache holds slice(0,500) while state may hold delta-merged data of a
  // different size. We pick ONE source: prefer the fully-loaded state, fall
  // back to cache only when state is still empty (initial popup paint).
  const stateNotifFlat = state.allNotificationsMessages || [];
  const cacheNotifFlat = Object.values(
    result[CACHE_KEYS.NOTIFICATIONS]?.byDevice || {}
  ).flat();
  const sourceNotifs = stateNotifFlat.length > 0 ? stateNotifFlat : cacheNotifFlat;

  // Dedup by content + day-bucket. Same notification copies across the two
  // Firestore paths share the same content and same calendar day. Using a day
  // bucket (instead of minute) avoids the count flapping when one copy's
  // `receivedAt` falls back to `Date.now()` and lands ms apart from the other.
  // Same content on different days remains as separate entries (legit repeats).
  const isRealDevice = (did) =>
    did && did !== "user" && did !== "_user_notifications";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const notifByBucket = new Map();
  for (const n of sourceNotifs) {
    const title = (n.title || n.appName || "").trim();
    const body = String(n.body || n.text || "").trim().slice(0, 200);
    if (!title && !body) continue;
    const ts = getEventTs(n, ["timestamp", "createdAt", "receivedAt", "date", "time"]);
    const dayBucket = ts > 0 ? Math.floor(ts / DAY_MS) : 0;
    const bucket = `${title}|${body}|${dayBucket}`;
    const existing = notifByBucket.get(bucket);
    if (!existing) {
      notifByBucket.set(bucket, n);
    } else if (!isRealDevice(existing.deviceId) && isRealDevice(n.deviceId)) {
      // Upgrade to the entry that has a real device ID
      notifByBucket.set(bucket, n);
    }
  }
  let allNotifs = Array.from(notifByBucket.values());

  let storageAllCalls = result[CACHE_KEYS.CALLS]?.allCalls || [];
  // Deduplicate calls across all sources.
  const callsById = new Map();
  for (const call of [...storageAllCalls, ...callsByDeviceFlat, ...callsFromFlat]) {
    const key = call.id || call.key;
    if (key && !callsById.has(key)) callsById.set(key, call);
    else if (!key) callsById.set(Symbol(), call);
  }
  const allCalls = Array.from(callsById.values());

  console.log(`[Dashboard] loadRawData: sms=${allSms.length} (state=${stateSms.length}, cache=${cacheSms.length}), calls=${allCalls.length}, notifs=${allNotifs.length}`);

  return { allSms, allCalls, allNotifs };
}

/** Set default date range: from = 7 days ago, to = today */
function setDefaultDates() {
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(today.getDate() - 6);

  const fromInput = document.getElementById("dashFromDate");
  const toInput = document.getElementById("dashToDate");

  if (fromInput && !fromInput.value) {
    fromInput.value = toDateStr(weekAgo.getTime());
  }
  if (toInput && !toInput.value) {
    toInput.value = toDateStr(today.getTime());
  }
}

/** Get the start-of-day timestamp for a YYYY-MM-DD string */
function dayStart(dateStr) {
  return new Date(dateStr + "T00:00:00").getTime();
}

/** Get the end-of-day timestamp for a YYYY-MM-DD string */
function dayEnd(dateStr) {
  return new Date(dateStr + "T23:59:59.999").getTime();
}

/**
 * Read a timestamp from a record using known fields.
 * Handles: plain ms/s numbers, Firestore Timestamp objects {seconds,nanoseconds}, ISO strings.
 */
function getEventTs(record, preferredKeys = []) {
  if (!record || typeof record !== "object") return 0;
  const fallbackKeys = ["timestamp", "receivedAt", "callDate", "date", "createdAt", "time", "ts"];
  const keys = preferredKeys.length > 0 ? preferredKeys : fallbackKeys;

  for (const key of keys) {
    const raw = record[key];
    if (raw == null) continue;

    // Firestore Timestamp object: { seconds: N, nanoseconds: M }
    if (typeof raw === "object" && typeof raw.seconds === "number") {
      const ms = raw.seconds * 1000 + Math.floor((raw.nanoseconds || 0) / 1e6);
      if (ms > 0) return ms;
      continue;
    }

    // ISO date / datetime string (e.g. "2026-05-07T00:00:00Z" or "2026-05-07")
    if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const ms = new Date(raw).getTime();
      if (Number.isFinite(ms) && ms > 0) return ms;
      continue;
    }

    // Plain number (ms or s)
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    return n < 1e12 ? n * 1000 : n;
  }

  return 0;
}

/** Render the dashboard with current filter values */
async function renderDashboard() {
  const renderSeq = ++dashboardRenderSeq;

  const fromInput = document.getElementById("dashFromDate");
  const toInput = document.getElementById("dashToDate");
  const smsCountEl = document.getElementById("dashSmsCount");
  const callsCountEl = document.getElementById("dashCallsCount");
  const notifCountEl = document.getElementById("dashNotifCount");
  const breakdownList = document.getElementById("dashBreakdownList");

  if (!fromInput || !toInput || !breakdownList) return;

  const fromVal = fromInput.value;
  const toVal = toInput.value;

  if (!fromVal || !toVal) {
    breakdownList.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <p>${t("dash_select_range")}</p>
    </div>`;
    return;
  }

  const fromTs = dayStart(fromVal);
  const toTs = dayEnd(toVal);

  const { allSms, allCalls, allNotifs } = await loadRawData();

  // A newer render started while we were awaiting data; abandon stale result.
  if (renderSeq !== dashboardRenderSeq) return;

  // Filter by date range
  const filteredSms = allSms.filter((m) => {
    const ts = getEventTs(m, ["timestamp", "createdAt", "receivedAt", "date", "time"]);
    return ts >= fromTs && ts <= toTs;
  });

  const filteredCalls = allCalls.filter((c) => {
    const ts = getEventTs(c, ["timestamp", "callDate", "receivedAt", "date", "createdAt", "time"]);
    return ts >= fromTs && ts <= toTs;
  });

  const filteredNotifs = allNotifs.filter((n) => {
    const ts = getEventTs(n, ["timestamp", "createdAt", "receivedAt", "date", "time"]);
    return ts >= fromTs && ts <= toTs;
  });

  // Populate the insights device tabs (only mobile devices) — always render first
  updateInsightsDeviceTabs();

  // Get selected device and apply to ALL data sources
  const insightsDeviceTabs = document.getElementById("dashInsightsDeviceTabs");
  const selectedInsightsDevice =
    insightsDeviceTabs?.querySelector(".device-tab.active")?.dataset.device || "all";

  // Build set of mobile device IDs shown in the sidebar (excludes extension).
  // "All Devices" counts only records belonging to these IDs so the total
  // equals exactly the sum of per-device tabs. Orphan records (stale deviceId
  // from a deleted/old device, or "user"/"_user_notifications" user-level
  // entries that don't belong to any specific phone) are excluded everywhere.
  const mobileDeviceIds = new Set(
    (state.devices || [])
      .filter((d) => {
        const platform = (d.platform || "").toLowerCase();
        const type = (d.type || "").toLowerCase();
        return (
          type === "mobile" ||
          type === "phone" ||
          type === "tablet" ||
          platform === "android" ||
          platform === "ios"
        );
      })
      .map((d) => d.id || d.docId)
  );

  // Fallback: if state.devices isn't loaded yet, derive the device-id set
  // from the actual data (SMS / calls have a real deviceId, never "user").
  // Excludes user-level notification keys so All == sum(perDevice).
  if (mobileDeviceIds.size === 0) {
    for (const m of filteredSms) {
      if (m.deviceId && m.deviceId !== "user" && m.deviceId !== "_user_notifications") {
        mobileDeviceIds.add(m.deviceId);
      }
    }
    for (const c of filteredCalls) {
      if (c.deviceId && c.deviceId !== "user" && c.deviceId !== "_user_notifications") {
        mobileDeviceIds.add(c.deviceId);
      }
    }
  }

  // All three data types:
  // SMS + Calls: restrict to known mobile device IDs.
  // Notifications "All Devices": include all date-filtered notifications regardless
  // of deviceId. The mobile app writes each notification to TWO Firestore paths
  // (user-level deviceId:"user" + per-device). The content+day-bucket dedup in
  // loadRawData merges duplicates to one entry, but the surviving entry may keep
  // deviceId:"user" if it was the only copy seen. Restricting to mobileDeviceIds
  // would silently drop those, making the count ~3x lower than reality.
  // Per-device tabs still filter to exact deviceId match only.
  const isUserLevel = (did) => did === "user" || did === "_user_notifications";
  const deviceFilteredSms = selectedInsightsDevice === "all"
    ? filteredSms.filter((m) => mobileDeviceIds.has(m.deviceId))
    : filteredSms.filter((m) => m.deviceId === selectedInsightsDevice);
  const deviceFilteredCalls = selectedInsightsDevice === "all"
    ? filteredCalls.filter((c) => mobileDeviceIds.has(c.deviceId))
    : filteredCalls.filter((c) => c.deviceId === selectedInsightsDevice);
  const deviceFilteredNotifs = selectedInsightsDevice === "all"
    ? filteredNotifs
    : filteredNotifs.filter((n) => n.deviceId === selectedInsightsDevice);

  // Update stat counters (device-filtered)
  if (smsCountEl) smsCountEl.textContent = deviceFilteredSms.length;
  if (callsCountEl) callsCountEl.textContent = deviceFilteredCalls.length;
  if (notifCountEl) notifCountEl.textContent = deviceFilteredNotifs.length;

  // Group notifications by date (descending)
  const byDate = {};
  for (const n of deviceFilteredNotifs) {
    const ts = getEventTs(n, ["timestamp", "createdAt", "receivedAt", "date", "time"]);
    const dateKey = toDateStr(ts);
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push({ ...n, _ts: ts });
  }

  // Also add SMS and Calls counts per date (for the pill summary)
  const smsByDate = {};
  for (const m of deviceFilteredSms) {
    const ts = getEventTs(m, ["timestamp", "createdAt", "receivedAt", "date", "time"]);
    const dk = toDateStr(ts);
    smsByDate[dk] = (smsByDate[dk] || 0) + 1;
  }

  const callsByDate = {};
  for (const c of deviceFilteredCalls) {
    const ts = getEventTs(c, ["timestamp", "callDate", "receivedAt", "date", "createdAt", "time"]);
    const dk = toDateStr(ts);
    callsByDate[dk] = (callsByDate[dk] || 0) + 1;
  }

  // Collect all dates that have at least something
  const allDates = new Set([
    ...Object.keys(byDate),
    ...Object.keys(smsByDate),
    ...Object.keys(callsByDate),
  ]);

  const sortedDates = Array.from(allDates).sort((a, b) => b.localeCompare(a));

  // SMS is the primary source. Notifications are included as a secondary source but only
  // when a same-date SMS does not already cover that exact currency:amount:type combination.
  // This captures salary/credit alerts delivered only via push notification while preventing
  // double-counting for banks that send both an SMS and a push for the same debit event.
  //
  // Extend the notification window by +1 day beyond toTs so that notifications delivered
  // the morning after an end-of-day SMS (e.g. ADIB salary push arriving May 2 for a May 1
  // credit) are still included in insights. The date used for the spending-by-date breakdown
  // is clamped back to toTs so it never appears outside the selected range.
  const insightNotifToTs = toTs + 24 * 60 * 60 * 1000;
  const insightNotifs = allNotifs.filter((n) => {
    const ts = getEventTs(n, ["timestamp", "createdAt", "receivedAt", "date", "time"]);
    if (ts < fromTs || ts > insightNotifToTs) return false;
    if (selectedInsightsDevice === "all") return true;
    return n.deviceId === selectedInsightsDevice;
  });
  renderSmsInsights(deviceFilteredSms, insightNotifs, toTs);

  if (sortedDates.length === 0) {
    breakdownList.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <p>${t("dash_no_data")}</p>
    </div>`;
    return;
  }

  const html = sortedDates.map((dateKey) => {
    const notifs = (byDate[dateKey] || []).sort((a, b) => b._ts - a._ts);
    const smsCount = smsByDate[dateKey] || 0;
    const callCount = callsByDate[dateKey] || 0;
    const notifCount = (byDate[dateKey] || []).length;

    const pills = [
      smsCount > 0 ? `<span class="dash-count-pill sms">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        ${smsCount}</span>` : "",
      callCount > 0 ? `<span class="dash-count-pill calls">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>
        ${callCount}</span>` : "",
      notifCount > 0 ? `<span class="dash-count-pill notif">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
        ${notifCount}</span>` : "",
    ].filter(Boolean).join("");

    return `<div class="dash-date-group">
      <div class="dash-date-group-header">
        <span class="dash-date-label">${formatDateLabel(dateKey)}</span>
        <span class="dash-date-count">${pills}</span>
      </div>
    </div>`;
  }).join("");

  breakdownList.innerHTML = html;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── SMS Spending Analysis ─────────────────────────────────────────────────────

/**
 * Supported currency symbols/codes and their display symbol.
 * Order matters: longer codes first to avoid partial matches.
 */
const CURRENCY_MAP = {
  SAR: "SAR", AED: "AED", KWD: "KWD", BHD: "BHD", QAR: "QAR", OMR: "OMR",
  EGP: "EGP", JOD: "JOD", USD: "USD", GBP: "GBP", EUR: "EUR", INR: "INR",
  PKR: "PKR", MYR: "MYR", TRY: "TRY",
  "$": "USD", "£": "GBP", "€": "EUR", "₹": "INR", "﷼": "SAR",
};

const CURRENCY_REGEX_STR =
  "(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|\\$|£|€|₹|﷼)";

// Keywords that indicate a DEBIT (spending)
// Proximity-based debit/credit keywords (checked within ±120 chars of each amount)
const DEBIT_KEYWORDS = /\b(debited|debit|charged|charge|paid|payment|purchase|bought|withdrawn|withdrawal|deducted|deduct|sent|used\s+for|has\s+been\s+used|transfer(?:red)?\s+(?:to|from\s+your))\b|(?:تم\s*خصم|خصم|عملية\s*شراء|شراء|سحب|مدفوعة|دفع|استخدام\s*بطاقة|استخدام\s*البطاقة)/i;
// "received" alone is NOT a credit keyword ("we received your payment" = DEBIT).
// Only match "received" when immediately followed by in/into/to + your/the (money arriving in your account).
// Arabic: 'تم تنفيذ تحويل ... إلى حسابك' (CIB IPN inward transfer) is a credit.
const CREDIT_KEYWORDS = /\b(credited|deposited|deposit|refund|cashback|returned|reversed|salary|transferred\s+to\s+your|received\s+(?:in(?:to)?|to)\s+(?:your|the)|incoming\s+(?:transfer|wire|payment|fund|funds?))\b|(?:تم\s*(?:ايداع|إيداع|اضافة|إضافة|تحويل)|ايداع|إيداع|استرداد|مرتجع|راتب|تحويل\s*وارد|إلى\s*حسابك|الى\s*حسابك)/i;
// STRONG credit signals — these OVERRIDE weak debit words (payment, transfer) in the context.
// "was credited to your account" is always a credit even if "payment" appears nearby.
// 'reversed' (refund-style credit) is also strong — it always indicates funds returning.
const STRONG_CREDIT_RE = /\b(credited|deposited|reversed)\b/i;
// STRONG debit signals — these override strong credit (can't be both credited AND debited).
const STRONG_DEBIT_RE = /\b(debited|deducted|deduct|withdrawn|withdrawal|charged)\b/i;
// Credit card bill payment confirmations — "Your Payment of AED X for card XXXX has been processed"
// Counted as CREDIT (card balance reduced / payment received by card account).
const CARD_BILL_PAYMENT_RE = /\bpayment\b.{0,80}\bfor\s+card\b.{0,80}\bhas\s+been\s+processed\b/i;
// Pending/future-tense signals — if present alongside a credit keyword, the transaction hasn't happened yet
const PENDING_RE = /\bwill\s+be\b|\bon\s+its\s+way\b|\bpending\b|\bprocessing\b|\bwithin\s+\d+\s+(?:business\s+)?days\b/i;

// Mask balance figures — keyword BEFORE amount: "balance: AED 5,000" OR "limit is AED 5,000"
const BALANCE_MASK_RE_A = /\b(balance|bal\.?|avail(?:able)?\.?|remaining|rem\.?|limit|outstanding|due|minimum|min\.?|opening|closing|cr\.?\s*bal|dr\.?\s*bal)\s*(?:is\s+|are\s+)?[:\-]?\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?/gi;
// Mask balance figures — amount BEFORE keyword: "AED 5,000 balance" / "AED 5,000 is your available balance"
const BALANCE_MASK_RE_B = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?\s*(?:is\s+(?:your\s+|the\s+)?)?(?:(?:current|available|total|avail|new|updated)\s+)?\b(balance|bal\b|available\b|avail\b|limit\b|outstanding\b)/gi;
// Arabic balance mask — e.g. "الرصيد المتاح 14,072.37 EGP" / "رصيدك 5,000 SAR" / "الحد المتاح AED 10,000"
// These are informational balance figures in Arabic bank SMS and must NOT be counted as transactions.
const BALANCE_MASK_AR = /(?:الرصيد\s*المتاح|رصيدك\s*المتاح|رصيدك|الرصيد|الحد\s*المتاح|الحد\s*الائتماني|حد\s*الائتمان|المبلغ\s*المتاح|الرصيد\s*الحالي|رصيد\s*حسابك)\s*[:\-]?\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?/gi;
// Unified regex to find all currency+amount candidates with their text position
// The second alternative uses (?<!\w) to prevent matching digits embedded in card/account
// numbers like "XXXX1311 USD" where 1311 is part of the card number, not an amount.
const AMOUNT_POS_RE = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*([0-9,]+(?:\.[0-9]{1,3})?))|(?:(?<!\w)([0-9,]+(?:\.[0-9]{1,3})?)\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))/gi;

/**
 * Returns true if the SMS body looks like a bank/card transaction alert.
 * Must match at least one strong bank indicator to be considered.
 */
function isBankingSMS(body) {
  if (!body || typeof body !== "string") return false;

  // Strong signals — any one of these is enough
  const STRONG = /\b(debited|credited|transaction|txn|purchase|withdrawal|has been used|used for|pos |atm |card ending|card no|account ending|a\/c ending|a\/c no|acct no|your card|your account|bank account|dear customer|dear valued|salary|authorization code|auth code|ref no|reference no|upi|neft|rtgs|imps|swift|wire transfer|direct debit|standing order|emi|instalment|installment|cashback|refund|reversed)\b|(?:بطاقة|بطاقه|المدفوعة\s*مقد(?:ما|مًا)|مدفوعة\s*مقد(?:ما|مًا)|حساب|حسابك|المتاح|رصيد|تم\s*خصم|تم\s*(?:ايداع|إيداع)|تم\s*تنفيذ\s*تحويل|عملية\s*شراء|للمزيد\s*اتصل)/i;

  return STRONG.test(body);
}

/**
 * Extract financial transactions from a single SMS body using proximity matching.
 * Only amounts within ±120 chars of a debit/credit keyword are counted,
 * preventing balance figures from being classified as transactions.
 */
function extractTransactions(body) {
  if (!body || typeof body !== "string") return [];

  // Credit card bill payment — classify as credit (reduces card balance)
  if (CARD_BILL_PAYMENT_RE.test(body)) {
    const creditResults = [];
    AMOUNT_POS_RE.lastIndex = 0;
    let cm;
    while ((cm = AMOUNT_POS_RE.exec(body)) !== null) {
      const currRaw = (cm[1] || cm[4] || "").trim().toUpperCase();
      const amtRaw  = (cm[2] || cm[3] || "").replace(/,/g, "");
      const amount  = parseFloat(amtRaw);
      if (!isNaN(amount) && amount > 0 && currRaw) {
        const currency = CURRENCY_MAP[currRaw] || currRaw;
        creditResults.push({ amount, currency, type: "credit" });
      }
    }
    return creditResults;
  }

  // Step 1: Mask balance/informational amounts in both directions
  const masked = body
    .replace(BALANCE_MASK_RE_A, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_RE_B, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_AR,   (m) => " ".repeat(m.length));

  // Step 2: Find all currency+amount candidates with their string positions
  const candidates = [];
  let m;
  AMOUNT_POS_RE.lastIndex = 0;
  while ((m = AMOUNT_POS_RE.exec(masked)) !== null) {
    const currRaw = (m[1] || m[4] || "").trim().toUpperCase();
    const amtRaw  = (m[2] || m[3] || "").replace(/,/g, "");
    const amount  = parseFloat(amtRaw);
    if (!isNaN(amount) && amount > 0 && currRaw) {
      candidates.push({ amount, currRaw, pos: m.index });
    }
  }

  if (candidates.length === 0) return [];

  // Step 3: Proximity check — only count amounts with a nearby transaction keyword
  const WINDOW = 120;
  const results = [];
  const seen = new Set();

  for (const c of candidates) {
    const start = Math.max(0, c.pos - WINDOW);
    const end   = Math.min(masked.length, c.pos + WINDOW);
    const ctx   = masked.slice(start, end);

    const isDebit  = DEBIT_KEYWORDS.test(ctx);
    const isCredit = CREDIT_KEYWORDS.test(ctx);

    // Skip amounts with no nearby transaction keyword (likely a balance or ref number)
    if (!isDebit && !isCredit) continue;

    // Skip future-tense credit notifications (e.g. "refund will be credited in 14 days")
    if (!isDebit && isCredit && PENDING_RE.test(body)) continue;

    // Strong-credit override: "credited" or "deposited" in context beats weak debit words
    // like "payment" or "transfer". Only explicit debit words (debited/charged/withdrawn)
    // can override this. This handles "your salary payment was credited to your account".
    const isStrongCredit = STRONG_CREDIT_RE.test(ctx);
    const isStrongDebit  = STRONG_DEBIT_RE.test(ctx);
    const type = (isStrongCredit && !isStrongDebit) ? "credit"
               : (isCredit && !isDebit)             ? "credit"
               : "debit";
    const currency = CURRENCY_MAP[c.currRaw] || c.currRaw;
    const key      = `${currency}:${c.amount}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({ amount: c.amount, currency, type });
  }

  return results;
}

/**
 * Analyse an array of SMS messages and return aggregated spending insights.
 */
function analyzeSmsSpending(smsMessages, notifMessages = [], toTs = Infinity) {
  // { currency -> { debit, credit, txns: [{amount, type, sender, ts, snippet}] } }
  const byCurrency = {};
  const byDate = {}; // dateStr -> { currency -> debit/credit total }

  console.log(`[Insights] analyzeSmsSpending: ${smsMessages.length} SMS, ${notifMessages.length} notifications`);

  // Verbose per-message dump when dataset is small (helps diagnose missing transactions)
  if (smsMessages.length <= 50) {
    smsMessages.forEach((m, i) => {
      const ts = getEventTs(m, ["timestamp", "createdAt", "receivedAt", "date", "time"]);
      // bigText first: SMS captured via NotificationListenerService may have a truncated
      // 'text' field but the full content in 'bigText'. Prefer bigText to avoid missing amounts.
      const body = m.bigText || m.body || m.text || m.content || m.title || "";
      const sender = m.sender || m.address || "?";
      console.log(`[Insights] SMS[${i}] ts=${ts > 0 ? new Date(ts).toISOString() : "NO_TS"} sender="${sender.slice(0, 20)}" body="${body.slice(0, 80)}"`);
    });
  }

  // Pass 2 dedup uses a date-agnostic global "currency:amount" set (smsAmountsGlobal below).
  let bankingCount = 0;

  function accumulate(txn, ts, sender, body) {
    const cur = txn.currency;
    if (!byCurrency[cur]) byCurrency[cur] = { debit: 0, credit: 0, txns: [] };
    if (txn.type === "debit")  byCurrency[cur].debit  += txn.amount;
    if (txn.type === "credit") byCurrency[cur].credit += txn.amount;
    byCurrency[cur].txns.push({
      amount: txn.amount, type: txn.type, sender: escapeHtml(sender),
      ts, snippet: escapeHtml(body.slice(0, 80)),
    });
    if (ts > 0) {
      const dk = toDateStr(ts);
      if (!byDate[dk]) byDate[dk] = {};
      if (!byDate[dk][cur]) byDate[dk][cur] = { debit: 0, credit: 0 };
      if (txn.type === "debit")  byDate[dk][cur].debit  += txn.amount;
      if (txn.type === "credit") byDate[dk][cur].credit += txn.amount;
    }
  }

  // smsAmountsGlobal: Set of "currency:amount" across ALL SMS in range (date-agnostic).
  // Used by Pass 2 to suppress any notification carrying an amount that an SMS already covers,
  // even if the timestamps land on different calendar dates (timezone drift between channels).
  const smsAmountsGlobal = new Set();

  // Banking notifications must contain an explicit transaction verb. Plain bank-app
  // promotional/balance-summary pushes that pass isBankingSMS would otherwise get scanned
  // for currency figures (e.g. card limits, monthly summaries) and inflate totals.
  const TXN_VERB_RE = /\b(debited|credited|deposited|charged|withdrawn|withdrawal|deducted|reversed|refund|cashback|used\s+for|has\s+been\s+used|paid|payment|purchase|transferred|transfer)\b|(?:تم\s*خصم|تم\s*(?:ايداع|إيداع)|تم\s*(?:اضافة|إضافة)|تم\s*تنفيذ\s*تحويل|عملية\s*شراء|سحب|راتب|استرداد)/i;

  // PASS 1: SMS messages (primary source — always counted)
  for (const msg of smsMessages) {
    // bigText first: SMS captured via NotificationListenerService stores the full
    // expanded text in bigText while 'body'/'text' may be a truncated preview that
    // cuts off before the currency amount.
    const body = msg.bigText || msg.body || msg.text || msg.content || msg.title || "";
    if (!isBankingSMS(body)) continue;

    bankingCount++;
    const sender = msg.sender || msg.address || "Unknown";
    const ts = getEventTs(msg, ["timestamp", "createdAt", "receivedAt", "date", "time"]);
    const dateStr = ts > 0 ? toDateStr(ts) : "nodate";
    const txns = extractTransactions(body);
    console.log(`[Insights] SMS #${bankingCount}: sender="${sender.slice(0, 20)}", body="${body.slice(0, 90)}", txns=[${txns.map(t => `${t.type} ${t.currency} ${t.amount}`).join(", ") || "none"}]`);

    for (const txn of txns) {
      smsAmountsGlobal.add(`${txn.currency}:${txn.amount}`);
      accumulate(txn, ts, sender, body);
    }
  }

  // PASS 2 (DISABLED in v1.1.36.63): Notifications were originally scanned to recover
  // amounts when the SMS body field was truncated. Pass 1 now reads `bigText` first, which
  // contains the full expanded text on Android — making the notifications path redundant
  // and a source of false positives (bank-app pushes carrying limit/balance figures, plus
  // duplicate pushes the listener stores multiple times). Validated against CSV ground
  // truth: SMS-only Pass 1 reproduces the exported CSV totals exactly.
  // The notifMessages parameter is retained for future use but currently ignored.
  void notifMessages;

  console.log(`[Insights] Done: ${bankingCount} SMS banking msgs (notifications path disabled). Totals:`, Object.fromEntries(Object.entries(byCurrency).map(([c, v]) => [c, `+${v.credit} -${v.debit}`])));
  return { byCurrency, byDate };
}

/** Format an amount nicely (e.g. 1,234.50) */
function fmtAmt(n) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Render the SMS Insights section */
function renderSmsInsights(smsMessages, notifMessages = [], toTs = Infinity) {
  const container = document.getElementById("dashInsightsBody");
  if (!container) return;

  if ((!smsMessages || smsMessages.length === 0) && (!notifMessages || notifMessages.length === 0)) {
    container.innerHTML = `<div class="dash-insights-empty">${t("dash_insights_no_sms")}</div>`;
    return;
  }

  const { byCurrency, byDate } = analyzeSmsSpending(smsMessages, notifMessages, toTs);
  const currencies = Object.keys(byCurrency);

  if (currencies.length === 0) {
    container.innerHTML = `<div class="dash-insights-empty">${t("dash_insights_no_financial")}</div>`;
    return;
  }

  // Summary cards per currency
  const summaryHtml = currencies.map(cur => {
    const { debit, credit } = byCurrency[cur];
    const net = credit - debit;
    const netClass = net >= 0 ? "credit" : "debit";
    const netSign  = net >= 0 ? "+" : "";
    return `
      <div class="dash-insight-card">
        <div class="dash-insight-currency">${escapeHtml(cur)}</div>
        <div class="dash-insight-row">
          <span class="dash-insight-label">${t("dash_spent")}</span>
          <span class="dash-insight-value debit">${fmtAmt(debit)}</span>
        </div>
        <div class="dash-insight-row">
          <span class="dash-insight-label">${t("dash_received")}</span>
          <span class="dash-insight-value credit">${fmtAmt(credit)}</span>
        </div>
        <div class="dash-insight-divider"></div>
        <div class="dash-insight-row">
          <span class="dash-insight-label">${t("dash_net")}</span>
          <span class="dash-insight-value ${netClass}">${netSign}${fmtAmt(net)}</span>
        </div>
      </div>`;
  }).join("");

  // Per-date debit chart (text-based)
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a)).slice(0, 10);
  const dateRows = sortedDates.map(dk => {
    const amounts = Object.entries(byDate[dk]).flatMap(([cur, { debit, credit }]) => {
      const pills = [];
      if (debit  > 0) pills.push(`<span class="dash-date-spend-pill debit">-${escapeHtml(cur)} ${fmtAmt(debit)}</span>`);
      if (credit > 0) pills.push(`<span class="dash-date-spend-pill credit">+${escapeHtml(cur)} ${fmtAmt(credit)}</span>`);
      return pills;
    }).join("");
    return `<div class="dash-date-spend-row">
      <span class="dash-date-spend-label">${formatDateLabel(dk)}</span>
      <span class="dash-date-spend-amounts">${amounts}</span>
    </div>`;
  }).join("");


  container.innerHTML = `
    <div class="dash-insights-summary">${summaryHtml}</div>
    ${sortedDates.length > 0 ? `
    <div class="dash-insights-section-title">${t("dash_spending_by_date")}</div>
    <div class="dash-date-spend-list">${dateRows}</div>` : ""}
  `;
}

/** Initialize the Dashboard tab */
export function updateInsightsDeviceTabs() {
  const insightsDeviceTabs = document.getElementById("dashInsightsDeviceTabs");
  if (!insightsDeviceTabs) return;

  const mobileDevices = (state.devices || []).filter((d) => {
    const platform = (d.platform || "").toLowerCase();
    const type = (d.type || "").toLowerCase();
    return (
      type === "mobile" ||
      type === "phone" ||
      type === "tablet" ||
      platform === "android" ||
      platform === "ios"
    );
  });

  const currentSelected =
    insightsDeviceTabs.querySelector(".device-tab.active")?.dataset.device || "all";

  const deviceTabsHTML = mobileDevices.map((d) => {
    const isActive = currentSelected === (d.id || d.docId) ? " active" : "";
    return `<button class="device-tab${isActive}" data-device="${escapeHtml(d.id || d.docId)}">
      ${getPlatformIcon(d.platform)}
      <span>${escapeHtml(getFriendlyDeviceName(d))}</span>
    </button>`;
  }).join("");

  const allActive = !mobileDevices.some((d) => (d.id || d.docId) === currentSelected) ? " active" : "";
  insightsDeviceTabs.innerHTML = `
    <button class="device-tab${allActive}" data-device="all">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <span>${t("dash_insights_all_devices")}</span>
    </button>
    ${deviceTabsHTML}
  `;

  if (!insightsDeviceTabs.dataset.wired) {
    insightsDeviceTabs.dataset.wired = "1";
    insightsDeviceTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".device-tab");
      if (!btn) return;
      insightsDeviceTabs.querySelectorAll(".device-tab").forEach((tab) => tab.classList.remove("active"));
      btn.classList.add("active");
      renderDashboard();
    });
  }
}

export function initDashboard() {
  setDefaultDates();

  // Auto-refresh when calls finish loading from Firestore (getDocs is async
  // and slower than SMS real-time snapshots; stale cache showed old count).
  document.addEventListener("callsDataUpdated", () => {
    const insightsTabEl = document.getElementById("dashboardTab");
    if (insightsTabEl && insightsTabEl.classList.contains("active")) {
      renderDashboard();
    }
  });

  // Auto-refresh when notifications finish loading (all device snapshots done).
  // Without this, the count flaps between cache-based first render and the
  // final state-based render after Firestore catches up.
  document.addEventListener("notificationsDataUpdated", () => {
    const insightsTabEl = document.getElementById("dashboardTab");
    if (insightsTabEl && insightsTabEl.classList.contains("active")) {
      renderDashboard();
    }
  });

  const filterBtn = document.getElementById("dashFilterBtn");
  const resetBtn = document.getElementById("dashResetBtn");

  if (filterBtn) {
    filterBtn.addEventListener("click", () => renderDashboard());
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const fromInput = document.getElementById("dashFromDate");
      const toInput = document.getElementById("dashToDate");
      if (fromInput) fromInput.value = "";
      if (toInput) toInput.value = "";
      setDefaultDates();
      renderDashboard();
    });
  }

  // Re-render insights when device filter tab changes (handled via event delegation in renderDashboard)
  // No separate listener needed — click handler is wired inside renderDashboard.

  // Auto-render when tab is clicked
  document.querySelectorAll(".tab").forEach((tab) => {
    if (tab.dataset.tab === "dashboard") {
      tab.addEventListener("click", () => renderDashboard());
    }
  });
}
