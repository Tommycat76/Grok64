/**
 * Minimal 1581 D81 packer for SD2IEC → real VICE drive (larger than 1541 D64).
 * Geometry: 80 tracks × 10 sectors × 256 bytes = 819200 bytes.
 */
const D81_SIZE = 819200;
const TRACKS = 80;
const SPT = 10;
const BAM_TRACK = 40;
const BAM_SECTOR = 0;
const DIR_TRACK = 40;
const DIR_SECTOR = 1;

function lba(track: number, sector: number): number {
  return ((track - 1) * SPT + sector) * 256;
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

function emptyD81(diskName = "SD2IEC"): Uint8Array {
  const image = new Uint8Array(D81_SIZE);
  const bamOff = lba(BAM_TRACK, BAM_SECTOR);
  const bam = image.subarray(bamOff, bamOff + 256);
  bam[0] = DIR_TRACK;
  bam[1] = DIR_SECTOR;
  bam[2] = 0x44; // 'D' 1581
  for (let t = 1; t <= TRACKS; t++) {
    const n = SPT;
    bam[6 + t] = n;
    for (let s = 0; s < n; s++) {
      if (t === BAM_TRACK && s === BAM_SECTOR) continue;
      const bit = s;
      const byte = 6 + TRACKS + (t - 1) * 2 + Math.floor(bit / 8);
      if (byte < 256) bam[byte] |= 1 << (bit % 8);
    }
  }
  const take = (track: number, sector: number) => {
    bam[6 + track] = (bam[6 + track]! - 1) & 0xff;
    const bit = sector;
    const byte = 6 + TRACKS + (track - 1) * 2 + Math.floor(bit / 8);
    if (byte < 256) bam[byte] &= ~(1 << (bit % 8)) & 0xff;
  };
  take(BAM_TRACK, BAM_SECTOR);
  take(DIR_TRACK, DIR_SECTOR);
  bam.set(petName(diskName), 0x90);
  const dirOff = lba(DIR_TRACK, DIR_SECTOR);
  image[dirOff] = 0;
  image[dirOff + 1] = 255;
  return image;
}

function isFree(bam: Uint8Array, track: number, sector: number): boolean {
  if (track === BAM_TRACK && sector === BAM_SECTOR) return false;
  const bit = sector;
  const byte = 6 + TRACKS + (track - 1) * 2 + Math.floor(bit / 8);
  if (byte >= 256) return false;
  return Boolean(bam[byte]! & (1 << (bit % 8)));
}

function take(bam: Uint8Array, track: number, sector: number) {
  bam[6 + track] = (bam[6 + track]! - 1) & 0xff;
  const bit = sector;
  const byte = 6 + TRACKS + (track - 1) * 2 + Math.floor(bit / 8);
  if (byte < 256) bam[byte] &= ~(1 << (bit % 8)) & 0xff;
}

function grab(bam: Uint8Array): [number, number] {
  for (let t = 1; t <= TRACKS; t++) {
    for (let s = 0; s < SPT; s++) {
      if (isFree(bam, t, s)) {
        take(bam, t, s);
        return [t, s];
      }
    }
  }
  throw new Error("Disk full");
}

function appendPrg(image: Uint8Array, prg: Uint8Array, fileName: string): void {
  if (prg.byteLength < 2) return;
  const bamOff = lba(BAM_TRACK, BAM_SECTOR);
  const bam = image.subarray(bamOff, bamOff + 256);
  let dirTrack = DIR_TRACK;
  let dirSector = DIR_SECTOR;
  let dirOff = lba(dirTrack, dirSector);
  let slot = 0;
  while (slot < 8 && image[dirOff + slot * 32 + 2] !== 0) slot += 1;
  if (slot >= 8) throw new Error("Disk directory full");
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
    image.set(sec, lba(t, s));
  }
  const dir = image.subarray(dirOff + slot * 32, dirOff + slot * 32 + 32);
  dir[0] = 0;
  dir[1] = 255;
  dir[2] = 0x82;
  dir[3] = chain[0]![0];
  dir[4] = chain[0]![1];
  dir.set(petName(fileName), 5);
  dir[30] = chunks.length & 0xff;
  dir[31] = (chunks.length >> 8) & 0xff;
}

export function estimatePrgBlocks(prg: Uint8Array): number {
  if (prg.byteLength < 2) return 0;
  return Math.max(1, Math.ceil(prg.byteLength / 254));
}

export function packPrgsToD81(files: { name: string; data: Uint8Array }[], diskName = "SD2IEC"): Uint8Array {
  const image = emptyD81(diskName);
  for (const f of files) {
    let raw = f.data;
    if (raw.byteLength >= 28 && String.fromCharCode(...raw.subarray(0, 7)) === "C64File") {
      raw = raw.subarray(26);
    }
    if (raw.byteLength < 2) continue;
    const base = f.name.replace(/\\/g, "/").split("/").pop() || "FILE";
    appendPrg(image, raw, base.replace(/\.(prg|p00)$/i, "") || "FILE");
  }
  return image;
}

export const D81_BYTE_SIZE = D81_SIZE;
