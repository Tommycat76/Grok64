import { detectOs } from "./detect";

type EmuAudio = {
  volume?: number;
  Module?: {
    AL?: {
      currentCtx?: {
        state?: string;
        resume?: () => Promise<void>;
        sources?: { gain?: { context?: AudioContext } }[];
      };
    };
  };
} | null;

let pokeCtx: AudioContext | null = null;
let silentArmed = false;

function getCtxCtor(): typeof AudioContext | undefined {
  return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function resumeCtx(ctx: { state?: string; resume?: () => Promise<void> } | null | undefined) {
  if (!ctx || typeof ctx.resume !== "function") return;
  if (ctx.state === "suspended" || ctx.state === "interrupted") {
    void ctx.resume().catch(() => undefined);
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
    const al = emu?.Module?.AL?.currentCtx as AudioContext | undefined;
    if (al && typeof (al as AudioContext).resume === "function") add(al as AudioContext);
    const sources = emu?.Module?.AL?.currentCtx?.sources;
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
    if (ctx.state === "suspended") {
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
 * Does not touch the WebGL canvas / CRT host path.
 */
export function gestureUnlockAudio(emu?: EmuAudio) {
  pokeAudioUnlock();
  for (const ctx of collectContexts(emu)) {
    resumeCtx(ctx);
    if (detectOs() === "ios") playSilentTick(ctx);
  }
}

export function applyEmuVolume(emu: EmuAudio, muted: boolean, volume: number) {
  if (!emu) return;
  try {
    emu.volume = muted ? 0 : volume;
  } catch {
    /* ignore */
  }
}
