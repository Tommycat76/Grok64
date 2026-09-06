import { openExpansionDb, STORES, txDone } from "./expansion-db";

const SECTOR = 512;
const CLUSTER_BYTES = 4;
const RESERVED_SECTORS = 1;
const FAT_COPIES = 2;
const MAX_ROOT_ENTRIES = 512;
const ROOT_DIR_SECTORS = (MAX_ROOT_ENTRIES * 32) / SECTOR;
const PART_SIZE = 8_388_608;

export interface SdFile {
  id: string;
  name: string;
  size: number;
  data: ArrayBuffer;
  path?: string;
}

export interface SdPartition {
  id: number;
  label: string;
  files: SdFile[];
}

const DEFAULT_PARTS: SdPartition[] = [0, 1, 2, 3].map((id) => ({
  id,
  label: `PART${id}`,
  files: [],
}));

export async function listPartitions(): Promise<SdPartition[]> {
  const db = await openExpansionDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.sdpart, "readonly").objectStore(STORES.sdpart).getAll();
    req.onsuccess = () => {
      const rows = (req.result as SdPartition[]) ?? [];
      const map = new Map(rows.map((p) => [p.id, p]));
      resolve(DEFAULT_PARTS.map((p) => map.get(p.id) ?? p));
    };
    req.onerror = () => reject(req.error);
  });
}

async function savePartition(part: SdPartition): Promise<void> {
  const db = await openExpansionDb();
  const tx = db.transaction(STORES.sdpart, "readwrite");
  tx.objectStore(STORES.sdpart).put(part);
  await txDone(tx);
}

export async function addSdFile(partId: number, name: string, data: ArrayBuffer, path = ""): Promise<void> {
  const part = (await listPartitions()).find((p) => p.id === partId) ?? { id: partId, label: `PART${partId}`, files: [] };
  part.files = [
    ...part.files,
    { id: crypto.randomUUID(), name, size: data.byteLength, data, path },
  ];
  await savePartition(part);
}

export async function removeSdFile(partId: number, fileId: string): Promise<void> {
  const part = (await listPartitions()).find((p) => p.id === partId);
  if (!part) return;
  part.files = part.files.filter((f) => f.id !== fileId);
  await savePartition(part);
}

export async function formatPartition(partId: number): Promise<void> {
  await savePartition({ id: partId, label: `PART${partId}`, files: [] });
}

export function petsciiName(path: string): string {
  const base = (path.split(/[/\\]/).pop() || path)
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9._+-]/g, "")
    .toUpperCase()
    .slice(0, 16);
  return base || "FILE";
}

function put16(buf: Uint8Array, off: number, v: number) {
  buf[off] = v & 255;
  buf[off + 1] = (v >> 8) & 255;
}

function put32(buf: Uint8Array, off: number, v: number) {
  buf[off] = v & 255;
  buf[off + 1] = (v >> 8) & 255;
  buf[off + 2] = (v >> 16) & 255;
  buf[off + 3] = (v >> 24) & 255;
}

function get16(buf: Uint8Array, off: number) {
  return buf[off] | (buf[off + 1] << 8);
}

function get32(buf: Uint8Array, off: number) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

