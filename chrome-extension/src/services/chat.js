/**
 * Chat Service
 * Handles chat messages between devices
 */

import {
  db,
  storage,
  collection,
  addDoc,
  query,
  where,
  limit,
  orderBy,
  onSnapshot,
  ref,
  uploadBytes,
  getDownloadURL,
} from "../config/firebase.js";

import { chatMessages, chatInput, sendChatBtn } from "../ui/dom.js";
import { showToast, showLoadingOverlay, hideLoading } from "../ui/toasts.js";
import {
  formatTime,
  getDeviceId,
  escapeHtml,
  sanitizeUrl,
} from "../utils/helpers.js";
import * as state from "../state/index.js";
import { updateTabBadges } from "./badges.js";
import { encryptChatMessage, decryptChatMessage } from "./cryptoService.js";
// Push notifications are now handled automatically by Cloud Function onNewChatMessage

/**
 * Convert plain text with URLs into HTML with clickable links.
 * Escapes HTML first, then wraps URLs in <a> tags.
 */
function linkifyText(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/gi,
    (url) => {
      const href = url.startsWith("http") ? url : `https://${url}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="chat-link">${url}</a>`;
    },
  );
}

/**
 * Subscribe to chat messages
 */
export function subscribeToChat() {
  const user = state.currentUser;
  if (!user) return;

  const q = query(
    collection(db, "chats"),
    where("participants", "array-contains", user.uid),
    orderBy("timestamp", "desc"),
    limit(100),
  );

  // Track message IDs we've already seen to detect truly new ones
  const seenMessageIds = new Set();
  let initialLoadDone = false;

  const unsub = onSnapshot(q, async (snapshot) => {
    const rawMessages = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      rawMessages.push({ id: doc.id, ...data });
    });

    // Sort by timestamp locally
    rawMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // Decrypt messages
    const messages = await Promise.all(
      rawMessages.map((msg) => decryptChatMessage(msg, user.uid)),
    );

    // Auto-copy new messages from mobile to browser clipboard (Universal Copy)
    // Auto-open images from mobile in a new tab (Open received images)
    if (initialLoadDone) {
      const newFromMobile = messages.filter(
        (msg) =>
          !seenMessageIds.has(msg.id) &&
          msg.senderPlatform !== "chrome-extension" &&
          !(msg.senderDeviceId || "").startsWith("ext_"),
      );

      if (newFromMobile.length > 0) {
        // Check smart action settings once for the batch
        chrome.storage.local.get(
          ["smartAction_universalCopy", "smartAction_openImages", "smartAction_openUrls"],
          (result) => {
            const universalCopyOn = result.smartAction_universalCopy !== false;
            const openImagesOn = result.smartAction_openImages === true;
            const openUrlsOn = result.smartAction_openUrls === true;

            // Universal Copy: copy last text message to clipboard
            // Open URLs from text messages
            newFromMobile
              .filter((msg) => msg.type === "text" && msg.content)
              .slice(-1)
              .forEach((msg) => {
                if (universalCopyOn) {
                  navigator.clipboard.writeText(msg.content).catch(() => {});
                }
                if (openUrlsOn) {
                  const urlMatch = msg.content.match(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i);
                  if (urlMatch) {
                    const href = urlMatch[1].startsWith("http") ? urlMatch[1] : `https://${urlMatch[1]}`;
                    chrome.tabs.create({ url: href, active: false });
                  }
                }
              });

            // Open received images in new tab
            if (openImagesOn) {
              newFromMobile
                .filter((msg) => msg.type === "image" && msg.fileUrl)
                .forEach((msg) => {
                  const safeUrl = sanitizeUrl(msg.fileUrl);
                  if (safeUrl) chrome.tabs.create({ url: safeUrl, active: false });
                });
            }
          },
        );
      }
    }

    // Mark all current messages as seen
    messages.forEach((msg) => seenMessageIds.add(msg.id));
    initialLoadDone = true;

    state.setCachedChatMessages(messages);
    renderChatMessages(messages);
  });

  state.addUnsubscriber(unsub);
}

/**
 * Render chat messages
 * @param {Array} messages - Array of chat messages
 */
