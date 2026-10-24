/**
 * Grok64 ↔ custom vice-libretro WASM (when built with GROK64_SD2IEC).
 * Falls back to KERNAL IEC intercept in sd2iec.ts on stock EmulatorJS cores.
 */
import { readC64Byte, writeC64Byte } from "./c64-memory";
import { glog } from "./debug";
import {
  attachSd2iecBus,
  grok64WasmIecHost,
  setSd2iecWasmIecOnly,
  tickSd2iec,
  type EjsLike,
  type IecDeviceNumber,
} from "./sd2iec";
import { bindGrok64DiskExports } from "./vice-disk";
import {
  grok64PristineCwrap,
  type Grok64WasmModule,
  isGrok64WasmExportsBound,
  markGrok64WasmExportsBound,
} from "./grok64-wasm-bind";

export type Grok64Emu = EjsLike;
const asSd = (emu: Grok64Emu | null): EjsLike | null => emu;

type Grok64Module = {
  _grok64_sd2iec_attach?: (unit: number) => void;
  _grok64_sd2iec_poll?: () => void;
  _grok64_c64_read?: (addr: number) => number;
  _grok64_c64_write?: (addr: number, value: number) => void;
  _grok64_kbdbuf_feed?: (text: string) => void;
  _grok64_kbdbuf_feed_runcmd?: (text: string) => void;
  _grok64_sd2iec_detach?: (unit: number) => void;
  _grok64_cartridge_trigger_freeze?: () => void;
  _grok64_retro_keyboard?: (code: number, down: number, character: number, mod: number) => void;
  grok64Sd2iecHost?: {
    poll: () => void;
    attach: (unit: number) => void;
  };
};

export type Grok64IecBackend = "wasm-sd2iec" | "js-kernal" | "none";

let backend: Grok64IecBackend = "none";

export function grok64IecBackend(): Grok64IecBackend {
  return backend;
}

export function probeGrok64ViceModule(emu: Grok64Emu | null): boolean {
  const mod = emu?.Module as Grok64Module | undefined;
  return Boolean(mod?._grok64_sd2iec_poll || mod?._grok64_sd2iec_attach || mod?.grok64Sd2iecHost);
}

/** Bind Emscripten exports onto Module (idempotent, once per Module). */
export function bindGrok64WasmExports(mod: Grok64Module & { cwrap?: (...args: unknown[]) => unknown }): void {
  if (isGrok64WasmExportsBound(mod)) return;
  const wrap = grok64PristineCwrap(mod as Grok64WasmModule);
  if (!wrap) return;
  markGrok64WasmExportsBound(mod);
  try {
    if (!mod._grok64_sd2iec_attach) {
      mod._grok64_sd2iec_attach = wrap("grok64_sd2iec_attach", null, ["number"]) as (unit: number) => void;
    }
    if (!mod._grok64_sd2iec_poll) {
      mod._grok64_sd2iec_poll = wrap("grok64_sd2iec_poll", null, []) as () => void;
    }
    if (!mod._grok64_c64_read) {
      mod._grok64_c64_read = wrap("grok64_c64_read", "number", ["number"]) as (addr: number) => number;
    }
    if (!mod._grok64_c64_write) {
      mod._grok64_c64_write = wrap("grok64_c64_write", null, ["number", "number"]) as (
        addr: number,
        value: number,
      ) => void;
    }
    if (!mod._grok64_kbdbuf_feed) {
      mod._grok64_kbdbuf_feed = wrap("grok64_kbdbuf_feed", null, ["string"]) as (text: string) => void;
    }
    if (!mod._grok64_kbdbuf_feed_runcmd) {
      mod._grok64_kbdbuf_feed_runcmd = wrap("grok64_kbdbuf_feed_runcmd", null, ["string"]) as (text: string) => void;
    }
    if (!mod._grok64_sd2iec_detach) {
      mod._grok64_sd2iec_detach = wrap("grok64_sd2iec_detach", null, ["number"]) as (unit: number) => void;
    }
    if (!mod._grok64_cartridge_trigger_freeze) {
      mod._grok64_cartridge_trigger_freeze = wrap("grok64_cartridge_trigger_freeze", null, []) as () => void;
    }
    if (!mod._grok64_retro_keyboard) {
      mod._grok64_retro_keyboard = wrap("grok64_retro_keyboard", null, [
        "number",
        "number",
        "number",
        "number",
      ]) as (code: number, down: number, character: number, mod: number) => void;
    }
    bindGrok64DiskExports(mod as Parameters<typeof bindGrok64DiskExports>[0]);
    const modAny = mod as {
      _retro_get_memory_data?: (id: number) => number;
      _retro_get_memory_size?: (id: number) => number;
    };
    if (!modAny._retro_get_memory_data) {
      modAny._retro_get_memory_data = wrap("retro_get_memory_data", "number", ["number"]) as (
        id: number,
      ) => number;
    }
    if (!modAny._retro_get_memory_size) {
      modAny._retro_get_memory_size = wrap("retro_get_memory_size", "number", ["number"]) as (
        id: number,
      ) => number;
    }
  } catch {
    /* stock core */
  }
}

