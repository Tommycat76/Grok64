import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function measureTabletContainSize(availW, availH) {
  if (!(availW >= 8) || !(availH >= 8)) return null;
  const w = Math.round(Math.min(availW, (availH * 384) / 272));
  const h = Math.round((w * 272) / 384);
  return { w, h };
}

test("contain-fit is width-limited on a tall portrait bezel", () => {
  const size = measureTabletContainSize(768, 1000);
  assert.deepEqual(size, { w: 768, h: Math.round((768 * 272) / 384) });
});

test("contain-fit is height-limited under a short keyboard bezel", () => {
  const size = measureTabletContainSize(768, 400);
  assert.equal(size.w, Math.round((400 * 384) / 272));
  assert.equal(size.h, Math.round((size.w * 272) / 384));
});

test("unlaid-out bezel does not emit a stamp size", () => {
  assert.equal(measureTabletContainSize(0, 800), null);
  assert.equal(measureTabletContainSize(800, 0), null);
  assert.equal(measureTabletContainSize(4, 4), null);
});

test("tablet-fit.ts drops the #64 width var and does not write a stamp", () => {
  const src = readFileSync(join(root, "src/lib/emu/tablet-fit.ts"), "utf8");
  assert.match(src, /export function measureTabletContainSize/);
  assert.match(src, /export function applyTabletContainFit/);
  assert.match(src, /removeProperty\("--g64-tablet-crt-w"\)/);
  assert.match(src, /removeProperty\("width"\)/);
  assert.match(src, /detectDevice\(\) !== "tablet"/);
  assert.doesNotMatch(src, /setProperty\("--g64-tablet-crt-w"/);
});

test("tablet CSS is out-of-flow contain-fit, not #64 measured-width", () => {
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  const app = readFileSync(join(root, "src/components/emu/Grok64App.tsx"), "utf8");
  const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
  const paint = readFileSync(join(root, "src/lib/emu/ios-paint.ts"), "utf8");
  const present = readFileSync(join(root, "src/lib/emu/ios-present.ts"), "utf8");
  const tab = css.indexOf('.g64-app[data-device="tablet"] .g64-screen {');
  assert.ok(tab >= 0);
  const tabletScreen = css.slice(tab, css.indexOf("}", tab) + 1);
  assert.match(tabletScreen, /position: absolute/);
  assert.match(tabletScreen, /aspect-ratio: 384 \/ 272/);
  assert.match(tabletScreen, /translateY\(-50%\)/);
  assert.match(tabletScreen, /max-height: calc\(100% - 24px\)/);
  assert.match(tabletScreen, /bottom: auto/);
  assert.doesNotMatch(tabletScreen, /--g64-tablet-crt-w/);
  assert.doesNotMatch(tabletScreen, /100cqh/);
  assert.doesNotMatch(tabletScreen, /max\(320px/);
  assert.doesNotMatch(tabletScreen, /container-type: size/);
  const bezelIdx = css.indexOf(".g64-app[data-device=\"tablet\"] .g64-bezel {\n  /* #65:");
  assert.ok(bezelIdx >= 0, "tablet bezel #65 rule missing");
  const tabletBezel = css.slice(bezelIdx, css.indexOf("}", bezelIdx) + 1);
  assert.match(tabletBezel, /display: block/);
  assert.doesNotMatch(tabletBezel, /container-type: size/);
  assert.match(app, /applyTabletContainFit/);
  const phoneIdx = css.indexOf('html[data-g64os="ios"] .g64-app[data-device="phone"] .g64-screen {');
  assert.ok(phoneIdx >= 0);
  const phoneScreen = css.slice(phoneIdx, css.indexOf("}", phoneIdx) + 1);
  assert.match(phoneScreen, /aspect-ratio: 384 \/ 272/);
  assert.doesNotMatch(phoneScreen, /--g64-tablet-crt-w/);
  assert.doesNotMatch(phoneScreen, /position: absolute/);
  assert.match(host, /preserveDrawingBuffer/);
  assert.match(host, /applyIosCrtStyle/);
  assert.match(paint, /IOS_CRT_KNOWN_FAILURES/);
  assert.match(present, /IOS_CRT_KNOWN_FAILURES/);
});