export function renderChatMessages(messages) {
  // Check if "All" tab is selected
  const selectedTab =
    document.querySelector("#chatDeviceTabs .device-tab.active")?.dataset
      .device || "all";
  const showDeviceName = true;

  // Filter messages by selected device
  let filteredMessages = messages;
  if (selectedTab !== "all") {
    filteredMessages = messages.filter((msg) => {
      // Show only messages sent TO or FROM this specific device
      return (
        msg.senderDeviceId === selectedTab ||
        msg.receiverDeviceId === selectedTab
      );
    });
  }

  // Deduplicate: fan-out sends one Firestore doc per device, so the same
  // logical message may appear multiple times. Collapse by sender + timestamp + content.
  const seenMsgKeys = new Set();
  filteredMessages = filteredMessages.filter((msg) => {
    const key = `${msg.senderDeviceId}|${msg.timestamp}|${msg.content || msg.fileUrl || ''}`;
    if (seenMsgKeys.has(key)) return false;
    seenMsgKeys.add(key);
    return true;
  });

  if (filteredMessages.length === 0) {
    chatMessages.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
        </svg>
        <p>Start a conversation</p>
        <span>Chat with your other devices</span>
      </div>
    `;
    updateTabBadges();
    return;
  }

  chatMessages.innerHTML = filteredMessages
    .map((msg) => {
      let content = "";

      // Image
      if (msg.type === "image" && msg.fileUrl) {
        const safeUrl = sanitizeUrl(msg.fileUrl);
        content = safeUrl
          ? `
          <div class="chat-image-container">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="chat-image-link">
              <img src="${safeUrl}" alt="Image" class="chat-image" />
            </a>
            <button class="chat-image-download-btn" data-url="${safeUrl}" title="Download image">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="8 17 12 21 16 17"/>
                <line x1="12" y1="21" x2="12" y2="9"/>
                <path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29"/>
              </svg>
            </button>
          </div>
        `
          : `<div class="chat-file-link"><span>Invalid image URL</span></div>`;
      }
      // File
      else if (msg.type === "file" && msg.fileUrl) {
        const safeUrl = sanitizeUrl(msg.fileUrl);
        content = safeUrl
          ? `
          <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="chat-file-link">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <span>${escapeHtml(msg.fileName || "File")}</span>
          </a>
        `
          : `<div class="chat-file-link"><span>Invalid file URL</span></div>`;
      }
      // Text
      else {
        content = `<div>${linkifyText(msg.content)}</div>`;
      }

      // Get device name from devices list
      const senderDevice = state.devices.find(
        (d) => d.id === msg.senderDeviceId,
      );
      const deviceName = escapeHtml(
        senderDevice?.nickname ||
          senderDevice?.name ||
          senderDevice?.model ||
          msg.senderPlatform ||
          "",
      );

      // Determine if message is sent from this extension
      const isSentFromExtension =
        msg.senderPlatform === "chrome-extension" ||
        (msg.senderDeviceId && msg.senderDeviceId.startsWith("ext_"));

      const direction = isSentFromExtension ? "sent" : "received";
      return `
        <div class="chat-message-wrapper ${direction}">
          <div class="chat-message ${direction}" 
               data-msg-id="${escapeHtml(msg.id)}" 
               data-msg-content="${escapeHtml(msg.content || "")}" 
               data-msg-sender="${escapeHtml(msg.senderId)}">
            ${
              showDeviceName && deviceName
                ? `<div class="chat-message-device">${deviceName}</div>`
                : ""
            }
            ${
              msg.replyTo
                ? `<div class="chat-reply-preview">↩ ${escapeHtml(
                    msg.replyTo.content.substring(0, 50),
                  )}${msg.replyTo.content.length > 50 ? "..." : ""}</div>`
                : ""
            }
            ${content}
            <div class="chat-message-time">${formatTime(msg.timestamp)}</div>
          </div>
          <div class="chat-message-actions">
            <button class="chat-action-btn copy-msg-btn" title="Copy text">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  // Add click listeners for reply
  chatMessages.querySelectorAll(".chat-message").forEach((el) => {
    el.addEventListener("click", () => setReplyTo(el));
  });

  // Image download button handlers
  chatMessages.querySelectorAll(".chat-image-download-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const url = btn.dataset.url;
      if (!url) return;
      chrome.downloads.download({ url, conflictAction: "uniquify" }, () => {
        if (chrome.runtime.lastError) {
          showToast("Download failed", "error");
        } else {
          showToast("Downloading image...", "success");
        }
      });
    });
  });

  // Copy button handlers
  chatMessages.querySelectorAll(".copy-msg-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const msgEl = btn.closest(".chat-message-wrapper")?.querySelector(".chat-message");
      const text = msgEl?.dataset.msgContent || "";
      navigator.clipboard.writeText(text).then(() => {
        showToast("Copied!", "success");
      }).catch(() => {
        showToast("Copy failed", "error");
      });
    });
  });

  // Scroll to the last message reliably.
  // scrollIntoView on the last element is more reliable than scrollTop = scrollHeight
  // because it works even before the browser has flushed the full layout.
  const lastMsg = chatMessages.lastElementChild;
  const scrollToBottom = () => {
    if (lastMsg) {
      lastMsg.scrollIntoView({ block: 'end', behavior: 'instant' });
    } else {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  };
  // Run twice: once immediately via RAF (for visible tab), once after a short
  // delay (for newly-opened popup where layout may not be fully painted yet).
  requestAnimationFrame(scrollToBottom);
  setTimeout(scrollToBottom, 150);

  // Re-scroll after each image finishes loading, since their dimensions aren't
  // known until they load and they push scrollHeight down.
  chatMessages.querySelectorAll('img.chat-image').forEach((img) => {
    if (!img.complete) {
      img.addEventListener('load', scrollToBottom, { once: true });
    }
  });

  updateTabBadges();
}

