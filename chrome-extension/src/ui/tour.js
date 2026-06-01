/**
 * First-Time User Tour
 * Shows a guided walkthrough of each tab on first install.
 * Stored completion in chrome.storage.local under "tourCompleted_v1".
 */

import { translations, getCurrentLanguage } from "../utils/i18n.js";

function t(key) {
  const lang = getCurrentLanguage();
  return translations[lang]?.[key] || translations["en"][key] || key;
}

const TOUR_KEY = "tourCompleted_v1";

const STEPS = [
  { tab: null,             titleKey: "tour_welcome_title",   descKey: "tour_welcome_desc"   },
  { tab: "chat",           titleKey: "tour_chat_title",      descKey: "tour_chat_desc"      },
  { tab: "sms",            titleKey: "tour_sms_title",       descKey: "tour_sms_desc"       },
  { tab: "calls",          titleKey: "tour_calls_title",     descKey: "tour_calls_desc"     },
  { tab: "notifications",  titleKey: "tour_notif_title",     descKey: "tour_notif_desc"     },
  { tab: "dashboard",      titleKey: "tour_dashboard_title", descKey: "tour_dashboard_desc" },
  { tab: "devices",        titleKey: "tour_devices_title",   descKey: "tour_devices_desc"   },
];

let currentStep = 0;
let tourCard = null;

export async function initTour() {
  const result = await chrome.storage.local.get(TOUR_KEY);
  if (result[TOUR_KEY]) return;
  createTourCard();
  showStep(0);
}

function createTourCard() {
  document.getElementById("tourCard")?.remove();

  tourCard = document.createElement("div");
  tourCard.id = "tourCard";
  tourCard.className = "tour-card";
  tourCard.innerHTML = `
    <button class="tour-close-btn" id="tourCloseBtn" aria-label="Close">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
    <h4 class="tour-title" id="tourTitle"></h4>
    <p class="tour-desc" id="tourDesc"></p>
    <div class="tour-footer">
      <span class="tour-counter" id="tourCounter"></span>
      <div class="tour-actions">
        <button class="tour-btn-skip" id="tourSkipBtn"></button>
        <button class="tour-btn-next" id="tourNextBtn"></button>
      </div>
    </div>
  `;
  document.body.appendChild(tourCard);

  document.getElementById("tourCloseBtn").addEventListener("click", completeTour);
  document.getElementById("tourSkipBtn").addEventListener("click", completeTour);
  document.getElementById("tourNextBtn").addEventListener("click", () => {
    if (currentStep < STEPS.length - 1) {
      showStep(currentStep + 1);
    } else {
      completeTour();
    }
  });
}

function showStep(index) {
  currentStep = index;
  const step = STEPS[index];

  document.getElementById("tourTitle").textContent = t(step.titleKey);
  document.getElementById("tourDesc").textContent = t(step.descKey);
  document.getElementById("tourCounter").textContent = `${index + 1} / ${STEPS.length}`;

  const nextBtn = document.getElementById("tourNextBtn");
  nextBtn.textContent = index < STEPS.length - 1 ? t("tour_next") : t("tour_finish");

  const skipBtn = document.getElementById("tourSkipBtn");
  skipBtn.textContent = t("tour_skip");
  skipBtn.style.display = index < STEPS.length - 1 ? "inline-block" : "none";

  // Highlight the relevant tab
  document.querySelectorAll(".tab.tour-highlighted").forEach((el) =>
    el.classList.remove("tour-highlighted")
  );
  if (step.tab) {
    document.querySelector(`.tab[data-tab="${step.tab}"]`)?.classList.add("tour-highlighted");
  }

  positionCard(step.tab);
}

function positionCard(tabName) {
  if (!tourCard) return;

  const CARD_WIDTH = 300;
  const POPUP_WIDTH = 700;

  if (!tabName) {
    // Welcome step: centre the card just below the tabs nav, no arrow
    const tabsNav = document.querySelector(".tabs");
    const navBottom = tabsNav ? tabsNav.getBoundingClientRect().bottom : 56;
    tourCard.style.top = `${navBottom + 8}px`;
    tourCard.style.left = `${(POPUP_WIDTH - CARD_WIDTH) / 2}px`;
    tourCard.style.setProperty("--tour-arrow-display", "none");
    return;
  }

  const tabEl = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const tabsNav = document.querySelector(".tabs");
  if (!tabEl || !tabsNav) return;

  const tabRect = tabEl.getBoundingClientRect();
  const navBottom = tabsNav.getBoundingClientRect().bottom;
  const tabCenterX = tabRect.left + tabRect.width / 2;

  // Clamp card so it stays within popup bounds
  let cardLeft = tabCenterX - CARD_WIDTH / 2;
  cardLeft = Math.max(8, Math.min(cardLeft, POPUP_WIDTH - CARD_WIDTH - 8));

  // Arrow offset: where on the card-top the triangle sits
  const arrowOffset = Math.max(18, Math.min(tabCenterX - cardLeft, CARD_WIDTH - 18));

  tourCard.style.top = `${navBottom + 10}px`;
  tourCard.style.left = `${cardLeft}px`;
  tourCard.style.setProperty("--tour-arrow-display", "block");
  tourCard.style.setProperty("--tour-arrow-offset", `${arrowOffset}px`);
}

async function completeTour() {
  await chrome.storage.local.set({ [TOUR_KEY]: true });
  document.querySelectorAll(".tab.tour-highlighted").forEach((el) =>
    el.classList.remove("tour-highlighted")
  );
  if (tourCard) {
    tourCard.classList.add("tour-exit");
    setTimeout(() => tourCard?.remove(), 250);
    tourCard = null;
  }
}
