/** One-shot iOS/Safari audio unlock without leaking AudioContext instances. */
export function pokeAudioUnlock() {
  const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx({ latencyHint: "interactive" });
    const close = () => {
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    };
    if (ctx.state === "suspended") void ctx.resume().then(close, close);
    else close();
  } catch {
    /* ignore */
  }
}
