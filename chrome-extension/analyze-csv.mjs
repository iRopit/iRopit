// Run the SAME extraction logic the extension uses against an exported CSV.
import fs from "node:fs";

const CSV = process.argv[2] || "C:\\Users\\Moham\\OneDrive\\Documents\\iRopit-SMS-2026-05-08 (2).csv";
const FROM = "2026-05-01";
const TO   = "2026-05-08";

const CURRENCY_MAP = {
  SAR:"SAR",AED:"AED",KWD:"KWD",BHD:"BHD",QAR:"QAR",OMR:"OMR",
  EGP:"EGP",JOD:"JOD",USD:"USD",GBP:"GBP",EUR:"EUR",INR:"INR",
  PKR:"PKR",MYR:"MYR",TRY:"TRY","$":"USD","£":"GBP","€":"EUR","₹":"INR","﷼":"SAR",
};

const DEBIT_KEYWORDS = /\b(debited|debit|charged|charge|paid|payment|purchase|bought|withdrawn|withdrawal|deducted|deduct|sent|used\s+for|has\s+been\s+used|transfer(?:red)?\s+(?:to|from\s+your))\b|(?:تم\s*خصم|خصم|عملية\s*شراء|شراء|سحب|مدفوعة|دفع|استخدام\s*بطاقة|استخدام\s*البطاقة)/i;
const CREDIT_KEYWORDS = /\b(credited|deposited|deposit|refund|cashback|returned|reversed|salary|transferred\s+to\s+your|received\s+(?:in(?:to)?|to)\s+(?:your|the)|incoming\s+(?:transfer|wire|payment|fund|funds?))\b|(?:تم\s*(?:ايداع|إيداع|اضافة|إضافة|تحويل)|ايداع|إيداع|استرداد|مرتجع|راتب|تحويل\s*وارد|إلى\s*حسابك|الى\s*حسابك)/i;
const STRONG_CREDIT_RE = /\b(credited|deposited|reversed)\b/i;
const STRONG_DEBIT_RE  = /\b(debited|deducted|deduct|withdrawn|withdrawal|charged)\b/i;
const CARD_BILL_PAYMENT_RE = /\bpayment\b.{0,80}\bfor\s+card\b.{0,80}\bhas\s+been\s+processed\b/i;
const PENDING_RE = /\bwill\s+be\b|\bon\s+its\s+way\b|\bpending\b|\bprocessing\b|\bwithin\s+\d+\s+(?:business\s+)?days\b/i;
const BALANCE_MASK_RE_A = /\b(balance|bal\.?|avail(?:able)?\.?|remaining|rem\.?|limit|outstanding|due|minimum|min\.?|opening|closing|cr\.?\s*bal|dr\.?\s*bal)\s*(?:is\s+|are\s+)?[:\-]?\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?/gi;
const BALANCE_MASK_RE_B = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?\s*(?:is\s+(?:your\s+|the\s+)?)?(?:(?:current|available|total|avail|new|updated)\s+)?\b(balance|bal\b|available\b|avail\b|limit\b|outstanding\b)/gi;
const BALANCE_MASK_AR = /(?:الرصيد\s*المتاح|رصيدك\s*المتاح|رصيدك|الرصيد|الحد\s*المتاح|الحد\s*الائتماني|حد\s*الائتمان|المبلغ\s*المتاح|الرصيد\s*الحالي|رصيد\s*حسابك)\s*[:\-]?\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?/gi;
const AMOUNT_POS_RE = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*([0-9,]+(?:\.[0-9]{1,3})?))|(?:(?<!\w)([0-9,]+(?:\.[0-9]{1,3})?)\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))/gi;

function isBankingSMS(body) {
  if (!body || typeof body !== "string") return false;
  const STRONG = /\b(debited|credited|transaction|txn|purchase|withdrawal|has been used|used for|pos |atm |card ending|card no|account ending|a\/c ending|a\/c no|acct no|your card|your account|bank account|dear customer|dear valued|salary|authorization code|auth code|ref no|reference no|upi|neft|rtgs|imps|swift|wire transfer|direct debit|standing order|emi|instalment|installment|cashback|refund|reversed)\b|(?:بطاقة|بطاقه|المدفوعة\s*مقد(?:ما|مًا)|مدفوعة\s*مقد(?:ما|مًا)|حساب|حسابك|المتاح|رصيد|تم\s*خصم|تم\s*(?:ايداع|إيداع)|تم\s*تنفيذ\s*تحويل|عملية\s*شراء|للمزيد\s*اتصل)/i;
  return STRONG.test(body);
}

