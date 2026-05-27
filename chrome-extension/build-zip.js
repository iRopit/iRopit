const archiver = require("archiver");
const path = require("path");
const fs = require("fs");

const extDir = path.resolve(__dirname);
const pkg = require("./package.json");
const zipName = `IRopit-Extension-v${pkg.version}.zip`;
const zipPath = path.join(extDir, zipName);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

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
  "popup/incoming-call.html",
  "popup/incoming-call.js",
  "popup/outgoing-call.html",
  "popup/outgoing-call.js",
  "background/service-worker.js",
  "offscreen/offscreen.html",
  "offscreen/offscreen.js",
];

for (const f of files) {
  if (!fs.existsSync(path.join(extDir, f))) {
    console.error(`Missing: ${f}`);
    process.exit(1);
  }
}

const output = fs.createWriteStream(zipPath);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  console.log(`\nCreated: ${zipPath} (${(archive.pointer() / 1024).toFixed(1)} KB)`);
});
archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
for (const f of files) {
  archive.file(path.join(extDir, f), { name: f });
}
archive.finalize();
