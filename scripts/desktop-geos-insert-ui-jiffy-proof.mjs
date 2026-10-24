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
  grok64DatapathFromEnv,
  installGrok64CoreNetworkGuard,
} from "./desktop-grok64-core.mjs";
import {
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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await installGrok64CoreNetworkGuard(page, base);

const trace = { d64Name, jiffy: true };

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

  await openSoftware(page);
  await page.getByRole("button", { name: /On this device/i }).click({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const insertLabel = `Insert ${d64Name}`;
  await page.locator(`button[aria-label="${insertLabel}"]`).first().click({ timeout: 60_000 });
  await waitRunning(page, 90_000);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(shotDir, "geos-ui-insert-jiffy-ready.png") });

  const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
  trace.diag = {
    jiffyWant: diag?.jiffyWant,
    jiffyLive: diag?.jiffyLive,
    attachPathProbe: diag?.attachPathProbe,
    wasmWorkDisk: diag?.wasmWorkDisk,
    viceAttachedImage: diag?.viceAttachedImage,
    viceLastReattach: diag?.viceLastReattach,
  };

  await typeBasic(page, 'LOAD"$",8', { afterMs: 14_000 });
  await page.waitForTimeout(2000);
  await typeBasic(page, "LIST", { afterMs: 10_000 });
  await page.waitForTimeout(3000);
  const screen = await page.evaluate(() => window.__g64?.screenText?.() ?? "");
  await page.screenshot({ path: join(shotDir, "geos-ui-insert-jiffy-list.png") });

  const wasmOk = diag?.wasmWorkDisk?.some((r) => r.matchesSession && (r.wasmFsStat ?? 0) > 0);
  const listOk = /GEOS/i.test(screen) && !/FILE NOT FOUND/i.test(screen) && !/^work\s*disk/i.test(screen.slice(0, 120));
  const pass = listOk && wasmOk !== false && diag?.jiffyLive === true;
  trace.pass = pass;
  trace.screen = screen.slice(0, 500);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.log(JSON.stringify({ pass, listOk, wasmOk, jiffyLive: diag?.jiffyLive }));
  process.exit(pass ? 0 : 1);
} catch (e) {
  trace.error = String(e?.message || e);
  writeFileSync(join(outDir, "trace.json"), JSON.stringify(trace, null, 2));
  console.error(e);
  process.exit(1);
} finally {
  await browser.close();
}
