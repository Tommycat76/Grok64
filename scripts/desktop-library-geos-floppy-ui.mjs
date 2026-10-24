#!/usr/bin/env node
/**
 * Library-row GEOS floppy Play (UI path) — import via __g64, Play from Software sheet, LOAD"$",8.
 * Screenshots: screenshots/library-geos-floppy-*.png
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  patchLocalStorage,
  powerOnDesktop,
  typeBasic,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { assertGrok64WasmCore, clearEmulatorJsCache, grok64DatapathFromEnv } from "./desktop-grok64-core.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const geosPath = join(process.cwd(), "fixtures", "geos", "GEOS64_2.0.d64");
const shotDir = join(process.cwd(), "screenshots");
mkdirSync(shotDir, { recursive: true });

if (!existsSync(geosPath)) {
  console.log(JSON.stringify({ pass: false, skipped: true, reason: "missing fixtures/geos/GEOS64_2.0.d64" }));
  process.exit(0);
}

if (!grok64DatapathFromEnv()) {
  console.error("VITE_GROK64_VICE_DATAPATH missing");
  process.exit(1);
}

const sourceBytes = readFileSync(geosPath);
const sourceSha1 = createHash("sha1").update(sourceBytes).digest("hex");
const libName = "GEOS64_2.0.d64";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: "domcontentloaded" });
await clearEmulatorJsCache(page);
await patchLocalStorage(page, { video: "pal", jiffy: false, reu: "2048kB" });
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
await assertGrok64WasmCore(page, { timeoutMs: 120_000 });

await page.evaluate(
  async ({ name, bytes }) => {
    await window.__g64?.importLibraryBytes?.(name, [...bytes]);
  },
  { name: libName, bytes: [...sourceBytes] },
);
await page.waitForTimeout(800);

await page.locator('button[aria-label="Software"]').click({ timeout: 15_000 });
await page.waitForTimeout(500);
await page.getByRole("button", { name: /On this device/i }).click();
await page.waitForTimeout(400);
const esc = libName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
await page.getByRole("button", { name: new RegExp(`^(Play|Run) ${esc}$`) }).click({ timeout: 30_000 });
await waitRunning(page, 180_000);
await page.waitForTimeout(8000);

const diag = await page.evaluate(async () => window.__g64?.attachDiskDiag?.());
await page.screenshot({ path: join(shotDir, "library-geos-floppy-after-play.png"), fullPage: true });

await typeBasic(page, 'LOAD"$",8', { afterMs: 15_000 });
await page.waitForTimeout(6000);
const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
await page.screenshot({ path: join(shotDir, "library-geos-floppy-load-dir.png"), fullPage: true });

const sessionSha1 = diag?.session?.sha1 ?? null;
const shaMatch = sessionSha1 === sourceSha1;
const dirOk = !/FILE NOT FOUND|DEVICE NOT PRESENT/i.test(text) && text.length > 60;

const report = {
  pass: shaMatch && dirOk,
  sourceSha1,
  sessionSha1,
  shaMatch,
  dirOk,
  textHead: text.slice(0, 140),
  diag,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.pass ? 0 : 1);
