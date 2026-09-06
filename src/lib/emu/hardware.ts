import type { CorePref, DriveMode, JoyPort, MachineId, VideoPref } from "./types";
import type { IecDrive, IecUnit, ReuSize, ScpuSimm } from "./expand";
import { openGrok64Db, ROMS, SDPART, SNAPS } from "./library";

export type RomSlotId = "jiffy-c64" | "jiffy-1541" | "jiffy-1571" | "jiffy-1581" | "cmdhd";

export const ROM_SLOTS: { id: RomSlotId; label: string; hint: string; files: string[] }[] = [
  {
    id: "jiffy-c64",
    label: "JiffyDOS C64",
    hint: "KERNAL replacement · JiffyDOS_C64.bin",
    files: ["JiffyDOS_C64.bin"],
  },
  {
    id: "jiffy-1541",
    label: "JiffyDOS 1541",
    hint: "1541-II DOS · JiffyDOS_1541-II.bin",
    files: ["JiffyDOS_1541-II.bin"],
  },
  {
    id: "jiffy-1571",
    label: "JiffyDOS 1571",
    hint: "Optional",
    files: ["JiffyDOS_1571.bin", "JiffyDOS_1571_repl310654.bin"],
  },
  {
    id: "jiffy-1581",
    label: "JiffyDOS 1581",
    hint: "Optional · .d81",
    files: ["JiffyDOS_1581.bin"],
  },
  {
    id: "cmdhd",
    label: "CMD HD Boot 2.80",
    hint: "Your go4retro image, stored as dosCMDHD.bin",
    files: ["dosCMDHD.bin", "cmdhd.bin", "hdd-dos-2.80.bin"],
  },
];

export interface RomRecord {
  id: RomSlotId;
  name: string;
  size: number;
  addedAt: number;
  data: ArrayBuffer;
}

export interface HardwareRecipe {
  machineId: MachineId;
  videoStandard: VideoPref;
  coreMode: CorePref;
  driveMode: DriveMode;
  reuSize: ReuSize;
  iecDrive: IecDrive;
  iecUnit: IecUnit;
  mouseMode: boolean;
  scpuSimm: ScpuSimm;
  scpuTurbo: boolean;
  joyPort: JoyPort;
  jiffyDos: boolean;
}

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

export type SnapKind = "hardware" | "memory";

