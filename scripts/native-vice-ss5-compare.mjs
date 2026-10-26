#!/usr/bin/env node
/**
 * Compare SS5 CRT header banding: native VICE x64sc vs Grok64 WASM screenshot.
 *   npm run test:native-vice-ss5-compare
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ss5 = join(process.cwd(), "fixtures/carts/ss5.crt");
const outDir = join(process.cwd(), "screenshots", "ss5-native-vice-compare");
const artDir = join(process.cwd(), "artifacts", "ss5-native-vice-compare");
mkdirSync(outDir, { recursive: true });
mkdirSync(artDir, { recursive: true });

if (!existsSync(ss5)) {
  console.log("SKIP — missing fixtures/carts/ss5.crt");
  process.exit(0);
}

function hasX64sc() {
  const r = spawnSync("which", ["x64sc"]);
  return r.status === 0 && r.stdout.toString().trim();
}

if (!hasX64sc()) {
  const apt = spawnSync("sudo", ["apt-get", "install", "-y", "vice"], { stdio: "inherit" });
  if (apt.status !== 0) {
    writeFileSync(
      join(artDir, "results.json"),
      JSON.stringify({ skipped: true, reason: "vice not installed and apt failed" }, null, 2),
    );
    console.log("SKIP native VICE — install vice package unavailable");
    process.exit(0);
  }
}

const x64sc = hasX64sc() || "x64sc";
const png = join(outDir, "native-x64sc-ss5.png");
const log = join(artDir, "vice.log");

const child = spawn(
  x64sc,
  [
    "+sound",
    "-sound",
    "+autostart",
    "-autostart",
    "-default",
    "-warp",
    "-limitcycles",
    "2000000000",
    ss5,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let out = "";
child.stdout?.on("data", (d) => (out += d));
child.stderr?.on("data", (d) => (out += d));
await new Promise((r) => setTimeout(r, 12_000));
child.kill("SIGTERM");
writeFileSync(log, out);

const shot = spawnSync("import", ["-window", "root", png], { stdio: "pipe" });
const shotOk = shot.status === 0 && existsSync(png);

const wasmShot = join(process.cwd(), "screenshots", "cart-reset-sequence", "01-ss5-menu.png");
const report = {
  nativeShot: shotOk ? png : null,
  wasmShot: existsSync(wasmShot) ? wasmShot : null,
  viceLogTail: out.slice(-800),
  note: "Visually compare PNGs — repeated LMS header rows on native = authentic SS5",
};
writeFileSync(join(artDir, "results.json"), JSON.stringify(report, null, 2));
console.log("native-vice-ss5-compare", JSON.stringify(report));
