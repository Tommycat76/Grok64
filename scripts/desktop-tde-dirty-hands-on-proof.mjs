#!/usr/bin/env node
/**
 * Dirty-profile style UI proof: About TDE probes, LOAD"$",8 + LIST (Jiffy on/off), deskTop.
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
import { applySyntheticJiffy } from "./drive-combo-qa-lib.mjs";
import {
  baselineDriveLiveOk,
  geosDirectoryOnScreen,
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const shotDir = join(process.cwd(), "screenshots", "tde-dirty-hands-on");
const outDir = join(process.cwd(), "artifacts", "tde-dirty-hands-on");
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
const trace = { buildId: grok64CoreBuildIdFromManifest(), steps: [] };

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

async function runDisk(page) {
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: new RegExp(`^(Play|Run) ${d64Name}$`) }).first().click({ timeout: 30_000 });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(4000);
}

function tdeProbeOk(live) {
  return (
    live?.wasmTdeImageBytes === 175531 &&
    live?.wasmGcrLoaded === 1 &&
    live?.wasmVdriveImageSame === 1 &&
    baselineDriveLiveOk(live)
  );
}

async function listGeos(page, label) {
  await typeBasic(page, 'LOAD"$",8', { afterMs: 18_000 });
  await page.waitForTimeout(2000);
  await typeBasic(page, "LIST", { afterMs: 12_000 });
  await page.waitForTimeout(2500);
  const text = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const ok = geosDirectoryOnScreen(text) && !/FILE NOT FOUND/i.test(text);
  await page.screenshot({ path: join(shotDir, `${label}-list.png`), fullPage: true });
  return { ok, head: text.slice(0, 400) };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await installGrok64CoreNetworkGuard(page, base);

try {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "pal", jiffy: true, reu: "2048kB", drive: "cmd-layout" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);
  await page.evaluate(async ({ name, b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__g64?.importLibraryBytes?.(name, bin);
  }, { name: d64Name, b64: d64B64 });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
  await applySyntheticJiffy(page);
  await page.evaluate(() => window.__g64?.setJiffyDos?.(true));
  await page.waitForTimeout(800);

  await importFile(page, d64Path);
  await runDisk(page);

  await page.locator('button[aria-label="About"]').click({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  const live = diag?.viceDriveLive ?? {};
  trace.about = {
    coreBuildId: diag?.coreBuildId,
    coreBuildMatches: diag?.coreBuildMatches,
    viceLastReattach: diag?.viceLastReattach,
    wasmTdeImageBytes: live.wasmTdeImageBytes,
    wasmGcrLoaded: live.wasmGcrLoaded,
    wasmVdriveImageSame: live.wasmVdriveImageSame,
    tdeProbeOk: tdeProbeOk(live),
  };
  await page.screenshot({ path: join(shotDir, "about-tde-probes-jiffy-on.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const listJiffyOn = await listGeos(page, "jiffy-on");
  trace.steps.push({ id: "list-jiffy-on", pass: listJiffyOn.ok, ...listJiffyOn });

  await page.evaluate(async () => {
    await window.__g64?.resetReady?.();
  });
  await page.waitForTimeout(1500);
  await typeBasic(page, 'LOAD"GEOS",8,1', { afterMs: 40_000 });
  await page.waitForTimeout(1000);
  await typeBasic(page, "RUN", { afterMs: 8_000 });
  await page.waitForTimeout(25_000);
  const desktop = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  const deskOk =
    !/FILE NOT FOUND/i.test(desktop) &&
    !/COMMODORE 64 BASIC V2/i.test(desktop) &&
    desktop.replace(/\s+/g, "").length > 100;
  await page.screenshot({ path: join(shotDir, "geos-desktop-loaded.png"), fullPage: true });
  trace.steps.push({ id: "geos-desktop", pass: deskOk, head: desktop.slice(0, 300) });

  trace.stockKernalGate = "npm run test:desktop-geos-insert-ui-stock (separate gate)";
  trace.pass =
    trace.about.tdeProbeOk === true &&
    trace.about.coreBuildMatches === true &&
    (trace.about.viceLastReattach?.rc ?? -1) === 0 &&
    trace.steps.every((s) => s.pass);

  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify(trace, null, 2));
  process.exit(trace.pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
