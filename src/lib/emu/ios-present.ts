/**
 * iOS CRT — leftover 2D present/mirror stripper.
 *
 * #47 (`readPixels` → 384×272 2D present + object-fit fill ~14fps) went
 * cold-start → solid black on Tom’s real iPhone. Do not revive a present
 * loop. Read `docs/IOS_CRT_KNOWN_FAILURES.md` first.
 *
 * This module only removes stale `.g64-ios-present` nodes from cached JS.
 * Presentation is the live WebGL canvas (ios-paint + applyIosCrtStyle +
 * centered non-GL `.g64-ios-slot` / `.g64-ios-zoom`).
 */

export const IOS_PRESENT_CLASS = "g64-ios-present";
export const IOS_PRESENT_ON_CLASS = "g64-ios-present-on";
export const IOS_PRESENT_W = 384;
export const IOS_PRESENT_H = 272;

/** @deprecated #47 failed — present bitmap no longer exists. */
export function presentBufferSize(_cssW?: number, _cssH?: number) {
  return { w: 0, h: 0 };
}

export function isIosPresentActive(): boolean {
  return false;
}

export function isIosPresentPainted(): boolean {
  return false;
}

export function isIosPresentLooping(): boolean {
  return false;
}

export function iosPresentInfo() {
  return {
    active: false,
    painted: false,
    looping: false,
    lost: false,
    bufW: 0,
    bufH: 0,
    on: false,
  };
}

function stripPresentNodes(root?: ParentNode | null) {
  const scope = root ?? (typeof document !== "undefined" ? document : null);
  if (!scope) return;
  scope.querySelectorAll(`canvas.${IOS_PRESENT_CLASS}`).forEach((node) => node.remove());
  if (scope instanceof Element) {
    scope.classList.remove(IOS_PRESENT_ON_CLASS, "g64-ios-present-on");
  }
}

/** Remove leftover 2D present canvases. Never create one. */
export function stopIosPresent() {
  stripPresentNodes(
    typeof document !== "undefined" ? document.querySelector(".g64-screen") : null,
  );
  stripPresentNodes(typeof document !== "undefined" ? document.body : null);
}

/** @deprecated #47 — calling this only strips leftovers. */
export function startIosPresent(_glCanvas?: HTMLCanvasElement, box?: HTMLElement) {
  stripPresentNodes(box ?? null);
  stopIosPresent();
}

export function pauseIosPresentKeepFrame() {
  stopIosPresent();
}

export function resumeIosPresent() {
  /* live GL has no 2D present loop */
}

export function stripIosPresent(box?: HTMLElement | null) {
  stripPresentNodes(box ?? null);
  stopIosPresent();
}
