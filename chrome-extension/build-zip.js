const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const extDir = path.resolve(__dirname);
const zipName = "IRopit-Extension-v1.0.0.zip";
const zipPath = path.join(extDir, zipName);

// Remove old zip
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

// Files to include (relative to extDir)
const files = [
  "manifest.json",
  "firebase-config.js",
  "content-script.js",
  "assets/icon16.png",
  "assets/icon32.png",
  "assets/icon48.png",
  "assets/icon128.png",
  "popup/popup.html",
  "popup/popup.css",
  "popup/popup.bundle.js",
  "popup/sms-window.html",
  "popup/sms-window.bundle.js",
  "background/service-worker.js",
];

// Verify all files exist
for (const f of files) {
  const fp = path.join(extDir, f);
  if (!fs.existsSync(fp)) {
    console.error(`Missing: ${f}`);
    process.exit(1);
  }
}

// Use tar to create zip (available on Windows 10+)
const fileList = files.map((f) => `"${f}"`).join(" ");
try {
  execSync(`tar -acf "${zipName}" ${fileList}`, {
    cwd: extDir,
    stdio: "inherit",
  });
  const stats = fs.statSync(zipPath);
  console.log(`\nCreated: ${zipPath} (${(stats.size / 1024).toFixed(1)} KB)`);
} catch (e) {
  console.error("tar failed, trying PowerShell...");
  // Fallback: use PowerShell
  const psCmd = `
    $tempDir = Join-Path $env:TEMP 'iropit-ext';
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force };
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null;
    New-Item -ItemType Directory -Path (Join-Path $tempDir 'assets') -Force | Out-Null;
    New-Item -ItemType Directory -Path (Join-Path $tempDir 'popup') -Force | Out-Null;
    New-Item -ItemType Directory -Path (Join-Path $tempDir 'background') -Force | Out-Null;
    ${files
      .map((f) => {
        const src = path.join(extDir, f).replace(/\//g, "\\");
        const dest = path
          .join("$tempDir", path.dirname(f))
          .replace(/\//g, "\\");
        return `Copy-Item '${src}' '${dest}'`;
      })
      .join("; ")};
    Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath '${zipPath}' -Force;
    Remove-Item $tempDir -Recurse -Force;
  `;
  execSync(`powershell -Command "${psCmd.replace(/"/g, '\\"')}"`, {
    stdio: "inherit",
  });
  if (fs.existsSync(zipPath)) {
    const stats = fs.statSync(zipPath);
    console.log(`Created: ${zipPath} (${(stats.size / 1024).toFixed(1)} KB)`);
  }
}
