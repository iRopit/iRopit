import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import firebaseConfig from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const uid = "kSF35jtZDmbxQBsvq8lRbqzBnb23";

async function run() {
  const q = query(
    collection(db, "users", uid, "notifications"),
    orderBy("createdAt", "desc"),
    limit(5)
  );
  const snap = await getDocs(q);
  console.log("count:", snap.size);
  snap.forEach(doc => {
    const d = doc.data();
    console.log("keys:", Object.keys(d).sort().join(", "));
    console.log("timestamp:", d.timestamp, "| type:", typeof d.timestamp);
    const cat = d.createdAt;
    if (cat && typeof cat.toMillis === "function") {
      console.log("createdAt (Timestamp):", cat.toMillis(), "=>", new Date(cat.toMillis()).toISOString());
    } else {
      console.log("createdAt raw:", JSON.stringify(cat));
    }
    console.log("deviceId:", d.deviceId, "| title:", (d.title || "").slice(0, 50));
    console.log("---");
  });
  process.exit(0);
}
run().catch(e => { console.error(e.message || e); process.exit(1); });
