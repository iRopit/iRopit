import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, orderBy, getDocs, limit } from "firebase/firestore";
import firebaseConfig from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const uid = "kSF35jtZDmbxQBsvq8lRbqzBnb23";
const deviceId = process.argv[2] || "MM-MOB-A56";

const tsMs = (v) => {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (v?.seconds) return v.seconds * 1000;
  return 0;
};

async function run() {
  console.log(`\n=== Device: ${deviceId} ===`);
  const q = query(
    collection(db, "users", uid, "devices", deviceId, "notifications"),
    orderBy("timestamp", "desc"),
    limit(2000),
  );
  const snap = await getDocs(q);
  console.log(`Total fetched (cap 2000): ${snap.size}`);

  // Distribution by day
  const byDay = {};
  const byApp = {};
  let oldestTs = Infinity, newestTs = 0;
  snap.forEach((d) => {
    const data = d.data();
    const t = tsMs(data.timestamp) || tsMs(data.createdAt);
    if (t > 0) {
      if (t < oldestTs) oldestTs = t;
      if (t > newestTs) newestTs = t;
      const day = new Date(t).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    } else {
      byDay["NO_TS"] = (byDay["NO_TS"] || 0) + 1;
    }
    const app = data.packageName || data.appName || "(no app)";
    byApp[app] = (byApp[app] || 0) + 1;
  });

  console.log(`Newest: ${newestTs ? new Date(newestTs).toISOString() : "n/a"}`);
  console.log(`Oldest: ${oldestTs !== Infinity ? new Date(oldestTs).toISOString() : "n/a"}`);

  console.log(`\nDocs per day (most recent first):`);
  Object.keys(byDay).sort().reverse().forEach((d) => {
    console.log(`  ${d}: ${byDay[d]}`);
  });

  console.log(`\nDocs per app (top 20):`);
  Object.entries(byApp)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  process.exit(0);
}

run().catch((e) => {
  console.error("ERR:", e.code || "", e.message || e);
  process.exit(1);
});
