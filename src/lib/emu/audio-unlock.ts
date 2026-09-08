import { detectOs } from "./detect";

type EmuAudio = {
  volume?: number;
  muted?: boolean;
  gameManager?: { volume?: number };
  Module?: {
    AL?: {
      currentCtx?: {
        state?: string;
        resume?: () => Promise<void>;
        ctx?: AudioContext;
        audioCtx?: AudioContext;
        context?: AudioContext;
        gain?: { gain?: { value?: number }; context?: AudioContext };
        sources?: { gain?: { gain?: { value?: number }; context?: AudioContext } }[];
      };
    };
  };
} | null;

let pokeCtx: AudioContext | null = null;
let silentArmed = false;
let htmlUnlock: HTMLAudioElement | null = null;

function getCtxCtor(): typeof AudioContext | undefined {
  return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function resumeCtx(ctx: { state?: string; resume?: () => Promise<void> } | null | undefined) {
  if (!ctx || typeof ctx.resume !== "function") return;
  if (ctx.state === "suspended" || ctx.state === "interrupted") {
    void ctx.resume().catch(() => undefined);
  }
}

/** Tiny WAV — iOS WebAudio stays muted by the ringer until an HTMLMediaElement plays. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

function playHtmlUnlock() {
  if (typeof document === "undefined") return;
  try {
    if (!htmlUnlock) {
      htmlUnlock = new Audio();
      htmlUnlock.setAttribute("playsinline", "true");
      htmlUnlock.setAttribute("webkit-playsinline", "true");
      htmlUnlock.preload = "auto";
      htmlUnlock.loop = false;
      htmlUnlock.volume = 0.01;
      htmlUnlock.src = SILENT_WAV;
    }
    const play = htmlUnlock.play();
    if (play) void play.catch(() => undefined);
  } catch {
    /* ignore */
  }
}

function playSilentTick(ctx: AudioContext) {
  try {
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0.001;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(0);
    silentArmed = true;
  } catch {
    /* ignore */
  }
}

function collectContexts(emu?: EmuAudio): AudioContext[] {
  const found: AudioContext[] = [];
  const add = (ctx: AudioContext | undefined | null) => {
    if (ctx && typeof ctx.resume === "function" && !found.includes(ctx)) found.push(ctx);
  };
  add(pokeCtx);
  try {
    const al = emu?.Module?.AL?.currentCtx;
    if (al && typeof (al as AudioContext).resume === "function") add(al as unknown as AudioContext);
    add(al?.ctx ?? null);
    add(al?.audioCtx ?? null);
    add(al?.context ?? null);
    add(al?.gain?.context ?? null);
    const sources = al?.sources;
    if (sources) {
      for (const src of sources) add(src?.gain?.context ?? null);
    }
  } catch {
    /* ignore */
  }
  return found;
}

/** One-shot iOS/Safari audio unlock without leaking AudioContext instances. */
export function pokeAudioUnlock() {
  const Ctx = getCtxCtor();
  if (!Ctx) return;
  const ios = detectOs() === "ios";
  if (ios) playHtmlUnlock();
  try {
    if (pokeCtx && pokeCtx.state !== "closed") {
      resumeCtx(pokeCtx);
      if (ios && !silentArmed) playSilentTick(pokeCtx);
      return;
    }
    pokeCtx = new Ctx({ latencyHint: ios ? "playback" : "interactive" });
    const ctx = pokeCtx;
    const close = () => {
      try {
        if (ctx.state !== "closed") void ctx.close();
      } catch {
        /* ignore */
      }
      if (pokeCtx === ctx) pokeCtx = null;
      silentArmed = false;
    };
    resumeCtx(ctx);
    if (ios) playSilentTick(ctx);
    if (ctx.state === "suspended" || ctx.state === "interrupted") {
      void ctx.resume().then(() => {
        if (ios) playSilentTick(ctx);
        // Closing during the power-on gesture breaks WASM audio init on iOS WebKit.
        if (!ios) close();
      }, close);
    } else if (!ios) {
      close();
    }
  } catch {
    /* ignore */
  }
}

/**
 * CriOS: resume every known AudioContext on a *user gesture*.
 * Interval / rAF resume is ignored by WebKit — this must run from pointer/key.
 * Runs again after VICE creates AL (Play unlock / FIRE / stick).
 * Does not touch the WebGL canvas / CRT host path.
 */
export function gestureUnlockAudio(emu?: EmuAudio) {
  pokeAudioUnlock();
  if (detectOs() === "ios") playHtmlUnlock();
  for (const ctx of collectContexts(emu)) {
    resumeCtx(ctx);
    if (detectOs() === "ios") playSilentTick(ctx);
  }
}

export function applyEmuVolume(emu: EmuAudio, muted: boolean, volume: number) {
  if (!emu) return;
  const v = muted ? 0 : volume;
  try {
    emu.volume = v;
  } catch {
    /* ignore */
  }
  try {
    emu.muted = muted;
  } catch {
    /* ignore */
  }
  try {
    if (emu.gameManager) emu.gameManager.volume = v;
  } catch {
    /* ignore */
  }
  try {
    const al = emu.Module?.AL?.currentCtx;
    if (al?.gain?.gain && typeof al.gain.gain.value === "number") {
      al.gain.gain.value = v;
    }
  } catch {
    /* ignore */
  }
}
