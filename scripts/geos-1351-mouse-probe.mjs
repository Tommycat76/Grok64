/**
 * GEOS COMM 1351: touch stick must not latch joystick override; real mouse moves ZP mouse pos.
 * GROK64_BASE_URL=http://127.0.0.1:8082/ node scripts/geos-1351-mouse-probe.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const url = process.env.GROK64_BASE_URL || "http://127.0.0.1:8082/";
const geosPath = join(process.cwd(), "fixtures", "geos", "GEOS64_2.0.d64");

if (!existsSync(geosPath)) {
  console.log("SKIP geos-1351-mouse-probe — fixtures/geos/GEOS64_2.0.d64 missing");
  process.exit(0);
}

const geosBytes = [...readFileSync(geosPath)];

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

async function geosMousePos(page) {
  return page.evaluate(() => window.__g64.geosMousePos?.() ?? null);
}

async function routing(page) {
  return page.evaluate(() => window.__g64.inputRouting?.());
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await boot(page);
  const bootOk = await page.evaluate(
    async ({ name, bytes }) => Boolean(await window.__g64?.bootGeos?.(name, bytes)),
    { name: "GEOS64_2.0.d64", bytes: geosBytes },
  );
  assert.equal(bootOk, true, "bootGeos");
  for (let i = 0; i < 120; i++) {
    const r = await routing(page);
    if (r?.geosPortStickAllowed) break;
    await page.waitForTimeout(1000);
  }

  await page.evaluate(() => {
    window.__g64.holdStick?.(true);
    window.__g64.stick?.(1, 0);
  });
  for (let f = 0; f < 30; f++) await page.waitForTimeout(16);
  const duringStick = await routing(page);
  assert.equal(duringStick.geosStickOverride, true, "override while touch stick held");

  await page.evaluate(() => {
    window.__g64.holdStick?.(false);
    window.__g64.stick?.(0, 0);
  });
  for (let f = 0; f < 30; f++) await page.waitForTimeout(16);
  const afterStick = await routing(page);
  assert.equal(afterStick.geosStickOverride, false, "override off after stick release");
  assert.equal(afterStick.mouseDual, true, "1351 restored on mouse port");

  const p0 = await geosMousePos(page);
  assert.ok(p0, "geosMousePos readable");

  const deltas = [
    { dx: 24, dy: 0, expect: (a, b) => b.x > a.x },
    { dx: 0, dy: 20, expect: (a, b) => b.y > a.y },
    { dx: -24, dy: 0, expect: (a, b) => b.x < a.x },
    { dx: 0, dy: -20, expect: (a, b) => b.y < a.y },
  ];
  let prev = p0;
  for (const { dx, dy, expect } of deltas) {
    await page.evaluate(
      ({ dx, dy }) => {
        window.__g64.releaseGeosPortStickOverride?.();
        window.__g64.addMouseDelta?.(dx, dy);
      },
      { dx, dy },
    );
    for (let f = 0; f < 40; f++) await page.waitForTimeout(16);
    const r = await routing(page);
    assert.equal(r.geosStickOverride, false, `no override during mouse delta ${dx},${dy}`);
    const next = await geosMousePos(page);
    assert.ok(next, "geosMousePos after move");
    assert.ok(expect(prev, next), `mouse move ${dx},${dy} prev=${JSON.stringify(prev)} next=${JSON.stringify(next)}`);
    prev = next;
  }

  await page.evaluate(() => {
    window.__g64.setMouseButtons?.(true, false);
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__g64.setMouseButtons?.(false, false));
  const afterClick = await routing(page);
  assert.equal(afterClick.geosStickOverride, false, "override off after click");

  console.log("geos-1351-mouse-probe: OK");
} finally {
  await page.evaluate(() => window.__g64?.holdStick?.(false));
  await browser.close();
}
