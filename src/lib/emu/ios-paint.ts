/**
 * CriOS CRT presentation — live WebGL CSS fill (after #47).
 *
 * Read `docs/IOS_CRT_KNOWN_FAILURES.md` first. Desktop Chromium / Plex
 * Playwright cannot PASS this.
 *
 * Architecture
 * ------------
 * 1. Show the live VICE WebGL canvas itself filling .g64-screen via CSS
 *    100% layout (inset 0, width/height 100%, object-fit fill). Not
 *    wrapper scale (#43/#44), not a 2D present (#46/#47).
 * 2. Backing store stays 384×272 (never assign canvas.width to the bezel).
 *    After getContext, unlock clientWidth so it matches CSS 100% — #7's
 *    leftover 384×272 lie made an empty black blit on Plex.
 * 3. Never call getContext on that canvas. host.ts already captured
 *    VICE's context on `__g64gl`. A second WebGL context on WebKit returns
 *    null or steals the canvas (solid black CRT).
 * 4. Never PNG / toDataURL poll / readPixels present loop / drawImage(GL).
 * 5. Strip leftover 2D present/mirror nodes from cached builds so they
 *    cannot cover READY with black after cold start.
 * 6. After power-on, play-recycle (unit 8), Reset, or Jiffy apply: unpause,
 *    keep the main loop running, fit CSS (do not wipe the backing store).
 *    Do not recycle the core or Autostart from here.
 *
 * Tom's phone remains the only PASS.
 */

import type { EjsInstance } from "./host";
import { applyIosCrtStyle, dismissEjsPrompts, fitEmu, unlockAudio } from "./host";
import { stopIosPresent, stripIosPresent } from "./ios-present";
import { isIosPhone } from "./detect";
import { glog } from "./debug";

export type IosCrtPath = "live-webgl";

/** Locked: presentation is always the live WebGL canvas. */
export function chooseIosCrtPath(_input?: {
  pngValid?: boolean;
  glLooksReady?: boolean;
}): IosCrtPath {
  return "live-webgl";
}

export const WATCHDOG_RECYCLES_CORE = false;
export const CRT_RECYCLES_CORE = false;

let paintSettled = false;
let hooksInstalled = false;
let tapCooldownUntil = 0;
let presentGen = 0;

export function iosCrtPath(): IosCrtPath {
  return "live-webgl";
}

export function isIosPaintSettled(): boolean {
  return paintSettled;
}

export function isIosMirrorActive(): boolean {
  return false;
}

export function isIosMirrorPainted(): boolean {
  return false;
}

export function resetIosPaintState() {
  paintSettled = false;
  presentGen += 1;
}

function playerRoot(root?: HTMLElement | null): HTMLElement | null {
  if (root?.id === "grok64-player") return root;
  return (
    root?.closest("#grok64-player") ??
    root ??
    (typeof document !== "undefined" ? document.getElementById("grok64-player") : null)
  );
}

export function playerCanvas(root?: HTMLElement | null): HTMLCanvasElement | null {
  const el = playerRoot(root ?? null);
  return (
    (el?.querySelector("canvas:not(.g64-ios-present)") as HTMLCanvasElement | null) ??
    (typeof document !== "undefined"
      ? (document.querySelector("#grok64-player canvas:not(.g64-ios-present)") as HTMLCanvasElement | null)
      : null)
  );
}

/** Strip leftover 2D overlays from older CriOS paint builds. */
export function stripIosOverlay(root?: HTMLElement | null) {
  const el = playerRoot(root ?? null);
  el?.classList.remove("g64-ios-mirror-on");
  el?.classList.add("g64-ios-crt-live");
  const stale = el?.querySelectorAll(".g64-ios-mirror, canvas.g64-ios-present") ?? [];
  stale.forEach((node) => node.remove());
  const screen = el?.closest(".g64-screen") ?? (typeof document !== "undefined" ? document.querySelector(".g64-screen") : null);
  stripIosPresent(screen as HTMLElement | null);
}

function revealLiveCanvas(canvas: HTMLCanvasElement) {
  canvas.classList.remove("g64-ios-mirror");
  canvas.classList.add("g64-ios-fb");
  canvas.style.setProperty("display", "block", "important");
  canvas.style.setProperty("visibility", "visible", "important");
  canvas.style.setProperty("opacity", "1", "important");
  // Live GL fills the bezel; client box matches CSS (not the #7 384 lie).
  const el =
    (canvas.closest("#grok64-player") as HTMLElement | null) ??
    (typeof document !== "undefined" ? document.getElementById("grok64-player") : null);
  const parent = canvas.parentElement ?? el;
  if (el && parent) applyIosCrtStyle(canvas, el, parent);
}

