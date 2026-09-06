// @ts-nocheck
/** 4-way / 8-way stick snap + precision gate for Cardinals mode (Paradroid, Boulder Dash). */

/** Perimeter tap: engage direction from rest (fraction of stick radius). */
export const STICK_OUTER_DEAD = 0.34;
/** Center release: return to neutral when thumb relaxes inside this radius. */
export const STICK_INNER_DEAD = 0.15;
/** Second axis for diagonals — keeps 22° off-axis pushes cardinal. */
export const STICK_AXIS_HOLD = 0.48;
/** Gap after the first step before center-hold walk (edge tap should finish before this). */
export const PRECISION_REST_MS = 50;
/** First-step pulse length as a multiple of the CIA frame period. */
export const PRECISION_FIRST_MULT = 1.5;
/** Touch shorter than this counts as an edge tap (not a center hold). */
export const STICK_TAP_MAX_MS = 175;
/** Post-tap direction latch after finger-up (must stay under PRECISION_REST_MS budget). */
export const STICK_TAP_HOLD_MS = 48;

const OUTER_DEAD = STICK_OUTER_DEAD;
const INNER_DEAD = STICK_INNER_DEAD;
const AXIS_HOLD = STICK_AXIS_HOLD;

function axisStep(value, prev, outer = INNER_DEAD) {
  if (Math.abs(value) < (prev === 0 ? outer : INNER_DEAD)) return 0;
  return value < 0 ? -1 : 1;
}

/** Snap drag vector to digital stick; gate is `4way` or `8way`. */
export function snapStick(dx, dy, prev = { x: 0, y: 0 }, gate = "8way") {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  const m = Math.hypot(dx, dy);
  const held = prev.x !== 0 || prev.y !== 0;
  if (!held && m < OUTER_DEAD) return { x: 0, y: 0 };
  if (held && m < INNER_DEAD) return { x: 0, y: 0 };
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let x;
  let y;
  if (held) {
    if (gate === "8way") {
      x = axisStep(dx, prev.x, prev.x === 0 ? AXIS_HOLD : OUTER_DEAD);
      y = axisStep(dy, prev.y, prev.y === 0 ? AXIS_HOLD : OUTER_DEAD);
    } else {
      x = axisStep(dx, prev.x, OUTER_DEAD);
      y = axisStep(dy, prev.y, OUTER_DEAD);
      if (x !== 0 && y !== 0) {
        if (ax >= ay) y = 0;
        else x = 0;
      }
    }
  } else if (ax >= ay) {
    x = axisStep(dx, 0, OUTER_DEAD);
    y = gate === "4way" ? 0 : axisStep(dy, 0, AXIS_HOLD);
  } else {
    y = axisStep(dy, 0, OUTER_DEAD);
    x = gate === "4way" ? 0 : axisStep(dx, 0, AXIS_HOLD);
  }
  return { x, y };
}

export function createStickPrecision(periodMs = 20) {
  return {
    latched: { x: 0, y: 0 },
    pending: { x: 0, y: 0 },
    lastTick: 0,
    holdStart: -1,
    periodMs,
    precision: false,
  };
}

/**
 * Cardinals: edge tap = one short pulse + brief rest. Center hold latches solid
 * after the rest gap so platformers walk at game speed on phone and tablet.
 */
export function applyStickPrecision(state, raw, now = performance.now()) {
  state.pending = { x: raw.x, y: raw.y };
  if (raw.x === 0 && raw.y === 0) {
    state.latched = { x: 0, y: 0 };
    state.lastTick = now;
    state.holdStart = -1;
    return state.latched;
  }
  if (!state.precision) {
    if (state.latched.x === 0 && state.latched.y === 0) {
      state.latched = { x: raw.x, y: raw.y };
      state.lastTick = now;
      return state.latched;
    }
    if (raw.x !== state.latched.x || raw.y !== state.latched.y || now - state.lastTick >= state.periodMs) {
      state.latched = { x: raw.x, y: raw.y };
      state.lastTick = now;
    }
    return state.latched;
  }
  if (state.holdStart < 0) state.holdStart = now;
  const heldMs = now - state.holdStart;
  const r = state.periodMs;
  const first = r * PRECISION_FIRST_MULT;
  if (heldMs < first) {
    state.latched = { x: raw.x, y: raw.y };
    return state.latched;
  }
  if (heldMs < PRECISION_REST_MS) {
    state.latched = { x: 0, y: 0 };
    return state.latched;
  }
  state.latched = { x: raw.x, y: raw.y };
  return state.latched;
}

export function resetStickPrecision(state) {
  state.latched = { x: 0, y: 0 };
  state.pending = { x: 0, y: 0 };
  state.lastTick = 0;
  state.holdStart = -1;
}
