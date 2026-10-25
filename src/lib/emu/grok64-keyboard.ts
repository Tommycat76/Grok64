/**
 * Grok64 custom core: deliver keys through libretro `retro_keyboard_event`
 * (single path, EmulatorJS rwebinput off). VICE pass-through stays enabled so a
 * held joystick fire (screen click) cannot erase keys mid-press.
 */
import { grok64WasmApi, type Grok64ModuleBag } from "./grok64-api";
import { bindGrok64WasmExports, type Grok64Emu } from "./grok64-vice-bridge";

type Grok64KbdMod = Grok64ModuleBag;

/** ~2 C64 frames at PAL — wall-clock floor for a key press. */
const MIN_HOLD_MS = 48;
/** One PAL frame: the host only sees the emulated clock move in steps of a whole frame. */
const FRAME_CYCLES = 19_656;
const PAL_CYCLES_PER_MS = 985.248;
/**
 * Emulated cycles a key stays down, and stays up before the same key goes down again.
 * VICE applies each host key event 1000 cycles to one frame late, so three frames keep
 * the key in the matrix for two full frames: one KERNAL scan, or two for debounced
 * scanners such as GEOS. Wall-clock holds alone lose keys whenever frames stall.
 */
const SCAN_CYCLES = 3 * FRAME_CYCLES;
/** Host gaps past this are long enough for any scanner; stretching them only adds lag. */
const HOST_GAP_CAP_MS = 120;
/** A paused or throttled emulator must not wedge the delivery queue. */
const MAX_SCAN_WAIT_MS = 300;

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

type KeyStamp = { ms: number; clk: number | null };

const downAt = new Map<number, KeyStamp>();
const upAt = new Map<number, KeyStamp>();

function emuMod(emu: Grok64Emu | null): Grok64KbdMod | undefined {
  return emu?.Module as Grok64KbdMod | undefined;
}

function cpuClock(mod: Grok64KbdMod | undefined): number | null {
  try {
    return grok64WasmApi(mod)?.mainCpuClock?.() ?? null;
  } catch {
    return null;
  }
}

function keyStamp(emu: Grok64Emu | null): KeyStamp {
  return { ms: performance.now(), clk: cpuClock(emuMod(emu)) };
}

/** Until `since` is `minMs` old and the C64 has run SCAN_CYCLES since (or was reset). */
async function waitScanned(emu: Grok64Emu | null, since: KeyStamp | undefined, minMs: number) {
  if (!since) return;
  for (;;) {
    const elapsed = performance.now() - since.ms;
    if (elapsed >= MAX_SCAN_WAIT_MS) return;
    if (elapsed < minMs) {
      await sleep(minMs - elapsed);
      continue;
    }
    if (since.clk == null) return;
    const clk = cpuClock(emuMod(emu));
    if (clk == null || clk < since.clk || clk - since.clk >= SCAN_CYCLES) return;
    await sleep(4);
  }
}

/** Host time (event timeStamp) and emulated clock of the last key change handed to the core. */
let lastChange: { at: number; clk: number | null } | null = null;

/**
 * Until the C64 has run as long as the host gap since the last key change, less one frame
 * of slack so an emulator that keeps time never waits. Frames bunch up and VICE queues key
 * events up to a frame apart, so without this a rollover like V-B-N can reach the matrix
 * with B as the highest key down for less than one KERNAL scan, and B is never typed.
 */
async function waitHostGap(emu: Grok64Emu | null, at: number) {
  const prev = lastChange;
  if (!prev || prev.clk == null) return;
  const need = Math.min(Math.max(0, at - prev.at), HOST_GAP_CAP_MS) * PAL_CYCLES_PER_MS - FRAME_CYCLES;
  if (need <= 0) return;
  const started = performance.now();
  while (performance.now() - started < MAX_SCAN_WAIT_MS) {
    const clk = cpuClock(emuMod(emu));
    if (clk == null || clk < prev.clk || clk - prev.clk >= need) return;
    await sleep(4);
  }
}

async function pressRetro(fn: RetroFn, retro: number, emu: Grok64Emu | null, at = performance.now()) {
  await waitScanned(emu, upAt.get(retro), 0);
  await waitHostGap(emu, at);
  upAt.delete(retro);
  fn(retro, 1, 0, 0);
  const stamp = keyStamp(emu);
  downAt.set(retro, stamp);
  lastChange = { at, clk: stamp.clk };
}

function releaseRetroNow(fn: RetroFn, retro: number, emu: Grok64Emu | null, at = performance.now()) {
  try {
    fn(retro, 0, 0, 0);
  } catch {
    /* ignore */
  }
  if (!downAt.delete(retro)) return;
  const stamp = keyStamp(emu);
  upAt.set(retro, stamp);
  lastChange = { at, clk: stamp.clk };
}

async function releaseRetro(fn: RetroFn, retro: number, emu: Grok64Emu | null, at = performance.now()) {
  await waitScanned(emu, downAt.get(retro), MIN_HOLD_MS);
  await waitHostGap(emu, at);
  releaseRetroNow(fn, retro, emu, at);
}