function dosName(name: string): Uint8Array {
  const base = (name.replace(/\\/g, "/").split("/").pop() || "FILE").toUpperCase();
  const dot = base.lastIndexOf(".");
  const stem = (dot >= 0 ? base.slice(0, dot) : base).replace(/[^A-Z0-9_!#$%&'()\-@^`{}~]/g, "");
  const ext = (dot >= 0 ? base.slice(dot + 1) : "").replace(/[^A-Z0-9]/g, "");
  const out = new Uint8Array(11).fill(32);
  for (let i = 0; i < Math.min(8, stem.length); i++) out[i] = stem.charCodeAt(i);
  for (let i = 0; i < Math.min(3, ext.length); i++) out[8 + i] = ext.charCodeAt(i);
  return out;
}

function wrapP00(name: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(26 + data.byteLength);
  for (let i = 0; i < 7; i++) out[i] = "C64File".charCodeAt(i);
  const label = name.toUpperCase().slice(0, 16);
  for (let i = 0; i < 16; i++) out[8 + i] = i < label.length ? label.charCodeAt(i) : 160;
  out.set(data, 26);
  return out;
}

function unwrapP00(data: Uint8Array): { name: string; data: Uint8Array } | null {
  if (data.byteLength < 26 || String.fromCharCode(...data.subarray(0, 7)) !== "C64File") return null;
  let name = "";
  for (let i = 0; i < 16; i++) {
    const c = data[8 + i];
    if (c === 0 || c === 160) break;
    name += String.fromCharCode(c);
  }
  return { name: name || "FILE", data: data.subarray(26) };
}

function fatSectors(clusters: number): number {
  return Math.ceil((clusters + 2) * 2 / SECTOR);
}

function layout(totalSectors: number) {
  let fat = 32;
  for (let n = 0; n < 6; n++) {
    const dataSectors = totalSectors - RESERVED_SECTORS - FAT_COPIES * fat - ROOT_DIR_SECTORS;
    const clusters = Math.max(1, Math.floor(dataSectors / CLUSTER_BYTES));
    const need = fatSectors(clusters);
    if (need === fat) return { fat, clusters };
    fat = need;
  }
  return { fat: fat, clusters: 1 };
}

function buildFatPartition(
  files: { name: string; data: Uint8Array }[],
  sizeBytes: number,
  label = "SD2IEC",
): Uint8Array {
  const totalSectors = Math.max(4096, Math.ceil(sizeBytes / SECTOR));
  const { fat: fatSectorsCount, clusters: maxClusters } = layout(totalSectors);
  const image = new Uint8Array(totalSectors * SECTOR);
  const boot = image.subarray(0, SECTOR);
  boot[0] = 235;
  boot[1] = 60;
  boot[2] = 144;
  for (let i = 0; i < 8; i++) boot[3 + i] = "SD2IEC  ".charCodeAt(i);
  put16(boot, 11, SECTOR);
  boot[13] = CLUSTER_BYTES;
  put16(boot, 14, RESERVED_SECTORS);
  boot[16] = FAT_COPIES;
  put16(boot, 17, MAX_ROOT_ENTRIES);
  if (totalSectors < 65535) put16(boot, 19, totalSectors);
  else put32(boot, 32, totalSectors);
  boot[21] = 248;
  put16(boot, 22, fatSectorsCount);
  put16(boot, 24, 32);
  boot[26] = 2;
  boot[36] = 128;
  boot[38] = 41;
  put32(boot, 39, 1194734675);
  const vol = (label.toUpperCase() + "           ").slice(0, 11);
  for (let i = 0; i < 11; i++) boot[43 + i] = vol.charCodeAt(i);
  for (let i = 0; i < 8; i++) boot[54 + i] = "FAT16   ".charCodeAt(i);
  boot[510] = 85;
  boot[511] = 170;

  const fatStart = RESERVED_SECTORS * SECTOR;
  const fat1 = image.subarray(fatStart, fatStart + fatSectorsCount * SECTOR);
  const fat2 = image.subarray(fatStart + fatSectorsCount * SECTOR, fatStart + 2 * fatSectorsCount * SECTOR);
  fat1[0] = 248;
  fat1[1] = 255;
  fat1[2] = 255;
  fat1[3] = 255;

  const rootStart = fatStart + FAT_COPIES * fatSectorsCount * SECTOR;
  const dataStart = rootStart + ROOT_DIR_SECTORS * SECTOR;
  const clusterSize = CLUSTER_BYTES * SECTOR;
  let nextCluster = 2;
  let rootSlot = 1;

  {
    const entry = image.subarray(rootStart, rootStart + 32);
    for (let i = 0; i < 11; i++) entry[i] = vol.charCodeAt(i);
    entry[11] = 8;
  }

  const addDir = (dos: Uint8Array, firstCluster: number, size: number) => {
    if (rootSlot >= MAX_ROOT_ENTRIES) return;
    const entry = image.subarray(rootStart + rootSlot * 32, rootStart + (rootSlot + 1) * 32);
    entry.set(dos, 0);
    entry[11] = 32;
    put16(entry, 26, firstCluster);
    put32(entry, 28, size);
    rootSlot += 1;
  };

  for (const file of files) {
    const data = file.data;
    const needClusters = Math.max(1, Math.ceil(data.byteLength / clusterSize) || 1);
    if (nextCluster + needClusters >= maxClusters + 2) break;
    const first = nextCluster;
    let remain = data.byteLength;
    let offset = 0;
    for (let c = 0; c < needClusters; c++) {
      const chunk = Math.min(clusterSize, remain);
      const addr = dataStart + (nextCluster - 2) * clusterSize;
      image.set(data.subarray(offset, offset + chunk), addr);
      put16(fat1, nextCluster * 2, c === needClusters - 1 ? 65535 : nextCluster + 1);
      remain -= chunk;
      offset += chunk;
      nextCluster += 1;
    }
    addDir(dosName(file.name), first, data.byteLength);
  }

  fat2.set(fat1);
  return image;
}

function readFatFiles(image: Uint8Array): { name: string; data: Uint8Array }[] {
  if (image.byteLength < SECTOR * 4) return [];
  const sectorSize = get16(image, 11) || SECTOR;
  const clusterSize = (image[13] || CLUSTER_BYTES) * sectorSize;
  const reserved = get16(image, 14) || RESERVED_SECTORS;
  const fatCopies = image[16] || FAT_COPIES;
  const rootEntries = get16(image, 17) || MAX_ROOT_ENTRIES;
  const fatStart = reserved * sectorSize;
  const rootStart = fatStart + Math.ceil((rootEntries * 32) / sectorSize) * sectorSize;
  const dataStart = rootStart + Math.ceil((rootEntries * 32) / sectorSize) * sectorSize;
  const out: { name: string; data: Uint8Array }[] = [];

  for (let i = 0; i < rootEntries; i++) {
    const entry = image.subarray(rootStart + i * 32, rootStart + (i + 1) * 32);
    if (entry[0] === 0) break;
    if (entry[0] === 229 || entry[11] === 15 || entry[11] & 8 || entry[11] & 16) continue;
    const stem = String.fromCharCode(...entry.subarray(0, 8)).trim();
    const ext = String.fromCharCode(...entry.subarray(8, 11)).trim();
    const name = ext ? `${stem}.${ext}` : stem;
    const first = get16(entry, 26);
    const size = get32(entry, 28);
    if (!first || !size) continue;
    const buf = new Uint8Array(size);
    let cluster = first;
    let written = 0;
    let guard = 0;
    while (cluster >= 2 && cluster < 65528 && written < size && guard++ < 4096) {
      const addr = dataStart + (cluster - 2) * clusterSize;
      const chunk = Math.min(clusterSize, size - written);
      if (addr + chunk > image.byteLength) break;
      buf.set(image.subarray(addr, addr + chunk), written);
      written += chunk;
      cluster = get16(image, fatStart + cluster * 2);
    }
    out.push({ name, data: buf.subarray(0, written) });
  }
  return out;
}

function buildMbr(partImages: Uint8Array[]): Uint8Array {
  const sizes = partImages.map((p) => Math.ceil(p.byteLength / SECTOR));
  let lba = 1;
  const starts: number[] = [];
  for (const sz of sizes) {
    starts.push(lba);
    lba += sz;
  }
  const image = new Uint8Array(lba * SECTOR);
  image[510] = 85;
  image[511] = 170;
  partImages.forEach((part, idx) => {
    const ent = 446 + idx * 16;
    image[ent] = idx === 0 ? 128 : 0;
    image[ent + 4] = 6;
    put32(image, ent + 8, starts[idx]);
    put32(image, ent + 12, sizes[idx]);
    image.set(part, starts[idx] * SECTOR);
  });
  return image;
}

export async function exportSdImage(): Promise<Blob> {
  const parts = await listPartitions();
  const images = parts.map((p) => ({
    label: p.label,
    size: PART_SIZE,
    files: p.files.map((f) => ({
      name: `${petsciiName(basename(f)).slice(0, 8)}.P00`,
      data: wrapP00(petsciiName(basename(f)), new Uint8Array(f.data)),
    })),
  }));
  const built = images.map((p) => buildFatPartition(p.files, p.size, p.label));
  const mbr = buildMbr(built);
  return new Blob([mbr.slice()], { type: "application/octet-stream" });
}

export function parseSdImage(data: Uint8Array): { label: string; files: { name: string; data: Uint8Array }[] }[] {
  if (data.byteLength < SECTOR || data[510] !== 85) {
    return [{ label: "PART0", files: readFatFiles(data) }];
  }
  const parts: { label: string; files: { name: string; data: Uint8Array }[] }[] = [];
  for (let i = 0; i < 4; i++) {
    const ent = 446 + i * 16;
    const type = data[ent + 4];
    const start = get32(data, ent + 8);
    const count = get32(data, ent + 12);
    if (!type || !count) continue;
    const slice = data.subarray(start * SECTOR, Math.min(data.byteLength, (start + count) * SECTOR));
    parts.push({ label: `PART${i}`, files: readFatFiles(slice) });
  }
  return parts.length ? parts : [{ label: "PART0", files: readFatFiles(data) }];
}

export async function importSdImage(data: Uint8Array): Promise<void> {
  const parts = parseSdImage(data);
  for (let i = 0; i < parts.length && i < 4; i++) {
    await formatPartition(i);
    for (const file of parts[i].files) {
      const p00 = unwrapP00(file.data);
      const payload = p00?.data ?? file.data;
      const copy = new Uint8Array(payload.byteLength);
      copy.set(payload);
      await addSdFile(i, p00?.name ?? file.name, copy.buffer);
    }
  }
}

function basename(f: SdFile): string {
  return f.name.split("/").pop() || f.name;
}

function parentPath(f: SdFile): string {
  if (f.path) return f.path.replace(/\/$/, "");
  if (f.name.includes("/")) return f.name.slice(0, f.name.lastIndexOf("/"));
  return "";
}

async function filesInDir(partId: number, dir = currentDir): Promise<SdFile[]> {
  const part = (await listPartitions()).find((p) => p.id === partId);
  const files = part?.files ?? [];
  const want = dir.replace(/\/$/, "").toUpperCase();
  return files.filter((f) => parentPath(f).toUpperCase() === want);
}

async function findFile(partId: number, pattern: string): Promise<SdFile | null> {
  const files = await filesInDir(partId);
  const upper = pattern.toUpperCase();
  if (!pattern || pattern === "*" || pattern === "*.*") return files[0] ?? null;
  return (
    files.find((f) => petsciiName(basename(f)) === upper || basename(f).toUpperCase() === upper) ??
    files.find((f) => matchPattern(petsciiName(basename(f)), upper) || matchPattern(basename(f), upper)) ??
    null
  );
}

function matchPattern(name: string, pattern: string): boolean {
  const re = pattern.replace(/\*/g, ".*").replace(/\?/g, ".");
  try {
    return new RegExp(`^${re}$`, "i").test(name);
  } catch {
    return name.toUpperCase() === pattern.toUpperCase();
  }
}

let currentPart = 0;
let currentDir = "";
let lastStatus = "00, OK,00,00";
let hooksInstalled = false;

const IEC_Y = 51200;
const CMD_READ = 1;
const CMD_WRITE = 2;
const CMD_OPEN = 3;
const CMD_CLOSE = 4;
const CMD_GETIN = 5;
const CMD_SETIN = 6;
const CMD_SETOUT = 7;
const CMD_CLRCH = 8;
const CMD_TALK = 9;
const DEVICE = 8;

interface OpenFile {
  sa: number;
  name: string;
  data: Uint8Array;
  pos: number;
  write: boolean;
  cmd: boolean;
}

const openFiles = new Map<number, OpenFile>();

function petsciiAscii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 97 && c <= 122) c -= 32;
    out[i] = c & 255;
  }
  return out;
}

