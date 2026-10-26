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
  VICE_ACTIVE_W,
  VICE_ACTIVE_H,
  dpadForAxes,
  hostDragTo1351,
  objectFitContainContentBox,
  crtDisplayBox,
  takeMouse1351Counts,
  hostPointerMoveToDelta,
  noteRealPointerFeed,
  readRealPointerFeed,
  resetRealPointerFeed,
  takeMouse1351Frame,
  createMouse1351ButtonLatch,
  noteMouse1351ButtonPress,
  takeMouse1351Buttons,
  MOUSE_1351_BUTTON_HOLD_FRAMES,
  createMouse1351CursorSync,
  hostPointerScreenDrag,
  syncHostPointerTo1351,
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

test("object-fit contain uses inner drawable size not the outer box", () => {
  const inner = objectFitContainContentBox(800, 400);
  assert.ok(inner.w < 800);
  assert.equal(inner.h, 400);
  assert.ok(inner.offsetX > 0);
});

test("host drag is 1:1 CSS px to C64 screen px", () => {
  const native = hostDragTo1351(12, -12, VICE_ACTIVE_W, VICE_ACTIVE_H);
  assert.equal(native.dx, 12);
  assert.equal(native.dy, -12);
  const wide = hostDragTo1351(20, 20, 768, 544);
  assert.equal(wide.dx, 20);
  assert.equal(wide.dy, 20);
});

test("host drag ignores letterbox size (1:1)", () => {
  const { dx, dy } = hostDragTo1351(10, 10, 384, 400);
  assert.equal(dx, 10);
  assert.equal(dy, 10);
});

test("fractional CRT-scale leftovers stay in the accumulator", () => {
  const acc = createMouse1351Accum();
  addMouse1351Delta(acc, 1.75, -0.25);
  const first = takeMouse1351Counts(acc);
  assert.equal(first.dx, 1);
  assert.equal(first.dy, 0);
  assert.ok(Math.abs(acc.x - 0.75) < 1e-9);
  assert.ok(Math.abs(acc.y + 0.25) < 1e-9);
});

test("hover uses movementX/Y without a previous pointerdown sample", () => {
  const first = hostPointerMoveToDelta({ movementX: 6, movementY: -4, clientX: 100, clientY: 80 }, null);
  assert.equal(first.dx, 6);
  assert.equal(first.dy, -4);
  const next = hostPointerMoveToDelta({ movementX: 0, movementY: 0, clientX: 108, clientY: 82 }, first.next);
  assert.equal(next.dx, 8);
  assert.equal(next.dy, 2);
});

test("real pointer feed counts hover and drag separately and ignores helper-sized zeros", () => {
  resetRealPointerFeed();
  noteRealPointerFeed(0, 0, 0, false);
  assert.equal(readRealPointerFeed().moves, 0);
  noteRealPointerFeed(3, 1, 0, false);
  noteRealPointerFeed(-2, 4, 1, false);
  const feed = readRealPointerFeed();
  assert.equal(feed.moves, 2);
  assert.equal(feed.hoverMoves, 1);
  assert.equal(feed.dragMoves, 1);
  assert.equal(feed.lastDx, -2);
  assert.equal(feed.lastDy, 4);
});

test("a click that is released immediately still holds the 1351 left button for a few flushes", () => {
  const latch = createMouse1351ButtonLatch();
  noteMouse1351ButtonPress(latch, true, false);
  const first = takeMouse1351Buttons(latch, { left: false, right: false });
  assert.equal(first.left, true);
  assert.equal(first.right, false);
  let seen = 1;
  while (seen < 8) {
    const next = takeMouse1351Buttons(latch, { left: false, right: false });
    if (!next.left) break;
    seen++;
  }
  assert.equal(seen, MOUSE_1351_BUTTON_HOLD_FRAMES);
});

test("hostPointerScreenDrag is relative-only (no absolute snap on first sample)", () => {
  const rect = { left: 0, top: 0, width: 384, height: 272, right: 384, bottom: 272, x: 0, y: 0, toJSON: () => ({}) };
  const first = hostPointerScreenDrag({ movementX: 0, movementY: 0, clientX: 100, clientY: 80 }, null, rect);
  assert.equal(first.dx, 0);
  assert.equal(first.dy, 0);
  const second = hostPointerScreenDrag({ movementX: 10, movementY: -5, clientX: 110, clientY: 75 }, first.next, rect);
  assert.equal(second.dx, 10);
  assert.equal(second.dy, -5);
});

test("absolute host pointer sync maps into CRT deltas (legacy helper)", () => {
  const acc = createMouse1351Accum();
  const sync = createMouse1351CursorSync();
  const rect = { left: 0, top: 0, width: 384, height: 272, right: 384, bottom: 272, x: 0, y: 0, toJSON: () => ({}) };
  syncHostPointerTo1351(acc, sync, 192, 136, rect);
  const moved = syncHostPointerTo1351(acc, sync, 212, 156, rect);
  assert.ok(Math.abs(moved.dx - 20 * (VICE_ACTIVE_W / 384)) < 0.02);
  assert.ok(Math.abs(moved.dy - 20 * (VICE_ACTIVE_H / 272)) < 0.02);
  assert.ok(Math.abs(acc.x - moved.dx) < 0.01);
  assert.ok(Math.abs(acc.y - moved.dy) < 0.01);
});
