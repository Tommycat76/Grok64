import { detectDevice } from "./detect";

/** Native VICE framebuffer used by the Android tablet #40 blit. */
export const TABLET_CRT_W = 384;
export const TABLET_CRT_H = 272;

/**
 * Largest 384:272 width that fits `availW` × `availH` (bezel padding already
 * subtracted). Null when the box is not laid out yet — caller must keep the
 * CSS fallback (100% / viewport) instead of writing a stamp width.
 */
export function measureTabletContainWidth(availW: number, availH: number): number | null {
  if (!(availW >= 8) || !(availH >= 8)) return null;
  return Math.round(Math.min(availW, (availH * TABLET_CRT_W) / TABLET_CRT_H));
}

function paddingBox(el: HTMLElement) {
  const cs = getComputedStyle(el);
  return {
    x: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0),
    y: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0),
  };
}

/**
 * Write `--g64-tablet-crt-w` on the bezel from its real box.
 * Phone / desktop: clear the var so it cannot leak onto CriOS glass.
 */
export function applyTabletContainFit(root: ParentNode | Document = document): number | null {
  if (typeof document === "undefined") return null;
  const bezel = root.querySelector(".g64-bezel") as HTMLElement | null;
  if (detectDevice() !== "tablet") {
    bezel?.style.removeProperty("--g64-tablet-crt-w");
    return null;
  }
  if (!bezel) return null;
  const pad = paddingBox(bezel);
  const w = measureTabletContainWidth(bezel.clientWidth - pad.x, bezel.clientHeight - pad.y);
  if (w == null) return null;
  bezel.style.setProperty("--g64-tablet-crt-w", `${w}px`);
  return w;
}
