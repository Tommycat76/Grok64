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
mkdirSync(outDir, { recursive: true });
mkdirSync(artDir, { recursive: true });

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
await patchLocalStorage(page, { video: "pal", jiffy: true, mouse: true, reu: "2048kB" });
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

const geosBytes = [...readFileSync(geosPath)];
const mountProbe = await page.evaluate(
  async ({ name, bytes }) => window.__g64?.geosMountAndDir?.(name, bytes),
  { name: "GEOS64_2.0.d64", bytes: geosBytes },
);
const dirProbe = mountProbe?.dir ?? "";
const bootOk = await page.evaluate(
  async ({ name, bytes }) => Boolean(await window.__g64?.bootGeos?.(name, bytes)),
  { name: "GEOS64_2.0.d64", bytes: geosBytes },
);
await waitRunning(page, 180_000);
await page.waitForTimeout(58_000);

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

const after = await canvasLooksLikeGeosDesktop(page);
const stats = await canvasPixelStats(page);
const opts = await page.evaluate(() => window.__g64?.runtimeViceOpts?.() ?? {});
const jiffyLive = await page.evaluate(() => window.__g64?.jiffyLive?.());
await page.screenshot({ path: join(outDir, "geos-after-mouse.png"), fullPage: true });

const dirListsGeos = /GEOS|DESK|GEOB|RBOOT|0\s+"/i.test(dirProbe);
const report = {
  bootOk,
  mountProbe,
  dirProbeHead: dirProbe.slice(0, 200),
  dirListsGeos,
  jiffyLive,
  drive8: opts.vice_drive8_type,
  trueEmu: opts.vice_drive_true_emulation,
  workDisk: opts.vice_work_disk,
  before,
  after,
  stats,
  pass:
    bootOk &&
    mountProbe?.mountOk &&
    mountProbe?.workBytes >= 174848 &&
    mountProbe?.opts?.vice_drive8_type === "1542" &&
    mountProbe?.opts?.vice_drive_true_emulation === "enabled" &&
    dirListsGeos &&
    after.pass &&
    !jiffyLive,
};
writeFileSync(join(artDir, "results.json"), JSON.stringify(report, null, 2));
console.log(report.pass ? "PASS geos-desktop-proof" : "FAIL geos-desktop-proof", JSON.stringify(report));

await browser.close();
await server.close();
xvfb.kill("SIGTERM");
process.exit(report.pass ? 0 : 1);
