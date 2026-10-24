#!/usr/bin/env node
/**
 * Dirty browser profile: cart play, settings churn, reload + session resume, then GEOS D64 Run.
 * Captures attachDiskDiag() over time to catch work-disk reattach / reboot class.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const shotDir = join(process.cwd(), "screenshots");
const tracePath = join(process.cwd(), "screenshots", "dirty-profile-geos-trace.json");
mkdirSync(shotDir, { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });

const d64Path =
  process.env.GROK64_GEOS_D64_PATH ||
  (existsSync(join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64"))
    ? join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64")
    : null);

if (!d64Path || !existsSync(d64Path)) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "missing GEOS_2.0.d64" }));
  process.exit(0);
}
if (!grok64DatapathFromEnv()) {
  console.error("VITE_GROK64_VICE_DATAPATH missing");
  process.exit(1);
}

const d64Bytes = readFileSync(d64Path);
const d64Sha1 = createHash("sha1").update(d64Bytes).digest("hex");
const d64Name = d64Path.split("/").pop() ?? "GEOS_2.0.d64";

async function snapDiag(page, label, trace) {
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  const meta = await page.evaluate(() => ({
    playMode: window.__g64?.playMode?.(),
    booting: window.__g64?.booting?.(),
    cartLive: window.__g64?.cartLive?.(),
    workDisk: window.__g64?.workDisk?.(),
    bootFile: window.__g64?.bootFile?.(),
    title: window.__g64?.title?.(),
    powered: window.__g64?.powered?.(),
    splash: Boolean(document.querySelector(".g64-splash[data-on='true']")),
  }));
  const row = { at: label, t: Date.now(), meta, diag };
  trace.push(row);
  const safe = label.replace(/[^a-z0-9]+/gi, "-").slice(0, 48);
  await page.screenshot({ path: join(shotDir, `dirty-profile-${safe}.png`), fullPage: true });
  return row;
}

async function importFile(page, filePath) {
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

async function runDisk(page, fileName) {
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  const esc = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: new RegExp(`^(Play|Run) ${esc}$`) }).click({ timeout: 30_000 });
  await waitRunning(page, 180_000);
}

const trace = [];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

await page.goto(base, { waitUntil: "domcontentloaded" });
await clearEmulatorJsCache(page);
await patchLocalStorage(page, { video: "pal", jiffy: true, reu: "2048kB", drive: "cmd-layout" });
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

await page.evaluate(() => {
  sessionStorage.setItem("g64-live-play", "Grok64 Demo Cart");
  sessionStorage.setItem(
    "g64-crash-play",
    JSON.stringify({
      title: "Grok64 Demo Cart",
      filename: "grok64.crt",
      bundlePath: "/software/grok64.crt",
      libraryId: null,
      iecUnit: 8,
      savedAt: Date.now(),
    }),
  );
});

await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
await page.waitForTimeout(400);
await page.getByRole("button", { name: /Bundled/i }).click().catch(() => {});
await page.waitForTimeout(300);
const bundledPlay = page.getByRole("button", { name: /Play.*Grok64/i }).first();
if (await bundledPlay.count()) {
  await bundledPlay.click({ timeout: 20_000 });
  await waitRunning(page, 120_000);
  await page.waitForTimeout(4000);
}
await snapDiag(page, "after-cart-play", trace);

await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(500);
await page.locator('button[aria-label="Settings"]').click({ timeout: 10_000 });
await page.waitForTimeout(500);
const jiffySwitch = page.locator(".g64-sheet .g64-switch").first();
if (await jiffySwitch.count()) await jiffySwitch.click();
await page.waitForTimeout(800);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await snapDiag(page, "after-settings-jiffy-toggle", trace);

await page.locator(".g64-power-toggle").first().click({ timeout: 10_000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__g64?.power?.());
await waitRunning(page, 120_000);
await snapDiag(page, "after-power-cycle", trace);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await snapDiag(page, "after-reload-resume", trace);
if (!(await page.evaluate(() => window.__g64?.hasFs?.()))) {
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
}

await importFile(page, d64Path);
await runDisk(page, d64Name);
await snapDiag(page, "mount-finish", trace);

for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  await snapDiag(page, `watch-${i + 1}s`, trace);
  const splash = await page.evaluate(() => Boolean(document.querySelector(".g64-splash[data-on='true']")));
  if (splash) break;
}

await typeBasic(page, 'LOAD"$",8', { afterMs: 15_000 });
await page.waitForTimeout(3500);
await snapDiag(page, "after-load-dollar", trace);
await typeBasic(page, "LIST", { afterMs: 10_000 });
await page.waitForTimeout(2500);
const list = await page.evaluate(() => window.__g64?.screenText?.() || "");
await snapDiag(page, "after-list", trace);

const last = trace[trace.length - 1];
const mount = trace.find((r) => r.at === "mount-finish");
const dirOk =
  !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(list) &&
  (/GEOS/i.test(list) || /47454f53/i.test(mount?.diag?.session?.dir18s1Hex ?? ""));
const shaOk = mount?.diag?.session?.sha1 === d64Sha1;
const workReattached =
  last?.diag?.viceWorkDiskOpt === "8_d64" &&
  last?.diag?.bootFile &&
  /\.g64$/i.test(mount?.diag?.bootFile || "") === false &&
  /WORK DISK/i.test(last?.diag?.bootFile || "");

const report = {
  pass: shaOk && dirOk && !workReattached,
  d64Sha1,
  dirOk,
  shaOk,
  workReattached,
  listSnippet: list.slice(0, 200),
  traceLabels: trace.map((r) => r.at),
};
writeFileSync(tracePath, JSON.stringify({ report, trace }, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.pass ? 0 : 1);
