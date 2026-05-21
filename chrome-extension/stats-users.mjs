/**
 * Firebase Stats Script
 * Retrieves: registered users, devices per user, SMS count, calls count
 * Run: node stats-users.mjs
 */

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  getCountFromServer,
} from "firebase/firestore";
import firebaseConfig from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function getCount(colRef) {
  try {
    const snap = await getCountFromServer(colRef);
    return snap.data().count;
  } catch {
    // Fallback: getDocs count (if getCountFromServer not available)
    const snap = await getDocs(colRef);
    return snap.size;
  }
}

async function main() {
  console.log("=== iRopit Firebase Stats ===\n");

  // Step 1: Get all unique users from root `devices` collection
  const devicesSnap = await getDocs(collection(db, "devices"));
  const userMap = new Map(); // userId -> array of devices
  devicesSnap.forEach((doc) => {
    const d = doc.data();
    if (!d.userId) return;
    if (d.platform === "chrome-extension" || d.platform === "chrome" || d.id?.startsWith("ext_")) return;
    if (!userMap.has(d.userId)) userMap.set(d.userId, []);
    userMap.get(d.userId).push({ id: d.id || doc.id, name: d.nickname || d.name || d.model || doc.id });
  });

  console.log(`Total registered users: ${userMap.size}`);
  console.log(`Total mobile devices:   ${devicesSnap.size}\n`);

  let grandTotalSMS = 0;
  let grandTotalCalls = 0;

  // Step 2: For each user, count SMS & calls across all their devices
  for (const [userId, devices] of userMap.entries()) {
    let userSMS = 0;
    let userCalls = 0;

    for (const device of devices) {
      const smsCol = query(
        collection(db, "users", userId, "devices", device.id, "notifications"),
        where("type", "==", "sms"),
      );
      const callsCol = collection(db, "users", userId, "devices", device.id, "calls");

      const [smsCount, callsCount] = await Promise.all([
        getCount(smsCol),
        getCount(callsCol),
      ]);

      userSMS += smsCount;
      userCalls += callsCount;
    }

    grandTotalSMS += userSMS;
    grandTotalCalls += userCalls;

    console.log(`User: ${userId}`);
    console.log(`  Devices: ${devices.map((d) => d.name).join(", ")}`);
    console.log(`  SMS:     ${userSMS}`);
    console.log(`  Calls:   ${userCalls}`);
    console.log();
  }

  console.log("=== Totals ===");
  console.log(`Users:  ${userMap.size}`);
  console.log(`SMS:    ${grandTotalSMS}`);
  console.log(`Calls:  ${grandTotalCalls}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
