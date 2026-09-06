import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyStickPrecision,
  createStickPrecision,
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

test("precision tap emits one immediate step then rests", () => {
  const state = createStickPrecision(20);
  state.precision = true;
  const first = applyStickPrecision(state, { x: 0, y: 1 }, 0);
  assert.deepEqual(first, { x: 0, y: 1 });
  const duringRest = applyStickPrecision(state, { x: 0, y: 1 }, PRECISION_REST_MS - 1);
  assert.deepEqual(duringRest, { x: 0, y: 0 });
});

test("precision center hold latches solid after rest gap", () => {
  const state = createStickPrecision(20);
  state.precision = true;
  applyStickPrecision(state, { x: 1, y: 0 }, 0, true);
  applyStickPrecision(state, { x: 1, y: 0 }, PRECISION_REST_MS - 1, true);
  const walk = applyStickPrecision(state, { x: 1, y: 0 }, PRECISION_REST_MS + 1, true);
  assert.deepEqual(walk, { x: 1, y: 0 });
  const still = applyStickPrecision(state, { x: 1, y: 0 }, PRECISION_REST_MS + 50, true);
  assert.deepEqual(still, { x: 1, y: 0 });
});

test("precision ring tap does not solid-latch after rest", () => {
  const state = createStickPrecision(20);
  state.precision = true;
  applyStickPrecision(state, { x: 0, y: 1 }, 0, false);
  applyStickPrecision(state, { x: 0, y: 1 }, PRECISION_REST_MS - 1, false);
  const afterRest = applyStickPrecision(state, { x: 0, y: 1 }, PRECISION_REST_MS + 1, false);
  assert.deepEqual(afterRest, { x: 0, y: 0 });
  const duringTapHold = applyStickPrecision(state, { x: 0, y: 1 }, PRECISION_REST_MS + 48, false);
  assert.deepEqual(duringTapHold, { x: 0, y: 0 });
});