export function ensureGrok64WasmExports(emu: Grok64Emu | null): boolean {
  const mod = emu?.Module as Grok64Module & { cwrap?: (...args: unknown[]) => unknown };
  if (!mod) return false;
  bindGrok64WasmExports(mod);
  return Boolean(mod._grok64_sd2iec_attach && mod._grok64_c64_read);
}

export function wireGrok64ViceHost(emu: Grok64Emu | null): Grok64IecBackend {
  if (!emu?.Module) {
    backend = "none";
    return backend;
  }
  const mod = emu.Module as Grok64Module & {
    grok64Host?: {
      sd2iecAttach?: (u: number) => void;
      sd2iecPoll?: () => void;
      c64Read?: (a: number) => number;
      c64Write?: (a: number, v: number) => void;
    };
  };
  bindGrok64WasmExports(mod);
  const hasWasmExports = Boolean(mod._grok64_sd2iec_attach);
  setSd2iecWasmIecOnly(hasWasmExports);
  mod.grok64Host = {
    ...grok64WasmIecHost,
    sd2iecAttach: (unit) => attachSd2iecBus(asSd(emu), unit as IecDeviceNumber),
    sd2iecPoll: () => {
      const e = asSd(emu);
      if (e) void tickSd2iec(e);
    },
    c64Read: (addr) => readC64Byte(emu, addr) ?? 0,
    c64Write: (addr, value) => {
      writeC64Byte(emu, addr, value);
    },
  };
  if (hasWasmExports) {
    mod.grok64Sd2iecHost = {
      attach: (unit: number) => {
        attachSd2iecBus(asSd(emu), unit as IecDeviceNumber);
        mod._grok64_sd2iec_attach?.(unit);
      },
      poll: () => {
        void tickSd2iec(asSd(emu)!);
        mod._grok64_sd2iec_poll?.();
      },
    };
    backend = "wasm-sd2iec";
    glog("grok64-vice-bridge", { backend, wasm: true });
    return backend;
  }
  backend = "js-kernal";
  return backend;
}

export async function tickGrok64Iec(emu: Grok64Emu | null): Promise<void> {
  if (!emu) return;
  const mod = emu.Module as Grok64Module;
  if (backend === "wasm-sd2iec" && mod._grok64_sd2iec_poll) {
    mod._grok64_sd2iec_poll();
    return;
  }
  await tickSd2iec(asSd(emu)!);
}

export function attachGrok64Sd2iec(emu: Grok64Emu | null, unit: IecDeviceNumber): boolean {
  if (!emu) return false;
  wireGrok64ViceHost(emu);
  const mod = emu.Module as Grok64Module;
  if (backend === "wasm-sd2iec" && mod._grok64_sd2iec_attach) {
    mod._grok64_sd2iec_attach(unit);
    attachSd2iecBus(asSd(emu), unit);
    return true;
  }
  return attachSd2iecBus(asSd(emu), unit);
}

export function detachGrok64Sd2iec(emu: Grok64Emu | null, unit: IecDeviceNumber): void {
  if (!emu) return;
  const mod = emu.Module as Grok64Module;
  bindGrok64WasmExports(mod);
  mod._grok64_sd2iec_detach?.(unit);
}

export { grok64RetroKeyboardAvailable, grok64RetroKeyboardFromDom } from "./grok64-keyboard";