/**
 * Nudge WebKit's compositor without touching the GL context.
 * Transform flicker + layout read is enough; readPixels / getContext are not.
 */
function nudgeCompositor(canvas: HTMLCanvasElement) {
  try {
    const player = canvas.closest("#grok64-player") as HTMLElement | null;
    const playerXf = player?.style.getPropertyValue("transform") ?? "";
    if (playerXf && playerXf !== "none" && !/matrix\(1,\s*0,\s*0,\s*1/.test(playerXf)) {
      void canvas.offsetWidth;
      void player?.offsetWidth;
    }
    const prev = canvas.style.getPropertyValue("transform");
    const pri = canvas.style.getPropertyPriority("transform") || "important";
    if (/scale\(/.test(prev)) {
      void canvas.offsetWidth;
      return;
    }
    canvas.style.setProperty("transform", "translate3d(0,0,0.01px)", pri);
    void canvas.offsetWidth;
    requestAnimationFrame(() => {
      canvas.style.setProperty("transform", prev || "none", pri);
    });
  } catch {
    /* ignore */
  }
}

export type PresentIosCrtOpts = {
  tag?: string;
  fromUserGesture?: boolean;
  fit?: boolean;
};

/**
 * Show the live VICE/RetroArch canvas. Safe to call after power-on,
 * play-recycle, Reset, and Jiffy apply.
 */
export function presentIosCrt(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  tagOrOpts: string | PresentIosCrtOpts = "present",
  fromUserGesture = false,
) {
  if (!isIosPhone() || !emu) return;
  const opts: PresentIosCrtOpts =
    typeof tagOrOpts === "string"
      ? { tag: tagOrOpts, fromUserGesture }
      : { fromUserGesture: false, ...tagOrOpts };
  const tag = opts.tag ?? "present";
  const gesture = Boolean(opts.fromUserGesture);

  unlockAudio(emu);
  dismissEjsPrompts(root, gesture || paintSettled ? "play" : "boot");
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

  stripIosOverlay(root);

  const canvas =
    (emu.Module?.canvas as HTMLCanvasElement | undefined) ?? playerCanvas(root);
  if (canvas) {
    revealLiveCanvas(canvas);
    if (gesture) {
      if (canvas.tabIndex < 0) canvas.tabIndex = 0;
      try {
        canvas.focus?.();
      } catch {
        /* ignore */
      }
    }
  }

  // Always refit CSS so the canvas fills .g64-screen.
  fitEmu(playerRoot(root), emu);
  if (canvas) nudgeCompositor(canvas);
  const shouldFit =
    opts.fit ??
    (gesture ||
      tag === "settle" ||
      tag === "resume" ||
      tag === "play-unlock" ||
      tag === "ready" ||
      tag === "user-reset" ||
      tag === "jiffy");
  if (shouldFit) {
    try {
      window.dispatchEvent(new Event("resize"));
    } catch {
      /* ignore */
    }
  }

  paintSettled = true;
  glog("ios-crt-present", {
    tag,
    gesture,
    w: canvas?.width ?? 0,
    h: canvas?.height ?? 0,
    cw: canvas?.clientWidth ?? 0,
    ch: canvas?.clientHeight ?? 0,
    xf: canvas?.style.getPropertyValue("transform") ?? "",
    playerXf:
      (canvas?.closest("#grok64-player") as HTMLElement | null)?.style.getPropertyValue("transform") ??
      "",
  });
}

/** A few presents while EJS attaches a new canvas after recycle — not a poll loop. */
export function scheduleIosCrtPresents(emu: EjsInstance | null, root: HTMLElement | null, tag = "sched") {
  if (!isIosPhone() || !emu) return;
  const gen = presentGen;
  presentIosCrt(emu, root, tag);
  requestAnimationFrame(() => {
    if (gen !== presentGen) return;
    presentIosCrt(emu, root, `${tag}-raf`);
  });
  window.setTimeout(() => {
    if (gen !== presentGen) return;
    presentIosCrt(emu, root, `${tag}-late`, false);
  }, 220);
}

export function stopIosCrt() {
  presentGen += 1;
  stripIosOverlay(null);
  stopIosPresent();
}

export function kickIosPaint(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  tag = "kick",
  fromUserGesture = false,
) {
  presentIosCrt(emu, root, tag, fromUserGesture);
}

export function scheduleIosPaintKicks(emu: EjsInstance | null, root: HTMLElement | null) {
  scheduleIosCrtPresents(emu, root, "kick");
}

export function stopIosViceMirror() {
  stripIosOverlay(null);
}

export function stopIosPaintWatchdog() {
  presentGen += 1;
}

export function forceIosMirrorBlit(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  fromUserGesture = false,
): Promise<boolean> {
  presentIosCrt(emu, root, "gesture", fromUserGesture);
  return Promise.resolve(true);
}

export type IosPaintWatchdogOpts = {
  onPainted?: () => void;
  onTimeout?: () => void;
  maxFrames?: number;
};

/** Present live WebGL. Does not recycle the core or Autostart. */
export function startIosPaintWatchdog(
  emu: EjsInstance | null,
  root: HTMLElement | null,
  opts?: IosPaintWatchdogOpts | (() => void),
) {
  if (!isIosPhone() || !emu) return;
  const resolved: IosPaintWatchdogOpts =
    typeof opts === "function" ? { onPainted: opts } : (opts ?? {});
  presentIosCrt(emu, root, "watchdog");
  const canvas = playerCanvas(root);
  if (canvas && (canvas.width >= 8 || canvas.clientWidth >= 8)) {
    resolved.onPainted?.();
    return;
  }
  const gen = presentGen;
  window.setTimeout(() => {
    if (gen !== presentGen) return;
    presentIosCrt(emu, root, "watchdog-late");
    const late = playerCanvas(root);
    if (late && (late.width >= 8 || late.clientWidth >= 8)) {
      resolved.onPainted?.();
      return;
    }
    if (performance.now() < tapCooldownUntil) return;
    resolved.onTimeout?.();
  }, 800);
}

export function iosTapResumeCooldown(ms = 8000) {
  tapCooldownUntil = performance.now() + ms;
}

type PaintTarget = { emu: EjsInstance | null; root: HTMLElement | null };

export function installIosPaintHooks(getTarget: () => PaintTarget) {
  if (!isIosPhone() || hooksInstalled || typeof window === "undefined") return;
  hooksInstalled = true;

  const resume = (tag: string) => {
    const { emu, root } = getTarget();
    if (!emu) return;
    presentIosCrt(emu, root, tag, true);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resume("visible");
  });
  window.addEventListener("pageshow", (ev) => {
    if ((ev as PageTransitionEvent).persisted) resume("pageshow");
  });
  window.addEventListener("focus", () => resume("focus"));

  const onCtxLost = (ev: Event) => {
    glog("webgl-context-lost");
    ev.preventDefault();
    // Do not reset paintSettled — that made the 350ms poll call
    // presentIosCrt again and restart a crash loop. Live GL has no 2D frame.
    stopIosPresent();
  };
  const onCtxRestored = () => {
    glog("webgl-context-restored");
    resume("ctx-restored");
  };

  const watched = new WeakSet<HTMLCanvasElement>();
  const watchCanvas = () => {
    const canvas = playerCanvas(getTarget().root);
    if (!canvas || watched.has(canvas)) return;
    watched.add(canvas);
    canvas.addEventListener("webglcontextlost", onCtxLost, false);
    canvas.addEventListener("webglcontextrestored", onCtxRestored, false);
    const { emu, root } = getTarget();
    if (emu) presentIosCrt(emu, root, "canvas-attach");
  };

  const obs = new MutationObserver(() => watchCanvas());
  const player = document.getElementById("grok64-player");
  if (player) obs.observe(player, { childList: true, subtree: true });
  watchCanvas();
}

export function shotDisplayCanvas(root?: HTMLElement | null): HTMLCanvasElement | null {
  return playerCanvas(root ?? null);
}

/**
 * READY-like luminance/entropy — used by unit tests / page-shot QA only.
 * Not used to decide whether to hide the live canvas.
 */
export function frameLooksReady(m: { lum: number; uniq: number } | null): boolean {
  if (!m) return false;
  if (m.lum <= 6 || m.uniq < 2) return false;
  if (m.uniq > 42) return false;
  if (m.lum > 150 && m.uniq > 20) return false;
  return m.lum >= 12;
}
