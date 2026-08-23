const D64 = 174848;
const BAM: number[] = [
  0,
  ...Array(17).fill(21),
  ...Array(7).fill(19),
  ...Array(6).fill(18),
  ...Array(5).fill(17),
];

function offset(track: number, sector = 0) {
  let t = 0;
  for (let n = 1; n < track; n++) t += BAM[n] ?? 0;
  return t + sector;
}

function petscii16(name: string) {
  const t = new Uint8Array(16).fill(160);
  const n = name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_/]+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 16);
  for (let i = 0; i < n.length; i++) {
    const c = n.charCodeAt(i);
    t[i] = c >= 32 && c < 96 ? c : 32;
  }
  return t;
}

export function makeBlankDisk(title = "GROK64") {
  const t = new Uint8Array(D64);
  const bamOff = offset(18, 0) * 256;
  const r = t.subarray(bamOff, bamOff + 256);
  r[0] = 18;
  r[1] = 1;
  r[2] = 65;
  for (let e = 1; e <= 35; e++) {
    const sectors = BAM[e] ?? 0;
    r[4 * e] = sectors;
    const bits = (1 << sectors) - 1;
    r[4 * e + 1] = bits & 255;
    r[4 * e + 2] = (bits >> 8) & 255;
    r[4 * e + 3] = (bits >> 16) & 255;
  }
  const alloc = (track: number, sector: number) => {
    r[4 * track] = (r[4 * track]! - 1) & 255;
    r[4 * track + 1 + Math.floor(sector / 8)]! &= ~(1 << (sector % 8)) & 255;
  };
  alloc(18, 0);
  alloc(18, 1);
  r.set(petscii16(title), 144);
  r[160] = 160;
  r[161] = 160;
  r[162] = 71;
  r[163] = 54;
  r[164] = 160;
  r[165] = 50;
  r[166] = 65;
  r[167] = 160;
  r[168] = 160;
  r[169] = 160;
  r[170] = 160;
  const dir = offset(18, 1) * 256;
  t[dir] = 0;
  t[dir + 1] = 255;
  return t;
}

function free(bam: Uint8Array, track: number, sector: number) {
  return !!(bam[4 * track + 1 + Math.floor(sector / 8)]! & (1 << (sector % 8)));
}
function take(bam: Uint8Array, track: number, sector: number) {
  bam[4 * track] = (bam[4 * track]! - 1) & 255;
  bam[4 * track + 1 + Math.floor(sector / 8)]! &= ~(1 << (sector % 8)) & 255;
}
function range(a: number, b: number) {
  const n: number[] = [];
  if (a <= b) for (let r = a; r <= b; r++) n.push(r);
  else for (let r = a; r >= b; r--) n.push(r);
  return n;
}
function nextFree(bam: Uint8Array): [number, number] {
  for (const t of [...range(17, 1), ...range(19, 35)]) {
    const n = BAM[t] ?? 0;
    for (let s = 0; s < n; s++) if (free(bam, t, s)) return (take(bam, t, s), [t, s]);
  }
  throw new Error("Disk full");
}

/** Wrap a PRG as a single-file D64 so VICE can autostart it from a disk. */
export function prgToD64(prg: Uint8Array, title = "PROGRAM") {
  if (prg.byteLength < 2) throw new Error("Program is empty");
  const disk = makeBlankDisk(title);
  const bamOff = offset(18, 0) * 256;
  const bam = disk.subarray(bamOff, bamOff + 256);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < prg.length; i += 254) chunks.push(prg.subarray(i, i + 254));
  if (!chunks.length) chunks.push(new Uint8Array());
  const loc = chunks.map(() => nextFree(bam));
  for (let i = 0; i < chunks.length; i++) {
    const [tr, se] = loc[i]!;
    const chunk = chunks[i]!;
    const sec = new Uint8Array(256);
    if (i + 1 < loc.length) {
      sec[0] = loc[i + 1]![0];
      sec[1] = loc[i + 1]![1];
    } else {
      sec[0] = 0;
      sec[1] = chunk.length + 1;
    }
    sec.set(chunk, 2);
    disk.set(sec, offset(tr, se) * 256);
  }
  const dir = offset(18, 1) * 256;
  const d = disk.subarray(dir, dir + 256);
  d[0] = 0;
  d[1] = 255;
  d[2] = 130;
  d[3] = loc[0]![0];
  d[4] = loc[0]![1];
  d.set(petscii16(title), 5);
  d[30] = chunks.length & 255;
  d[31] = (chunks.length >> 8) & 255;
  return disk;
}

export function unwrapP00(e: Uint8Array) {
  if (e.byteLength < 28 || String.fromCharCode(...e.subarray(0, 7)) !== "C64File") return null;
  return e.subarray(26);
}

export function unwrapT64(e: Uint8Array) {
  if (e.byteLength < 96) return null;
  const mag = String.fromCharCode(...e.subarray(0, 20));
  if ((!/C64S? tape image/i.test(mag) && !/C64.+tape/i.test(mag)) || (e[36]! | (e[37]! << 8)) < 1)
    return null;
  const load = e[66]! | (e[67]! << 8);
  const end = e[68]! | (e[69]! << 8);
  const off = e[72]! | (e[73]! << 8) | (e[74]! << 16) | (e[75]! << 24);
  let len = end > load ? end - load : 0;
  if (off <= 0 || off >= e.byteLength) return null;
  if (!len || off + len > e.byteLength) len = e.byteLength - off;
  const payload = e.subarray(off, off + len);
  const prg = new Uint8Array(2 + payload.length);
  prg[0] = load & 255;
  prg[1] = load >> 8;
  prg.set(payload, 2);
  return prg;
}

export function asDiskImage(kind: string, data: Uint8Array, title: string) {
  if (kind === "d64") return data.byteLength < 174848 ? null : data;
  try {
    if (kind === "prg" || kind === "sid") return prgToD64(data, title);
    if (kind === "p00") {
      const p = unwrapP00(data);
      return p ? prgToD64(p, title) : null;
    }
    if (kind === "t64") {
      const p = unwrapT64(data);
      return p ? prgToD64(p, title) : null;
    }
  } catch {
    return null;
  }
  return null;
}
