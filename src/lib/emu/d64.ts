import type { MediaKind } from "./types";

const D64_SIZE = 174848;
const SECTORS = [0, ...Array(17).fill(21), ...Array(7).fill(19), ...Array(6).fill(18), ...Array(5).fill(17)];

function trackOffset(track: number): number {
  let off = 0;
  for (let t = 1; t < track; t++) off += SECTORS[t] ?? 0;
  return off;
}

function lba(track: number, sector: number): number {
  return trackOffset(track) + sector;
}

function petName(name: string): Uint8Array {
  const out = new Uint8Array(16).fill(0xa0);
  const raw = name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_/]+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 16);
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    out[i] = c >= 32 && c < 96 ? c : 0x20;
  }
  return out;
}

function emptyD64(diskName = "GROK64"): Uint8Array {
  const image = new Uint8Array(D64_SIZE);
  const bamOff = lba(18, 0) * 256;
  const bam = image.subarray(bamOff, bamOff + 256);
  bam[0] = 18;
  bam[1] = 1;
  bam[2] = 0x41;
  for (let t = 1; t <= 35; t++) {
    const n = SECTORS[t] ?? 0;
    bam[4 * t] = n;
    const bits = (1 << n) - 1;
    bam[4 * t + 1] = bits & 0xff;
    bam[4 * t + 2] = (bits >> 8) & 0xff;
    bam[4 * t + 3] = (bits >> 16) & 0xff;
  }
  const take = (track: number, sector: number) => {
    bam[4 * track] = (bam[4 * track]! - 1) & 0xff;
    const bit = sector;
    bam[4 * track + 1 + Math.floor(bit / 8)]! &= ~(1 << bit % 8) & 0xff;
  };
  take(18, 0);
  take(18, 1);
  const name = petName(diskName);
  bam.set(name, 0x90);
  bam[0xa0] = 0xa0;
  bam[0xa1] = 0xa0;
  bam[0xa2] = 0x47; // G
  bam[0xa3] = 0x36; // 6
  bam[0xa4] = 0xa0;
  bam[0xa5] = 0x32;
  bam[0xa6] = 0x41;
  bam[0xa7] = 0xa0;
  bam[0xa8] = 0xa0;
  bam[0xa9] = 0xa0;
  bam[0xaa] = 0xa0;
  const dirOff = lba(18, 1) * 256;
  image[dirOff] = 0;
  image[dirOff + 1] = 255;
  return image;
}

function isFree(bam: Uint8Array, track: number, sector: number): boolean {
  return Boolean(bam[4 * track + 1 + Math.floor(sector / 8)]! & (1 << sector % 8));
}

function take(bam: Uint8Array, track: number, sector: number) {
  bam[4 * track] = (bam[4 * track]! - 1) & 0xff;
  bam[4 * track + 1 + Math.floor(sector / 8)]! &= ~(1 << sector % 8) & 0xff;
}

function grab(bam: Uint8Array): [number, number] {
  for (const t of [...range(17, 1), ...range(19, 35)]) {
    const n = SECTORS[t] ?? 0;
    for (let s = 0; s < n; s++) {
      if (isFree(bam, t, s)) {
        take(bam, t, s);
        return [t, s];
      }
    }
  }
  throw new Error("Disk full");
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  if (from <= to) {
    for (let i = from; i <= to; i++) out.push(i);
  } else {
    for (let i = from; i >= to; i--) out.push(i);
  }
  return out;
}

export function prgToD64(prg: Uint8Array, fileName = "PROGRAM"): Uint8Array {
  if (prg.byteLength < 2) throw new Error("Program is empty");
  const image = emptyD64(fileName);
  const bamOff = lba(18, 0) * 256;
  const bam = image.subarray(bamOff, bamOff + 256);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < prg.length; i += 254) chunks.push(prg.subarray(i, i + 254));
  if (!chunks.length) chunks.push(new Uint8Array(0));
  const chain = chunks.map(() => grab(bam));
  for (let i = 0; i < chunks.length; i++) {
    const [t, s] = chain[i]!;
    const chunk = chunks[i]!;
    const sec = new Uint8Array(256);
    if (i + 1 < chain.length) {
      sec[0] = chain[i + 1]![0];
      sec[1] = chain[i + 1]![1];
    } else {
      sec[0] = 0;
      sec[1] = chunk.length + 1;
    }
    sec.set(chunk, 2);
    image.set(sec, lba(t, s) * 256);
  }
  const dirOff = lba(18, 1) * 256;
  const dir = image.subarray(dirOff, dirOff + 256);
  dir[0] = 0;
  dir[1] = 255;
  dir[2] = 0x82;
  dir[3] = chain[0]![0];
  dir[4] = chain[0]![1];
  dir.set(petName(fileName), 5);
  dir[30] = chunks.length & 0xff;
  dir[31] = (chunks.length >> 8) & 0xff;
  return image;
}

export function stripP00(data: Uint8Array): Uint8Array | null {
  if (data.byteLength < 28) return null;
  const mag = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!, data[4]!, data[5]!, data[6]!);
  if (mag !== "C64File") return null;
  return data.subarray(26);
}