/**
 * Scroll the chat messages panel to the very bottom.
 * Called externally (e.g. when the chat tab becomes visible).
 */
export function scrollChatToBottom() {
  const el = document.getElementById('chatMessages');
  if (!el) return;
  const last = el.lastElementChild;
  const doScroll = () => {
    if (last) last.scrollIntoView({ block: 'end', behavior: 'instant' });
    else el.scrollTop = el.scrollHeight;
  };
  requestAnimationFrame(doScroll);
  setTimeout(doScroll, 150);
}

/**
 * Send a chat message
 */
export async function sendChatMessage() {
  const content = chatInput.value.trim();
  const user = state.currentUser;
  if (!content || !user) return;

  const deviceId = await getDeviceId();
  const selectedDeviceTab =
    document.querySelector("#chatDeviceTabs .device-tab.active")?.dataset
      .device || "all";

  const senderDevice = state.devices.find(
    (d) => d.id === deviceId ||
           d.platform === "chrome-extension" ||
           d.platform === "chrome"
  );
  const senderDeviceName = senderDevice?.nickname || senderDevice?.name || "Chrome Extension";

  let messageData = {
    senderId: user.uid,
    senderDeviceId: deviceId,
    senderName: senderDeviceName,
    senderPlatform: "chrome-extension",
    receiverId: user.uid,
    receiverDeviceId: selectedDeviceTab === "all" ? null : selectedDeviceTab,
    content: content,
    type: "text",
    read: false,
    timestamp: Date.now(),
    participants: [user.uid],
  };

  // Add reply info if replying
  if (state.currentReplyTo) {
    messageData.replyTo = {
      id: state.currentReplyTo.id,
      content: state.currentReplyTo.content,
      senderId: state.currentReplyTo.senderId,
    };
  }

  // Optimistic clear so user can type next message immediately
  chatInput.value = "";
  clearReply();

  try {
    // Encrypt message before sending
    messageData = await encryptChatMessage(messageData, user.uid);
    if (selectedDeviceTab === "all" && state.devices.length > 0) {
      // Fan out to mobile/non-extension devices so each sees its own copy;
      // exclude the extension's own device to avoid duplicate rendering
      const targetDevices = state.devices.filter(
        (dev) => !dev.id.startsWith("ext_") && dev.id !== deviceId
      );
      if (targetDevices.length > 0) {
        await Promise.all(
          targetDevices.map(async (dev) => {
            const perDevice = { ...messageData, receiverDeviceId: dev.id };
            await addDoc(collection(db, "chats"), perDevice);
          })
        );
      } else {
        // No mobile devices — send as broadcast so the extension still sees it
        await addDoc(collection(db, "chats"), messageData);
      }
    } else {
      await addDoc(collection(db, "chats"), messageData);
    }

    // Push notification is sent automatically by Cloud Function onNewChatMessage
  } catch (error) {
    console.error("Failed to send message:", error);
    showToast("Failed to send message", "error");
  }
}

