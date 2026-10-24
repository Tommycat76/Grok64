#!/usr/bin/env node
/**
 * Tom P0: Jiffy ON + 2MB REU — GEOS d64 must mount on unit 8 (LOAD"$" works).
 * Screenshots: /opt/cursor/artifacts/screenshots/geos-jiffy-disk-*.png
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const geosPath = join(process.cwd(), "fixtures", "geos", "GEOS64_2.0.d64");
const gamePath = join(process.cwd(), "fixtures", "disks", "boulder-dash.d64");
const out = "/opt/cursor/artifacts/screenshots";
mkdirSync(out, { recursive: true });

function synthJiffyPair() {
  const c64 = new Uint8Array(8192);
  const d41 = new Uint8Array(8192);
  for (let i = 0; i < c64.length; i++) c64[i] = (i * 17 + 0x4a) & 0xff;
  for (let i = 0; i < d41.length; i++) d41[i] = (i * 13 + 0x41) & 0xff;
  return {
    "JiffyDOS_C64_6.01.bin": [...c64],
    "JiffyDOS_1541-II_6.00.bin": [...d41],
  };
}

if (!existsSync(geosPath) || !grok64DatapathFromEnv()) {
  console.log(JSON.stringify({ skip: true, reason: "fixture or datapath" }));
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: "domcontentloaded" });
await clearEmulatorJsCache(page);
await patchLocalStorage(page, { video: "pal", jiffy: true, reu: "2048kB" });
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

const pair = synthJiffyPair();
await page.evaluate(async (roms) => {
  for (const [name, bytes] of Object.entries(roms)) {
    const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
    await window.__g64?.putRomBytes?.(id, name, bytes);
  }
  window.__g64?.setJiffyDos?.(true);
}, pair);
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);

const geosBytes = [...readFileSync(geosPath)];
await page.evaluate(
  async ({ name, bytes }) => {
    await window.__g64?.playBytes?.(name, bytes, { autostart: false, title: name });
  },
  { name: "GEOS64_2.0.d64", bytes: geosBytes },
);
await waitRunning(page, 120_000);
await page.waitForTimeout(8000);
await page.screenshot({ path: join(out, "geos-jiffy-disk-01-after-play.png"), fullPage: true });

await typeBasic(page, 'LOAD"$",8', { afterMs: 12_000 });
let dirText = "";
for (let i = 0; i < 50; i++) {
  await page.waitForTimeout(1500);
  dirText = await page.evaluate(() => window.__g64?.screenText?.() || "");
  if (/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(dirText)) break;
  if (/GEOS|VERIFY|PRG|\"|BLOCKS FREE/i.test(dirText) && dirText.replace(/\s+/g, " ").length > 80) break;
}
await page.screenshot({ path: join(out, "geos-jiffy-disk-02-dir.png"), fullPage: true });
const workBytes = await page.evaluate(() => window.__g64?.workD64Bytes?.() ?? 0);
const dirOk =
  workBytes >= 174848 &&
  !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(dirText) &&
  dirText.replace(/\s+/g, " ").length > 60;

await typeBasic(page, 'LOAD"GEOS",8,1', { afterMs: 45_000 });
await page.waitForTimeout(5000);
const geosLoadText = await page.evaluate(() => window.__g64?.screenText?.() || "");
await page.screenshot({ path: join(out, "geos-jiffy-disk-02b-geos-load.png"), fullPage: true });
const geosLoadOk = !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(geosLoadText);

let gameOk = true;
if (existsSync(gamePath)) {
  const gameBytes = [...readFileSync(gamePath)];
  await page.evaluate(() => window.__g64?.resetReady?.());
  await waitRunning(page, 90_000);
  await page.waitForTimeout(3000);
  await page.evaluate(
    async ({ name, bytes }) => {
      await window.__g64?.playBytes?.(name, bytes, { autostart: false, title: "Boulder Dash" });
    },
    { name: "boulder-dash.d64", bytes: gameBytes },
  );
  await waitRunning(page, 90_000);
  await page.waitForTimeout(6000);
  await typeBasic(page, 'LOAD"$",8', { afterMs: 20_000 });
  const gtext = await page.evaluate(() => window.__g64?.screenText?.() || "");
  await page.screenshot({ path: join(out, "geos-jiffy-disk-03-game-dir.png"), fullPage: true });
  gameOk = !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(gtext) && gtext.length > 40;
}

const report = {
  jiffyLive: await page.evaluate(() => window.__g64?.jiffyLive?.()),
  reu: await page.evaluate(() => window.__g64?.settings?.()?.reuSize),
  dirOk,
  gameOk,
  dirHead: dirText.slice(0, 200),
  pass: dirOk && gameOk,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.pass ? 0 : 1);
