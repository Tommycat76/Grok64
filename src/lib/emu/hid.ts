/** Bluetooth / USB HID on phones and tablets — same idea as a real gamepad. */

export type HidKind = "mouse" | "keyboard";

function isUiTarget(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  return Boolean(t.closest("button, input, textarea, select, a, .g64-kb, .g64-sheet, .g64-chip, .g64-port, .g64-fire, .g64-touchpad, .g64-stick, .g64-gate"));
}

export function isTypingField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export function watchHid(onChange: (s: { mouse: boolean; keyboard: boolean }) => void): () => void {
  let mouse = false;
  let keyboard = false;
  const notify = () => onChange({ mouse, keyboard });

  const markMouse = () => {
    if (mouse) return;
    mouse = true;
    notify();
  };
  const markKeyboard = () => {
    if (keyboard) return;
    keyboard = true;
    notify();
  };

  const fine = window.matchMedia("(any-pointer: fine)");
  const onFine = () => {
    if (fine.matches) markMouse();
  };
  onFine();
  fine.addEventListener?.("change", onFine);

  const onPtr = (e: PointerEvent) => {
    if (e.pointerType === "mouse") markMouse();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!e.isTrusted || e.repeat) return;
    if (isTypingField(e.target) || (e.target instanceof Element && e.target.closest(".g64-kb"))) return;
    markKeyboard();
  };

  window.addEventListener("pointermove", onPtr, { passive: true });
  window.addEventListener("pointerdown", onPtr, { passive: true });
  window.addEventListener("keydown", onKey, true);

  return () => {
    fine.removeEventListener?.("change", onFine);
    window.removeEventListener("pointermove", onPtr);
    window.removeEventListener("pointerdown", onPtr);
    window.removeEventListener("keydown", onKey, true);
  };
}

export { isUiTarget };
