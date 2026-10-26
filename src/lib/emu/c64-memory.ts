/** C64 system RAM via libretro RETRO_MEMORY_SYSTEM_RAM (64 KiB). */

import { grok64WasmApi, type Grok64ModuleBag } from "./grok64-api";
import { bindGrok64WasmExports } from "./grok64-vice-bridge";

export type RamEmu = {
  Module?: Grok64ModuleBag & {
    HEAPU8?: Uint8Array;
    HEAP8?: Int8Array;
    wasmMemory?: WebAssembly.Memory;
    cwrap?: (name: string, ret: string | null, args: string[]) => (...a: unknown[]) => unknown;
  };
};

const RETRO_MEMORY_SYSTEM_RAM = 2;

function wasmApiFor(emu: RamEmu | null) {
  const mod = emu?.Module;
  if (!mod) return null;
  if (!grok64WasmApi(mod) && mod.cwrap) bindGrok64WasmExports(mod);
  return grok64WasmApi(mod);
}

export function c64RamView(emu: RamEmu | null): Uint8Array | null {
  const mod = emu?.Module;
  if (!mod) return null;
  const heap =
    mod.HEAPU8 ??
    (mod.HEAP8 ? new Uint8Array(mod.HEAP8.buffer) : null) ??
    (mod.wasmMemory ? new Uint8Array(mod.wasmMemory.buffer) : null);
  if (!heap) return null;
  let ptr = 0;
  let size = 0;
  try {
    const api = wasmApiFor(emu);
    if (api?.retroGetMemoryData && api.retroGetMemorySize) {
      ptr = api.retroGetMemoryData(RETRO_MEMORY_SYSTEM_RAM) as number;
      size = api.retroGetMemorySize(RETRO_MEMORY_SYSTEM_RAM) ?? 0;
    } else if (mod.cwrap) {
      const getData = mod.cwrap("retro_get_memory_data", "number", ["number"]);
      const getSize = mod.cwrap("retro_get_memory_size", "number", ["number"]);
      ptr = getData(RETRO_MEMORY_SYSTEM_RAM) as number;
      size = getSize(RETRO_MEMORY_SYSTEM_RAM) as number;
    }
  } catch {
    return null;
  }
  if (!ptr || size < 65536) return null;
  return heap.subarray(ptr, ptr + Math.min(size, 65536));
}

export function readC64Byte(emu: RamEmu | null, addr: number): number | null {
  const api = wasmApiFor(emu);
  if (typeof api?.c64Read === "function" && addr >= 0 && addr < 65536) {
    return api.c64Read(addr) & 0xff;
  }
  const ram = c64RamView(emu);
  if (!ram || addr < 0 || addr >= 65536) return null;
  return ram[addr] ?? null;
}

export function writeC64Byte(emu: RamEmu | null, addr: number, value: number): boolean {
  const api = wasmApiFor(emu);
  if (typeof api?.c64Write === "function" && addr >= 0 && addr < 65536) {
    api.c64Write(addr, value & 0xff);
    return true;
  }
  const ram = c64RamView(emu);
  if (!ram || addr < 0 || addr >= 65536) return false;
  ram[addr] = value & 0xff;
  return true;
}

export function readC64Bytes(emu: RamEmu | null, addr: number, len: number): Uint8Array | null {
  const ram = c64RamView(emu);
  if (!ram || addr < 0 || len <= 0 || addr + len > 65536) return null;
  return ram.subarray(addr, addr + len);
}

export function writeC64Bytes(emu: RamEmu | null, addr: number, data: Uint8Array): boolean {
  const ram = c64RamView(emu);
  if (!ram || addr < 0 || addr + data.length > 65536) return false;
  ram.set(data, addr);
  return true;
}
