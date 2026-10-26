#!/usr/bin/env node
/**
 * Pin EmulatorJS stable (4.2.3) under public/system/vice/emulatorjs/data/.
 * Run after upgrading the upstream CDN snapshot; ties cache-bust buildId to grok64-core-manifest.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(root, "public/system/vice/emulatorjs/data");
const CDN = "https://cdn.emulatorjs.org/stable/data/";
const FILES = [
  "version.json",
  "emulator.css",
  "src/nipplejs.js",
  "src/emulator.js",
  "src/shaders.js",
  "src/storage.js",
  "src/gamepad.js",
  "src/GameManager.js",
  "src/socket.io.min.js",
  "src/compression.js",
];

mkdirSync(join(dataRoot, "src"), { recursive: true });

for (const rel of FILES) {
  const dest = join(dataRoot, rel);
  const url = `${CDN}${rel}`;
  const r = spawnSync("curl", ["-fsSL", url, "-o", dest], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`fetch failed: ${url}`);
    process.exit(1);
  }
}

const emuPath = join(dataRoot, "src/emulator.js");
let emu = readFileSync(emuPath, "utf8");
const failsafe =
  /if \(res === -1\) \{\s*console\.log\("File not found, attemping to fetch from emulatorjs cdn\."\);[\s\S]*?console\.warn\("File was not found locally[\s\S]*?\);\s*\}/;
if (failsafe.test(emu)) {
  emu = emu.replace(
    failsafe,
    `if (res === -1) {
                this.startGameError(this.localization("Error downloading core") + " (" + filename + ")");
                return;
            }`,
  );
} else {
  console.warn("vendor-emulatorjs: CDN failsafe block not found — emulator.js may already be patched");
}
if (emu.includes("https://cdn.emulatorjs.org/stable/data/version.json")) {
  emu = emu.replace(
    'fetch("https://cdn.emulatorjs.org/stable/data/version.json")',
    'fetch(((this.config&&this.config.dataPath)||"").replace(/\\/$/,"")+"version.json")',
  );
}
if (emu.includes("this.checkForUpdates()")) {
  emu = emu.replace(
    /if \(this\.debug \|\| \(window\.location && \["localhost", "127\.0\.0\.1"\]\.includes\(location\.hostname\)\)\) this\.checkForUpdates\(\);/,
    "/* grok64: no CDN version check */",
  );
}
writeFileSync(emuPath, emu);

const fileEntries = {};
for (const rel of FILES) {
  const buf = readFileSync(join(dataRoot, rel));
  fileEntries[rel] = {
    bytes: buf.byteLength,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

let coreBuildId = "dev";
try {
  const man = JSON.parse(
    readFileSync(join(dataRoot, "cores/grok64-core-manifest.json"), "utf8"),
  );
  if (man.buildId) coreBuildId = String(man.buildId);
} catch {
  /* optional before core manifest exists */
}

const versionMatch = emu.match(/this\.ejs_version\s*=\s*"([^"]+)"/);
const bundle = {
  channel: "stable",
  version: versionMatch?.[1] ?? "4.2.3",
  coreBuildId,
  generatedAt: new Date().toISOString(),
  files: fileEntries,
};

const out = join(dataRoot, "grok64-ejs-bundle.json");
writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, version: bundle.version, coreBuildId, files: FILES.length }));
