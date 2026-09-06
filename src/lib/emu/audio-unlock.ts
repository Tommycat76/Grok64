import { detectOs } from "./detect";

let pokeCtx: AudioContext | null = null;

function getCtxCtor(): typeof AudioContext | undefined {
  return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/** One-shot iOS/Safari audio unlock without leaking AudioContext instances. */
export function pokeAudioUnlock() {
  const Ctx = getCtxCtor();
  if (!Ctx) return;
  const ios = detectOs() === "ios";
  try {
    if (pokeCtx && pokeCtx.state !== "closed") {
      if (pokeCtx.state === "suspended") void pokeCtx.resume();
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
    };
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => {
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
