#!/usr/bin/env node
/**
 * Tom emulator-baseline hands-on: GEOS_2.0.d64 (dirty profile) + SD2IEC IEC path.
 * Emits artifacts/geos-reference-baseline/compare-grok64.json for docs/GEOS_REFERENCE_EMULATOR_COMPARISON.md
 *
 *   npm run test:desktop-geos-baseline-hands-on
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertGrok64WasmCore,
  clearEmulatorJsCache,
  grok64CoreBuildIdFromManifest,
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import {
  geosDirectoryOnScreen,
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  typeC64RealKeyboard,
  waitForDollarLoad,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const shotDir = join(process.cwd(), "screenshots", "geos-baseline-hands-on");
const outDir = join(process.cwd(), "artifacts", "geos-reference-baseline");
mkdirSync(shotDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });
const d64Path = join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64");
const report = {
  capturedAt: new Date().toISOString(),
  grok64CoreBuildId: grok64CoreBuildIdFromManifest(),
  emulator: "Grok64",
  viceVersionLineage: "3.9.0 (WASM libretro fork)",
  rows: [],
};

if (!grok64DatapathFromEnv() || !existsSync(d64Path)) {
  report.skipped = true;
  writeFileSync(join(outDir, "compare-grok64.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const d64Name = "GEOS_2.0.d64";
const d64B64 = readFileSync(d64Path).toString("base64");

function driveSettingsFromDiag(diag) {
  const bus = diag?.viceDriveBus ?? {};
  const live = diag?.viceDriveLive ?? {};
  return {
    driveTrueEmulation: bus.wasmUnitTrueEmulation === 1 ? "on" : String(bus.wasmUnitTrueEmulation),
    virtualDevices: bus.serialDeviceLabel === "virt" ? "virt" : "real-serial",
    wasmFilesystemDevice: bus.wasmFilesystemDevice,
    serialDeviceLabel: bus.serialDeviceLabel,
    tdeImageBytes: live.wasmTdeImageBytes,
    gcrLoaded: live.wasmGcrLoaded,
    viceLoadDollarDiag: diag?.viceLoadDollarDiag ? "captured" : "null",
    profilePersistDiffKeys: diag?.profilePersistDiff
      ? Object.keys(diag.profilePersistDiff).filter((k) => diag.profilePersistDiff[k])
      : [],
  };
}

async function seedDirty(page) {
  await patchLocalStorage(page, { video: "pal", jiffy: false, reu: "2048kB", drive: "cmd-layout" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);
  await page.evaluate(async ({ name, b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__g64?.importLibraryBytes?.(name, bin);
  }, { name: d64Name, b64: d64B64 });
}

async function insertGeos(page) {
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type="file"]').setInputFiles(d64Path);
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape").catch(() => {});
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: new RegExp(`Insert ${d64Name}`) }).first().click({ timeout: 60_000 });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(3500);
}

async function loadDollarList(page, label) {
  await typeC64RealKeyboard(page, 'LOAD"$",8', { keyDelayMs: 80, lineEndMs: 900 });
  let loadWait = await waitForDollarLoad(page, { maxMs: 55_000 });
  let screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  if (/LOAD\s*"",8/i.test(screen) || /SYNTAX ERROR|ME ERROR/i.test(screen)) {
    await page.evaluate(async () => {
      await window.__g64?.feedBasic?.('LOAD"$",8', { runcmd: true });
    });
    await page.waitForTimeout(20_000);
    loadWait = await waitForDollarLoad(page, { maxMs: 45_000 });
    screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  }
  await typeC64RealKeyboard(page, "LIST", { keyDelayMs: 70, lineEndMs: 500 });
  await page.waitForTimeout(10_000);
  screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const catalogOk = geosDirectoryOnScreen(screen) && !/FILE NOT FOUND/i.test(screen);
  await page.screenshot({ path: join(shotDir, `${label}-list.png`), fullPage: true });
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  return { catalogOk, screenHead: screen.slice(0, 280), loadError: loadWait.error, drive: driveSettingsFromDiag(diag) };
}

async function runSd2iec(page) {
  await page.evaluate(async () => {
    window.__g64?.setIecSlot?.(8, "sd2iec");
    window.__g64?.resetDos?.();
    await window.__g64?.seedSd?.([
      { name: "ROOT.PRG", path: "", data: new Uint8Array([1, 8, 0, 10, 0xaa]).buffer },
      { name: "SUB.PRG", path: "games", data: new Uint8Array([1, 8, 0, 10, 0xbb]).buffer },
    ]);
  });
  await page.waitForTimeout(1500);
  const mount = await page.evaluate(() => ({
    slot: window.__g64?.opts?.()?.vice_drive8_type,
    wasmAttach: typeof window.__ejs?.Module?._grok64_sd2iec_attach === "function",
  }));
  await typeBasic(page, 'LOAD"$",8', { afterMs: 18_000 });
  const listText = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const listOk = /ROOT/i.test(listText) && !/FILE NOT FOUND/i.test(listText);
  const cd = await page.evaluate(async () => {
    const a = await window.__g64?.runDos?.('CD:"games"');
    const b = await window.__g64?.runDos?.("X");
    return { a, b };
  });
  const cdOk = /OK/.test(cd.a || "") && /games/i.test(cd.b || "");
  await typeBasic(page, 'LOAD"ROOT.PRG",8', { afterMs: 12_000 });
  const loadPrg = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const loadOk = !/FILE NOT FOUND/i.test(loadPrg);
  await page.screenshot({ path: join(shotDir, "sd2iec-hands-on.png"), fullPage: true });
  return {
    pass: listOk && cdOk && loadOk && mount.wasmAttach,
    mount,
    listOk,
    cdOk,
    loadOk,
    listHead: listText.slice(0, 200),
  };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await installGrok64CoreNetworkGuard(page, base);

let pass = false;
try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await seedDirty(page);
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  await insertGeos(page);
  const geosStock = await loadDollarList(page, "geos-stock");
  report.rows.push({
    id: "geos-dirty-insert-stock",
    jiffy: false,
    loadDollar: geosStock.catalogOk ? "PASS" : "FAIL",
    listGeos: geosStock.catalogOk ? "PASS" : "FAIL",
    deskTop: "not-run",
    driveSettings: geosStock.drive,
    detail: geosStock,
  });

  const sd = await runSd2iec(page);
  report.rows.push({
    id: "sd2iec-hands-on",
    mount: sd.pass ? "PASS" : "FAIL",
    loadDollar: sd.listOk ? "PASS" : "FAIL",
    cdGames: sd.cdOk ? "PASS" : "FAIL",
    loadRootPrg: sd.loadOk ? "PASS" : "FAIL",
    detail: sd,
  });

  pass = geosStock.catalogOk && sd.pass;
  report.pass = pass;
  writeFileSync(join(outDir, "compare-grok64.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass, geosStock: geosStock.catalogOk, sd2iec: sd.pass }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  report.error = String(e?.message || e);
  writeFileSync(join(outDir, "compare-grok64.json"), JSON.stringify(report, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
