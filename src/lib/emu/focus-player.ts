/** Return keyboard focus to the live C64 canvas (Software / settings steal it). */
export function focusGrok64Player(): void {
  if (typeof document === "undefined") return;
  const player = document.getElementById("grok64-player");
  if (!player) return;
  player.tabIndex = 0;
  const canvas = player.querySelector("canvas:not(.g64-ios-present)") as HTMLCanvasElement | null;
  const target = canvas ?? player;
  if (canvas && canvas.tabIndex < 0) canvas.tabIndex = 0;
  try {
    target.focus({ preventScroll: true });
  } catch {
    try {
      target.focus();
    } catch {
      /* ignore */
    }
  }
}
