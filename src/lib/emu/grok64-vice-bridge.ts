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
  bindGrok64DiskApiDirect,
  bindGrok64WasmApiDirect,
  grok64DiskAttachCallable,
  grok64WasmExportDiag,
  resolveWasmExport,
} from "./grok64-wasm-direct";
import { isGrok64WasmExportsBound, markGrok64WasmExportsBound } from "./grok64-wasm-bind";

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

/** Bind direct WASM export callers (idempotent, once per Module). */
export function bindGrok64WasmExports(mod: Grok64ModuleBag): void {
  if (isGrok64WasmExportsBound(mod)) return;
  const wasmOk = bindGrok64WasmApiDirect(mod);
  const diskOk = bindGrok64DiskApiDirect(mod);
  if (wasmOk || diskOk || grok64DiskAttachCallable(mod) || resolveWasmExport(mod, "grok64_sd2iec_attach")) {
    markGrok64WasmExportsBound(mod);
  }
  bindGrok64DiskExports(mod);
}

export function ensureGrok64WasmExports(emu: Grok64Emu | null): boolean {
  const mod = emu?.Module as Grok64ModuleBag | undefined;
  if (!mod) return false;
  bindGrok64WasmExports(mod);
  const api = grok64WasmApi(mod);
  return Boolean(resolveWasmExport(mod, "grok64_sd2iec_attach") && api?.c64Read);
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
  const hasWasmExports = Boolean(resolveWasmExport(mod, "grok64_sd2iec_attach"));
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
    glog("grok64-vice-bridge", { backend, wasm: true, exports: grok64WasmExportDiag(mod).callable });
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
