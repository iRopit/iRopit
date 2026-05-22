/**
 * Modals Module
 * SMS send and call initiation modals have been removed.
 * Only profile footer initialization remains.
 */

/**
 * Initialize profile footer toggle
 */
export function initProfileFooter() {
  // Always read version from the installed manifest so it's always current
  const manifest = chrome.runtime.getManifest();
  const versionStr = `v${manifest.version}`;
  const versionEl = document.getElementById("extensionVersion");
  if (versionEl) versionEl.textContent = versionStr;
  document.querySelectorAll(".settings-version").forEach((el) => {
    el.textContent = `iRopit ${versionStr}`;
  });

  const toggleProfileBtn = document.getElementById("toggleProfileBtn");
  const profileFooter = document.getElementById("profileFooter");

  if (toggleProfileBtn && profileFooter) {
    toggleProfileBtn.addEventListener("click", () => {
      profileFooter.classList.toggle("collapsed");
      const isCollapsed = profileFooter.classList.contains("collapsed");
      localStorage.setItem("profileCollapsed", isCollapsed);
    });

    // Restore state on load
    const isCollapsed = localStorage.getItem("profileCollapsed") === "true";
    if (isCollapsed) {
      profileFooter.classList.add("collapsed");
    }
  }
}
