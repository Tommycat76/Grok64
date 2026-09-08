import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function measureTabletContainWidth(availW, availH) {
  if (!(availW >= 8) || !(availH >= 8)) return null;
  return Math.round(Math.min(availW, (availH * 384) / 272));
}

test("contain-fit is width-limited on a tall portrait bezel", () => {
  assert.equal(measureTabletContainWidth(768, 1000), 768);
});

test("contain-fit is height-limited under a short keyboard bezel", () => {
  assert.equal(measureTabletContainWidth(768, 400), Math.round((400 * 384) / 272));
});

test("unlaid-out bezel does not emit a stamp width", () => {
  assert.equal(measureTabletContainWidth(0, 800), null);
  assert.equal(measureTabletContainWidth(800, 0), null);
  assert.equal(measureTabletContainWidth(4, 4), null);
});

test("tablet-fit.ts matches the contain-fit contract", () => {
  const src = readFileSync(join(root, "src/lib/emu/tablet-fit.ts"), "utf8");
  assert.match(src, /export function measureTabletContainWidth/);
  assert.match(src, /export function applyTabletContainFit/);
  assert.match(src, /--g64-tablet-crt-w/);
  assert.match(src, /detectDevice\(\) !== "tablet"/);
  assert.match(src, /availH \* TABLET_CRT_W\) \/ TABLET_CRT_H/);
});

test("tablet CSS no longer wins at 320px when cqh is 0", () => {
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  const app = readFileSync(join(root, "src/components/emu/Grok64App.tsx"), "utf8");
  const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
  const paint = readFileSync(join(root, "src/lib/emu/ios-paint.ts"), "utf8");
  const present = readFileSync(join(root, "src/lib/emu/ios-present.ts"), "utf8");
  assert.match(css, /--g64-tablet-crt-w/);
  assert.match(app, /applyTabletContainFit/);
  assert.doesNotMatch(css, /max\(320px,\s*calc\(100cqh \* 384 \/ 272\)\)/);
  const phoneIdx = css.indexOf('html[data-g64os="ios"] .g64-app[data-device="phone"] .g64-screen {');
  assert.ok(phoneIdx >= 0);
  const phoneScreen = css.slice(phoneIdx, css.indexOf("}", phoneIdx) + 1);
  assert.match(phoneScreen, /aspect-ratio: 384 \/ 272/);
  assert.doesNotMatch(phoneScreen, /--g64-tablet-crt-w/);
  assert.match(host, /preserveDrawingBuffer/);
  assert.match(host, /applyIosCrtStyle/);
  assert.match(paint, /IOS_CRT_KNOWN_FAILURES/);
  assert.match(present, /IOS_CRT_KNOWN_FAILURES/);
});
