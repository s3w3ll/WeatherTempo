// Guards over-the-air updates against native changes.
//
// An OTA update only replaces JavaScript. If the native side changed (a native package added or
// upgraded, a config plugin or app.json native setting, the widget), new JS sent to an old ipa can
// crash it. runtimeVersion in app.json is the contract: bump it whenever the native side changes,
// and phones on the old ipa simply stop taking updates until they're reinstalled.
//
//   node scripts/native-signature.mjs --check    exit 1 if the native side changed but runtimeVersion didn't
//   node scripts/native-signature.mjs --record   after bumping runtimeVersion, store the new signature
//
// The signature hashes: app.json minus the JS-only fields, the installed version of every package
// with native code or a config plugin, and the widget target sources (line endings normalised, so
// Windows and CI agree).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "native-signature.json";
const JS_ONLY_FIELDS = ["version", "runtimeVersion", "web", "description"];

function nativePackages() {
  const out = [];
  const consider = (dir, name) => {
    const isNative = ["ios", "app.plugin.js", "expo-module.config.json"].some((f) => existsSync(join(dir, f)))
      || readdirSync(dir).some((f) => f.endsWith(".podspec"));
    if (!isNative) return;
    const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    out.push(`${name}@${version}`);
  };
  for (const entry of readdirSync("node_modules")) {
    if (entry.startsWith(".")) continue;
    const dir = join("node_modules", entry);
    if (entry.startsWith("@")) {
      for (const sub of readdirSync(dir)) {
        const d = join(dir, sub);
        if (existsSync(join(d, "package.json"))) consider(d, `${entry}/${sub}`);
      }
    } else if (existsSync(join(dir, "package.json"))) consider(dir, entry);
  }
  return out.sort();
}

function files(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((f) => {
    const p = join(root, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

export function signature() {
  const app = JSON.parse(readFileSync("app.json", "utf8")).expo;
  for (const k of JS_ONLY_FIELDS) delete app[k];
  const h = createHash("sha256");
  h.update(JSON.stringify(sortKeys(app)));
  h.update(nativePackages().join("\n"));
  for (const f of files("targets").map((p) => p.replace(/\\/g, "/")).sort()) {
    h.update(f);
    h.update(readFileSync(f, "utf8").replace(/\r\n/g, "\n"));
  }
  return h.digest("hex").slice(0, 16);
}

const runtimeVersion = JSON.parse(readFileSync("app.json", "utf8")).expo.runtimeVersion;
const now = signature();

if (process.argv.includes("--record")) {
  writeFileSync(FILE, JSON.stringify({ runtimeVersion, signature: now }, null, 2) + "\n");
  console.log(`Recorded runtime ${runtimeVersion} → ${now}`);
} else {
  const saved = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
  if (saved.runtimeVersion === runtimeVersion && saved.signature === now) {
    console.log(`Native side unchanged for runtime ${runtimeVersion} (${now}); OTA updates are safe.`);
  } else {
    console.error(
      `Native side changed (recorded ${saved.runtimeVersion}/${saved.signature}, now ${runtimeVersion}/${now}).\n` +
      "Bump expo.runtimeVersion in app/app.json, then run `npm run native:record` in app/ and commit both.\n" +
      "Phones then need the new ipa; OTA updates are held back until then.",
    );
    process.exit(1);
  }
}
