import { openExpansionDb, STORES, txDone } from "./expansion-db";
import { c64RamView } from "./c64-memory";
import { grok64WasmApi, type Grok64ModuleBag } from "./grok64-api";
import { resolveWasmExport } from "./grok64-wasm-direct";
import { listD64Directory, readD64Prg } from "./d64";
import { isAcceptedD64ByteLength } from "./formats";
import type { IecUnit } from "./types";

/**
 * IEC device numbers SD2IEC may answer on (incl. C64 OS on #12).
 * Firmware semantics: https://www.c64os.com/post/sd2iecdocumentation
 */
export type IecDeviceNumber = IecUnit | 12;

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
  /** Virtual subdirectories (POSIX-style paths, no leading slash). */
  dirs?: string[];
}

const DEFAULT_PARTS: SdPartition[] = [0, 1, 2, 3].map((id) => ({
  id,
  label: `PART${id}`,
  files: [],
  dirs: [],
}));

/** In-memory mirror for WASM IEC (sync); refreshed from IDB when possible. */
let syncParts: SdPartition[] = DEFAULT_PARTS.map((p) => ({ ...p, files: [...p.files], dirs: [...(p.dirs ?? [])] }));

const wasmDevEarly = new Map<number, unknown[]>();

function syncPart(partId: number): SdPartition {
  return syncParts.find((p) => p.id === partId) ?? syncParts[0]!;
}

function syncFilesInDir(partId: number, dir = currentDir): SdFile[] {
  const want = normDir(dir);
  const part = syncPart(partId);
  return part.files.filter((f) => normDir(parentPath(f)) === want);
}

/** Folders directly inside `dir`: made with MD/CD, or holding a file somewhere below them. */
function childDirs(part: SdPartition, dir: string): string[] {
  const want = normDir(dir);
  const out = new Set<string>();
  const add = (path: string) => {
    const n = normDir(path);
    if (!n) return;
    const rest = !want ? n : n.startsWith(`${want}/`) ? n.slice(want.length + 1) : "";
    const seg = rest.split("/")[0];
    if (seg) out.add(seg);
  };
  for (const d of part.dirs ?? []) add(d);
  for (const f of part.files) add(parentPath(f));
  return [...out].sort();
}

function syncSubdirsInDir(partId: number, dir = currentDir): string[] {
  return childDirs(syncPart(partId), dir);
}

function syncFindFile(partId: number, pattern: string): SdFile | null {
  const want = normDir(pattern);
  const part = syncPart(partId);
  const inDir = syncFilesInDir(partId);
  const hit = inDir.find((f) => matchPattern(petsciiName(basename(f)), want));
  return hit ?? part.files.find((f) => matchPattern(petsciiName(basename(f)), want)) ?? null;
}

export function resetSd2iecSession(): void {
  currentPart = 0;
  currentDir = "";
  lastStatus = "00, OK,00,00";
  openFiles.clear();
  clearMountedDiskImage();
  wasmDevEarly.clear();
}

function normDir(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toUpperCase();
}

