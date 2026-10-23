#!/usr/bin/env node
/**
 * Tom hands-on: Software › On this device › Play (not catalog hooks).
 * Saves screenshots under /opt/cursor/artifacts/screenshots/tom-qa-*.png
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { patchLocalStorage, powerOnDesktop, waitRunning, grok64FloppyAutostartPoison } from "./desktop-qa-lib.mjs";
import { cartFixturePath, CART_COMPAT_CATALOG } from "./cart-compat-catalog.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const out = "/opt/cursor/artifacts/screenshots";
mkdirSync(out, { recursive: true });

const ss5 = cartFixturePath(CART_COMPAT_CATALOG.find((c) => c.id === "ss5"));
const ar6 = cartFixturePath(CART_COMPAT_CATALOG.find((c) => c.id === "ar6"));
const ssName = "Super_Snapshot_v5.00_1990_NTSC.crt";
const arName = "Action_Replay_V6.0_6.0_1989_PAL.crt";

async function playLibrary(page, displayRe, menuRe = /SNAPSHOT|SUPER|REPLAY|ACTION/i) {
  await page.locator('button[aria-label="Software"]').click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(400);
  const card = page.locator(".g64-card").filter({ hasText: displayRe });
  await card.locator('button[aria-label^="Play"]').click();
  await waitRunning(page, 180_000);
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    if (menuRe.test(text) && !grok64FloppyAutostartPoison(text)) return text;
    await page.waitForTimeout(1_500);
  }
  return await page.evaluate(() => window.__g64?.screenText?.() || "");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: "domcontentloaded" });
await patchLocalStorage(page, { jiffy: true, video: "ntsc" });
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);
const jiffy = {
  "JiffyDOS_C64_6.01.bin": [...new Uint8Array(8192).fill(0x4a)],
  "JiffyDOS_1541-II_6.00.bin": [...new Uint8Array(8192).fill(0x41)],
};
await page.evaluate(async (roms) => {
  for (const [name, bytes] of Object.entries(roms)) {
    const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
    await window.__g64?.putRomBytes?.(id, name, bytes);
  }
  window.__g64?.setJiffyDos?.(true);
}, jiffy);
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false });
await waitRunning(page, 120_000);

await page.evaluate(async ({ name, bytes }) => window.__g64?.importLibraryBytes?.(name, bytes), {
  name: ssName,
  bytes: [...readFileSync(ss5)],
});
let t = await playLibrary(page, /Super_Snapshot/i, /SNAPSHOT|SUPER|TURBO/i);
await page.screenshot({ path: join(out, "tom-qa-01-ss5-play.png"), fullPage: true });
const ss1 = { poison: grok64FloppyAutostartPoison(t), menu: /SNAPSHOT|SUPER|TURBO/i.test(t) };

await page.locator('button[aria-label="Reset"]').click();
await page.waitForTimeout(12_000);
t = await page.evaluate(() => window.__g64?.screenText?.() || "");
await page.screenshot({ path: join(out, "tom-qa-02-ss5-reset.png"), fullPage: true });
const ssReset = { menu: /SNAPSHOT|SUPER/i.test(t), poison: grok64FloppyAutostartPoison(t) };

await page.evaluate(() => window.__g64?.hwPress?.("cart-out", "short"));
await waitRunning(page, 120_000);
await page.waitForTimeout(8_000);
t = await page.evaluate(() => window.__g64?.screenText?.() || "");
await page.screenshot({ path: join(out, "tom-qa-03-cart-out.png"), fullPage: true });
const cartOut = { basic: /READY/i.test(t), poison: grok64FloppyAutostartPoison(t) };

t = await playLibrary(page, /Super_Snapshot/i, /SNAPSHOT|SUPER|TURBO/i);
await page.screenshot({ path: join(out, "tom-qa-04-ss5-second.png"), fullPage: true });
const ss2 = { poison: grok64FloppyAutostartPoison(t), menu: /SNAPSHOT|SUPER|TURBO/i.test(t) };

await page.evaluate(() => window.__g64?.hwPress?.("cart-out", "short"));
await waitRunning(page, 90_000);
await page.evaluate(async ({ name, bytes }) => window.__g64?.importLibraryBytes?.(name, bytes), {
  name: arName,
  bytes: [...readFileSync(ar6)],
});
t = await playLibrary(page, /Action_Replay/i, /REPLAY|ACTION/i);
await page.screenshot({ path: join(out, "tom-qa-05-ar6-play.png"), fullPage: true });
const ar1 = { poison: grok64FloppyAutostartPoison(t), menu: /REPLAY|ACTION/i.test(t) };

const report = { ss1, ssReset, cartOut, ss2, ar1, pass: ss1.menu && !ss1.poison && ar1.menu && !ar1.poison };
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.pass && ss2.menu && !ss2.poison ? 0 : 1);
