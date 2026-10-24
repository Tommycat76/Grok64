/** D64 track/sector layout (1541) — shared by attach diagnostics and directory tools. */

const SECTORS = [0, ...Array(17).fill(21), ...Array(7).fill(19), ...Array(6).fill(18), ...Array(5).fill(17)];

function trackOffset(track: number): number {
  let off = 0;
  for (let t = 1; t < track; t++) off += SECTORS[t] ?? 0;
  return off;
}

function lba(track: number, sector: number): number {
  return trackOffset(track) + sector;
}

/** Byte offset of directory track 18, sector 1 (first dir entry sector). */
export function lbaDirectorySector1Offset(): number {
  return lba(18, 1) * 256;
}
