import type { EjsInstance } from "./host";
import { dismissEjsPrompts, fitEmu, unlockAudio } from "./host";
import { isIosPhone } from "./detect";
import { glog } from "./debug";

function copyBytes(raw: Uint8Array | ArrayBuffer | null | undefined): Uint8Array | null {
  if (!raw) return null;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw.slice(0));
  if (raw instanceof Uint8Array) return new Uint8Array(raw);
  return null;
}

function pngLooksValid(raw: Uint8Array | null): boolean {
  return Boolean(
    raw &&
      raw.byteLength >= 2500 &&
      raw[0] === 0x89 &&
      raw[1] === 0x50 &&
      raw[2] === 0x4e &&
      raw[3] === 0x47,
  );
}

/** Decode a PNG blob for canvas draw — Image() is more reliable than createImageBitmap on CriOS. */
async function decodePngBlob(blob: Blob): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D) => void; dispose: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      return {
        width: bmp.width,
        height: bmp.height,
        draw: (ctx) => ctx.drawImage(bmp, 0, 0),
        dispose: () => bmp.close?.(),
      };
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("img-decode"));
      img.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx) => ctx.drawImage(img, 0, 0),
      dispose: () => {
        img.src = "";
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Sample PNG screenshot luminance — rejects black PNGs that still exceed byte thresholds. */
export async function frameImageMetrics(raw: Uint8Array | null): Promise<{ lum: number; uniq: number } | null> {
  const u8 = copyBytes(raw);
  if (!u8 || u8.byteLength < 2500) return null;
  if (!pngLooksValid(u8)) return u8.byteLength > 8000 ? { lum: 40, uniq: 2 } : null;
  try {
    const blob = new Blob([new Uint8Array(u8)], { type: "image/png" });
    const decoded = await decodePngBlob(blob);
    const side = Math.min(48, decoded.width, decoded.height);
    const c = document.createElement("canvas");
    c.width = side;
    c.height = side;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      decoded.dispose();
      return null;
    }
    decoded.draw(ctx);
    decoded.dispose();
    const data = ctx.getImageData(0, 0, side, side).data;
    let lum = 0;
    const buckets = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      lum += (r + g + b) / 3;
      buckets.add((r >> 4) * 256 + (g >> 4) * 16 + (b >> 4));
    }
    const px = data.length / 4;
    return { lum: lum / px, uniq: buckets.size };
  } catch {
    return u8.byteLength > 8000 ? { lum: 40, uniq: 2 } : null;
  }
}

function playerCanvas(root: HTMLElement | null): HTMLCanvasElement | null {
  return (
    (root?.querySelector("canvas:not(.g64-ios-mirror)") as HTMLCanvasElement | null) ??
    (document.querySelector("#grok64-player canvas:not(.g64-ios-mirror)") as HTMLCanvasElement | null)
  );
}

function mirrorCanvas(root: HTMLElement | null): HTMLCanvasElement | null {
  return (
    (root?.querySelector(".g64-ios-mirror") as HTMLCanvasElement | null) ??
    (document.querySelector("#grok64-player .g64-ios-mirror") as HTMLCanvasElement | null)
  );
}

function setMirrorVisible(root: HTMLElement | null, on: boolean) {
  const player =
    root?.closest("#grok64-player") ??
    root ??
    document.getElementById("grok64-player");
  player?.classList.toggle("g64-ios-mirror-on", on);
}

async function elementHasFrame(el: HTMLCanvasElement | null): Promise<boolean> {
  if (!el || el.width < 8 || el.height < 8) return false;
  try {
    const url = el.toDataURL("image/png");
    const bin = atob(url.split(",")[1] || "");
    const raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
    const m = await frameImageMetrics(raw);
    return Boolean(m && m.lum > 4 && m.uniq >= 2);
  } catch {
    return false;
  }
}

