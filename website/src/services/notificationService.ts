import {
  db,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  writeBatch,
  doc,
} from "@/lib/firebase";
import type { DeviceInfo } from "./deviceService";

export interface NotificationItem {
  id: string;
  deviceId: string;
  deviceName: string;
  appName: string;
  title: string;
  body: string;
  timestamp: number;
  icon?: string;
  read?: boolean;
}

export async function markAllNotificationsAsRead(
  userId: string,
  notifications: NotificationItem[],
): Promise<void> {
  const unread = notifications.filter(
    (n) => n.deviceId !== "user" && n.read === false,
  );
  if (unread.length === 0) return;

  const batch = writeBatch(db);
  for (const n of unread) {
    batch.update(
      doc(db, "users", userId, "devices", n.deviceId, "notifications", n.id),
      { read: true },
    );
  }
  await batch.commit();
}

export function subscribeToNotifications(
  userId: string,
  devices: DeviceInfo[],
  callback: (notifications: NotificationItem[]) => void,
) {
  const unsubscribes: (() => void)[] = [];
  const allNotifications: Map<string, NotificationItem[]> = new Map();

  // User-level notifications
  const userNotifQuery = query(
    collection(db, "users", userId, "notifications"),
    orderBy("createdAt", "desc"),
    limit(200),
  );

  const unsub1 = onSnapshot(userNotifQuery, (snapshot) => {
    const notifs: NotificationItem[] = snapshot.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        deviceId: "user",
        deviceName: "Account",
        appName: data.appName || data.app || "System",
        title: data.title || "",
        body: data.body || data.text || data.message || "",
        timestamp:
          data.createdAt?.toMillis?.() ||
          data.createdAt ||
          data.timestamp?.toMillis?.() ||
          data.timestamp ||
          Date.now(),
        icon: data.icon || data.appIcon,
        read: data.read !== false,
      };
    });
    allNotifications.set("user", notifs);
    callback(mergeNotifications(allNotifications));
  });
  unsubscribes.push(unsub1);

  // Device-level notifications
  const mobileDevices = devices.filter((d) => {
    const p = (d.platform || "").toLowerCase();
    const t = (d.type || "").toLowerCase();
    return (
      p !== "web" &&
      p !== "chrome-extension" &&
      t !== "web" &&
      t !== "chrome-extension"
    );
  });

  for (const device of mobileDevices) {
    const q = query(
      collection(db, "users", userId, "devices", device.id, "notifications"),
      orderBy("timestamp", "desc"),
      limit(200),
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const notifs: NotificationItem[] = snapshot.docs
        .filter((d) => {
          const data = d.data();
          return data.type !== "sms";
        })
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            deviceId: device.id,
            deviceName: device.name || "Unknown",
            appName: data.appName || data.app || data.packageName || "System",
            title: data.title || "",
            body: data.body || data.text || data.message || "",
            timestamp:
              data.timestamp?.toMillis?.() || data.timestamp || Date.now(),
            icon: data.icon || data.appIcon,
            read: data.read !== false,
          };
        });
      allNotifications.set(device.id, notifs);
      callback(mergeNotifications(allNotifications));
    });

    unsubscribes.push(unsub);
  }

  return () => unsubscribes.forEach((u) => u());
}

function mergeNotifications(
  allNotifications: Map<string, NotificationItem[]>,
): NotificationItem[] {
  const seen = new Set<string>();
  const merged: NotificationItem[] = [];

  for (const notifs of allNotifications.values()) {
    for (const n of notifs) {
      if (!seen.has(n.id)) {
        seen.add(n.id);
        merged.push(n);
      }
    }
  }

  merged.sort((a, b) => b.timestamp - a.timestamp);
  return merged;
}
