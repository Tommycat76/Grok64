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
      raw.byteLength >= 350 &&
      raw[0] === 0x89 &&
      raw[1] === 0x50 &&
      raw[2] === 0x4e &&
      raw[3] === 0x47,
  );
}

export type IosCrtPath = "png" | "gl-blit" | "live-webgl";

/**
 * CriOS CRT policy: PNG screenshot is optional. If it is missing, never stay
 * on a black overlay — blit WebGL or show the live canvas (pre-#37 path).
 */
export function chooseIosCrtPath(input: {
  pngValid: boolean;
  glLooksReady: boolean;
}): IosCrtPath {
  if (input.pngValid) return "png";
  if (input.glLooksReady) return "gl-blit";
  return "live-webgl";
}

type PngDraw = (
  ctx: CanvasRenderingContext2D,
  dw?: number,
  dh?: number,
) => void;

/** Decode a PNG blob for canvas draw — Image() is more reliable than createImageBitmap on CriOS. */
async function decodePngBlob(blob: Blob): Promise<{
  width: number;
  height: number;
  draw: PngDraw;
  dispose: () => void;
}> {
  // CriOS createImageBitmap often yields an empty/wrong bitmap. Prefer Image().
  if (!isIosPhone() && typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      return {
        width: bmp.width,
        height: bmp.height,
        draw: (ctx, dw, dh) =>
          dw && dh ? ctx.drawImage(bmp, 0, 0, dw, dh) : ctx.drawImage(bmp, 0, 0),
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
      draw: (ctx, dw, dh) =>
        dw && dh ? ctx.drawImage(img, 0, 0, dw, dh) : ctx.drawImage(img, 0, 0),
      dispose: () => {
        img.src = "";
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function readFsPng(FS: { readFile?: (p: string) => Uint8Array | string | ArrayBuffer } | null | undefined) {
  if (!FS?.readFile) return null;
  for (const p of ["/screenshot.png", "screenshot.png"]) {
    try {
      const raw = FS.readFile(p);
      const u8 = typeof raw === "string" ? null : copyBytes(raw);
      if (pngLooksValid(u8)) return u8;
    } catch {
      /* missing */
    }
  }
  return null;
}

/**
 * EJS GameManager.screenshot() spins forever until screenshot.png appears.
 * After play-recycle that file often never lands (paused loop / wiped GL),
 * so the mirror + watchdog deadlock and the UI only logs ios-paint-poll.
 * Drive cmd_take_screenshot ourselves and time out.
 */
let shotTail: Promise<unknown> = Promise.resolve();
let pngAbandoned = false;
let pngTimeouts = 0;
let paintSettled = false;
let paintPath: IosCrtPath | null = null;
let mirrorPainted = false;

export async function viceScreenshot(
  emu: EjsInstance | null,
  timeoutMs = 1600,
): Promise<Uint8Array | null> {
  if (!emu?.gameManager || pngAbandoned) return null;
  const run = async () => {
    const gm = emu.gameManager!;
    const FS = gm.FS ?? emu.Module?.FS ?? null;
    const cmd = gm.functions?.screenshot;
    if (FS && typeof cmd === "function") {
      try {
        FS.unlink?.("screenshot.png");
      } catch {
        /* missing */
      }
      try {
        FS.unlink?.("/screenshot.png");
      } catch {
        /* missing */
      }
      try {
        cmd();
      } catch {
        glog("ios-screenshot-cmd-fail");
        return null;
      }
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const hit = readFsPng(FS);
        if (hit) return hit;
        await sleep(50);
      }
      glog("ios-screenshot-timeout", { ms: timeoutMs });
      pngTimeouts += 1;
      if (pngTimeouts >= 1) pngAbandoned = true;
      return null;
    }
    if (typeof gm.screenshot !== "function") return null;
    try {
      const raced = await Promise.race([
        gm.screenshot().then((raw) => copyBytes(raw)),
        sleep(timeoutMs).then(() => null),
      ]);
      if (!raced) {
        glog("ios-screenshot-timeout", { ms: timeoutMs, via: "ejs" });
        pngTimeouts += 1;
        if (pngTimeouts >= 1) pngAbandoned = true;
      }
      return raced;
    } catch (err) {
      glog("ios-screenshot-fail", { m: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };
  const next = shotTail.then(run, run);
  shotTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

let metricsCanvas: HTMLCanvasElement | null = null;

/** Sample PNG screenshot luminance — rejects black PNGs that still exceed byte thresholds. */
export async function frameImageMetrics(raw: Uint8Array | null): Promise<{ lum: number; uniq: number } | null> {
  const u8 = copyBytes(raw);
  if (!u8 || u8.byteLength < 350) return null;
  if (!pngLooksValid(u8)) return null;
  try {
    const blob = new Blob([new Uint8Array(u8)], { type: "image/png" });
    if (!metricsCanvas) metricsCanvas = document.createElement("canvas");
    const c = metricsCanvas;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    // Full-frame downsample — C64 corners are solid border and used to reject READY.
    const decoded = await decodePngBlob(blob);
    const side = 48;
    c.width = side;
    c.height = side;
    decoded.draw(ctx, side, side);
    decoded.dispose();
    return samplePixels(ctx.getImageData(0, 0, side, side).data);
  } catch {
    return null;
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

type GlTaggedCanvas = HTMLCanvasElement & {
  __g64gl?: WebGLRenderingContext | WebGL2RenderingContext;
};

const glReadCache = new WeakMap<HTMLCanvasElement, WebGLRenderingContext | WebGL2RenderingContext>();

/** Retrieve VICE's WebGL context. Never call canvas.getContext — that can steal or null it on CriOS. */
function cachedGl(canvas: HTMLCanvasElement): WebGLRenderingContext | WebGL2RenderingContext | null {
  const existing = glReadCache.get(canvas);
  if (existing && !existing.isContextLost?.()) return existing;
  const tagged = (canvas as GlTaggedCanvas).__g64gl;
  if (tagged && !tagged.isContextLost?.()) {
    glReadCache.set(canvas, tagged);
    return tagged;
  }
  return null;
}

function samplePixels(data: ArrayLike<number>): { lum: number; uniq: number } {
  let lum = 0;
  const buckets = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    lum += (r + g + b) / 3;
    buckets.add((r >> 4) * 256 + (g >> 4) * 16 + (b >> 4));
  }
  const px = data.length / 4 || 1;
  return { lum: lum / px, uniq: buckets.size };
}

function pixelsLookLive(m: { lum: number; uniq: number } | null): boolean {
  return Boolean(m && m.lum > 4 && m.uniq >= 2);
}

/**
 * Stricter than pixelsLookLive — rejects black boots and CriOS GL garbage
 * (checkerboard / high-entropy noise) while accepting KERNAL + BASIC READY.
 */
export function frameLooksReady(m: { lum: number; uniq: number } | null): boolean {
  if (!m) return false;
  if (m.lum <= 6 || m.uniq < 2) return false;
  if (m.uniq > 42) return false;
  if (m.lum > 150 && m.uniq > 20) return false;
  return m.lum >= 12;
}

function sampleGlCanvas(canvas: HTMLCanvasElement): { lum: number; uniq: number } | null {
  try {
    const gl = cachedGl(canvas);
    if (!gl) return null;
    gl.finish?.();
    const side = 8;
    const buf = new Uint8Array(side * side * 4);
    const x = Math.max(0, Math.floor(canvas.width / 2) - 4);
    const y = Math.max(0, Math.floor(canvas.height / 2) - 4);
    gl.readPixels(x, y, side, side, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return samplePixels(buf);
  } catch {
    return null;
  }
}

function sample2dCanvas(canvas: HTMLCanvasElement): { lum: number; uniq: number } | null {
  try {
    const side = Math.min(16, canvas.width, canvas.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || side < 4) return null;
    return samplePixels(ctx.getImageData(0, 0, side, side).data);
  } catch {
    return null;
  }
}

async function elementHasFrame(el: HTMLCanvasElement | null): Promise<boolean> {
  if (!el || el.width < 8 || el.height < 8) return false;
  forceCanvasPresent(el);
  if (el.classList.contains("g64-ios-mirror")) {
    return pixelsLookLive(sample2dCanvas(el));
  }
  return pixelsLookLive(sampleGlCanvas(el));
}

/** Nudge iOS WebKit to composite a preserveDrawingBuffer WebGL framebuffer. */
export function forceCanvasPresent(canvas: HTMLCanvasElement | null) {
  if (!canvas || canvas.width < 8 || canvas.height < 8) return;
  try {
    if (canvas.classList.contains("g64-ios-mirror")) return;
    const gl = cachedGl(canvas);
    if (gl) {
      gl.finish?.();
      const buf = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    }
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

/** True when the CRT is showing something — overlay, live WebGL, or (optional) PNG. */
export async function displayHasFrame(emu: EjsInstance | null, root?: HTMLElement | null): Promise<boolean> {
  if (paintSettled && (paintPath === "live-webgl" || mirrorPainted)) return true;
  if (mirrorPainted) {
    const mirror = mirrorCanvas(root ?? null);
    if (mirror && mirror.width >= 8) return elementHasFrame(mirror);
  }
  if (await canvasHasFrame(emu, root)) return true;
  return false;
}

let lastPollLog = 0;

export function isIosPaintSettled(): boolean {
  return paintSettled;
}

export function iosCrtPath(): IosCrtPath | null {
  return paintPath;
}

export function resetIosPaintState() {
  paintSettled = false;
  paintPath = null;
  pngAbandoned = false;
  pngTimeouts = 0;
  mirrorPainted = false;
}

function markPaintSettled() {
  paintSettled = true;
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
  else if (!paintSettled) dismissEjsPrompts(root, "boot");
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
  if (!paintSettled || fromUserGesture) {
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
    const shouldFit =
      fromUserGesture || tag === "settle" || tag === "resume" || tag === "play-unlock";
    if (shouldFit) {
      fitEmu(root, emu);
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {
        /* ignore */
      }
    }
  }
  if (tag === "poll") {
    if (performance.now() - lastPollLog > 2000) {
      lastPollLog = performance.now();
      glog("ios-paint-poll");
    }
  } else {
    glog(`ios-paint-${tag}`);
  }
  if (!paintSettled) startIosViceMirror(emu, root);
}

export function scheduleIosPaintKicks(emu: EjsInstance | null, root: HTMLElement | null) {
  if (!isIosPhone() || !emu || paintSettled) return;
  const delays = [0, 50, 120, 250, 500, 1000, 2000, 4000];
  for (const ms of delays) {
    window.setTimeout(() => kickIosPaint(emu, root, `t${ms}`), ms);
  }
}

/** True when VICE reports a visible framebuffer (not a black PNG shell). */
export async function viceHasFrame(emu: EjsInstance | null): Promise<boolean> {
  try {
    const raw = await viceScreenshot(emu);
    const m = await frameImageMetrics(raw);
    return pixelsLookLive(m);
  } catch {
    return false;
  }
}

/** True when a VICE screenshot looks like KERNAL / BASIC READY (not boot garbage). */
export async function viceHasReadyFrame(emu: EjsInstance | null): Promise<boolean> {
  try {
    const raw = await viceScreenshot(emu);
    const m = await frameImageMetrics(raw);
    return frameLooksReady(m);
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
let mirrorActive = false;
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
  mirrorActive = false;
  mirrorPainted = false;
  mirrorEmu = null;
  mirrorLastCapture = 0;
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

function mirrorHasLivePixels(canvas: HTMLCanvasElement): boolean {
  return pixelsLookLive(sample2dCanvas(canvas));
}

async function blitGlToMirror(root: HTMLElement | null): Promise<boolean> {
  const src = playerCanvas(root ?? null);
  if (!src || src.width < 8 || src.height < 8) return false;
  const gl = cachedGl(src);
  if (!gl) return false;
  const canvas = ensureMirrorCanvas(root);
  if (!canvas) return false;
  try {
    gl.finish?.();
    const w = src.width;
    const h = src.height;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return false;
    const imageData = ctx.createImageData(w, h);
    const row = w * 4;
    for (let y = 0; y < h; y++) {
      imageData.data.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    }
    ctx.putImageData(imageData, 0, 0);
    if (!mirrorHasLivePixels(canvas)) return false;
    setMirrorVisible(root, true);
    return true;
  } catch {
    return false;
  }
}

/** Non-PNG blit — drawImage of the live WebGL canvas. Does not need readPixels. */
async function blitCanvasDrawImage(root: HTMLElement | null): Promise<boolean> {
  const src = playerCanvas(root ?? null);
  if (!src || src.width < 8 || src.height < 8) return false;
  const canvas = ensureMirrorCanvas(root);
  if (!canvas) return false;
  try {
    if (canvas.width !== src.width) canvas.width = src.width;
    if (canvas.height !== src.height) canvas.height = src.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return false;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    if (!mirrorHasLivePixels(canvas)) return false;
    setMirrorVisible(root, true);
    return true;
  } catch {
    return false;
  }
}

async function blitPngToMirror(
  root: HTMLElement | null,
  raw: Uint8Array,
  metrics?: { lum: number; uniq: number } | null,
  skipMetrics = false,
): Promise<boolean> {
  const canvas = ensureMirrorCanvas(root);
  if (!canvas) return false;
  if (!skipMetrics) {
    const m = metrics ?? (await frameImageMetrics(raw));
    if (!pixelsLookLive(m)) return false;
  } else if (!pngLooksValid(raw)) {
    return false;
  }
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

/** One-shot blit. PNG is optional — user-gesture resume must still uncover live WebGL. */
export async function forceIosMirrorBlit(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  _fromUserGesture = false,
): Promise<boolean> {
  if (!isIosPhone() || !emu) return false;
  try {
    const src = playerCanvas(root);
    if (src) forceCanvasPresent(src);
    const glm = src ? sampleGlCanvas(src) : null;
    const path = chooseIosCrtPath({
      pngValid: false,
      glLooksReady: pixelsLookLive(glm),
    });
    if (path === "gl-blit") {
      const ok = (await blitGlToMirror(root)) || (await blitCanvasDrawImage(root));
      if (ok) {
        paintPath = "gl-blit";
        signalMirrorPainted(null);
        glog("ios-gl-blit", { via: "force" });
        return true;
      }
    }
    revealLiveWebgl(root, "force-no-png");
    return true;
  } catch (err) {
    glog("ios-mirror-force-fail", { m: err instanceof Error ? err.message : String(err) });
    revealLiveWebgl(root, "force-fail");
    return paintSettled;
  }
}

function signalMirrorPainted(onFirstPaint?: (() => void) | null) {
  if (!mirrorPainted) {
    mirrorPainted = true;
    if (!paintPath) paintPath = "gl-blit";
    markPaintSettled();
    glog("ios-mirror-painted");
  }
  onFirstPaint?.();
}

function haltMirrorLoop() {
  mirrorGen += 1;
  if (mirrorRaf) cancelAnimationFrame(mirrorRaf);
  mirrorRaf = 0;
  mirrorActive = false;
  mirrorEmu = null;
}

function revealLiveWebgl(root: HTMLElement | null, reason: string) {
  setMirrorVisible(root, false);
  const el =
    (root?.querySelector(".g64-ios-mirror") as HTMLCanvasElement | null) ??
    (document.querySelector("#grok64-player .g64-ios-mirror") as HTMLCanvasElement | null);
  el?.remove();
  paintPath = "live-webgl";
  if (!paintSettled) {
    markPaintSettled();
    glog("ios-live-webgl", { reason });
  }
}

/**
 * Keep live WebGL visible. Overlay only after a real blit.
 * PNG screenshots are optional and must never cover the CRT with an empty canvas.
 */
let mirrorLastCapture = 0;
const MIRROR_PAINT_MS = 20;
const MIRROR_GAME_MS = 33;

export function startIosViceMirror(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  onFirstPaint?: () => void,
) {
  if (!isIosPhone() || !emu) return;
  if (paintSettled) {
    onFirstPaint?.();
    return;
  }
  if (mirrorActive && mirrorEmu === emu) {
    if (paintSettled) onFirstPaint?.();
    return;
  }
  stopIosViceMirror();
  const gen = mirrorGen;
  mirrorActive = true;
  mirrorEmu = emu;
  setMirrorVisible(root, false);
  let pending = false;
  let ticks = 0;
  let paintedCb = onFirstPaint ?? null;

  const settleLive = (reason: string) => {
    if (gen !== mirrorGen) return;
    revealLiveWebgl(root, reason);
    paintedCb?.();
    paintedCb = null;
    haltMirrorLoop();
  };

  const tryNonPngBlit = async (): Promise<boolean> => {
    const src = playerCanvas(root);
    if (src) forceCanvasPresent(src);
    const glm = src ? sampleGlCanvas(src) : null;
    const path = chooseIosCrtPath({ pngValid: false, glLooksReady: pixelsLookLive(glm) });
    if (path === "gl-blit") {
      const ok = (await blitGlToMirror(root)) || (await blitCanvasDrawImage(root));
      if (ok) {
        paintPath = "gl-blit";
        glog("ios-gl-blit", { lum: glm?.lum, uniq: glm?.uniq });
        signalMirrorPainted(paintedCb);
        paintedCb = null;
        return true;
      }
    }
    return false;
  };

  const tick = () => {
    if (gen !== mirrorGen) return;
    if (paintSettled && paintPath === "live-webgl") return;
    mirrorRaf = requestAnimationFrame(tick);
    ticks += 1;
    const now = performance.now();
    const minGap = mirrorPainted ? MIRROR_GAME_MS : MIRROR_PAINT_MS;
    if (now - mirrorLastCapture < minGap) return;
    if (pending) return;
    pending = true;
    mirrorLastCapture = now;
    void tryNonPngBlit()
      .then((ok) => {
        if (gen !== mirrorGen) return;
        if (ok) return;
        if (!paintSettled && ticks >= 24) settleLive("no-png");
      })
      .finally(() => {
        pending = false;
      });
  };
  mirrorRaf = requestAnimationFrame(tick);
}

type PaintTarget = { emu: EjsInstance | null; root: HTMLElement | null };
let watchdogGen = 0;
let watchdogRaf = 0;
let watchdogEmu: EjsInstance | null = null;
let hooksInstalled = false;
let activeTarget: PaintTarget = { emu: null, root: null };
let onPaintedCb: (() => void) | null = null;
let onTimeoutCb: (() => void) | null = null;
let tapCooldownUntil = 0;

export function stopIosPaintWatchdog() {
  watchdogGen += 1;
  if (watchdogRaf) cancelAnimationFrame(watchdogRaf);
  watchdogRaf = 0;
  watchdogEmu = null;
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
  if (paintSettled) {
    resolved.onPainted?.();
    return;
  }
  activeTarget = { emu, root };
  if (resolved.onPainted) onPaintedCb = resolved.onPainted;
  if (resolved.onTimeout) onTimeoutCb = resolved.onTimeout;

  if (watchdogRaf && watchdogEmu === emu) {
    startIosViceMirror(emu, root, () => {
      markPaintSettled();
      onPaintedCb?.();
      onPaintedCb = null;
      onTimeoutCb = null;
    });
    return;
  }

  stopIosPaintWatchdog();

  let painted = false;
  const signalPainted = () => {
    if (painted) return;
    painted = true;
    markPaintSettled();
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
  watchdogEmu = emu;
  let frames = 0;
  const maxFrames = resolved.maxFrames ?? 480;
  const started = performance.now();

  const tick = () => {
    if (gen !== watchdogGen) return;
    frames += 1;
    const { emu: e, root: r } = activeTarget;
    if (!e) return;
    if (mirrorPainted || paintSettled) {
      signalPainted();
      return;
    }
    const elapsed = performance.now() - started;
    if (frames <= 12 || frames % 6 === 0) {
      kickIosPaint(e, r, `wd${frames}`);
    }
    if (frames % 15 === 0) {
      void displayHasFrame(e, r).then((ok) => {
        if (gen !== watchdogGen) return;
        if (ok || mirrorPainted || paintSettled) {
          glog("ios-watchdog-painted", { frames, mirror: mirrorActive, mirrorPainted });
          signalPainted();
        }
      });
    }
    if (frames < maxFrames && elapsed < 20_000) {
      watchdogRaf = requestAnimationFrame(tick);
      return;
    }
    glog("ios-watchdog-timeout", { frames, mirror: mirrorActive, mirrorPainted, elapsed: Math.round(elapsed) });
    if (!painted && !mirrorPainted && elapsed >= 20_000) {
      if (performance.now() < tapCooldownUntil) {
        glog("ios-resume-cooldown");
        watchdogRaf = requestAnimationFrame(tick);
        return;
      }
      onTimeoutCb?.();
    }
    onTimeoutCb = null;
    if (!mirrorPainted) scheduleIosPaintKicks(e, r);
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
    resetIosPaintState();
    kickIosPaint(emu, root, "resume", true);
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
    resetIosPaintState();
    const { emu, root } = getTarget();
    if (emu) {
      scheduleIosPaintKicks(emu, root);
      startIosPaintWatchdog(emu, root);
    }
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

/** Prefer mirror canvas for QA readback once it has a painted frame. */
export function shotDisplayCanvas(root?: HTMLElement | null): HTMLCanvasElement | null {
  const mirror = mirrorCanvas(root ?? null);
  if (mirrorPainted && mirror && mirror.width >= 8) return mirror;
  return playerCanvas(root ?? null);
}
