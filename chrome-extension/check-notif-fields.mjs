/**
 * Inspect the actual field names and timestamp values on user-level notifications.
 * Reads the first 5 docs from users/{uid}/notifications.
 */
import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import firebaseConfig from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const [,, email, password] = process.argv;
if (!email || !password) {
  console.error("Usage: node check-notif-fields.mjs <email> <password>");
  process.exit(1);
}

async function check() {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  console.log("UID:", uid);

  // User-level notifications
  const q = query(
    collection(db, "users", uid, "notifications"),
    orderBy("createdAt", "desc"),
    limit(5)
  );
  const snap = await getDocs(q);
  console.log(`\nUser-level notifications (${snap.size} fetched):`);
  snap.forEach((doc) => {
    const d = doc.data();
    console.log("  id:", doc.id);
    console.log("  keys:", Object.keys(d).join(", "));
    console.log("  timestamp:", d.timestamp, "(type:", typeof d.timestamp, ")");
    console.log("  createdAt:", d.createdAt?.toMillis?.() || d.createdAt, "(type:", typeof d.createdAt, ")");
    console.log("  receivedAt:", d.receivedAt);
    console.log("  deviceId:", d.deviceId);
    console.log("  title:", d.title);
    console.log("");
  });
  process.exit(0);
}

check().catch((e) => { console.error(e.message); process.exit(1); });