export function t64ToPrg(data: Uint8Array): Uint8Array | null {
  if (data.byteLength < 96) return null;
  const sig = String.fromCharCode(...data.subarray(0, 20));
  if (!/C64S? tape image/i.test(sig) && !/C64.+tape/i.test(sig)) return null;
  const used = data[36]! | (data[37]! << 8);
  if (used < 1) return null;
  const entry = 64;
  const load = data[entry + 2]! | (data[entry + 3]! << 8);
  const end = data[entry + 4]! | (data[entry + 5]! << 8);
  const off =
    data[entry + 8]! |
    (data[entry + 9]! << 8) |
    (data[entry + 10]! << 16) |
    (data[entry + 11]! << 24);
  let len = end > load ? end - load : 0;
  if (off <= 0 || off >= data.byteLength) return null;
  if (!len || off + len > data.byteLength) len = data.byteLength - off;
  const payload = data.subarray(off, off + len);
  const prg = new Uint8Array(2 + payload.length);
  prg[0] = load & 0xff;
  prg[1] = load >> 8;
  prg.set(payload, 2);
  return prg;
}

export function canSwapKind(kind: MediaKind): boolean {
  return kind === "d64" || kind === "prg" || kind === "p00" || kind === "sid" || kind === "t64";
}

export interface D64DirEntry {
  name: string;
  type: number;
  prg: boolean;
  blocks: number;
  /** Byte offset of the 32-byte directory slot. */
  slot: number;
}

function petToAscii(raw: Uint8Array): string {
  let s = "";
  for (const b of raw) {
    if (b === 0xa0 || b === 0) break;
    s += String.fromCharCode(b & 0x7f);
  }
  return s.replace(/\s+/g, " ").trim();
}

export function listD64Directory(data: Uint8Array): D64DirEntry[] {
  if (data.byteLength < D64_SIZE) return [];
  const bam = lba(18, 0) * 256;
  let track = data[bam] || 18;
  let sector = data[bam + 1] || 1;
  const out: D64DirEntry[] = [];
  const seen = new Set<string>();
  for (let hops = 0; hops < 18 && track >= 1 && track <= 35; hops++) {
    const key = `${track}:${sector}`;
    if (seen.has(key)) break;
    seen.add(key);
    const off = lba(track, sector) * 256;
    if (off + 256 > data.byteLength) break;
    const nextT = data[off]!;
    const nextS = data[off + 1]!;
    for (let i = 0; i < 8; i++) {
      const slot = off + i * 32;
      const type = data[slot + 2]!;
      if (!type) continue;
      const closed = (type & 0x80) !== 0;
      const name = petToAscii(data.subarray(slot + 5, slot + 21));
      const blocks = data[slot + 30]! | (data[slot + 31]! << 8);
      out.push({
        name,
        type,
        prg: closed && (type & 0x07) === 2,
        blocks,
        slot,
      });
    }
    track = nextT;
    sector = nextS;
    if (!track) break;
  }
  return out;
}

const CRACKTRO_NAME =
  /^(intro|int|crack|note|notes|nfo|info|hello|greetz|docs|readme|loader|\-|\/|\+|\*|!+|\.+)$/i;

export function isCracktroName(name: string): boolean {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n) return true;
  if (CRACKTRO_NAME.test(n)) return true;
  return /cracktro|crack\s*intro|\bintro\b|\bnote\b|\breadme\b/i.test(n);
}

function foldName(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

export function namesFuzzyMatch(fileName: string, title: string): boolean {
  const a = foldName(fileName);
  const b = foldName(title.replace(/\.[a-z0-9]{2,4}$/i, ""));
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
}

export function pickAutostartEntry(entries: D64DirEntry[], title: string): D64DirEntry | null {
  const prgs = entries.filter((e) => e.prg);
  if (!prgs.length) return null;
  const first = prgs[0]!;
  const titled = prgs.find((e) => namesFuzzyMatch(e.name, title) && !isCracktroName(e.name));
  if (titled && isCracktroName(first.name) && titled.slot !== first.slot) return titled;
  return first;
}

export function promoteD64Entry(data: Uint8Array, fromSlot: number, toSlot: number): Uint8Array {
  if (fromSlot === toSlot) return data;
  const out = data.slice();
  const tmp = new Uint8Array(30);
  tmp.set(out.subarray(toSlot + 2, toSlot + 32));
  out.set(out.subarray(fromSlot + 2, fromSlot + 32), toSlot + 2);
  out.set(tmp, fromSlot + 2);
  return out;
}

/** If the first PRG is a cracktro and a later PRG matches the title, make the game LOAD"*" first. */
export function prepareAutostartDisk(data: Uint8Array, filename: string, title?: string): Uint8Array {
  if (data.byteLength < D64_SIZE) return data;
  const hint = title || filename;
  const entries = listD64Directory(data);
  const pick = pickAutostartEntry(entries, hint);
  const first = entries.find((e) => e.prg);
  if (!pick || !first || pick.slot === first.slot) return data;
  if (!isCracktroName(first.name)) return data;
  return promoteD64Entry(data, pick.slot, first.slot);
}

export function wantsCracktroNudge(title: string): boolean {
  return /paradroid/i.test(title);
}

export function wrapForDiskSwap(kind: MediaKind, data: Uint8Array, name: string): Uint8Array | null {
  if (kind === "d64") {
    if (data.byteLength < 174848) return null;
    return data;
  }
  try {
    if (kind === "prg" || kind === "sid") return prgToD64(data, name);
    if (kind === "p00") {
      const prg = stripP00(data);
      return prg ? prgToD64(prg, name) : null;
    }
    if (kind === "t64") {
      const prg = t64ToPrg(data);
      return prg ? prgToD64(prg, name) : null;
    }
  } catch {
    return null;
  }
  return null;
}
