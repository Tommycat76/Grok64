/**
 * iOS CRT compositor — stretch the live VICE WebGL framebuffer to the bezel.
 *
 * VICE only blits when the WebGL canvas CSS box is the native 384×272.
 * CSS 100% on that canvas is solid black. CriOS ignores CSS transform on the
 * GL layer (#43 / #44 stamp).
 *
 * #46 used 60fps 2D-copy of the GL canvas into a *bezel-sized* bitmap.
 * On CriOS that readback is often a black cover (READY is painting underneath)
 * and the 60fps tall-buffer resolve OOM-kills the tab: Tom's ~5s solid black,
 * ~15s full reload to the power splash (`powered` is not persisted).
 *
 * This build keeps a fill without that crash:
 *  - copy via `__g64gl.readPixels` + putImageData (never getContext on VICE,
 *    never drawImage of the GL canvas — that resolve is the CriOS killer)
 *  - present *bitmap* stays 384×272; CSS 100% stretches the 2D layer
 *  - ~14fps, reused pixel buffers
 *  - hidden until a lit copy so an empty 2D layer cannot cover READY
 *  - stop on context-lost / repeated read failure (keep last frame)
 *  - never PNG, never recycle
 */

import { glog } from "./debug";

export const IOS_PRESENT_CLASS = "g64-ios-present";
export const IOS_PRESENT_ON_CLASS = "g64-ios-present-on";
export const IOS_PRESENT_W = 384;
export const IOS_PRESENT_H = 272;
/** PR #19: ~15fps was the stable CriOS blit rate. 60fps bezel-sized copies killed the tab. */
export const IOS_PRESENT_MIN_FRAME_MS = 70;
export const IOS_PRESENT_FAIL_LIMIT = 8;

const PIXEL_BYTES = IOS_PRESENT_W * IOS_PRESENT_H * 4;
const ROW_BYTES = IOS_PRESENT_W * 4;

/** Present drawing buffer is always native VICE size — ignore the tall CSS box. */
export function presentBufferSize(_cssW?: number, _cssH?: number) {
  return { w: IOS_PRESENT_W, h: IOS_PRESENT_H };
}

let raf = 0;
let presentEl: HTMLCanvasElement | null = null;
let sourceEl: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;
let paintedOnce = false;
let lastCopy = 0;
let fails = 0;
let pausedLost = false;
let hooked = false;
let onLostBound: ((ev: Event) => void) | null = null;
let pixelBuf: Uint8Array | null = null;
let imageData: ImageData | null = null;

export function isIosPresentActive(): boolean {
  return Boolean(presentEl?.parentElement);
}

export function isIosPresentPainted(): boolean {
  return paintedOnce;
}

export function isIosPresentLooping(): boolean {
  return raf !== 0 && !pausedLost;
}

export function iosPresentInfo() {
  return {
    active: isIosPresentActive(),
    painted: paintedOnce,
    looping: isIosPresentLooping(),
    lost: pausedLost,
    bufW: presentEl?.width ?? 0,
    bufH: presentEl?.height ?? 0,
    on: presentEl?.classList.contains(IOS_PRESENT_ON_CLASS) ?? false,
  };
}

export function stopIosPresent() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  unbindSource();
  ctx2d = null;
  paintedOnce = false;
  lastCopy = 0;
  fails = 0;
  pausedLost = false;
  pixelBuf = null;
  imageData = null;
  if (presentEl) {
    presentEl.remove();
    presentEl = null;
  }
}

/** Keep the last good 2D frame; do not hammer a lost GL context. */
export function pauseIosPresentKeepFrame() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  pausedLost = true;
  glog("ios-present-paused", { painted: paintedOnce });
}

export function resumeIosPresent() {
  pausedLost = false;
  fails = 0;
  if (sourceEl && presentEl && ctx2d && !raf) {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    raf = requestAnimationFrame(tick);
  }
}

function hookOnce() {
  if (hooked || typeof document === "undefined") return;
  hooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    if (pausedLost) return;
    resumeIosPresent();
  });
}

function onSourceLost(ev: Event) {
  try {
    ev.preventDefault();
  } catch {
    /* ignore */
  }
  glog("ios-present-ctx-lost");
  pauseIosPresentKeepFrame();
}

function unbindSource() {
  if (sourceEl && onLostBound) {
    sourceEl.removeEventListener("webglcontextlost", onLostBound);
  }
  onLostBound = null;
  sourceEl = null;
}

function bindSource(src: HTMLCanvasElement) {
  if (sourceEl === src) return;
  unbindSource();
  sourceEl = src;
  onLostBound = onSourceLost;
  src.addEventListener("webglcontextlost", onSourceLost, false);
}

function lockPresentBuffer(el: HTMLCanvasElement) {
  if (el.width !== IOS_PRESENT_W) el.width = IOS_PRESENT_W;
  if (el.height !== IOS_PRESENT_H) el.height = IOS_PRESENT_H;
}

