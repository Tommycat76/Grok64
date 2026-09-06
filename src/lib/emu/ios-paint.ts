import type { EjsInstance } from "./host";
import { dismissEjsPrompts, fitEmu, unlockAudio } from "./host";
import { isIosPhone } from "./detect";
import { glog } from "./debug";

/** Kick WebGL/audio/main-loop on iOS WebKit after the user-gesture window closes. */
export function kickIosPaint(emu: EjsInstance | null, root: HTMLElement | null, tag = "kick") {
  if (!isIosPhone() || !emu) return;
  unlockAudio(emu);
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
    const canvas =
      (emu.Module?.canvas as HTMLCanvasElement | undefined) ??
      (root?.querySelector("canvas") as HTMLCanvasElement | null);
    if (canvas) {
      if (canvas.tabIndex < 0) canvas.tabIndex = 0;
      canvas.focus?.();
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
  const delays = [0, 80, 200, 450, 900, 1800, 3200];
  for (const ms of delays) {
    window.setTimeout(() => kickIosPaint(emu, root, `t${ms}`), ms);
  }
}

/** True when VICE reports a non-trivial framebuffer (works when canvas readback is blocked). */
export async function viceHasFrame(emu: EjsInstance | null): Promise<boolean> {
  if (!emu?.gameManager?.screenshot) return false;
  try {
    const raw = await emu.gameManager.screenshot();
    return Boolean(raw && raw.byteLength > 2_500);
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
    if (await viceHasFrame(emu)) {
      glog("ios-frame-ok", { ms: Math.round(performance.now() - t0) });
      return true;
    }
    await new Promise((r) => window.setTimeout(r, 280));
  }
  glog("ios-frame-timeout", { ms: timeoutMs });
  return false;
}
