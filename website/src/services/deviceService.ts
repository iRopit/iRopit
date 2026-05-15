import {
  db,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  query,
  where,
} from "@/lib/firebase";

function generateDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("iropit_web_device_id");
  if (!id) {
    id = "web_" + crypto.randomUUID();
    localStorage.setItem("iropit_web_device_id", id);
  }
  return id;
}

export function getWebDeviceId(): string {
  return generateDeviceId();
}

export async function registerWebDevice(userId: string): Promise<string> {
  const deviceId = generateDeviceId();
  if (!deviceId) return "";

  const deviceRef = doc(db, "devices", deviceId);

  await setDoc(
    deviceRef,
    {
      id: deviceId,
      userId,
      name: "Web Browser",
      type: "web",
      platform: "web",
      model:
        typeof navigator !== "undefined"
          ? navigator.userAgent.slice(0, 100)
          : "Web",
      lastActiveAt: Date.now(),
      isOnline: true,
    },
    { merge: true },
  );

  await cleanupDuplicateWebDevices(userId, deviceId);
  return deviceId;
}

async function cleanupDuplicateWebDevices(
  userId: string,
  currentDeviceId: string,
) {
  const q = query(collection(db, "devices"), where("userId", "==", userId));
  const snapshot = await getDocs(q);
  const batch: Promise<void>[] = [];

  snapshot.forEach((d) => {
    const data = d.data();
    if (
      d.id !== currentDeviceId &&
      (data.platform === "web" ||
        data.type === "web" ||
        d.id.startsWith("web_"))
    ) {
      batch.push(deleteDoc(doc(db, "devices", d.id)));
    }
  });

  await Promise.all(batch);
}

export async function updateDeviceStatus(deviceId: string, isOnline: boolean) {
  if (!deviceId) return;
  const deviceRef = doc(db, "devices", deviceId);
  const snap = await getDoc(deviceRef);
  if (snap.exists()) {
    await setDoc(
      deviceRef,
      { isOnline, lastActiveAt: Date.now() },
      { merge: true },
    );
  }
}

export interface DeviceInfo {
  id: string;
  userId: string;
  name: string;
  type: string;
  platform: string;
  model?: string;
  lastActiveAt?: number;
  isOnline?: boolean;
  fcmToken?: string;
}

export async function getUserDevices(userId: string): Promise<DeviceInfo[]> {
  const q = query(collection(db, "devices"), where("userId", "==", userId));
  const snapshot = await getDocs(q);
  const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as DeviceInfo);

  // Deduplicate: if multiple devices share the same name+model+platform, keep
  // only the most recently active one (covers app reinstall / upgrade scenario).
  const seen = new Map<string, DeviceInfo>();
  for (const dev of all) {
    const key = [
      (dev.name || "").toLowerCase(),
      (dev.model || "").toLowerCase(),
      (dev.platform || "").toLowerCase(),
    ].join("|");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, dev);
    } else {
      const devTs = dev.lastActiveAt ?? 0;
      const exTs = existing.lastActiveAt ?? 0;
      // Prefer online device; among equal, prefer most recent timestamp
      const devWins =
        (dev.isOnline && !existing.isOnline) ||
        (!existing.isOnline && devTs > exTs) ||
        (dev.isOnline && existing.isOnline && devTs > exTs);
      if (devWins) seen.set(key, dev);
    }
  }

  return Array.from(seen.values());
}

export async function deleteDevice(deviceId: string): Promise<void> {
  await deleteDoc(doc(db, "devices", deviceId));
}
