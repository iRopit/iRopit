"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  subscribeToSMS,
  markSMSAsRead,
  sendSMS,
  subscribeSMSRequestStatus,
  type SMSConversation,
} from "@/services/smsService";
import {
  subscribeToContacts,
  searchContacts,
  type Contact,
} from "@/services/contactsService";
import { getDesktopSetting } from "@/services/desktopSettingsService";
import { getWebDeviceId, type DeviceInfo } from "@/services/deviceService";
import {
  MessageSquare,
  ArrowLeft,
  ArrowRight,
  Search,
  Send,
  Plus,
  X,
  User,
  Smartphone,
  Check,
  AlertTriangle,
  Loader2,
  Download,
  CheckCheck,
} from "lucide-react";

interface SMSTabProps {
  devices: DeviceInfo[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 172800000) return "Yesterday";
  return d.toLocaleDateString();
}

function extractOtpCode(message: string): string | null {
  if (!message) return null;

  const keywordPattern = /(otp|code|pin|verification|verify|رمز|كود)/i;
  const digitPattern = /\b(\d{4,8})\b/g;
  const allMatches = [...message.matchAll(digitPattern)].map((m) => m[1]);
  if (allMatches.length === 0) return null;

  if (keywordPattern.test(message)) {
    return allMatches[0] || null;
  }

  // Fallback for short transactional messages that include one clear OTP-like number.
  if (allMatches.length === 1 && message.length <= 160) {
    return allMatches[0] || null;
  }

  return null;
}

