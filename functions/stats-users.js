/**
 * Firebase Stats Script — uses Firestore REST API + Firebase Auth Admin
 * No service account key needed; uses stored Firebase CLI refresh token.
 *
 * Usage:
 *   cd functions
 *   node stats-users.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const PROJECT_ID = "iropit-64ea0";

// ── Step 1: Get access token from Firebase CLI stored token ────────────────
function readFirebaseCliTokens() {
  const configPath = path.join(os.homedir(), ".config", "configstore", "firebase-tools.json");
  if (!fs.existsSync(configPath)) throw new Error("Firebase CLI config not found. Run: firebase login");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config.tokens?.access_token) throw new Error("No access token in Firebase CLI config. Run: firebase login");
  return config.tokens;
}

async function getAccessToken(tokens) {
  // Use the stored access_token directly — it's typically valid for 1 hour
  return tokens.access_token;
}

// ── Step 2: Firestore REST helpers ─────────────────────────────────────────
async function firestoreGet(accessToken, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "firestore.googleapis.com",
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    };
    https.get(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

async function firestoreList(accessToken, colPath) {
  const docs = [];
  let pageToken = null;
  do {
    const qs = "?pageSize=300" + (pageToken ? `&pageToken=${pageToken}` : "");
    const url = `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${colPath}${qs}`;
    const result = await new Promise((resolve, reject) => {
      https.get({
        hostname: "firestore.googleapis.com",
        path: url,
        headers: { Authorization: `Bearer ${accessToken}` },
      }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(JSON.parse(data)));
      }).on("error", reject);
    });
    if (result.documents) docs.push(...result.documents);
    pageToken = result.nextPageToken || null;
  } while (pageToken);
  return docs;
}

async function firestoreRunQuery(accessToken, colPath, filters) {
  // Use runQuery to do a count-like aggregation via structured query
  const body = JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: colPath.split("/").pop() }],
      where: filters ? {
        fieldFilter: { field: { fieldPath: filters.field }, op: "EQUAL", value: { stringValue: filters.value } },
      } : undefined,
      select: { fields: [{ fieldPath: "__name__" }] },
    },
  });

  return new Promise((resolve, reject) => {
    const parent = colPath.split("/").slice(0, -1).join("/");
    const options = {
      hostname: "firestore.googleapis.com",
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${parent}:runQuery`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        const arr = JSON.parse(data);
        const count = Array.isArray(arr) ? arr.filter((r) => r.document).length : 0;
        resolve(count);
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Step 3: Auth — list users ───────────────────────────────────────────────
async function listAuthUsers(accessToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ maxResults: 1000 });
    const options = {
      hostname: "identitytoolkit.googleapis.com",
      path: `/v1/projects/${PROJECT_ID}/accounts:query`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        const json = JSON.parse(data);
        resolve(json.userInfo || []);
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== iRopit Firebase Stats ===\n");

  const tokens = readFirebaseCliTokens();
  process.stdout.write("Authenticating... ");
  const accessToken = await getAccessToken(tokens);
  console.log("OK\n");

  // Auth users
  const authUsers = await listAuthUsers(accessToken);
  console.log(`Registered Firebase Auth users: ${authUsers.length}`);
  authUsers.forEach((u) => console.log(`  ${u.email || u.localId} (created: ${u.createdAt ? new Date(parseInt(u.createdAt)).toLocaleDateString() : "?"})`));
  console.log();

  // Devices
  const deviceDocs = await firestoreList(accessToken, "devices");
  const userMap = new Map();
  for (const doc of deviceDocs) {
    const fields = doc.fields || {};
    const userId = fields.userId?.stringValue;
    const platform = fields.platform?.stringValue || "";
    const devId = fields.id?.stringValue || doc.name.split("/").pop();
    const devName = fields.nickname?.stringValue || fields.name?.stringValue || fields.model?.stringValue || devId;
    if (!userId) continue;
    if (platform === "chrome-extension" || platform === "chrome" || devId.startsWith("ext_")) continue;
    if (!userMap.has(userId)) userMap.set(userId, []);
    userMap.get(userId).push({ id: devId, name: devName });
  }

  console.log(`Users with mobile devices: ${userMap.size}\n`);

  let grandSMS = 0, grandCalls = 0;
  for (const [userId, devices] of userMap.entries()) {
    let userSMS = 0, userCalls = 0;
    for (const dev of devices) {
      const notifDocs = await firestoreList(accessToken, `users/${userId}/devices/${dev.id}/notifications`);
      const smsDocs = notifDocs.filter((d) => d.fields?.type?.stringValue === "sms");
      const callDocs = await firestoreList(accessToken, `users/${userId}/devices/${dev.id}/calls`);
      userSMS += smsDocs.length;
      userCalls += callDocs.length;
    }
    grandSMS += userSMS;
    grandCalls += userCalls;

    const email = authUsers.find((u) => u.localId === userId)?.email || userId;
    console.log(`User:    ${email}`);
    console.log(`Devices: ${devices.map((d) => d.name).join(", ")}`);
    console.log(`SMS:     ${userSMS}`);
    console.log(`Calls:   ${userCalls}`);
    console.log();
  }

  console.log("══════════════════════════════");
  console.log(`Auth users:   ${authUsers.length}`);
  console.log(`With devices: ${userMap.size}`);
  console.log(`Total SMS:    ${grandSMS}`);
  console.log(`Total Calls:  ${grandCalls}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nError:", err.message);
    process.exit(1);
  });

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nError:", err.message);
    process.exit(1);
  });
