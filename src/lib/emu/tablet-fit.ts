import { detectDevice } from "./detect";

/** Native VICE framebuffer used by the Android tablet #40 blit. */
export const TABLET_CRT_W = 384;
export const TABLET_CRT_H = 272;

/**
 * Largest 384:272 that fits `availW` × `availH`.
 * Tablet layout is CSS contain-fit in the bezel — this is the math check only.
 */
export function measureTabletContainSize(
  availW: number,
  availH: number,
): { w: number; h: number } | null {
  if (!(availW >= 8) || !(availH >= 8)) return null;
  const w = Math.round(Math.min(availW, (availH * TABLET_CRT_W) / TABLET_CRT_H));
  const h = Math.round((w * TABLET_CRT_H) / TABLET_CRT_W);
  return { w, h };
}

/** @deprecated #64 measured-width. Kept for the known-fail contract tests. */
export function measureTabletContainWidth(availW: number, availH: number): number | null {
  return measureTabletContainSize(availW, availH)?.w ?? null;
}

/**
 * Tablet #65: CSS contain-fits `.g64-screen` in an out-of-flow bezel slot.
 * Drop `--g64-tablet-crt-w` so a collapsed #64 measure cannot pin a stamp.
 * Phone / desktop: clear leftovers so the var cannot leak onto CriOS glass.
 */
export function applyTabletContainFit(root: ParentNode | Document = document): number | null {
  if (typeof document === "undefined") return null;
  const bezel = root.querySelector(".g64-bezel") as HTMLElement | null;
  const screen = root.querySelector(".g64-screen") as HTMLElement | null;
  bezel?.style.removeProperty("--g64-tablet-crt-w");
  screen?.style.removeProperty("width");
  screen?.style.removeProperty("height");
  if (detectDevice() !== "tablet") return null;
  return null;
}