/** Nudge iOS WebKit to composite a preserveDrawingBuffer WebGL framebuffer. */
export function forceCanvasPresent(canvas: HTMLCanvasElement | null) {
  if (!canvas || canvas.width < 8 || canvas.height < 8) return;
  try {
    const gl =
      (canvas.getContext("webgl2", { preserveDrawingBuffer: true }) as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl", { preserveDrawingBuffer: true }) as WebGLRenderingContext | null);
    if (gl) {
      gl.finish?.();
      const buf = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    }
    canvas.toDataURL("image/png");
  } catch {
    /* ignore */
  }
}

/** True when the GL canvas has composited pixels (not a black shell). */
export async function canvasHasFrame(_emu: EjsInstance | null, root?: HTMLElement | null): Promise<boolean> {
  const canvas = playerCanvas(root ?? null);
  if (!canvas || canvas.width < 8 || canvas.height < 8) return false;
  forceCanvasPresent(canvas);
  return elementHasFrame(canvas);
}

/** True when either native GL or the iOS VICE mirror shows a non-black frame. */
export async function displayHasFrame(emu: EjsInstance | null, root?: HTMLElement | null): Promise<boolean> {
  if (await canvasHasFrame(emu, root)) return true;
  return elementHasFrame(mirrorCanvas(root ?? null));
}

/** Kick WebGL/main-loop on iOS WebKit — pass fromUserGesture=true inside tap handlers. */
export function kickIosPaint(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  tag = "kick",
  fromUserGesture = false,
) {
  if (!isIosPhone() || !emu) return;
  unlockAudio(emu);
  if (fromUserGesture) dismissEjsPrompts(root, "play");
  else dismissEjsPrompts(root, "boot");
  try {
    emu.paused = false;
  } catch {
    /* ignore */
  }
  try {
    emu.gameManager?.toggleMainLoop(1);
  } catch {
    /* ignore */
  }
  try {
    const canvas = (emu.Module?.canvas as HTMLCanvasElement | undefined) ?? playerCanvas(root);
    if (canvas) {
      if (canvas.tabIndex < 0) canvas.tabIndex = 0;
      canvas.focus?.();
      forceCanvasPresent(canvas);
    }
  } catch {
    /* ignore */
  }
  fitEmu(root, emu);
  try {
    window.dispatchEvent(new Event("resize"));
  } catch {
    /* ignore */
  }
  glog(`ios-paint-${tag}`);
}

export function scheduleIosPaintKicks(emu: EjsInstance | null, root: HTMLElement | null) {
  if (!isIosPhone() || !emu) return;
  const delays = [0, 50, 120, 250, 500, 1000, 2000, 4000];
  for (const ms of delays) {
    window.setTimeout(() => kickIosPaint(emu, root, `t${ms}`), ms);
  }
}

/** True when VICE reports a visible framebuffer (not a black PNG shell). */
export async function viceHasFrame(emu: EjsInstance | null): Promise<boolean> {
  if (!emu?.gameManager?.screenshot) return false;
  try {
    const raw = copyBytes(await emu.gameManager.screenshot());
    const m = await frameImageMetrics(raw);
    return Boolean(m && m.lum > 4 && m.uniq >= 2);
  } catch {
    return false;
  }
}

export async function waitForViceFrame(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  timeoutMs = 12_000,
): Promise<boolean> {
  if (!isIosPhone() || !emu) return true;
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    kickIosPaint(emu, root, "wait");
    if (await displayHasFrame(emu, root)) {
      glog("ios-frame-ok", { ms: Math.round(performance.now() - t0) });
      return true;
    }
    await new Promise((r) => window.setTimeout(r, 120));
  }
  glog("ios-frame-timeout", { ms: timeoutMs });
  return false;
}

/* ── VICE → 2D mirror (auto-paint when WebGL won't composite on CriOS) ── */

let mirrorGen = 0;
let mirrorRaf = 0;
let mirrorTimer = 0;
let mirrorActive = false;
let mirrorPainted = false;
let mirrorEmu: EjsInstance | null = null;

export function isIosMirrorActive(): boolean {
  return mirrorActive;
}

export function isIosMirrorPainted(): boolean {
  return mirrorPainted;
}

export function stopIosViceMirror() {
  mirrorGen += 1;
  if (mirrorRaf) cancelAnimationFrame(mirrorRaf);
  mirrorRaf = 0;
  if (mirrorTimer) window.clearInterval(mirrorTimer);
  mirrorTimer = 0;
  mirrorActive = false;
  mirrorPainted = false;
  mirrorEmu = null;
  setMirrorVisible(null, false);
  const el = document.querySelector("#grok64-player .g64-ios-mirror");
  el?.remove();
}

function ensureMirrorCanvas(root: HTMLElement | null): HTMLCanvasElement | null {
  const parent =
    (root?.querySelector(".ejs_canvas_parent") as HTMLElement | null) ??
    root ??
    document.getElementById("grok64-player");
  if (!parent) return null;
  let canvas = parent.querySelector(".g64-ios-mirror") as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "g64-ios-mirror";
    canvas.setAttribute("aria-hidden", "true");
    parent.appendChild(canvas);
  }
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  return canvas;
}

