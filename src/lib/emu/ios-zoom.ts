/**
 * CriOS CRT zoom — CSS `zoom` on a NON-GL wrapper, centered by a non-zoomed slot.
 *
 * Read `docs/IOS_CRT_KNOWN_FAILURES.md` first.
 *
 * #50: unzoomed 384×272 flex letterbox → postage stamp.
 * #51: bare CSS `zoom` on `.g64-ios-zoom` enlarged the stamp but kept
 * default top-left origin. Flex did not re-center the expanded used box
 * on CriOS (overflow pin → dark content flush top-right, purple L on
 * left+bottom). Plex `zoom:3` green ≠ Tom geometry.
 *
 * `zoom` is not `transform: scale()` (#43/#44). It is not applied to the
 * WebGL canvas, `#grok64-player`, or the drawing buffer. Canvas CSS and
 * backing stay 384×272 so VICE keeps the #39/#50 blit (purple VIC + dark
 * inner). Do not set canvas.style to 100% (#7/#8).
 *
 * Centering is NOT another zoom-from-default-origin variant: a non-zoomed
 * `.g64-ios-slot` is absolutely positioned at the post-zoom used-size
 * offset so the visual is centered (symmetric letterbox or center-fill
 * crop). No `transform:scale` on GL / player / slot.
 */

export const IOS_ZOOM_CLASS = "g64-ios-zoom";
export const IOS_SLOT_CLASS = "g64-ios-slot";
export const NATIVE_FB_W = 384;
export const NATIVE_FB_H = 272;

export type IosZoomLayout = {
  z: number;
  usedW: number;
  usedH: number;
  left: number;
  top: number;
};

/**
 * Uniform contain-fit of a 384×272 box into the bezel, times the device
 * pixel ratio so a 1:1 device-pixel WebGL blit becomes bezel-readable.
 * CriOS often composites the native buffer at device pixels inside the
 * CSS box (#50 stamp). Chromium-on-Plex already fills the CSS box — the
 * extra dpr zoom overfills there. #51 left that overfill uncentered.
 * Pair this zoom with `iosZoomLayout` so the used box is recentered.
 */
export function iosCrtZoom(sw: number, sh: number, dpr = 1): number {
  if (!(sw >= 8) || !(sh >= 8)) return 1;
  const fit = Math.min(sw / NATIVE_FB_W, sh / NATIVE_FB_H);
  if (!Number.isFinite(fit) || fit <= 0) return 1;
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const z = fit * ratio;
  return Math.max(0.25, Math.min(8, z));
}

export function iosZoomUsedSize(z: number) {
  const zoom = Number.isFinite(z) && z > 0 ? z : 1;
  return {
    w: Math.round(NATIVE_FB_W * zoom),
    h: Math.round(NATIVE_FB_H * zoom),
  };
}

/**
 * Post-zoom used box + top-left offset that centers that box in the bezel.
 * CSS `zoom` originates top-left (#51). Negative left/top = centered
 * overfill (true center-fill crop). Positive top = symmetric letterbox.
 */
export function iosZoomLayout(sw: number, sh: number, dpr = 1): IosZoomLayout {
  const z = iosCrtZoom(sw, sh, dpr);
  const used = iosZoomUsedSize(z);
  return {
    z,
    usedW: used.w,
    usedH: used.h,
    left: (sw - used.w) / 2,
    top: (sh - used.h) / 2,
  };
}

/** Slot and bezel share a center (symmetric crop or letterbox, not an L). */
export function iosZoomSlotCentered(
  slot: { x: number; y: number; w: number; h: number },
  bezel: { x: number; y: number; w: number; h: number },
  slop = 28,
): boolean {
  if (!(slot.w >= 8) || !(slot.h >= 8) || !(bezel.w >= 8) || !(bezel.h >= 8)) return false;
  const sx = slot.x + slot.w / 2;
  const sy = slot.y + slot.h / 2;
  const bx = bezel.x + bezel.w / 2;
  const by = bezel.y + bezel.h / 2;
  return Math.abs(sx - bx) <= slop && Math.abs(sy - by) <= slop;
}
