import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs, collectionGroup } from "firebase/firestore";
import firebaseConfig from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---- same logic as dashboard.js ----
const DEBIT_KW = /\b(debited|debit|charged|charge|paid|payment|purchase|bought|withdrawn|withdrawal|deducted|deduct|sent|used\s+for|has\s+been\s+used|transfer(?:red)?\s+(?:to|from\s+your))\b/i;
const CREDIT_KW = /\b(credited|deposited|deposit|refund|cashback|returned|salary|transferred\s+to\s+your)\b/i;
const BAL_A = /\b(balance|bal\.?|avail(?:able)?\.?|remaining|rem\.?|limit|outstanding|due|minimum|min\.?|opening|closing|cr\.?\s*bal|dr\.?\s*bal)\s*(?:is\s+|are\s+)?[:\-]?\s*(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?/gi;
const BAL_B = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*)?([0-9,]+(?:\.[0-9]{1,3})?)(?:\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))?\s*(?:is\s+(?:your\s+|the\s+)?)?(?:(?:current|available|total|avail|new|updated)\s+)?\b(balance|bal\b|available\b|avail\b|limit\b|outstanding\b)/gi;
const AMT_RE = /(?:(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY|[$£€₹﷼])\s*([0-9,]+(?:\.[0-9]{1,3})?))|(?:(?<!\w)([0-9,]+(?:\.[0-9]{1,3})?)\s*(SAR|AED|KWD|BHD|QAR|OMR|EGP|JOD|USD|GBP|EUR|INR|PKR|MYR|TRY))/gi;
const STRONG = /\b(debited|credited|transaction|txn|purchase|withdrawal|has been used|used for|pos |atm |card ending|card no|account ending|a\/c ending|a\/c no|acct no|your card|your account|bank account|dear customer|dear valued|salary|authorization code|auth code|ref no|reference no|upi|neft|rtgs|imps|swift|wire transfer|direct debit|standing order|emi|instalment|installment|cashback|refund)\b/i;
const CURRENCY_MAP = { SAR:"SAR",AED:"AED",KWD:"KWD",BHD:"BHD",QAR:"QAR",OMR:"OMR",EGP:"EGP",JOD:"JOD",USD:"USD",GBP:"GBP",EUR:"EUR",INR:"INR",PKR:"PKR",MYR:"MYR",TRY:"TRY","$":"USD","£":"GBP","€":"EUR","₹":"INR","﷼":"SAR" };

function extractTransactions(body) {
  if (!body || typeof body !== "string") return [];
  const masked = body.replace(BAL_A, m => " ".repeat(m.length)).replace(BAL_B, m => " ".repeat(m.length));
  const candidates = [];
  let m;
  AMT_RE.lastIndex = 0;
  while ((m = AMT_RE.exec(masked)) !== null) {
    const currRaw = (m[1] || m[4] || "").trim().toUpperCase();
    const amtRaw = (m[2] || m[3] || "").replace(/,/g, "");
    const amount = parseFloat(amtRaw);
    if (!isNaN(amount) && amount > 0 && currRaw) candidates.push({ amount, currRaw, pos: m.index });
  }
  if (candidates.length === 0) return [];
  const WINDOW = 120;
  const results = [];
  const seen = new Set();
  for (const c of candidates) {
    const ctx = masked.slice(Math.max(0, c.pos - WINDOW), Math.min(masked.length, c.pos + WINDOW));
    const isDebit = DEBIT_KW.test(ctx);
    const isCredit = CREDIT_KW.test(ctx);
    if (!isDebit && !isCredit) continue;
    const type = isCredit && !isDebit ? "credit" : "debit";
    const currency = CURRENCY_MAP[c.currRaw] || c.currRaw;
    const key = `${currency}:${c.amount}:${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ amount: c.amount, currency, type });
  }
  return results;
}

async function run() {
  // Get all devices for the user
  const devSnap = await getDocs(query(collection(db, "devices"), where("userId", "==", "kSF35jtZDmbxQBsvq8lRbqzBnb23")));
  console.log(`Found ${devSnap.size} device(s)`);
  
  const byCurrency = {};
  let totalSms = 0, bankingSms = 0;

  for (const devDoc of devSnap.docs) {
    const deviceId = devDoc.id;
    const smsSnap = await getDocs(collection(db, `devices/${deviceId}/sms`));
    totalSms += smsSnap.size;
    for (const smsDoc of smsSnap.docs) {
      const d = smsDoc.data();
      const body = d.body || d.text || d.content || d.message || "";
      if (!STRONG.test(body)) continue;
      bankingSms++;
      for (const txn of extractTransactions(body)) {
        if (!byCurrency[txn.currency]) byCurrency[txn.currency] = { debit: 0, credit: 0 };
        if (txn.type === "debit") byCurrency[txn.currency].debit += txn.amount;
        else byCurrency[txn.currency].credit += txn.amount;
      }
    }
  }

  console.log(`Total SMS in DB: ${totalSms}, Banking SMS: ${bankingSms}\n`);
  console.log("Currency | Spent       | Received    | Net");
  console.log("---------|-------------|-------------|------------");
  for (const [cur, { debit, credit }] of Object.entries(byCurrency)) {
    const net = credit - debit;
    console.log(`${cur.padEnd(8)} | ${debit.toFixed(2).padStart(11)} | ${credit.toFixed(2).padStart(11)} | ${net.toFixed(2).padStart(11)}`);
  }
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
