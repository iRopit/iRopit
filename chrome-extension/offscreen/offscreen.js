// iRopit Offscreen Document — Clipboard operations + SW heartbeat
// Used by the service worker for Universal Copy (background clipboard writes).
// Chrome 116+ offscreen CLIPBOARD reason bypasses the focus requirement.
//
// Heartbeat: offscreen documents survive Chrome's MV3 SW 30s idle kill.
// Sending a message every 20s wakes the SW, keeping onSnapshot listeners alive
// and reducing notification delay from ~60s (alarm floor) down to ~20s.
setInterval(() => {
  chrome.runtime.sendMessage({ type: "offscreen-heartbeat" }).catch(() => {});
}, 20000);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "offscreen-copy" && msg.text) {
    writeToClipboard(msg.text);
  }
  // Don't return true / sendResponse — fire-and-forget.
});

async function writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback: create a textarea, select, execCommand
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}