async function blitPngToMirror(
  root: HTMLElement | null,
  raw: Uint8Array,
  metrics?: { lum: number; uniq: number } | null,
): Promise<boolean> {
  const canvas = ensureMirrorCanvas(root);
  if (!canvas) return false;
  const m = metrics ?? (await frameImageMetrics(raw));
  if (!m || m.lum <= 4) return false;
  try {
    const blob = new Blob([new Uint8Array(raw)], { type: "image/png" });
    const decoded = await decodePngBlob(blob);
    if (canvas.width !== decoded.width) canvas.width = decoded.width;
    if (canvas.height !== decoded.height) canvas.height = decoded.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      decoded.dispose();
      return false;
    }
    decoded.draw(ctx);
    decoded.dispose();
    setMirrorVisible(root, true);
    return true;
  } catch (err) {
    glog("ios-mirror-blit-fail", { m: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

async function blitGlCanvasToMirror(root: HTMLElement | null): Promise<boolean> {
  const src = playerCanvas(root);
  if (!src || src.width < 8) return false;
  forceCanvasPresent(src);
  try {
    const url = src.toDataURL("image/png");
    const bin = atob(url.split(",")[1] || "");
    const raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
    return await blitPngToMirror(root, raw);
  } catch {
    return false;
  }
}

/** One-shot VICE screenshot → mirror blit (user-gesture path). */
export async function forceIosMirrorBlit(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  fromUserGesture = false,
): Promise<boolean> {
  if (!isIosPhone() || !emu) return false;
  if (fromUserGesture) {
    const glOk = await blitGlCanvasToMirror(root);
    if (glOk) {
      mirrorPainted = true;
      glog("ios-mirror-painted-gl");
      return true;
    }
  }
  if (!emu.gameManager?.screenshot) return false;
  try {
    const raw = copyBytes(await emu.gameManager.screenshot());
    if (!raw || !pngLooksValid(raw)) return false;
    const ok = await blitPngToMirror(root, raw);
    if (ok) {
      mirrorPainted = true;
      glog("ios-mirror-painted-force");
    }
    return ok;
  } catch (err) {
    glog("ios-mirror-force-fail", { m: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Blit VICE screenshots to a 2D overlay — works on CriOS without user gesture
 * when preserveDrawingBuffer WebGL stays black on screen.
 */
export function startIosViceMirror(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  onFirstPaint?: () => void,
) {
  if (!isIosPhone() || !emu?.gameManager?.screenshot) return;
  if (mirrorActive && mirrorEmu === emu) {
    if (mirrorPainted) onFirstPaint?.();
    return;
  }
  stopIosViceMirror();
  const gen = mirrorGen;
  const canvas = ensureMirrorCanvas(root);
  if (!canvas) return;
  mirrorActive = true;
  mirrorEmu = emu;
  let pending = false;
  let ticks = 0;
  let paintedCb = onFirstPaint ?? null;

  const capture = () => {
    if (gen !== mirrorGen || pending) return;
    pending = true;
    void emu
      .gameManager!.screenshot!()
      .then(async (raw) => {
        if (gen !== mirrorGen) return;
        const u8 = copyBytes(raw);
        if (!u8 || !pngLooksValid(u8)) return;
        const m = await frameImageMetrics(u8);
        if (!m || m.lum <= 4) return;
        const ok = await blitPngToMirror(root, u8, m);
        if (!ok) return;
        if (!mirrorPainted) {
          mirrorPainted = true;
          glog("ios-mirror-painted");
          paintedCb?.();
          paintedCb = null;
        }
      })
      .catch((err) => {
        glog("ios-mirror-capture-fail", { m: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        pending = false;
      });
  };

  const tick = () => {
    if (gen !== mirrorGen) return;
    mirrorRaf = requestAnimationFrame(tick);
    ticks += 1;
    if (ticks % 30 === 0) {
      void canvasHasFrame(emu, root).then((native) => {
        if (gen !== mirrorGen || !native) return;
        glog("ios-mirror-handoff-native");
        paintedCb?.();
        paintedCb = null;
        stopIosViceMirror();
      });
    }
  };
  mirrorRaf = requestAnimationFrame(tick);
  mirrorTimer = window.setInterval(capture, 180);
  capture();
}

type PaintTarget = { emu: EjsInstance | null; root: HTMLElement | null };
let watchdogGen = 0;
let watchdogRaf = 0;
let hooksInstalled = false;
let activeTarget: PaintTarget = { emu: null, root: null };
let onPaintedCb: (() => void) | null = null;
let onTimeoutCb: (() => void) | null = null;
let tapCooldownUntil = 0;

export function stopIosPaintWatchdog() {
  watchdogGen += 1;
  if (watchdogRaf) cancelAnimationFrame(watchdogRaf);
  watchdogRaf = 0;
}

export type IosPaintWatchdogOpts = {
  onPainted?: () => void;
  /** Last resort when auto-paint (mirror + native kicks) fails — show tap-to-wake. */
  onTimeout?: () => void;
  maxFrames?: number;
};

/** Auto-paint: VICE mirror + native compositor kicks; tap fallback only on timeout. */
export function startIosPaintWatchdog(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  opts?: IosPaintWatchdogOpts | (() => void),
) {
  if (!isIosPhone() || !emu) return;
  const resolved: IosPaintWatchdogOpts =
    typeof opts === "function" ? { onPainted: opts } : (opts ?? {});
  activeTarget = { emu, root };
  onPaintedCb = resolved.onPainted ?? null;
  onTimeoutCb = resolved.onTimeout ?? null;
  stopIosPaintWatchdog();

  let painted = false;
  const signalPainted = () => {
    if (painted) return;
    painted = true;
    onPaintedCb?.();
    onPaintedCb = null;
    onTimeoutCb = null;
    stopIosPaintWatchdog();
  };

  if (mirrorPainted) {
    signalPainted();
    return;
  }

  startIosViceMirror(emu, root, signalPainted);

  const gen = watchdogGen;
  let frames = 0;
  const maxFrames = resolved.maxFrames ?? 480;
  const started = performance.now();

  const tick = () => {
    if (gen !== watchdogGen) return;
    frames += 1;
    const { emu: e, root: r } = activeTarget;
    if (!e) return;
    kickIosPaint(e, r, `wd${frames}`);
    if (mirrorPainted) {
      signalPainted();
      return;
    }
    void displayHasFrame(e, r).then((ok) => {
      if (gen !== watchdogGen) return;
      if (ok || mirrorPainted) {
        glog("ios-watchdog-painted", { frames, mirror: mirrorActive, mirrorPainted });
        signalPainted();
        return;
      }
      const elapsed = performance.now() - started;
      if (frames < maxFrames && elapsed < 14_000) {
        watchdogRaf = requestAnimationFrame(tick);
      } else {
        glog("ios-watchdog-timeout", { frames, mirror: mirrorActive, mirrorPainted, elapsed: Math.round(elapsed) });
        if (!painted && !mirrorPainted) {
          if (performance.now() < tapCooldownUntil) {
            glog("ios-resume-cooldown");
            watchdogRaf = requestAnimationFrame(tick);
            return;
          }
          onTimeoutCb?.();
        }
        onTimeoutCb = null;
        scheduleIosPaintKicks(e, r);
      }
    });
  };
  watchdogRaf = requestAnimationFrame(tick);
}

/** Suppress tap overlay for a few seconds after the user already tapped. */
export function iosTapResumeCooldown(ms = 8000) {
  tapCooldownUntil = performance.now() + ms;
}

export function installIosPaintHooks(getTarget: () => PaintTarget) {
  if (!isIosPhone() || hooksInstalled || typeof window === "undefined") return;
  hooksInstalled = true;

  const resume = () => {
    const { emu, root } = getTarget();
    if (!emu) return;
    kickIosPaint(emu, root, "resume");
    startIosPaintWatchdog(emu, root);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resume();
  });
  window.addEventListener("pageshow", (ev) => {
    if ((ev as PageTransitionEvent).persisted) resume();
  });
  window.addEventListener("focus", resume);

  const onCtxLost = (ev: Event) => {
    glog("webgl-context-lost");
    ev.preventDefault();
    const { emu, root } = getTarget();
    if (emu) scheduleIosPaintKicks(emu, root);
  };
  const onCtxRestored = () => {
    glog("webgl-context-restored");
    resume();
  };

  const watchCanvas = () => {
    const canvas = playerCanvas(getTarget().root);
    if (!canvas) return;
    canvas.addEventListener("webglcontextlost", onCtxLost, false);
    canvas.addEventListener("webglcontextrestored", onCtxRestored, false);
  };

  const obs = new MutationObserver(() => watchCanvas());
  const player = document.getElementById("grok64-player");
  if (player) obs.observe(player, { childList: true, subtree: true });
  watchCanvas();
}

/** Prefer mirror canvas for QA readback when native GL is still black. */
export function shotDisplayCanvas(root?: HTMLElement | null): HTMLCanvasElement | null {
  const mirror = mirrorCanvas(root ?? null);
  if (mirror && mirror.width >= 8) return mirror;
  return playerCanvas(root ?? null);
}
