import {
  db,
  collection,
  getDocs,
  query,
  orderBy,
  onSnapshot,
} from "@/lib/firebase";
import type { DeviceInfo } from "./deviceService";

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  phoneNumbers: string[];
  deviceId: string;
  deviceName: string;
}

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

export function subscribeToContacts(
  userId: string,
  devices: DeviceInfo[],
  callback: (contacts: Contact[]) => void,
): () => void {
  const unsubscribes: (() => void)[] = [];
  const allContacts: Map<string, Contact[]> = new Map();

  const mobileDevices = devices.filter((d) => {
    const p = (d.platform || "").toLowerCase();
    const t = (d.type || "").toLowerCase();
    return (
      p !== "web" &&
      p !== "chrome-extension" &&
      t !== "web" &&
      t !== "chrome-extension" &&
      (d.permissions?.sms !== false)
    );
  });

  for (const device of mobileDevices) {
    const sourceUserId = device.isShared ? device.ownerUid || userId : userId;
    const q = query(
      collection(db, "users", sourceUserId, "devices", device.id, "contacts"),
      orderBy("name", "asc"),
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const contacts: Contact[] = [];
      for (const d of snapshot.docs) {
        const data = d.data();
        const phoneNumber = normalizePhoneNumber(
          (data.phoneNumber as string) || "",
        );
        const phoneNumbers: string[] = data.phoneNumbers
          ? (data.phoneNumbers as string[]).map(normalizePhoneNumber)
          : phoneNumber
            ? [phoneNumber]
            : [];

        if (phoneNumbers.length === 0) continue;

        contacts.push({
          id: d.id,
          name: (data.name as string) || "Unknown",
          phoneNumber: phoneNumbers[0],
          phoneNumbers,
          deviceId: device.id,
          deviceName: device.name || device.platform || "Unknown",
        });
      }
      allContacts.set(device.id, contacts);
      callback(deduplicateContacts(allContacts));
    });

    unsubscribes.push(unsub);
  }

  return () => unsubscribes.forEach((u) => u());
}

function deduplicateContacts(allContacts: Map<string, Contact[]>): Contact[] {
  const seen = new Map<string, Contact>();
  for (const contacts of allContacts.values()) {
    for (const c of contacts) {
      for (const phone of c.phoneNumbers) {
        if (!seen.has(phone)) {
          seen.set(phone, c);
        }
      }
    }
  }
  const unique = [
    ...new Map([...seen.values()].map((c) => [c.id + c.deviceId, c])).values(),
  ];
  unique.sort((a, b) => a.name.localeCompare(b.name));
  return unique;
}

export function searchContacts(contacts: Contact[], term: string): Contact[] {
  if (!term.trim()) return contacts;
  const lower = term.toLowerCase();
  return contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(lower) ||
      c.phoneNumbers.some((p) => p.includes(term)),
  );
}
