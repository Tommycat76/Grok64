/** Read C64 screen RAM as plain text (40×25, PETSCII screen codes). */

const ROW = [
  0x0400, 0x0428, 0x0450, 0x0478, 0x04a0, 0x04c8, 0x04f0, 0x0518, 0x0550, 0x0578, 0x05a0, 0x05c8, 0x05f0, 0x0618,
  0x0640, 0x0668, 0x0690, 0x06b8, 0x06e0, 0x0708, 0x0730, 0x0758, 0x0780, 0x07a8, 0x07d0,
];

/** PETSCII screencode (0x01–0xFF) → display char for directory / BASIC listings. */
function petToChar(code: number): string {
  const c = code & 0xff;
  if (c === 0) return " ";
  if (c >= 1 && c <= 26) return String.fromCharCode(64 + c);
  if (c >= 27 && c <= 32) return " !\"#$%&"[c - 27] ?? " ";
  if (c >= 33 && c <= 58) return String.fromCharCode(91 + c - 33);
  if (c >= 64 && c <= 95) return String.fromCharCode(c);
  if (c >= 97 && c <= 122) return String.fromCharCode(c - 32);
  if (c === 160 || c === 32) return " ";
  if (c >= 48 && c <= 57) return String.fromCharCode(c);
  if (c >= 193 && c <= 218) return String.fromCharCode(c - 128);
  return c >= 128 ? String.fromCharCode(c - 128) : " ";
}

import { c64RamView, readC64Byte, writeC64Byte, type RamEmu } from "./c64-memory";

function readScreenTextWith(
  read: (addr: number) => number | null,
): string {
  const lines: string[] = [];
  for (let row = 0; row < 25; row++) {
    let line = "";
    const base = ROW[row] ?? 0x0400 + row * 40;
    for (let col = 0; col < 40; col++) {
      const addr = base + col;
      const b = read(addr);
      line += b === null ? " " : petToChar(b);
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.join("\n").trimEnd();
}

function asciiToScreenCode(ch: string): number {
  const n = ch.charCodeAt(0);
  if (n === 32) return 32;
  if (n >= 48 && n <= 57) return n;
  if (n >= 65 && n <= 90) return n;
  if (n >= 97 && n <= 122) return n - 32 + 1;
  if (n === 46) return 46;
  if (n === 44) return 44;
  if (n === 34) return 34;
  if (n === 36) return 36;
  if (n === 60) return 60;
  if (n === 62) return 62;
  return 32;
}

/** Paint plain ASCII lines onto the text screen (for IEC directory listings). */
export function paintScreenLines(emu: RamEmu | null, lines: string[], startRow = 0): void {
  if (!emu) return;
  for (let row = 0; row < lines.length && startRow + row < 25; row++) {
    const base = ROW[startRow + row] ?? 0x0400 + (startRow + row) * 40;
    const line = lines[row].padEnd(40, " ").slice(0, 40);
    for (let col = 0; col < 40; col++) {
      writeC64Byte(emu, base + col, asciiToScreenCode(line[col] ?? " "));
    }
  }
}

export function readScreenText(emu: RamEmu | null): string {
  if (!emu) return "";
  const viaExport = readScreenTextWith((addr) => readC64Byte(emu, addr));
  if (viaExport.replace(/\s/g, "").length > 0) return viaExport;
  const ram = c64RamView(emu);
  if (!ram) return viaExport;
  return readScreenTextWith((addr) => (addr >= 0 && addr < ram.length ? ram[addr] : null));
}
