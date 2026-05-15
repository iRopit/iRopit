/**
 * Dashboard Module
 * Shows summary stats (SMS, Calls, Notifications) filtered by date range
 * and a per-date breakdown of notifications.
 */

import { translations, getCurrentLanguage } from "../utils/i18n.js";
import * as state from "../state/index.js";
import { getFriendlyDeviceName, getPlatformIcon } from "../utils/helpers.js";
import {
  db,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "../config/firebase.js";

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

/** Load Insights data directly from Firestore for a specific date range.
 *  Queries Firestore from the popup context using the authenticated user.
 *  This ensures every machine (regardless of local cache age or install date)
 *  gets identical, complete data for the same date range.
 */
async function loadInsightsDataDirect(fromTs, toTs) {
  const currentUser = state.currentUser;
  if (!currentUser) {
    // Not authenticated yet — filter local cache by date range as fallback
    const raw = await loadRawData();
    return {
      allSms: raw.allSms.filter((m) => { const ts = m.timestamp || m.receivedAt || 0; return ts >= fromTs && ts <= toTs; }),
      allCalls: raw.allCalls.filter((c) => { const ts = c.timestamp || c.callDate || 0; return ts >= fromTs && ts <= toTs; }),
      allNotifs: raw.allNotifs.filter((n) => { const ts = n.timestamp || n.receivedAt || 0; return ts >= fromTs && ts <= toTs; }),
    };
  }

  // Get all mobile devices for this user
  let mobileDevices = [];
  try {
    const devicesSnap = await getDocs(query(
      collection(db, "devices"),
      where("userId", "==", currentUser.uid),
    ));
    devicesSnap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d.platform !== "chrome" && d.platform !== "chrome-extension" && !d.id?.startsWith("ext_")) {
        let name = d.nickname;
        if (!name) {
          const platform = (d.platform || "").toLowerCase();
          name = platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "Device";
        }
        mobileDevices.push({ id: d.id, name });
      }
    });
  } catch (_) {
    // fallback on devices query error — filter local cache by date range
    const raw = await loadRawData();
    return {
      allSms: raw.allSms.filter((m) => { const ts = m.timestamp || m.receivedAt || 0; return ts >= fromTs && ts <= toTs; }),
      allCalls: raw.allCalls.filter((c) => { const ts = c.timestamp || c.callDate || 0; return ts >= fromTs && ts <= toTs; }),
      allNotifs: raw.allNotifs.filter((n) => { const ts = n.timestamp || n.receivedAt || 0; return ts >= fromTs && ts <= toTs; }),
    };
  }

  const allSms = [];
  const allCalls = [];
  const allNotifs = [];

  await Promise.all(mobileDevices.map(async (device) => {
    try {
      const [notifSnap, callsSnap] = await Promise.all([
        getDocs(query(
          collection(db, "users", currentUser.uid, "devices", device.id, "notifications"),
          where("timestamp", ">=", fromTs),
          where("timestamp", "<=", toTs),
          orderBy("timestamp", "desc"),
          limit(5000),
        )),
        getDocs(query(
          collection(db, "users", currentUser.uid, "devices", device.id, "calls"),
          where("timestamp", ">=", fromTs),
          where("timestamp", "<=", toTs),
          orderBy("timestamp", "desc"),
          limit(5000),
        )),
      ]);

      notifSnap.docs.forEach((d) => {
        const item = { ...d.data(), id: d.id, deviceId: device.id, deviceName: device.name };
        if (item.type === "sms") allSms.push(item);
        allNotifs.push(item);
      });
      callsSnap.docs.forEach((d) => {
        allCalls.push({ ...d.data(), id: d.id, deviceId: device.id, deviceName: device.name });
      });
    } catch (_) { /* skip devices with permission errors */ }
  }));

  return { allSms, allCalls, allNotifs };
}

