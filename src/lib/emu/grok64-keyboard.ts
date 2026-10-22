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

/** ~2 C64 frames at PAL — matrix needs the key held long enough to scan. */
const MIN_HOLD_MS = 48;

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

type RetroFn = (code: number, down: number, character: number, mod: number) => void;

let paintHook: ((emu: Grok64Emu | null) => void) | null = null;
let deliveryChain: Promise<void> = Promise.resolve();

function enqueueDelivery(task: () => void | Promise<void>) {
  deliveryChain = deliveryChain.then(task).catch(() => undefined);
}

export function setGrok64KeyboardPaintHook(fn: ((emu: Grok64Emu | null) => void) | null) {
  paintHook = fn;
}

const pendingUp = new Map<number, number>();
const downAt = new Map<number, number>();

function cancelPendingUp(retro: number) {
  const t = pendingUp.get(retro);
  if (t != null) {
    window.clearTimeout(t);
    pendingUp.delete(retro);
  }
}

function flushAllKeys(fn: RetroFn) {
  for (const retro of downAt.keys()) {
    cancelPendingUp(retro);
    try {
      fn(retro, 0, 0, 0);
    } catch {
      /* ignore */
    }
  }
  downAt.clear();
  try {
    fn(RETROK.ShiftLeft, 0, 0, 0);
    fn(RETROK.ShiftRight, 0, 0, 0);
  } catch {
    /* ignore */
  }
}

export function grok64KeyboardReleaseAll(emu: Grok64Emu | null) {
  const mod = emu?.Module as Grok64KbdMod | undefined;
  if (!mod?._grok64_retro_keyboard) return;
  flushAllKeys(mod._grok64_retro_keyboard);
}

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

/**
 * Host → C64 stroke. X11/Chromium often send Shift+letter for capitals; on a C64
 * that prints PETSCII graphics, not the letter. Shifted US punctuation also needs
 * remapping to the C64 keycap positions.
 */
function resolveHostStroke(
  code: string,
  key: string,
  mods: KbdMods,
): { code: string; key: string; mods: KbdMods; swallowUp?: boolean } {
  let shift = !!mods.shift;

  if (shift && /^[A-Z]$/.test(key)) {
    return { code: `Key${key}`, key: key.toLowerCase(), mods: { ...mods, shift: false } };
  }

  const glyph = key.length === 1 ? C64_GLYPH[key] : undefined;
  if (glyph) {
    const hostPlain =
      (key === "+" && code === "Minus") ||
      (key === "-" && code === "Equal") ||
      (/^[a-z0-9]$/i.test(key) && (code === `Key${key.toUpperCase()}` || code === `Digit${key}`));
    if (!hostPlain) {
      if (glyph.shift && !shift) {
        return { code: glyph.code, key, mods: { ...mods, shift: false }, swallowUp: true };
      }
      return { code: glyph.code, key, mods: { ...mods, shift: glyph.shift && shift } };
    }
  }

  if (key === "+" || (code === "Equal" && (shift || key === "+"))) {
    return { code: "Minus", key: "+", mods: { ...mods, shift: false } };
  }
  if (key === "-" && code === "Minus" && !shift) {
    return { code: "Equal", key: "-", mods: { ...mods, shift: false } };
  }
  if (shift && (key === '"' || code === "Quote")) {
    return { code: "Digit2", key: "2", mods: { ...mods, shift: false } };
  }
  if (shift && (key === "$" || code === "Digit4")) {
    return { code: "Digit4", key: "4", mods: { ...mods, shift: false } };
  }

  return { code, key, mods: { ...mods, shift } };
}

function deliverRetro(fn: RetroFn, retro: number, down: boolean) {
  if (down) {
    cancelPendingUp(retro);
    fn(retro, 1, 0, 0);
    downAt.set(retro, performance.now());
    return;
  }
  const started = downAt.get(retro) ?? performance.now();
  const wait = Math.max(0, MIN_HOLD_MS - (performance.now() - started));
  cancelPendingUp(retro);
  const timer = window.setTimeout(() => {
    fn(retro, 0, 0, 0);
    pendingUp.delete(retro);
    downAt.delete(retro);
  }, wait);
  pendingUp.set(retro, timer);
}

function playSyntheticShiftedGlyph(fn: RetroFn, glyph: string, emu: Grok64Emu | null): boolean {
  const spec = C64_GLYPH[glyph];
  if (!spec?.shift) return false;
  const retro = domCodeToRetrok(spec.code);
  const shiftRetro = RETROK.ShiftLeft;
  if (retro == null || shiftRetro == null) return false;
  enqueueDelivery(
    () =>
      new Promise<void>((resolve) => {
        cancelPendingUp(shiftRetro);
        cancelPendingUp(retro);
        try {
          fn(shiftRetro, 0, 0, 0);
        } catch {
          /* ignore */
        }
        fn(shiftRetro, 1, 0, 0);
        window.setTimeout(() => {
          fn(retro, 1, 0, 0);
          window.setTimeout(() => {
            fn(retro, 0, 0, 0);
            window.setTimeout(() => {
              fn(shiftRetro, 0, 0, 0);
              downAt.delete(retro);
              downAt.delete(shiftRetro);
              paintHook?.(emu);
              resolve();
            }, MIN_HOLD_MS);
          }, MIN_HOLD_MS);
        }, 24);
      }),
  );
  return true;
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

  const stroke = resolveHostStroke(code, key, mods);
  if (!down && stroke.swallowUp) return true;

  if (down && mods.shift && /^[A-Z]$/.test(key)) {
    cancelPendingUp(RETROK.ShiftLeft);
    try {
      fn(RETROK.ShiftLeft, 0, 0, 0);
      downAt.delete(RETROK.ShiftLeft);
    } catch {
      /* ignore */
    }
  }

  if (down && stroke.swallowUp && key.length === 1 && C64_GLYPH[key]?.shift && !mods.shift) {
    try {
      const ok = playSyntheticShiftedGlyph(fn, key, emu);
      if (ok) {
        paintHook?.(emu);
        return true;
      }
    } catch {
      return false;
    }
  }

  const retro = domCodeToRetrok(stroke.code);
  if (retro == null) return false;

  try {
    if (down) {
      deliverRetro(fn, retro, true);
    } else {
      deliverRetro(fn, retro, false);
    }
    paintHook?.(emu);
    return true;
  } catch {
    return false;
  }
}