function ensurePresent(box: HTMLElement): HTMLCanvasElement {
  let el = box.querySelector(`canvas.${IOS_PRESENT_CLASS}`) as HTMLCanvasElement | null;
  if (!el) {
    el = document.createElement("canvas");
    el.className = IOS_PRESENT_CLASS;
    el.setAttribute("aria-hidden", "true");
    lockPresentBuffer(el);
    box.appendChild(el);
  } else {
    lockPresentBuffer(el);
  }
  return el;
}

function glOf(src: HTMLCanvasElement): WebGLRenderingContext | WebGL2RenderingContext | null {
  const gl = (src as HTMLCanvasElement & { __g64gl?: WebGLRenderingContext | WebGL2RenderingContext })
    .__g64gl;
  if (!gl) return null;
  try {
    if (gl.isContextLost()) return null;
  } catch {
    return null;
  }
  return gl;
}

function copiedLooksLit(data: Uint8ClampedArray): boolean {
  const spots = [32 + 32 * IOS_PRESENT_W, 192 + 136 * IOS_PRESENT_W, 300 + 80 * IOS_PRESENT_W, 80 + 200 * IOS_PRESENT_W];
  for (const px of spots) {
    const i = px * 4;
    if (i + 2 >= data.length) continue;
    if (Math.max(data[i], data[i + 1], data[i + 2]) >= 28) return true;
  }
  return false;
}

function revealIfReady(data: Uint8ClampedArray) {
  if (paintedOnce || !presentEl) return;
  if (!copiedLooksLit(data)) return;
  paintedOnce = true;
  presentEl.classList.add(IOS_PRESENT_ON_CLASS);
  glog("ios-present-on");
}

function copyFrame(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  ctx: CanvasRenderingContext2D,
): boolean {
  let prev: unknown = null;
  try {
    prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  } catch {
    prev = null;
  }
  if (gl.drawingBufferWidth < 64 || gl.drawingBufferHeight < 64) return false;
  try {
    if (prev) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  } catch {
    return false;
  }

  if (!pixelBuf || pixelBuf.length !== PIXEL_BYTES) pixelBuf = new Uint8Array(PIXEL_BYTES);
  try {
    gl.readPixels(0, 0, IOS_PRESENT_W, IOS_PRESENT_H, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf);
  } finally {
    if (prev) {
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, prev as WebGLFramebuffer);
      } catch {
        /* VICE will rebind next frame */
      }
    }
  }

  if (!imageData || imageData.width !== IOS_PRESENT_W || imageData.height !== IOS_PRESENT_H) {
    imageData = ctx.createImageData(IOS_PRESENT_W, IOS_PRESENT_H);
  }
  const dst = imageData.data;
  const src = pixelBuf;
  // WebGL origin is bottom-left; 2D canvas is top-left.
  for (let y = 0; y < IOS_PRESENT_H; y++) {
    const srcOff = (IOS_PRESENT_H - 1 - y) * ROW_BYTES;
    dst.set(src.subarray(srcOff, srcOff + ROW_BYTES), y * ROW_BYTES);
  }
  ctx.putImageData(imageData, 0, 0);
  return true;
}

function tick(now: number) {
  raf = 0;
  const src = sourceEl;
  const dest = presentEl;
  const ctx = ctx2d;
  if (!src || !dest || !ctx || pausedLost) return;

  lockPresentBuffer(dest);

  if (lastCopy && now - lastCopy < IOS_PRESENT_MIN_FRAME_MS) {
    raf = requestAnimationFrame(tick);
    return;
  }

  const gl = glOf(src);
  if (!gl) {
    fails += 1;
    if (fails >= IOS_PRESENT_FAIL_LIMIT) {
      pauseIosPresentKeepFrame();
      return;
    }
    raf = requestAnimationFrame(tick);
    return;
  }

  try {
    if (copyFrame(gl, ctx)) {
      lastCopy = now;
      fails = 0;
      if (imageData) revealIfReady(imageData.data);
    }
  } catch {
    fails += 1;
    if (fails >= IOS_PRESENT_FAIL_LIMIT) {
      pauseIosPresentKeepFrame();
      return;
    }
  }

  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  raf = requestAnimationFrame(tick);
}

/** Start (or keep) the bezel-filling present of the live WebGL canvas. */
export function startIosPresent(glCanvas: HTMLCanvasElement, box: HTMLElement) {
  if (typeof document === "undefined") return;
  hookOnce();
  bindSource(glCanvas);
  presentEl = ensurePresent(box);
  if (!ctx2d || ctx2d.canvas !== presentEl) {
    ctx2d = presentEl.getContext("2d", { alpha: false, willReadFrequently: false });
  }
  lockPresentBuffer(presentEl);
  if (pausedLost) return;
  if (document.visibilityState === "hidden") return;
  if (!raf) raf = requestAnimationFrame(tick);
}
