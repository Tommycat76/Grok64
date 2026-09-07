/**
 * iOS CRT compositor — stretch the live VICE WebGL framebuffer to the bezel.
 *
 * VICE only blits when the WebGL canvas CSS box is the native 384×272.
 * CSS 100% on that canvas is solid black. CriOS ignores CSS transform on the
 * GL layer (#43 / #44 stamp).
 *
 * #46 copied the GL canvas with 60fps drawImage into a *bezel-sized* 2D
 * canvas (tall phone ≈ 374×650). That is a GPU readback every frame on top
 * of VICE WASM — the same class of CriOS OOM as PR #19 (mirror paint loops).
 * Tom on live #46: ~5s solid black CRT, ~15s full reload back to splash
 * (`powered` is not persisted, so a tab kill looks like a remount).
 *
 * This build keeps a path that fills without that crash:
 *  - present *bitmap* stays 384×272; CSS 100% stretches the 2D layer
 *    (2D compositing honors CSS; WebGL does not)
 *  - copies at ~14fps, not every rAF
 *  - stays hidden until a lit copy so we never cover READY with empty black
 *  - stops the loop on context-lost / repeated drawImage failure (keeps last frame)
 *  - never PNG, never getContext on the VICE canvas, never recycle
 */

import { glog } from "./debug";

export const IOS_PRESENT_CLASS = "g64-ios-present";
export const IOS_PRESENT_ON_CLASS = "g64-ios-present-on";
export const IOS_PRESENT_W = 384;
export const IOS_PRESENT_H = 272;
/** PR #19: ~15fps was the stable CriOS blit rate. 60fps bezel-sized copies killed the tab. */
export const IOS_PRESENT_MIN_FRAME_MS = 70;
export const IOS_PRESENT_FAIL_LIMIT = 8;

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

function glOk(src: HTMLCanvasElement): boolean {
  const gl = (src as HTMLCanvasElement & { __g64gl?: WebGLRenderingContext }).__g64gl;
  if (!gl) return src.width >= 8 && src.height >= 8;
  try {
    return !gl.isContextLost();
  } catch {
    return false;
  }
}

function copiedLooksLit(ctx: CanvasRenderingContext2D): boolean | "unknown" {
  try {
    const spots: Array<[number, number]> = [
      [32, 32],
      [192, 136],
      [300, 80],
      [80, 200],
    ];
    for (const [x, y] of spots) {
      const { data } = ctx.getImageData(x, y, 8, 8);
      for (let i = 0; i < data.length; i += 4) {
        if (Math.max(data[i], data[i + 1], data[i + 2]) >= 28) return true;
      }
    }
    return false;
  } catch {
    return "unknown";
  }
}

function revealIfReady(ctx: CanvasRenderingContext2D) {
  if (paintedOnce || !presentEl) return;
  const lit = copiedLooksLit(ctx);
  if (lit === false) return;
  paintedOnce = true;
  presentEl.classList.add(IOS_PRESENT_ON_CLASS);
  glog("ios-present-on", { lit });
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

  if (!glOk(src)) {
    fails += 1;
    if (fails >= IOS_PRESENT_FAIL_LIMIT) {
      pauseIosPresentKeepFrame();
      return;
    }
    raf = requestAnimationFrame(tick);
    return;
  }

  try {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, IOS_PRESENT_W, IOS_PRESENT_H);
    lastCopy = now;
    fails = 0;
    revealIfReady(ctx);
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
    ctx2d = presentEl.getContext("2d", { alpha: false });
  }
  lockPresentBuffer(presentEl);
  if (pausedLost) return;
  if (document.visibilityState === "hidden") return;
  if (!raf) raf = requestAnimationFrame(tick);
}
