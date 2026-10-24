/**
 * Grok64 custom core: deliver keys through libretro `retro_keyboard_event`
 * (single path). Avoids EmulatorJS DOM glue + VICE pass-through double delivery.
 */
import { grok64WasmApi, type Grok64ModuleBag } from "./grok64-api";
import { bindGrok64WasmExports, type Grok64Emu } from "./grok64-vice-bridge";

type Grok64KbdMod = Grok64ModuleBag;

/** ~2 C64 frames at PAL — matrix needs the key held long enough to scan. */
const MIN_HOLD_MS = 40;
const MIN_HOLD_FAST_MS = 10;

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
let deliveryDepth = 0;

function effectiveHoldMs() {
  return deliveryDepth > 2 ? MIN_HOLD_FAST_MS : MIN_HOLD_MS;
}

/** Host Shift is held for the next US-layout chord (+, ", $) — do not mirror to C64. */
let hostShiftChord = false;
let swallowHostShiftUp = false;

const eatKeyUp = new Set<string>();

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function enqueueDelivery(task: () => void | Promise<void>) {
  deliveryDepth += 1;
  deliveryChain = deliveryChain
    .then(() => Promise.resolve(task()))
    .catch(() => undefined)
    .finally(() => {
      deliveryDepth = Math.max(0, deliveryDepth - 1);
    });
}

export function setGrok64KeyboardPaintHook(fn: ((emu: Grok64Emu | null) => void) | null) {
  paintHook = fn;
}

const downAt = new Map<number, number>();

