import type { EjsInstance } from "./host";
import { dismissEjsPrompts, fitEmu, unlockAudio } from "./host";
import { isIosPhone } from "./detect";
import { glog } from "./debug";

/** Sample PNG screenshot luminance — rejects black PNGs that still exceed byte thresholds. */
export async function frameImageMetrics(raw: Uint8Array | null): Promise<{ lum: number; uniq: number } | null> {
  if (!raw || raw.byteLength < 2500) return null;
  if (typeof createImageBitmap !== "function") return { lum: raw.byteLength > 8000 ? 40 : 0, uniq: 2 };
  try {
    const blob = new Blob([raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)], {
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

export async function canvasHasFrame(emu: EjsInstance | null): Promise<boolean> {
  const canvas = document.querySelector("#grok64-player canvas") as HTMLCanvasElement | null;
  if (!canvas || canvas.width < 8 || canvas.height < 8) return false;
  try {
    const url = canvas.toDataURL("image/png");
    const bin = atob(url.split(",")[1] || "");
    const raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
    const m = await frameImageMetrics(raw);
    return Boolean(m && m.lum > 4 && m.uniq >= 2);
  } catch {
    return false;
  }
}

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
    if ((await viceHasFrame(emu)) || (await canvasHasFrame(emu))) {
      glog("ios-frame-ok", { ms: Math.round(performance.now() - t0) });
      return true;
    }
    await new Promise((r) => window.setTimeout(r, 280));
  }
  glog("ios-frame-timeout", { ms: timeoutMs });
  return false;
}
