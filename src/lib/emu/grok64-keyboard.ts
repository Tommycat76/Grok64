/**
 * Grok64 custom core: deliver keys through libretro `retro_keyboard_event`
 * (single path). Avoids EmulatorJS DOM glue + VICE pass-through double delivery.
 */
import { bindGrok64WasmExports, type Grok64Emu } from "./grok64-vice-bridge";

type Grok64KbdMod = {
  _grok64_retro_keyboard?: (code: number, down: number, character: number, mod: number) => void;
};

const RETROKMOD_SHIFT = 0x01;
const RETROKMOD_CTRL = 0x02;
const RETROKMOD_ALT = 0x04;

/** libretro `enum retro_key` — must match libretro.h (not ASCII / legacy keyCodes). */
const RETROK: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  Space: 32,
  Minus: 45,
  Equal: 61,
  BracketLeft: 91,
  BracketRight: 93,
  Backslash: 92,
  Semicolon: 59,
  Quote: 39,
  Comma: 44,
  Period: 46,
  Slash: 47,
  Backquote: 96,
  IntlBackslash: 323,
  ArrowUp: 273,
  ArrowDown: 274,
  ArrowRight: 275,
  ArrowLeft: 276,
  Insert: 277,
  Delete: 127,
  Home: 278,
  End: 279,
  PageUp: 280,
  PageDown: 281,
  ShiftLeft: 304,
  ShiftRight: 303,
  ControlLeft: 306,
  ControlRight: 305,
  AltLeft: 308,
  AltRight: 307,
  CapsLock: 301,
  F1: 282,
  F2: 283,
  F3: 284,
  F4: 285,
  F5: 286,
  F6: 287,
  F7: 288,
  F8: 289,
};

type KbdMods = { shift?: boolean; ctrl?: boolean; alt?: boolean };

/** C64 key positions for symbols (aligned with `keys.ts` EXTRA / C64_ROWS). */
const C64_GLYPH: Record<string, { code: string; shift: boolean }> = {
  "+": { code: "Minus", shift: false },
  "-": { code: "Equal", shift: false },
  "=": { code: "IntlBackslash", shift: false },
  '"': { code: "Digit2", shift: true },
  $: { code: "Digit4", shift: true },
  "!": { code: "Digit1", shift: true },
  "#": { code: "Digit3", shift: true },
  "%": { code: "Digit5", shift: true },
  "&": { code: "Digit6", shift: true },
  "'": { code: "Digit7", shift: true },
  "(": { code: "Digit8", shift: true },
  ")": { code: "Digit9", shift: true },
  "@": { code: "BracketLeft", shift: false },
  "*": { code: "BracketRight", shift: false },
  ":": { code: "Semicolon", shift: false },
  ";": { code: "Quote", shift: false },
  ",": { code: "Comma", shift: false },
  ".": { code: "Period", shift: false },
  "/": { code: "Slash", shift: false },
  "<": { code: "Comma", shift: true },
  ">": { code: "Period", shift: true },
  "?": { code: "Slash", shift: true },
};

function isPlainLetterOrDigit(key: string, code: string): boolean {
  if (/^[a-z]$/.test(key)) return code === `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return code === `Digit${key}`;
  return false;
}

function emitC64Glyph(
  fn: (code: number, down: number, character: number, mod: number) => void,
  glyph: string,
  down: boolean,
): boolean {
  const spec = C64_GLYPH[glyph];
  if (!spec) return false;
  const retro = domCodeToRetrok(spec.code);
  const shiftRetro = RETROK.ShiftLeft;
  if (retro == null || shiftRetro == null) return false;
  if (spec.shift) {
    if (!down) return true;
    fn(shiftRetro, 1, 0, 0);
    window.setTimeout(() => {
      fn(retro, 1, 0, 0);
      window.setTimeout(() => {
        fn(retro, 0, 0, 0);
        fn(shiftRetro, 0, 0, 0);
      }, 45);
    }, 45);
    return true;
  }
  fn(retro, down ? 1 : 0, 0, 0);
  return true;
}

function domCodeToRetrok(code: string): number | null {
  const named = RETROK[code];
  if (named != null) return named;
  if (code.startsWith("Key") && code.length === 4) {
    const o = code.charCodeAt(3) - 65;
    if (o >= 0 && o <= 25) return 97 + o;
  }
  if (code.startsWith("Digit") && code.length === 6) {
    const d = code.charCodeAt(5);
    if (d >= 48 && d <= 57) return d;
  }
  if (code.startsWith("Numpad") && code.length === 7) {
    const d = code.charCodeAt(6);
    if (d >= 48 && d <= 57) return d;
  }
  return null;
}

function retroMods(mods: KbdMods): number {
  let m = 0;
  if (mods.shift) m |= RETROKMOD_SHIFT;
  if (mods.ctrl) m |= RETROKMOD_CTRL;
  if (mods.alt) m |= RETROKMOD_ALT;
  return m;
}

export function grok64RetroKeyboardAvailable(emu: Grok64Emu | null): boolean {
  const mod = emu?.Module as Grok64KbdMod | undefined;
  if (!mod) return false;
  bindGrok64WasmExports(mod);
  return typeof mod._grok64_retro_keyboard === "function";
}

export function grok64RetroKeyboardFromDom(
  emu: Grok64Emu | null,
  code: string,
  key: string,
  down: boolean,
  mods: KbdMods = {},
): boolean {
  if (!emu?.Module) return false;
  const mod = emu.Module as Grok64KbdMod;
  bindGrok64WasmExports(mod);
  const fn = mod._grok64_retro_keyboard;
  if (!fn) return false;

  if (key.length === 1 && C64_GLYPH[key] && !isPlainLetterOrDigit(key, code)) {
    try {
      return emitC64Glyph(fn, key, down);
    } catch {
      return false;
    }
  }

  let shift = !!mods.shift;
  if (shift && key.length === 1 && C64_GLYPH[key]) {
    try {
      return emitC64Glyph(fn, key, down);
    } catch {
      return false;
    }
  }

  const retro = domCodeToRetrok(code);
  if (retro == null) return false;
  const ch = down && key.length === 1 ? key.charCodeAt(0) : 0;
  try {
    fn(retro, down ? 1 : 0, ch, retroMods({ shift, ctrl: mods.ctrl, alt: mods.alt }));
    return true;
  } catch {
    return false;
  }
}
