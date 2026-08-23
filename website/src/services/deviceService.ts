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
  isShared?: boolean;
  ownerUid?: string;
  permissions?: {
    sms?: boolean;
    calls?: boolean;
    notifications?: boolean;
  };
}

export async function getUserDevices(userId: string): Promise<DeviceInfo[]> {
  const q = query(collection(db, "devices"), where("userId", "==", userId));
  const snapshot = await getDocs(q);
  const ownDevices = snapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as DeviceInfo,
  );

  const sharesQuery = query(
    collection(db, "deviceShares"),
    where("sharedWithUid", "==", userId),
  );
  const sharesSnap = await getDocs(sharesQuery);

  const sharedDevices: DeviceInfo[] = await Promise.all(
    sharesSnap.docs.map(async (shareDoc) => {
      const share = shareDoc.data() as {
        ownerUid?: string;
        deviceId?: string;
        deviceName?: string;
        permissions?: { sms?: boolean; calls?: boolean; notifications?: boolean };
      };

      const ownerUid = share.ownerUid || "";
      const sharedDeviceId = share.deviceId || "";

      if (!ownerUid || !sharedDeviceId) {
        return null as unknown as DeviceInfo;
      }

      const sharedDeviceSnap = await getDoc(doc(db, "devices", sharedDeviceId));
      const sharedDeviceData = sharedDeviceSnap.exists()
        ? (sharedDeviceSnap.data() as Record<string, unknown>)
        : {};

      return {
        id: sharedDeviceId,
        userId: ownerUid,
        ownerUid,
        name:
          (sharedDeviceData.name as string) ||
          share.deviceName ||
          "Shared Device",
        type: (sharedDeviceData.type as string) || "android",
        platform: (sharedDeviceData.platform as string) || "android",
        model: (sharedDeviceData.model as string) || "",
        lastActiveAt: (sharedDeviceData.lastActiveAt as number) || 0,
        isOnline: Boolean(sharedDeviceData.isOnline),
        fcmToken: (sharedDeviceData.fcmToken as string) || "",
        isShared: true,
        permissions: share.permissions || {
          sms: true,
          calls: true,
          notifications: true,
        },
      } as DeviceInfo;
    }),
  );

  const validSharedDevices = sharedDevices.filter(
    (d) =>
      d &&
      d.id &&
      d.ownerUid &&
      (d.permissions?.sms !== false ||
        d.permissions?.calls !== false ||
        d.permissions?.notifications !== false),
  );

  // Deduplicate: if multiple devices share the same name+model+platform, keep
  // only the most recently active one (covers app reinstall / upgrade scenario).
  const seen = new Map<string, DeviceInfo>();
  for (const dev of ownDevices) {
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

  const merged = [...Array.from(seen.values()), ...validSharedDevices];

  // Deduplicate shared entries by ownerUid+deviceId if there are duplicate share rows.
  const sharedSeen = new Set<string>();
  return merged.filter((d) => {
    if (!d.isShared) return true;
    const key = `${d.ownerUid || ""}::${d.id || ""}`;
    if (sharedSeen.has(key)) return false;
    sharedSeen.add(key);
    return true;
  });
}

export async function deleteDevice(deviceId: string): Promise<void> {
  await deleteDoc(doc(db, "devices", deviceId));
}