function flushAllKeys(fn: RetroFn) {
  for (const retro of downAt.keys()) {
    try {
      fn(retro, 0, 0, 0);
    } catch {
      /* ignore */
    }
  }
  downAt.clear();
  upAt.clear();
  lastChange = null;
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

/** C64 CLR (Shift+HOME) via libretro keys — never queues BASIC into kbdbuf. */
export function clearC64ScreenRetro(emu: Grok64Emu | null): void {
  enqueueDelivery(async () => {
    const mod = emu?.Module as Grok64KbdMod | undefined;
    if (!mod) return;
    bindGrok64WasmExports(mod);
    const fn = grok64WasmApi(mod)?.retroKeyboard;
    if (!fn) return;
    const home = RETROK.Home;
    await pressRetro(fn, RETROK.ShiftLeft, emu);
    await sleep(24);
    await pressRetro(fn, home, emu);
    await releaseRetro(fn, home, emu);
    releaseRetroNow(fn, RETROK.ShiftLeft, emu);
    paintHook?.(emu);
  });
}

/**
 * C64 key positions for symbols (aligned with `keys.ts` EXTRA / C64_ROWS), per the core's
 * positional keymap (vice-libretro `retrodep/arch_keymap.c`, X64): `RETROK_MINUS` is the C64
 * **+** key, `RETROK_BACKSLASH` is **=**, and `RETROK_OEM_102` (IntlBackslash) is **<** / **>**.
 */
const C64_GLYPH: Record<string, { code: string; shift: boolean }> = {
  "+": { code: "Minus", shift: false },
  "-": { code: "Equal", shift: false },
  "=": { code: "Backslash", shift: false },
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

async function holdRetro(fn: RetroFn, retro: number, emu: Grok64Emu | null) {
  await pressRetro(fn, retro, emu);
  await releaseRetro(fn, retro, emu);
  paintHook?.(emu);
}

/** Ensure C64 shift is up before an unshifted key (host Shift often leaks after `"` / `$`). */
async function releaseC64Shift(fn: RetroFn, emu: Grok64Emu | null) {
  const since = keyStamp(emu);
  for (const retro of [RETROK.ShiftLeft, RETROK.ShiftRight]) releaseRetroNow(fn, retro, emu);
  await waitScanned(emu, since, MIN_HOLD_MS);
  paintHook?.(emu);
}

async function playSyntheticShiftedGlyph(fn: RetroFn, glyph: string, emu: Grok64Emu | null) {
  const spec = C64_GLYPH[glyph];
  if (!spec?.shift) return false;
  const retro = domCodeToRetrok(spec.code);
  const shiftRetro = RETROK.ShiftLeft;
  if (retro == null || shiftRetro == null) return false;
  releaseRetroNow(fn, shiftRetro, emu);
  await pressRetro(fn, shiftRetro, emu);
  await sleep(24);
  await holdRetro(fn, retro, emu);
  await releaseC64Shift(fn, emu);
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
  at: number,
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
      await releaseRetro(fn, retro, emu, at);
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
      await releaseRetro(fn, retro, emu, at);
      paintHook?.(emu);
      return;
    }

    if (mods.shift && /^[A-Z]$/.test(key)) {
      releaseRetroNow(fn, RETROK.ShiftLeft, emu);
    }

    if (down && stroke.code === "Home") {
      const homeRetro = RETROK.Home;
      if (homeRetro != null) {
        const clr = !!(stroke.mods.shift || mods.shift);
        if (clr) {
          await pressRetro(fn, RETROK.ShiftLeft, emu);
          await sleep(24);
        }
        await holdRetro(fn, homeRetro, emu);
        if (clr) {
          await releaseC64Shift(fn, emu);
        }
        eatKeyUp.add(tag);
        eatKeyUp.add(eventTag(stroke.code, stroke.key));
        return;
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
      await sleep(MIN_HOLD_MS);
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
      await pressRetro(fn, RETROK.ShiftLeft, emu, at);
    } else if (hostShiftChord && !mods.shift) {
      hostShiftChord = false;
    }

    await pressRetro(fn, retro, emu, at);
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

/** `at`: when the host event happened (DOM `event.timeStamp`), so a late dispatch keeps its spacing. */
export function grok64RetroKeyboardFromDom(
  emu: Grok64Emu | null,
  code: string,
  key: string,
  down: boolean,
  mods: KbdMods = {},
  at: number = performance.now(),
): boolean {
  if (!emu?.Module) return false;
  const mod = emu.Module as Grok64KbdMod;
  bindGrok64WasmExports(mod);
  const fn = grok64WasmApi(mod)?.retroKeyboard;
  if (!fn) return false;

  const stroke = resolveHostStroke(code, key, mods);
  if (!down && (stroke.swallowUp || eatKeyUp.has(eventTag(code, key)))) {
    scheduleDomKey(emu, fn, code, key, down, mods, at);
    return true;
  }

  scheduleDomKey(emu, fn, code, key, down, mods, at);
  return true;
}
