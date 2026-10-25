import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  digitalJoyPlayer,
  feedVice1351Move,
  feedVice1351Buttons,
  feedVice1351Plug,
  vice1351Direct,
} = await server.ssrLoadModule("/src/lib/emu/host.ts");
const { viceExpandOptions } = await server.ssrLoadModule("/src/lib/emu/expand.ts");
const { useEmu } = await server.ssrLoadModule("/src/lib/emu/store.ts");
await server.close();

test("1351 on the selected port leaves the digital stick on the other libretro player", () => {
  assert.equal(digitalJoyPlayer(false), 0);
  assert.equal(digitalJoyPlayer(true), 1);
});

test("1351 host helpers are the VICE mouse_move path, not analog-only", () => {
  assert.equal(typeof feedVice1351Move, "function");
  assert.equal(typeof feedVice1351Buttons, "function");
  assert.equal(typeof feedVice1351Plug, "function");
  assert.equal(typeof vice1351Direct, "function");
  assert.equal(feedVice1351Move(null, 4, -3), false);
  assert.equal(feedVice1351Buttons(null, true, false), false);
  assert.equal(feedVice1351Plug(null, 1, true), -99);
  assert.equal(vice1351Direct(null), false);
});

test("mouse extras put a 1351 on the chosen port; the core keeps a joystick on the other", () => {
  const p2 = viceExpandOptions({
    reu: "none",
    iec: "1541",
    mouse: true,
    joyPort: 2,
    scpu: false,
  });
  assert.equal(p2.vice_joyport, "2");
  assert.equal(p2.vice_joyport_type, "3");
  assert.equal(p2.vice_analogmouse, "left");
  assert.equal(p2.vice_analogmouse_deadzone, "0");
  assert.equal(p2.vice_dpadmouse_speed, "6");
  const p1 = viceExpandOptions({
    reu: "none",
    iec: "1541",
    mouse: true,
    joyPort: 1,
    scpu: false,
  });
  assert.equal(p1.vice_joyport, "1");
  assert.equal(p1.vice_joyport_type, "3");
  assert.equal(p1.vice_analogmouse_deadzone, "0");
});

test("keyboard joystick is off unless the user turns it on", () => {
  assert.equal(useEmu.getState().wasdIsJoy, false);
});
