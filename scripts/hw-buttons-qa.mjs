#!/usr/bin/env node
/**
 * Hardware-button rail + short/long press hooks.
 * Does not claim CriOS PASS — box Playwright only.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] || "http://127.0.0.1:8080/";
mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const failed = [];
const four04 = [];
page.on("requestfailed", (req) => {
  four04.push(`${req.failure()?.errorText || "fail"} ${req.url()}`);
});
page.on("response", (res) => {
  if (res.status() === 404) four04.push(`404 ${res.url()}`);
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.locator(".g64-splash").waitFor({ timeout: 20000 });
await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 15000 });
await page.evaluate(() => window.__g64.power());

const readyT0 = Date.now();
while (Date.now() - readyT0 < 20000) {
  const powered = await page.evaluate(() => window.__g64?.powered?.());
  if (powered) break;
  await page.waitForTimeout(200);
}

await page.waitForFunction(() => window.__g64?.powered?.(), { timeout: 20000 });
await page.waitForTimeout(400);

const ids = await page.evaluate(() => {
  const chips = [...document.querySelectorAll("[data-hw]")].map((el) => el.getAttribute("data-hw"));
  return {
    chips,
    hwButtons: window.__g64?.hwButtons?.() ?? [],
    powered: window.__g64?.powered?.(),
  };
});

if (ids.chips.includes("cart-fz")) failed.push("CART FZ should be hidden until a cart is attached");
if (ids.chips.includes("sd-disk")) failed.push("SD FZ should be hidden until SD2IEC is on");
if (ids.chips.includes("sd-swap")) failed.push("SD 8/9 should be hidden until SD2IEC is on");
if (ids.chips.includes("cmd-swap")) failed.push("CMD SW should be hidden until CMD is attached");

await page.evaluate(() => window.__g64?.setIecSlot?.(8, "sd2iec"));
await page.waitForTimeout(200);
await page.evaluate(() => window.__g64?.setIecSlot?.(9, "cmdhd"));
await page.waitForTimeout(200);
await page.evaluate(() => window.__g64?.setCartLive?.(true));
await page.waitForTimeout(200);

const afterOn = await page.evaluate(() =>
  [...document.querySelectorAll("[data-hw]")].map((el) => el.getAttribute("data-hw")),
);
if (!afterOn.includes("sd-disk")) failed.push("SD FZ missing after SD2IEC on");
if (!afterOn.includes("sd-swap")) failed.push("SD 8/9 missing after SD2IEC on");
if (!afterOn.includes("cmd-swap")) failed.push("CMD SW missing after attaching CMD HD");
if (!afterOn.includes("cart-fz")) failed.push("CART FZ missing after cart attach");

await page.evaluate(() => window.__g64?.hwPress?.("cart-fz", "short"));
await page.evaluate(() => window.__g64?.hwPress?.("sd-swap", "short"));
const swap = await page.evaluate(() => ({
  cmd: window.__g64?.cmdSwapped?.(),
  unit: window.__g64?.userUnit?.(),
}));
await page.evaluate(() => window.__g64?.hwPress?.("cmd-swap", "short"));
const swapped = await page.evaluate(() => window.__g64?.cmdSwapped?.());
await page.evaluate(() => window.__g64?.hwPress?.("cmd-swap", "long"));
const restored = await page.evaluate(() => window.__g64?.cmdSwapped?.());
if (swapped !== true) failed.push(`CMD SWAP short did not flip (got ${swapped})`);
if (restored !== false) failed.push(`CMD SWAP hold did not restore (got ${restored})`);

const cart = page.locator('[data-hw="cart-fz"]');
await cart.scrollIntoViewIfNeeded();
await cart.evaluate((node) => {
  node.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, pointerId: 1 }));
});
await page.waitForTimeout(1100);
const long = await cart.getAttribute("data-long");
await cart.evaluate((node) => {
  node.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true, pointerId: 1 }));
});
if (long !== "true") failed.push(`CART FZ hold did not reach long state (data-long=${long})`);

const rail = page.locator(".g64-top");
await rail.screenshot({ path: "/workspace/screenshots/hw-buttons-rail.png" });
const chipBoxes = await page.evaluate(() =>
  [...document.querySelectorAll("[data-hw]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute("data-hw"), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
  }),
);
if (chipBoxes.some((b) => b.w < 8 || b.h < 8)) failed.push(`tiny chips ${JSON.stringify(chipBoxes)}`);
await page.screenshot({ path: "/workspace/screenshots/hw-buttons-phone.png", fullPage: false });

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      failed,
      ids,
      afterOn,
      swap,
      swapped,
      restored,
      chipBoxes,
      four04: four04.slice(0, 20),
    },
    null,
    2,
  ),
);
await browser.close();
process.exit(failed.length ? 1 : 0);
