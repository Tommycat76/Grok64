/**
 * Host pointer deltas → VICE 1351 POT counts.
 *
 * vice-libretro `process_analogmouse` (speed 1.0, deadzone 0) turns a
 * left-stick axis of A into `round(A * 10 / 32768)` mouse units, then
 * `retro_mouse_move` calls VICE `mouse_move`, and mouse_1351 reports
 * `(last_x & 0x7f) + 0x40` on POT X/Y. We invert that scale so a 1-pixel
 * host drag is one 1351 count, not a held analog velocity.
 */

export const ANALOGMOUSE_UNITS_PER_FRAME = 10;

export function clampMouseDelta(n: number, max = ANALOGMOUSE_UNITS_PER_FRAME): number {
  if (!Number.isFinite(n)) return 0;
  if (n > max) return max;
  if (n < -max) return -max;
  return n;
}

/** D-Pad bits vice-libretro also turns into `retro_mouse_move` when the port is a 1351. */
export function dpadForAxes(ax: number, ay: number, dead = 0.08): {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
} {
  const x = Number.isFinite(ax) ? ax : 0;
  const y = Number.isFinite(ay) ? ay : 0;
  return {
    left: x < -dead,
    right: x > dead,
    up: y < -dead,
    down: y > dead,
  };
}

/** Analog axes in [-1, 1] that produce `usedX`/`usedY` 1351 units this poll. */
export function analogAxesForDeltas(dx: number, dy: number): {
  ax: number;
  ay: number;
  usedX: number;
  usedY: number;
} {
  const usedX = clampMouseDelta(dx);
  const usedY = clampMouseDelta(dy);
  return {
    ax: usedX / ANALOGMOUSE_UNITS_PER_FRAME,
    ay: usedY / ANALOGMOUSE_UNITS_PER_FRAME,
    usedX,
    usedY,
  };
}

export type Mouse1351Accum = { x: number; y: number };

export function createMouse1351Accum(): Mouse1351Accum {
  return { x: 0, y: 0 };
}

export function addMouse1351Delta(acc: Mouse1351Accum, dx: number, dy: number): void {
  if (Number.isFinite(dx)) acc.x += dx;
  if (Number.isFinite(dy)) acc.y += dy;
}

/** Take at most one analog-mouse frame of leftover pixels. */
export function takeMouse1351Frame(acc: Mouse1351Accum): { ax: number; ay: number } {
  const { ax, ay, usedX, usedY } = analogAxesForDeltas(acc.x, acc.y);
  acc.x -= usedX;
  acc.y -= usedY;
  return { ax, ay };
}

export function resetMouse1351Accum(acc: Mouse1351Accum): void {
  acc.x = 0;
  acc.y = 0;
}

/** VICE CRT glass (borders included). Same aspect as `.g64-screen`. */
export const CRT_FRAME_W = 384;
export const CRT_FRAME_H = 272;

/**
 * Host CSS-pixel drag → 1351 counts for VICE `mouse_move`.
 *
 * One CSS pixel is one 1351 count on both axes. Scaling down to the 384×272
 * glass starved small drags (they rounded to 0) while WASD still fed +4
 * counts/frame — GEOS then looked like it was reading a joystick. GEOS
 * applies its own 1351 sensitivity; do not pre-shrink here.
 */
export function hostDragTo1351(
  dx: number,
  dy: number,
  _displayW?: number,
  _displayH?: number,
  _frameW = CRT_FRAME_W,
  _frameH = CRT_FRAME_H,
): { dx: number; dy: number } {
  const x = Number.isFinite(dx) ? dx : 0;
  const y = Number.isFinite(dy) ? dy : 0;
  return { dx: x, dy: y };
}

export type HostPointerPos = { x: number; y: number };

/**
 * Real pointer/mouse event → 1351 counts.
 * Prefer movementX/Y (hover and pointer-lock). Fall back to clientX/Y vs the last sample.
 */
export function hostPointerMoveToDelta(
  ev: { movementX?: number; movementY?: number; clientX: number; clientY: number },
  prev: HostPointerPos | null,
): { dx: number; dy: number; next: HostPointerPos } {
  const next = { x: ev.clientX, y: ev.clientY };
  const mx = Number(ev.movementX);
  const my = Number(ev.movementY);
  if (Number.isFinite(mx) && Number.isFinite(my) && (mx !== 0 || my !== 0)) {
    return { dx: mx, dy: my, next };
  }
  if (prev) return { dx: next.x - prev.x, dy: next.y - prev.y, next };
  return { dx: 0, dy: 0, next };
}

export type RealPointerFeed = {
  moves: number;
  hoverMoves: number;
  dragMoves: number;
  lastDx: number;
  lastDy: number;
  buttons: number;
  locked: boolean;
  lastAt: number;
};

const realPointerFeed: RealPointerFeed = {
  moves: 0,
  hoverMoves: 0,
  dragMoves: 0,
  lastDx: 0,
  lastDy: 0,
  buttons: 0,
  locked: false,
  lastAt: 0,
};

/** Count a real canvas/window pointer event — never call this from addHostDrag helpers. */
export function noteRealPointerFeed(dx: number, dy: number, buttons = 0, locked = false): void {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return;
  realPointerFeed.moves += 1;
  if (buttons) realPointerFeed.dragMoves += 1;
  else realPointerFeed.hoverMoves += 1;
  realPointerFeed.lastDx = dx;
  realPointerFeed.lastDy = dy;
  realPointerFeed.buttons = buttons;
  realPointerFeed.locked = locked;
  realPointerFeed.lastAt = Date.now();
}

export function readRealPointerFeed(): RealPointerFeed {
  return { ...realPointerFeed };
}

export function resetRealPointerFeed(): void {
  realPointerFeed.moves = 0;
  realPointerFeed.hoverMoves = 0;
  realPointerFeed.dragMoves = 0;
  realPointerFeed.lastDx = 0;
  realPointerFeed.lastDy = 0;
  realPointerFeed.buttons = 0;
  realPointerFeed.locked = false;
  realPointerFeed.lastAt = 0;
}

export function crtDisplayBox(root?: ParentNode | Document | null): { w: number; h: number } {
  const doc = root ?? (typeof document !== "undefined" ? document : null);
  const canvas = doc?.querySelector?.(".g64-screen canvas") as HTMLElement | null;
  const screen = doc?.querySelector?.(".g64-screen") as HTMLElement | null;
  const el = canvas && canvas.getBoundingClientRect().width > 1 ? canvas : screen;
  const r = el?.getBoundingClientRect?.();
  if (r && r.width > 1 && r.height > 1) return { w: r.width, h: r.height };
  return { w: CRT_FRAME_W, h: CRT_FRAME_H };
}
