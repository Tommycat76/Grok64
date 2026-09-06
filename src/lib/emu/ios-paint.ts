import type { EjsInstance } from "./host";
import { dismissEjsPrompts, fitEmu, unlockAudio } from "./host";
import { isIosPhone } from "./detect";
import { glog } from "./debug";

/** Sample PNG screenshot luminance — rejects black PNGs that still exceed byte thresholds. */
export async function frameImageMetrics(raw: Uint8Array | null): Promise<{ lum: number; uniq: number } | null> {
  if (!raw || raw.byteLength < 2500) return null;
  if (typeof createImageBitmap !== "function") return { lum: raw.byteLength > 8000 ? 40 : 0, uniq: 2 };
  try {
    const blob = new Blob([new Uint8Array(raw)], {
      type: "image/png",
    });
    const bmp = await createImageBitmap(blob);
    const side = Math.min(48, bmp.width, bmp.height);
    const c = document.createElement("canvas");
    c.width = side;
    c.height = side;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bmp.close?.();
      return null;
    }
    ctx.drawImage(bmp, 0, 0, side, side);
    bmp.close?.();
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
    return null;
  }
}

function playerCanvas(root: HTMLElement | null): HTMLCanvasElement | null {
  return (
    (root?.querySelector("canvas") as HTMLCanvasElement | null) ??
    (document.querySelector("#grok64-player canvas") as HTMLCanvasElement | null)
  );
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
    // Readback is the reliable iOS compositor kick for black CRT shells.
    canvas.toDataURL("image/png");
  } catch {
    /* ignore */
  }
}

export async function canvasHasFrame(emu: EjsInstance | null, root?: HTMLElement | null): Promise<boolean> {
  const canvas = playerCanvas(root ?? null);
  if (!canvas || canvas.width < 8 || canvas.height < 8) return false;
  forceCanvasPresent(canvas);
  try {
    const url = canvas.toDataURL("image/png");
    const bin = atob(url.split(",")[1] || "");
    const raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
    const m = await frameImageMetrics(raw);
    if (m && m.lum > 4 && m.uniq >= 2) return true;
  } catch {
    /* fall through */
  }
  // VICE screenshot can paint before the GL canvas composites on iOS WebKit.
  return await viceHasFrame(emu);
}

/** Kick WebGL/main-loop on iOS WebKit — does not require a user gesture. */
export function kickIosPaint(emu: EjsInstance | null, root: HTMLElement | null, tag = "kick") {
  if (!isIosPhone() || !emu) return;
  dismissEjsPrompts(root, "boot");
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
    const raw = await emu.gameManager.screenshot();
    const m = await frameImageMetrics(raw instanceof Uint8Array ? raw : null);
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
    if (await canvasHasFrame(emu, root)) {
      glog("ios-frame-ok", { ms: Math.round(performance.now() - t0) });
      return true;
    }
    await new Promise((r) => window.setTimeout(r, 120));
  }
  glog("ios-frame-timeout", { ms: timeoutMs });
  return false;
}

type PaintTarget = { emu: EjsInstance | null; root: HTMLElement | null };
let watchdogGen = 0;
let watchdogRaf = 0;
let hooksInstalled = false;
let activeTarget: PaintTarget = { emu: null, root: null };
let onPaintedCb: (() => void) | null = null;

export function stopIosPaintWatchdog() {
  watchdogGen += 1;
  if (watchdogRaf) cancelAnimationFrame(watchdogRaf);
  watchdogRaf = 0;
}

/** rAF paint loop until the CRT canvas composites — no tap required. */
export function startIosPaintWatchdog(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  onPainted?: () => void,
) {
  if (!isIosPhone() || !emu) return;
  activeTarget = { emu, root };
  onPaintedCb = onPainted ?? null;
  stopIosPaintWatchdog();
  const gen = watchdogGen;
  let frames = 0;
  const maxFrames = 720;

  const tick = () => {
    if (gen !== watchdogGen) return;
    frames += 1;
    const { emu: e, root: r } = activeTarget;
    if (!e) return;
    kickIosPaint(e, r, `wd${frames}`);
    void canvasHasFrame(e, r).then((ok) => {
      if (gen !== watchdogGen) return;
      if (ok) {
        glog("ios-watchdog-painted", { frames });
        onPaintedCb?.();
        onPaintedCb = null;
        stopIosPaintWatchdog();
        return;
      }
      if (frames < maxFrames) {
        watchdogRaf = requestAnimationFrame(tick);
      } else {
        glog("ios-watchdog-timeout", { frames });
        // Keep kicking on a slow timer — canvas may appear without another tap.
        scheduleIosPaintKicks(e, r);
      }
    });
  };
  watchdogRaf = requestAnimationFrame(tick);
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
