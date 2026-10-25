import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { digitalJoyPlayer } = await server.ssrLoadModule("/src/lib/emu/host.ts");
const { viceExpandOptions } = await server.ssrLoadModule("/src/lib/emu/expand.ts");
const { useEmu } = await server.ssrLoadModule("/src/lib/emu/store.ts");
await server.close();

test("1351 on the selected port leaves the digital stick on the other libretro player", () => {
  assert.equal(digitalJoyPlayer(false), 0);
  assert.equal(digitalJoyPlayer(true), 1);
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
