import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMenuJoyGate,
  menuJoyStep,
  pickMenuDir,
  MENU_JOY_INITIAL_MS,
  MENU_JOY_REPEAT_MS,
  MENU_JOY_PULSE_MS,
} from "../src/lib/emu/menu-joy.mjs";

test("pickMenuDir prefers vertical when both axes active", () => {
  assert.equal(pickMenuDir(1, 1), "down");
  assert.equal(pickMenuDir(-1, -1), "up");
});

test("one tap emits a single pulse then rests until repeat delay", () => {
  const gate = createMenuJoyGate();
  let t = 0;

  const first = menuJoyStep(gate, 0, 1, t);
  assert.deepEqual(first, { x: 0, y: 1 });

  const duringPulse = menuJoyStep(gate, 0, 1, t + 10);
  assert.deepEqual(duringPulse, { x: 0, y: 1 });

  const afterPulse = menuJoyStep(gate, 0, 1, t + MENU_JOY_PULSE_MS + 1);
  assert.deepEqual(afterPulse, { x: 0, y: 0 });

  const beforeRepeat = menuJoyStep(gate, 0, 1, t + MENU_JOY_INITIAL_MS - 1);
  assert.deepEqual(beforeRepeat, { x: 0, y: 0 });

  const repeat = menuJoyStep(gate, 0, 1, t + MENU_JOY_INITIAL_MS + 1);
  assert.deepEqual(repeat, { x: 0, y: 1 });
});

test("changing direction fires immediately on the new axis", () => {
  const gate = createMenuJoyGate();
  menuJoyStep(gate, 0, 1, 0);
  menuJoyStep(gate, 0, 1, MENU_JOY_PULSE_MS + 1);
  const up = menuJoyStep(gate, 0, -1, MENU_JOY_PULSE_MS + 2);
  assert.deepEqual(up, { x: 0, y: -1 });
});

test("release stops repeat", () => {
  const gate = createMenuJoyGate();
  menuJoyStep(gate, 0, 1, 0);
  menuJoyStep(gate, 0, 0, MENU_JOY_PULSE_MS + 1);
  const idle = menuJoyStep(gate, 0, 0, MENU_JOY_INITIAL_MS + MENU_JOY_REPEAT_MS + 100);
  assert.deepEqual(idle, { x: 0, y: 0 });
});
