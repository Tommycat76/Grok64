/**
 * Reset keeps a mounted CRT in session (SS5 / GUI64 menu returns).
 * GROK64_BASE_URL=http://127.0.0.1:8083/ node scripts/cart-reset-probe.mjs
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.GROK64_BASE_URL || "http://127.0.0.1:8083/";
const cartPath = join(process.cwd(), "public/software/super-snapshot-v5-ntsc.crt");
let cartBuf;
try {
  cartBuf = readFileSync(cartPath);
} catch {
  console.log("cart-reset-probe: skip (no SS5 fixture)");
  process.exit(0);
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 30000 });
  await page.evaluate(() => window.__g64.power());
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => window.__g64?.hasFs?.() && window.__g64?.running?.())) break;
    await page.waitForTimeout(300);
  }
  await page.evaluate(() =>
    window.__g64.load("/software/super-snapshot-v5-ntsc.crt", "super-snapshot-v5-ntsc.crt"),
  );
  for (let i = 0; i < 80; i++) {
    const cart = await page.evaluate(() => window.__g64?.cartLive?.());
    if (cart) break;
    await page.waitForTimeout(400);
  }
  assert.equal(await page.evaluate(() => window.__g64.cartLive()), true, "cart live after load");
  await page.evaluate(() => window.__g64.resetReady());
  await page.waitForTimeout(2500);
  assert.equal(await page.evaluate(() => window.__g64.cartLive()), true, "cart live after reset");
  const boot = await page.evaluate(() => window.__g64.bootFile?.());
  assert.match(boot || "", /\.crt$/i, "boot file still CRT after reset");
  console.log("cart-reset-probe: OK");
} finally {
  await browser.close();
}
