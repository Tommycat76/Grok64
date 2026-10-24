#!/usr/bin/env node
/**
 * Real UI: power on with JiffyDOS → Software → Insert GEOS_2.0.d64 → LOAD"$",8 → LIST (no __g64 insert helper).
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
  baselineCoreDiagOk,
  baselineDriveLiveOk,
  geosFloppyEvidence,
  geosDirectoryOnScreen,
  liveWithIecErrorProbe,
  patchLocalStorage,
  powerOnDesktop,
  typeC64Screen,
  waitForDollarLoad,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-geos-insert-ui-jiffy");
const shotDir = join(process.cwd(), "screenshots");
mkdirSync(outDir, { recursive: true });
mkdirSync(shotDir, { recursive: true });

spawnSync(process.execPath, ["scripts/prepare-floppy-fixtures.mjs"], { stdio: "inherit" });

const d64Path =
  process.env.GROK64_GEOS_D64_PATH ||
  (existsSync(join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64"))
    ? join(process.cwd(), "fixtures", "geos", "GEOS_2.0.d64")
    : null);

if (!grok64DatapathFromEnv() || !d64Path) {
  console.log(JSON.stringify({ pass: false, skipped: true }));
  process.exit(0);
}

const d64Name = d64Path.split("/").pop() ?? "GEOS_2.0.d64";
const d64B64 = readFileSync(d64Path).toString("base64");

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
  await page.getByRole("button", { name: new RegExp(`^(Play|Run) ${esc}$`) }).first().click({ timeout: 60_000 });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(4000);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await installGrok64CoreNetworkGuard(page, base);

const trace = { d64Name, jiffy: true };

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "pal", jiffy: true, reu: "2048kB", drive: "cmd-layout" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForG64(page);
  await page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__g64?.importLibraryBytes?.(name, bin);
    },
    { name: d64Name, b64: d64B64 },
  );
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });
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
  await page.waitForTimeout(800);
  await page.locator('button[aria-label="Power off"]').first().click({ timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.locator('button[aria-label="Power on"], .g64-power').first().click({ timeout: 15_000 });
  await waitRunning(page, 120_000);
  await importFile(page, d64Path);
  await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: new RegExp(`Insert ${d64Name}`) }).first().click({ timeout: 60_000 });
  await waitRunning(page, 180_000);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(shotDir, "geos-ui-insert-jiffy-ready.png") });

  let diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  trace.diag = {
    jiffyWant: diag?.jiffyWant,
    jiffyLive: diag?.jiffyLive,
    attachPathProbe: diag?.attachPathProbe,
    wasmWorkDisk: diag?.wasmWorkDisk,
    viceAttachedImage: diag?.viceAttachedImage,
    viceLastReattach: diag?.viceLastReattach,
    session: diag?.session,
    utf8MarshalProbe: diag?.utf8MarshalProbe,
  };

  await typeC64Screen(page, 'LOAD"$",8');
  const loadWait = await waitForDollarLoad(page, { maxMs: 60_000 });
  if (loadWait.error) throw new Error(`LOAD"$",8 IEC error: ${loadWait.text?.slice(0, 120)}`);
  await page.waitForTimeout(4000);
  await typeC64Screen(page, "LIST");
  await page.waitForTimeout(22_000);
  let screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  trace.listHead = screen.slice(0, 200);
  if (!geosDirectoryOnScreen(screen)) {
    await typeC64Screen(page, "LIST");
    await page.waitForTimeout(18_000);
  }
  screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  if (!geosDirectoryOnScreen(screen) || /FILE NOT FOUND/i.test(screen)) {
    throw new Error(`GEOS directory not on screen under Jiffy: ${screen.slice(0, 200)}`);
  }
  diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  await page.screenshot({ path: join(shotDir, "geos-ui-insert-jiffy-list.png") });

  const evidence = geosFloppyEvidence({
    screen,
    session: diag?.session,
    wasmWorkDisk: diag?.wasmWorkDisk,
    viceAttachedImage: diag?.viceAttachedImage,
  });
  const attachRcOk = (diag?.viceLastReattach?.rc ?? -1) === 0;
  const live = await liveWithIecErrorProbe(page, diag?.viceDriveLive);
  trace.iecProbe = live.iecErrorChannel;
  const bus = diag?.viceDriveBus ?? {};
  const busOk =
    bus.wasmFilesystemDevice === 0 &&
    bus.wasmUnitTrueEmulation === 1 &&
    (bus.wasmCpuClockAdvancing === true || bus.wasmCpuClockAdvancing == null);
  const pass =
    attachRcOk === true &&
    evidence.ok &&
    diag?.jiffyWant === true &&
    busOk &&
    baselineCoreDiagOk(diag) &&
    baselineDriveLiveOk(live);
  trace.pass = pass;
  trace.evidence = evidence;
  trace.screen = screen.slice(0, 500);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(
    JSON.stringify({
      pass,
      evidence,
      attachRcOk,
      jiffyLive: diag?.jiffyLive,
      wasmFsStat: diag?.attachPathProbe?.[0]?.wasmFsStat,
    }),
  );
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
