#!/usr/bin/env node
/**
 * Tom hand path: reused profile, library row Insert (unit 8 seg), LOAD"$",8 @ 400ms/key.
 * Screenshots under screenshots/geos-insert-tom-hand/
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
import {
  geosDirectoryOnScreen,
  patchLocalStorage,
  seedTomReusedProfile,
  powerOnDesktop,
  waitForDollarLoad,
  waitForG64,
  typeC64RealKeyboard,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const keyMs = Number(process.env.GROK64_TOM_TYPING_MS || "400");
const shotDir = join(process.cwd(), "screenshots", "geos-insert-tom-hand");
const outDir = join(process.cwd(), "artifacts", "geos-insert-tom-hand");
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
const trace = { keyMs, path: "library-row-insert-unit-8", librarySeed: "importLibraryBytes-no-ui-import" };

async function typeTomKeyboard(page, text) {
  await typeC64RealKeyboard(page, text, { keyDelayMs: keyMs, lineEndMs: Math.max(1200, keyMs * 2) });
  await page.waitForTimeout(keyMs);
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
    await page.evaluate(() => window.__g64?.openSoftwareLibrary?.() ?? window.__g64?.openSoftware?.());
  } else {
    trace.softwareOpen = "toolbar-click";
  }
  await page.evaluate(() => window.__g64?.openSoftwareLibrary?.());
  await page.locator(".g64-seg button").filter({ hasText: /^On this device/ }).click({ force: true }).catch(() => {});
  await page.locator(".g64-sheet").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("button.g64-btn").filter({ hasText: /^Import$/ }).first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(200);
}

/** Tom's disk is already in On this device — UI Import would autostart GEOS via runSaved(). */
async function seedLibraryQuiet(page) {
  await page.evaluate(async ({ name, b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__g64?.importLibraryBytes?.(name, bin);
  }, { name: d64Name, b64: d64B64 });
  await page.waitForTimeout(400);
}

async function insertLibraryRowUnit8(page) {
  const running = await page.evaluate(() => window.__g64?.running?.());
  trace.insertRunning = running;
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
  await insertBtn.scrollIntoViewIfNeeded().catch(() => {});
  await insertBtn.click({ timeout: 60_000, force: true });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(5000);
  trace.postInsertDiag = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.();
    return {
      viceLastReattach: d?.viceLastReattach,
      viceDriveBus: d?.viceDriveBus,
      viceLoadDollarDiag: d?.viceLoadDollarDiag,
    };
  });
  await page.screenshot({ path: join(shotDir, "02-after-insert.png"), fullPage: true });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await installGrok64CoreNetworkGuard(page, base);

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await seedTomReusedProfile(page, { jiffyDos: false });
  await patchLocalStorage(page, {
    video: "auto",
    jiffy: false,
    reu: "2048kB",
    drive: "cmd-layout",
    machineId: "c64-auto",
    coreMode: "auto",
    driveMode: "auto",
    mouse: true,
    scpuSimm: "16",
    scpuTurbo: true,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  await page.screenshot({ path: join(shotDir, "00-powered-on.png"), fullPage: true });

  await seedLibraryQuiet(page);
  await page.screenshot({ path: join(shotDir, "01-library-seeded.png"), fullPage: true });
  await insertLibraryRowUnit8(page);

  trace.preLoadDiag = await page.evaluate(async () => {
    const d = await window.__g64?.attachDiskDiag?.({ light: true });
    return {
      viceLoadDollarDiag: d?.viceLoadDollarDiag,
      viceDriveBus: d?.viceDriveBus,
      screen: (window.__g64?.screenText?.() ?? "").slice(0, 120),
    };
  });

  await page.screenshot({ path: join(shotDir, "03-before-load.png"), fullPage: true });
  await typeTomKeyboard(page, 'LOAD"$",8');
  const loadWait = await waitForDollarLoad(page, { maxMs: 90_000 });
  trace.loadWait = { error: loadWait.error, head: loadWait.text?.slice(0, 200) };
  trace.viceLoadDollarDiag = await page.evaluate(
    () => window.__g64?.captureLoadDollarDiag?.(8) ?? null,
  );
  await page.screenshot({ path: join(shotDir, "04-after-load-dollar.png"), fullPage: true });

  await typeTomKeyboard(page, "LIST");
  await page.waitForTimeout(20_000);
  const screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  trace.screen = screen.slice(0, 400);
  await page.screenshot({ path: join(shotDir, "05-after-list.png"), fullPage: true });

  const catalogOk = geosDirectoryOnScreen(screen) && !/FILE NOT FOUND/i.test(screen);
  const iecFail = /FILE NOT FOUND|DEVICE NOT PRESENT/i.test(screen) || loadWait.error;
  trace.pass = catalogOk && !iecFail;
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass: trace.pass, catalogOk, iecFail, keyMs, diag: trace.viceLoadDollarDiag }));
  process.exit(trace.pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