function parsePath(raw: string): { part: number; path: string; file: string } {
  let part = currentPart;
  let rest = raw.replace(/^["']|["']$/g, "").trim();
  const m = rest.match(/^\/\/(\d+)\s*:?(.*)$/) || rest.match(/^(\d+)\s*:(.*)$/);
  if (m) {
    part = Number(m[1]);
    rest = (m[2] || "").trim();
  } else if (rest.startsWith("//")) {
    rest = rest.slice(2);
  }
  rest = rest.replace(/^:/, "");
  const slash = rest.lastIndexOf("/");
  return slash >= 0 ? { part, path: rest.slice(0, slash), file: rest.slice(slash + 1) } : { part, path: currentDir, file: rest };
}

function dirListing(name: string, files: SdFile[]): Uint8Array {
  const lines = [
    `0 "${name.toUpperCase().padEnd(16).slice(0, 16)}  SD 2A`,
    ...files.map((f) => `${Math.max(1, Math.ceil(f.size / 254)).toString().padStart(4)} "${petsciiName(basename(f)).padEnd(16)}" PRG`),
    "BLOCKS FREE.",
  ];
  return petsciiAscii(lines.join("\r") + "\r");
}

async function partitionCatalog(): Promise<Uint8Array> {
  const parts = await listPartitions();
  const out: number[] = [1, 8];
  let ptr = 2049;
  const line = (link: number, text: string) => {
    const bytes = petsciiAscii(text);
    const addr = ptr + 5 + bytes.length;
    out.push(addr & 255, addr >> 8, link & 255, link >> 8, 34);
    for (const b of bytes) out.push(b);
    out.push(34, 0);
    ptr = addr;
  };
  line(0, "GROK64 SD        SD 2A");
  for (const p of parts) line(p.id, `${p.label.padEnd(16)} FAT`);
  out.push(0, 0);
  return Uint8Array.from(out);
}

export async function runSdCommand(cmd: string): Promise<string> {
  const trimmed = cmd.replace(/^["']|["']$/g, "").trim();
  const upper = trimmed.toUpperCase();
  try {
    if (!trimmed || upper === "I" || upper.startsWith("I0") || upper === "UJ" || upper === "UI" || upper === "UI+" || upper === "UI-") {
      lastStatus = "00, OK,00,00";
      return lastStatus;
    }
    if (upper.startsWith("CD")) {
      const arg = trimmed.slice(2).replace(/^:/, "").trim();
      if (arg === "_" || arg === ".." || arg === "//" || arg === "/") currentDir = "";
      else if (arg.startsWith("//") || /^\d+\s*:/.test(arg)) {
        const p = parsePath(arg);
        currentPart = p.part;
        currentDir = (p.file || p.path || "").replace(/\/$/, "");
      } else currentDir = arg.replace(/\/$/, "");
      lastStatus = "00, OK,00,00";
      return lastStatus;
    }
    if (upper.startsWith("CP") || upper.startsWith("G-P")) {
      const n = Number((trimmed.match(/\d+/) || [])[0]);
      if (!Number.isNaN(n)) currentPart = n;
      lastStatus = "00, OK,00,00";
      return lastStatus;
    }
    if (upper.startsWith("MD:")) {
      currentDir = trimmed.slice(3).trim();
      lastStatus = "00, OK,00,00";
      return lastStatus;
    }
    if (upper.startsWith("RD:")) {
      lastStatus = "00, OK,00,00";
      return lastStatus;
    }
    if (upper.startsWith("S:")) {
      const p = parsePath(trimmed.slice(2));
      const part = (await listPartitions()).find((x) => x.id === p.part);
      if (part) {
        part.files = part.files.filter((f) => !matchPattern(petsciiName(basename(f)), p.file.toUpperCase()));
        await savePartition(part);
      }
      lastStatus = "00, OK,00,00";
      return lastStatus;
    }
    if (upper.startsWith("N")) {
      await formatPartition(currentPart);
      lastStatus = "00, OK,00,00";
      return lastStatus;
    }
    if (upper.startsWith("XD")) {
      const n = Number(upper.replace(/\D/g, "") || currentPart);
      if (!Number.isNaN(n)) currentPart = n;
      lastStatus = "00, OK,00,00";
      return lastStatus;
    }
    if (upper === "X" || upper === "X?") {
      lastStatus = `00, PART ${currentPart} ${currentDir || "/"},00,00`;
      return lastStatus;
    }
    lastStatus = "31, SYNTAX ERROR,00,00";
    return lastStatus;
  } catch {
    lastStatus = "74, DRIVE NOT READY,00,00";
    return lastStatus;
  }
}

type EjsLike = { Module?: Record<string, unknown>; gameManager?: { FS?: EmscriptenLite } };
interface EmscriptenLite {
  mkdir?: (p: string) => void;
}

function c64Ram(emu: EjsLike): Uint8Array | null {
  const mod = emu.Module;
  if (!mod) return null;
  const heap =
    (mod.HEAPU8 as Uint8Array | undefined) ??
    (mod.HEAP8 ? new Uint8Array((mod.HEAP8 as Int8Array).buffer) : null) ??
    (mod.wasmMemory ? new Uint8Array((mod.wasmMemory as WebAssembly.Memory).buffer) : null);
  if (!heap) return null;
  let ptr = 0;
  let size = 0;
  try {
    if (typeof mod._retro_get_memory_data === "function") {
      ptr = mod._retro_get_memory_data(0) as number;
      size = (mod._retro_get_memory_size as (n: number) => number)?.(0) ?? 0;
    } else if (mod.cwrap) {
      const getData = (mod.cwrap as (n: string, r: string | null, a: string[]) => (...a: unknown[]) => unknown)(
        "retro_get_memory_data",
        "number",
        ["number"],
      );
      const getSize = (mod.cwrap as (n: string, r: string | null, a: string[]) => (...a: unknown[]) => unknown)(
        "retro_get_memory_size",
        "number",
        ["number"],
      );
      ptr = getData(0) as number;
      size = getSize(0) as number;
    }
  } catch {
    return null;
  }
  if (!ptr || size < 65536) return null;
  return heap.subarray(ptr, ptr + Math.min(size, 65536));
}

function patchVector(ram: Uint8Array, off: number, target: number) {
  const cur = ram[off] | (ram[off + 1] << 8);
  if (cur === target) return;
  if (cur < 51456 || cur > 53247) {
    ram[target + 7] = 76;
    ram[target + 8] = cur & 255;
    ram[target + 9] = cur >> 8;
  }
  put16(ram, off, target);
}

function installReadStub(ram: Uint8Array, at: number, cmd: number) {
  ram.set(
    [
      173, 186, 0, 201, DEVICE, 240, 3, 76, 0, 0, 141, 2, 200, 169, cmd, 141, 1, 200, 173, 185, 0, 141, 3, 200, 173, 184,
      0, 141, 4, 200, 173, 183, 0, 141, 5, 200, 160, 0, 196, 183, 240, 8, 177, 187, 153, 16, 200, 200, 208, 244, 169, 1,
      141, 0, 200, 173, 0, 200, 201, 1, 240, 249, 201, 3, 240, 12, 174, 10, 200, 172, 11, 200, 169, 0, 24, 96, 173, 8,
      200, 141, 144, 0, 56, 96,
    ],
    at,
  );
}

function installGetinStub(ram: Uint8Array, at: number, cmd: number, dev: number) {
  ram.set(
    [173, dev, 0, 201, DEVICE, 240, 3, 76, 0, 0, 169, cmd, 141, 1, 200, 169, 1, 141, 0, 200, 173, 0, 200, 201, 1, 240, 249, 173, 9, 200, 96],
    at,
  );
}

function installClrStub(ram: Uint8Array, at: number) {
  ram.set(
    [72, 173, 154, 0, 201, DEVICE, 240, 4, 104, 76, 0, 0, 104, 141, 9, 200, 169, CMD_SETIN, 141, 1, 200, 169, 1, 141, 0, 200, 173, 0, 200, 201, 1, 240, 249, 96],
    at,
  );
}

function installTalkStub(ram: Uint8Array, at: number, cmd: number) {
  ram.set(
    [
      142, 4, 200, 138, 160, 0, 217, 89, 2, 240, 7, 200, 192, 10, 208, 246, 76, 0, 0, 185, 99, 2, 201, DEVICE, 240, 3, 76, 0, 0, 169, cmd, 141, 1, 200, 169, 1, 141, 0, 200, 173, 0, 200, 201, 1, 240, 249, 201, 3, 240, 6, 24, 96, 174, 4, 200, 76, 0, 0,
    ],
    at,
  );
}

function patchTalkVector(ram: Uint8Array, off: number, target: number) {
  const cur = ram[off] | (ram[off + 1] << 8);
  if (cur === target) return;
  if (cur < 51456 || cur > 53247) {
    for (const t of [16, 26, 55]) {
      ram[target + t] = 76;
      ram[target + t + 1] = cur & 255;
      ram[target + t + 2] = cur >> 8;
    }
  }
  put16(ram, off, target);
}

export function installSd2iecHooks(emu: EjsLike): boolean {
  const ram = c64Ram(emu);
  if (!ram) return false;
  installReadStub(ram, 51456, CMD_READ);
  installReadStub(ram, 51584, CMD_WRITE);
  installReadStub(ram, 51712, CMD_OPEN);
  installReadStub(ram, 51840, CMD_CLOSE);
  installGetinStub(ram, 51968, CMD_GETIN, 153);
  installClrStub(ram, 52096);
  installTalkStub(ram, 52224, CMD_SETOUT);
  installTalkStub(ram, 52352, CMD_TALK);
  installReadStub(ram, 52480, CMD_CLRCH);
  patchVector(ram, 816, 51456);
  patchVector(ram, 818, 51584);
  patchVector(ram, 794, 51712);
  patchVector(ram, 796, 51840);
  patchVector(ram, 804, 51968);
  patchVector(ram, 806, 52096);
  patchTalkVector(ram, 798, 52224);
  patchTalkVector(ram, 800, 52352);
  patchVector(ram, 812, 52480);
  ram[IEC_Y] = 0;
  hooksInstalled = true;
  return true;
}

function queueFile(ram: Uint8Array, sa: number, mode: number) {
  const count = ram[152] || 0;
  if (count >= 10) return;
  ram[601 + count] = sa;
  ram[611 + count] = DEVICE;
  ram[621 + count] = mode;
  ram[152] = count + 1;
}

function dequeueFile(ram: Uint8Array, sa: number) {
  const count = ram[152] || 0;
  for (let i = 0; i < count; i++) {
    if (ram[601 + i] === sa) {
      for (let j = i; j < count - 1; j++) {
        ram[601 + j] = ram[601 + j + 1];
        ram[611 + j] = ram[611 + j + 1];
        ram[621 + j] = ram[621 + j + 1];
      }
      ram[152] = Math.max(0, count - 1);
      return;
    }
  }
}

async function handleRead(ram: Uint8Array) {
  const len = ram[51205] || 0;
  const name = String.fromCharCode(...ram.subarray(51216, 51216 + len));
  const track = ram[51203] || 0;
  const upper = name.toUpperCase();
  if (upper.startsWith("$=P") || upper.includes("$=P")) {
    const cat = await partitionCatalog();
    const addr = 2049;
    ram.set(cat.subarray(2), addr);
    const end = addr + cat.length - 2;
    ram[51210] = end & 255;
    ram[51211] = end >> 8;
    ram[51208] = 64;
    ram[IEC_Y] = 2;
    return;
  }
  if (name.startsWith("$")) {
    const files = await filesInDir(currentPart);
    const out: number[] = [1, 8];
    let ptr = 2049;
    const line = (link: number, text: string) => {
      const raw = petsciiAscii(text);
      const addr = ptr + 5 + raw.length;
      out.push(addr & 255, addr >> 8, link & 255, link >> 8, 34);
      for (const b of raw) out.push(b);
      out.push(34, 0);
      ptr = addr;
    };
    line(0, `0 "${"GROK64 SD".toUpperCase().padEnd(16).slice(0, 16)}  SD 2A`);
    for (const f of files) {
      line(Math.max(1, Math.ceil(f.size / 254)), `"${petsciiName(basename(f)).padEnd(16)}" PRG`);
    }
    line(65535, "BLOCKS FREE");
    out.push(0, 0);
    const bytes = Uint8Array.from(out);
    const addr = track === 0 ? 2049 : ram[195] | (ram[196] << 8) || 2049;
    ram.set(bytes.subarray(2), addr);
    const end = addr + bytes.length - 2;
    ram[51210] = end & 255;
    ram[51211] = end >> 8;
    ram[51208] = 64;
    ram[IEC_Y] = 2;
    return;
  }
  const file = await findFile(currentPart, name.replace(/^:/, ""));
  if (!file) {
    ram[51208] = 4;
    ram[IEC_Y] = 3;
    return;
  }
  let payload = new Uint8Array(file.data);
  const p00 = unwrapP00(payload);
  if (p00) payload = new Uint8Array(p00.data);
  const load = payload.length >= 2 ? payload[0] | (payload[1] << 8) : 2049;
  const prg = payload.length >= 2 ? payload.subarray(2) : payload;
  const dest = track === 0 ? ram[195] | (ram[196] << 8) || load : load;
  if (dest + prg.length < 65536) ram.set(prg, dest);
  const end = dest + prg.length;
  ram[51210] = end & 255;
  ram[51211] = end >> 8;
  ram[51208] = 64;
  ram[IEC_Y] = 2;
}

async function handleWrite(ram: Uint8Array) {
  const len = ram[51205] || 0;
  const name = String.fromCharCode(...ram.subarray(51216, 51216 + len)) || "UNTITLED";
  const start = ram[193] | (ram[194] << 8);
  const end = ram[174] | (ram[175] << 8);
  if (end <= start || end > 65536) {
    ram[IEC_Y] = 3;
    return;
  }
  const buf = new Uint8Array(2 + (end - start));
  buf[0] = start & 255;
  buf[1] = start >> 8;
  buf.set(ram.subarray(start, end), 2);
  await addSdFile(currentPart, name, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), currentDir);
  ram[51208] = 0;
  ram[IEC_Y] = 2;
}

async function handleOpen(ram: Uint8Array) {
  const len = ram[51205] || 0;
  const name = String.fromCharCode(...ram.subarray(51216, 51216 + len));
  const mode = ram[51203] || 0;
  const sa = ram[51204] || 0;
  const upper = name.toUpperCase();
  if (mode === 15 || /^(CD|MD|RD|S:|I|X|N|U|CP|G-P)/i.test(name)) {
    if (name) await runSdCommand(name);
    openFiles.set(sa, { sa, name, data: petsciiAscii(`${lastStatus}\r`), pos: 0, write: true, cmd: true });
    queueFile(ram, sa, mode);
    ram[IEC_Y] = 2;
    return;
  }
  if (upper.startsWith("$=P")) {
    const cat = await partitionCatalog();
    openFiles.set(sa, { sa, name, data: cat.subarray(2), pos: 0, write: false, cmd: false });
    queueFile(ram, sa, mode);
    ram[IEC_Y] = 2;
    return;
  }
  if (name.startsWith("$")) {
    openFiles.set(sa, { sa, name, data: dirListing("GROK64 SD", await filesInDir(currentPart)), pos: 0, write: false, cmd: false });
    queueFile(ram, sa, mode);
    ram[IEC_Y] = 2;
    return;
  }
  const file = await findFile(currentPart, name.replace(/^:/, ""));
  if (!file) {
    ram[51208] = 4;
    ram[IEC_Y] = 3;
    return;
  }
  let payload = new Uint8Array(file.data);
  const p00 = unwrapP00(payload);
  if (p00) payload = new Uint8Array(p00.data);
  openFiles.set(sa, { sa, name, data: payload, pos: 0, write: false, cmd: false });
  queueFile(ram, sa, mode);
  ram[IEC_Y] = 2;
}

function handleClose(ram: Uint8Array) {
  const sa = ram[51204] || 0;
  openFiles.delete(sa);
  dequeueFile(ram, sa);
  ram[IEC_Y] = 2;
}

function handleGetin(ram: Uint8Array) {
  const file = openFiles.get(ram[184] || 0);
  if (!file || file.pos >= file.data.length) {
    ram[51209] = 13;
    ram[144] = 64;
    ram[IEC_Y] = 2;
    return;
  }
  ram[51209] = file.data[file.pos++];
  if (file.pos >= file.data.length) ram[144] = 64;
  ram[IEC_Y] = 2;
}

function handleSetin(ram: Uint8Array) {
  ram[IEC_Y] = 2;
}

function handleTalk(ram: Uint8Array) {
  const sa = ram[51204] || 0;
  if (!openFiles.has(sa)) {
    ram[IEC_Y] = 3;
    return;
  }
  ram[153] = DEVICE;
  ram[184] = sa;
  ram[IEC_Y] = 2;
}

function handleListen(ram: Uint8Array) {
  const sa = ram[51204] || 0;
  if (!openFiles.has(sa)) {
    ram[IEC_Y] = 3;
    return;
  }
  ram[154] = DEVICE;
  ram[184] = sa;
  ram[IEC_Y] = 2;
}

function handleClrch(ram: Uint8Array) {
  openFiles.clear();
  ram[152] = 0;
  ram[IEC_Y] = 2;
}

/** Poll SD2IEC IEC hooks — call each animation frame when iecDrive is sd2iec. */
export async function tickSd2iec(emu: EjsLike): Promise<boolean> {
  const ram = c64Ram(emu);
  if (!ram) return false;
  if (hooksInstalled && (ram[816] | (ram[817] << 8)) !== 51456) installSd2iecHooks(emu);
  if (ram[IEC_Y] !== 1) return true;
  const cmd = ram[51201];
  try {
    if (cmd === CMD_READ) await handleRead(ram);
    else if (cmd === CMD_WRITE) await handleWrite(ram);
    else if (cmd === CMD_OPEN) await handleOpen(ram);
    else if (cmd === CMD_CLOSE) handleClose(ram);
    else if (cmd === CMD_GETIN) handleGetin(ram);
    else if (cmd === CMD_SETIN) handleSetin(ram);
    else if (cmd === CMD_SETOUT) handleTalk(ram);
    else if (cmd === CMD_TALK) handleListen(ram);
    else if (cmd === CMD_CLRCH) handleClrch(ram);
    else ram[IEC_Y] = 2;
  } catch {
    ram[IEC_Y] = 3;
  }
  return true;
}

/** Mount SD partition files into VICE work disk paths. */
export function mountSdPartitions(
  mkdir: (p: string) => void,
  writeFile: (p: string, data: Uint8Array) => void,
  parts: SdPartition[],
): number {
  const roots = ["/vice_work", "/home/web_user/retroarch/userdata/saves/vice_work", "/data/vice_work"];
  for (const root of roots) mkdir(root);
  let count = 0;
  for (const part of parts) {
    if (!part.files.length) continue;
    for (const root of roots) {
      const dir = `${root}/${part.id}`;
      mkdir(dir);
      for (const f of part.files) {
        try {
          writeFile(`${dir}/${f.name}`, new Uint8Array(f.data));
          count += 1;
        } catch {
          /* try next path */
        }
      }
    }
  }
  return count;
}

export async function partitionsForMount(): Promise<SdPartition[]> {
  const parts = await listPartitions();
  return parts
    .map((p) => ({
      ...p,
      files: p.files.map((f) => ({
        ...f,
        name: petsciiName(f.name),
        data: f.data,
      })),
    }))
    .filter((p) => p.files.length > 0);
}
