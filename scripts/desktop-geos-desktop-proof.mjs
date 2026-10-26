#!/usr/bin/env node
/**
 * GEOS deskTop proof — screenshot + pointer nudge (not text heuristics alone).
 *   npm run test:desktop-geos-proof
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canvasLooksLikeGeosDesktop,
  canvasPixelStats,
  patchLocalStorage,
  powerOnDesktop,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const display = process.env.GROK64_XDISPLAY || ":99";
const geosPath = join(process.cwd(), "fixtures", "geos", "GEOS64_2.0.d64");
const outDir = join(process.cwd(), "screenshots", "geos-desktop-proof");
const artDir = join(process.cwd(), "artifacts", "desktop-geos-desktop-proof");
const pubShot = "/opt/cursor/artifacts/screenshots";
mkdirSync(outDir, { recursive: true });
mkdirSync(artDir, { recursive: true });
mkdirSync(pubShot, { recursive: true });

function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, DISPLAY: display }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });
}

if (!existsSync(geosPath)) {
  writeFileSync(join(artDir, "results.json"), JSON.stringify({ skipped: true, reason: "fixtures/geos/GEOS64_2.0.d64 missing" }));
  console.log("SKIP geos proof — no fixture");
  process.exit(0);
}

if (!grok64DatapathFromEnv()) {
  console.error("VITE_GROK64_VICE_DATAPATH missing");
  process.exit(1);
}

const xvfb = spawn("Xvfb", [display, "-screen", "0", "1280x800x24", "-ac"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));

const server = await chromium.launchServer({
  headless: false,
  env: { ...process.env, DISPLAY: display },
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,800"],
});
const browser = await chromium.connect(server.wsEndpoint());
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: "domcontentloaded" });
await clearEmulatorJsCache(page);
await patchLocalStorage(page, { video: "pal", jiffy: false, mouse: true, reu: "2048kB" });
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

const geosBytes = [...readFileSync(geosPath)];
const bootOk = await page.evaluate(
  async ({ name, bytes }) => Boolean(await window.__g64?.bootGeos?.(name, bytes)),
  { name: "GEOS64_2.0.d64", bytes: geosBytes },
);
await waitRunning(page, 180_000);
await page.evaluate(() => window.__g64?.setPaused?.(false));
let after = { pass: false, stats: { ok: false } };
for (let i = 0; i < 90; i++) {
  after = await canvasLooksLikeGeosDesktop(page);
  if (after.pass) break;
  await page.waitForTimeout(2000);
}
await page.locator("#grok64-player canvas").first().screenshot({ path: join(outDir, "geos-desktop-crt.png") }).catch(() => null);

const before = await canvasLooksLikeGeosDesktop(page);
await page.screenshot({ path: join(outDir, "geos-before-mouse.png"), fullPage: true });

const win = (await sh("xdotool", ["search", "--onlyvisible", "--class", "chromium"])).trim().split(/\s+/)[0];
if (win) {
  await sh("xdotool", ["mousemove", "--window", win, "640", "360"]);
  await sh("xdotool", ["click", "1"]);
  await page.waitForTimeout(400);
  await sh("xdotool", ["mousemove", "--window", win, "520", "300"]);
  await page.waitForTimeout(400);
  await sh("xdotool", ["mousemove", "--window", win, "760", "420"]);
  await page.waitForTimeout(800);
}

if (!after.pass) {
  after = await canvasLooksLikeGeosDesktop(page);
}
const stats = await canvasPixelStats(page);
const opts = await page.evaluate(() => window.__g64?.runtimeViceOpts?.() ?? {});
const jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.());
await page.screenshot({ path: join(outDir, "geos-after-mouse.png"), fullPage: true });

const dirListsGeos = !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(
  await page.evaluate(() => window.__g64?.screenText?.() || ""),
);
const workD64Bytes = await page.evaluate(() => window.__g64?.workD64Bytes?.() ?? 0);
const report = {
  bootOk,
  workD64Bytes,
  dirListsGeos,
  jiffyLive,
  drive8: opts.vice_drive8_type,
  trueEmu: opts.vice_drive_true_emulation,
  workDisk: opts.vice_work_disk,
  before,
  after,
  stats,
  pass:
    workD64Bytes >= 174848 &&
    (bootOk || after.pass) &&
    after.pass &&
    !jiffyLive &&
    opts.vice_drive8_type === "1542",
};
writeFileSync(join(artDir, "results.json"), JSON.stringify(report, null, 2));
for (const name of ["geos-desktop-crt.png", "geos-before-mouse.png", "geos-after-mouse.png"]) {
  try {
    const { copyFileSync } = await import("node:fs");
    copyFileSync(join(outDir, name), join(pubShot, name));
  } catch {
    /* optional */
  }
}
console.log(report.pass ? "PASS geos-desktop-proof" : "FAIL geos-desktop-proof", JSON.stringify(report));

await browser.close();
await server.close();
xvfb.kill("SIGTERM");
process.exit(report.pass ? 0 : 1);
