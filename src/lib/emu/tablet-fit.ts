import { detectDevice } from "./detect";

/** Native VICE framebuffer used by the Android tablet #40 blit. */
export const TABLET_CRT_W = 384;
export const TABLET_CRT_H = 272;

/**
 * Largest 384:272 width that fits `availW` × `availH` (bezel padding already
 * subtracted). Null when the box is not laid out yet.
 */
export function measureTabletContainWidth(availW: number, availH: number): number | null {
  if (!(availW >= 8) || !(availH >= 8)) return null;
  return Math.round(Math.min(availW, (availH * TABLET_CRT_W) / TABLET_CRT_H));
}

export function measureTabletContainHeight(availW: number, availH: number): number | null {
  const w = measureTabletContainWidth(availW, availH);
  if (w == null) return null;
  return Math.round((w * TABLET_CRT_H) / TABLET_CRT_W);
}

function paddingBox(el: HTMLElement) {
  const cs = getComputedStyle(el);
  return {
    x: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0),
    y: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0),
  };
}

export function tabletBezelAvail(bezel: HTMLElement): { w: number; h: number } {
  const pad = paddingBox(bezel);
  return {
    w: bezel.clientWidth - pad.x,
    h: bezel.clientHeight - pad.y,
  };
}

/** True when the glass covers most of the 384:272 contain-fit of the bezel. */
export function tabletGlassFillsBezel(
  screenW: number,
  screenH: number,
  availW: number,
  availH: number,
  cover = 0.85,
): boolean {
  const targetW = measureTabletContainWidth(availW, availH);
  const targetH = measureTabletContainHeight(availW, availH);
  if (targetW == null || targetH == null) return false;
  return screenW >= targetW * cover && screenH >= targetH * cover && screenW >= 400 && screenH >= 220;
}

/**
 * Nudge tablet layout. Do **not** write `--g64-tablet-crt-w`.
 * #64 measured a shrink-wrapped / 0-height bezel and locked the stamp.
 * Phone / desktop: clear any leftover var so it cannot leak onto CriOS glass.
 */
export function applyTabletContainFit(root: ParentNode | Document = document): number | null {
  if (typeof document === "undefined") return null;
  const bezel = root.querySelector(".g64-bezel") as HTMLElement | null;
  bezel?.style.removeProperty("--g64-tablet-crt-w");
  if (detectDevice() !== "tablet") return null;
  if (!bezel) return null;
  void bezel.offsetWidth;
  const avail = tabletBezelAvail(bezel);
  return measureTabletContainWidth(avail.w, avail.h);
}
