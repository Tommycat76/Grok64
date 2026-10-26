import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  createJoyFireLatch,
  noteJoyFirePress,
  takeJoyFireHeld,
  MOUSE_1351_BUTTON_HOLD_FRAMES,
} = await server.ssrLoadModule("/src/lib/emu/mouse-1351.ts");
await server.close();

test("joy fire latch holds ~3 frames after a tap", () => {
  const latch = createJoyFireLatch();
  noteJoyFirePress(latch);
  for (let i = 0; i < MOUSE_1351_BUTTON_HOLD_FRAMES; i++) {
    assert.equal(takeJoyFireHeld(latch, false), true);
  }
  assert.equal(takeJoyFireHeld(latch, false), false);
});
