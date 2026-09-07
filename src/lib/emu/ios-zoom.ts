/**
 * CriOS CRT zoom — CSS `zoom` on a NON-GL wrapper around the live 384×272 canvas.
 *
 * Read `docs/IOS_CRT_KNOWN_FAILURES.md` first. #50 left the GL canvas at
 * intrinsic 384×272 CSS (flex letterbox). Plex paint-count went green;
 * Tom’s CriOS photo is a postage stamp (VIC border only L+B).
 *
 * `zoom` is not `transform: scale()` (#43/#44). It is not applied to the
 * WebGL canvas, `#grok64-player`, or the drawing buffer. Canvas CSS and
 * backing stay 384×272 so VICE keeps the #39/#50 blit (purple VIC + dark
 * inner). Do not set canvas.style to 100% (#7/#8).
 */

export const IOS_ZOOM_CLASS = "g64-ios-zoom";
export const NATIVE_FB_W = 384;
export const NATIVE_FB_H = 272;

/**
 * Uniform contain-fit of a 384×272 box into the bezel, times the device
 * pixel ratio so a 1:1 device-pixel WebGL blit becomes bezel-readable.
 * CriOS often composites the native buffer at device pixels inside the
 * CSS box (#50 stamp). Chromium-on-Plex already fills the CSS box — the
 * extra dpr zoom crops toward a filled bezel there; that is not a Tom PASS.
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
