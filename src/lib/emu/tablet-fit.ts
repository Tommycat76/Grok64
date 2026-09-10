import { detectDevice } from "./detect";

/**
 * Tablet CRT layout ownership (Onn stamp fix):
 *
 * - `.g64-stage`   — positioning context only.
 * - `.g64-bezel`   — the CRT frame: absolute contain-fit 4:3 in the stage.
 * - `.g64-screen`  — fills the bezel (CSS 100%).
 * - `canvas`       — fills the glass (CSS 100%); **VICE owns the drawing
 *                    buffer**. Nothing here may set a pixel size.
 *
 * There is deliberately no measured CRT width. #64 wrote
 * `--g64-tablet-crt-w` from a bezel that was still the first-pass stamp,
 * and the real defect was a 384x272 backing under a glass-sized GL
 * viewport (see `fitEmu`). Do not reintroduce a measured-width race.
 */

function paddingBox(el: HTMLElement) {
  const cs = getComputedStyle(el);
  return {
    x: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0),
    y: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0),
  };
}

/** Content box of the bezel — the box the glass must fill. */
export function tabletBezelAvail(bezel: HTMLElement): { w: number; h: number } {
  const pad = paddingBox(bezel);
  return {
    w: bezel.clientWidth - pad.x,
    h: bezel.clientHeight - pad.y,
  };
}

/**
 * True when the glass really fills a laid-out bezel. Used only to wait for
 * layout before EJS reads the box — never to size anything.
 */
export function tabletGlassFillsBezel(
  screenW: number,
  screenH: number,
  availW: number,
  availH: number,
  cover = 0.85,
): boolean {
  // Floor is above a 384x272 stamp box so a not-yet-laid-out bezel cannot
  // pass just because the glass fills it. Bounded: on timeout the boot
  // proceeds exactly as before.
  if (!(availW >= 480) || !(availH >= 300)) return false;
  return screenW >= availW * cover && screenH >= availH * cover;
}

/**
 * Flush tablet layout before a box read, and clear the #64 measured-width
 * custom property if a cached bundle left one behind.
 */
export function applyTabletContainFit(root: ParentNode | Document = document): boolean {
  if (typeof document === "undefined") return false;
  const bezel = root.querySelector(".g64-bezel") as HTMLElement | null;
  bezel?.style.removeProperty("--g64-tablet-crt-w");
  if (detectDevice() !== "tablet" || !bezel) return false;
  void bezel.offsetWidth;
  return true;
}
