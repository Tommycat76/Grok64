import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  isHostRightControlKey,
  isKeyboardJoyFireKey,
  shouldSwallowC64SpaceForWasdJoy,
  FIRE_KEY_CODE,
} = await server.ssrLoadModule("/src/lib/emu/keys.ts");
await server.close();

test("right control is fire (code or location)", () => {
  assert.equal(isHostRightControlKey(FIRE_KEY_CODE, 0), true);
  assert.equal(isHostRightControlKey("ControlLeft", 2), true);
  assert.equal(isHostRightControlKey("ControlLeft", 0), false);
});

test("Space is fire only when WASD joystick is on", () => {
  assert.equal(isKeyboardJoyFireKey("Space", { wasdIsJoy: true }), true);
  assert.equal(isKeyboardJoyFireKey("Space", { wasdIsJoy: false }), false);
  assert.equal(isKeyboardJoyFireKey(FIRE_KEY_CODE, { wasdIsJoy: false }), true);
});

test("WASD mode swallows C64 space", () => {
  assert.equal(shouldSwallowC64SpaceForWasdJoy("Space", " ", true), true);
  assert.equal(shouldSwallowC64SpaceForWasdJoy("Space", " ", false), false);
});
