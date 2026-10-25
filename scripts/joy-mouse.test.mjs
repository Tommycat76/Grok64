import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { digitalJoyPlayer } = await server.ssrLoadModule("/src/lib/emu/host.ts");
const { viceExpandOptions } = await server.ssrLoadModule("/src/lib/emu/expand.ts");
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
  const p1 = viceExpandOptions({
    reu: "none",
    iec: "1541",
    mouse: true,
    joyPort: 1,
    scpu: false,
  });
  assert.equal(p1.vice_joyport, "1");
  assert.equal(p1.vice_joyport_type, "3");
});
