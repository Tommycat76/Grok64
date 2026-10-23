#!/usr/bin/env node
/**
 * Tom hands-on sequence: Power → Jiffy ON (Settings) → On this device › Play SS5.
 * Simulates older IndexedDB basenames (no .crt) and Jiffy live before cart Play.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  grok64FloppyAutostartPoison,
  patchLocalStorage,
  powerOnDesktop,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { cartFixturePath, CART_COMPAT_CATALOG } from "./cart-compat-catalog.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const out = "/opt/cursor/artifacts/screenshots";
mkdirSync(out, { recursive: true });

const ss5 = cartFixturePath(CART_COMPAT_CATALOG.find((c) => c.id === "ss5"));
const ssMenuRe = /SUPER SNAPSHOT|SNAPSHOT BY|TURBO DOS|SELECT OPTION/i;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

await page.goto(base, { waitUntil: "domcontentloaded" });
await patchLocalStorage(page, { jiffy: false, video: "ntsc" });
await page.reload({ waitUntil: "domcontentloaded" });

await page.evaluate(async (roms) => {
  for (const [name, bytes] of Object.entries(roms)) {
    const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
    await window.__g64?.putRomBytes?.(id, name, bytes);
  }
}, {
  "JiffyDOS_C64_6.01.bin": [...new Uint8Array(8192).fill(0x4a)],
  "JiffyDOS_1541-II_6.00.bin": [...new Uint8Array(8192).fill(0x41)],
});

await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
await page.waitForTimeout(3000);

await page.evaluate(() => window.__g64?.setJiffyDos?.(true));
await page.waitForTimeout(6000);
await page.screenshot({ path: join(out, "tom-power-01-jiffy-ready.png"), fullPage: true });

const bytes = [...readFileSync(ss5)];
await page.evaluate(
  async ({ bytes }) => window.__g64?.importLibraryBytes?.("saved-ss5-dump", bytes),
  { bytes },
);

await page.locator('button[aria-label="Software"]').click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /On this device/i }).click();
await page.waitForTimeout(400);
await page.locator(".g64-card").filter({ hasText: /saved-ss5-dump/i }).locator('button[aria-label^="Play"]').click();
await waitRunning(page, 180_000);

const t0 = Date.now();
let text = "";
while (Date.now() - t0 < 90_000) {
  text = await page.evaluate(() => window.__g64?.screenText?.() || "");
  if (ssMenuRe.test(text) && !grok64FloppyAutostartPoison(text)) break;
  await page.waitForTimeout(1500);
}

const diag = await page.evaluate(() => ({
  boot: window.__g64?.bootFile?.(),
  cart: window.__g64?.cartLive?.(),
  fast: window.__g64?.fastLoadCart?.(),
  jiffyLive: window.__g64?.jiffyLive?.(),
  playMode: window.__g64?.playMode?.(),
}));

await page.screenshot({ path: join(out, "tom-power-02-ss5-play.png"), fullPage: true });

const cartFzVisible = await page.locator('button[data-hw="cart-fz"]').count();
const cartOutVisible = await page.locator('button[data-hw="cart-out"]').count();

const report = {
  menu: ssMenuRe.test(text),
  poison: grok64FloppyAutostartPoison(text),
  basicOnly: /COMMODORE 64 BASIC/i.test(text) && /\bREADY\b/i.test(text) && !ssMenuRe.test(text),
  cartFzVisible,
  cartOutVisible,
  diag,
  consoleErrorCount: consoleErrors.length,
  consoleSample: consoleErrors.slice(0, 5),
  pass:
    ssMenuRe.test(text) &&
    !grok64FloppyAutostartPoison(text) &&
    diag.cart === true &&
    cartFzVisible > 0 &&
    cartOutVisible > 0,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.pass ? 0 : 1);
