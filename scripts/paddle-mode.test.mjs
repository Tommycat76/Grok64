import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  vicePortDeviceOptions,
  applySavedJoyAndMouse,
  hostPaddlePortActive,
  hostMouseDualStickActive,
  digitalJoyPlayer,
} = await server.ssrLoadModule("/src/lib/emu/host.ts");
await server.close();

test("paddle on port 1 sets VICE paddles type and opposite stick port", () => {
  const opts = vicePortDeviceOptions(1, false, true);
  assert.equal(opts.vice_joyport, "1");
  assert.equal(opts.vice_joyport_type, "2");
  assert.equal(opts.vice_analogmouse, "disabled");
});

test("applySavedJoyAndMouse enables dual-stick routing for paddle", () => {
  applySavedJoyAndMouse(null, 1, false, true);
  assert.equal(hostPaddlePortActive(), true);
  assert.equal(hostMouseDualStickActive(), true);
  assert.equal(digitalJoyPlayer(false, 1, true), 0);
  applySavedJoyAndMouse(null, 2, false, false);
  assert.equal(hostPaddlePortActive(), false);
});
