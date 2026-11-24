// Turns an `expo export -p ios` folder into a self-hosted Expo Updates release:
// writes manifest.json (Expo Updates protocol) next to the exported bundle and assets.
//
//   node scripts/update-manifest.mjs <export-dir>
//
// The folder is then published at https://<site>/updates/ios/ by the Pages workflow.
// The app doesn't read it from Pages directly: its updater insists on an
// `expo-protocol-version` response header, which Pages can't send. app.json `updates.url`
// points at the Worker's /updates/ios route instead, which relays this manifest with that
// header, makes the (relative) asset URLs absolute so files still come from Pages, and
// answers "no update" to a phone on a different runtimeVersion.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/update-manifest.mjs <export-dir>");

const app = JSON.parse(readFileSync("app.json", "utf8")).expo;
const runtimeVersion = app.runtimeVersion;
if (typeof runtimeVersion !== "string") throw new Error("app.json expo.runtimeVersion must be a string");

const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")).fileMetadata.ios;
const posix = (p) => p.replace(/\\/g, "/");
const sha256 = (buf) => createHash("sha256").update(buf).digest("base64url"); // what the client verifies
const md5 = (buf) => createHash("md5").update(buf).digest("hex");

const CONTENT_TYPES = { ttf: "font/ttf", otf: "font/otf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", json: "application/json" };

const bundlePath = posix(meta.bundle);
const bundle = readFileSync(join(dir, bundlePath));
const launchAsset = {
  key: md5(bundle), hash: sha256(bundle), url: bundlePath,
  contentType: "application/javascript", fileExtension: ".bundle",
};
const assets = meta.assets.map(({ path, ext }) => {
  const p = posix(path);
  const buf = readFileSync(join(dir, p));
  return { key: md5(buf), hash: sha256(buf), url: p, fileExtension: `.${ext}`, contentType: CONTENT_TYPES[ext] ?? "application/octet-stream" };
});

// Same code => same id, so a redeploy without JS changes doesn't make phones download again.
const digest = createHash("sha256")
  .update([runtimeVersion, launchAsset.hash, ...assets.map((a) => a.hash)].join("\n"))
  .digest("hex");
const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;

// The commit's time, not "now": an ipa built from the same commit embeds a later time, so the
// phone keeps its embedded copy rather than downloading the identical code again.
let createdAt;
try { createdAt = new Date(execSync("git log -1 --format=%cI", { encoding: "utf8" }).trim()).toISOString(); }
catch { createdAt = new Date().toISOString(); }

// expoClient becomes Constants.expoConfig inside the updated app.
const expoClient = JSON.parse(execSync("npx expo config --type public --json", { encoding: "utf8" }));

const manifest = { id, createdAt, runtimeVersion, launchAsset, assets, metadata: {}, extra: { expoClient } };
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
console.log(`Update ${id} · runtime ${runtimeVersion} · ${createdAt} · ${assets.length} assets`);
