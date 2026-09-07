import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "src/components/emu/Grok64App.tsx"), "utf8");
const host = readFileSync(join(root, "src/lib/emu/host.ts"), "utf8");
const keys = readFileSync(join(root, "src/lib/emu/keys.ts"), "utf8");
const paint = readFileSync(join(root, "src/lib/emu/ios-paint.ts"), "utf8");

test("play-unlock disarms Autostart without recycling the core", () => {
  assert.match(app, /disarmAutostart\(emuRef\.current\)/);
  assert.match(app, /glog\("play-unlock"/);
  assert.doesNotMatch(app, /kickAutostart/);
});

test("toolbar Reset cold-boots via resetReady; Space cannot click it", () => {
  const reset = app.slice(app.indexOf("g64-reset"), app.indexOf("g64-reset") + 900);
  assert.match(reset, /resetReady\(\)/);
  assert.match(reset, /e\.code === "Space"/);
  assert.match(reset, /tabIndex=\{-1\}/);
  assert.doesNotMatch(reset, /kickAutostart/);
  assert.doesNotMatch(reset, /autostartAfterReady/);
  assert.match(app, /glog\("user-reset-ready"/);
  assert.match(app, /syncJiffy\(emu, "hard"\)/);
  assert.match(app, /Reset — READY/);
});

test("#40 Paradroid cracktro nudge is kept (Space stays PETSCII, not Reset)", () => {
  assert.match(app, /scheduleCracktroNudge/);
  assert.match(app, /glog\("cracktro-nudge"/);
});

test("boot recover cannot yank a floppy session back to BASIC READY", () => {
  assert.match(app, /shouldRecoverBoot/);
  assert.match(app, /boot-recover-skipped/);
  assert.match(app, /boot-stuck-skipped/);
  assert.match(app, /boot-recover-fail-kept/);
  assert.match(app, /boot-stuck-kept/);
});

test("disarmAutostart does not call resetEmu / recycleCore", () => {
  const fn = host.slice(host.indexOf("export function disarmAutostart"), host.indexOf("function removeMediaFile"));
  assert.match(fn, /PLAY_UNLOCK_VICE_OPTS/);
  assert.doesNotMatch(fn, /resetEmu\(/);
  assert.doesNotMatch(fn, /recycleCore\(/);
});

test("C64 Space is not dispatched to window (HTML Reset activation)", () => {
  assert.match(keys, /KEY_BROADCAST_WINDOW = false/);
  assert.doesNotMatch(keys, /window\.dispatchEvent\(make\(\)\)/);
  assert.doesNotMatch(keys, /document\.dispatchEvent\(make\(\)\)/);
  assert.match(keys, /parent\?\.dispatchEvent\(make\(\)\)/);
});

test("iOS CRT path does not recycle or Autostart", () => {
  assert.match(paint, /WATCHDOG_RECYCLES_CORE = false/);
  assert.match(paint, /presentIosCrt/);
  assert.doesNotMatch(paint, /recycleCore\(/);
  assert.doesNotMatch(paint, /hardReset\(/);
  assert.doesNotMatch(paint, /autostartAfterReady\(/);
  assert.doesNotMatch(paint, /ios-paint-poll/);
});

test("iOS WebGL backing is locked to 384x272 before the first context", () => {
  assert.match(host, /this\.width = 384/);
  assert.match(host, /this\.height = 272/);
  assert.match(host, /lockIosBacking/);
  assert.match(host, /remapViceViewport/);
  const patched = host.slice(host.indexOf("function preserveWebglBuffer"), host.indexOf("type GuardedGm"));
  assert.doesNotMatch(patched, /width", "384px"/);
  assert.doesNotMatch(patched, /height", "272px"/);
  assert.ok(
    patched.indexOf("this.width = 384") < patched.indexOf("orig.call(this, type, merged)"),
    "native backing must be set before getContext (CSS 384px lock is #50/#52)",
  );
  assert.doesNotMatch(patched, /lockIosClientBox\(this,\s*384,\s*272\)/);
});

test("iPhone CRT is restored ee0b445 glass, not zoom/slot or 2D present", () => {
  assert.match(host, /applyIosCrtStyle/);
  assert.match(host, /g64-ios-fb/);
  assert.match(host, /unwrapIosZoomChrome/);
  assert.match(host, /style\.width = "100%"/);
  assert.doesNotMatch(host, /layoutIosCrtHost/);
  assert.doesNotMatch(host, /letterboxNativeCss/);
  assert.doesNotMatch(host, /ensureIosZoomHost/);
  assert.doesNotMatch(host, /applyIosZoomHost/);
  assert.match(host, /stripIosPresent/);
  assert.match(host, /#grok64-player/);
  assert.match(host, /remapViceViewport/);
  assert.doesNotMatch(host, /fillBezelCss/);
  assert.doesNotMatch(host, /translate3d\(0,0,0\) scale\(/);
  assert.doesNotMatch(host, /klass === "g64-ios-fb" \? Math.max\(1, window.devicePixelRatio/);
  assert.doesNotMatch(host, /sw \* dpr/);
  const present = readFileSync(join(root, "src/lib/emu/ios-present.ts"), "utf8");
  const presentCode = present.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(presentCode, /readPixels/);
  assert.doesNotMatch(presentCode, /dest\.width = sw/);
  assert.match(host, /IOS_CRT_KNOWN_FAILURES/);
});

test("iPhone floppy Play still recycles — never hot-swap (locked)", () => {
  const session = readFileSync(join(root, "src/lib/emu/play-session.ts"), "utf8");
  assert.match(session, /if \(extra\?\.iosPhone\) return true/);
});
