import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const paintSrc = readFileSync(join(root, "src/lib/emu/ios-paint.ts"), "utf8");
const app = readFileSync(join(root, "src/components/emu/Grok64App.tsx"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  chooseIosCrtPath,
  frameLooksReady,
  resetIosPaintState,
  WATCHDOG_RECYCLES_CORE,
  CRT_RECYCLES_CORE,
  iosCrtPath,
  isIosMirrorActive,
  isIosMirrorPainted,
} = await server.ssrLoadModule("/src/lib/emu/ios-paint.ts");
await server.close();

test("chooseIosCrtPath is always live-webgl (PNG/gl-blit are gone)", () => {
  assert.equal(chooseIosCrtPath({ pngValid: true, glLooksReady: false }), "live-webgl");
  assert.equal(chooseIosCrtPath({ pngValid: false, glLooksReady: true }), "live-webgl");
  assert.equal(chooseIosCrtPath({ pngValid: false, glLooksReady: false }), "live-webgl");
  assert.equal(chooseIosCrtPath(), "live-webgl");
});

test("runtime CRT path never claims a 2D overlay", () => {
  resetIosPaintState();
  assert.equal(iosCrtPath(), "live-webgl");
  assert.equal(isIosMirrorActive(), false);
  assert.equal(isIosMirrorPainted(), false);
});

test("frameLooksReady still classifies BASIC READY-like metrics for QA", () => {
  assert.equal(frameLooksReady({ lum: 48, uniq: 6 }), true);
  assert.equal(frameLooksReady({ lum: 2, uniq: 1 }), false);
  assert.equal(frameLooksReady({ lum: 80, uniq: 80 }), false);
});

test("CRT presentation never recycles or Autostarts the core", () => {
  assert.equal(WATCHDOG_RECYCLES_CORE, false);
  assert.equal(CRT_RECYCLES_CORE, false);
  assert.doesNotMatch(paintSrc, /recycleCore\(/);
  assert.doesNotMatch(paintSrc, /hardReset\(/);
  assert.doesNotMatch(paintSrc, /autostartAfterReady\(/);
});

test("deleted PNG poll / empty-mirror architecture", () => {
  assert.doesNotMatch(paintSrc, /ios-paint-poll/);
  assert.doesNotMatch(paintSrc, /ios-mirror-skip/);
  assert.doesNotMatch(paintSrc, /readFsPng/);
  assert.doesNotMatch(paintSrc, /viceScreenshot/);
  assert.doesNotMatch(paintSrc, /ensureMirrorCanvas/);
  assert.doesNotMatch(paintSrc, /blitPngToMirror/);
  assert.doesNotMatch(paintSrc, /\.getContext\s*\(/);
  assert.match(paintSrc, /presentIosCrt/);
  assert.match(paintSrc, /stripIosOverlay/);
});

test("CSS never hides live WebGL behind a 2D overlay", () => {
  assert.match(css, /g64-ios-fb/);
  assert.match(css, /#grok64-player \.g64-ios-mirror/);
  assert.match(css, /#grok64-player > :not\(\.ejs_canvas_parent\):not\(canvas\)/);
  assert.doesNotMatch(
    css,
    /#grok64-player\.g64-ios-mirror-on canvas:not\(\.g64-ios-mirror\) \{\s*opacity: 0/,
  );
});

test("iOS GL canvas is a native 384×272 letterbox; leftover 2D present is hidden", () => {
  const iosCanvas = css.slice(css.indexOf("html[data-g64os=\"ios\"] #grok64-player canvas"));
  assert.match(iosCanvas, /width: 384px !important/);
  assert.match(iosCanvas, /height: 272px !important/);
  assert.match(iosCanvas, /transform: none !important/);
  assert.match(iosCanvas, /object-fit: contain !important/);
  assert.doesNotMatch(iosCanvas.slice(0, 900), /width: 100% !important/);
  assert.match(css, /canvas\.g64-ios-present/);
  assert.match(paintSrc, /applyIosCrtStyle/);
  assert.match(paintSrc, /letterbox/);
  assert.match(paintSrc, /IOS_CRT_KNOWN_FAILURES/);
});

test("iOS phone CRT screen fills the bezel without cqh self-size", () => {
  const idx = css.indexOf('html[data-g64os="ios"] .g64-app[data-device="phone"] .g64-screen');
  assert.ok(idx >= 0);
  const phoneScreen = css.slice(idx, idx + 500);
  assert.match(phoneScreen, /inset: 8px/);
  assert.doesNotMatch(phoneScreen, /100cqh/);
  assert.doesNotMatch(phoneScreen, /container-type/);
  assert.match(css, /\.g64-boot \{[\s\S]*?height: 100%/);
});

test("production UI shows build id; debug log is opt-in", () => {
  assert.match(app, /<BuildId/);
  assert.match(app, /s\.debugLog \|\| debugQueryOn\(\)/);
  assert.match(app, /className="g64-log"/);
  assert.doesNotMatch(
    app,
    /className="g64-log" aria-live="polite" hidden=\{\!s\.powered\}/,
  );
});
