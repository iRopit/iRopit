import {
  db,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
} from "@/lib/firebase";
import { decrypt } from "@/lib/crypto";
import type { DeviceInfo } from "./deviceService";

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
    limit(100),
  );

  return onSnapshot(q, async (snapshot) => {
    const messages: ChatMessage[] = [];

    for (const d of snapshot.docs) {
      const data = d.data();

      // Decrypt all encrypted chat fields: content, fileUrl, fileName
      let content = data.content || "";
      let fileUrl = data.fileUrl || "";
      let fileName = data.fileName || "";

      if (content) content = await decrypt(content, userId);
      if (fileUrl) fileUrl = await decrypt(fileUrl, userId);
      if (fileName) fileName = await decrypt(fileName, userId);

      messages.push({
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
      });
    }

    messages.sort((a, b) => a.timestamp - b.timestamp);
    callback(messages);
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
