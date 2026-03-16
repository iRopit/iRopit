"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  subscribeToChat,
  sendChatMessage,
  getDeviceNames,
  type ChatMessage,
} from "@/services/chatService";
import { getWebDeviceId } from "@/services/deviceService";
import {
  Send,
  Copy,
  Check,
  Image as ImageIcon,
  FileText,
  ExternalLink,
  Monitor,
  Smartphone,
  Chrome,
  Lock,
} from "lucide-react";

interface ChatTabProps {
  deviceFilter: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return d.toLocaleDateString();
}

function linkify(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      const href = part.startsWith("http") ? part : `https://${part}`;
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-info hover:underline inline-flex items-center gap-1"
        >
          {part} <ExternalLink className="w-3 h-3" />
        </a>
      );
    }
    return part;
  });
}

function getDeviceAvatar(platform: string) {
  const p = (platform || "").toLowerCase();
  if (p.includes("chrome") || p.includes("ext"))
    return (
      <div className="w-8 h-8 rounded-full bg-info/15 flex items-center justify-center shrink-0">
        <Chrome className="w-4 h-4 text-info" />
      </div>
    );
  if (p.includes("web"))
    return (
      <div className="w-8 h-8 rounded-full bg-secondary/15 flex items-center justify-center shrink-0">
        <Monitor className="w-4 h-4 text-secondary" />
      </div>
    );
  return (
    <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
      <Smartphone className="w-4 h-4 text-primary" />
    </div>
  );
}

