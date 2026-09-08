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

test("iOS WebGL is the #14/#18/#39 host path (no #42 384 lock)", () => {
  const patched = host.slice(host.indexOf("function preserveWebglBuffer"), host.indexOf("type GuardedGm"));
  const patchedCode = patched.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const hostCode = host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(patched, /preserveDrawingBuffer/);
  assert.doesNotMatch(patchedCode, /this\.width = 384/);
  assert.doesNotMatch(patchedCode, /this\.height = 272/);
  assert.doesNotMatch(hostCode, /lockIosBacking/);
  assert.doesNotMatch(hostCode, /remapViceViewport/);
  assert.doesNotMatch(patchedCode, /width", "384px"/);
  assert.doesNotMatch(patchedCode, /height", "272px"/);
  assert.doesNotMatch(patchedCode, /lockIosClientBox/);
});

test("iPhone CRT is #14/#18 glass fill, not zoom/slot or 2D present", () => {
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
  const hostCode = host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(hostCode, /remapViceViewport/);
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

test("iOS Play after READY keeps the live canvas (#18/#30, not #37 WASM recycle)", () => {
  const session = readFileSync(join(root, "src/lib/emu/play-session.ts"), "utf8");
  assert.match(session, /iosPlayKeepsLiveCrt/);
  assert.match(session, /iosMustKeepLiveCore/);
  assert.match(session, /shouldDropToSplash/);
  assert.match(app, /keepLiveCrt/);
  assert.match(app, /mustKeep/);
  assert.match(app, /play-recycle-inplace/);
  assert.match(app, /start-recycle-refused/);
  assert.match(app, /play-inplace-no-fs/);
  const start = app.indexOf("const playBuffer");
  const play = app.slice(start, app.indexOf("playBufferRef.current = playBuffer"));
  assert.match(play, /keepLiveCrt/);
  assert.match(play, /mustKeep/);
  assert.match(play, /play-inplace-failed/);
  assert.match(play, /if \(canHotSwap\) \{/);
  assert.match(play, /play-recycle-inplace/);
});

test("Space is muted until Autostart is disarmed; cracktro nudge is after unlock", () => {
  assert.match(app, /muteC64Space\(true\)/);
  assert.match(app, /disarmAutostart\(emuRef\.current\)/);
  assert.match(app, /muteC64Space\(false\)/);
  assert.match(app, /scheduleCracktroNudge\(useEmu\.getState\(\)\.currentTitle\)/);
  const lock = app.slice(app.indexOf("const beginPlayLock"), app.indexOf("const syncJiffy"));
  assert.match(lock, /disarmAutostart/);
  assert.match(lock, /scheduleCracktroNudge/);
  const idxDisarm = lock.indexOf("disarmAutostart");
  const idxNudge = lock.indexOf("scheduleCracktroNudge");
  assert.ok(idxDisarm >= 0 && idxNudge > idxDisarm, "cracktro Space must follow disarm");
});

test("top rail uses horizontal space (CSS only — not CRT glass)", () => {
  const css = readFileSync(join(root, "src/styles.css"), "utf8");
  const top = css.slice(css.indexOf(".g64-top {"), css.indexOf(".g64-top h1"));
  const icons = css.slice(css.indexOf(".g64-top-icons {"), css.indexOf(".g64-chip-gate {"));
  assert.match(top, /width: calc\(100% - 16px\)/);
  assert.match(top, /justify-content: space-between/);
  assert.match(icons, /margin-left: auto/);
  assert.match(icons, /justify-content: flex-end/);
});

test("iOS mid-play persist and start-recycle stay locked to live play", () => {
  const session = readFileSync(join(root, "src/lib/emu/play-session.ts"), "utf8");
  assert.match(session, /shouldSkipPlayPersist/);
  assert.match(session, /shouldRefuseStartRecycle/);
  assert.match(session, /markLivePlay/);
  assert.match(session, /g64-live-play/);
  assert.match(app, /shouldSkipPlayPersist/);
  assert.match(app, /shouldRefuseStartRecycle/);
  assert.match(app, /markLivePlay/);
  assert.match(app, /clearLivePlay/);
  assert.match(app, /applyEmuVolume\(emuRef\.current/);
});

test("please-hold overlay is a DOM chip, not a CRT host change", () => {
  assert.match(app, /Please hold — picture is coming/);
  assert.match(app, /data-hold=/);
  assert.match(app, /setPictureHold/);
});
