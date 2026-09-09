import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Mirror of tablet-fit.ts: the glass fills the bezel, nothing is measured. */
function tabletGlassFillsBezel(screenW, screenH, availW, availH, cover = 0.85) {
  if (!(availW >= 480) || !(availH >= 300)) return false;
  return screenW >= availW * cover && screenH >= availH * cover;
}

test("#64 280px boot-wait is still a stamp on Onn", () => {
  assert.equal(tabletGlassFillsBezel(280, 198, 1200, 700), false);
  assert.equal(tabletGlassFillsBezel(384, 272, 1200, 700), false);
});

test("a glass that fills a laid-out bezel is ready", () => {
  assert.equal(tabletGlassFillsBezel(1172, 690, 1200, 700), true);
  assert.equal(tabletGlassFillsBezel(772, 572, 772, 572), true);
});

test("an unlaid-out bezel is never ready", () => {
  assert.equal(tabletGlassFillsBezel(0, 0, 0, 0), false);
  assert.equal(tabletGlassFillsBezel(384, 272, 384, 272), false);
  assert.equal(tabletGlassFillsBezel(10, 10, 10, 10), false);
});

test("tablet-fit.ts measures nothing and documents layout ownership", () => {
  const src = readFileSync(join(root, "src/lib/emu/tablet-fit.ts"), "utf8");
  assert.match(src, /export function applyTabletContainFit/);
  assert.match(src, /export function tabletGlassFillsBezel/);
  assert.match(src, /export function tabletBezelAvail/);
  assert.match(src, /removeProperty\("--g64-tablet-crt-w"\)/);
  assert.doesNotMatch(src, /setProperty\("--g64-tablet-crt-w"/);
  // No measured CRT width may come back (that was #64).
  assert.doesNotMatch(src, /measureTabletContainWidth/);
  assert.match(src, /VICE owns the drawing\n \* \*\*buffer\*\*|VICE owns the drawing/);
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
  // Bezel is the CRT frame, at the core's own 4:3 (same as desktop).
  assert.match(tabletBezel, /aspect-ratio: 4 \/ 3/);
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
  assert.match(paint, /IOS_CRT_KNOWN_FAILURES/);
  assert.match(present, /IOS_CRT_KNOWN_FAILURES/);
});

test("VICE owns the tablet drawing buffer — no #40 384x272 backing lock", () => {
  const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
  const code = host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const fit = code.slice(code.indexOf("export function fitEmu"), code.indexOf("const NATIVE_FB_PROPS"));
  // Root cause of the Onn stamp: shrinking the live backing to 384x272
  // after RetroArch sized its GL viewport to the glass.
  assert.doesNotMatch(fit, /bw\s*=\s*384/);
  assert.doesNotMatch(fit, /bh\s*=\s*272/);
  assert.match(fit, /backingLive/);
  assert.match(fit, /canResizeBacking\s*=\s*!\(iosPhone \|\| tablet\) \|\| !backingLive/);
  // iPhone #54 lock must still refuse a live resize.
  assert.match(fit, /iosPhone/);
  const style = code.slice(code.indexOf("export function applyTabletCrtStyle"));
  const body = style.slice(0, style.indexOf("\n}"));
  assert.doesNotMatch(body, /384px|272px/);
  assert.doesNotMatch(body, /scale\(/);
  assert.doesNotMatch(body, /transform/);
  assert.match(body, /clearNativeFbCrtStyle/);
  assert.match(body, /"100%"/);
});

test("tablet canvas fills the glass — legacy 384px + scale class is neutralized", () => {
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  const fb = css.indexOf(".g64-app[data-device=\"tablet\"] .g64-screen canvas.g64-tablet-fb");
  assert.ok(fb >= 0);
  const rule = css.slice(css.lastIndexOf("\n.g64-app", fb), css.indexOf("}", fb) + 1);
  assert.match(rule, /width: 100% !important/);
  assert.match(rule, /height: 100% !important/);
  assert.match(rule, /transform: none !important/);
  assert.doesNotMatch(rule, /width: 384px/);
});
