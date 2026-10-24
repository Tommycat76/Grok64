#!/usr/bin/env node
/**
 * Tom dirty-profile flow: persisted settings, power off/on, Software Insert on 8,
 * LOAD"$",8 typed on C64 (no feedBasic, no synthetic Jiffy, no Run disk).
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import { synthJiffyPair } from "./drive-combo-qa-lib.mjs";
import {
  geosDirectoryOnScreen,
  patchLocalStorage,
  powerOnDesktop,
  typeC64Screen,
  waitForDollarLoad,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const shotDir = join(process.cwd(), "screenshots", "geos-insert-user-dirty");
const outDir = join(process.cwd(), "artifacts", "geos-insert-user-dirty");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });
const d64Path = join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64");
if (!grok64DatapathFromEnv() || !existsSync(d64Path)) {
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const d64Name = "GEOS_2.0.d64";
const d64B64 = readFileSync(d64Path).toString("base64");
const trace = { flow: "power-insert-type-load-dollar" };

async function powerCycle(page) {
  await page.locator('button[aria-label="Power off"]').first().click({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await page.locator('button[aria-label="Power on"], .g64-power').first().click({ timeout: 15_000 });
  await waitRunning(page, 120_000);
}

async function importAndInsert(page) {
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type="file"]').setInputFiles(d64Path);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: new RegExp(`Insert ${d64Name}`) }).first().click({ timeout: 60_000 });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(4000);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await installGrok64CoreNetworkGuard(page, base);

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  const jiffyOn = process.env.GROK64_USER_DIRTY_JIFFY === "1";
  const seeded = await patchLocalStorage(page, {
    video: "pal",
    jiffy: jiffyOn,
    reu: "2048kB",
    drive: "cmd-layout",
  });
  if (!seeded) {
    trace.warn = "no grok64 localStorage — seeding minimal dirty profile in-page";
    await page.evaluate(() => {
      const key = "grok64-emu";
      const data = {
        state: {
          powered: false,
          jiffyDos: true,
          reuSize: "2048kB",
          videoStandard: "pal",
          iecMap: { 8: "1541", 9: "cmdhd", 10: "none", 11: "none" },
          iecDrive: "cmdhd",
          iecUnit: 9,
        },
        version: 0,
      };
      localStorage.setItem(key, JSON.stringify(data));
    });
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);
  await page.evaluate(async ({ name, b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__g64?.importLibraryBytes?.(name, bin);
  }, { name: d64Name, b64: d64B64 });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

  if (jiffyOn) {
    await page.evaluate(async (roms) => {
      for (const [name, bytes] of Object.entries(roms)) {
        const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
        await window.__g64?.putRomBytes?.(id, name, bytes);
      }
      window.__g64?.setJiffyDos?.(true);
    }, synthJiffyPair());
    for (let i = 0; i < 40; i++) {
      const live = await page.evaluate(() => window.__g64?.jiffyLive?.());
      if (live) break;
      await page.waitForTimeout(500);
    }
  }

  const jiffyBefore = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.({ light: true });
    return { want: d?.jiffyWant, live: d?.jiffyLive };
  });
  trace.jiffyBeforePowerCycle = jiffyBefore;

  await powerCycle(page);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  const jiffyAfterPower = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.({ light: true });
    return { want: d?.jiffyWant, live: d?.jiffyLive };
  });
  trace.jiffyAfterPowerCycle = jiffyAfterPower;

  await importAndInsert(page);
  await page.screenshot({ path: join(shotDir, "after-insert.png"), fullPage: true });

  const diagInsert = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  trace.aboutInsert = {
    viceLastReattach: diagInsert?.viceLastReattach,
    viceDriveBus: diagInsert?.viceDriveBus,
    viceDriveLive: diagInsert?.viceDriveLive,
  };

  await page.locator("#grok64-player canvas, .g64-crt canvas").first().click({ timeout: 10_000 }).catch(() => {});
  await typeC64Screen(page, 'LOAD"$",8', { keyDelayMs: 90 });
  const loadWait = await waitForDollarLoad(page, { maxMs: 55_000 });
  trace.loadWait = { error: loadWait.error, head: loadWait.text?.slice(0, 200) };
  await page.waitForTimeout(3000);
  await typeC64Screen(page, "LIST", { keyDelayMs: 70 });
  await page.waitForTimeout(12_000);
  await page.screenshot({ path: join(shotDir, "after-load-dollar.png"), fullPage: true });

  const screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const catalogOk = geosDirectoryOnScreen(screen) && !/FILE NOT FOUND/i.test(screen);
  const bus = diagInsert?.viceDriveBus ?? {};
  const busOk =
    bus.wasmFilesystemDevice === 0 &&
    bus.wasmUnitTrueEmulation === 1 &&
    bus.wasmCpuClockAdvancing === true &&
    (bus.wasmTdeImageBytes ?? 0) > 174000 &&
    bus.serialDeviceLabel != null &&
    bus.serialDeviceLabel !== "virt";
  const attachRcOk = (diagInsert?.viceLastReattach?.rc ?? -1) === 0;
  const jiffyStable = jiffyAfterPower.want === false || jiffyAfterPower.want === jiffyBefore.want;
  const iecFail = /FILE NOT FOUND|DEVICE NOT PRESENT/i.test(screen) || loadWait.error;
  const pass = jiffyOn
    ? attachRcOk && busOk && !iecFail && jiffyAfterPower.want === true
    : catalogOk && attachRcOk && busOk && !loadWait.error;
  trace.pass = pass;
  trace.screen = screen.slice(0, 500);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass, catalogOk, attachRcOk, busOk, jiffyAfterPower, loadError: loadWait.error }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
