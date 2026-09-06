export type StickGate = "4way" | "8way";
export type StickVec = { x: number; y: number };

/** Must push this far from rest to leave center. ~45% of the pad radius. */
export const STICK_ENGAGE = 0.45;
/** Once held, stay on until the thumb is this close to center. */
export const STICK_RELEASE = 0.2;
/** Second axis (diagonal) needs a clear corner push so 22° off-axis stays cardinal. */
export const STICK_DIAGONAL = 0.58;

export function ciaPeriodMs(standard: string | undefined): number {
  return standard === "ntsc" ? 1000 / 60 : 1000 / 50;
}

function axisBit(v: number, prev: number, enter: number, release = STICK_RELEASE): -1 | 0 | 1 {
  const a = Math.abs(v);
  const thresh = prev !== 0 ? release : enter;
  if (a < thresh) return 0;
  return v < 0 ? -1 : 1;
}

/**
 * Square-gate C64 stick.
 * Polar 45° sectors treat a slightly off-axis push as a diagonal — that makes
 * Paradroid's transfer circuits (and Boulder Dash) almost unplayable on a thumb.
 */
export function snapStick(
  dx: number,
  dy: number,
  prev: StickVec = { x: 0, y: 0 },
  gate: StickGate = "8way",
): StickVec {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  const mag = Math.hypot(dx, dy);
  const held = prev.x !== 0 || prev.y !== 0;
  if (!held && mag < STICK_ENGAGE) return { x: 0, y: 0 };
  if (held && mag < STICK_RELEASE) return { x: 0, y: 0 };

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  let x: -1 | 0 | 1;
  let y: -1 | 0 | 1;

  if (!held) {
    if (absX >= absY) {
      x = axisBit(dx, 0, STICK_ENGAGE);
      y = gate === "4way" ? 0 : axisBit(dy, 0, STICK_DIAGONAL);
    } else {
      y = axisBit(dy, 0, STICK_ENGAGE);
      x = gate === "4way" ? 0 : axisBit(dx, 0, STICK_DIAGONAL);
    }
  } else if (gate === "8way") {
    x = axisBit(dx, prev.x, prev.x === 0 ? STICK_DIAGONAL : STICK_ENGAGE);
    y = axisBit(dy, prev.y, prev.y === 0 ? STICK_DIAGONAL : STICK_ENGAGE);
  } else {
    x = axisBit(dx, prev.x, STICK_ENGAGE);
    y = axisBit(dy, prev.y, STICK_ENGAGE);
    if (x !== 0 && y !== 0) {
      if (absX >= absY) y = 0;
      else x = 0;
    }
  }
  return { x, y };
}

/**
 * CIA joystick latch sampled once per video frame (20 ms PAL / 16.7 ms NTSC).
 *
 * 8-way: real C64 — bits stay set while the stick is held. Direction changes
 * wait one frame. Release is instant so you can stop on a Paradroid junction.
 *
 * Cardinals: slow D-pad. A tap is a 2-frame pulse (one cell). Holding crawls
 * (1 frame on, 10 off ≈ 4.5 steps/s) and never goes solid — a continuous hold
 * is what made the transfer game race.
 */
export class CiaStick {
  latched: StickVec = { x: 0, y: 0 };
  pending: StickVec = { x: 0, y: 0 };
  lastTick = 0;
  holdStart = -1;
  periodMs: number;
  precision = false;

  constructor(periodMs = 20) {
    this.periodMs = periodMs;
  }

  apply(desired: StickVec, now = typeof performance !== "undefined" ? performance.now() : Date.now()): StickVec {
    this.pending = { x: desired.x, y: desired.y };
    const idle = desired.x === 0 && desired.y === 0;
    if (idle) {
      this.latched = { x: 0, y: 0 };
      this.lastTick = now;
      this.holdStart = -1;
      return this.latched;
    }

    if (!this.precision) {
      const wasIdle = this.latched.x === 0 && this.latched.y === 0;
      if (wasIdle) {
        this.latched = { x: desired.x, y: desired.y };
        this.lastTick = now;
        return this.latched;
      }
      if (desired.x === this.latched.x && desired.y === this.latched.y) return this.latched;
      if (now - this.lastTick >= this.periodMs) {
        this.latched = { x: desired.x, y: desired.y };
        this.lastTick = now;
      }
      return this.latched;
    }

    if (this.holdStart < 0) this.holdStart = now;
    const heldFor = now - this.holdStart;
    const p = this.periodMs;
    const pulse = p * 2;
    const delay = 220;
    const crawlOn = p;
    const crawlOff = p * 10;
    const cycle = crawlOn + crawlOff;

    if (heldFor < pulse) {
      this.latched = { x: desired.x, y: desired.y };
      return this.latched;
    }
    if (heldFor < delay) {
      this.latched = { x: 0, y: 0 };
      return this.latched;
    }
    const t = (heldFor - delay) % cycle;
    this.latched = t < crawlOn ? { x: desired.x, y: desired.y } : { x: 0, y: 0 };
    return this.latched;
  }

  reset() {
    this.latched = { x: 0, y: 0 };
    this.pending = { x: 0, y: 0 };
    this.lastTick = 0;
    this.holdStart = -1;
  }
}
