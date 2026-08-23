import {
  db,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  writeBatch,
  doc,
  addDoc,
} from "@/lib/firebase";
import { decrypt } from "@/lib/crypto";
import type { DeviceInfo } from "./deviceService";

export interface SMSMessage {
  id: string;
  deviceId: string;
  deviceName: string;
  phoneNumber: string;
  contactName: string;
  body: string;
  timestamp: number;
  type: string;
  read: boolean;
}

export interface SMSConversation {
  phoneNumber: string;
  contactName: string;
  lastMessage: string;
  lastTimestamp: number;
  unreadCount: number;
  messages: SMSMessage[];
  deviceId: string;
  deviceName: string;
}

function normalizePhoneNumber(phone: string): string {
  if (!phone) return "";
  const stripped = phone.replace(/[^\d+]/g, "");
  if (!stripped) {
    // Alphanumeric sender (e.g., "HSBC", "CIB", "Orange") — preserve as lowercase key
    return phone.trim().toLowerCase();
  }
  let cleaned = stripped;
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

function resolvePhoneNumber(data: Record<string, unknown>): string {
  const candidates = [
    data.phoneNumber,
    data.sender,
    data.address,
    data.number,
    data.phone,
  ];
  const candidate = candidates.find((c) => c && isPhoneNumberLike(c));
  if (candidate) return candidate as string;
  if (data.title && isPhoneNumberLike(data.title)) return data.title as string;
  return (data.phoneNumber ||
    data.sender ||
    data.address ||
    data.number ||
    data.phone ||
    "") as string;
}

function resolveContactName(
  data: Record<string, unknown>,
  phoneNumber: string,
): string {
  if (data.contactName && (data.contactName as string).trim())
    return data.contactName as string;
  if (data.displayName && (data.displayName as string).trim())
    return data.displayName as string;
  if (
    data.title &&
    (data.title as string).trim() &&
    !isPhoneNumberLike(data.title)
  )
    return data.title as string;
  return phoneNumber || "";
}

export function subscribeToSMS(
  userId: string,
  devices: DeviceInfo[],
  callback: (conversations: SMSConversation[]) => void,
) {
  const unsubscribes: (() => void)[] = [];
  const allMessages: Map<string, SMSMessage[]> = new Map();

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
    // No limit — Firestore now uses memory-only cache so all reads go to server
    const q = query(
      collection(db, "users", sourceUserId, "devices", device.id, "notifications"),
      where("type", "==", "sms"),
      orderBy("timestamp", "desc"),
    );

    const unsub = onSnapshot(
      q,
      async (snapshot) => {
      const messages: SMSMessage[] = [];

      for (const d of snapshot.docs) {
        const data = d.data() as Record<string, unknown>;
        let phoneNumber = resolvePhoneNumber(data);
        let body = (data.body ||
          data.message ||
          data.text ||
          data.content ||
          "") as string;
        let contactName = resolveContactName(data, phoneNumber);

        phoneNumber = await decrypt(phoneNumber, userId);
        body = await decrypt(body, userId);
        contactName = await decrypt(contactName, userId);
        // Only fall back to phone number if decryption left us with nothing or
        // an unreadable encrypted blob — do NOT re-call resolveContactName because
        // it reads raw encrypted Firestore fields and would overwrite the decrypted value.
        if (!contactName || contactName.startsWith("ENC:")) {
          contactName = phoneNumber || "";
        }

        messages.push({
          id: d.id,
          deviceId: device.id,
          deviceName: device.name || "Unknown",
          phoneNumber: normalizePhoneNumber(phoneNumber),
          contactName: contactName || normalizePhoneNumber(phoneNumber),
          body,
          timestamp:
            (data.timestamp as { toMillis?: () => number })?.toMillis?.() ||
            (data.timestamp as number) ||
            Date.now(),
          type: (data.type as string) || "inbox",
          read: (data.read as boolean) ?? true,
        });
      }

      allMessages.set(device.id, messages);
      callback(buildConversations(allMessages));
    },
    (error) => {
      console.error(`[SMS] onSnapshot error for device ${device.id}:`, error);
    });

    unsubscribes.push(unsub);
  }

  return () => unsubscribes.forEach((u) => u());
}

function buildConversations(
  allMessages: Map<string, SMSMessage[]>,
): SMSConversation[] {
  const conversationMap = new Map<string, SMSConversation>();

  // Merge all per-device message arrays and apply two-pass dedup:
  // Pass 1 — by document ID (catches simple duplicates)
  // Pass 2 — by phone+body+5-min time window (catches Android dual-writer duplicates
  //           where NotificationService and BackgroundSmsService produce separate docs)
  const merged: SMSMessage[] = [];
  for (const msgs of allMessages.values()) merged.push(...msgs);

  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const deduped: SMSMessage[] = [];

  for (const msg of merged) {
    if (seenIds.has(msg.id)) continue;
    seenIds.add(msg.id);

    const body = msg.body.trim().substring(0, 100);
    const timeWindow = Math.floor((msg.timestamp || 0) / 300000);
    const contentKey = `${msg.phoneNumber}_${timeWindow}_${body}`;
    const bodyKey = body.length > 20 ? `body_${timeWindow}_${body}` : null;

    if (seenContent.has(contentKey)) continue;
    if (bodyKey && seenContent.has(bodyKey)) continue;
    seenContent.add(contentKey);
    if (bodyKey) seenContent.add(bodyKey);

    deduped.push(msg);
  }

  for (const msg of deduped) {
    const key = msg.phoneNumber;
    if (!key) continue;

    const existing = conversationMap.get(key);
    if (existing) {
      existing.messages.push(msg);
      if (msg.timestamp > existing.lastTimestamp) {
        existing.lastMessage = msg.body;
        existing.lastTimestamp = msg.timestamp;
        existing.contactName = msg.contactName || existing.contactName;
      }
      if (!msg.read) existing.unreadCount++;
    } else {
      conversationMap.set(key, {
        phoneNumber: key,
        contactName: msg.contactName,
        lastMessage: msg.body,
        lastTimestamp: msg.timestamp,
        unreadCount: msg.read ? 0 : 1,
        messages: [msg],
        deviceId: msg.deviceId,
        deviceName: msg.deviceName,
      });
    }
  }

  const conversations = Array.from(conversationMap.values());
  conversations.sort((a, b) => b.lastTimestamp - a.lastTimestamp);

  for (const conv of conversations) {
    conv.messages.sort((a, b) => a.timestamp - b.timestamp);
  }

  return conversations;
}

export async function markSMSAsRead(
  userId: string,
  deviceId: string,
  messageIds: string[],
) {
  const batch = writeBatch(db);
  for (const id of messageIds) {
    batch.update(
      doc(db, "users", userId, "devices", deviceId, "notifications", id),
      {
        read: true,
      },
    );
  }
  await batch.commit();
}

export async function sendSMS(
  userId: string,
  fromDeviceId: string,
  toDeviceId: string,
  phoneNumber: string,
  message: string,
): Promise<string> {
  const docRef = await addDoc(collection(db, "sms_requests"), {
    userId,
    fromDeviceId,
    toDeviceId,
    phoneNumber,
    message,
    status: "pending",
    timestamp: Date.now(),
  });
  return docRef.id;
}

export function subscribeSMSRequestStatus(
  requestId: string,
  callback: (status: string) => void,
): () => void {
  const unsub = onSnapshot(doc(db, "sms_requests", requestId), (snap) => {
    if (snap.exists()) {
      callback((snap.data().status as string) || "pending");
    }
  });
  return unsub;
}