export interface SnapRecord {
  id: string;
  kind: SnapKind;
  title: string;
  savedAt: number;
  recipe: HardwareRecipe;
  data: ArrayBuffer;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listRoms(): Promise<Omit<RomRecord, "data">[]> {
  const db = await openGrok64Db();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ROMS, "readonly").objectStore(ROMS).getAll();
    req.onsuccess = () => {
      resolve((req.result as RomRecord[]).map(({ data: _d, ...m }) => m));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getRom(id: RomSlotId): Promise<RomRecord | null> {
  const db = await openGrok64Db();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ROMS, "readonly").objectStore(ROMS).get(id);
    req.onsuccess = () => resolve((req.result as RomRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putRom(id: RomSlotId, name: string, data: ArrayBuffer): Promise<void> {
  const row: RomRecord = { id, name, size: data.byteLength, addedAt: Date.now(), data };
  const db = await openGrok64Db();
  const tx = db.transaction(ROMS, "readwrite");
  tx.objectStore(ROMS).put(row);
  await txDone(tx);
}

export async function deleteRom(id: RomSlotId): Promise<void> {
  const db = await openGrok64Db();
  const tx = db.transaction(ROMS, "readwrite");
  tx.objectStore(ROMS).delete(id);
  await txDone(tx);
}

export async function loadRomMap(): Promise<Record<string, Uint8Array>> {
  const db = await openGrok64Db();
  return new Promise((resolve, reject) => {
    const req = db.transaction(ROMS, "readonly").objectStore(ROMS).getAll();
    req.onsuccess = () => {
      const out: Record<string, Uint8Array> = {};
      for (const row of req.result as RomRecord[]) {
        const slot = ROM_SLOTS.find((s) => s.id === row.id);
        const u8 = new Uint8Array(row.data);
        for (const name of slot?.files ?? [row.name]) out[name] = u8;
      }
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function hasJiffyPair(): Promise<boolean> {
  const [c64, d1541] = await Promise.all([getRom("jiffy-c64"), getRom("jiffy-1541")]);
  return Boolean(c64 && d1541);
}

const HOST_ROMS: { id: RomSlotId; urls: string[] }[] = [
  { id: "jiffy-c64", urls: ["/system/vice/JiffyDOS_C64.bin", "/system/vice/JiffyDOS_C64_6.01.bin"] },
  { id: "jiffy-1541", urls: ["/system/vice/JiffyDOS_1541-II.bin"] },
  { id: "jiffy-1571", urls: ["/system/vice/JiffyDOS_1571.bin", "/system/vice/JiffyDOS_1571_repl310654.bin"] },
  { id: "jiffy-1581", urls: ["/system/vice/JiffyDOS_1581.bin"] },
  { id: "cmdhd", urls: ["/system/vice/dosCMDHD.bin", "/system/vice/cmdhd.bin"] },
];

export async function seedRomsFromHost(): Promise<RomSlotId[]> {
  const have = new Set((await listRoms()).map((r) => r.id));
  const added: RomSlotId[] = [];
  for (const job of HOST_ROMS) {
    if (have.has(job.id)) continue;
    for (const url of job.urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 4096) continue;
        await putRom(job.id, url.split("/").pop() || job.id, buf);
        added.push(job.id);
        break;
      } catch {
        /* missing on this host */
      }
    }
  }
  return added;
}

const DEFAULT_PARTS: SdPartition[] = [0, 1, 2, 3].map((id) => ({
  id,
  label: `PART${id}`,
  files: [],
}));

export async function loadSdCard(): Promise<SdPartition[]> {
  const db = await openGrok64Db();
  return new Promise((resolve, reject) => {
    const req = db.transaction(SDPART, "readonly").objectStore(SDPART).getAll();
    req.onsuccess = () => {
      const rows = (req.result as SdPartition[]) ?? [];
      const byId = new Map(rows.map((p) => [p.id, p]));
      resolve(DEFAULT_PARTS.map((d) => byId.get(d.id) ?? d));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function savePartition(part: SdPartition): Promise<void> {
  const db = await openGrok64Db();
  const tx = db.transaction(SDPART, "readwrite");
  tx.objectStore(SDPART).put(part);
  await txDone(tx);
}

export async function addSdFile(partId: number, name: string, data: ArrayBuffer, path = ""): Promise<void> {
  const parts = await loadSdCard();
  const part = parts.find((p) => p.id === partId) ?? { id: partId, label: `PART${partId}`, files: [] };
  part.files = [...part.files, { id: crypto.randomUUID(), name, size: data.byteLength, data, path }];
  await savePartition(part);
}

export async function removeSdFile(partId: number, fileId: string): Promise<void> {
  const parts = await loadSdCard();
  const part = parts.find((p) => p.id === partId);
  if (!part) return;
  part.files = part.files.filter((f) => f.id !== fileId);
  await savePartition(part);
}

export async function formatPartition(partId: number): Promise<void> {
  await savePartition({ id: partId, label: `PART${partId}`, files: [] });
}

export function cbmName(name: string): string {
  const base = (name.split(/[/\\]/).pop() || name).replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[^A-Za-z0-9._+-]/g, "").toUpperCase().slice(0, 16);
  return cleaned || "FILE";
}

export async function listSnaps(): Promise<Omit<SnapRecord, "data">[]> {
  const db = await openGrok64Db();
  return new Promise((resolve, reject) => {
    const req = db.transaction(SNAPS, "readonly").objectStore(SNAPS).getAll();
    req.onsuccess = () => {
      const rows = (req.result as SnapRecord[]).map(({ data: _d, ...m }) => m);
      rows.sort((a, b) => b.savedAt - a.savedAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getSnap(id: string): Promise<SnapRecord | null> {
  const db = await openGrok64Db();
  return new Promise((resolve, reject) => {
    const req = db.transaction(SNAPS, "readonly").objectStore(SNAPS).get(id);
    req.onsuccess = () => resolve((req.result as SnapRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putSnap(row: SnapRecord): Promise<void> {
  const db = await openGrok64Db();
  const tx = db.transaction(SNAPS, "readwrite");
  tx.objectStore(SNAPS).put(row);
  await txDone(tx);
}

export async function deleteSnap(id: string): Promise<void> {
  const db = await openGrok64Db();
  const tx = db.transaction(SNAPS, "readwrite");
  tx.objectStore(SNAPS).delete(id);
  await txDone(tx);
}

export function freezeSlotId(n: 1 | 2 | 3 | 4): string {
  return `freeze-${n}`;
}

export function recipeLine(r: HardwareRecipe): string {
  const bits = [
    r.machineId === "scpu" ? "SCPU" : "C64",
    r.reuSize === "none" ? "no REU" : `REU ${r.reuSize}`,
    r.iecDrive.toUpperCase(),
    r.iecUnit && r.iecUnit !== 8 ? `#${r.iecUnit}` : null,
    r.jiffyDos ? "Jiffy" : null,
    r.mouseMode ? "1351" : null,
  ].filter(Boolean);
  return bits.join(" \u00b7 ");
}
