/**
 * Headless routing: Byte Hopper (dual-stick) vs GEOS (mouse-port joystick override).
 * GROK64_BASE_URL=http://127.0.0.1:8082/ node scripts/dual-stick-routing-probe.mjs
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.GROK64_BASE_URL || "http://127.0.0.1:8082/";

async function boot(page) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 30000 });
  await page.evaluate(() => window.__g64.power());
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => window.__g64?.hasFs?.() && window.__g64?.running?.())) break;
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    window.__g64.setJoyPort?.(1);
    window.__g64.setMouseMode?.(true);
  });
  await page.waitForTimeout(400);
}

async function waitPlayIdle(page) {
  for (let i = 0; i < 120; i++) {
    const ready = await page.evaluate(() => {
      const booting = window.__g64.booting?.();
      const lock = window.__g64.playLock?.();
      return !booting && !lock;
    });
    if (ready) break;
    await page.waitForTimeout(500);
  }
}

async function holdStickRight(page) {
  await page.evaluate(() => {
    window.__g64.holdStick?.(true);
    window.__g64.stick?.(1, 0);
  });
  for (let f = 0; f < 40; f++) await page.waitForTimeout(16);
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await boot(page);

  await page.evaluate(() => window.__g64.load("/software/byte-hopper.prg", "byte-hopper.prg"));
  await waitPlayIdle(page);
  await holdStickRight(page);
  const hopper = await page.evaluate(() => window.__g64.inputRouting?.());
  assert.equal(hopper.mouseDual, true, "Byte Hopper: dual-stick stays on");
  assert.equal(hopper.geosStickOverride, false, "Byte Hopper: no GEOS port override");
  assert.equal(hopper.stickPort, 2);
  console.log("byte-hopper routing:", hopper);

  await page.evaluate(() => {
    window.__g64.holdStick?.(false);
    window.__g64.stick?.(0, 0);
    window.__g64.primeGeosDeskSessionForQa?.();
  });
  await page.waitForTimeout(200);
  await holdStickRight(page);
  const geosHeld = await page.evaluate(() => window.__g64.inputRouting?.());
  assert.equal(geosHeld.geosStickOverride, true, "GEOS disk: override while stick held");
  assert.equal(geosHeld.mouseDual, false);
  assert.equal(geosHeld.stickPort, 1);
  console.log("geos routing (held):", geosHeld);

  await page.evaluate(() => {
    window.__g64.holdStick?.(false);
    window.__g64.stick?.(0, 0);
  });
  for (let f = 0; f < 30; f++) await page.waitForTimeout(16);
  const geosReleased = await page.evaluate(() => window.__g64.inputRouting?.());
  assert.equal(geosReleased.geosStickOverride, false, "GEOS disk: override off when stick released");
  assert.equal(geosReleased.mouseDual, true, "1351 dual-stick restored");
  console.log("geos routing (released):", geosReleased);

  console.log("dual-stick-routing-probe: OK");
} finally {
  await page.evaluate(() => window.__g64?.holdStick?.(false));
  await browser.close();
}
