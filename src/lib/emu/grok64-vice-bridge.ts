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

export type Grok64Emu = EjsLike;
const asSd = (emu: Grok64Emu | null): EjsLike | null => emu;

type Grok64Module = {
  _grok64_sd2iec_attach?: (unit: number) => void;
  _grok64_sd2iec_poll?: () => void;
  _grok64_c64_read?: (addr: number) => number;
  _grok64_c64_write?: (addr: number, value: number) => void;
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

/** Register JS host functions for a custom Grok64 VICE core (Emscripten imports). */
function bindGrok64WasmExports(mod: Grok64Module & { cwrap?: (...args: unknown[]) => unknown }): void {
  if (mod._grok64_sd2iec_attach) return;
  const wrap = mod.cwrap;
  if (!wrap) return;
  try {
    mod._grok64_sd2iec_attach = wrap("grok64_sd2iec_attach", null, ["number"]) as (unit: number) => void;
    mod._grok64_sd2iec_poll = wrap("grok64_sd2iec_poll", null, []) as () => void;
    mod._grok64_c64_read = wrap("grok64_c64_read", "number", ["number"]) as (addr: number) => number;
    mod._grok64_c64_write = wrap("grok64_c64_write", null, ["number", "number"]) as (addr: number, value: number) => void;
  } catch {
    /* stock core */
  }
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
