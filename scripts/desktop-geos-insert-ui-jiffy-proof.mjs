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
import {
  baselineCoreDiagOk,
  baselineDriveLiveOk,
  geosFloppyEvidence,
  geosDirectoryOnScreen,
  liveWithIecErrorProbe,
  openSoftware,
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await installGrok64CoreNetworkGuard(page, base);

const trace = { d64Name, jiffy: true };

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "pal", jiffy: true, reu: "2048kB" });
  await waitForG64(page);
  await page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__g64?.importLibraryBytes?.(name, bin);
    },
    { name: d64Name, b64: d64B64 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await patchLocalStorage(page, { video: "pal", jiffy: true, reu: "2048kB" });
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
  await page.reload({ waitUntil: "domcontentloaded" });
  await patchLocalStorage(page, { video: "pal", jiffy: true, reu: "2048kB" });
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

  await openSoftware(page);
  await page.getByRole("button", { name: /On this device/i }).click({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const insertLabel = `Insert ${d64Name}`;
  await page.locator(`button[aria-label="${insertLabel}"]`).first().click({ timeout: 60_000 });
  await waitRunning(page, 90_000);
  await page.waitForTimeout(3000);
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

  await page.evaluate(async () => {
    await window.__g64?.resetReady?.();
  });
  await page.waitForTimeout(1200);
  await typeBasic(page, 'LOAD"$",8', { afterMs: 18_000 });
  await page.waitForTimeout(1500);
  await typeBasic(page, "LIST", { afterMs: 12_000 });
  await page.waitForTimeout(2500);
  const screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  await page.screenshot({ path: join(shotDir, "geos-ui-insert-jiffy-list.png") });

  const sessionDirOk = /47454f53/i.test(diag?.session?.dir18s1Hex ?? "");
  const listOk = geosDirectoryOnScreen(screen) || sessionDirOk;
  const evidence = geosFloppyEvidence({
    screen,
    session: diag?.session,
    wasmWorkDisk: diag?.wasmWorkDisk,
    viceAttachedImage: diag?.viceAttachedImage,
  });
  const attachRcOk = (diag?.viceLastReattach?.rc ?? -1) === 0;
  const live = await liveWithIecErrorProbe(page, diag?.viceDriveLive);
  trace.iecProbe = live.iecErrorChannel;
  trace.listOk = listOk;
  const pass =
    attachRcOk === true &&
    listOk &&
    evidence.wasmOk &&
    !evidence.iecFail &&
    diag?.jiffyLive === true &&
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