export default function ChatTab({ deviceFilter }: ChatTabProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const webDeviceId = getWebDeviceId();

  useEffect(() => {
    if (!user) return;
    getDeviceNames(user.uid).then(setDeviceNames);
    const unsub = subscribeToChat(user.uid, setMessages);
    return unsub;
  }, [user]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const filtered =
    deviceFilter === "all"
      ? messages
      : messages.filter(
          (m) =>
            m.senderDeviceId === deviceFilter ||
            m.receiverDeviceId === deviceFilter,
        );

  const handleSend = async () => {
    if (!input.trim() || !user || sending) return;
    setSending(true);
    try {
      await sendChatMessage(
        user.uid,
        webDeviceId,
        input.trim(),
        user.displayName || "",
      );
      setInput("");
    } finally {
      setSending(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages Area */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-5 rotate-6">
            <Send className="w-9 h-9 text-primary -rotate-6" />
          </div>
          <h3 className="text-lg font-semibold text-txt mb-2">
            {t("chat.startConversation")}
          </h3>
          <p className="text-sm text-txt-secondary max-w-sm">
            {t("empty.chat")}
          </p>
        </div>
      ) : (
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {filtered.map((msg, idx) => {
            const isMine = msg.senderDeviceId === webDeviceId;
            const deviceName =
              deviceNames[msg.senderDeviceId] ||
              msg.senderPlatform ||
              "Unknown";
            const prevMsg = idx > 0 ? filtered[idx - 1] : null;
            const isConsecutive =
              prevMsg?.senderDeviceId === msg.senderDeviceId &&
              msg.timestamp - prevMsg.timestamp < 120000;

            return (
              <div key={msg.id}>
                {/* Show sender info if not consecutive */}
                {!isConsecutive && (
                  <div
                    className={`flex items-center gap-2 mb-1.5 ${isMine ? "justify-end pe-2" : "justify-start ps-2"}`}
                  >
                    <span className="text-[11px] font-medium text-txt-tertiary">
                      {deviceName}
                    </span>
                    <span className="text-[10px] text-txt-tertiary/60">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                )}

                <div
                  className={`flex items-end gap-2 ${isMine ? "flex-row-reverse" : "flex-row"}`}
                >
                  {/* Avatar - only show on first message of group */}
                  {!isConsecutive ? (
                    getDeviceAvatar(msg.senderPlatform)
                  ) : (
                    <div className="w-8 shrink-0" />
                  )}

                  {/* Message Bubble */}
                  <div
                    className={`group max-w-[70%] relative ${isMine ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`px-4 py-2.5 text-sm leading-relaxed ${
                        isMine
                          ? "bg-primary text-txt-inverse rounded-2xl rounded-ee-md"
                          : "bg-surface-secondary text-txt rounded-2xl rounded-es-md"
                      } ${!isConsecutive ? "" : isMine ? "rounded-2xl rounded-ee-md" : "rounded-2xl rounded-es-md"}`}
                    >
                      {/* Image preview */}
                      {msg.type === "image" &&
                        msg.fileUrl &&
                        !msg.fileUrl.startsWith("ENC:") && (
                          <a
                            href={msg.fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block mb-2 -mx-2 -mt-1"
                          >
                            <img
                              src={msg.fileUrl}
                              alt={msg.fileName || "Image"}
                              className="w-full rounded-xl max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            />
                          </a>
                        )}
                      {msg.type === "image" &&
                        msg.fileUrl &&
                        msg.fileUrl.startsWith("ENC:") && (
                          <div className="flex items-center gap-2 mb-2 opacity-60">
                            <ImageIcon className="w-5 h-5" />
                            <span className="text-xs">
                              {msg.fileName || t("chat.image")}
                            </span>
                          </div>
                        )}

                      {/* File attachment */}
                      {msg.type === "file" && msg.fileUrl && (
                        <a
                          href={
                            msg.fileUrl.startsWith("ENC:") ? "#" : msg.fileUrl
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-3 p-2.5 -mx-1 rounded-xl mb-1.5 ${
                            isMine
                              ? "bg-white/10 hover:bg-white/20"
                              : "bg-bg hover:bg-surface-tertiary"
                          } transition-colors`}
                        >
                          <div
                            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              isMine ? "bg-white/15" : "bg-primary/10"
                            }`}
                          >
                            <FileText
                              className={`w-5 h-5 ${isMine ? "text-white/80" : "text-primary"}`}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-xs font-medium truncate ${isMine ? "text-white" : "text-txt"}`}
                            >
                              {msg.fileName && !msg.fileName.startsWith("ENC:")
                                ? msg.fileName
                                : t("chat.file")}
                            </p>
                            <p
                              className={`text-[10px] ${isMine ? "text-white/60" : "text-txt-tertiary"}`}
                            >
                              {t("chat.file")}
                            </p>
                          </div>
                        </a>
                      )}

                      {/* Text content */}
                      {msg.content && !msg.content.startsWith("ENC:") && (
                        <p className="whitespace-pre-wrap break-words">
                          {linkify(msg.content)}
                        </p>
                      )}
                      {msg.content && msg.content.startsWith("ENC:") && (
                        <p className="whitespace-pre-wrap break-words opacity-50 italic text-xs flex items-center gap-1.5">
                          <Lock className="w-3 h-3" />
                          {t("chat.encryptedMessage") || "Encrypted message"}
                        </p>
                      )}

                      {/* Inline time for consecutive messages */}
                      {isConsecutive && (
                        <span
                          className={`text-[10px] mt-1 block ${isMine ? "text-white/40 text-end" : "text-txt-tertiary/60"}`}
                        >
                          {formatTime(msg.timestamp)}
                        </span>
                      )}
                    </div>

                    {/* Copy action */}
                    <button
                      onClick={() => handleCopy(msg.content, msg.id)}
                      className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all text-txt-tertiary hover:text-txt p-1.5 rounded-lg hover:bg-surface-secondary ${isMine ? "-start-9" : "-end-9"}`}
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border bg-surface">
        <div className="flex items-center gap-2 max-w-4xl mx-auto">
          <div className="flex-1 flex items-center bg-surface-secondary border border-border rounded-2xl px-4 focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary/40 transition-all">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.shiftKey && handleSend()
              }
              placeholder={t("chat.typeMessage")}
              className="flex-1 py-2.5 bg-transparent text-sm text-txt placeholder:text-txt-tertiary focus:outline-none"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary hover:bg-primary-dark text-txt-inverse transition-all disabled:opacity-40 disabled:hover:bg-primary shrink-0 shadow-sm hover:shadow-md"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