export default function SMSTab({ devices }: SMSTabProps) {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const [conversations, setConversations] = useState<SMSConversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<SMSConversation | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Compose modal state
  const [showCompose, setShowCompose] = useState(false);
  const [composeDevice, setComposeDevice] = useState("");
  const [composePhone, setComposePhone] = useState("");
  const [composeMessage, setComposeMessage] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [composeStatus, setComposeStatus] = useState<{
    type: "success" | "error" | "sending";
    text: string;
  } | null>(null);

  // Inline reply state
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyStatus, setReplyStatus] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const contactSearchRef = useRef<HTMLInputElement>(null);

  // Unread filter
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const knownSmsIdsRef = useRef<Set<string>>(new Set());
  const otpAutoCopyReadyRef = useRef(false);

  // Mobile devices only for sending
  const mobileDevices = devices.filter((d) => {
    const p = (d.platform || "").toLowerCase();
    const tp = (d.type || "").toLowerCase();
    return (
      p !== "web" &&
      p !== "chrome-extension" &&
      tp !== "web" &&
      tp !== "chrome-extension"
    );
  });

  // Subscribe to SMS
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToSMS(user.uid, devices, setConversations);
    return unsub;
  }, [user, devices]);

  // Subscribe to contacts
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToContacts(user.uid, devices, setContacts);
    return unsub;
  }, [user, devices]);

  // Auto-scroll messages
  useEffect(() => {
    if (selectedConv && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [selectedConv, conversations]);

  useEffect(() => {
    if (!getDesktopSetting("smartAction_copyOtp")) return;
    if (!navigator.clipboard?.writeText) return;

    const allMessages = conversations.flatMap((c) => c.messages);

    if (!otpAutoCopyReadyRef.current) {
      knownSmsIdsRef.current = new Set(allMessages.map((m) => m.id));
      otpAutoCopyReadyRef.current = true;
      return;
    }

    for (const msg of allMessages) {
      if (knownSmsIdsRef.current.has(msg.id)) continue;
      knownSmsIdsRef.current.add(msg.id);

      const msgType = (msg.type || "").toLowerCase();
      if (
        msgType.includes("sent") ||
        msgType.includes("out") ||
        msgType.includes("draft")
      ) {
        continue;
      }

      const otp = extractOtpCode(msg.body || "");
      if (!otp) continue;

      navigator.clipboard.writeText(otp).catch(() => {});
      break;
    }
  }, [conversations]);

  const filtered = (() => {
    let result = conversations;
    if (search) {
      result = result.filter(
        (c) =>
          c.contactName.toLowerCase().includes(search.toLowerCase()) ||
          c.phoneNumber.includes(search),
      );
    }
    if (showUnreadOnly) {
      result = result.filter((c) => c.unreadCount > 0);
    }
    return result;
  })();

  const filteredContacts = searchContacts(contacts, contactSearch);

  const handleOpenConversation = async (conv: SMSConversation) => {
    setSelectedConv(conv);
    setReplyText("");
    setReplyStatus(null);
    if (conv.unreadCount > 0 && user) {
      const unreadIds = conv.messages.filter((m) => !m.read).map((m) => m.id);
      if (unreadIds.length > 0) {
        await markSMSAsRead(user.uid, conv.deviceId, unreadIds);
      }
    }
  };

  const handleSelectContact = (contact: Contact, phone: string) => {
    setComposePhone(phone);
    setContactSearch(`${contact.name} (${phone})`);
  };

  const openCompose = () => {
    setShowCompose(true);
    setComposePhone("");
    setComposeMessage("");
    setContactSearch("");
    setComposeStatus(null);
    setComposeDevice(mobileDevices[0]?.id || "");
  };

  // Send SMS from compose modal
  const handleComposeSend = useCallback(async () => {
    if (
      !user ||
      !composeDevice ||
      !composePhone.trim() ||
      !composeMessage.trim()
    )
      return;
    setComposeSending(true);
    setComposeStatus({ type: "sending", text: t("sms.sending") });

    try {
      const fromDeviceId = getWebDeviceId();
      const reqId = await sendSMS(
        user.uid,
        fromDeviceId,
        composeDevice,
        composePhone.trim(),
        composeMessage.trim(),
      );

      // Listen for status update
      const unsub = subscribeSMSRequestStatus(reqId, (status) => {
        if (status === "sent") {
          setComposeStatus({ type: "success", text: t("sms.sent") });
          setComposeSending(false);
          setTimeout(() => {
            setShowCompose(false);
            setComposeStatus(null);
          }, 1500);
          unsub();
        } else if (status === "failed") {
          setComposeStatus({ type: "error", text: t("sms.sendFailed") });
          setComposeSending(false);
          unsub();
        }
      });

      // Timeout after 30s
      setTimeout(() => {
        unsub();
        setComposeSending(false);
        if (composeStatus?.type === "sending") {
          setComposeStatus({ type: "success", text: t("sms.sentPending") });
          setTimeout(() => {
            setShowCompose(false);
            setComposeStatus(null);
          }, 1500);
        }
      }, 30000);
    } catch {
      setComposeStatus({ type: "error", text: t("sms.sendFailed") });
      setComposeSending(false);
    }
  }, [user, composeDevice, composePhone, composeMessage, t, composeStatus]);

  // Send inline reply
  const handleReply = useCallback(async () => {
    if (!user || !selectedConv || !replyText.trim()) return;

    const targetDevice =
      mobileDevices.find((d) => d.id === selectedConv.deviceId) ||
      mobileDevices[0];
    if (!targetDevice) return;

    setReplySending(true);
    setReplyStatus(null);

    try {
      const fromDeviceId = getWebDeviceId();
      const reqId = await sendSMS(
        user.uid,
        fromDeviceId,
        targetDevice.id,
        selectedConv.phoneNumber,
        replyText.trim(),
      );
      setReplyText("");

      const unsub = subscribeSMSRequestStatus(reqId, (status) => {
        if (status === "sent") {
          setReplyStatus({ type: "success", text: t("sms.sent") });
          setReplySending(false);
          setTimeout(() => setReplyStatus(null), 3000);
          unsub();
        } else if (status === "failed") {
          setReplyStatus({ type: "error", text: t("sms.sendFailed") });
          setReplySending(false);
          unsub();
        }
      });

      setTimeout(() => {
        unsub();
        setReplySending(false);
      }, 30000);
    } catch {
      setReplyStatus({ type: "error", text: t("sms.sendFailed") });
      setReplySending(false);
    }
  }, [user, selectedConv, replyText, mobileDevices, t]);

  // Mark all conversations as read
  const handleMarkAllRead = useCallback(async () => {
    if (!user) return;
    for (const conv of conversations) {
      if (conv.unreadCount > 0) {
        const unreadIds = conv.messages.filter((m) => !m.read).map((m) => m.id);
        if (unreadIds.length > 0) {
          await markSMSAsRead(user.uid, conv.deviceId, unreadIds);
        }
      }
    }
  }, [user, conversations]);

  // Export conversations to CSV
  const handleExportCsv = useCallback(() => {
    const rows: string[] = [
      "Contact,Phone,Message,Time,Type,Device",
    ];
    for (const conv of conversations) {
      for (const msg of conv.messages) {
        const safe = (v: string) => `"${v.replace(/"/g, '""')}"`;
        rows.push(
          [
            safe(msg.contactName),
            safe(msg.phoneNumber),
            safe(msg.body),
            new Date(msg.timestamp).toISOString(),
            msg.type,
            safe(msg.deviceName),
          ].join(","),
        );
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `iropit-sms-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [conversations]);

  // ─── Compose Modal ───
  const composeModal = showCompose && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => !composeSending && setShowCompose(false)}
      />
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-base font-semibold text-txt">
            {t("sms.newSms")}
          </h3>
          <button
            onClick={() => !composeSending && setShowCompose(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-secondary transition-colors text-txt-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Device selector */}
          <div>
            <label className="text-xs font-medium text-txt-secondary mb-1.5 block">
              {t("sms.sendFrom")}
            </label>
            <div className="relative">
              <Smartphone className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-txt-tertiary" />
              <select
                value={composeDevice}
                onChange={(e) => setComposeDevice(e.target.value)}
                className="w-full ps-10 pe-4 py-2.5 bg-bg border border-border rounded-xl text-sm text-txt focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none"
              >
                {mobileDevices.length === 0 && (
                  <option value="">{t("sms.noDevice")}</option>
                )}
                {mobileDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name || d.platform || d.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Contact / Phone picker */}
          <div>
            <label className="text-xs font-medium text-txt-secondary mb-1.5 block">
              {t("sms.to")}
            </label>

            {/* Selected contact chip */}
            {composePhone ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-bg border border-border rounded-xl">
                <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <User className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-txt font-medium truncate">
                    {contactSearch || composePhone}
                  </p>
                  {contactSearch && contactSearch !== composePhone && (
                    <p className="text-[11px] text-txt-secondary">
                      {composePhone}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setComposePhone("");
                    setContactSearch("");
                  }}
                  className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-surface-secondary text-txt-tertiary hover:text-txt transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                {/* Search input */}
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-txt-tertiary" />
                  <input
                    ref={contactSearchRef}
                    type="text"
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder={t("sms.searchContactOrNumber")}
                    className="w-full ps-10 pe-4 py-2.5 bg-bg border border-border rounded-t-xl text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                </div>

                {/* Always-visible contact list */}
                <div className="bg-bg border border-t-0 border-border rounded-b-xl max-h-44 overflow-y-auto">
                  {/* Manual number entry option */}
                  {contactSearch &&
                    /\d{3,}/.test(contactSearch.replace(/\D/g, "")) && (
                      <button
                        onClick={() => {
                          const digits = contactSearch.replace(/[^\d+]/g, "");
                          setComposePhone(digits);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-secondary transition-colors text-start border-b border-border/50"
                      >
                        <div className="w-8 h-8 rounded-full bg-secondary/15 flex items-center justify-center shrink-0">
                          <MessageSquare className="w-4 h-4 text-secondary" />
                        </div>
                        <p className="text-sm text-txt">
                          {t("sms.sendTo")}{" "}
                          <span className="font-semibold">
                            {contactSearch.replace(/[^\d+]/g, "")}
                          </span>
                        </p>
                      </button>
                    )}

                  {filteredContacts.length === 0 && !contactSearch ? (
                    <div className="p-4 text-xs text-txt-tertiary text-center">
                      {t("sms.noContactsFound")}
                    </div>
                  ) : filteredContacts.length === 0 && contactSearch ? (
                    <div className="p-4 text-xs text-txt-tertiary text-center">
                      {t("sms.noContactsFound")}
                    </div>
                  ) : (
                    filteredContacts.slice(0, 100).map((c) =>
                      c.phoneNumbers.map((phone) => (
                        <button
                          key={`${c.id}-${phone}`}
                          onClick={() => handleSelectContact(c, phone)}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-secondary transition-colors text-start"
                        >
                          <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                            <span className="text-primary text-xs font-bold">
                              {c.name[0]?.toUpperCase() || "#"}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-txt font-medium truncate">
                              {c.name}
                            </p>
                            <p className="text-[11px] text-txt-secondary">
                              {phone}
                            </p>
                          </div>
                        </button>
                      )),
                    )
                  )}
                </div>
              </>
            )}
          </div>

          {/* Message */}
          <div>
            <label className="text-xs font-medium text-txt-secondary mb-1.5 block">
              {t("sms.message")}
            </label>
            <textarea
              value={composeMessage}
              onChange={(e) => setComposeMessage(e.target.value)}
              placeholder={t("sms.typeMessage")}
              rows={3}
              className="w-full px-3 py-2.5 bg-bg border border-border rounded-xl text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-txt-tertiary">
                {composeMessage.length}/160
              </span>
            </div>
          </div>

          {/* Status */}
          {composeStatus && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium ${
                composeStatus.type === "success"
                  ? "bg-success/10 text-success"
                  : composeStatus.type === "error"
                    ? "bg-error/10 text-error"
                    : "bg-info/10 text-info"
              }`}
            >
              {composeStatus.type === "success" ? (
                <Check className="w-3.5 h-3.5" />
              ) : composeStatus.type === "error" ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              )}
              {composeStatus.text}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => !composeSending && setShowCompose(false)}
              className="flex-1 py-2.5 text-sm font-medium text-txt-secondary bg-surface-secondary rounded-xl hover:bg-surface-tertiary transition"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleComposeSend}
              disabled={
                composeSending ||
                !composePhone.trim() ||
                !composeMessage.trim() ||
                !composeDevice
              }
              className="flex-1 py-2.5 text-sm font-medium text-txt-inverse bg-primary rounded-xl hover:bg-primary-dark transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {composeSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {t("sms.sendSms")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── Conversation Detail View ───
  if (selectedConv) {
    // Find current conversation from live data
    const liveConv =
      conversations.find((c) => c.phoneNumber === selectedConv.phoneNumber) ||
      selectedConv;

    return (
      <div className="flex-1 flex flex-col min-h-0 bg-bg">
        {/* Header */}
        <div className="flex items-center gap-3 p-3 border-b border-border bg-surface">
          <button
            onClick={() => setSelectedConv(null)}
            className="text-txt-secondary hover:text-txt transition-colors"
          >
            {isRTL ? (
              <ArrowRight className="w-5 h-5" />
            ) : (
              <ArrowLeft className="w-5 h-5" />
            )}
          </button>
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-primary font-bold text-sm">
              {liveConv.contactName[0]?.toUpperCase() || "#"}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-txt truncate">
              {liveConv.contactName}
            </p>
            <p className="text-xs text-txt-secondary">{liveConv.phoneNumber}</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {liveConv.messages.map((msg) => {
            const isSent = msg.type === "sent" || msg.type === "outbox";
            return (
              <div
                key={msg.id}
                className={`flex ${isSent ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm ${
                    isSent
                      ? "bg-primary text-txt-inverse rounded-ee-md"
                      : "bg-surface-secondary text-txt rounded-es-md"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                  <p
                    className={`text-[10px] mt-1 ${isSent ? "text-white/60" : "text-txt-tertiary"}`}
                  >
                    {formatTime(msg.timestamp)}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply status */}
        {replyStatus && (
          <div
            className={`mx-4 mb-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
              replyStatus.type === "success"
                ? "bg-success/10 text-success"
                : "bg-error/10 text-error"
            }`}
          >
            {replyStatus.type === "success" ? (
              <Check className="w-3 h-3" />
            ) : (
              <AlertTriangle className="w-3 h-3" />
            )}
            {replyStatus.text}
          </div>
        )}

        {/* Reply input */}
        {mobileDevices.length > 0 && (
          <div className="p-2.5 border-t border-border bg-surface">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleReply();
                  }
                }}
                placeholder={t("sms.typeMessage")}
                className="flex-1 px-4 py-2.5 bg-bg border border-border rounded-full text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                disabled={replySending}
              />
              <button
                onClick={handleReply}
                disabled={replySending || !replyText.trim()}
                className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-txt-inverse hover:bg-primary-dark transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                {replySending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        )}

        {composeModal}
      </div>
    );
  }

  // ─── Conversation List View ───
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg">
      {/* Search + New SMS button */}
      <div className="p-3 border-b border-border bg-surface">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-txt-tertiary" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("sms.searchConversations")}
              className="w-full ps-10 pe-4 py-2 bg-surface-secondary border border-border rounded-full text-sm text-txt placeholder:text-txt-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <button
            onClick={openCompose}
            className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-txt-inverse hover:bg-primary-dark transition shrink-0 shadow-sm"
            title={t("sms.newSms")}
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Action toolbar */}
        <div className="flex items-center gap-2 mt-2">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showUnreadOnly}
              onChange={(e) => setShowUnreadOnly(e.target.checked)}
              className="w-3.5 h-3.5 accent-primary"
            />
            <span className="text-xs text-txt-secondary">
              {t("sms.showUnread")}
            </span>
          </label>
          <div className="flex-1" />
          <button
            onClick={handleMarkAllRead}
            title={t("sms.markAllRead")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-secondary hover:bg-surface-tertiary text-xs text-txt-secondary hover:text-txt transition"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span className="hidden sm:block">{t("sms.markAllRead")}</span>
          </button>
          <button
            onClick={handleExportCsv}
            title={t("sms.exportCsv")}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-secondary hover:bg-surface-tertiary text-xs text-txt-secondary hover:text-txt transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:block">{t("sms.exportCsv")}</span>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-txt mb-2">
              {t("sms.noConversations")}
            </h3>
            <p className="text-sm text-txt-secondary max-w-sm">
              {t("empty.sms")}
            </p>
          </div>
        ) : (
          filtered.map((conv) => (
            <button
              key={conv.phoneNumber}
              onClick={() => handleOpenConversation(conv)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-hover transition-colors text-start border-b border-border/60"
            >
              <div className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <span className="text-primary font-bold text-sm">
                  {conv.contactName[0]?.toUpperCase() || "#"}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-txt truncate">
                    {conv.contactName}
                  </p>
                  <span className="text-[11px] text-txt-tertiary shrink-0 ms-2">
                    {formatTime(conv.lastTimestamp)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-xs text-txt-secondary truncate">
                    {conv.lastMessage}
                  </p>
                  {conv.unreadCount > 0 && (
                    <span className="min-w-[20px] h-5 flex items-center justify-center px-1.5 rounded-full bg-primary text-txt-inverse text-[10px] font-bold shrink-0 ms-2">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {composeModal}
    </div>
  );
}
