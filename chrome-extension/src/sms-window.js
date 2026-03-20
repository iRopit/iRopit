/**
 * SMS Window – full-size conversation viewer
 * Reads conversation data stored in chrome.storage.local by the popup.
 */

function getInitials(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

chrome.storage.local.get(
  ["smsWindowPhone", "smsWindowContact", "smsWindowMessages"],
  (result) => {
    const phone = result.smsWindowPhone || "";
    const contactName = result.smsWindowContact || phone;
    const messages = result.smsWindowMessages || [];

    // Header
    document.getElementById("winAvatar").textContent = getInitials(contactName);
    document.getElementById("winName").textContent = contactName;

    if (phone && phone !== contactName && !phone.startsWith("contact_") && !phone.startsWith("sender_")) {
      document.getElementById("winPhone").textContent = phone;
    }

    document.getElementById("winCount").textContent =
      messages.length + " message" + (messages.length !== 1 ? "s" : "");

    const area = document.getElementById("messagesArea");
    const empty = document.getElementById("emptyState");

    if (messages.length === 0) {
      empty.textContent = "No messages found.";
      return;
    }

    empty.remove();

    messages.forEach((msg) => {
      const isSent = msg.direction === "outgoing" || msg.type === "sent";
      const bubble = document.createElement("div");
      bubble.className = "message-bubble " + (isSent ? "sent" : "received");
      bubble.innerHTML =
        `<div class="message-text">${escapeHtml(msg.body)}</div>` +
        `<div class="message-footer">` +
        `<span class="message-time">${escapeHtml(formatTime(msg.timestamp))}</span>` +
        (msg.deviceName
          ? `<span class="message-device">📱 ${escapeHtml(msg.deviceName)}</span>`
          : "") +
        `</div>`;
      area.appendChild(bubble);
    });

    // Scroll to bottom
    area.scrollTop = area.scrollHeight;
  }
);
