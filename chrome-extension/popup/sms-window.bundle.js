(() => {
  // src/sms-window.js
  function getInitials(name) {
    if (!name) return "?";
    return name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  }
  function formatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const now = /* @__PURE__ */ new Date();
    const isAr = localStorage.getItem("appLanguage") === "ar";
    const locale = isAr ? "ar-SA" : "en-US";
    const timeStr = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return (isAr ? "\u0627\u0644\u064A\u0648\u0645 " : "Today ") + timeStr;
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return (isAr ? "\u0623\u0645\u0633 " : "Yesterday ") + timeStr;
    }
    return d.toLocaleDateString(locale, { month: "short", day: "numeric" }) + " " + timeStr;
  }
  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function linkifyText(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(
      /(https?:\/\/[^\s<>"']+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="sms-link">$1</a>'
    );
  }
  function bootstrapFromStorage(retries = 12) {
    const params = new URLSearchParams(window.location.search || "");
    const tokenFromUrl = params.get("token") || "";
    chrome.storage.local.get(["smsWindowLatestToken", "smsWindowCurrentPayload", "smsWindowPhone", "smsWindowContact", "smsWindowMessages"], (base) => {
      const token = tokenFromUrl || base.smsWindowLatestToken || "";
      const renderData = (phone, contactName, messages) => {
        if (!phone && !contactName && messages.length === 0 && retries > 0) {
          setTimeout(() => bootstrapFromStorage(retries - 1), 120);
          return;
        }
        document.getElementById("winAvatar").textContent = getInitials(contactName);
        document.getElementById("winName").textContent = contactName;
        if (phone && phone !== contactName && !phone.startsWith("contact_") && !phone.startsWith("sender_")) {
          document.getElementById("winPhone").textContent = phone;
        }
        document.getElementById("winCount").textContent = messages.length + " message" + (messages.length !== 1 ? "s" : "");
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
          bubble.innerHTML = `<div class="message-text">${linkifyText(msg.body || msg.text || msg.content || "")}</div><div class="message-footer"><span class="message-time">${escapeHtml(formatTime(msg.timestamp))}</span>` + (msg.deviceName ? `<span class="message-device">\u{1F4F1} ${escapeHtml(msg.deviceName)}</span>` : "") + `</div>`;
          area.appendChild(bubble);
        });
        area.scrollTop = area.scrollHeight;
      };
      if (token) {
        const tokenKey = `smsWindowData_${token}`;
        chrome.storage.local.get([tokenKey, "smsWindowCurrentPayload"], (result) => {
          const tokenData = result[tokenKey];
          const currentPayload2 = result.smsWindowCurrentPayload;
          if (tokenData) {
            renderData(tokenData.phone || "", tokenData.contactName || tokenData.phone || "", tokenData.messages || []);
            return;
          }
          if (currentPayload2 && currentPayload2.token === token) {
            renderData(
              currentPayload2.phone || "",
              currentPayload2.contactName || currentPayload2.phone || "",
              currentPayload2.messages || []
            );
            return;
          }
          if (!tokenData) {
            if (retries > 0) {
              setTimeout(() => bootstrapFromStorage(retries - 1), 120);
              return;
            }
            renderData("", "", []);
            return;
          }
        });
        return;
      }
      const currentPayload = base.smsWindowCurrentPayload;
      if (currentPayload) {
        renderData(
          currentPayload.phone || "",
          currentPayload.contactName || currentPayload.phone || "",
          currentPayload.messages || []
        );
        return;
      }
      renderData(base.smsWindowPhone || "", base.smsWindowContact || base.smsWindowPhone || "", base.smsWindowMessages || []);
    });
  }
  bootstrapFromStorage();
})();