/**
 * Format file size
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Get file extension
 * @param {string} fileName - File name
 * @returns {string} File extension
 */
function getFileExtension(fileName) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

// Store pending file for preview
let pendingFile = null;

/**
 * Show file preview modal
 * @param {File} file - File to preview
 */
function showFilePreview(file) {
  pendingFile = file;

  const modal = document.getElementById("filePreviewModal");
  const previewBody = document.getElementById("filePreviewBody");
  const progressContainer = document.getElementById("uploadProgressContainer");
  const sendBtn = document.getElementById("sendFileBtn");

  // Reset progress
  progressContainer.classList.add("hidden");
  document.getElementById("uploadProgressFill").style.width = "0%";
  document.getElementById("uploadProgressText").textContent = "0%";
  sendBtn.disabled = false;
  sendBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="22" y1="2" x2="11" y2="13"></line>
      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
    </svg>
    Send
  `;

  const isImage = file.type.startsWith("image/");
  const ext = getFileExtension(file.name);

  if (isImage) {
    // Show image preview
    const reader = new FileReader();
    reader.onload = (e) => {
      previewBody.innerHTML = `
        <img src="${e.target.result}" alt="Preview" class="file-preview-image" />
        <div class="file-preview-info">
          <span class="file-preview-name">${escapeHtml(file.name)}</span>
          <span class="file-preview-size">${formatFileSize(file.size)}</span>
        </div>
      `;
    };
    reader.readAsDataURL(file);
  } else {
    // Show file info
    previewBody.innerHTML = `
      <div class="file-preview-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </div>
      <div class="file-preview-info">
        <span class="file-preview-name">${escapeHtml(file.name)}</span>
        <span class="file-preview-size">${formatFileSize(file.size)}</span>
        <span class="file-preview-type">${escapeHtml(ext || "FILE")}</span>
      </div>
    `;
  }

  modal.classList.remove("hidden");
}

/**
 * Hide file preview modal
 */
function hideFilePreview() {
  const modal = document.getElementById("filePreviewModal");
  modal.classList.add("hidden");
  pendingFile = null;
}

/**
 * Update upload progress
 * @param {number} progress - Progress percentage (0-100)
 */
function updateUploadProgress(progress) {
  const progressFill = document.getElementById("uploadProgressFill");
  const progressText = document.getElementById("uploadProgressText");
  const progressContainer = document.getElementById("uploadProgressContainer");

  progressContainer.classList.remove("hidden");
  progressFill.style.width = `${progress}%`;
  progressText.textContent = `${Math.round(progress)}%`;
}

/**
 * Upload file to Firebase Storage with progress
 * @param {File} file - File to upload
 * @returns {Promise<Object>} Upload result with url, fileName, fileType
 */
async function uploadFileToStorage(file) {
  const user = state.currentUser;
  const timestamp = Date.now();
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const storagePath = `chat_files/${user.uid}/${timestamp}_${sanitizedName}`;

  const storageRef = ref(storage, storagePath);

  // Simulate progress for small files (uploadBytes doesn't support progress)
  const fileSize = file.size;
  const isLargeFile = fileSize > 500 * 1024; // > 500KB

  if (isLargeFile) {
    // Simulate progress updates
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress > 90) progress = 90;
      updateUploadProgress(progress);
    }, 200);

    await uploadBytes(storageRef, file);
    clearInterval(progressInterval);
    updateUploadProgress(100);
  } else {
    updateUploadProgress(30);
    await uploadBytes(storageRef, file);
    updateUploadProgress(100);
  }

  const downloadUrl = await getDownloadURL(storageRef);

  return {
    url: downloadUrl,
    fileName: file.name,
    fileType: file.type.startsWith("image/") ? "image" : "file",
  };
}

/**
 * Send file in chat (called from preview modal)
 */
async function sendFileFromPreview() {
  if (!pendingFile) return;

  const user = state.currentUser;
  const file = pendingFile;
  const sendBtn = document.getElementById("sendFileBtn");

  if (!file || !user) return;

  // Disable send button
  sendBtn.disabled = true;
  sendBtn.innerHTML = `
    <svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
      <path d="M12 2a10 10 0 0110 10" stroke-linecap="round"/>
    </svg>
    Uploading...
  `;

  try {
    const result = await uploadFileToStorage(file);
    const deviceId = await getDeviceId();
    const selectedDeviceTab =
      document.querySelector("#chatDeviceTabs .device-tab.active")?.dataset
        .device || "all";

    const contentText =
      result.fileType === "image" ? "📷 Image" : `📎 ${result.fileName}`;

    // Prepare file message data
    const senderDevice = state.devices.find(
      (d) => d.id === deviceId ||
             d.platform === "chrome-extension" ||
             d.platform === "chrome"
    );
    const senderDeviceName = senderDevice?.nickname || senderDevice?.name || "Chrome Extension";

    let fileMessageData = {
      senderId: user.uid,
      senderDeviceId: deviceId,
      senderName: senderDeviceName,
      senderPlatform: "chrome-extension",
      receiverId: user.uid,
      receiverDeviceId: selectedDeviceTab === "all" ? null : selectedDeviceTab,
      content: contentText,
      type: result.fileType,
      fileUrl: result.url,
      fileName: result.fileName,
      read: false,
      timestamp: Date.now(),
      participants: [user.uid],
    };

    // Encrypt message before sending
    fileMessageData = await encryptChatMessage(fileMessageData, user.uid);
    await addDoc(collection(db, "chats"), fileMessageData);

    // Push notification is sent automatically by Cloud Function onNewChatMessage

    hideFilePreview();
    showToast(
      `${result.fileType === "image" ? "Image" : "File"} sent!`,
      "success",
    );
  } catch (error) {
    showToast("Failed to send file", "error");
    console.error(error);
    sendBtn.disabled = false;
    sendBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
      Retry
    `;
  }
}

