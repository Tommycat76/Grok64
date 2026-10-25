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
 * VICE only has relative motion (no get/set pointer). A 1:1 CSS-pixel count
 * overshoots the ~384×272 glass when the host glass is ~2× wider, so the
 * C64 pointer races to the edges. Scale host deltas to CRT coordinates and
 * keep the fractional remainder in the accumulator so small moves still land.
 * The host cursor is hidden over the glass — the user aims with the 1351.
 */
export function hostDragTo1351(
  dx: number,
  dy: number,
  displayW?: number,
  displayH?: number,
  frameW = CRT_FRAME_W,
  frameH = CRT_FRAME_H,
): { dx: number; dy: number } {
  const x = Number.isFinite(dx) ? dx : 0;
  const y = Number.isFinite(dy) ? dy : 0;
  const w = displayW && displayW > 1 ? displayW : frameW;
  const h = displayH && displayH > 1 ? displayH : frameH;
  return {
    dx: x * (frameW / w),
    dy: y * (frameH / h),
  };
}

/** Integer 1351 counts this flush; leftover fractions stay in the accum. */
export function takeMouse1351Counts(acc: Mouse1351Accum): { dx: number; dy: number } {
  const dx = Math.trunc(acc.x) || 0;
  const dy = Math.trunc(acc.y) || 0;
  acc.x -= dx;
  acc.y -= dy;
  return { dx, dy };
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

/** Hold a 1351 click long enough for one VICE poll (~3 NTSC frames). */
export const MOUSE_1351_BUTTON_HOLD_FRAMES = 3;

export type Mouse1351ButtonLatch = { left: number; right: number };

export function createMouse1351ButtonLatch(): Mouse1351ButtonLatch {
  return { left: 0, right: 0 };
}

export function resetMouse1351ButtonLatch(latch: Mouse1351ButtonLatch): void {
  latch.left = 0;
  latch.right = 0;
}

/** Rising-edge press: keep the button down for a few flushes even if pointerup is immediate. */
export function noteMouse1351ButtonPress(latch: Mouse1351ButtonLatch, left: boolean, right: boolean): void {
  if (left) latch.left = MOUSE_1351_BUTTON_HOLD_FRAMES;
  if (right) latch.right = MOUSE_1351_BUTTON_HOLD_FRAMES;
}

export function takeMouse1351Buttons(
  latch: Mouse1351ButtonLatch,
  held: { left: boolean; right: boolean },
): { left: boolean; right: boolean } {
  const left = held.left || latch.left > 0;
  const right = held.right || latch.right > 0;
  if (latch.left > 0) latch.left -= 1;
  if (latch.right > 0) latch.right -= 1;
  return { left, right };
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
