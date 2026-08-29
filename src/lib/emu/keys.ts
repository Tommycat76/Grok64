export interface C64Key {
  id: string;
  label: string;
  shift?: string;
  gfx?: string;
  code: string;
  key: string;
  width?: number;
  modifier?: "shift" | "cbm" | "ctrl" | "lock";
}

export const C64_ROWS: C64Key[][] = [
  [
    { id: "arr", label: "←", code: "Backquote", key: "`" },
    { id: "1", label: "1", shift: "!", gfx: "┌", code: "Digit1", key: "1" },
    { id: "2", label: "2", shift: '"', gfx: "—", code: "Digit2", key: "2" },
    { id: "3", label: "3", shift: "#", gfx: "—", code: "Digit3", key: "3" },
    { id: "4", label: "4", shift: "$", gfx: "—", code: "Digit4", key: "4" },
    { id: "5", label: "5", shift: "%", gfx: "—", code: "Digit5", key: "5" },
    { id: "6", label: "6", shift: "&", gfx: "—", code: "Digit6", key: "6" },
    { id: "7", label: "7", shift: "'", gfx: "—", code: "Digit7", key: "7" },
    { id: "8", label: "8", shift: "(", gfx: "—", code: "Digit8", key: "8" },
    { id: "9", label: "9", shift: ")", gfx: "—", code: "Digit9", key: "9" },
    { id: "0", label: "0", shift: "0", code: "Digit0", key: "0" },
    { id: "plus", label: "+", code: "Minus", key: "+" },
    { id: "minus", label: "−", code: "Equal", key: "-" },
    { id: "pound", label: "£", code: "Backslash", key: "\\" },
    { id: "clr", label: "CLR", code: "Home", key: "Home", width: 1.3 },
    { id: "del", label: "DEL", code: "Backspace", key: "Backspace", width: 1.3 },
  ],
  [
    { id: "ctrl", label: "CTRL", code: "ControlLeft", key: "Control", width: 1.4, modifier: "ctrl" },
    { id: "q", label: "Q", gfx: "●", code: "KeyQ", key: "q" },
    { id: "w", label: "W", gfx: "○", code: "KeyW", key: "w" },
    { id: "e", label: "E", gfx: "━", code: "KeyE", key: "e" },
    { id: "r", label: "R", code: "KeyR", key: "r" },
    { id: "t", label: "T", code: "KeyT", key: "t" },
    { id: "y", label: "Y", code: "KeyY", key: "y" },
    { id: "u", label: "U", code: "KeyU", key: "u" },
    { id: "i", label: "I", code: "KeyI", key: "i" },
    { id: "o", label: "O", code: "KeyO", key: "o" },
    { id: "p", label: "P", code: "KeyP", key: "p" },
    { id: "at", label: "@", code: "BracketLeft", key: "@" },
    { id: "star", label: "*", code: "BracketRight", key: "*" },
    { id: "uparr", label: "↑", code: "Delete", key: "Delete" },
    { id: "restore", label: "RST", code: "PageUp", key: "PageUp", width: 1.3 },
  ],
  [
    { id: "run", label: "RUN", code: "Escape", key: "Escape", width: 1.5 },
    { id: "lock", label: "A LOCK", code: "CapsLock", key: "CapsLock", width: 1.3, modifier: "lock" },
    { id: "a", label: "A", gfx: "♠", code: "KeyA", key: "a" },
    { id: "s", label: "S", gfx: "♥", code: "KeyS", key: "s" },
    { id: "d", label: "D", code: "KeyD", key: "d" },
    { id: "f", label: "F", code: "KeyF", key: "f" },
    { id: "g", label: "G", code: "KeyG", key: "g" },
    { id: "h", label: "H", code: "KeyH", key: "h" },
    { id: "j", label: "J", code: "KeyJ", key: "j" },
    { id: "k", label: "K", code: "KeyK", key: "k" },
    { id: "l", label: "L", code: "KeyL", key: "l" },
    { id: "colon", label: ":", shift: "[", code: "Semicolon", key: ":" },
    { id: "semi", label: ";", shift: "]", code: "Quote", key: ";" },
    { id: "eq", label: "=", code: "IntlBackslash", key: "=" },
    { id: "return", label: "RETURN", code: "Enter", key: "Enter", width: 1.8 },
  ],
  [
    { id: "cbm", label: "C=", code: "Tab", key: "Tab", width: 1.4, modifier: "cbm" },
    { id: "lshift", label: "SHIFT", code: "ShiftLeft", key: "Shift", width: 1.6, modifier: "shift" },
    { id: "z", label: "Z", gfx: "♦", code: "KeyZ", key: "z" },
    { id: "x", label: "X", gfx: "♣", code: "KeyX", key: "x" },
    { id: "c", label: "C", code: "KeyC", key: "c" },
    { id: "v", label: "V", code: "KeyV", key: "v" },
    { id: "b", label: "B", code: "KeyB", key: "b" },
    { id: "n", label: "N", code: "KeyN", key: "n" },
    { id: "m", label: "M", code: "KeyM", key: "m" },
    { id: "comma", label: ",", shift: "<", code: "Comma", key: "," },
    { id: "dot", label: ".", shift: ">", code: "Period", key: "." },
    { id: "slash", label: "/", shift: "?", code: "Slash", key: "/" },
    { id: "rshift", label: "SHIFT", code: "ShiftRight", key: "Shift", width: 1.6, modifier: "shift" },
    { id: "crsrud", label: "↕", code: "ArrowDown", key: "ArrowDown" },
    { id: "crsrlr", label: "↔", code: "ArrowRight", key: "ArrowRight" },
  ],
  [
    { id: "space", label: "SPACE", code: "Space", key: " ", width: 8 },
    { id: "f1", label: "F1", code: "F1", key: "F1", width: 1.2 },
    { id: "f3", label: "F3", code: "F3", key: "F3", width: 1.2 },
    { id: "f5", label: "F5", code: "F5", key: "F5", width: 1.2 },
    { id: "f7", label: "F7", code: "F7", key: "F7", width: 1.2 },
  ],
];

const KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  CapsLock: 20,
  F1: 112,
  F3: 114,
  F5: 116,
  F7: 118,
  Numpad0: 96,
  Numpad1: 97,
  Numpad2: 98,
  Numpad3: 99,
  Numpad4: 100,
  Numpad5: 101,
  Numpad6: 102,
  Numpad7: 103,
  Numpad8: 104,
  Numpad9: 105,
};

export function keyCodeOf(code: string, key: string): number {
  if (KEY_CODES[code] != null) return KEY_CODES[code];
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

/** Right Ctrl is the only host key mapped to joystick fire. All other keys are C64. */
export const FIRE_KEY_CODE = "ControlRight";

export function isJoyFireKey(code: string): boolean {
  return code === FIRE_KEY_CODE;
}

export function dispatchC64Key(
  code: string,
  key: string,
  down: boolean,
  mods: { shift?: boolean } = {},
) {
  const keyCode = keyCodeOf(code, key);
  const type = down ? "keydown" : "keyup";
  const make = () => {
    const ev = new KeyboardEvent(type, {
      key,
      code,
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: !!mods.shift,
    });
    // Chrome ignores keyCode/which in the constructor.
    try {
      Object.defineProperty(ev, "keyCode", { get: () => keyCode, configurable: true });
      Object.defineProperty(ev, "which", { get: () => keyCode, configurable: true });
      Object.defineProperty(ev, "charCode", { get: () => (down && key.length === 1 ? keyCode : 0), configurable: true });
    } catch {
      /* older engines */
    }
    return ev;
  };
  const parent =
    (document.querySelector("#grok64-player [tabindex]") as HTMLElement | null) ??
    document.getElementById("grok64-player");
  try {
    parent?.focus?.();
  } catch {
    /* ignore */
  }
  parent?.dispatchEvent(make());
  const canvas =
    document.querySelector("#canvas") ??
    document.querySelector("#grok64-player canvas");
  canvas?.dispatchEvent(make());
  window.dispatchEvent(make());
  document.dispatchEvent(make());
}

export interface C64Stroke {
  code: string;
  key: string;
  shift: boolean;
}

const EXTRA: Record<string, C64Stroke> = {
  "\n": { code: "Enter", key: "Enter", shift: false },
  "\r": { code: "Enter", key: "Enter", shift: false },
  " ": { code: "Space", key: " ", shift: false },
  '"': { code: "Digit2", key: '"', shift: true },
  "*": { code: "BracketRight", key: "*", shift: false },
  "@": { code: "BracketLeft", key: "@", shift: false },
  ",": { code: "Comma", key: ",", shift: false },
  ".": { code: "Period", key: ".", shift: false },
  ":": { code: "Semicolon", key: ":", shift: false },
  ";": { code: "Quote", key: ";", shift: false },
  "+": { code: "Minus", key: "+", shift: false },
  "-": { code: "Equal", key: "-", shift: false },
  "=": { code: "IntlBackslash", key: "=", shift: false },
  "/": { code: "Slash", key: "/", shift: false },
  "!": { code: "Digit1", key: "1", shift: true },
  "#": { code: "Digit3", key: "3", shift: true },
  $: { code: "Digit4", key: "4", shift: true },
};

export function c64Keystrokes(text: string): C64Stroke[] {
  const out: C64Stroke[] = [];
  for (const ch of text) {
    if (/^[A-Za-z]$/.test(ch)) {
      const up = ch.toUpperCase();
      out.push({ code: `Key${up}`, key: ch.toLowerCase(), shift: false });
      continue;
    }
    if (/^[0-9]$/.test(ch)) {
      out.push({ code: `Digit${ch}`, key: ch, shift: false });
      continue;
    }
    const extra = EXTRA[ch];
    if (extra) out.push(extra);
  }
  return out;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function typeC64(
  text: string,
  opts: { delayMs?: number; cancelled?: () => boolean } = {},
) {
  const canvas = document.querySelector("#grok64-player canvas") as HTMLCanvasElement | null;
  if (canvas) {
    if (canvas.tabIndex < 0) canvas.tabIndex = 0;
    try {
      canvas.focus();
    } catch {
      /* ignore */
    }
  }
  const delay = opts.delayMs ?? 70;
  for (const stroke of c64Keystrokes(text)) {
    if (opts.cancelled?.()) return;
    if (stroke.shift) dispatchC64Key("ShiftLeft", "Shift", true);
    dispatchC64Key(stroke.code, stroke.key, true, { shift: stroke.shift });
    await sleep(delay);
    dispatchC64Key(stroke.code, stroke.key, false, { shift: stroke.shift });
    if (stroke.shift) dispatchC64Key("ShiftLeft", "Shift", false);
    await sleep(Math.max(40, delay - 20));
  }
}
