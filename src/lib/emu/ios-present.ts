/**
 * iOS CRT compositor — stretch the live VICE WebGL framebuffer to the bezel.
 *
 * VICE only blits when the WebGL canvas CSS box is the native 384×272.
 * CSS 100% on that canvas (even with clientWidth locked) is solid black.
 * CriOS ignores CSS transform on the GL layer (#43 canvas, #44 wrapper),
 * which is Tom's postage-stamp (photo: top-right).
 *
 * This module copies the *live* GL canvas with 2D drawImage into a separate
 * present canvas that CSS-fills .g64-screen. That is not the old PNG / paint-poll
 * overlay: we never call getContext on the VICE canvas, never capture a PNG,
 * never recycle the core.
 */

export const IOS_PRESENT_CLASS = "g64-ios-present";

let raf = 0;
let presentEl: HTMLCanvasElement | null = null;
let sourceEl: HTMLCanvasElement | null = null;
let boxEl: HTMLElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;
let paintedOnce = false;

export function isIosPresentActive(): boolean {
  return Boolean(presentEl?.parentElement);
}

export function isIosPresentPainted(): boolean {
  return paintedOnce;
}

export function stopIosPresent() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  ctx2d = null;
  sourceEl = null;
  boxEl = null;
  paintedOnce = false;
  if (presentEl) {
    presentEl.remove();
    presentEl = null;
  }
}

function ensurePresent(box: HTMLElement): HTMLCanvasElement {
  let el = box.querySelector(`canvas.${IOS_PRESENT_CLASS}`) as HTMLCanvasElement | null;
  if (!el) {
    el = document.createElement("canvas");
    el.className = IOS_PRESENT_CLASS;
    el.setAttribute("aria-hidden", "true");
    box.appendChild(el);
  }
  return el;
}

function tick() {
  raf = 0;
  const src = sourceEl;
  const dest = presentEl;
  const box = boxEl;
  const ctx = ctx2d;
  if (!src || !dest || !box || !ctx) return;
  const sw = Math.max(1, Math.round(box.clientWidth || box.getBoundingClientRect().width || 1));
  const sh = Math.max(1, Math.round(box.clientHeight || box.getBoundingClientRect().height || 1));
  if (dest.width !== sw || dest.height !== sh) {
    dest.width = sw;
    dest.height = sh;
  }
  try {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, sw, sh);
    paintedOnce = true;
  } catch {
    /* source not ready */
  }
  raf = requestAnimationFrame(tick);
}

/** Start (or keep) the bezel-filling present of the live WebGL canvas. */
export function startIosPresent(glCanvas: HTMLCanvasElement, box: HTMLElement) {
  if (typeof document === "undefined") return;
  sourceEl = glCanvas;
  boxEl = box;
  presentEl = ensurePresent(box);
  if (!ctx2d || ctx2d.canvas !== presentEl) {
    ctx2d = presentEl.getContext("2d", { alpha: false });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}
