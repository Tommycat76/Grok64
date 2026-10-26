/**
 * Prove GEOS desk session does not break Byte Hopper dual-stick (both orders).
 * GROK64_BASE_URL=http://127.0.0.1:8082/ node scripts/geos-hopper-order-probe.mjs
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

async function loadByteHopper(page) {
  await page.evaluate(() => window.__g64.load("/software/byte-hopper.prg", "byte-hopper.prg"));
  await waitPlayIdle(page);
}

async function holdStickRight(page) {
  await page.evaluate(() => {
    window.__g64.holdStick?.(true);
    window.__g64.stick?.(1, 0);
  });
  for (let f = 0; f < 40; f++) await page.waitForTimeout(16);
}

async function releaseStick(page) {
  await page.evaluate(() => {
    window.__g64.holdStick?.(false);
    window.__g64.stick?.(0, 0);
  });
  for (let f = 0; f < 30; f++) await page.waitForTimeout(16);
}

async function routing(page) {
  return page.evaluate(() => window.__g64.inputRouting?.());
}

function assertHopperDualStick(route, label) {
  assert.equal(route.geosStickOverride, false, `${label}: no GEOS override`);
  assert.equal(route.mouseDual, true, `${label}: dual-stick on`);
  assert.equal(route.stickPort, 2, `${label}: stick on port 2`);
  assert.equal(route.geosDeskSession, false, `${label}: GEOS desk session cleared`);
}

function assertGeosOverrideHeld(route, label) {
  assert.equal(route.geosStickOverride, true, `${label}: GEOS override while stick held`);
  assert.equal(route.geosDeskSession, true, `${label}: GEOS desk session latched`);
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await boot(page);

  // (a) GEOS desk session → real pointer cancels override → Run Byte Hopper
  await page.evaluate(() => window.__g64.primeGeosDeskSessionForQa?.());
  await holdStickRight(page);
  assertGeosOverrideHeld(await routing(page), "GEOS then hopper (during GEOS)");
  const screen = page.locator(".g64-screen");
  await screen.dispatchEvent("pointerdown", { button: 0, clientX: 400, clientY: 300 });
  await page.waitForTimeout(32);
  await screen.dispatchEvent("pointermove", { clientX: 408, clientY: 300 });
  await page.waitForTimeout(48);
  const afterPointer = await routing(page);
  assert.equal(afterPointer.geosStickOverride, false, "GEOS then hopper: pointer clears override");
  assert.equal(afterPointer.mouseDual, true, "GEOS then hopper: dual-stick after pointer");
  await releaseStick(page);
  await loadByteHopper(page);
  await holdStickRight(page);
  assertHopperDualStick(await routing(page), "GEOS then hopper (after Run)");
  await releaseStick(page);

  // (b) Byte Hopper → GEOS desk session
  await loadByteHopper(page);
  await holdStickRight(page);
  assertHopperDualStick(await routing(page), "hopper then GEOS (hopper only)");
  await releaseStick(page);

  await page.evaluate(() => window.__g64.primeGeosDeskSessionForQa?.());
  await holdStickRight(page);
  assertGeosOverrideHeld(await routing(page), "hopper then GEOS (during GEOS)");
  await releaseStick(page);
  const afterGeos = await routing(page);
  assert.equal(afterGeos.geosStickOverride, false, "hopper then GEOS: override off after release");
  assert.equal(afterGeos.mouseDual, true, "hopper then GEOS: 1351 restored");

  // Override flag stuck without geosStickJoyRef (prod desync after real GEOS)
  await page.evaluate(() => {
    window.__g64.primeGeosDeskSessionForQa?.();
    window.__g64.holdStick?.(true);
    window.__g64.stick?.(1, 0);
    window.__g64.releaseGeosPortStickOverride?.();
    window.__g64.holdStick?.(false);
    window.__g64.stick?.(0, 0);
  });
  await page.waitForTimeout(80);
  await loadByteHopper(page);
  await holdStickRight(page);
  assertHopperDualStick(await routing(page), "GEOS desync then hopper");
  await releaseStick(page);

  console.log("geos-hopper-order-probe: OK");
} finally {
  await page.evaluate(() => {
    window.__g64?.endGeosDeskSession?.();
    window.__g64?.holdStick?.(false);
  });
  await browser.close();
}
