import {
  db,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  writeBatch,
  doc,
} from "@/lib/firebase";
import { decrypt } from "@/lib/crypto";
import type { DeviceInfo } from "./deviceService";

export interface CallRecord {
  id: string;
  deviceId: string;
  deviceName: string;
  phoneNumber: string;
  contactName: string;
  type: "incoming" | "outgoing" | "missed" | "rejected";
  duration: number;
  timestamp: number;
  viewed: boolean;
}

const GENERIC_TITLES = [
  "call",
  "missed call",
  "incoming call",
  "outgoing call",
  "مكالمة",
  "مكالمة فائتة",
  "مكالمة واردة",
  "مكالمة صادرة",
  "unknown",
  "غير معروف",
];

function normalizePhoneNumber(phone: string): string {
  if (!phone) return "";
  let cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+20")) cleaned = "0" + cleaned.slice(3);
  else if (cleaned.startsWith("20") && cleaned.length > 10)
    cleaned = "0" + cleaned.slice(2);
  if (
    cleaned.length > 0 &&
    !cleaned.startsWith("0") &&
    !cleaned.startsWith("+")
  ) {
    cleaned = "0" + cleaned;
  }
  return cleaned;
}

function isPhoneNumberLike(value: unknown): boolean {
  if (!value || typeof value !== "string") return false;
  const digits = value.replace(/[\s\-().]/g, "");
  return /\d{3,}/.test(digits);
}

function resolveCallType(data: Record<string, unknown>): CallRecord["type"] {
  const t = ((data.type || data.callType || "") as string).toLowerCase();
  if (t.includes("miss")) return "missed";
  if (t.includes("out") || t.includes("dial")) return "outgoing";
  if (t.includes("reject")) return "rejected";
  return "incoming";
}

export function subscribeToCalls(
  userId: string,
  devices: DeviceInfo[],
  callback: (calls: CallRecord[]) => void,
) {
  const unsubscribes: (() => void)[] = [];
  const allCalls: Map<string, CallRecord[]> = new Map();

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
      collection(db, "users", userId, "devices", device.id, "calls"),
      orderBy("timestamp", "desc"),
      limit(200),
    );

    const unsub = onSnapshot(q, async (snapshot) => {
      const calls: CallRecord[] = [];

      for (const d of snapshot.docs) {
        const data = d.data() as Record<string, unknown>;

        let phoneNumber = (data.phoneNumber ||
          data.number ||
          data.address ||
          "") as string;
        let contactName = (data.contactName || "") as string;
        let displayName = (data.displayName || "") as string;

        phoneNumber = await decrypt(phoneNumber, userId);
        contactName = await decrypt(contactName, userId);
        displayName = await decrypt(displayName, userId);

        // Use title as phone fallback if it looks like a phone number
        if (
          !phoneNumber &&
          data.title &&
          isPhoneNumberLike(data.title as string)
        ) {
          phoneNumber = data.title as string;
        }

        // Resolve contact name: contactName > displayName > title (if not phone-like)
        if (!contactName && displayName) contactName = displayName;
        if (
          !contactName &&
          data.title &&
          !isPhoneNumberLike(data.title as string)
        ) {
          contactName = data.title as string;
        }

        if (GENERIC_TITLES.includes(contactName.toLowerCase())) {
          contactName = "";
        }

        calls.push({
          id: d.id,
          deviceId: device.id,
          deviceName: device.name || "Unknown",
          phoneNumber: normalizePhoneNumber(phoneNumber),
          contactName: contactName || normalizePhoneNumber(phoneNumber),
          type: resolveCallType(data),
          duration: (data.duration as number) || 0,
          timestamp:
            (data.timestamp as { toMillis?: () => number })?.toMillis?.() ||
            (data.timestamp as number) ||
            Date.now(),
          viewed: (data.viewed as boolean) ?? false,
        });
      }

      allCalls.set(device.id, calls);

      const merged = Array.from(allCalls.values()).flat();
      merged.sort((a, b) => b.timestamp - a.timestamp);
      callback(merged);
    });

    unsubscribes.push(unsub);
  }

  return () => unsubscribes.forEach((u) => u());
}

export async function markCallsAsViewed(
  userId: string,
  deviceId: string,
  callIds: string[],
) {
  const batch = writeBatch(db);
  for (const id of callIds) {
    batch.update(doc(db, "users", userId, "devices", deviceId, "calls", id), {
      viewed: true,
    });
  }
  await batch.commit();
}
