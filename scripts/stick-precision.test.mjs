import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyStickPrecision,
  createStickPrecision,
  mergePadStick,
  PRECISION_REST_MS,
  snapStick,
  STICK_INNER_DEAD,
  STICK_OUTER_DEAD,
} from "../src/lib/emu/stick-precision.mjs";

test("snapStick engages at outer deadzone and releases at inner", () => {
  assert.deepEqual(snapStick(0, 0), { x: 0, y: 0 });
  assert.deepEqual(snapStick(0, STICK_OUTER_DEAD - 0.05), { x: 0, y: 0 });
  assert.deepEqual(snapStick(0, STICK_OUTER_DEAD + 0.05), { x: 0, y: 1 });
  assert.deepEqual(snapStick(0, STICK_INNER_DEAD - 0.02, { x: 0, y: 1 }), { x: 0, y: 0 });
});

test("snapStick 4way keeps one cardinal", () => {
  assert.deepEqual(snapStick(0.9, 0.2, { x: 0, y: 0 }, "4way"), { x: 1, y: 0 });
  assert.deepEqual(snapStick(0.2, 0.9, { x: 0, y: 0 }, "4way"), { x: 0, y: 1 });
  assert.deepEqual(snapStick(0.8, 0.7, { x: 1, y: 0 }, "4way"), { x: 1, y: 0 });
});

test("held stick latches solid until release", () => {
  const state = createStickPrecision(20);
  state.precision = true;
  assert.deepEqual(applyStickPrecision(state, { x: 0, y: 1 }, 0), { x: 0, y: 1 });
  assert.deepEqual(applyStickPrecision(state, { x: 0, y: 1 }, PRECISION_REST_MS - 1), { x: 0, y: 1 });
  assert.deepEqual(applyStickPrecision(state, { x: 0, y: 1 }, PRECISION_REST_MS + 50, false), { x: 0, y: 1 });
  assert.deepEqual(applyStickPrecision(state, { x: 1, y: 0 }, PRECISION_REST_MS + 80), { x: 1, y: 0 });
  assert.deepEqual(applyStickPrecision(state, { x: 0, y: 0 }, PRECISION_REST_MS + 90), { x: 0, y: 0 });
});

test("release clears the latch immediately", () => {
  const state = createStickPrecision(20);
  state.precision = true;
  applyStickPrecision(state, { x: -1, y: 0 }, 0, true);
  assert.deepEqual(applyStickPrecision(state, { x: 0, y: 0 }, 10, true), { x: 0, y: 0 });
});

test("an idle pad does not zero a held on-screen stick", () => {
  const held = mergePadStick(0, 0, { x: 1, y: 0 }, true, false);
  assert.deepEqual(held, { x: 1, y: 0, driving: false });
  const padWins = mergePadStick(-1, 0, { x: 1, y: 0 }, true, false);
  assert.deepEqual(padWins, { x: -1, y: 0, driving: true });
  const padReleaseKeepsThumb = mergePadStick(0, 0, { x: -1, y: 0 }, true, true);
  assert.deepEqual(padReleaseKeepsThumb, { x: -1, y: 0, driving: false });
  const padReleaseCenters = mergePadStick(0, 0, { x: -1, y: 0 }, false, true);
  assert.deepEqual(padReleaseCenters, { x: 0, y: 0, driving: false });
});
