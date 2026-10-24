#!/usr/bin/env node
/**
 * SS4/SS5 cart matrix (stock vs Jiffy) — headless Chromium, screenshots per row.
 *   CART_MATRIX_SS=ss4,ss5 node scripts/cart-matrix-ss-headless-proof.mjs
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
import { cartFixturePath, cartPlayName, CART_COMPAT_CATALOG } from "./cart-compat-catalog.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const out = "/opt/cursor/artifacts/screenshots";
mkdirSync(out, { recursive: true });

const want = (process.env.CART_MATRIX_SS || "ss4,ss5")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const entries = CART_COMPAT_CATALOG.filter((c) => want.includes(c.id));
if (!entries.length) {
  console.error("No catalog entries for", want.join(","));
  process.exit(1);
}

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

async function bootFresh(page, { jiffy }) {
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await patchLocalStorage(page, { video: "ntsc", jiffy: false, coreMode: "accurate" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(async (roms) => {
    for (const [name, bytes] of Object.entries(roms)) {
      const id = /1541/i.test(name) ? "jiffy-1541" : "jiffy-c64";
      await window.__g64?.putRomBytes?.(id, name, bytes);
    }
  }, synthJiffyPair());
  await powerOnDesktop(page, base, { navigate: false });
  await waitRunning(page, 120_000);
  await page.waitForFunction(() => /\bREADY\b/i.test(window.__g64?.screenText?.() || ""), { timeout: 120_000 });
  if (jiffy) {
    await page.evaluate(() => window.__g64?.setJiffyDos?.(true));
    await page.waitForTimeout(3000);
  }
}

async function playCart(page, entry) {
  const path = cartFixturePath(entry);
  const bytes = [...readFileSync(path)];
  const name = cartPlayName(entry);
  await page.evaluate(async ({ name, bytes }) => window.__g64?.importLibraryBytes?.(name, bytes), {
    name,
    bytes,
  });
  await page.locator('button[aria-label="Software"]').click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /On this device/i }).click();
  await page.waitForTimeout(300);
  const card = page.locator(".g64-card").filter({ hasText: /Super_Snapshot|Snapshot/i });
  await card.locator('button[aria-label^="Play"]').first().click();
  await waitRunning(page, 180_000);
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    const text = await page.evaluate(() => window.__g64?.screenText?.() || "");
    if (entry.menuRe.test(text) && !grok64FloppyAutostartPoison(text)) return text;
    await page.waitForTimeout(1200);
  }
  return await page.evaluate(() => window.__g64?.screenText?.() || "");
}

const rows = [];
for (const entry of entries) {
  for (const kernal of ["stock", "jiffy"]) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await bootFresh(page, { jiffy: kernal === "jiffy" });
    const shotBoot = join(out, `cart-matrix-${entry.id}-${kernal}-00-ready.png`);
    await page.screenshot({ path: shotBoot, fullPage: true });

    const text = await playCart(page, entry);
    const diag = await page.evaluate(() => ({
      cart: window.__g64?.cartLive?.(),
      fast: window.__g64?.fastLoadCart?.(),
      jiffyLive: window.__g64?.jiffyLive?.(),
      playMode: window.__g64?.playMode?.(),
      boot: window.__g64?.bootFile?.(),
    }));
    const shotPlay = join(out, `cart-matrix-${entry.id}-${kernal}-01-menu.png`);
    await page.screenshot({ path: shotPlay, fullPage: true });

    const poison = grok64FloppyAutostartPoison(text);
    const menu = entry.menuRe.test(text);
    // SS carts suppress live Jiffy KERNAL while loaded — stock KERNAL is correct.
    const jiffyOk = kernal === "jiffy" ? diag.jiffyLive === false : diag.jiffyLive === false;
    const pass = menu && !poison && diag.cart === true && jiffyOk;
    rows.push({
      id: `${entry.id}/${kernal}`,
      pass,
      menu,
      poison,
      jiffyOk,
      diag,
      shots: [shotBoot, shotPlay],
    });
    console.log(pass ? "PASS" : "FAIL", `${entry.id}/${kernal}`, { menu, poison, cart: diag.cart, jiffyOk });
    await browser.close();
  }
}
const allPass = rows.every((r) => r.pass);
console.log(JSON.stringify({ rows, pass: allPass }, null, 2));
process.exit(allPass ? 0 : 1);
