/** D64 geometry + error-info tail helpers shared by QA scripts. */

export const D64_SPT = [...Array(17).fill(21), ...Array(7).fill(19), ...Array(6).fill(18), ...Array(5).fill(17), ...Array(5).fill(17)];

export const D64_LAYOUTS = [
  { bytes: 174848, tracks: 35, errorInfo: false },
  { bytes: 175531, tracks: 35, errorInfo: true },
  { bytes: 196608, tracks: 40, errorInfo: false },
  { bytes: 197376, tracks: 40, errorInfo: true },
];

export function d64SectorIndex(track, sector) {
  let idx = 0;
  for (let t = 1; t < track; t++) idx += D64_SPT[t - 1];
  return idx + sector;
}

export function d64Layout(bytes) {
  return D64_LAYOUTS.find((l) => l.bytes === bytes) ?? null;
}

export function d64ErrorInfoSummary(buf) {
  const layout = d64Layout(buf.byteLength);
  if (!layout?.errorInfo) return { errorInfo: false };
  const blocks = (layout.bytes / 257) | 0;
  const tail = buf.subarray(blocks * 256);
  const histogram = {};
  for (const b of tail) histogram[b] = (histogram[b] ?? 0) + 1;
  const track18 = [];
  for (let s = 0; s < 19; s++) track18.push(tail[d64SectorIndex(18, s)]);
  const bad = [];
  for (let t = 1; t <= layout.tracks; t++) {
    for (let s = 0; s < D64_SPT[t - 1]; s++) {
      const c = tail[d64SectorIndex(t, s)];
      if (c !== 0 && c !== 1) bad.push([t, s, c]);
    }
  }
  return {
    errorInfo: true,
    blocks,
    histogram,
    track18: track18.map((c) => c.toString(16)).join(""),
    badCount: bad.length,
    bad: bad.slice(0, 64),
  };
}

const D64_FILE_TYPES = ["DEL", "SEQ", "PRG", "USR", "REL"];

/** What a 1541 lists for LOAD"$": BAM free blocks and every non-scratched entry of the 18/1 chain. */
export function d64Directory(buf) {
  const sector = (t, s) => buf.subarray(d64SectorIndex(t, s) * 256, d64SectorIndex(t, s) * 256 + 256);
  const bam = sector(18, 0);
  let free = 0;
  for (let t = 1; t <= 35; t++) if (t !== 18) free += bam[4 * t];
  const entries = [];
  const seen = new Set();
  for (let t = 18, s = 1; t >= 1 && t <= 35 && s < D64_SPT[t - 1] && !seen.has(`${t}/${s}`); ) {
    seen.add(`${t}/${s}`);
    const b = sector(t, s);
    for (let e = 0; e < 8; e++) {
      const en = b.subarray(e * 32, e * 32 + 32);
      if (!en[2]) continue;
      entries.push({ blocks: en[30] | (en[31] << 8), type: D64_FILE_TYPES[en[2] & 7] ?? "???" });
    }
    [t, s] = [b[0], b[1]];
    if (!t) break;
  }
  return { free, entries };
}
