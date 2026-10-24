#!/usr/bin/env node
/**
 * Tom P0: library CRT bytes must survive SS5 → FZ → Reset → OUT → AR6 → OUT → SS5.
 * Saves screenshots under /opt/cursor/artifacts/screenshots/tom-lib-integrity-*.png
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  patchLocalStorage,
  powerOnDesktop,
  waitRunning,
} from "./desktop-qa-lib.mjs";
import { cartFixturePath, CART_COMPAT_CATALOG } from "./cart-compat-catalog.mjs";

const base = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const out = "/opt/cursor/artifacts/screenshots";
mkdirSync(out, { recursive: true });

const ss5Entry = CART_COMPAT_CATALOG.find((c) => c.id === "ss5");
const ar6Entry = CART_COMPAT_CATALOG.find((c) => c.id === "ar6");
const ss5Path = cartFixturePath(ss5Entry);
const ar6Path = cartFixturePath(ar6Entry);
const ss5Name = "Super_Snapshot_v5.00_1990_NTSC.crt";
const ar6Name = "Action_Replay_V6.0_6.0_1989_PAL.crt";
const ss5Bytes = readFileSync(ss5Path);
const ar6Bytes = readFileSync(ar6Path);

function snapByName(rows, re) {
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => re.test(r.name));
}

async function libraryCartRows(page) {
  return (
    await page.evaluate(async () => {
      const scan = await window.__g64?.scanLibraryCarts?.();
      return scan ?? [];
    })
  );
}

async function importBoth(page) {
  await page.evaluate(
    async ({ ss5Name, ss5Bytes, ar6Name, ar6Bytes }) => {
      await window.__g64?.importLibraryBytes?.(ss5Name, [...ss5Bytes]);
      await window.__g64?.importLibraryBytes?.(ar6Name, [...ar6Bytes]);
    },
    { ss5Name, ss5Bytes: [...ss5Bytes], ar6Name, ar6Bytes: [...ar6Bytes] },
  );
}

async function playCart(page, displayName) {
  await page.evaluate(async (name) => {
    if (window.__g64?.playLibraryByName) {
      await window.__g64.playLibraryByName(name);
      return;
    }
    await window.__g64?.openSoftware?.();
    await new Promise((r) => setTimeout(r, 500));
    document.querySelectorAll("button").forEach((b) => {
      if (/On this device/i.test(b.textContent || "")) b.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    const card = [...document.querySelectorAll(".g64-card")].find((el) =>
      el.textContent?.includes(name.slice(0, 20)),
    );
    card?.querySelector('button[aria-label^="Play"]')?.click();
  }, displayName);
  await waitRunning(page, 180_000);
  await page.waitForTimeout(4000);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
await patchLocalStorage(page, { jiffy: true, video: "ntsc" });
await page.reload({ waitUntil: "domcontentloaded" });
await powerOnDesktop(page, base, { navigate: false }).catch(async () => {
  await page.evaluate(() => window.__g64?.power?.());
});
await waitRunning(page, 120_000);

await importBoth(page);
await page.waitForTimeout(1500);
let baseline = await libraryCartRows(page);
await page.screenshot({ path: join(out, "tom-lib-integrity-00-imported.png"), fullPage: true });

let baseSs5 = snapByName(baseline, /Super_Snapshot/i);
let baseAr6 = snapByName(baseline, /Action_Replay/i);

await playCart(page, ss5Name);
await page.screenshot({ path: join(out, "tom-lib-integrity-01-ss5-play.png"), fullPage: true });

await page.evaluate(() => window.__g64?.hwPress?.("cart-fz", "short"));
await page.waitForTimeout(3000);
await page.screenshot({ path: join(out, "tom-lib-integrity-02-cart-fz.png"), fullPage: true });

await page.evaluate(() => window.__g64?.resetReady?.());
await waitRunning(page, 90_000);
await page.waitForTimeout(8000);
await page.screenshot({ path: join(out, "tom-lib-integrity-03-reset.png"), fullPage: true });

await page.evaluate(() => window.__g64?.hwPress?.("cart-out", "short"));
await waitRunning(page, 120_000);
await page.waitForTimeout(6000);
await page.screenshot({ path: join(out, "tom-lib-integrity-04-cart-out.png"), fullPage: true });

await playCart(page, ar6Name);
await page.screenshot({ path: join(out, "tom-lib-integrity-05-ar6-play.png"), fullPage: true });

await page.evaluate(() => window.__g64?.hwPress?.("cart-out", "short"));
await waitRunning(page, 120_000);
await page.waitForTimeout(6000);

await playCart(page, ss5Name);
await page.screenshot({ path: join(out, "tom-lib-integrity-06-ss5-second.png"), fullPage: true });

const after = await libraryCartRows(page);
await page.screenshot({ path: join(out, "tom-lib-integrity-07-final.png"), fullPage: true });

const afterSs5 = snapByName(after, /Super_Snapshot/i);
const afterAr6 = snapByName(after, /Action_Replay/i);

const report = {
  baseline: { ss5: baseSs5, ar6: baseAr6 },
  after: { ss5: afterSs5, ar6: afterAr6 },
  pass:
    baseSs5?.payloadBytes === afterSs5?.payloadBytes &&
    baseAr6?.payloadBytes === afterAr6?.payloadBytes &&
    baseSs5?.payloadBytes === ss5Bytes.byteLength &&
    baseAr6?.payloadBytes === ar6Bytes.byteLength &&
    afterSs5?.ok === true &&
    afterAr6?.ok === true &&
    afterSs5?.payloadBytes !== 174848 &&
    afterAr6?.payloadBytes !== 174848,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.pass ? 0 : 1);
