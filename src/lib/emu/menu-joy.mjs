// @ts-nocheck
/** Classic menu key-repeat: first step on edge, then delayed auto-repeat while held. */

/** Delay before auto-repeat while the stick is held (center / sustained hold). */
export const MENU_JOY_INITIAL_MS = 130;
/** Auto-repeat interval after the initial delay. */
export const MENU_JOY_REPEAT_MS = 62;
/** How long each menu step pulse stays asserted to the core (≈2 frames @ 50 Hz PAL). */
export const MENU_JOY_PULSE_MS = 34;

export function createMenuJoyGate() {
  return {
    heldDir: null,
    pulseUntil: 0,
    pulseX: 0,
    pulseY: 0,
    firstHeldAt: {},
    lastStepAt: {},
  };
}

export function resetMenuJoyGate(gate) {
  gate.heldDir = null;
  gate.pulseUntil = 0;
  gate.pulseX = 0;
  gate.pulseY = 0;
  gate.firstHeldAt = {};
  gate.lastStepAt = {};
}

function snapAxis(v) {
  if (v < -0.5) return -1;
  if (v > 0.5) return 1;
  return 0;
}

/** Prefer vertical for one-axis menus (circuit picker); otherwise take the stronger axis. */
export function pickMenuDir(x, y) {
  const sx = snapAxis(x);
  const sy = snapAxis(y);
  if (sx === 0 && sy === 0) return null;
  if (sx !== 0 && sy !== 0) {
    if (Math.abs(y) >= Math.abs(x)) return sy < 0 ? "up" : "down";
    return sx < 0 ? "left" : "right";
  }
  if (sy !== 0) return sy < 0 ? "up" : "down";
  return sx < 0 ? "left" : "right";
}

export function menuDirVector(dir) {
  switch (dir) {
    case "up":
      return { x: 0, y: -1 };
    case "down":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Convert raw stick/keyboard direction into debounced menu pulses.
 * Returns (0,0) between steps; gameplay should bypass this and pass raw vectors through.
 */
export function menuJoyStep(gate, rawX, rawY, now) {
  if (now < gate.pulseUntil) {
    return { x: gate.pulseX, y: gate.pulseY };
  }
  gate.pulseX = 0;
  gate.pulseY = 0;

  const dir = pickMenuDir(rawX, rawY);
  const prev = gate.heldDir;
  gate.heldDir = dir;

  if (!dir) {
    gate.firstHeldAt = {};
    return { x: 0, y: 0 };
  }

  const edge = dir !== prev;
  if (edge) {
    gate.firstHeldAt = { [dir]: now };
    gate.lastStepAt = { [dir]: now };
    const v = menuDirVector(dir);
    gate.pulseX = v.x;
    gate.pulseY = v.y;
    gate.pulseUntil = now + MENU_JOY_PULSE_MS;
    return v;
  }

  const first = gate.firstHeldAt[dir] ?? now;
  const last = gate.lastStepAt[dir] ?? 0;
  const heldMs = now - first;
  if (heldMs < MENU_JOY_INITIAL_MS) return { x: 0, y: 0 };
  if (now - last < MENU_JOY_REPEAT_MS) return { x: 0, y: 0 };

  gate.lastStepAt[dir] = now;
  const v = menuDirVector(dir);
  gate.pulseX = v.x;
  gate.pulseY = v.y;
  gate.pulseUntil = now + MENU_JOY_PULSE_MS;
  return v;
}
