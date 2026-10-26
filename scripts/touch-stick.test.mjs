import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "src/components/emu/Grok64App.tsx"), "utf8");
const joy = readFileSync(join(root, "src/components/emu/Joystick.tsx"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const store = readFileSync(join(root, "src/lib/emu/store.ts"), "utf8");

test("FIRE and glass tap do not zero a held on-screen stick", () => {
  const fire = app.slice(app.indexOf("fire: (down) =>"), app.indexOf("stickDown:"));
  assert.match(fire, /joyRef\.current\.fire = down/);
  assert.doesNotMatch(fire, /joyRef\.current\.x = 0/);
  assert.match(app, /onFire\(true, false\)/);
  assert.match(app, /if \(down && clearStick && !stickDownRef\.current\)/);
});

test("a connected pad does not hide the on-screen stick", () => {
  assert.match(app, /const showStick = s\.powered && s\.showJoystick;/);
  assert.match(app, /const showMousePad = s\.powered && s\.mouseMode;/);
  assert.doesNotMatch(app, /showStick = s\.powered && s\.showJoystick && !padConnected/);
  assert.match(joy, /if \(stickHidden && !mouseMode\)/);
  assert.doesNotMatch(joy, /if \(padActive \|\| \(stickHidden && !mouseMode\)\)/);
  assert.match(app, /mergePadStick/);
});

test("phone 1351 dock stacks so the stick still fits, and landscape sits above the dock", () => {
  assert.match(css, /data-device="phone"\] \.g64-controls-mouse\[data-stick="true"\]/);
  assert.match(css, /grid-template-rows: auto auto/);
  assert.match(css, /bottom: calc\(60px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(css, /data-device="phone"\]:not\(\[data-kb="true"\]\) \.g64-dock/);
  assert.match(css, /\.g64-stick::before/);
  assert.match(css, /inset: -22px/);
});

test("keyboard joystick stays off unless the user turns it on", () => {
  assert.match(store, /wasdIsJoy: false/);
});