/**
 * Set reply to a message
 * @param {HTMLElement} element - Message element
 */
export function setReplyTo(element) {
  const msgId = element.dataset.msgId;
  const msgContent = element.dataset.msgContent;
  const msgSender = element.dataset.msgSender;

  state.setCurrentReplyTo({
    id: msgId,
    content: msgContent,
    senderId: msgSender,
  });

  // Show reply preview above input
  let replyPreview = document.getElementById("chatReplyPreview");
  if (!replyPreview) {
    replyPreview = document.createElement("div");
    replyPreview.id = "chatReplyPreview";
    replyPreview.className = "chat-reply-input-preview";
    const chatInputContainer = chatInput.parentElement;
    chatInputContainer.insertBefore(
      replyPreview,
      chatInputContainer.firstChild,
    );
  }

  replyPreview.innerHTML = `
    <span class="reply-text">↩ ${escapeHtml(msgContent.substring(0, 40))}${
      msgContent.length > 40 ? "..." : ""
    }</span>
    <button class="reply-close" onclick="window.clearReply()">×</button>
  `;
  replyPreview.style.display = "flex";
  chatInput.focus();
}

/**
 * Clear reply state
 */
export function clearReply() {
  state.setCurrentReplyTo(null);
  const replyPreview = document.getElementById("chatReplyPreview");
  if (replyPreview) {
    replyPreview.style.display = "none";
  }
}

/**
 * Initialize chat event listeners
 */
export function initChatListeners() {
  sendChatBtn?.addEventListener("click", sendChatMessage);
  chatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // File attachment button - show preview
  document.getElementById("attachFileBtn")?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "*/*";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) showFilePreview(file);
    };
    input.click();
  });

  // Image attachment button - show preview
  document.getElementById("attachImageBtn")?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) showFilePreview(file);
    };
    input.click();
  });

  // Preview modal buttons
  document
    .getElementById("closePreviewBtn")
    ?.addEventListener("click", hideFilePreview);
  document
    .getElementById("cancelFileBtn")
    ?.addEventListener("click", hideFilePreview);
  document
    .getElementById("sendFileBtn")
    ?.addEventListener("click", sendFileFromPreview);

  // Paste screenshot / image from clipboard (Ctrl+V anywhere while chat tab is active)
  document.addEventListener("paste", (e) => {
    const chatTab = document.getElementById("chatTab");
    if (!chatTab?.classList.contains("active")) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) showFilePreview(file);
        return;
      }
    }
  });

  // Expose to window for inline onclick
  window.setReplyTo = setReplyTo;
  window.clearReply = clearReply;
}