function parentDir(path: string): string {
  const n = normDir(path);
  if (!n) return "";
  const parts = n.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function joinDir(base: string, name: string): string {
  const b = normDir(base);
  const n = normDir(name);
  if (!n) return b;
  return b ? `${b}/${n}` : n;
}

/** CD parent step — sd2iec manual (C64 OS): `CD<-`, `CD:_`, and PETSCII `CD←`. */
function isCdParentStep(arg: string): boolean {
  const a = arg.trim();
  if (!a) return false;
  if (a === "<-" || a === "_" || a === "..") return true;
  if (a === "←" || a === "\u2190") return true;
  if (a.length === 1) {
    const c = a.charCodeAt(0);
    if (c === 0x5f || c === 0x1e || c === 94) return true;
  }
  return false;
}

async function loadPart(partId: number): Promise<SdPartition> {
  const part = (await listPartitions()).find((p) => p.id === partId);
  return part ?? { id: partId, label: `PART${partId}`, files: [], dirs: [] };
}

async function ensureDir(partId: number, dirPath: string): Promise<void> {
  const part = await loadPart(partId);
  const want = normDir(dirPath);
  if (!want) return;
  const dirs = new Set((part.dirs ?? []).map(normDir));
  const parts = want.split("/").filter(Boolean);
  let acc = "";
  for (const seg of parts) {
    acc = acc ? `${acc}/${seg}` : seg;
    dirs.add(acc);
  }
  part.dirs = [...dirs];
  await savePartition(part);
}

async function removeDirTree(partId: number, dirPath: string): Promise<void> {
  const part = await loadPart(partId);
  const want = normDir(dirPath);
  part.dirs = (part.dirs ?? []).filter((d) => normDir(d) !== want && !normDir(d).startsWith(`${want}/`));
  part.files = part.files.filter((f) => {
    const p = normDir(parentPath(f));
    return p !== want && !p.startsWith(`${want}/`);
  });
  await savePartition(part);
}

export function buildVirtualPartitionsFromFatImage(image: Uint8Array): SdPartition[] {
  const parsed = parseSdImage(image);
  return parsed.map((part, idx) => {
    const files: SdFile[] = part.files.map((f) => ({
      id: `fat-${idx}-${f.name}`,
      name: f.name,
      size: f.data.byteLength,
      data: f.data.buffer.slice(
        f.data.byteOffset,
        f.data.byteOffset + f.data.byteLength,
      ) as ArrayBuffer,
      path: "",
    }));
    return {
      id: idx,
      label: part.label || `PART${idx}`,
      files,
      dirs: [],
    };
  });
}

export async function listPartitions(): Promise<SdPartition[]> {
  const { getVirtualSdPartitions } = await import("./sd2iec-card-source");
  const virtual = getVirtualSdPartitions();
  if (virtual) {
    syncParts = virtual;
    return virtual;
  }
  const db = await openExpansionDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.sdpart, "readonly").objectStore(STORES.sdpart).getAll();
    req.onsuccess = () => {
      const rows = (req.result as SdPartition[]) ?? [];
      const map = new Map(rows.map((p) => [p.id, p]));
      syncParts = DEFAULT_PARTS.map((p) => map.get(p.id) ?? p);
      resolve(syncParts);
    };
    req.onerror = () => reject(req.error);
  });
}

async function savePartition(part: SdPartition): Promise<void> {
  const db = await openExpansionDb();
  const tx = db.transaction(STORES.sdpart, "readwrite");
  tx.objectStore(STORES.sdpart).put(part);
  await txDone(tx);
  const i = syncParts.findIndex((p) => p.id === part.id);
  if (i >= 0) syncParts[i] = part;
  else syncParts.push(part);
}

export async function addSdFile(partId: number, name: string, data: ArrayBuffer, path = ""): Promise<void> {
  const { getVirtualSdPartitions, getHostDirectoryMount, isSd2iecWriteEnabled, refreshHostDirectoryPartitions } =
    await import("./sd2iec-card-source");
  const { writeHostDirectoryFile } = await import("./sd2iec-host-directory");
  const mount = getHostDirectoryMount();
  if (getVirtualSdPartitions() && mount) {
    if (!isSd2iecWriteEnabled()) return;
    const rel = path ? `${path}/${name}` : name;
    await writeHostDirectoryFile(mount, rel, new Uint8Array(data));
    const virtual = await refreshHostDirectoryPartitions();
    if (virtual) syncParts = virtual;
    return;
  }
  if (getVirtualSdPartitions()) return;
  const part = (await listPartitions()).find((p) => p.id === partId) ?? { id: partId, label: `PART${partId}`, files: [] };
  part.files = [
    ...part.files,
    { id: crypto.randomUUID(), name, size: data.byteLength, data, path },
  ];
  await savePartition(part);
}

export async function removeSdFile(partId: number, fileId: string): Promise<void> {
  const { getVirtualSdPartitions } = await import("./sd2iec-card-source");
  if (getVirtualSdPartitions()) return;
  const part = (await listPartitions()).find((p) => p.id === partId);
  if (!part) return;
  part.files = part.files.filter((f) => f.id !== fileId);
  await savePartition(part);
}

