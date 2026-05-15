import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import firebaseConfig from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const userId = "kSF35jtZDmbxQBsvq8lRbqzBnb23";

// Date range from the screenshot: 02/05/2026 – 08/05/2026
const fromTs = new Date("2026-05-02T00:00:00").getTime();
const toTs   = new Date("2026-05-08T23:59:59").getTime();

async function check() {
  // List devices from users/{uid}/devices sub-collection
  const devSnap = await getDocs(collection(db, "users", userId, "devices"));
  const devices = [];
  devSnap.forEach((doc) => {
    const d = doc.data();
    if (d.platform === "chrome-extension" || d.platform === "chrome" || (d.id && d.id.startsWith("ext_"))) return;
    devices.push({ firestoreId: doc.id, dataId: d.id, name: d.name || d.model || doc.id, platform: d.platform });
  });
  console.log(`\nMobile devices in users/${userId}/devices:`);
  devices.forEach((d) => console.log(`  docId=${d.firestoreId}  dataId=${d.dataId}  name=${d.name}  platform=${d.platform}`));

  let totalInRange = 0;
  for (const dev of devices) {
    const q = query(
      collection(db, "users", userId, "devices", dev.firestoreId, "calls"),
      orderBy("timestamp", "desc"),
      limit(500)
    );
    const snap = await getDocs(q);
    const allCalls = [];
    snap.forEach((doc) => {
      const d = doc.data();
      const ts = d.timestamp || 0;
      allCalls.push({ id: doc.id, ts, callDate: d.callDate });
    });
    const inRange = allCalls.filter((c) => c.ts >= fromTs && c.ts <= toTs);
    console.log(`\nDevice ${dev.name} (${dev.dataId || dev.firestoreId}): total=${allCalls.length}, in range 02/05-08/05=${inRange.length}`);
    totalInRange += inRange.length;
  }
  console.log(`\nExpected All Devices calls in range: ${totalInRange}`);
  process.exit(0);
}

check().catch((e) => { console.error(e); process.exit(1); });
