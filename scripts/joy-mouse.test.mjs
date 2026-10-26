import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  digitalJoyPlayer,
  feedVice1351Move,
  feedVice1351Buttons,
  feedVice1351Plug,
  hostMouseDualStickActive,
  vice1351Direct,
  vicePortDeviceOptions,
  applySavedJoyAndMouse,
  setHostMousePortJoystickOverride,
} = await server.ssrLoadModule("/src/lib/emu/host.ts");
const { viceExpandOptions } = await server.ssrLoadModule("/src/lib/emu/expand.ts");
const { useEmu } = await server.ssrLoadModule("/src/lib/emu/store.ts");
await server.close();

test("1351 on the selected port routes libretro pad 0 to the opposite CIA port", () => {
  assert.equal(digitalJoyPlayer(false, 1), 0);
  assert.equal(digitalJoyPlayer(false, 2), 1);
  assert.equal(digitalJoyPlayer(true, 1), 0);
  assert.equal(digitalJoyPlayer(true, 2), 0);
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
  assert.equal(p2.vice_joyport, "1");
  assert.equal(p2.vice_joyport_type, "1");
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
  assert.equal(p1.vice_joyport, "2");
  assert.equal(p1.vice_joyport_type, "1");
  assert.equal(p1.vice_analogmouse_deadzone, "0");
});

test("keyboard joystick is off unless the user turns it on", () => {
  assert.equal(useEmu.getState().wasdIsJoy, false);
});

test("saved port keeps a 1351 when the mouse is on (cart load must not force joystick)", () => {
  setHostMousePortJoystickOverride(false);
  const on1 = vicePortDeviceOptions(1, true);
  assert.equal(on1.vice_joyport, "2");
  assert.equal(on1.vice_joyport_type, "1");
  const off2 = vicePortDeviceOptions(2, false);
  assert.equal(off2.vice_joyport, "2");
  assert.equal(off2.vice_joyport_type, "1");
});

test("opposite-port stick uses dual-stick routing while 1351 stays on the mouse port", () => {
  setHostMousePortJoystickOverride(false);
  applySavedJoyAndMouse(null, 1, true);
  assert.equal(hostMouseDualStickActive(), true);
  assert.equal(vicePortDeviceOptions(1, true).vice_joyport, "2");
  assert.equal(digitalJoyPlayer(true, 1), 0);
  setHostMousePortJoystickOverride(true);
  applySavedJoyAndMouse(null, 1, true);
  assert.equal(hostMouseDualStickActive(), false);
  assert.equal(vicePortDeviceOptions(1, true).vice_joyport, "1");
  setHostMousePortJoystickOverride(false);
  applySavedJoyAndMouse(null, 2, false);
  assert.equal(hostMouseDualStickActive(), false);
});

