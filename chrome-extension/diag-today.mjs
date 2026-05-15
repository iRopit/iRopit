import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";
import firebaseConfig from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const userId = "kSF35jtZDmbxQBsvq8lRbqzBnb23";
// Known device IDs from check-sms-direct.mjs
const DEVICES = ["android_7249382ed438e159"];

const TODAY_START = new Date("2026-05-08T00:00:00").getTime();
const TODAY_END   = new Date("2026-05-08T23:59:59.999").getTime();
const STRONG = /\b(debited|credited|transaction|purchase|withdrawal|has been used|used for|card ending|your card|your account|bank account|dear customer|salary|cashback|refund)\b|(?:تم\s*خصم|خصم|عملية\s*شراء|تحويل\s*لحظي|حساب)/i;

async function run() {
  for (const deviceId of DEVICES) {
    const q = query(
      collection(db, "users", userId, "devices", deviceId, "notifications"),
      where("timestamp", ">=", TODAY_START),
      where("timestamp", "<=", TODAY_END)
    );
    const snap = await getDocs(q).catch(e => { console.error(deviceId, e.message); return null; });
    if (!snap || snap.empty) { console.log(deviceId + ": no data or no access"); continue; }

    const byType = {};
    snap.forEach(d => { const t = d.data().type||"?"; byType[t]=(byType[t]||0)+1; });
    console.log(`\n=== ${deviceId} — ${snap.size} today, types=${JSON.stringify(byType)} ===`);

    snap.forEach(doc => {
      const d = doc.data();
      const body = d.body || d.bigText || d.text || d.content || "";
      if (!STRONG.test(body)) return;
      const ts = new Date(d.timestamp).toLocaleTimeString();
      const snippet = body.slice(0, 120).replace(/\n/g, " ");
      console.log(`  [${ts}] type=${d.type||"?"} | ${snippet}`);
    });
  }
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
