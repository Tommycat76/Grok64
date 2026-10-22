/** C64 system RAM via libretro RETRO_MEMORY_SYSTEM_RAM (64 KiB). */

export type RamEmu = {
  Module?: {
    HEAPU8?: Uint8Array;
    HEAP8?: Int8Array;
    wasmMemory?: WebAssembly.Memory;
    _retro_get_memory_data?: (n: number) => number;
    _retro_get_memory_size?: (n: number) => number;
    cwrap?: (name: string, ret: string | null, args: string[]) => (...a: unknown[]) => unknown;
  };
};

const RETRO_MEMORY_SYSTEM_RAM = 2;

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
    if (typeof mod._retro_get_memory_data === "function") {
      ptr = mod._retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM) as number;
      size = (mod._retro_get_memory_size as (n: number) => number)?.(RETRO_MEMORY_SYSTEM_RAM) ?? 0;
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
  const mod = emu?.Module as { _grok64_c64_read?: (a: number) => number } | undefined;
  if (typeof mod?._grok64_c64_read === "function" && addr >= 0 && addr < 65536) {
    return mod._grok64_c64_read(addr) & 0xff;
  }
  const ram = c64RamView(emu);
  if (!ram || addr < 0 || addr >= 65536) return null;
  return ram[addr] ?? null;
}

export function writeC64Byte(emu: RamEmu | null, addr: number, value: number): boolean {
  const mod = emu?.Module as { _grok64_c64_write?: (a: number, v: number) => void } | undefined;
  if (typeof mod?._grok64_c64_write === "function" && addr >= 0 && addr < 65536) {
    mod._grok64_c64_write(addr, value & 0xff);
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
