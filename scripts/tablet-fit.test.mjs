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

function tabletGlassFillsBezel(screenW, screenH, availW, availH, cover = 0.85) {
  const targetW = measureTabletContainWidth(availW, availH);
  if (targetW == null) return false;
  const targetH = Math.round((targetW * 272) / 384);
  return screenW >= targetW * cover && screenH >= targetH * cover && screenW >= 400 && screenH >= 220;
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

test("#64 280px boot-wait is still a stamp on Onn", () => {
  assert.equal(tabletGlassFillsBezel(280, 198, 1200, 700), false);
  assert.equal(tabletGlassFillsBezel(384, 272, 1200, 700), false);
  assert.equal(tabletGlassFillsBezel(988, 700, 1200, 700), true);
  assert.equal(tabletGlassFillsBezel(768, 544, 768, 1000), true);
});

test("tablet-fit.ts does not write a measured stamp width", () => {
  const src = readFileSync(join(root, "src/lib/emu/tablet-fit.ts"), "utf8");
  assert.match(src, /export function measureTabletContainWidth/);
  assert.match(src, /export function applyTabletContainFit/);
  assert.match(src, /export function tabletGlassFillsBezel/);
  assert.match(src, /removeProperty\("--g64-tablet-crt-w"\)/);
  assert.doesNotMatch(src, /setProperty\("--g64-tablet-crt-w"/);
  assert.match(src, /detectDevice\(\) !== "tablet"/);
});

test("tablet CSS is absolute contain-fit — no cqh / 320 / measured width", () => {
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  const app = readFileSync(join(root, "src/components/emu/Grok64App.tsx"), "utf8");
  const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
  const paint = readFileSync(join(root, "src/lib/emu/ios-paint.ts"), "utf8");
  const present = readFileSync(join(root, "src/lib/emu/ios-present.ts"), "utf8");
  const tab = css.indexOf('.g64-app[data-device="tablet"] .g64-screen {');
  const tabletScreen = css.slice(tab, tab + 720);
  const bezelIdx = css.lastIndexOf('.g64-app[data-device="tablet"] .g64-bezel {');
  const tabletBezel = css.slice(bezelIdx, css.indexOf("}", bezelIdx) + 1);
  assert.match(tabletScreen, /width: 100%/);
  assert.match(tabletScreen, /height: 100%/);
  assert.match(tabletBezel, /aspect-ratio: 384 \/ 272/);
  assert.match(tabletBezel, /position: absolute/);
  assert.doesNotMatch(tabletScreen, /--g64-tablet-crt-w/);
  assert.doesNotMatch(tabletScreen, /100cqh/);
  assert.doesNotMatch(tabletScreen, /max\(320px/);
  const tabletBezelCode = tabletBezel.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(tabletBezelCode, /container-type:\s*size/);
  assert.match(app, /applyTabletContainFit/);
  assert.match(app, /tabletGlassFillsBezel/);
  assert.doesNotMatch(app, /sw >= 280/);
  const phoneIdx = css.indexOf('html[data-g64os="ios"] .g64-app[data-device="phone"] .g64-screen {');
  assert.ok(phoneIdx >= 0);
  const phoneScreen = css.slice(phoneIdx, css.indexOf("}", phoneIdx) + 1);
  assert.match(phoneScreen, /aspect-ratio: 384 \/ 272/);
  assert.doesNotMatch(phoneScreen, /--g64-tablet-crt-w/);
  assert.doesNotMatch(phoneScreen, /inset: 14px/);
  assert.match(host, /preserveDrawingBuffer/);
  assert.match(host, /applyIosCrtStyle/);
  assert.match(host, /applyTabletCrtStyle/);
  assert.doesNotMatch(
    host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
    /scale\(\$\{sx\}/,
  );
  assert.match(paint, /IOS_CRT_KNOWN_FAILURES/);
  assert.match(present, /IOS_CRT_KNOWN_FAILURES/);
});

test("tablet canvas fills the glass — no 384px + scale stamp", () => {
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  const fb = css.indexOf(".g64-app[data-device=\"tablet\"] .g64-screen canvas.g64-tablet-fb");
  assert.ok(fb >= 0);
  const rule = css.slice(fb, css.indexOf("}", fb) + 1);
  assert.match(rule, /width: 100% !important/);
  assert.match(rule, /height: 100% !important/);
  assert.match(rule, /transform: none !important/);
  assert.doesNotMatch(rule, /width: 384px/);
});
