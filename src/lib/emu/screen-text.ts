/** Read C64 screen RAM as plain text (40×25, PETSCII screen codes). */

const ROW = [
  0x0400, 0x0428, 0x0450, 0x0478, 0x04a0, 0x04c8, 0x04f0, 0x0518, 0x0550, 0x0578, 0x05a0, 0x05c8, 0x05f0, 0x0618,
  0x0640, 0x0668, 0x0690, 0x06b8, 0x06e0, 0x0708, 0x0730, 0x0758, 0x0780, 0x07a8, 0x07d0,
];

function petToChar(code: number): string {
  const c = code & 0xff;
  if (c >= 1 && c <= 26) return String.fromCharCode(64 + c);
  if (c >= 27 && c <= 32) return " !\"#$%&";
  if (c >= 33 && c <= 58) return String.fromCharCode(91 + c - 33);
  if (c >= 97 && c <= 122) return String.fromCharCode(c - 32);
  if (c === 160) return " ";
  if (c >= 48 && c <= 57) return String.fromCharCode(c);
  return " ";
}

type RamEmu = {
  Module?: {
    HEAPU8?: Uint8Array;
    HEAP8?: Int8Array;
    wasmMemory?: WebAssembly.Memory;
    _retro_get_memory_data?: (n: number) => number;
    _retro_get_memory_size?: (n: number) => number;
    cwrap?: (n: string, r: string | null, a: string[]) => (...a: unknown[]) => unknown;
  };
};

function c64Ram(emu: RamEmu | null): Uint8Array | null {
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
      ptr = mod._retro_get_memory_data(0) as number;
      size = mod._retro_get_memory_size?.(0) ?? 0;
    } else if (mod.cwrap) {
      const getData = mod.cwrap("retro_get_memory_data", "number", ["number"]);
      const getSize = mod.cwrap("retro_get_memory_size", "number", ["number"]);
      ptr = getData(0) as number;
      size = getSize(0) as number;
    }
  } catch {
    return null;
  }
  if (!ptr || size < 65536) return null;
  return heap.subarray(ptr, ptr + Math.min(size, 65536));
}

export function readScreenText(emu: RamEmu | null): string {
  const ram = c64Ram(emu);
  if (!ram) return "";
  const lines: string[] = [];
  for (let row = 0; row < 25; row++) {
    let line = "";
    const base = ROW[row] ?? 0x0400 + row * 40;
    for (let col = 0; col < 40; col++) {
      const addr = base + col;
      if (addr >= ram.length) line += " ";
      else line += petToChar(ram[addr]);
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.join("\n").trimEnd();
}
