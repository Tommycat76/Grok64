#!/usr/bin/env node
/**
 * Real UI: stock KERNAL (Jiffy off) → Software → Insert GEOS_2.0.d64 → LOAD"$",8 → LIST.
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
  liveWithIecErrorProbe,
  openSoftware,
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitForG64,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-geos-insert-ui-stock");
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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await installGrok64CoreNetworkGuard(page, base);

const trace = { d64Name, jiffy: false };

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await clearEmulatorJsCache(page);
  await patchLocalStorage(page, { video: "pal", jiffy: false, reu: "2048kB" });
  await waitForG64(page);
  await page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await window.__g64?.importLibraryBytes?.(name, bin);
    },
    { name: d64Name, b64: d64B64 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await patchLocalStorage(page, { video: "pal", jiffy: false, reu: "2048kB" });
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
  await page.screenshot({ path: join(shotDir, "geos-ui-insert-stock-ready.png") });

  let diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  trace.diag = {
    jiffyWant: diag?.jiffyWant,
    jiffyLive: diag?.jiffyLive,
    coreBuildMatches: diag?.coreBuildMatches,
    viceDriveLive: diag?.viceDriveLive,
    viceAttachedImage: diag?.viceAttachedImage,
    viceLastReattach: diag?.viceLastReattach,
  };

  await typeBasic(page, 'LOAD"$",8', { afterMs: 12_000, listAfterDollar: true });
  await page.waitForTimeout(2000);
  const screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  await page.screenshot({ path: join(shotDir, "geos-ui-insert-stock-list.png") });

  const evidence = geosFloppyEvidence({
    screen,
    session: diag?.session,
    wasmWorkDisk: diag?.wasmWorkDisk,
    viceAttachedImage: diag?.viceAttachedImage,
  });
  const attachRcOk = (diag?.viceLastReattach?.rc ?? -1) === 0;
  const jiffyOff = diag?.jiffyWant === false && diag?.jiffyLive !== true;
  const live = await liveWithIecErrorProbe(page, diag?.viceDriveLive);
  trace.iecProbe = live.iecErrorChannel;
  const pass =
    evidence.ok &&
    attachRcOk &&
    jiffyOff &&
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
      jiffyWant: diag?.jiffyWant,
      jiffyLive: diag?.jiffyLive,
      coreBuildMatches: diag?.coreBuildMatches,
      viceDriveLive: diag?.viceDriveLive,
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
