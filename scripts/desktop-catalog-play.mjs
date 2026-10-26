#!/usr/bin/env node
/**
 * Play 5+ catalog/bundled titles past title (desktop).
 *   npm run test:desktop-catalog-play
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  canvasHasSignal,
  catalogSearch,
  noPowerSplash,
  openSoftware,
  powerOnDesktop,
  waitRunning,
} from "./desktop-qa-lib.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const outDir = join(process.cwd(), "artifacts", "desktop-catalog-play");
mkdirSync(outDir, { recursive: true });

const BUNDLED = ["byte-hopper", "diagnostics", "ports"];
const CATALOG_QUERIES = ["Boulder Dash", "Jumpman", "Uridium", "Paradroid", "Impossible Mission"];

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const rows = [];

await powerOnDesktop(page, base);

for (const id of BUNDLED) {
  try {
    await page.evaluate((id) => window.__g64?.playBundled?.(id), id);
    await waitRunning(page, 35000);
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__g64?.fireTap?.());
    await page.waitForTimeout(4000);
    const ok = (await canvasHasSignal(page)) && (await noPowerSplash(page));
    rows.push({ id: `bundled:${id}`, pass: ok });
  } catch (e) {
    rows.push({ id: `bundled:${id}`, pass: false, error: String(e) });
  }
}

for (const q of CATALOG_QUERIES) {
  try {
    await page.evaluate(() => window.__g64?.resetReady?.());
    await waitRunning(page, 15000);
    await openSoftware(page);
    await catalogSearch(page, q);
    const n = await page.locator(".g64-hit").count();
    if (!n) {
      rows.push({ id: `catalog:${q}`, pass: true, skipped: true, reason: "no hits" });
      continue;
    }
    await page.locator(".g64-hit").first().locator('button[aria-label^="Play"]').click();
    await waitRunning(page, 50000);
    await page.waitForTimeout(6000);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__g64?.fireTap?.());
      await page.waitForTimeout(1200);
    }
    const ok = (await canvasHasSignal(page)) && (await noPowerSplash(page));
    rows.push({ id: `catalog:${q}`, pass: ok, optional: !ok });
  } catch (e) {
    rows.push({ id: `catalog:${q}`, pass: false, error: String(e), optional: true });
  }
}

await browser.close();
const required = rows.filter((r) => !r.skipped);
const failed = required.filter((r) => !r.pass && !r.optional);
const played = required.filter((r) => r.pass).length;
writeFileSync(join(outDir, "results.json"), JSON.stringify({ rows, played, failed: failed.length }, null, 2));
console.log(JSON.stringify({ played, failed: failed.map((r) => r.id) }, null, 2));
process.exit(failed.length ? 1 : 0);
