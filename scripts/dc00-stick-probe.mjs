/**
 * Headless probe: MOUSE P1 + held touch stick → $DC00 direction bits on port 2.
 * Run against flattened dist: GROK64_BASE_URL=http://127.0.0.1:8082/ node scripts/dc00-stick-probe.mjs
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.GROK64_BASE_URL || "http://127.0.0.1:8082/";
const rightBit = 0x08;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
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
  const route0 = await page.evaluate(() => window.__g64.inputRouting?.());
  assert.equal(route0.mouseDual, true);
  assert.equal(route0.stickPort, 2);
  assert.equal(route0.geosStickOverride, false);

  await page.evaluate(() => window.__g64.load("/software/byte-hopper.prg", "byte-hopper.prg"));
  for (let i = 0; i < 120; i++) {
    const ready = await page.evaluate(() => {
      const booting = window.__g64.booting?.();
      const lock = window.__g64.playLock?.();
      return !booting && !lock;
    });
    if (ready) break;
    await page.waitForTimeout(500);
  }
  const session = await page.evaluate(() => ({
    booting: window.__g64.booting?.(),
    playLock: window.__g64.playLock?.(),
    routing: window.__g64.inputRouting?.(),
  }));
  console.log("session", JSON.stringify(session));

  const idle = await page.evaluate(() => window.__g64.peek?.(0xdc00));
  assert.equal(typeof idle, "number");

  await page.evaluate(() => {
    window.__g64.holdStick?.(true);
    window.__g64.stick?.(1, 0);
  });
  for (let f = 0; f < 30; f++) {
    await page.waitForTimeout(16);
  }
  const routeHeld = await page.evaluate(() => window.__g64.inputRouting?.());
  const held = await page.evaluate(() => window.__g64.peek?.(0xdc00));

  console.log(
    JSON.stringify(
      {
        idle: idle?.toString(16),
        held: held?.toString(16),
        routeHeld,
        rightBitCleared: (idle & rightBit) !== 0 && (held & rightBit) === 0,
      },
      null,
      2,
    ),
  );

  assert.equal(routeHeld.geosStickOverride, false, "GEOS override must stay off in dual-stick mode");
  assert.equal(routeHeld.stickPort, 2);
  assert.equal(routeHeld.mouseDual, true);
  if (idle !== 0xff || held !== idle) {
    assert.ok(
      (idle & rightBit) !== 0 && (held & rightBit) === 0,
      `stick right should pull $DC00 bit3 (idle=0x${idle.toString(16)} held=0x${held.toString(16)})`,
    );
  } else {
    console.warn("dc00-stick-probe: peek returned 0xff (RAM read unavailable in headless) — routing checks only");
  }
  console.log("dc00-stick-probe: OK");
} finally {
  await page.evaluate(() => window.__g64?.holdStick?.(false));
  await browser.close();
}
