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
import { grok64WasmApi, type Grok64ModuleBag } from "./grok64-api";
import {
  grok64PristineCwrap,
  type Grok64WasmModule,
  isGrok64WasmExportsBound,
  markGrok64WasmExportsBound,
} from "./grok64-wasm-bind";

export type Grok64Emu = EjsLike;
const asSd = (emu: Grok64Emu | null): EjsLike | null => emu;

type Grok64Module = Grok64ModuleBag & {
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
  const api = grok64WasmApi(mod);
  return Boolean(api?.sd2iecPoll || api?.sd2iecAttach || mod?.grok64Sd2iecHost);
}

/** Bind Emscripten exports onto Module (idempotent, once per Module). */
export function bindGrok64WasmExports(mod: Grok64ModuleBag): void {
  if (isGrok64WasmExportsBound(mod)) return;
  const wrap = grok64PristineCwrap(mod as Grok64WasmModule);
  if (!wrap) return;
  try {
    if (!mod.grok64WasmApi) {
      mod.grok64WasmApi = {
        sd2iecAttach: wrap("grok64_sd2iec_attach", null, ["number"]) as (unit: number) => void,
        sd2iecPoll: wrap("grok64_sd2iec_poll", null, []) as () => void,
        sd2iecDetach: wrap("grok64_sd2iec_detach", null, ["number"]) as (unit: number) => void,
        c64Read: wrap("grok64_c64_read", "number", ["number"]) as (addr: number) => number,
        c64Write: wrap("grok64_c64_write", null, ["number", "number"]) as (
          addr: number,
          value: number,
        ) => void,
        kbdbufFeed: wrap("grok64_kbdbuf_feed", "number", ["string"]) as (text: string) => number,
        kbdbufFeedRuncmd: wrap("grok64_kbdbuf_feed_runcmd", "number", ["string"]) as (text: string) => number,
        kbdbufFlush: wrap("grok64_kbdbuf_flush", null, []) as () => void,
        cartridgeTriggerFreeze: wrap("grok64_cartridge_trigger_freeze", null, []) as () => void,
        retroKeyboard: wrap("grok64_retro_keyboard", null, [
          "number",
          "number",
          "number",
          "number",
        ]) as (code: number, down: number, character: number, mod: number) => void,
        retroGetMemoryData: wrap("retro_get_memory_data", "number", ["number"]) as (id: number) => number,
        retroGetMemorySize: wrap("retro_get_memory_size", "number", ["number"]) as (id: number) => number,
      };
    }
    bindGrok64DiskExports(mod);
    markGrok64WasmExportsBound(mod);
  } catch {
    /* stock core */
  }
}

export function ensureGrok64WasmExports(emu: Grok64Emu | null): boolean {
  const mod = emu?.Module as Grok64ModuleBag | undefined;
  if (!mod) return false;
  bindGrok64WasmExports(mod);
  const api = grok64WasmApi(mod);
  return Boolean(api?.sd2iecAttach && api?.c64Read);
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
  const api = grok64WasmApi(mod);
  const hasWasmExports = Boolean(api?.sd2iecAttach);
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
  if (hasWasmExports && api) {
    mod.grok64Sd2iecHost = {
      attach: (unit: number) => {
        attachSd2iecBus(asSd(emu), unit as IecDeviceNumber);
        api.sd2iecAttach(unit);
      },
      poll: () => {
        void tickSd2iec(asSd(emu)!);
        api.sd2iecPoll();
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
  const api = grok64WasmApi(mod);
  if (backend === "wasm-sd2iec" && api?.sd2iecPoll) {
    api.sd2iecPoll();
    return;
  }
  await tickSd2iec(asSd(emu)!);
}

export function attachGrok64Sd2iec(emu: Grok64Emu | null, unit: IecDeviceNumber): boolean {
  if (!emu) return false;
  wireGrok64ViceHost(emu);
  const api = grok64WasmApi(emu.Module as Grok64Module);
  if (backend === "wasm-sd2iec" && api?.sd2iecAttach) {
    api.sd2iecAttach(unit);
    attachSd2iecBus(asSd(emu), unit);
    return true;
  }
  return attachSd2iecBus(asSd(emu), unit);
}

export function detachGrok64Sd2iec(emu: Grok64Emu | null, unit: IecDeviceNumber): void {
  if (!emu) return;
  const mod = emu.Module as Grok64Module;
  bindGrok64WasmExports(mod);
  grok64WasmApi(mod)?.sd2iecDetach?.(unit);
}

export { grok64RetroKeyboardAvailable, grok64RetroKeyboardFromDom } from "./grok64-keyboard";
