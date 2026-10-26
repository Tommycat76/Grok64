#!/usr/bin/env node
/**
 * Tom: generic floppy path — Jiffy ON/OFF, LOAD"$",8 + LIST on GEOS + game disk.
 * Screenshots: /opt/cursor/artifacts/screenshots/jiffy-floppy-*
 *
 *   JIFFY_MODE=on|off|both npm run test:desktop-jiffy-floppy-dir
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
const modes = (process.env.JIFFY_MODE || "both").split(",").map((s) => s.trim());
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

async function dirOkAfterLoad(page, label) {
  await typeBasic(page, 'LOAD"$",8', { afterMs: 10_000 });
  let text = "";
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(1500);
    text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    if (/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(text)) break;
    if (text.replace(/\s+/g, " ").length > 90 && !/SEARCHING FOR/i.test(text)) break;
  }
  await typeBasic(page, "LIST", { afterMs: 8000 });
  await page.waitForTimeout(2000);
  const list = await page.evaluate(() => window.__g64?.screenText?.() || "");
  await page.screenshot({ path: join(out, `${label}-list.png`), fullPage: true });
  const workBytes = await page.evaluate(() => window.__g64?.workD64Bytes?.() ?? 0);
  const ok =
    workBytes >= 174848 &&
    !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(text) &&
    !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(list) &&
    (text.length > 50 || list.length > 50);
  return { ok, textHead: text.slice(0, 120), listHead: list.slice(0, 120), workBytes };
}

async function runMode(jiffyOn) {
  const tag = jiffyOn ? "jiffy-on" : "jiffy-off";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "pal", jiffy: jiffyOn, reu: "2048kB" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  if (jiffyOn) {
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
  }

  const geosBytes = [...readFileSync(geosPath)];
  await page.evaluate(
    async ({ name, bytes }) => {
      await window.__g64?.playBytes?.(name, bytes, { autostart: false, title: name });
    },
    { name: "GEOS64_2.0.d64", bytes: geosBytes },
  );
  await waitRunning(page, 120_000);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(out, `${tag}-geos-mounted.png`), fullPage: true });
  const geosDir = await dirOkAfterLoad(page, `${tag}-geos`);

  if (jiffyOn) {
    await typeBasic(page, 'LOAD"GEOS",8,1', { afterMs: 40_000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.__g64?.feedBasic?.("RUN"));
    await page.waitForTimeout(8000);
    await page.screenshot({ path: join(out, `${tag}-geos-run.png`), fullPage: true });
  }

  let gameDir = { ok: true };
  if (existsSync(gamePath)) {
    const gameBytes = [...readFileSync(gamePath)];
    await page.evaluate(() => window.__g64?.resetReady?.());
    await waitRunning(page, 90_000);
    await page.waitForTimeout(2000);
    await page.evaluate(
      async ({ name, bytes }) => {
        await window.__g64?.playBytes?.(name, bytes, { autostart: false, title: "Boulder Dash" });
      },
      { name: "boulder-dash.d64", bytes: gameBytes },
    );
    await waitRunning(page, 90_000);
    await page.waitForTimeout(5000);
    gameDir = await dirOkAfterLoad(page, `${tag}-game`);
  }

  const report = {
    mode: tag,
    jiffyLive: await page.evaluate(() => window.__g64?.jiffyLive?.()),
    reu: await page.evaluate(() => window.__g64?.settings?.()?.reuSize),
    geosDir,
    gameDir,
    pass: geosDir.ok && gameDir.ok,
  };
  await browser.close();
  return report;
}

if (!existsSync(geosPath) || !grok64DatapathFromEnv()) {
  console.log(JSON.stringify({ skip: true }));
  process.exit(0);
}

const runModes = modes.includes("both") ? [true, false] : modes.map((m) => m === "on");
const results = [];
for (const j of runModes) {
  results.push(await runMode(j));
}
const pass = results.every((r) => r.pass);
console.log(JSON.stringify({ pass, results }, null, 2));
process.exit(pass ? 0 : 1);