export async function formatPartition(partId: number): Promise<void> {
  const { getVirtualSdPartitions } = await import("./sd2iec-card-source");
  if (getVirtualSdPartitions()) return;
  await savePartition({ id: partId, label: `PART${partId}`, files: [], dirs: [] });
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

/** Legacy: explode image into IndexedDB (copy). Prefer mountDirectFatImage for IEC-faithful mount. */
export async function importSdImage(data: Uint8Array): Promise<void> {
  const { clearSd2iecCardMount, notifySd2iecCardChanged } = await import("./sd2iec-card-source");
  clearSd2iecCardMount();
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
  notifySd2iecCardChanged();
}

/** Mount .img for SD2IEC firmware — FAT read from image bytes, not repacked into IDB. */
export async function mountDirectFatImage(data: Uint8Array, label?: string): Promise<SdPartition[]> {
  const { mountDirectFatImage: mount, clearSd2iecCardMount } = await import("./sd2iec-card-source");
  clearSd2iecCardMount();
  const virtual = buildVirtualPartitionsFromFatImage(data);
  mount(data, label ?? "SD.IMG", virtual);
  syncParts = virtual;
  resetSd2iecSession();
  return virtual;
}

export async function mountHostSdFolder(handle: FileSystemDirectoryHandle): Promise<SdPartition[]> {
  const { mountHostDirectory, clearSd2iecCardMount } = await import("./sd2iec-card-source");
  clearSd2iecCardMount();
  const virtual = await mountHostDirectory(handle);
  syncParts = virtual;
  resetSd2iecSession();
  return virtual;
}

function basename(f: SdFile): string {
  return f.name.split("/").pop() || f.name;
}

function parentPath(f: SdFile): string {
  if (f.path) return f.path.replace(/\/$/, "");
  if (f.name.includes("/")) return f.name.slice(0, f.name.lastIndexOf("/"));
  return "";
}

async function subdirsInDir(partId: number, dir = currentDir): Promise<string[]> {
  return childDirs(await loadPart(partId), dir);
}

async function findFileOnCard(partId: number, pattern: string): Promise<SdFile | null> {
  const files = await filesInDir(partId, currentDir, false);
  const upper = pattern.toUpperCase();
  return (
    files.find((f) => petsciiName(basename(f)) === upper || basename(f).toUpperCase() === upper) ??
    files.find((f) => matchPattern(petsciiName(basename(f)), upper) || matchPattern(basename(f), upper)) ??
    null
  );
}

async function filesInDir(partId: number, dir = currentDir, honorMount = true): Promise<SdFile[]> {
  if (honorMount && mountedDiskImage && mountedDiskImage.byteLength >= 174848) {
    return listD64Directory(mountedDiskImage)
      .filter((e) => e.prg)
      .map((e) => ({
        id: e.name,
        name: `${e.name}.PRG`,
        size: e.blocks * 254,
        data: (() => {
          const prg = readD64Prg(mountedDiskImage!, e.name);
          if (!prg) return new ArrayBuffer(0);
          const copy = new Uint8Array(prg.byteLength);
          copy.set(prg);
          return copy.buffer;
        })(),
      }));
  }
  const part = await loadPart(partId);
  const files = part?.files ?? [];
  const want = normDir(dir);
  return files.filter((f) => {
    const p = normDir(parentPath(f));
    const base = basename(f);
    if (p !== want) return false;
    return !base.includes("/");
  });
}

async function findFile(partId: number, pattern: string): Promise<SdFile | null> {
  if (mountedDiskImage && mountedDiskImage.byteLength >= 174848) {
    const prg = readD64Prg(mountedDiskImage, pattern);
    if (prg) {
      return {
        id: pattern,
        name: pattern,
        size: prg.byteLength,
        data: (() => {
          const copy = new Uint8Array(prg.byteLength);
          copy.set(prg);
          return copy.buffer;
        })(),
      };
    }
  }
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
/** After `CD:GAME.D64`, listings/loads come from this image (sd2iec firmware behavior). */
let mountedDiskImage: Uint8Array | null = null;
let mountedDiskName = "";

export function clearMountedDiskImage() {
  mountedDiskImage = null;
  mountedDiskName = "";
}

export function mountedDiskImageName(): string | null {
  return mountedDiskName || null;
}

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
let deviceUnit: IecDeviceNumber = 8;
let jiffyFastPath = false;

export function setSd2iecJiffyFast(on: boolean) {
  jiffyFastPath = on;
}

export function setIecDevice(unit: IecDeviceNumber) {
  deviceUnit = unit;
  hooksInstalled = false;
}

export function iecDevice(): IecDeviceNumber {
  return deviceUnit;
}

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

function partFromHardware(n: number): number {
  if (n >= 1 && n <= 16) return n - 1;
  return n;
}

function parsePath(raw: string): { part: number; path: string; file: string } {
  let part = currentPart;
  let rest = raw.replace(/^["']|["']$/g, "").trim();
  const sd2 = rest.match(/^(\d+)\/\/:?(.+)?$/);
  if (sd2) {
    part = partFromHardware(Number(sd2[1]));
    rest = (sd2[2] || "").trim().replace(/^:/, "");
    const slash = rest.lastIndexOf("/");
    return slash >= 0
      ? { part, path: rest.slice(0, slash), file: rest.slice(slash + 1) }
      : { part, path: "", file: rest };
  }
  const m = rest.match(/^\/\/(\d+)\s*:?(.*)$/) || rest.match(/^(\d+)\s*:(.*)$/);
  if (m) {
    part = partFromHardware(Number(m[1]));
    rest = (m[2] || "").trim();
  } else if (rest.startsWith("//")) {
    rest = rest.slice(2);
  }
  rest = rest.replace(/^:/, "");
  const slash = rest.lastIndexOf("/");
  return slash >= 0 ? { part, path: rest.slice(0, slash), file: rest.slice(slash + 1) } : { part, path: currentDir, file: rest };
}

function dirListing(
  name: string,
  files: SdFile[],
  subdirs: string[] = [],
  inSubdir = false,
): Uint8Array {
  const lines = [
    `0 "${name.toUpperCase().padEnd(16).slice(0, 16)}  SD 2A`,
    ...(inSubdir ? [`${"0".padStart(4)} "←" DIR`] : []),
    ...subdirs.map((d) => `${"0".padStart(4)} "${petsciiName(d).padEnd(16)}" DIR`),
    ...files.map((f) => `${Math.max(1, Math.ceil(f.size / 254)).toString().padStart(4)} "${petsciiName(basename(f)).padEnd(16)}" PRG`),
    "BLOCKS FREE.",
  ];
  return petsciiAscii(lines.join("\r") + "\r");
}

interface CbmDirEntry {
  blocks: number;
  /** PETSCII name bytes, without the 0xA0 padding. */
  name: ArrayLike<number>;
  type: string;
  open?: boolean;
  locked?: boolean;
}

const CBM_FILE_TYPES = ["DEL", "SEQ", "PRG", "USR", "REL"];
const PETSCII_LEFT_ARROW = 0x5f;

/**
 * `$` as a BASIC program, laid out the way the 1541 and the sd2iec firmware send it: load address
 * $0401, dummy line links (BASIC relinks after LOAD), a reverse header with the quoted 16-character
 * disk name, ID and DOS type, one line per entry (blocks as line number, quoted name, type column),
 * then BLOCKS FREE.
 */
function cbmDirectoryProgram(
  header: { name: ArrayLike<number>; id: ArrayLike<number>; dos: ArrayLike<number> },
  entries: CbmDirEntry[],
  blocksFree: number,
): Uint8Array {
  const out: number[] = [0x01, 0x04];
  const line = (num: number, text: number[]) => out.push(0x01, 0x01, num & 0xff, (num >> 8) & 0xff, ...text, 0);
  const field = (bytes: ArrayLike<number>, len: number) =>
    Array.from({ length: len }, (_, i) => {
      const b = bytes[i] ?? 0x20;
      return b === 0xa0 ? 0x20 : b;
    });
  line(0, [0x12, 0x22, ...field(header.name, 16), 0x22, 0x20, ...field(header.id, 2), 0x20, ...field(header.dos, 2)]);
  for (const e of entries) {
    const name = Array.from(e.name).slice(0, 16);
    const fill = [e.blocks < 1000, e.blocks < 100, e.blocks < 10].filter(Boolean).map(() => 0x20);
    line(e.blocks, [
      ...fill,
      0x22,
      ...name,
      0x22,
      ...Array<number>(16 - name.length).fill(0x20),
      e.open ? 0x2a : 0x20,
      ...petsciiAscii(e.type),
      e.locked ? 0x3c : 0x20,
    ]);
  }
  line(Math.min(blocksFree, 65535), [...petsciiAscii("BLOCKS FREE.")]);
  out.push(0, 0);
  return Uint8Array.from(out);
}

/** The card's current folder: parent entry in a subfolder, folders as DIR, files as PRG. */
function cardDirectoryProgram(files: SdFile[], subdirs: string[], inSubdir: boolean): Uint8Array {
  const name = (s: string) => petsciiAscii(s.slice(0, 16));
  return cbmDirectoryProgram(
    { name: petsciiAscii("GROK64 SD"), id: petsciiAscii("SD"), dos: petsciiAscii("2A") },
    [
      ...(inSubdir ? [{ blocks: 0, name: [PETSCII_LEFT_ARROW], type: "DIR" }] : []),
      ...subdirs.map((d) => ({ blocks: 0, name: name(petsciiName(d)), type: "DIR" })),
      ...files.map((f) => ({ blocks: Math.max(1, Math.ceil(f.size / 254)), name: name(petsciiName(basename(f))), type: "PRG" })),
    ],
    65535,
  );
}

/** A D64 mounted with `CD:` lists its own header, entries and BAM free count, as on the firmware. */
function d64DirectoryProgram(image: Uint8Array, filter?: string): Uint8Array {
  const bamOff = 357 * 256;
  const bam = image.subarray(bamOff, bamOff + 256);
  let free = 0;
  for (let t = 1; t <= 35; t++) if (t !== 18) free += bam[4 * t] ?? 0;
  const shown = listD64Directory(image).filter((e) => !filter || filter === "*" || matchPattern(e.name, filter));
  return cbmDirectoryProgram(
    { name: bam.subarray(0x90, 0xa0), id: bam.subarray(0xa2, 0xa4), dos: bam.subarray(0xa5, 0xa7) },
    shown.map((e) => {
      const raw = image.subarray(e.slot + 5, e.slot + 21);
      const end = raw.indexOf(0xa0);
      return {
        blocks: e.blocks,
        name: raw.subarray(0, end < 0 ? 16 : end),
        type: CBM_FILE_TYPES[e.type & 7] ?? "???",
        open: !(e.type & 0x80),
        locked: Boolean(e.type & 0x40),
      };
    }),
    free,
  );
}

/** The D64 that `CD:NAME.D64` mounted; other image kinds keep the card listing. */
function mountedD64(): Uint8Array | null {
  return mountedDiskImage && isAcceptedD64ByteLength(mountedDiskImage.byteLength) ? mountedDiskImage : null;
}

/** `filter` (a `$:NAME*` pattern) applies to the mounted D64; card callers filter `files` themselves. */
function sdDirectoryProgram(files: SdFile[], subdirs: string[], inSubdir: boolean, filter?: string): Uint8Array {
  const d64 = mountedD64();
  return d64 ? d64DirectoryProgram(d64, filter) : cardDirectoryProgram(files, subdirs, inSubdir);
}

/** A PRG on the mounted D64 by exact name or `*` / `?` pattern (first match, like the DOS). */
function mountedD64Prg(pattern: string): Uint8Array | null {
  const d64 = mountedD64();
  if (!d64) return null;
  const want = pattern.toUpperCase();
  const entry = listD64Directory(d64).find(
    (e) => e.prg && (e.name.toUpperCase() === want || matchPattern(e.name, want)),
  );
  return entry ? readD64Prg(d64, entry.name) : null;
}

function parseDirFilter(raw: string): { part: number; filter: string } {
  const upper = raw.toUpperCase();
  if (upper.includes("$=P")) return { part: currentPart, filter: "$=P" };
  const m = upper.match(/\$=([^"']+)/);
  const filter = m?.[1]?.trim() || "*";
  const p = parsePath(raw);
  return { part: p.part, filter };
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
      let arg = trimmed.slice(2).replace(/^:/, "").trim();
      if (isCdParentStep(arg)) {
        if (mountedDiskImage) {
          if (currentDir) currentDir = parentDir(currentDir);
          else clearMountedDiskImage();
        } else {
          currentDir = parentDir(currentDir);
        }
      } else if (arg === "//" || arg === "/" || arg === "") {
        if (mountedDiskImage) {
          currentDir = "";
        } else {
          currentDir = "";
          clearMountedDiskImage();
        }
      } else if (/^\d+\/\//.test(arg.replace(/^["']|["']$/g, ""))) {
        const p = parsePath(arg.replace(/^["']|["']$/g, ""));
        currentPart = p.part;
        const merged = [p.path, p.file].filter(Boolean).join("/");
        currentDir = normDir(merged);
        if (currentDir) await ensureDir(currentPart, currentDir);
      } else if (arg.startsWith("//") || /^\d+\s*:/.test(arg)) {
        const p = parsePath(arg.startsWith("//") ? `//${arg.slice(2)}` : arg);
        currentPart = p.part;
        const sub = (p.file || p.path || "").replace(/\/$/, "");
        currentDir = sub ? joinDir("", sub) : "";
      } else {
        const diskTarget = arg.replace(/^["']|["']$/g, "");
        const onCard = await findFileOnCard(currentPart, diskTarget);
        if (onCard && /\.(d64|d81|d71|dnp)$/i.test(basename(onCard))) {
          mountedDiskImage = new Uint8Array(onCard.data);
          mountedDiskName = basename(onCard);
          currentDir = "";
          lastStatus = "00, OK,00,00";
          return lastStatus;
        }
        if (mountedDiskImage) clearMountedDiskImage();
        currentDir = joinDir(currentDir, arg);
        await ensureDir(currentPart, currentDir);
      }
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
      const name = trimmed.slice(3).replace(/^["']|["']$/g, "").trim();
      if (name) await ensureDir(currentPart, joinDir(currentDir, name));
      lastStatus = "00, OK,00,00";
      return lastStatus;
    }
    if (upper.startsWith("RD:")) {
      const name = trimmed.slice(3).replace(/^["']|["']$/g, "").trim();
      if (name) await removeDirTree(currentPart, joinDir(currentDir, name));
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

export type EjsLike = { Module?: Record<string, unknown>; gameManager?: { FS?: EmscriptenLite } };
interface EmscriptenLite {
  mkdir?: (p: string) => void;
}

function c64Ram(emu: EjsLike): Uint8Array | null {
  return c64RamView(emu);
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
      173, 186, 0, 201, deviceUnit, 240, 3, 76, 0, 0, 141, 2, 200, 169, cmd, 141, 1, 200, 173, 185, 0, 141, 3, 200, 173, 184,
      0, 141, 4, 200, 173, 183, 0, 141, 5, 200, 160, 0, 196, 183, 240, 8, 177, 187, 153, 16, 200, 200, 208, 244, 169, 1,
      141, 0, 200, 173, 0, 200, 201, 1, 240, 249, 201, 3, 240, 12, 174, 10, 200, 172, 11, 200, 169, 0, 24, 96, 173, 8,
      200, 141, 144, 0, 56, 96,
    ],
    at,
  );
}

function installGetinStub(ram: Uint8Array, at: number, cmd: number, dev: number) {
  ram.set(
    [173, dev, 0, 201, deviceUnit, 240, 3, 76, 0, 0, 169, cmd, 141, 1, 200, 169, 1, 141, 0, 200, 173, 0, 200, 201, 1, 240, 249, 173, 9, 200, 96],
    at,
  );
}

function installClrStub(ram: Uint8Array, at: number) {
  ram.set(
    [72, 173, 154, 0, 201, deviceUnit, 240, 4, 104, 76, 0, 0, 104, 141, 9, 200, 169, CMD_SETIN, 141, 1, 200, 169, 1, 141, 0, 200, 173, 0, 200, 201, 1, 240, 249, 96],
    at,
  );
}

function installTalkStub(ram: Uint8Array, at: number, cmd: number) {
  ram.set(
    [
      142, 4, 200, 138, 160, 0, 217, 89, 2, 240, 7, 200, 192, 10, 208, 246, 76, 0, 0, 185, 99, 2, 201, deviceUnit, 240, 3, 76, 0, 0, 169, cmd, 141, 1, 200, 169, 1, 141, 0, 200, 173, 0, 200, 201, 1, 240, 249, 201, 3, 240, 6, 24, 96, 174, 4, 200, 76, 0, 0,
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

/** Attach Grok64 SD2IEC on the IEC bus (KERNAL intercept — no VICE drive on this unit). */
let wasmIecOnly = false;

/** When true, SD2IEC is served by VICE IEC device (WASM) — do not patch KERNAL vectors. */
export function setSd2iecWasmIecOnly(on: boolean) {
  wasmIecOnly = on;
}

export function sd2iecWasmIecOnly(): boolean {
  return wasmIecOnly;
}

export function attachSd2iecBus(emu: EjsLike | null, unit: IecDeviceNumber = deviceUnit): boolean {
  setIecDevice(unit);
  if (!emu) return false;
  if (wasmIecOnly) return true;
  return installSd2iecHooks(emu);
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
  ram[611 + count] = deviceUnit;
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
  const dirSpec = parseDirFilter(name);
  if (dirSpec.filter === "$=P" || upper.startsWith("$=P") || upper.includes("$=P")) {
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
  if (name.startsWith("$") || name.toUpperCase().includes("$=")) {
    const spec = parseDirFilter(name);
    if (spec.part !== currentPart) currentPart = spec.part;
    let files = await filesInDir(currentPart);
    const subdirs = await subdirsInDir(currentPart);
    if (spec.filter && spec.filter !== "$=P" && spec.filter !== "*") {
      const pat = spec.filter.replace(/\*/g, ".*").replace(/\?/g, ".");
      const re = new RegExp(`^${pat}$`, "i");
      files = files.filter((f) => re.test(petsciiName(basename(f))) || re.test(basename(f)));
    }
    const bytes = sdDirectoryProgram(files, subdirs, Boolean(currentDir), spec.filter);
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
  if (mode === 15) {
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
  if (name.startsWith("$") || upper.includes("$=")) {
    const sub = await subdirsInDir(currentPart);
    const files = await filesInDir(currentPart);
    openFiles.set(sa, {
      sa,
      name,
      data: sdDirectoryProgram(files, sub, Boolean(currentDir)),
      pos: 0,
      write: false,
      cmd: false,
    });
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
  ram[153] = deviceUnit;
  ram[184] = sa;
  ram[IEC_Y] = 2;
}

function handleListen(ram: Uint8Array) {
  const sa = ram[51204] || 0;
  if (!openFiles.has(sa)) {
    ram[IEC_Y] = 3;
    return;
  }
  ram[154] = deviceUnit;
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

/** True when KERNAL IEC trap stubs are installed at $C900 (JS path only). */
export function kernalIecTrapActive(emu: EjsLike): boolean {
  const ram = c64Ram(emu);
  if (!ram) return false;
  return (ram[816] | (ram[817] << 8)) === 51456;
}

const ISOPEN_CLOSED = 0;
const ISOPEN_AWAITING_NAME = 1;
const ISOPEN_OPEN = 2;

const SERIAL_NAMELENGTH = 255;
let wasmSerialPtr = 0;
const wasmSerialBuffer: number[] = [];
let wasmIecReadSt = 0;

type WasmChan = {
  isopen: number;
  nameBuf: number[];
  data: Uint8Array;
  pos: number;
};

const wasmDev = wasmDevEarly as Map<number, WasmChan[]>;

function wasmChannels(dev: number): WasmChan[] {
  let chans = wasmDev.get(dev);
  if (!chans) {
    chans = Array.from({ length: 16 }, () => ({
      isopen: ISOPEN_CLOSED,
      nameBuf: [],
      data: new Uint8Array(0),
      pos: 0,
    }));
    wasmDev.set(dev, chans);
  }
  return chans;
}

function wasmCh(dev: number, sec: number): WasmChan {
  return wasmChannels(dev)[sec & 0x0f];
}

function nameFromBuf(buf: number[]): string {
  let s = "";
  for (const b of buf) {
    if (b === 0) break;
    s += String.fromCharCode(b & 0xff);
  }
  return s.replace(/\0/g, "").trim();
}

function wasmOpenFileOnChannel(dev: number, sec: number, raw: string) {
  const ch = wasmCh(dev, sec);
  const upper = raw.toUpperCase();
  // DOS commands only arrive on channel 15; on 0-14 the name is a file name (INSIDE, NUVIE, …).
  if (sec === 15) {
    void runSdCommand(raw).then((st) => {
      ch.data = petsciiAscii(`${st}\r`);
      ch.pos = 0;
    });
    return;
  }
  if (upper.startsWith("$=P")) {
    void partitionCatalog().then((data) => {
      ch.data = data;
      ch.pos = 0;
    });
    return;
  }
  if (raw.startsWith("$") || upper.includes("$=") || raw === "") {
    const sub = syncSubdirsInDir(currentPart);
    const files = syncFilesInDir(currentPart);
    ch.data = sdDirectoryProgram(files, sub, Boolean(currentDir));
    ch.pos = 0;
    return;
  }
  const pattern = raw.replace(/^:/, "").replace(/[\r,].*$/, "");
  if (mountedD64()) {
    ch.data = mountedD64Prg(pattern) ?? new Uint8Array(0);
    ch.pos = 0;
    return;
  }
  const file = syncFindFile(currentPart, pattern);
  ch.data = file ? new Uint8Array(file.data) : new Uint8Array(0);
  ch.pos = 0;
}

export function resetGrok64WasmIecBus() {
  wasmDev.clear();
  wasmSerialPtr = 0;
  wasmSerialBuffer.length = 0;
}

/** QA: open `$` on WASM IEC (same bytes KERNAL reads during LOAD"$"). */
export function iecOpenDollarChannel(emu: EjsLike | null, unit: IecDeviceNumber = deviceUnit): number {
  if (!emu?.Module) return 0;
  resetGrok64WasmIecBus();
  const mod = emu.Module as Grok64ModuleBag;
  const bound = grok64WasmApi(mod)?.sd2iecAttach;
  if (bound) bound(unit);
  else resolveWasmExport(mod, "grok64_sd2iec_attach")?.(unit);
  wasmOpenFileOnChannel(unit, 0, "$");
  return wasmCh(unit, 0).data.length;
}

/** Test / QA: WASM IEC channel state (VICE fsdrive mirror). */
export function debugWasmIec(dev: number, sec: number) {
  const ch = wasmCh(dev, sec);
  return {
    isopen: ch.isopen,
    nameLen: ch.nameBuf.length,
    dataLen: ch.data.length,
    pos: ch.pos,
    head: ch.data.length ? Array.from(ch.data.subarray(0, Math.min(24, ch.data.length))) : [],
  };
}

function wasmNameFromSerial(): string {
  const buf = wasmSerialPtr > 0 ? wasmSerialBuffer.slice(0, wasmSerialPtr) : [];
  wasmSerialPtr = 0;
  wasmSerialBuffer.length = 0;
  return nameFromBuf(buf.length ? buf : []);
}

/** Mirrors VICE `fsdrive.c` `serialcommand()` (IECDevice path). */
function wasmSerialCommand(dev: number, secondary: number) {
  const chNum = secondary & 0x0f;
  const hi = secondary & 0xf0;
  const ch = wasmCh(dev, chNum);
  if (hi !== 0x60) {
    /* fsdrive resets read-ahead on non-0x60 attention commands */
  }
  switch (hi) {
    case 0x20:
    case 0x30:
    case 0x40:
    case 0x50:
      break;
    case 0x60:
      if (ch.isopen === ISOPEN_AWAITING_NAME) {
        ch.isopen = ISOPEN_OPEN;
        const fromGlobal = wasmNameFromSerial();
        const raw = fromGlobal || nameFromBuf(ch.nameBuf);
        ch.nameBuf = [];
        wasmOpenFileOnChannel(dev, chNum, raw);
      }
      break;
    case 0xe0:
      ch.isopen = ISOPEN_CLOSED;
      ch.nameBuf = [];
      ch.pos = 0;
      ch.data = new Uint8Array(0);
      break;
    case 0xf0:
      if (ch.isopen !== ISOPEN_CLOSED) {
        if (wasmSerialPtr > 0 || ch.nameBuf.length > 0 || chNum === 0x0f) {
          if (ch.isopen === ISOPEN_OPEN) {
            ch.pos = 0;
            ch.data = new Uint8Array(0);
          }
          const fromGlobal = wasmNameFromSerial();
          const raw = fromGlobal || nameFromBuf(ch.nameBuf);
          ch.nameBuf = [];
          wasmOpenFileOnChannel(dev, chNum, raw);
        }
        ch.isopen = ISOPEN_OPEN;
      }
      break;
    default:
      break;
  }
}

/** Host callbacks for VICE grok64_sd2iec (serial-iec-bus → fsdrive-equivalent). */
export const grok64WasmIecHost = {
  iecOpen(dev: number, sec: number) {
    const ch = wasmCh(dev, sec & 0x0f);
    ch.isopen = ISOPEN_AWAITING_NAME;
    ch.nameBuf = [];
    ch.pos = 0;
    ch.data = new Uint8Array(0);
  },
  iecClose(dev: number, sec: number) {
    wasmSerialCommand(dev, (sec & 0xf0) === 0xe0 ? sec : (sec & 0x0f) | 0xe0);
  },
  iecListenTalk(dev: number, sec: number) {
    wasmSerialCommand(dev, sec);
  },
  iecUnlisten(dev: number, sec: number) {
    const chNum = sec & 0x0f;
    const hi = sec & 0xf0;
    if (hi === 0xf0 || chNum === 0x0f) {
      wasmSerialCommand(dev, sec);
    }
  },
  iecUntalk(_dev: number, _sec: number) {},
  iecWrite(dev: number, sec: number, data: number) {
    const ch = wasmCh(dev, sec & 0x0f);
    if (ch.isopen === ISOPEN_AWAITING_NAME) {
      if (wasmSerialPtr < SERIAL_NAMELENGTH) {
        wasmSerialBuffer[wasmSerialPtr++] = data & 0xff;
      }
      if (ch.nameBuf.length < SERIAL_NAMELENGTH) ch.nameBuf.push(data & 0xff);
      return;
    }
    if (ch.isopen === ISOPEN_OPEN && (sec & 0x0f) === 15) {
      const c = String.fromCharCode(data & 0xff);
      if (c !== "\r") ch.nameBuf.push(data & 0xff);
      else {
        void runSdCommand(nameFromBuf(ch.nameBuf)).then((st) => {
          ch.data = petsciiAscii(`${st}\r`);
          ch.pos = 0;
        });
        ch.nameBuf = [];
      }
    }
  },
  /**
   * VICE `vdrive_iec_read` status: EOF ($40) travels with the last byte, so the bus device sends it
   * with EOI; nothing to send (file not found) is $42, after which the device stops talking.
   */
  iecRead(dev: number, sec: number): number {
    const ch = wasmCh(dev, sec & 0x0f);
    if (ch.pos >= ch.data.length) {
      wasmIecReadSt = 0x42;
      return 0xc7;
    }
    const b = ch.data[ch.pos++] ?? 0xc7;
    wasmIecReadSt = ch.pos >= ch.data.length ? 0x40 : 0;
    return b;
  },
  get iecReadSt() {
    return wasmIecReadSt;
  },
  iecSt(_dev: number, _st: number) {},
};

export {
  buildSd2iecD64,
  buildSd2iecVolume,
  estimateSd2iecBlocks,
  lastSd2iecVolume,
  type Sd2iecVolume,
} from "./sd2iec-volume";
