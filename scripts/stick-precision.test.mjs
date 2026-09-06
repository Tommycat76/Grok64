import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyStickPrecision,
  createStickPrecision,
  PRECISION_CRAWL_OFF_MULT,
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

test("precision hold crawls after rest gap", () => {
  const state = createStickPrecision(20);
  state.precision = true;
  applyStickPrecision(state, { x: 1, y: 0 }, 0);
  const crawlOn = applyStickPrecision(state, { x: 1, y: 0 }, PRECISION_REST_MS + 1);
  assert.deepEqual(crawlOn, { x: 1, y: 0 });
  const crawlOff = applyStickPrecision(
    state,
    { x: 1, y: 0 },
    PRECISION_REST_MS + 1 + 20 * PRECISION_CRAWL_OFF_MULT,
  );
  assert.deepEqual(crawlOff, { x: 0, y: 0 });
});
