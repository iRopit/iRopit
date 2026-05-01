# iRopit — Agent Instructions

## Project Overview

Mono-repo with 5 components:

| Folder | Purpose | Stack |
|--------|---------|-------|
| `app/` | Mobile app (SMS/calls sync) | React Native 0.83, TypeScript, Zustand, react-native-firebase |
| `chrome-extension/` | Browser extension | JS, MV3, esbuild, Firebase Web SDK |
| `functions/` | Backend logic | Firebase Cloud Functions, Node.js 20 |
| `website/` | Marketing site | Next.js 16, React 19, Tailwind CSS 4, TypeScript |
| `testsprite_tests/` | QA suite | Python, Selenium |

---

## Chrome Extension (most-edited component)

### Build & Deploy

```powershell
cd chrome-extension

npm run build   # esbuild bundle → patch (removes external script refs for MV3 compliance)
npm run zip     # creates IRopit-Extension-C{version}.zip

# Deploy to Google Drive
$dst = "G:\My Drive\Projects\iRopit\App\Extension\IRopit-Extension"
Copy-Item ".\IRopit-Extension-C{version}.zip" "$dst\IRopit-Extension-C{version}.zip" -Force
Copy-Item ".\popup\popup.bundle.js" "$dst\popup\popup.bundle.js" -Force
Copy-Item ".\popup\popup.html"      "$dst\popup\popup.html"      -Force
Copy-Item ".\manifest.json"         "$dst\manifest.json"         -Force
```

### Version Bumping

Update **5 places** every time the version changes:

| File | Field |
|------|-------|
| `manifest.json` | `"version"` and `"version_name"` |
| `package.json` | `"version"` |
| `popup/popup.html` | Login screen `v{ver}` paragraph |
| `popup/popup.html` | `<span id="extensionVersion">` |
| `popup/popup.html` | `<p class="settings-version">iRopit v{ver}</p>` |

### Architecture

```
src/
  popup.js          ← main entry (bundled → popup/popup.bundle.js)
  sms-window.js     ← SMS modal (bundled → popup/sms-window.bundle.js)
  service-worker.js ← background (patched directly)
  ui/               ← dashboard.js, navigation.js, tabs.js, modals.js …
  services/         ← auth, sms, calls, chat, notifications, devices, settings …
  utils/            ← i18n.js, helpers.js, theme.js, logger.js …
  state/            ← global state

popup/
  popup.html        ← UI template (contains hardcoded version strings)
  popup.css         ← all styles
  popup.bundle.js   ← build output (do not edit manually)

background/
  service-worker.js ← build output (do not edit manually)
```

### Internationalization (i18n)

Translations live in [`src/utils/i18n.js`](chrome-extension/src/utils/i18n.js) — a single `translations` object with `en` and `ar` keys.

- **Static HTML strings**: add `data-i18n="key"` attribute; `applyTranslations()` handles them automatically.
- **Dynamic JS strings**: use a local `t(key)` helper (see `src/ui/dashboard.js` for the pattern):
  ```js
  import { translations, getCurrentLanguage } from "../utils/i18n.js";
  function t(key) {
    const lang = getCurrentLanguage();
    return (translations[lang]?.[key]) || translations["en"][key] || key;
  }
  ```
- Arabic locale dates: pass `"ar-EG"` to `toLocaleDateString()` when `getCurrentLanguage() === "ar"`.

### CSS Theming

All colors use CSS variables — never hardcode hex values:

```css
var(--surface)            /* card/panel background */
var(--surface-secondary)  /* subtle background */
var(--text)               /* primary text */
var(--text-secondary)     /* muted text */
var(--border)             /* borders */
var(--hover)              /* hover state */
var(--primary)            /* brand color */
```

Dark mode is toggled via the `html.dark` class. Popup is fixed at **700 × 600 px**.

Tab visibility: use `.active` class selector (e.g., `#dashboardTab.active { display: block; }`), never `display: block !important` on the bare ID — it bleeds into all tabs.

---

## Mobile App

```powershell
cd app
npm run android   # react-native run-android
npm run ios       # react-native run-ios
npm start         # Metro bundler
npm test          # Jest
```

---

## Firebase Functions

```powershell
cd functions
npm run deploy    # firebase deploy --only functions
npm run serve     # emulators:start --only functions
npm run logs      # firebase functions:log
```

---

## Website

```powershell
cd website
npm run dev       # next dev
npm run build     # next build
npm start         # next start
```

---

## Common Pitfalls

- **Never edit `popup.bundle.js` or `service-worker.js` directly** — they are build outputs, overwritten on every `npm run build`.
- **MV3 compliance**: `patch-bundle.js` strips all external script URLs (Firebase Auth, reCAPTCHA, Google APIs). Don't add dynamic `<script>` creation.
- **SMS spending analysis** (`src/ui/dashboard.js`): balance figures (e.g., "Available balance: AED 277k") are masked *before* transaction extraction — do not remove the `BALANCE_MASK_RE_A/B` logic.
- **"received" is NOT a credit keyword** for banking SMS — "we received your payment" means a debit for the customer.
