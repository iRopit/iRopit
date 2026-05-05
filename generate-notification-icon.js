#!/usr/bin/env node
/**
 * Notification Icon Generator for Android
 * Creates ic_notification.png (white silhouette on transparent) for all densities.
 * Android notification icons must be single-color white (#FFFFFF) on transparent.
 *
 * Source: ic_launcher_foreground.png (rope knot logo on black background)
 * Detection: brightness-based — bright pixels (rope) → white, dark pixels (bg) → transparent
 *
 * Usage:
 *   cd "c:\Users\Moham\iRopit"
 *   node generate-notification-icon.js
 */

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// Use the app launcher foreground image (rope knot on black background) as source.
// Brightness threshold: pixels brighter than THRESHOLD become white, rest transparent.
const FOREGROUND_PNG = path.join(
  __dirname,
  "app",
  "android",
  "app",
  "src",
  "main",
  "res",
  "mipmap-xxxhdpi",
  "ic_launcher_foreground.png",
);
const BRIGHTNESS_THRESHOLD = 40; // 0-255; black bg is ~0, rope is ~180+

const ANDROID_RES_DIR = path.join(
  __dirname,
  "app",
  "android",
  "app",
  "src",
  "main",
  "res",
);

// Android notification icon sizes by density
const NOTIFICATION_ICONS = [
  { folder: "drawable-mdpi", size: 24 },
  { folder: "drawable-hdpi", size: 36 },
  { folder: "drawable-xhdpi", size: 48 },
  { folder: "drawable-xxhdpi", size: 72 },
  { folder: "drawable-xxxhdpi", size: 96 },
];

async function generateNotificationIcons() {
  console.log("Generating Android notification icons from iRopit logo...\n");

  if (!fs.existsSync(FOREGROUND_PNG)) {
    console.error("ERROR: ic_launcher_foreground.png not found at:", FOREGROUND_PNG);
    process.exit(1);
  }

  // Render the foreground PNG at a large intermediate size
  const RENDER_SIZE = 512;
  const rendered = await sharp(FOREGROUND_PNG)
    .resize(RENDER_SIZE, RENDER_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 255 },
    })
    .png()
    .toBuffer();

  // Extract pixel data
  const { data, info } = await sharp(rendered)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Build white-on-transparent silhouette using brightness detection
  const silhouette = Buffer.alloc(info.width * info.height * 4);
  let whiteCount = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    if (brightness > BRIGHTNESS_THRESHOLD) {
      silhouette[i * 4 + 0] = 255;
      silhouette[i * 4 + 1] = 255;
      silhouette[i * 4 + 2] = 255;
      silhouette[i * 4 + 3] = 255;
      whiteCount++;
    } else {
      silhouette[i * 4 + 0] = 0;
      silhouette[i * 4 + 1] = 0;
      silhouette[i * 4 + 2] = 0;
      silhouette[i * 4 + 3] = 0;
    }
  }

  const totalPixels = info.width * info.height;
  console.log(
    `  Silhouette: ${((whiteCount / totalPixels) * 100).toFixed(1)}% white pixels (threshold=${BRIGHTNESS_THRESHOLD})\n`,
  );

  for (const icon of NOTIFICATION_ICONS) {
    const outDir = path.join(ANDROID_RES_DIR, icon.folder);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const outPath = path.join(outDir, "ic_notification.png");

    try {
      await sharp(silhouette, {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .resize(icon.size, icon.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(outPath);

      console.log(
        `  ✓ ${icon.folder}/ic_notification.png (${icon.size}x${icon.size})`,
      );
    } catch (err) {
      console.error(`  ✗ ${icon.folder}: ${err.message}`);
    }
  }

  console.log("\nDone! Notification icons generated.");
}

generateNotificationIcons();