function flushAllKeys(fn: RetroFn) {
  for (const retro of downAt.keys()) {
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
  hostShiftChord = false;
  swallowHostShiftUp = false;
  eatKeyUp.clear();
}

export function grok64KeyboardReleaseAll(emu: Grok64Emu | null) {
  deliveryChain = Promise.resolve();
  deliveryDepth = 0;
  const mod = emu?.Module as Grok64KbdMod | undefined;
  const fn = grok64WasmApi(mod)?.retroKeyboard;
  if (!fn) return;
  flushAllKeys(fn);
}

/**
 * C64 key positions for symbols (aligned with `keys.ts` EXTRA / C64_ROWS).
 * DOM `code: "Minus"` → libretro `RETROK_MINUS` is the C64 **+** key (left of −).
 */
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
  if (code === "NumpadAdd") return RETROK.Minus;
  if (code === "NumpadSubtract") return RETROK.Equal;
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

function isHostShiftCode(code: string) {
  return code === "ShiftLeft" || code === "ShiftRight";
}

function eventTag(code: string, key: string) {
  return `${code}\0${key}`;
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
): { code: string; key: string; mods: KbdMods; swallowUp?: boolean; hostShiftChord?: boolean } {
  let shift = !!mods.shift;

  if (shift && (code === "Digit2" || key === "@" || key === '"')) {
    return { code: "Digit2", key: '"', mods: { ...mods, shift: false }, swallowUp: true };
  }
  if (shift && (code === "Digit4" || key === "$")) {
    return { code: "Digit4", key: "$", mods: { ...mods, shift: false }, swallowUp: true };
  }
  if (shift && (code === "Quote" || code === "Apostrophe" || key === "'")) {
    return { code: "Digit2", key: '"', mods: { ...mods, shift: false }, swallowUp: true };
  }

  if (key === '"') {
    return { code: "Digit2", key: '"', mods: { ...mods, shift: false }, swallowUp: true };
  }
  if (key === "$") {
    return { code: "Digit4", key: "$", mods: { ...mods, shift: false }, swallowUp: true };
  }

  if (shift && /^[A-Z]$/.test(key)) {
    return { code: `Key${key}`, key: key.toLowerCase(), mods: { ...mods, shift: false } };
  }

  const glyph = key.length === 1 ? C64_GLYPH[key] : undefined;
  if (glyph) {
    const hostPlain =
      (key === "+" && (code === "Minus" || code === "NumpadAdd")) ||
      (key === "-" && code === "Equal") ||
      (/^[a-z0-9]$/i.test(key) && (code === `Key${key.toUpperCase()}` || code === `Digit${key}`));
    if (!hostPlain) {
      if (glyph.shift && !shift) {
        return { code: glyph.code, key, mods: { ...mods, shift: false }, swallowUp: true };
      }
      if (shift && !glyph.shift) {
        return {
          code: glyph.code,
          key,
          mods: { ...mods, shift: false },
          hostShiftChord: true,
        };
      }
      return { code: glyph.code, key, mods: { ...mods, shift: glyph.shift && shift } };
    }
  }

  if (key === "+" || (code === "Equal" && (shift || key === "+")) || code === "NumpadAdd") {
    return { code: "Minus", key: "+", mods: { ...mods, shift: false }, hostShiftChord: shift };
  }
  if (key === "-" && code === "Minus" && !shift) {
    return { code: "Equal", key: "-", mods: { ...mods, shift: false } };
  }
  if (shift && (key === "'" || key === '"' || code === "Quote")) {
    return { code: "Digit2", key: '"', mods: { ...mods, shift: false }, swallowUp: true };
  }

  return { code, key, mods: { ...mods, shift } };
}

async function holdRetro(fn: RetroFn, retro: number, emu: Grok64Emu | null, holdMs?: number) {
  const hold = holdMs ?? effectiveHoldMs();
  fn(retro, 1, 0, 0);
  downAt.set(retro, performance.now());
  await sleep(hold);
  fn(retro, 0, 0, 0);
  downAt.delete(retro);
  paintHook?.(emu);
}

/** Ensure C64 shift is up before an unshifted key (host Shift often leaks after `"` / `$`). */
async function releaseC64Shift(fn: RetroFn, emu: Grok64Emu | null) {
  for (const retro of [RETROK.ShiftLeft, RETROK.ShiftRight]) {
    try {
      fn(retro, 0, 0, 0);
    } catch {
      /* ignore */
    }
    downAt.delete(retro);
  }
  await sleep(effectiveHoldMs());
  paintHook?.(emu);
}

async function playSyntheticShiftedGlyph(fn: RetroFn, glyph: string, emu: Grok64Emu | null) {
  const spec = C64_GLYPH[glyph];
  if (!spec?.shift) return false;
  const retro = domCodeToRetrok(spec.code);
  const shiftRetro = RETROK.ShiftLeft;
  if (retro == null || shiftRetro == null) return false;
  try {
    fn(shiftRetro, 0, 0, 0);
  } catch {
    /* ignore */
  }
  fn(shiftRetro, 1, 0, 0);
  await sleep(24);
  await holdRetro(fn, retro, emu);
  await releaseC64Shift(fn, emu);
  downAt.delete(shiftRetro);
  hostShiftChord = false;
  swallowHostShiftUp = true;
  await sleep(72);
  paintHook?.(emu);
  return true;
}

function scheduleDomKey(
  emu: Grok64Emu | null,
  fn: RetroFn,
  code: string,
  key: string,
  down: boolean,
  mods: KbdMods,
) {
  enqueueDelivery(async () => {
    if (isHostShiftCode(code)) {
      if (down) {
        hostShiftChord = true;
        return;
      }
      if (swallowHostShiftUp) {
        swallowHostShiftUp = false;
        hostShiftChord = false;
        return;
      }
      hostShiftChord = false;
      const retro = domCodeToRetrok(code);
      if (retro == null) return;
      if (down) {
        fn(retro, 1, 0, 0);
        downAt.set(retro, performance.now());
      } else {
        const started = downAt.get(retro) ?? performance.now();
        const hold = effectiveHoldMs();
        await sleep(Math.max(0, hold - (performance.now() - started)));
        fn(retro, 0, 0, 0);
        downAt.delete(retro);
      }
      paintHook?.(emu);
      return;
    }

    const stroke = resolveHostStroke(code, key, mods);
    const tag = eventTag(code, key);

    if (down && key.length === 1 && !mods.shift && !isHostShiftCode(code)) {
      hostShiftChord = false;
    }

    if (!down) {
      if (stroke.swallowUp || eatKeyUp.has(tag)) {
        eatKeyUp.delete(tag);
        return;
      }
      const retro = domCodeToRetrok(stroke.code);
      if (retro == null) return;
      const started = downAt.get(retro) ?? performance.now();
      const hold = effectiveHoldMs();
      await sleep(Math.max(0, hold - (performance.now() - started)));
      fn(retro, 0, 0, 0);
      downAt.delete(retro);
      paintHook?.(emu);
      return;
    }

    if (mods.shift && /^[A-Z]$/.test(key)) {
      try {
        fn(RETROK.ShiftLeft, 0, 0, 0);
        downAt.delete(RETROK.ShiftLeft);
      } catch {
        /* ignore */
      }
    }

    if (stroke.swallowUp && C64_GLYPH[stroke.key]?.shift) {
      if (mods.shift) {
        swallowHostShiftUp = true;
        hostShiftChord = false;
      }
      await playSyntheticShiftedGlyph(fn, stroke.key, emu);
      eatKeyUp.add(eventTag(stroke.code, stroke.key));
      eatKeyUp.add(eventTag(code, key));
      await sleep(48);
      return;
    }

    if (
      down &&
      mods.shift &&
      /^Key[A-Z]$/.test(code) &&
      deliveryDepth > 0
    ) {
      await sleep(effectiveHoldMs());
    }

    const retro = domCodeToRetrok(stroke.code);
    if (retro == null) return;

    if (!stroke.mods.shift && (mods.shift || downAt.has(RETROK.ShiftLeft) || downAt.has(RETROK.ShiftRight))) {
      await releaseC64Shift(fn, emu);
      if (mods.shift) swallowHostShiftUp = true;
      hostShiftChord = false;
    }

    if (stroke.hostShiftChord || (hostShiftChord && mods.shift && !stroke.mods.shift)) {
      hostShiftChord = false;
      swallowHostShiftUp = true;
      await holdRetro(fn, retro, emu);
      await releaseC64Shift(fn, emu);
      eatKeyUp.add(tag);
      return;
    }

    if (mods.shift && stroke.mods.shift && hostShiftChord) {
      hostShiftChord = false;
      fn(RETROK.ShiftLeft, 1, 0, 0);
      downAt.set(RETROK.ShiftLeft, performance.now());
    } else if (hostShiftChord && !mods.shift) {
      hostShiftChord = false;
    }

    fn(retro, 1, 0, 0);
    downAt.set(retro, performance.now());
    paintHook?.(emu);
  });
}

export function grok64RetroKeyboardAvailable(emu: Grok64Emu | null): boolean {
  const mod = emu?.Module as Grok64KbdMod | undefined;
  if (!mod) return false;
  bindGrok64WasmExports(mod);
  return typeof grok64WasmApi(mod)?.retroKeyboard === "function";
}

/** Wait until enqueued key events (incl. synthetic shift) have finished. */
export function grok64KeyboardDrain(): Promise<void> {
  return deliveryChain;
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
  const fn = grok64WasmApi(mod)?.retroKeyboard;
  if (!fn) return false;

  const stroke = resolveHostStroke(code, key, mods);
  if (!down && (stroke.swallowUp || eatKeyUp.has(eventTag(code, key)))) {
    scheduleDomKey(emu, fn, code, key, down, mods);
    return true;
  }

  scheduleDomKey(emu, fn, code, key, down, mods);
  return true;
}