function extractTransactions(body) {
  if (!body || typeof body !== "string") return [];
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
  const masked = body
    .replace(BALANCE_MASK_RE_A, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_RE_B, (m) => " ".repeat(m.length))
    .replace(BALANCE_MASK_AR,   (m) => " ".repeat(m.length));
  const candidates = [];
  let m;
  AMOUNT_POS_RE.lastIndex = 0;
  while ((m = AMOUNT_POS_RE.exec(masked)) !== null) {
    const currRaw = (m[1] || m[4] || "").trim().toUpperCase();
    const amtRaw  = (m[2] || m[3] || "").replace(/,/g, "");
    const amount  = parseFloat(amtRaw);
    if (!isNaN(amount) && amount > 0 && currRaw) candidates.push({ amount, currRaw, pos: m.index });
  }
  if (candidates.length === 0) return [];
  const WINDOW = 120;
  const results = [];
  const seen = new Set();
  for (const c of candidates) {
    const start = Math.max(0, c.pos - WINDOW);
    const end   = Math.min(masked.length, c.pos + WINDOW);
    const ctx   = masked.slice(start, end);
    const isDebit  = DEBIT_KEYWORDS.test(ctx);
    const isCredit = CREDIT_KEYWORDS.test(ctx);
    if (!isDebit && !isCredit) continue;
    if (!isDebit && isCredit && PENDING_RE.test(body)) continue;
    const isStrongCredit = STRONG_CREDIT_RE.test(ctx);
    const isStrongDebit  = STRONG_DEBIT_RE.test(ctx);
    const type = (isStrongCredit && !isStrongDebit) ? "credit"
               : (isCredit && !isDebit)             ? "credit"
               : "debit";
    const currency = CURRENCY_MAP[c.currRaw] || c.currRaw;
    const key = `${currency}:${c.amount}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ amount: c.amount, currency, type });
  }
  return results;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\r") { /* skip */ }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const text = fs.readFileSync(CSV, "utf8");
const rows = parseCsv(text);
const header = rows.shift();
const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

function toIso(dStr) {
  const [d, m, y] = dStr.split("/");
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
}

const inRange = rows.filter(r => {
  if (!r[idx.Date]) return false;
  const iso = toIso(r[idx.Date]);
  return iso >= FROM && iso <= TO;
});

console.log(`CSV total rows: ${rows.length}`);
console.log(`Rows in [${FROM}..${TO}]: ${inRange.length}`);

const byDate = {};
const byCurrency = {};
let banking = 0, nonBanking = 0;
const missedSamples = [];

for (const r of inRange) {
  const body = r[idx.Message] || "";
  const date = toIso(r[idx.Date]);
  const sender = r[idx["Phone Number"]] || r[idx.Contact] || "?";
  if (!isBankingSMS(body)) { nonBanking++; continue; }
  banking++;
  const txns = extractTransactions(body);
  if (txns.length === 0 && missedSamples.length < 12) {
    missedSamples.push({ date, sender, body: body.slice(0, 200) });
  }
  for (const t of txns) {
    if (!byCurrency[t.currency]) byCurrency[t.currency] = { debit: 0, credit: 0, n: 0 };
    byCurrency[t.currency][t.type] += t.amount;
    byCurrency[t.currency].n++;
    if (!byDate[date]) byDate[date] = {};
    if (!byDate[date][t.currency]) byDate[date][t.currency] = { debit: 0, credit: 0 };
    byDate[date][t.currency][t.type] += t.amount;
  }
}

console.log(`Banking SMS: ${banking}, non-banking: ${nonBanking}`);
console.log("\n=== Totals (CSV-derived expected values) ===");
for (const [c, v] of Object.entries(byCurrency)) {
  console.log(`  ${c}: spent=${v.debit.toFixed(2)}, received=${v.credit.toFixed(2)}, net=${(v.credit-v.debit).toFixed(2)}, txns=${v.n}`);
}

console.log("\n=== Per date ===");
for (const d of Object.keys(byDate).sort()) {
  const parts = Object.entries(byDate[d]).map(([c, v]) => {
    const bits = [];
    if (v.debit > 0) bits.push(`-${c} ${v.debit.toFixed(2)}`);
    if (v.credit > 0) bits.push(`+${c} ${v.credit.toFixed(2)}`);
    return bits.join(", ");
  }).join(" | ");
  console.log(`  ${d}: ${parts}`);
}

console.log("\n=== Missed banking SMS (banking detected but 0 txns extracted) ===");
for (const m of missedSamples) {
  console.log(`  [${m.date}] ${m.sender}: ${m.body}`);
}

console.log("\n=== Salary / 17500 / credited mentions in range ===");
for (const r of inRange) {
  const body = r[idx.Message] || "";
  if (/salary|17,?500|credited|deposited/i.test(body)) {
    const date = toIso(r[idx.Date]);
    console.log(`  [${date}] ${r[idx["Phone Number"]]}: ${body.slice(0, 220)}`);
  }
}
