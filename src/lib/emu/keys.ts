export interface C64Key {
  id: string;
  label: string;
  /** Printed SHIFT punctuation (! " [ ] < > ?) when it is not a PETSCII graphic. */
  shift?: string;
  /** PETSCII code for the C= (left) graphic on a real C64 keycap. */
  cbmPetscii?: number;
  /** PETSCII code for the SHIFT (right) graphic on a real C64 keycap. */
  shiftPetscii?: number;
  /** Hold SHIFT while this key is down (INST, CLR, π, F2/F4/F6/F8). */
  forceShift?: boolean;
  code: string;
  key: string;
  width?: number;
  modifier?: "shift" | "cbm" | "ctrl" | "lock";
}

export const C64_ROWS: C64Key[][] = [
  [
    { id: "arr", label: "←", code: "Backquote", key: "`", shiftPetscii: 0x5f, cbmPetscii: 0x5f },
    { id: "1", label: "1", shift: "!", shiftPetscii: 0x21, code: "Digit1", key: "1" },
    { id: "2", label: "2", shift: '"', shiftPetscii: 0x22, code: "Digit2", key: "2" },
    { id: "3", label: "3", shift: "#", shiftPetscii: 0x23, code: "Digit3", key: "3" },
    { id: "4", label: "4", shift: "$", shiftPetscii: 0x24, code: "Digit4", key: "4" },
    { id: "5", label: "5", shift: "%", shiftPetscii: 0x25, code: "Digit5", key: "5" },
    { id: "6", label: "6", shift: "&", shiftPetscii: 0x26, code: "Digit6", key: "6" },
    { id: "7", label: "7", shift: "'", shiftPetscii: 0x27, code: "Digit7", key: "7" },
    { id: "8", label: "8", shift: "(", shiftPetscii: 0x28, code: "Digit8", key: "8" },
    { id: "9", label: "9", shift: ")", shiftPetscii: 0x29, code: "Digit9", key: "9" },
    { id: "0", label: "0", code: "Digit0", key: "0" },
    { id: "plus", label: "+", code: "Minus", key: "+", cbmPetscii: 0xa6, shiftPetscii: 0xdb },
    { id: "minus", label: "−", code: "Equal", key: "-", cbmPetscii: 0xdc, shiftPetscii: 0xdd },
    { id: "pound", label: "£", code: "Backslash", key: "\\", cbmPetscii: 0xa8, shiftPetscii: 0xa9 },
    { id: "home", label: "HOME", code: "Home", key: "Home", width: 1.3 },
    { id: "clr", label: "CLR", code: "Home", key: "Home", width: 1.3, forceShift: true },
    { id: "inst", label: "INST", code: "Insert", key: "Insert", width: 1.3 },
    { id: "del", label: "DEL", shift: "INST", code: "Backspace", key: "Backspace", width: 1.3 },
  ],
  [
    { id: "ctrl", label: "CTRL", code: "ControlLeft", key: "Control", width: 1.4, modifier: "ctrl" },
    { id: "q", label: "Q", code: "KeyQ", key: "q", cbmPetscii: 0xab, shiftPetscii: 0xd1 },
    { id: "w", label: "W", code: "KeyW", key: "w", cbmPetscii: 0xb3, shiftPetscii: 0xd7 },
    { id: "e", label: "E", code: "KeyE", key: "e", cbmPetscii: 0xb1, shiftPetscii: 0xc5 },
    { id: "r", label: "R", code: "KeyR", key: "r", cbmPetscii: 0xb2, shiftPetscii: 0xd2 },
    { id: "t", label: "T", code: "KeyT", key: "t", cbmPetscii: 0xa3, shiftPetscii: 0xd4 },
    { id: "y", label: "Y", code: "KeyY", key: "y", cbmPetscii: 0xb7, shiftPetscii: 0xd9 },
    { id: "u", label: "U", code: "KeyU", key: "u", cbmPetscii: 0xb8, shiftPetscii: 0xd5 },
    { id: "i", label: "I", code: "KeyI", key: "i", cbmPetscii: 0xa2, shiftPetscii: 0xc9 },
    { id: "o", label: "O", code: "KeyO", key: "o", cbmPetscii: 0xb9, shiftPetscii: 0xcf },
    { id: "p", label: "P", code: "KeyP", key: "p", cbmPetscii: 0xaf, shiftPetscii: 0xd0 },
    { id: "at", label: "@", code: "BracketLeft", key: "@", cbmPetscii: 0xa4, shiftPetscii: 0xba },
    { id: "star", label: "*", code: "BracketRight", key: "*", cbmPetscii: 0xdf, shiftPetscii: 0xc0 },
    { id: "uparr", label: "↑", code: "Delete", key: "Delete", cbmPetscii: 0xde, shiftPetscii: 0xde },
    { id: "pi", label: "π", code: "Delete", key: "Delete", forceShift: true, shiftPetscii: 0xde },
    { id: "restore", label: "RST", code: "PageUp", key: "PageUp", width: 1.3 },
  ],
  [
    { id: "run", label: "RUN", code: "Escape", key: "Escape", width: 1.5 },
    { id: "lock", label: "LOCK", code: "CapsLock", key: "CapsLock", width: 1.3, modifier: "lock" },
    { id: "a", label: "A", code: "KeyA", key: "a", cbmPetscii: 0xb0, shiftPetscii: 0xc1 },
    { id: "s", label: "S", code: "KeyS", key: "s", cbmPetscii: 0xae, shiftPetscii: 0xd3 },
    { id: "d", label: "D", code: "KeyD", key: "d", cbmPetscii: 0xac, shiftPetscii: 0xc4 },
    { id: "f", label: "F", code: "KeyF", key: "f", cbmPetscii: 0xbb, shiftPetscii: 0xc6 },
    { id: "g", label: "G", code: "KeyG", key: "g", cbmPetscii: 0xa5, shiftPetscii: 0xc7 },
    { id: "h", label: "H", code: "KeyH", key: "h", cbmPetscii: 0xb4, shiftPetscii: 0xc8 },
    { id: "j", label: "J", code: "KeyJ", key: "j", cbmPetscii: 0xb5, shiftPetscii: 0xca },
    { id: "k", label: "K", code: "KeyK", key: "k", cbmPetscii: 0xa1, shiftPetscii: 0xcb },
    { id: "l", label: "L", code: "KeyL", key: "l", cbmPetscii: 0xb6, shiftPetscii: 0xcc },
    { id: "colon", label: ":", shift: "[", shiftPetscii: 0x5b, cbmPetscii: 0x5b, code: "Semicolon", key: ":" },
    { id: "semi", label: ";", shift: "]", shiftPetscii: 0x5d, cbmPetscii: 0x5d, code: "Quote", key: ";" },
    { id: "eq", label: "=", code: "IntlBackslash", key: "=" },
    { id: "return", label: "RETURN", code: "Enter", key: "Enter", width: 1.8 },
  ],
  [
    { id: "cbm", label: "C=", code: "Tab", key: "Tab", width: 1.4, modifier: "cbm" },
    { id: "lshift", label: "SHIFT", code: "ShiftLeft", key: "Shift", width: 1.6, modifier: "shift" },
    { id: "z", label: "Z", code: "KeyZ", key: "z", cbmPetscii: 0xad, shiftPetscii: 0xda },
    { id: "x", label: "X", code: "KeyX", key: "x", cbmPetscii: 0xbd, shiftPetscii: 0xd8 },
    { id: "c", label: "C", code: "KeyC", key: "c", cbmPetscii: 0xbc, shiftPetscii: 0xc3 },
    { id: "v", label: "V", code: "KeyV", key: "v", cbmPetscii: 0xbe, shiftPetscii: 0xd6 },
    { id: "b", label: "B", code: "KeyB", key: "b", cbmPetscii: 0xbf, shiftPetscii: 0xc2 },
    { id: "n", label: "N", code: "KeyN", key: "n", cbmPetscii: 0xaa, shiftPetscii: 0xce },
    { id: "m", label: "M", code: "KeyM", key: "m", cbmPetscii: 0xa7, shiftPetscii: 0xcd },
    { id: "comma", label: ",", shift: "<", shiftPetscii: 0x3c, cbmPetscii: 0x3c, code: "Comma", key: "," },
    { id: "dot", label: ".", shift: ">", shiftPetscii: 0x3e, cbmPetscii: 0x3e, code: "Period", key: "." },
    { id: "slash", label: "/", shift: "?", shiftPetscii: 0x3f, cbmPetscii: 0x3f, code: "Slash", key: "/" },
    { id: "rshift", label: "SHIFT", code: "ShiftRight", key: "Shift", width: 1.6, modifier: "shift" },
    { id: "crsrud", label: "↕", code: "ArrowDown", key: "ArrowDown" },
    { id: "crsrlr", label: "↔", code: "ArrowRight", key: "ArrowRight" },
  ],
  [
    { id: "space", label: "SPACE", code: "Space", key: " ", width: 8 },
    { id: "f1", label: "F1", code: "F1", key: "F1", width: 1.2 },
    { id: "f2", label: "F2", code: "F2", key: "F2", width: 1.2 },
    { id: "f3", label: "F3", code: "F3", key: "F3", width: 1.2 },
    { id: "f4", label: "F4", code: "F4", key: "F4", width: 1.2 },
    { id: "f5", label: "F5", code: "F5", key: "F5", width: 1.2 },
    { id: "f6", label: "F6", code: "F6", key: "F6", width: 1.2 },
    { id: "f7", label: "F7", code: "F7", key: "F7", width: 1.2 },
    { id: "f8", label: "F8", code: "F8", key: "F8", width: 1.2 },
  ],
];

/** Compact ABC — every letter with C=/SHIFT PETSCII, plus C64 symbol keys. */
export const TOUCH_ABC: string[][] = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
  ["at", "star", "uparr", "pound", "colon", "semi", "plus", "minus", "eq", "arr"],
];

/** 123 — remaining C64 keys: numbers, F1–F8, CLR/HOME/INST/DEL/RESTORE, CRSR. */
export const TOUCH_SYM: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["plus", "minus", "pound", "at", "star", "colon", "semi", "eq", "uparr", "pi"],
  ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"],
  ["clr", "home", "inst", "del", "restore", "comma", "dot", "slash"],
];

export const TOUCH_CURSORS = ["crsrlr", "crsrud"] as const;

export const LETTER_IDS = "abcdefghijklmnopqrstuvwxyz".split("");

export function hasPetsciiLayer(k: C64Key): boolean {
  if (k.modifier) return false;
  return Boolean(k.cbmPetscii || k.shiftPetscii || (k.shift && k.shift.length <= 4));
}

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
  Insert: 45,
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
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
