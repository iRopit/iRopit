const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const iconsDir = path.join(__dirname, "public", "icons");
const screenshotsDir = path.join(__dirname, "public", "screenshots");

if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const src = path.join(iconsDir, "icon-128.png");

async function run() {
  await sharp(src).resize(96, 96).toFile(path.join(iconsDir, "icon-96.png"));
  await sharp(src).resize(192, 192).toFile(path.join(iconsDir, "icon-192.png"));
  await sharp(src).resize(512, 512).toFile(path.join(iconsDir, "icon-512.png"));
  console.log("Icons generated");

  const desktopW = 1280, desktopH = 800;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${desktopW}" height="${desktopH}">
    <rect width="${desktopW}" height="${desktopH}" fill="#111827"/>
    <rect x="40" y="40" width="${desktopW-80}" height="${desktopH-80}" rx="16" fill="#1f2937"/>
    <text x="${desktopW/2}" y="${desktopH/2 - 20}" font-family="Arial" font-size="48" fill="#d5c19e" text-anchor="middle">iRopit</text>
    <text x="${desktopW/2}" y="${desktopH/2 + 40}" font-family="Arial" font-size="22" fill="#9ca3af" text-anchor="middle">Sync SMS, Calls &amp; Notifications</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(screenshotsDir, "desktop.png"));
  console.log("Desktop screenshot generated");

  const mobileW = 390, mobileH = 844;
  const svgM = `<svg xmlns="http://www.w3.org/2000/svg" width="${mobileW}" height="${mobileH}">
    <rect width="${mobileW}" height="${mobileH}" fill="#111827"/>
    <rect x="20" y="20" width="${mobileW-40}" height="${mobileH-40}" rx="16" fill="#1f2937"/>
    <text x="${mobileW/2}" y="${mobileH/2 - 16}" font-family="Arial" font-size="36" fill="#d5c19e" text-anchor="middle">iRopit</text>
    <text x="${mobileW/2}" y="${mobileH/2 + 28}" font-family="Arial" font-size="16" fill="#9ca3af" text-anchor="middle">Sync Your Devices</text>
  </svg>`;
  await sharp(Buffer.from(svgM)).png().toFile(path.join(screenshotsDir, "mobile.png"));
  console.log("Mobile screenshot generated");
}
run().catch(console.error);