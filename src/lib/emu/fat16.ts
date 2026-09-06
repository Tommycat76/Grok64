/** MBR + FAT16 so the virtual card is a real SD image a hardware sd2iec can read. */

const SEC = 512;
const SPC = 4;
const RES = 1;
const NFAT = 2;
const ROOT_ENT = 512;
const ROOT_SECS = (ROOT_ENT * 32) / SEC;

function u16(b: Uint8Array, o: number, v: number) {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
}
function u32(b: Uint8Array, o: number, v: number) {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
  b[o + 2] = (v >> 16) & 0xff;
  b[o + 3] = (v >> 24) & 0xff;
}
function ru16(b: Uint8Array, o: number) {
  return b[o]! | (b[o + 1]! << 8);
}
function ru32(b: Uint8Array, o: number) {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

export function name83(name: string): Uint8Array {
  const base = name.replace(/\\/g, "/").split("/").pop() || "FILE";
  const dot = base.lastIndexOf(".");
  const raw = (dot >= 0 ? base.slice(0, dot) : base).toUpperCase().replace(/[^A-Z0-9_!#\$%&'\(\)\-\@\^`\{\}~]/g, "");
  const ext = (dot >= 0 ? base.slice(dot + 1) : "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const out = new Uint8Array(11).fill(0x20);
  for (let i = 0; i < Math.min(8, raw.length); i++) out[i] = raw.charCodeAt(i);
  for (let i = 0; i < Math.min(3, ext.length); i++) out[8 + i] = ext.charCodeAt(i);
  return out;
}

export function toP00(cbmName: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(26 + payload.byteLength);
  const tag = "C64File";
  for (let i = 0; i < tag.length; i++) out[i] = tag.charCodeAt(i);
  const n = cbmName.toUpperCase().slice(0, 16);
  for (let i = 0; i < 16; i++) out[8 + i] = i < n.length ? n.charCodeAt(i) : 0xa0;
  out.set(payload, 26);
  return out;
}

export function fromP00(data: Uint8Array): { name: string; data: Uint8Array } | null {
  if (data.byteLength < 26) return null;
  const tag = String.fromCharCode(...data.subarray(0, 7));
  if (tag !== "C64File") return null;
  let name = "";
  for (let i = 0; i < 16; i++) {
    const c = data[8 + i]!;
    if (c === 0 || c === 0xa0) break;
    name += String.fromCharCode(c);
  }
  return { name: name || "FILE", data: data.subarray(26) };
}

function fatSectors(clusters: number) {
  return Math.ceil(((clusters + 2) * 2) / SEC);
}

function layout(totalSecs: number) {
  let fat = 32;
  for (let i = 0; i < 6; i++) {
    const dataSecs = totalSecs - RES - NFAT * fat - ROOT_SECS;
    const clusters = Math.max(1, Math.floor(dataSecs / SPC));
    const need = fatSectors(clusters);
    if (need === fat) return { fat, clusters };
    fat = need;
  }
  return { fat, clusters: 1 };
}

export interface FatFile {
  name: string;
  data: Uint8Array;
}

export function buildFat16(files: FatFile[], sizeBytes: number, label = "SD2IEC"): Uint8Array {
  const totalSecs = Math.max(4096, Math.ceil(sizeBytes / SEC));
  const { fat, clusters } = layout(totalSecs);
  const img = new Uint8Array(totalSecs * SEC);
  const b = img.subarray(0, SEC);
  b[0] = 0xeb;
  b[1] = 0x3c;
  b[2] = 0x90;
  const oem = "SD2IEC  ";
  for (let i = 0; i < 8; i++) b[3 + i] = oem.charCodeAt(i);
  u16(b, 11, SEC);
  b[13] = SPC;
  u16(b, 14, RES);
  b[16] = NFAT;
  u16(b, 17, ROOT_ENT);
  if (totalSecs < 65535) u16(b, 19, totalSecs);
  else u32(b, 32, totalSecs);
  b[21] = 0xf8;
  u16(b, 22, fat);
  u16(b, 24, 32);
  u16(b, 26, 2);
  b[36] = 0x80;
  b[38] = 0x29;
  u32(b, 39, 0x47363453);
  const lab = (label.toUpperCase() + "           ").slice(0, 11);
  for (let i = 0; i < 11; i++) b[43 + i] = lab.charCodeAt(i);
  const fs = "FAT16   ";
  for (let i = 0; i < 8; i++) b[54 + i] = fs.charCodeAt(i);
  b[510] = 0x55;
  b[511] = 0xaa;

  const fatOff = RES * SEC;
  const fatA = img.subarray(fatOff, fatOff + fat * SEC);
  const fatB = img.subarray(fatOff + fat * SEC, fatOff + 2 * fat * SEC);
  fatA[0] = 0xf8;
  fatA[1] = 0xff;
  fatA[2] = 0xff;
  fatA[3] = 0xff;
  const rootOff = fatOff + NFAT * fat * SEC;
  const dataOff = rootOff + ROOT_SECS * SEC;
  const clustBytes = SPC * SEC;
  let cluster = 2;
  let dir = 1;
  {
    const e = img.subarray(rootOff, rootOff + 32);
    for (let i = 0; i < 11; i++) e[i] = lab.charCodeAt(i);
    e[11] = 0x08;
  }
  const putDir = (nm: Uint8Array, first: number, size: number) => {
    if (dir >= ROOT_ENT) return;
    const e = img.subarray(rootOff + dir * 32, rootOff + (dir + 1) * 32);
    e.set(nm, 0);
    e[11] = 0x20;
    u16(e, 26, first);
    u32(e, 28, size);
    dir += 1;
  };
  for (const f of files) {
    const payload = f.data;
    const need = Math.max(1, Math.ceil(payload.byteLength / clustBytes) || 1);
    if (cluster + need >= clusters + 2) break;
    const first = cluster;
    let left = payload.byteLength;
    let src = 0;
    for (let i = 0; i < need; i++) {
      const n = Math.min(clustBytes, left);
      const off = dataOff + (cluster - 2) * clustBytes;
      img.set(payload.subarray(src, src + n), off);
      u16(fatA, cluster * 2, i === need - 1 ? 0xffff : cluster + 1);
      left -= n;
      src += n;
      cluster += 1;
    }
    putDir(name83(f.name), first, payload.byteLength);
  }
  fatB.set(fatA);
  return img;
}

export function parseFat16(img: Uint8Array): FatFile[] {
  if (img.byteLength < SEC * 4) return [];
  const bps = ru16(img, 11) || SEC;
  const spc = img[13] || SPC;
  const res = ru16(img, 14) || RES;
  const nfat = img[16] || NFAT;
  const rootEnt = ru16(img, 17) || ROOT_ENT;
  const fatSz = ru16(img, 22);
  const rootOff = (res + nfat * fatSz) * bps;
  const rootSecs = Math.ceil((rootEnt * 32) / bps);
  const dataOff = rootOff + rootSecs * bps;
  const clustBytes = spc * bps;
  const files: FatFile[] = [];
  for (let i = 0; i < rootEnt; i++) {
    const e = img.subarray(rootOff + i * 32, rootOff + (i + 1) * 32);
    if (e[0] === 0) break;
    if (e[0] === 0xe5 || e[11] === 0x0f || (e[11]! & 0x08) || (e[11]! & 0x10)) continue;
    const name = String.fromCharCode(...e.subarray(0, 8)).trim();
    const ext = String.fromCharCode(...e.subarray(8, 11)).trim();
    const fname = ext ? `${name}.${ext}` : name;
    const first = ru16(e, 26);
    const size = ru32(e, 28);
    if (!first || !size) continue;
    const out = new Uint8Array(size);
    let cl = first;
    let dst = 0;
    let guard = 0;
    while (cl >= 2 && cl < 0xfff8 && dst < size && guard++ < 4096) {
      const off = dataOff + (cl - 2) * clustBytes;
      const n = Math.min(clustBytes, size - dst);
      if (off + n > img.byteLength) break;
      out.set(img.subarray(off, off + n), dst);
      dst += n;
      cl = ru16(img, res * bps + cl * 2);
    }
    files.push({ name: fname, data: out.subarray(0, dst) });
  }
  return files;
}

export function buildMbrDisk(parts: { label: string; files: FatFile[]; size: number }[]): Uint8Array {
  const aligned = parts.map((p) => ({ ...p, size: Math.max(8 * 1024 * 1024, p.size) }));
  const bodies = aligned.map((p) => buildFat16(p.files, p.size, p.label));
  const partSecs = bodies.map((b) => Math.ceil(b.byteLength / SEC));
  let lba = 1;
  const starts: number[] = [];
  for (const s of partSecs) {
    starts.push(lba);
    lba += s;
  }
  const img = new Uint8Array(lba * SEC);
  const mbr = img.subarray(0, SEC);
  mbr[510] = 0x55;
  mbr[511] = 0xaa;
  aligned.forEach((_, i) => {
    const e = 446 + i * 16;
    mbr[e] = i === 0 ? 0x80 : 0x00;
    mbr[e + 4] = 0x06;
    u32(mbr, e + 8, starts[i]!);
    u32(mbr, e + 12, partSecs[i]!);
    img.set(bodies[i]!, starts[i]! * SEC);
  });
  return img;
}

export function parseMbrDisk(img: Uint8Array): { label: string; files: FatFile[] }[] {
  if (img.byteLength < SEC || img[510] !== 0x55) {
    return [{ label: "PART0", files: parseFat16(img) }];
  }
  const out: { label: string; files: FatFile[] }[] = [];
  for (let i = 0; i < 4; i++) {
    const e = 446 + i * 16;
    const type = img[e + 4];
    const start = ru32(img, e + 8);
    const secs = ru32(img, e + 12);
    if (!type || !secs) continue;
    const slice = img.subarray(start * SEC, Math.min(img.byteLength, (start + secs) * SEC));
    out.push({ label: `PART${i}`, files: parseFat16(slice) });
  }
  return out.length ? out : [{ label: "PART0", files: parseFat16(img) }];
}
