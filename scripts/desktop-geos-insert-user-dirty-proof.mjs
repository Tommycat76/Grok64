#!/usr/bin/env node
/**
 * Tom dirty-profile flow: persisted settings, power off/on, Software Insert on 8,
 * LOAD"$",8 via Playwright keyboard.press on canvas (no typeC64, no feedBasic).
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
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
  seedTomReusedProfile,
  powerOnDesktop,
  typeC64RealKeyboard,
  waitForDollarLoad,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { geosBaselineD64, geosD64Fingerprint } from "./geos-fixture-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const shotDir = join(process.cwd(), "screenshots", "geos-insert-user-dirty");
const outDir = join(process.cwd(), "artifacts", "geos-insert-user-dirty");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const d64Path = geosBaselineD64().path;
if (!grok64DatapathFromEnv() || !existsSync(d64Path)) {
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const d64Name = basename(d64Path);
const d64Bytes = readFileSync(d64Path);
const d64Fp = geosD64Fingerprint(d64Bytes);
const d64B64 = d64Bytes.toString("base64");
const trace = { flow: "power-insert-type-load-dollar", librarySeed: "importLibraryBytes", geosD64: d64Fp };

async function powerCycle(page) {
  await page.locator('button[aria-label="Power off"]').first().click({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await page.locator('button[aria-label="Power on"], .g64-power').first().click({ timeout: 15_000 });
  await waitRunning(page, 120_000);
}

async function openSoftwareLibraryTab(page) {
  await page.locator('button[aria-label="Software"]').first().click({ timeout: 15_000, force: true });
  const sheetVisible = await page
    .locator(".g64-sheet")
    .waitFor({ state: "visible", timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!sheetVisible) {
    trace.softwareOpen = "api-fallback";
  }
  await page.evaluate(() => window.__g64?.openSoftwareLibrary?.() ?? window.__g64?.openSoftware?.());
  await page.locator(".g64-seg button").filter({ hasText: /^On this device/ }).click({ force: true }).catch(() => {});
  await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("button.g64-btn").filter({ hasText: /^Import$/ }).first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(200);
}

async function insertFromLibraryRow(page) {
  await openSoftwareLibraryTab(page);
  const card = page.locator(".g64-card").filter({ hasText: d64Name }).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await card
    .getByRole("group", { name: /IEC drive unit/i })
    .getByRole("button", { name: "8", exact: true })
    .click({ force: true, timeout: 15_000 });
  await page.waitForTimeout(300);
  const insertBtn = page.getByRole("button", { name: `Insert ${d64Name}`, exact: true });
  await insertBtn.waitFor({ state: "visible", timeout: 30_000 });
  await insertBtn.click({ timeout: 60_000, force: true });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(5000);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await installGrok64CoreNetworkGuard(page, base);

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  const jiffyOn = process.env.GROK64_USER_DIRTY_JIFFY === "1";
  await seedTomReusedProfile(page, { jiffyDos: jiffyOn });
  const seeded = await patchLocalStorage(page, {
    video: "auto",
    jiffy: jiffyOn,
    reu: "2048kB",
    drive: "cmd-layout",
    machineId: "c64-auto",
    coreMode: "auto",
    driveMode: "auto",
    mouse: true,
    scpuSimm: "16",
    scpuTurbo: true,
  });
  if (!seeded) trace.warn = "patchLocalStorage missed — Tom profile seeded via seedTomReusedProfile";
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

  await insertFromLibraryRow(page);
  await page.screenshot({ path: join(shotDir, "after-insert.png"), fullPage: true });

  const diagInsert = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  trace.aboutInsert = {
    viceLastReattach: diagInsert?.viceLastReattach,
    viceDriveBus: diagInsert?.viceDriveBus,
    viceDriveLive: diagInsert?.viceDriveLive,
  };

  const keyMs = Number(process.env.GROK64_TOM_TYPING_MS || (jiffyOn ? "120" : "85"));
  const typeLine = typeC64RealKeyboard;
  const loadDelay = { keyDelayMs: keyMs, lineEndMs: Math.max(1000, keyMs * 2) };
  trace.typingKeyMs = keyMs;
  await typeLine(page, 'LOAD"$",8', loadDelay);
  let loadWait = await waitForDollarLoad(page, { maxMs: 90_000 });
  let screenProbe = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  if (/LOAD\s*"",8/i.test(screenProbe) || /SYNTAX ERROR|ME ERROR/i.test(screenProbe)) {
    trace.loadDollarKeyboardMiss = screenProbe.slice(0, 120);
  }
  trace.loadWait = { error: loadWait.error, head: loadWait.text?.slice(0, 200) };
  trace.viceLoadDollarDiag = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.({ light: true });
    return d?.viceLoadDollarDiag ?? window.__g64?.captureLoadDollarDiag?.(8) ?? null;
  });
  trace.profilePersistDiff = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.({ light: true });
    return d?.profilePersistDiff ?? null;
  });
  if (trace.viceLoadDollarDiag == null) {
    trace.viceLoadDollarDiagError = "diag-still-null";
  }
  await page.waitForTimeout(jiffyOn ? 4000 : 3000);
  await typeLine(page, "LIST", jiffyOn ? { keyDelayMs: 110, lineEndMs: 900 } : { keyDelayMs: 75, lineEndMs: 600 });
  await page.waitForTimeout(jiffyOn ? 24_000 : 12_000);
  let screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  if (jiffyOn && !geosDirectoryOnScreen(screen)) {
    await typeLine(page, "LIST", { keyDelayMs: 85, lineEndMs: 700 });
    await page.waitForTimeout(18_000);
    screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  }
  await page.screenshot({ path: join(shotDir, "after-load-dollar.png"), fullPage: true });
  const catalogOk = geosDirectoryOnScreen(screen) && !/FILE NOT FOUND/i.test(screen);
  trace.catalogOnScreen = geosDirectoryOnScreen(screen);
  const bus = diagInsert?.viceDriveBus ?? {};
  const busOk =
    bus.wasmFilesystemDevice === 0 &&
    bus.wasmUnitTrueEmulation === 1 &&
    bus.wasmCpuClockAdvancing === true &&
    (bus.wasmTdeImageBytes ?? 0) > 174000 &&
    bus.serialDeviceLabel != null &&
    bus.serialDeviceLabel !== "virt";
  const live8 = diagInsert?.viceDriveLive ?? {};
  const attachRcOk =
    (diagInsert?.viceLastReattach?.rc ?? -1) === 0 ||
    ((live8.wasmTdeImageBytes ?? 0) > 174_000 &&
      live8.wasmGcrLoaded === 1 &&
      diagInsert?.viceDriveBus?.serialDeviceLabel !== "virt");
  const jiffyStable = jiffyAfterPower.want === false || jiffyAfterPower.want === jiffyBefore.want;
  const iecFail = /FILE NOT FOUND|DEVICE NOT PRESENT/i.test(screen) || loadWait.error;
  const pass =
    catalogOk && attachRcOk && busOk && !iecFail && (!jiffyOn || jiffyAfterPower.want === true);
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
