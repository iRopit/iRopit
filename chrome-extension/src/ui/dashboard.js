/**
 * Dashboard Module
 * Shows summary stats (SMS, Calls, Notifications) filtered by date range
 * and a per-date breakdown of notifications.
 */

import { translations, getCurrentLanguage } from "../utils/i18n.js";

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

  const { allSms, allCalls, allNotifs } = await loadRawData();

  // Filter by date range
  const filteredSms = allSms.filter((m) => {
    const ts = m.timestamp || m.receivedAt || 0;
    return ts >= fromTs && ts <= toTs;
  });

  const filteredCalls = allCalls.filter((c) => {
    const ts = c.timestamp || c.callDate || 0;
    return ts >= fromTs && ts <= toTs;
  });

  const filteredNotifs = allNotifs.filter((n) => {
    const ts = n.timestamp || n.receivedAt || 0;
    return ts >= fromTs && ts <= toTs;
  });

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

  // Render SMS spending insights
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
const DEBIT_KEYWORDS = /\b(debited|debit|charged|charge|paid|pay|payment|purchase|bought|withdrawn|withdrawal|deducted|deduct|sent|used\s+for|has\s+been\s+used|transfer(?:red)?\s+(?:to|from\s+your))\b/i;
// NOTE: "received" removed — banks say "we received your payment" which is a DEBIT for the customer
const CREDIT_KEYWORDS = /\b(credited|deposited|deposit|refund|cashback|returned|salary|transferred\s+to\s+your)\b/i;

// Mask balance figures — keyword BEFORE amount: "balance: AED 5,000" OR "limit is AED 5,000"
const BALANCE_MASK_RE_A = /\b(balance|bal\.?|avail(?:able)?\.?|remaining|rem\.?|limit|outstanding|due|minimum|min\.?|opening|closing|cr\.?\s*bal|dr\.?\s*bal)\s*(?:is\s+|are\s+)?[:\-]?\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?/gi;
// Mask balance figures — amount BEFORE keyword: "AED 5,000 balance" / "AED 5,000 is your available balance"
const BALANCE_MASK_RE_B = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?\s*(?:is\s+(?:your\s+|the\s+)?)?(?:(?:current|available|total|avail|new|updated)\s+)?\b(balance|bal\b|available\b|avail\b|limit\b|outstanding\b)/gi;
// Unified regex to find all currency+amount candidates with their text position
const AMOUNT_POS_RE = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*([0-9,]+(?:\.[0-9]{1,3})?))|(?:([0-9,]+(?:\.[0-9]{1,3})?)\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))/gi;

/**
 * Returns true if the SMS body looks like a bank/card transaction alert.
 * Must match at least one strong bank indicator to be considered.
 */
function isBankingSMS(body) {
  if (!body || typeof body !== "string") return false;

  // Strong signals — any one of these is enough
  const STRONG = /\b(debited|credited|transaction|txn|purchase|withdrawal|has been used|used for|pos |atm |card ending|card no|account ending|a\/c ending|a\/c no|acct no|your card|your account|bank account|dear customer|dear valued|salary|authorization code|auth code|ref no|reference no|upi|neft|rtgs|imps|swift|wire transfer|direct debit|standing order|emi|instalment|installment|cashback|refund)\b/i;

  return STRONG.test(body);
}

/**
 * Extract financial transactions from a single SMS body using proximity matching.
 * Only amounts within ±120 chars of a debit/credit keyword are counted,
 * preventing balance figures from being classified as transactions.
 */
function extractTransactions(body) {
  if (!body || typeof body !== "string") return [];

  // Step 1: Mask balance/informational amounts in both directions
  const masked = body
    .replace(BALANCE_MASK_RE_A, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_RE_B, (m) => " ".repeat(m.length));

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

/** Initialize the Dashboard tab */
export function initDashboard() {
  setDefaultDates();

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

  // Auto-render when tab is clicked
  document.querySelectorAll(".tab").forEach((tab) => {
    if (tab.dataset.tab === "dashboard") {
      tab.addEventListener("click", () => renderDashboard());
    }
  });
}
