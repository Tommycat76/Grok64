import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const {
  ANALOGMOUSE_UNITS_PER_FRAME,
  analogAxesForDeltas,
  addMouse1351Delta,
  createMouse1351Accum,
  CRT_FRAME_H,
  CRT_FRAME_W,
  dpadForAxes,
  hostDragTo1351,
  takeMouse1351Frame,
} = await server.ssrLoadModule("/src/lib/emu/mouse-1351.ts");
await server.close();

test("one host pixel becomes a 0.1 analog axis (10 units per full stick)", () => {
  const { ax, ay, usedX, usedY } = analogAxesForDeltas(1, -2);
  assert.equal(usedX, 1);
  assert.equal(usedY, -2);
  assert.equal(ax, 1 / ANALOGMOUSE_UNITS_PER_FRAME);
  assert.equal(ay, -2 / ANALOGMOUSE_UNITS_PER_FRAME);
});

test("a large drag is capped per poll so leftover pixels stay in the accumulator", () => {
  const acc = createMouse1351Accum();
  addMouse1351Delta(acc, 25, 0);
  const first = takeMouse1351Frame(acc);
  assert.equal(first.ax, 1);
  assert.ok(acc.x > 0);
  const second = takeMouse1351Frame(acc);
  assert.equal(second.ax, 1);
  assert.equal(acc.x, 25 - ANALOGMOUSE_UNITS_PER_FRAME * 2);
  const third = takeMouse1351Frame(acc);
  assert.equal(third.ax, (25 - ANALOGMOUSE_UNITS_PER_FRAME * 2) / ANALOGMOUSE_UNITS_PER_FRAME);
  assert.equal(acc.x, 0);
});

test("idle poll is zero analog — no leftover velocity", () => {
  const acc = createMouse1351Accum();
  const idle = takeMouse1351Frame(acc);
  assert.deepEqual(idle, { ax: 0, ay: 0 });
});

test("nonzero analog axes hold the D-pad bits vice-libretro maps to 1351 POT", () => {
  assert.deepEqual(dpadForAxes(0, 0), { left: false, right: false, up: false, down: false });
  assert.deepEqual(dpadForAxes(0.2, -0.4), { left: false, right: true, up: true, down: false });
  assert.deepEqual(dpadForAxes(-1, 1), { left: true, right: false, up: false, down: true });
});

test("host drag is one CSS pixel per 1351 count on any display size", () => {
  const native = hostDragTo1351(12, -12, CRT_FRAME_W, CRT_FRAME_H);
  assert.equal(native.dx, 12);
  assert.equal(native.dy, -12);
  const wide = hostDragTo1351(20, 20, 768, 544);
  assert.equal(wide.dx, 20);
  assert.equal(wide.dy, 20);
});

test("a taller-than-native box does not shrink vertical 1351 counts", () => {
  const { dx, dy } = hostDragTo1351(10, 10, 384, 400);
  assert.equal(dx, 10);
  assert.equal(dy, 10);
});
