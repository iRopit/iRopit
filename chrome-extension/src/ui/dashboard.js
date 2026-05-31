/**
 * Dashboard Module
 * Shows summary stats (SMS, Calls) and money spending filtered by date range.
 */

import { translations, getCurrentLanguage } from "../utils/i18n.js";
import * as state from "../state/index.js";
import { getFriendlyDeviceName, getPlatformIcon } from "../utils/helpers.js";
import { isSMSSyncing } from "../services/sms.js";
import { isCallsSyncing } from "../services/calls.js";
// Firebase imports removed — Insights reads from in-memory state populated by real-time listeners

/** Shorthand translator */
function t(key) {
  const lang = getCurrentLanguage();
  return (translations[lang] && translations[lang][key]) || translations["en"][key] || key;
}

const CACHE_KEYS = {
  SMS: "cached_sms_data",
  CALLS: "cached_calls_data",
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

/**
 * Load Insights data from in-memory state — instant, no Firestore roundtrip.
 * State is already kept fresh by the real-time Firestore listeners that run
 * as soon as the user logs in.  Falls back to chrome.storage.local when the
 * popup has just opened and listeners haven't fired yet.
 */
async function loadInsightsData(fromTs, toTs) {
  const inMemorySms   = state.allSMSMessages || [];
  const inMemoryCalls = state.allCallsData   || [];

  if (inMemorySms.length > 0 || inMemoryCalls.length > 0) {
    return {
      allSms:   inMemorySms.filter((m) => { const ts = m.timestamp || m.receivedAt || 0; return ts >= fromTs && ts <= toTs; }),
      allCalls: inMemoryCalls.filter((c) => { const ts = c.timestamp || c.callDate  || 0; return ts >= fromTs && ts <= toTs; }),
    };
  }

  // Fallback: state not yet populated — read from chrome.storage.local cache
  const raw = await loadRawData();
  return {
    allSms:   raw.allSms.filter((m)  => { const ts = m.timestamp || m.receivedAt || 0; return ts >= fromTs && ts <= toTs; }),
    allCalls: raw.allCalls.filter((c) => { const ts = c.timestamp || c.callDate  || 0; return ts >= fromTs && ts <= toTs; }),
  };
}

/** Load all raw data from chrome.storage.local */
async function loadRawData() {
  const result = await chrome.storage.local.get([
    CACHE_KEYS.SMS,
    CACHE_KEYS.CALLS,
  ]);

  const smsData = result[CACHE_KEYS.SMS];
  const callsData = result[CACHE_KEYS.CALLS];

  const allSms = smsData?.allMessages || [];
  const allCalls = callsData?.allCalls || [];

  return { allSms, allCalls };
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

  // While SMS/Calls are still syncing on first load, show a loading state
  // instead of "No data" — we genuinely don't know what's in the range yet.
  const stillSyncing = isSMSSyncing() || isCallsSyncing();
  const hasAnyInMemory =
    (state.allSMSMessages && state.allSMSMessages.length > 0) ||
    (state.allCallsData   && state.allCallsData.length   > 0);
  if (stillSyncing && !hasAnyInMemory) {
    const lang = getCurrentLanguage();
    const msg = lang === "ar"
      ? "جارٍ تحميل الرسائل والمكالمات…"
      : "Loading messages and calls…";
    breakdownList.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>${msg}</p>
      </div>
    `;
    const insightsBody = document.getElementById("dashInsightsBody");
    if (insightsBody) insightsBody.innerHTML = "";
    if (smsCountEl)   smsCountEl.textContent = "—";
    if (callsCountEl) callsCountEl.textContent = "—";
    return;
  }

  // Read from in-memory state — already populated by real-time listeners
  const { allSms, allCalls } = await loadInsightsData(fromTs, toTs);

  // Determine selected device from the active sidebar tab
  const insightsDeviceTabs = document.getElementById("dashInsightsDeviceTabs");
  const selectedDevice =
    insightsDeviceTabs?.querySelector(".device-tab.active")?.dataset.device || "all";

  // Apply device filter
  const filteredSms = selectedDevice === "all"
    ? allSms
    : allSms.filter((m) => m.deviceId === selectedDevice);
  const filteredCalls = selectedDevice === "all"
    ? allCalls
    : allCalls.filter((c) => c.deviceId === selectedDevice);

  // Update stat counters
  if (smsCountEl) smsCountEl.textContent = filteredSms.length;
  if (callsCountEl) callsCountEl.textContent = filteredCalls.length;

  // Group SMS and Calls counts per date (for the pill summary)
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
    renderSmsInsights(filteredSms);
    return;
  }

  // Render SMS spending insights (filteredSms is already device-filtered above)
  renderSmsInsights(filteredSms);

  const html = sortedDates.map((dateKey) => {
    const smsCount = smsByDate[dateKey] || 0;
    const callCount = callsByDate[dateKey] || 0;

    const pills = [
      smsCount > 0 ? `<span class="dash-count-pill sms">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        ${smsCount}</span>` : "",
      callCount > 0 ? `<span class="dash-count-pill calls">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>
        ${callCount}</span>` : "",
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

// ── Minimal XLSX builder (no external library) ──────────────────────────────
const _enc = new TextEncoder();

/** CRC-32 table */
const _CRC32 = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function _crc32(b) {
  let c = 0xFFFFFFFF;
  for (const v of b) c = _CRC32[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function _u16(n) { return [n & 0xff, (n >> 8) & 0xff]; }
function _u32(n) { return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]; }

/** Build an uncompressed ZIP archive from an array of {name, data} entries */
function _buildZip(files) {
  const parts = [], cd = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nb  = _enc.encode(name);
    const crc = _crc32(data);
    const lh  = new Uint8Array([
      0x50,0x4B,0x03,0x04,
      ..._u16(20),..._u16(0),..._u16(0),..._u16(0),..._u16(0),
      ..._u32(crc),..._u32(data.length),..._u32(data.length),
      ..._u16(nb.length),..._u16(0),...nb,
    ]);
    parts.push(lh, data);
    cd.push({ nb, crc, size: data.length, off: offset });
    offset += lh.length + data.length;
  }
  const cdParts = cd.map(({ nb, crc, size, off }) => new Uint8Array([
    0x50,0x4B,0x01,0x02,
    ..._u16(20),..._u16(20),..._u16(0),..._u16(0),..._u16(0),..._u16(0),
    ..._u32(crc),..._u32(size),..._u32(size),
    ..._u16(nb.length),..._u16(0),..._u16(0),..._u16(0),..._u16(0),
    ..._u32(0),..._u32(off),...nb,
  ]));
  const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array([
    0x50,0x4B,0x05,0x06,..._u16(0),..._u16(0),
    ..._u16(cd.length),..._u16(cd.length),
    ..._u32(cdSize),..._u32(offset),..._u16(0),
  ]);
  const all   = [...parts, ...cdParts, eocd];
  const total = all.reduce((s, p) => s + p.length, 0);
  const out   = new Uint8Array(total);
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}

function _xesc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function _colLetter(i) {
  return i < 26
    ? String.fromCharCode(65 + i)
    : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

/**
 * Build an xlsx Blob containing multiple sheets — no external library.
 * @param {Array<{name:string, headers:string[], rows:any[][]}>} sheets
 * @returns {Blob}
 */
function buildXLSX(sheets) {
  const ss = [], ssIdx = new Map();
  const si = (v) => {
    const s = String(v ?? "");
    if (!ssIdx.has(s)) { ssIdx.set(s, ss.length); ss.push(s); }
    return ssIdx.get(s);
  };

  const sheetXMLs = sheets.map(({ headers, rows }) => {
    const all = [headers, ...rows];
    const body = all.map((row, ri) =>
      `<row r="${ri+1}">${row.map((v, ci) => {
        const ref = `${_colLetter(ci)}${ri+1}`;
        if (v === null || v === undefined || v === "") return `<c r="${ref}"/>`;
        if (typeof v === "number" && isFinite(v)) return `<c r="${ref}" t="n"><v>${v}</v></c>`;
        return `<c r="${ref}" t="s"><v>${si(v)}</v></c>`;
      }).join("")}</row>`
    ).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  });

  const ssXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${ss.length}" uniqueCount="${ss.length}">${ss.map(s=>`<si><t xml:space="preserve">${_xesc(s)}</t></si>`).join("")}</sst>`;
  const wbXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(({name},i)=>`<sheet name="${_xesc(name)}" sheetId="${i+1}" r:id="rId${i+2}"/>`).join("")}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>${sheets.map((_,i)=>`<Relationship Id="rId${i+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}</Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const sheetCT  = sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const ctXML    = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${sheetCT}</Types>`;
  const styXML   = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;

  const files = [
    { name: "[Content_Types].xml",       data: _enc.encode(ctXML) },
    { name: "_rels/.rels",               data: _enc.encode(rootRels) },
    { name: "xl/workbook.xml",           data: _enc.encode(wbXML) },
    { name: "xl/_rels/workbook.xml.rels",data: _enc.encode(wbRels) },
    { name: "xl/sharedStrings.xml",      data: _enc.encode(ssXML) },
    { name: "xl/styles.xml",             data: _enc.encode(styXML) },
    ...sheetXMLs.map((xml, i) => ({ name: `xl/worksheets/sheet${i+1}.xml`, data: _enc.encode(xml) })),
  ];
  return new Blob([_buildZip(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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
const CREDIT_KEYWORDS = /\b(credited|deposited|deposit|refund|cashback|returned|reversed|reversal|salary|transferred\s+to\s+your)\b|(?:تم\s*(?:ايداع|إيداع|اضافة|إضافة|تحويل)|ايداع|إيداع|استرداد|مرتجع|راتب|تحويل\s*وارد)/i;
// Credit card bill payment confirmations — "Your Payment of AED X for card XXXX has been processed"
// These are NOT spending transactions; they are the customer paying off their credit card balance.
const CARD_BILL_PAYMENT_RE = /\bpayment\b.{0,80}\bfor\s+card\b.{0,80}\bhas\s+been\s+processed\b/i;
// Arabic monthly card-statement / account-summary notifications.
// Contain informational fields like minimum-due and last-payment-received — NOT individual transactions.
const CARD_STATEMENT_RE_AR = /كشف\s*حساب|الحد\s*الأدنى\s*لل(?:دفع|سداد)|تاريخ\s*(?:ال)?(?:أ|ا)ستحقاق|اخر\s*دفعة\s*مستلمة/i;
// Merchant/utility payment confirmation — "payment of AED X against A/C YYYY"
// These duplicate the bank debit SMS for the same transaction and must not be double-counted.
const MERCHANT_CONFIRM_RE = /\bagainst\s+a[\/.\-]?c\b/i;
// Pending/future-tense signals — if present alongside a credit keyword, the transaction hasn't happened yet
const PENDING_RE = /\bwill\s+be\b|\bon\s+its\s+way\b|\bpending\b|\bprocessing\b|\bwithin\s+\d+\s+(?:business\s+)?days\b/i;
// Telecom service / bundle-subscription notifications — NOT financial transactions.
// Matches: "SMS the correct keyword to 5102", "to subscribe to a Roaming bundle",
// "Roaming Bundles that work in GCC", "Data bundle valid for", etc.
const TELECOM_SERVICE_RE = /\bsms\s+(?:the\s+)?(?:correct\s+)?(?:keyword|word)\s+to\s+\d{3,6}\b|\bto\s+(?:un)?subscribe\b.{0,80}\bsms\b.{0,80}\bto\s+\d{3,6}\b|\b(?:roaming|data|voice|sms)\s+bundles?\s+(?:that\s+works?|valid|for|to|in)\b|\bsubscribe\s+to\s+a\s+(?:roaming|data|voice)\s+bundle\b/i;

// Mask rate/pricing amounts — e.g. "EGP 20 per Min", "AED 0.5 per SMS"
const RATE_MASK_RE = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?\s+per\s+\w+/gi;


const BALANCE_MASK_RE_A = /\b(balance|bal\.?|avail(?:able)?\.?|remaining|rem\.?|limit|outstanding|due|minimum|min\.?|opening|closing|cr\.?\s*bal|dr\.?\s*bal)\s*(?:is\s+|are\s+)?[:\-]?\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?/gi;
// Mask balance figures — amount BEFORE keyword: "AED 5,000 balance" / "AED 5,000 is your available balance"
const BALANCE_MASK_RE_B = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?\s*(?:is\s+(?:your\s+|the\s+)?)?(?:(?:current|available|total|avail|new|updated)\s+)?\b(balance|bal\b|available\b|avail\b|limit\b|outstanding\b)/gi;
// Arabic balance figures — keyword BEFORE amount, e.g. "الرصيد المتاح 13195.21 EGP" or "المتاح 1568.76"
const BALANCE_MASK_RE_AR = /(?:الرصيد(?:\s*(?:المتاح|المتبقي|المتبقى|المتوفر))?|الحد(?:\s*(?:المتاح|الأدنى\s*لل(?:دفع|سداد)))?|المتاح|المتبقي|المتبقى|المتوفر|رصيد(?:\s*متاح)?|متاح|متبقي|متبقى|اخر\s*دفعة\s*مستلمة)\s*[:\-]?\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?/gi;
// Arabic balance figures — amount BEFORE keyword, e.g. "1568.76 المتاح" / "13195.21 EGP الرصيد"
const BALANCE_MASK_RE_AR_B = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?\s*(?:الرصيد(?:\s*(?:المتاح|المتبقي|المتبقى))?|الحد(?:\s*المتاح)?|المتاح|المتبقي|المتبقى|رصيد(?:\s*متاح)?|متاح|متبقي|متبقى)/gi;
// Unified regex to find all currency+amount candidates with their text position
// The second alternative uses (?<!\w) to prevent matching digits embedded in card/account
// numbers like "XXXX1311 USD" where 1311 is part of the card number, not an amount.
// Second branch requires no leading zeros (e.g. "001 AED" from account numbers like
// "036-722***-001 AED 51.00" must not be matched as amount=1).
const AMOUNT_POS_RE = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*([0-9,]+(?:\.[0-9]{1,3})?))|(?:(?<!\w)([1-9][0-9,]*(?:\.[0-9]{1,3})?|0\.[0-9]{1,3})\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))/gi;

/**
 * Returns true if the SMS body looks like a bank/card transaction alert.
 * Must match at least one strong bank indicator to be considered.
 */
function isBankingSMS(body) {
  if (!body || typeof body !== "string") return false;

  // Strong signals — any one of these is enough
  const STRONG = /\b(debited|credited|reversed|reversal|transaction|txn|purchase|withdrawal|has been used|used for|credit card|debit card|pos |atm |card ending|card no|account ending|a\/c ending|a\/c no|acct no|your card|your account|bank account|internet banking|online banking|mobile banking|dear customer|dear valued|salary|authorization code|auth code|ref no|reference no|upi|neft|rtgs|imps|swift|wire transfer|tt\s+payment|telegraphic\s+transfer|direct debit|standing order|emi|instalment|installment|cashback|refund|available\s+balance|your\s+balance)\b|(?:بطاقة|بطاقه|المدفوعة\s*مقد(?:ما|مًا)|مدفوعة\s*مقد(?:ما|مًا)|حساب|المتاح|رصيد|تم\s*خصم|تم\s*(?:ايداع|إيداع)|عملية\s*شراء|للمزيد\s*اتصل)/i;

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
  // Skip Arabic card-statement / account-summary SMSes (كشف حساب, الحد الأدنى للدفع, etc.)
  if (CARD_STATEMENT_RE_AR.test(body)) return [];
  // Skip merchant/utility payment confirmations ("against A/C") — bank SMS already covers this debit
  if (MERCHANT_CONFIRM_RE.test(body)) return [];
  // Skip telecom bundle / roaming subscription instructions — not financial transactions
  if (TELECOM_SERVICE_RE.test(body)) return [];

  // Step 1: Mask balance/informational amounts in both directions
  const masked = body
    .replace(RATE_MASK_RE, (m) => " ".repeat(m.length))
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

/** Render Insights — reads from in-memory state, effectively instant */
async function refreshAndRender() {
  const filterBtn = document.getElementById("dashFilterBtn");
  if (filterBtn) filterBtn.disabled = true;
  await renderDashboard();
  if (filterBtn) {
    filterBtn.disabled = false;
    filterBtn.textContent = t("dash_apply") || "Apply";
  }
}

// ── Insights Export ───────────────────────────────────────────────────────────

/** Download a string as a CSV file */
function downloadCSV(csv, filename) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Return a YYYY-MM-DD_HH-MM timestamp for filenames */
function localStampNow() {
  const now = new Date();
  return now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0") + "_" +
    String(now.getHours()).padStart(2, "0") + "-" +
    String(now.getMinutes()).padStart(2, "0");
}

/** Resolve the friendly device name for a message/call record */
function resolveDeviceName(id) {
  if (!id) return "";
  const dev = (state.devices || []).find((d) => d.id === id);
  return dev ? getFriendlyDeviceName(dev) : "";
}

/** Return the current date-filtered, device-filtered SMS and Calls data */
async function getCurrentFilteredData() {
  const fromInput = document.getElementById("dashFromDate");
  const toInput   = document.getElementById("dashToDate");
  const fromVal   = fromInput?.value || "";
  const toVal     = toInput?.value   || "";

  let allSms   = state.allSMSMessages || [];
  let allCalls = state.allCallsData   || [];

  if (fromVal && toVal) {
    const fromTs = dayStart(fromVal);
    const toTs   = dayEnd(toVal);
    const data   = await loadInsightsData(fromTs, toTs);
    allSms   = data.allSms;
    allCalls = data.allCalls;
  }

  const insightsDeviceTabs = document.getElementById("dashInsightsDeviceTabs");
  const selectedDevice =
    insightsDeviceTabs?.querySelector(".device-tab.active")?.dataset.device || "all";

  const filteredSms   = selectedDevice === "all" ? allSms   : allSms.filter((m) => m.deviceId === selectedDevice);
  const filteredCalls = selectedDevice === "all" ? allCalls : allCalls.filter((c) => c.deviceId === selectedDevice);

  return { filteredSms, filteredCalls, fromVal, toVal };
}

/**
 * Export 1 – SMS + Calls as a single xlsx file with two sheets.
 */
export async function exportInsightsSummaryToCSV() {
  const { filteredSms, filteredCalls, fromVal, toVal } = await getCurrentFilteredData();
  const stamp  = localStampNow();
  const suffix = fromVal && toVal ? `_${fromVal}_to_${toVal}` : "";

  if (filteredSms.length === 0 && filteredCalls.length === 0) {
    alert("No data to export in the selected range.");
    return;
  }

  const smsHeaders  = ["Date", "Time", "Direction", "Contact", "Phone Number", "Message", "SIM Card", "Device"];
  const smsRows     = filteredSms.map((m) => {
    const d         = new Date(m.timestamp || 0);
    const direction = m.direction === "outgoing" || m.type === "sent" ? "Sent" : "Received";
    return [
      d.toLocaleDateString("en-GB"),
      d.toLocaleTimeString(),
      direction,
      m.contactName || m.title || "",
      m.phoneNumber || m.sender || "",
      m.body || m.text || m.content || "",
      m.simSlot != null && m.simSlot >= 0 ? `SIM ${m.simSlot + 1}` : "",
      resolveDeviceName(m.deviceId) || m.deviceName || m.deviceId || "",
    ];
  });

  const callsHeaders = ["Date", "Time", "Type", "Contact", "Phone Number", "Duration (s)", "Device"];
  const callsRows    = filteredCalls.map((c) => {
    const d = new Date(c.timestamp || 0);
    return [
      d.toLocaleDateString("en-GB"),
      d.toLocaleTimeString(),
      c.type || "",
      c.contactName || c.title || "",
      c.phoneNumber || c.number || c.sender || "",
      typeof c.duration === "number" ? c.duration : (Number(c.duration) || 0),
      resolveDeviceName(c.deviceId) || c.deviceName || c.deviceId || "",
    ];
  });

  const blob = buildXLSX([
    { name: "SMS",   headers: smsHeaders,   rows: smsRows },
    { name: "Calls", headers: callsHeaders, rows: callsRows },
  ]);
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = `iRopit-Insights${suffix}_${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export 2 – SMS spending transactions for the current date/device filter.
 * Columns: Date, Time, Currency, Type, Amount, Sender, Device, Message Snippet
 */
export async function exportInsightsSpendingToCSV() {
  const { filteredSms, fromVal, toVal } = await getCurrentFilteredData();
  const stamp  = localStampNow();
  const suffix = fromVal && toVal ? `_${fromVal}_to_${toVal}` : "";

  if (filteredSms.length === 0) {
    alert("No SMS data to export.");
    return;
  }

  const header = ["Date", "Time", "Currency", "Type", "Amount", "Sender", "Device", "Message Snippet"];
  const rows   = [];
  // Dedup by body content + calendar day — prevents dual-writer duplicates (NotificationService
  // vs BackgroundSmsService) from appearing as separate rows even if they have different senders.
  const csvSeenBodies = new Set();

  for (const msg of filteredSms) {
    const body = msg.body || msg.text || msg.content || "";
    if (!isBankingSMS(body)) continue;
    const txns = extractTransactions(body);
    if (txns.length === 0) continue;
    const dayKey = Math.floor((msg.timestamp || 0) / 86400000);
    const bodyKey = `${dayKey}_${body.trim().substring(0, 120)}`;
    if (csvSeenBodies.has(bodyKey)) continue;
    csvSeenBodies.add(bodyKey);

    const d       = new Date(msg.timestamp || 0);
    const date    = d.toLocaleDateString("en-GB");
    const time    = d.toLocaleTimeString();
    const sender  = msg.sender || msg.address || msg.phoneNumber || "";
    const device  = resolveDeviceName(msg.deviceId) || msg.deviceName || msg.deviceId || "";
    const snippet = body.slice(0, 100).replace(/\n/g, " ");

    for (const txn of txns) {
      rows.push(
        [date, time, txn.currency, txn.type === "debit" ? "Spent" : "Received", txn.amount, sender, device, snippet]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
      );
    }
  }

  if (rows.length === 0) {
    alert("No financial transactions found in the selected range.");
    return;
  }

  downloadCSV([header.join(","), ...rows].join("\n"), `iRopit-Spending${suffix}_${stamp}.csv`);
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

  // Export buttons
  document.getElementById("exportInsightsSummaryBtn")?.addEventListener("click", () => exportInsightsSummaryToCSV());
  document.getElementById("exportInsightsSpendingBtn")?.addEventListener("click", () => exportInsightsSpendingToCSV());

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

  // Re-render when SMS or Calls finish syncing so the loading state
  // (shown on fresh install) is automatically replaced with real data.
  if (!window.__iropit_dashSyncListenersWired) {
    window.__iropit_dashSyncListenersWired = true;
    const onSyncDone = () => {
      const dashTab = document.getElementById("dashboardTab");
      if (dashTab && dashTab.classList.contains("active")) {
        refreshAndRender();
      }
    };
    window.addEventListener("iropit:sms-sync-done", onSyncDone);
    window.addEventListener("iropit:calls-sync-done", onSyncDone);
  }
}
