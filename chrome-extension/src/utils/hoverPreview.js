let tooltipEl = null;
let globalListenersWired = false;
let activeHost = null;
const wiredContainers = new WeakSet();

function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "iropit-hover-tooltip";
  tooltipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function hideTooltip() {
  if (!tooltipEl) return;
  tooltipEl.classList.remove("visible");
  activeHost = null;
}

function positionTooltipByPoint(clientX, clientY) {
  if (!tooltipEl) return;

  const offset = 14;
  const padding = 12;
  let left = clientX + offset;
  let top = clientY + offset;

  const rect = tooltipEl.getBoundingClientRect();
  if (left + rect.width + padding > window.innerWidth) {
    left = window.innerWidth - rect.width - padding;
  }
  if (top + rect.height + padding > window.innerHeight) {
    top = window.innerHeight - rect.height - padding;
  }

  tooltipEl.style.left = `${Math.max(padding, left)}px`;
  tooltipEl.style.top = `${Math.max(padding, top)}px`;
}

function positionTooltipByElement(el) {
  if (!tooltipEl || !el) return;
  const r = el.getBoundingClientRect();
  const centerX = r.left + Math.min(r.width, 260) / 2;
  const topY = r.top;
  positionTooltipByPoint(centerX, topY);
}

function showTooltipFor(el, event) {
  const text = el?.dataset?.hoverPreview;
  if (!text) {
    hideTooltip();
    return;
  }

  const tip = ensureTooltip();
  tip.textContent = text;
  tip.classList.add("visible");

  if (event && typeof event.clientX === "number") {
    positionTooltipByPoint(event.clientX, event.clientY);
  } else {
    positionTooltipByElement(el);
  }
}

function resolveHoverHostFromEventTarget(target, container) {
  if (!container || !target) return null;
  const elementTarget = target instanceof Element ? target : target?.parentElement;
  if (!elementTarget) return null;
  const host = elementTarget.closest("[data-hover-preview]");
  if (!host || !container.contains(host)) return null;
  return host;
}

export function wireHoverPreview(container) {
  if (!container || wiredContainers.has(container)) return;
  wiredContainers.add(container);

  container.addEventListener("mouseover", (e) => {
    const host = resolveHoverHostFromEventTarget(e.target, container);
    if (!host) {
      if (tooltipEl?.classList.contains("visible")) hideTooltip();
      return;
    }
    activeHost = host;
    showTooltipFor(host, e);
  });

  container.addEventListener("mousemove", (e) => {
    const host = resolveHoverHostFromEventTarget(e.target, container);
    if (!host) {
      if (tooltipEl?.classList.contains("visible")) hideTooltip();
      return;
    }
    if (activeHost !== host || !tooltipEl?.classList.contains("visible")) {
      activeHost = host;
      showTooltipFor(host, e);
      return;
    }
    positionTooltipByPoint(e.clientX, e.clientY);
  });

  // Hide only when fully leaving the list container; moving between row children
  // should not dismiss the tooltip.
  container.addEventListener("mouseleave", hideTooltip);
  container.addEventListener("scroll", hideTooltip, true);
  container.addEventListener("mousedown", hideTooltip);

  container.addEventListener("focusin", (e) => {
    const host = resolveHoverHostFromEventTarget(e.target, container);
    if (!host) return;
    activeHost = host;
    showTooltipFor(host);
  });

  container.addEventListener("focusout", () => {
    hideTooltip();
  });

  if (!globalListenersWired) {
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);
    window.addEventListener("blur", hideTooltip);
    globalListenersWired = true;
  }
}