/** Load all raw data from chrome.storage.local */
async function loadRawData() {
  const result = await chrome.storage.local.get([
    CACHE_KEYS.SMS,
    CACHE_KEYS.CALLS,
    CACHE_KEYS.NOTIFICATIONS,
  ]);

  const smsData = result[CACHE_KEYS.SMS];
  const callsData = result[CACHE_KEYS.CALLS];
  const notifData = result[CACHE_KEYS.NOTIFICATIONS];

  const allSms = smsData?.allMessages || [];
  const allCalls = callsData?.allCalls || [];

  // Flatten notifications from byDevice
  const allNotifs = [];
  if (notifData?.byDevice) {
    for (const deviceNotifs of Object.values(notifData.byDevice)) {
      if (Array.isArray(deviceNotifs)) {
        allNotifs.push(...deviceNotifs);
      }
    }
  }

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

/** Render the dashboard with current filter values */
async function renderDashboard() {
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

  // Query Firestore directly for the selected date range — consistent across all machines
  const { allSms, allCalls, allNotifs } = await loadInsightsDataDirect(fromTs, toTs);

  // Determine selected device from the active sidebar tab
  const insightsDeviceTabs = document.getElementById("dashInsightsDeviceTabs");
  const selectedDevice =
    insightsDeviceTabs?.querySelector(".device-tab.active")?.dataset.device || "all";

  // Apply device filter to all data
  const filteredSms = selectedDevice === "all"
    ? allSms
    : allSms.filter((m) => m.deviceId === selectedDevice);
  const filteredCalls = selectedDevice === "all"
    ? allCalls
    : allCalls.filter((c) => c.deviceId === selectedDevice);
  const filteredNotifs = selectedDevice === "all"
    ? allNotifs
    : allNotifs.filter((n) => n.deviceId === selectedDevice);

  // Update stat counters
  if (smsCountEl) smsCountEl.textContent = filteredSms.length;
  if (callsCountEl) callsCountEl.textContent = filteredCalls.length;
  if (notifCountEl) notifCountEl.textContent = filteredNotifs.length;

  // Group notifications by date (descending)
  const byDate = {};
  for (const n of filteredNotifs) {
    const ts = n.timestamp || n.receivedAt || 0;
    const dateKey = toDateStr(ts);
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push({ ...n, _ts: ts });
  }

  // Also add SMS and Calls counts per date (for the pill summary)
  const smsByDate = {};
  for (const m of filteredSms) {
    const ts = m.timestamp || m.receivedAt || 0;
    const dk = toDateStr(ts);
    smsByDate[dk] = (smsByDate[dk] || 0) + 1;
  }

  const callsByDate = {};
  for (const c of filteredCalls) {
    const ts = c.timestamp || c.callDate || 0;
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

  // Populate the insights device dropdown (only mobile devices)
  const insightsDeviceSelect = document.getElementById("dashInsightsDevice");
  if (insightsDeviceSelect) {
    const mobileDevices = (state.devices || []).filter((d) => {
      const platform = (d.platform || "").toLowerCase();
      const type = (d.type || "").toLowerCase();
      return !platform.includes("chrome") && type !== "extension";
    });
    const prevVal = insightsDeviceSelect.value;
    insightsDeviceSelect.innerHTML =
      `<option value="all">${t("dash_insights_all_devices")}</option>` +
      mobileDevices.map((d) =>
        `<option value="${escapeHtml(d.id)}">${escapeHtml(getFriendlyDeviceName(d))}</option>`
      ).join("");
    // Restore previous selection if still valid
    if (prevVal && [...insightsDeviceSelect.options].some((o) => o.value === prevVal)) {
      insightsDeviceSelect.value = prevVal;
    }
  }

  // Render SMS spending insights (filteredSms is already device-filtered above)
  renderSmsInsights(filteredSms);

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
// NOTE: "received" removed — banks say "we received your payment" which is a DEBIT for the customer
const CREDIT_KEYWORDS = /\b(credited|deposited|deposit|refund|cashback|returned|salary|transferred\s+to\s+your)\b|(?:تم\s*(?:ايداع|إيداع|اضافة|إضافة|تحويل)|ايداع|إيداع|استرداد|مرتجع|راتب|تحويل\s*وارد)/i;
// Credit card bill payment confirmations — "Your Payment of AED X for card XXXX has been processed"
// These are NOT spending transactions; they are the customer paying off their credit card balance.
const CARD_BILL_PAYMENT_RE = /\bpayment\b.{0,80}\bfor\s+card\b.{0,80}\bhas\s+been\s+processed\b/i;
// Pending/future-tense signals — if present alongside a credit keyword, the transaction hasn't happened yet
const PENDING_RE = /\bwill\s+be\b|\bon\s+its\s+way\b|\bpending\b|\bprocessing\b|\bwithin\s+\d+\s+(?:business\s+)?days\b/i;

// Mask balance figures — keyword BEFORE amount: "balance: AED 5,000" OR "limit is AED 5,000"
const BALANCE_MASK_RE_A = /\b(balance|bal\.?|avail(?:able)?\.?|remaining|rem\.?|limit|outstanding|due|minimum|min\.?|opening|closing|cr\.?\s*bal|dr\.?\s*bal)\s*(?:is\s+|are\s+)?[:\-]?\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?/gi;
// Mask balance figures — amount BEFORE keyword: "AED 5,000 balance" / "AED 5,000 is your available balance"
const BALANCE_MASK_RE_B = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?\s*(?:is\s+(?:your\s+|the\s+)?)?(?:(?:current|available|total|avail|new|updated)\s+)?\b(balance|bal\b|available\b|avail\b|limit\b|outstanding\b)/gi;
// Arabic balance figures — keyword BEFORE amount, e.g. "الرصيد المتاح 13195.21 EGP" or "المتاح 1568.76"
const BALANCE_MASK_RE_AR = /(?:الرصيد(?:\s*(?:المتاح|المتبقي|المتبقى))?|الحد(?:\s*المتاح)?|المتاح|المتبقي|المتبقى|رصيد(?:\s*متاح)?|متاح|متبقي|متبقى)\s*[:\-]?\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?/gi;
// Arabic balance figures — amount BEFORE keyword, e.g. "1568.76 المتاح" / "13195.21 EGP الرصيد"
const BALANCE_MASK_RE_AR_B = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?\s*(?:الرصيد(?:\s*(?:المتاح|المتبقي|المتبقى))?|الحد(?:\s*المتاح)?|المتاح|المتبقي|المتبقى|رصيد(?:\s*متاح)?|متاح|متبقي|متبقى)/gi;
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
  const STRONG = /\b(debited|credited|transaction|txn|purchase|withdrawal|has been used|used for|pos |atm |card ending|card no|account ending|a\/c ending|a\/c no|acct no|your card|your account|bank account|dear customer|dear valued|salary|authorization code|auth code|ref no|reference no|upi|neft|rtgs|imps|swift|wire transfer|direct debit|standing order|emi|instalment|installment|cashback|refund)\b|(?:بطاقة|بطاقه|المدفوعة\s*مقد(?:ما|مًا)|مدفوعة\s*مقد(?:ما|مًا)|حساب|المتاح|رصيد|تم\s*خصم|تم\s*(?:ايداع|إيداع)|عملية\s*شراء|للمزيد\s*اتصل)/i;

  return STRONG.test(body);
}

/**
 * Extract financial transactions from a single SMS body using proximity matching.
 * Only amounts within ±120 chars of a debit/credit keyword are counted,
 * preventing balance figures from being classified as transactions.
 */
function extractTransactions(body) {
  if (!body || typeof body !== "string") return [];

  // Skip credit card bill payment confirmations — these are not purchases/spending
  if (CARD_BILL_PAYMENT_RE.test(body)) return [];

  // Step 1: Mask balance/informational amounts in both directions
  const masked = body
    .replace(BALANCE_MASK_RE_A, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_RE_B, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_RE_AR, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_RE_AR_B, (m) => " ".repeat(m.length));

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

    const type     = isCredit && !isDebit ? "credit" : "debit";
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
function analyzeSmsSpending(smsMessages) {
  // { currency -> { debit, credit, txns: [{amount, type, sender, ts, snippet}] } }
  const byCurrency = {};
  const byDate = {}; // dateStr -> { currency -> debit total }

  for (const msg of smsMessages) {
    const body   = msg.body || msg.text || msg.content || "";

    // Skip SMS that are not bank/card related
    if (!isBankingSMS(body)) continue;

    const sender = msg.sender || msg.address || "Unknown";
    const ts     = msg.timestamp || msg.receivedAt || 0;
    const txns   = extractTransactions(body);

    for (const txn of txns) {
      const cur = txn.currency;
      if (!byCurrency[cur]) byCurrency[cur] = { debit: 0, credit: 0, txns: [] };
      if (txn.type === "debit")  byCurrency[cur].debit  += txn.amount;
      if (txn.type === "credit") byCurrency[cur].credit += txn.amount;
      byCurrency[cur].txns.push({
        amount: txn.amount, type: txn.type, sender: escapeHtml(sender),
        ts, snippet: escapeHtml(body.slice(0, 80)),
      });

      // Per-date breakdown
      if (ts) {
        const dk = toDateStr(ts);
        if (!byDate[dk]) byDate[dk] = {};
        if (!byDate[dk][cur]) byDate[dk][cur] = { debit: 0, credit: 0 };
        if (txn.type === "debit")  byDate[dk][cur].debit  += txn.amount;
        if (txn.type === "credit") byDate[dk][cur].credit += txn.amount;
      }
    }
  }

  return { byCurrency, byDate };
}

/** Format an amount nicely (e.g. 1,234.50) */
function fmtAmt(n) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Render the SMS Insights section */
function renderSmsInsights(smsMessages) {
  const container = document.getElementById("dashInsightsBody");
  if (!container) return;

  if (!smsMessages || smsMessages.length === 0) {
    container.innerHTML = `<div class="dash-insights-empty">${t("dash_insights_no_sms")}</div>`;
    return;
  }

  const { byCurrency, byDate } = analyzeSmsSpending(smsMessages);
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

/** Render Insights with a loading indicator while fetching from Firestore */
async function refreshAndRender() {
  const filterBtn = document.getElementById("dashFilterBtn");
  const breakdownList = document.getElementById("dashBreakdownList");
  const smsCountEl = document.getElementById("dashSmsCount");
  const callsCountEl = document.getElementById("dashCallsCount");
  const notifCountEl = document.getElementById("dashNotifCount");

  const spinnerSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;

  // Show loading state on stat cards and button
  if (filterBtn) {
    filterBtn.disabled = true;
    filterBtn.textContent = t("common_loading") || "Loading...";
  }
  if (smsCountEl) smsCountEl.innerHTML = spinnerSvg;
  if (callsCountEl) callsCountEl.innerHTML = spinnerSvg;
  if (notifCountEl) notifCountEl.innerHTML = spinnerSvg;
  if (breakdownList) {
    breakdownList.innerHTML = `<div class="empty-state" style="padding:24px">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      <p style="margin-top:8px">${t("common_loading") || "Loading..."}</p>
    </div>`;
  }

  await renderDashboard();

  if (filterBtn) {
    filterBtn.disabled = false;
    filterBtn.textContent = t("dash_apply") || "Apply";
  }
}

/** Initialize the Dashboard tab */
export function initDashboard() {
  setDefaultDates();

  const filterBtn = document.getElementById("dashFilterBtn");
  const resetBtn = document.getElementById("dashResetBtn");

  if (filterBtn) {
    filterBtn.addEventListener("click", () => refreshAndRender());
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const fromInput = document.getElementById("dashFromDate");
      const toInput = document.getElementById("dashToDate");
      if (fromInput) fromInput.value = "";
      if (toInput) toInput.value = "";
      setDefaultDates();
      refreshAndRender();
    });
  }

  // Re-render insights when device filter changes
  const insightsDeviceSelect = document.getElementById("dashInsightsDevice");
  if (insightsDeviceSelect) {
    insightsDeviceSelect.addEventListener("change", () => renderDashboard());
  }

  // Auto-render when tab is clicked
  document.querySelectorAll(".tab").forEach((tab) => {
    if (tab.dataset.tab === "dashboard") {
      tab.addEventListener("click", () => refreshAndRender());
    }
  });
}
