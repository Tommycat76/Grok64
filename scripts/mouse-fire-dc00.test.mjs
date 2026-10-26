/**
 * MOUSE on P1: libretro stick routes to CIA port 2; optional $DC00 peek when GROK64_DC00_FIRE=1.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { libretroStickJoyPort } = await server.ssrLoadModule("/src/lib/emu/host.ts");
await server.close();

test("libretro stick CIA port is opposite the 1351 mouse port", () => {
  assert.equal(libretroStickJoyPort(true, 1), 2);
  assert.equal(libretroStickJoyPort(true, 2), 1);
  assert.equal(libretroStickJoyPort(false, 2), 2);
});

const url = process.env.GROK64_BASE_URL || "http://127.0.0.1:8080/";
const skipBrowser = process.env.GROK64_SKIP_BROWSER === "1";
const dc00Probe = process.env.GROK64_DC00_FIRE === "1";

test("MOUSE P1: inputRouting exposes stick on port 2", { skip: skipBrowser }, async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 20000 });
    await page.evaluate(() => window.__g64.power());
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(() => window.__g64?.hasFs?.() && window.__g64?.running?.())) break;
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => {
      window.__g64.setJoyPort?.(1);
      window.__g64.setMouseMode?.(true);
    });
    await page.waitForTimeout(300);
    const route = await page.evaluate(() => window.__g64.inputRouting?.());
    assert.equal(route.mouse, true);
    assert.equal(route.savedPort, 1);
    assert.equal(route.stickPort, 2);
    assert.equal(route.digitalPlayer, 0);
    assert.equal(route.mouseDual, true);

    await page.evaluate(() => {
      window.__g64.holdStick?.(false);
      window.__g64.setJoy?.(0, 0, false);
    });
    await page.waitForTimeout(80);
    const idleStick = await page.evaluate(() => window.__g64.peek?.(0xdc00));
    await page.evaluate(() => {
      window.__g64.holdStick?.(true);
      window.__g64.stick?.(1, 0);
    });
    for (let f = 0; f < 20; f++) await page.waitForTimeout(16);
    const rightStick = await page.evaluate(() => window.__g64.peek?.(0xdc00));
    if (typeof idleStick === "number" && typeof rightStick === "number") {
      const rightBit = 0x08;
      assert.ok(
        (idleStick & rightBit) !== 0 && (rightStick & rightBit) === 0,
        `stick right should pull $DC00 bit3 (idle=0x${idleStick.toString(16)} held=0x${rightStick.toString(16)})`,
      );
    }
  } finally {
    await browser.close();
  }
});

test("MOUSE P1: FIRE pulls $DC00 port-2 fire bit", { skip: skipBrowser || !dc00Probe }, async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => typeof window.__g64?.power === "function", { timeout: 20000 });
    await page.evaluate(() => window.__g64.power());
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(() => window.__g64?.hasFs?.() && window.__g64?.running?.())) break;
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => {
      window.__g64.setJoyPort?.(1);
      window.__g64.setMouseMode?.(true);
    });
    await page.evaluate(() => window.__g64.load("/software/byte-hopper.prg", "byte-hopper.prg"));
    await page.waitForTimeout(6000);
    const idle = await page.evaluate(() => window.__g64.peek?.(0xdc00));
    assert.equal(typeof idle, "number");
    await page.evaluate(() => window.__g64.fire(true));
    await page.waitForTimeout(150);
    const held = await page.evaluate(() => window.__g64.peek?.(0xdc00));
    await page.evaluate(() => window.__g64.fire(false));
    const fireBit = 0x10;
    assert.ok((idle & fireBit) !== 0 && (held & fireBit) === 0, `dc00 idle=0x${idle.toString(16)} held=0x${held.toString(16)}`);
  } finally {
    await browser.close();
  }
});
