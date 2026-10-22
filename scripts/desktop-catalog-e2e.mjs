#!/usr/bin/env node
/**
 * Catalog downloader UI e2e (desktop Chromium).
 *   npm run test:desktop-catalog
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
const outDir = join(process.cwd(), "artifacts", "desktop-catalog-e2e");
mkdirSync(outDir, { recursive: true });

const results = [];
const push = (row) => {
  results.push(row);
  console.log(row.pass ? "PASS" : row.skipped ? "SKIP" : "FAIL", row.id, row.detail ?? row.reason ?? "");
};

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  await powerOnDesktop(page, base);
  await openSoftware(page);

  const hasSearch = (await page.locator(".g64-search input").count()) > 0;
  push({ id: "catalog-search-field", pass: hasSearch });

  await page.locator('.g64-chips button[data-on="true"]').first().waitFor({ timeout: 8000 }).catch(() => null);
  await catalogSearch(page, "Boulder Dash");
  const hits = await page.locator(".g64-hit").count();
  push({ id: "catalog-search-hits", pass: hits > 0, detail: `hits=${hits}`, optional: hits === 0 });

  if (hits > 0) {
    const before = await page.evaluate(() => window.__g64?.libraryCount?.() ?? 0);
    await page.locator(".g64-hit").first().locator('button[aria-label^="Play"]').click();
    await waitRunning(page, 45000);
    await page.waitForTimeout(5000);
    const after = await page.evaluate(() => window.__g64?.libraryCount?.() ?? 0);
    push({
      id: "catalog-download-play",
      pass: after >= before + 1 && (await canvasHasSignal(page)) && (await noPowerSplash(page)),
      detail: { before, after },
      optional: hits === 0,
    });

    await openSoftware(page);
    await catalogSearch(page, "Boulder Dash");
    const before2 = await page.evaluate(() => window.__g64?.libraryCount?.() ?? 0);
    await page.locator(".g64-hit").first().locator('button[aria-label^="Play"]').click();
    await page.waitForTimeout(8000);
    const after2 = await page.evaluate(() => window.__g64?.libraryCount?.() ?? 0);
    push({ id: "catalog-repeat-download", pass: after2 >= before2, detail: { before2, after2 }, optional: true });
  }

  async function waitCatalogToast(page, pattern, ms = 12000) {
    const toast = page.locator("[data-sonner-toast]");
    await toast.first().waitFor({ state: "visible", timeout: ms }).catch(() => null);
    const texts = await toast.allTextContents().catch(() => []);
    const joined = texts.join(" ");
    return { joined, pass: pattern.test(joined) };
  }

  const isCatalogDownload = (url) =>
    /\/api\/ia(\?|$)/i.test(url) &&
    (/hvsc\.de/i.test(url) || /C64Music\//i.test(url) || /download\/C64Music/i.test(url));

  const hvscRoute = async (route) => {
    const url = route.request().url();
    if (!isCatalogDownload(url)) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>nope</body></html>",
    });
  };

  // Bad file (HTML masquerading as download)
  await page.route("**/*", hvscRoute);
  await openSoftware(page);
  await page.locator('.g64-chips button:has-text("SID")').click();
  await page.waitForTimeout(400);
  await catalogSearch(page, "Commando");
  await page.locator(".g64-hit").first().waitFor({ timeout: 8000 }).catch(() => null);
  const sidHits = await page.locator(".g64-hit").count();
  if (sidHits > 0) {
    await page.locator(".g64-hit").first().locator('button[aria-label^="Play"]').click();
    const bad = await waitCatalogToast(page, /web page|empty|failed|6\s*MB/i);
    push({
      id: "catalog-bad-file",
      pass: /web page|empty/i.test(bad.joined),
      detail: bad.joined,
    });
  } else {
    push({ id: "catalog-bad-file", pass: false, reason: "no HVSC hit for Commando" });
  }
  await page.unroute("**/*", hvscRoute);

  // Large file (>6 MB cap)
  const big = new Uint8Array(7 * 1024 * 1024);
  big[0] = 0x43;
  big[1] = 0x36;
  const largeRoute = async (route) => {
    const url = route.request().url();
    if (!isCatalogDownload(url)) {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 200, body: Buffer.from(big), contentType: "application/octet-stream" });
  };
  await page.route("**/*", largeRoute);
  await openSoftware(page);
  await page.locator('.g64-chips button:has-text("SID")').click();
  await page.waitForTimeout(400);
  await catalogSearch(page, "Commando");
  if ((await page.locator(".g64-hit").count()) > 0) {
    await page.locator(".g64-hit").first().locator('button[aria-label^="Play"]').click();
    const large = await waitCatalogToast(page, /6\s*MB|larger/i);
    push({
      id: "catalog-large-file",
      pass: large.pass,
      detail: large.joined,
    });
  } else {
    push({ id: "catalog-large-file", pass: false, reason: "no HVSC hit" });
  }
  await page.unroute("**/*", largeRoute);

  // Cancel: slow download, close Software drawer (aborts in-flight fetch)
  await page.route("**/download/C64Music/**", async (route) => {
    await new Promise((r) => setTimeout(r, 12000));
    await route.fulfill({ status: 200, body: Buffer.alloc(128, 0), contentType: "application/octet-stream" });
  });
  await openSoftware(page);
  await page.locator('.g64-chips button:has-text("SID")').click();
  await catalogSearch(page, "Commando");
  if ((await page.locator(".g64-hit").count()) > 0) {
    void page.locator(".g64-hit").first().locator('button[aria-label^="Play"]').click();
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__g64?.closeSoftware?.());
    await page.waitForTimeout(2000);
    const busy = await page.locator(".animate-spin").count();
    push({ id: "catalog-cancel-close", pass: busy === 0, detail: `spinners=${busy}`, optional: true });
  } else {
    push({ id: "catalog-cancel-close", pass: true, skipped: true });
  }
  await page.unroute("**/download/C64Music/**");

  // Mount while running (insert) — use library disk if present
  await page.evaluate(() => window.__g64?.playBundled?.("ready"));
  await waitRunning(page, 20000);
  await openSoftware(page);
  await catalogSearch(page, "Boulder Dash");
  if ((await page.locator(".g64-hit").count()) > 0) {
    const insertBtn = page.locator(".g64-hit").first().locator('button[aria-label^="Insert"]');
    if (await insertBtn.count()) {
      await insertBtn.click();
      await page.waitForTimeout(6000);
      push({ id: "catalog-insert-mount", pass: await page.evaluate(() => window.__g64?.running?.()), optional: true });
    } else {
      push({ id: "catalog-insert-mount", pass: true, skipped: true, reason: "insert hidden until running" });
    }
  }
} catch (e) {
  push({ id: "suite-error", pass: false, error: String(e) });
}

await browser.close();
const failed = results.filter((r) => !r.pass && !r.skipped && !r.optional);
writeFileSync(join(outDir, "results.json"), JSON.stringify({ results, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
