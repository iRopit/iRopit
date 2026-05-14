import {
  db,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  doc,
  getDoc,
  setDoc,
} from "@/lib/firebase";
import { decrypt } from "@/lib/crypto";
import type { DeviceInfo } from "./deviceService";

// ── Starred messages ──────────────────────────────────────────────────────────
const STARRED_LS_KEY = "chatStarredMessages";

export function getStarredMessages(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(STARRED_LS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveStarredLocal(s: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STARRED_LS_KEY, JSON.stringify([...s]));
}

export async function loadStarredMessages(userId: string): Promise<Set<string>> {
  try {
    const snap = await getDoc(doc(db, "users", userId));
    if (snap.exists()) {
      const ids: string[] = snap.data().starredMessageIds || [];
      const s = new Set<string>(ids);
      saveStarredLocal(s);
      return s;
    }
  } catch (e) {
    console.debug("[Chat] Could not load starred messages:", e);
  }
  return getStarredMessages();
}

export async function toggleStarMessage(
  userId: string,
  msgId: string,
): Promise<Set<string>> {
  const starred = getStarredMessages();
  if (starred.has(msgId)) {
    starred.delete(msgId);
  } else {
    starred.add(msgId);
  }
  saveStarredLocal(starred);
  try {
    await setDoc(
      doc(db, "users", userId),
      { starredMessageIds: [...starred] },
      { merge: true },
    );
  } catch (e) {
    console.warn("[Chat] Could not persist starred messages:", e);
  }
  return starred;
}
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  content: string;
  type: string;
  fileUrl?: string;
  fileName?: string;
  senderDeviceId: string;
  senderPlatform: string;
  senderId: string;
  senderName?: string;
  receiverDeviceId?: string;
  timestamp: number;
  replyTo?: string;
}

export function subscribeToChat(
  userId: string,
  callback: (messages: ChatMessage[]) => void,
) {
  const q = query(
    collection(db, "chats"),
    where("participants", "array-contains", userId),
    orderBy("timestamp", "desc"),
    limit(200),
  );

  return onSnapshot(q, async (snapshot) => {
    const messages: ChatMessage[] = await Promise.all(
      snapshot.docs.map(async (d) => {
        const data = d.data();

        // Decrypt all encrypted chat fields: content, fileUrl, fileName
        let content = data.content || "";
        let fileUrl = data.fileUrl || "";
        let fileName = data.fileName || "";

        try {
          if (content) content = await decrypt(content, userId);
          if (fileUrl) fileUrl = await decrypt(fileUrl, userId);
          if (fileName) fileName = await decrypt(fileName, userId);
        } catch {
          // Decryption failure for one message should not block the rest
        }

        return {
          id: d.id,
          content,
          type: data.type || "text",
          fileUrl: fileUrl || undefined,
          fileName: fileName || undefined,
          senderDeviceId: data.senderDeviceId || "",
          senderPlatform: data.senderPlatform || "",
          senderId: data.senderId || "",
          senderName: data.senderName || "",
          receiverDeviceId: data.receiverDeviceId || "",
          timestamp: data.timestamp?.toMillis?.() || data.timestamp || Date.now(),
          replyTo: data.replyTo,
        } as ChatMessage;
      }),
    );

    messages.sort((a, b) => a.timestamp - b.timestamp);

    // Deduplicate: fan-out sends one Firestore doc per device, so the same
    // logical message may appear multiple times. Collapse by sender + timestamp + content.
    const seenKeys = new Set<string>();
    const deduped = messages.filter((msg) => {
      const key = `${msg.senderDeviceId}|${msg.timestamp}|${msg.content || msg.fileUrl || ""}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    callback(deduped);
  });
}

export async function sendChatMessage(
  userId: string,
  deviceId: string,
  content: string,
  displayName: string,
  targetDeviceId?: string,
) {
  const { encrypt } = await import("@/lib/crypto");
  const { addDoc, getDocs } = await import("@/lib/firebase");

  const encrypted = await encrypt(content, userId);

  const messageData = {
    content: encrypted,
    type: "text",
    senderId: userId,
    senderDeviceId: deviceId,
    senderPlatform: "web",
    senderName: displayName || "Web Browser",
    receiverId: userId,
    read: false,
    participants: [userId],
    timestamp: Date.now(),
  };

  if (targetDeviceId) {
    // Send to specific device
    await addDoc(collection(db, "chats"), {
      ...messageData,
      receiverDeviceId: targetDeviceId,
    });
  } else {
    // Fan out to all devices (same as extension and app)
    const devSnap = await getDocs(
      query(collection(db, "devices"), where("userId", "==", userId)),
    );
    const otherDevices = devSnap.docs.filter((d) => d.id !== deviceId);

    if (otherDevices.length > 0) {
      await Promise.all(
        otherDevices.map((dev) =>
          addDoc(collection(db, "chats"), {
            ...messageData,
            receiverDeviceId: dev.id,
          }),
        ),
      );
    } else {
      await addDoc(collection(db, "chats"), {
        ...messageData,
        receiverDeviceId: null,
      });
    }
  }
}

export async function getDeviceNames(
  userId: string,
): Promise<Record<string, string>> {
  const q = query(collection(db, "devices"), where("userId", "==", userId));
  const snapshot = await getDocs(q);
  const map: Record<string, string> = {};
  snapshot.forEach((d) => {
    const data = d.data();
    map[d.id] = data.name || data.platform || d.id;
  });
  return map;
}
