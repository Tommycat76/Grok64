import { openExpansionDb, STORES, txDone } from "./expansion-db";

export interface RomDef {
  id: string;
  label: string;
  hint: string;
  files: string[];
}

export interface StoredRom {
  id: string;
  name: string;
  size: number;
  addedAt: number;
  data: ArrayBuffer;
}

export const ROM_CATALOG: RomDef[] = [
  {
    id: "jiffy-c64",
    label: "JiffyDOS C64",
    hint: "KERNAL replacement · JiffyDOS_C64.bin",
    files: ["JiffyDOS_C64.bin", "JiffyDOS_C64_6.01.bin"],
  },
  {
    id: "jiffy-1541",
    label: "JiffyDOS 1541",
    hint: "1541-II DOS · JiffyDOS_1541-II.bin",
    files: [
      "JiffyDOS_1541-II.bin",
      "JiffyDOS_1541-II_6.00.bin",
      "JiffyDOS_1541-II_6.01.bin",
    ],
  },
  {
    id: "jiffy-1571",
    label: "JiffyDOS 1571",
    hint: "Optional",
    files: ["JiffyDOS_1571.bin", "JiffyDOS_1571_6.01_NTSC.bin", "JiffyDOS_1571_repl310654.bin"],
  },
  {
    id: "jiffy-1581",
    label: "JiffyDOS 1581",
    hint: "Optional · .d81",
    files: ["JiffyDOS_1581.bin", "JiffyDOS_1581_6.01.bin"],
  },
  {
    id: "cmdhd",
    label: "CMD HD Boot 2.80",
    hint: "Your go4retro image, stored as dosCMDHD.bin",
    files: ["dosCMDHD.bin", "cmdhd.bin", "hdd-dos-2.80.bin"],
  },
];

const ROM_FETCH: { id: string; urls: string[] }[] = [
  { id: "jiffy-c64", urls: ["/system/vice/JiffyDOS_C64.bin", "/system/vice/JiffyDOS_C64_6.01.bin"] },
  { id: "jiffy-1541", urls: ["/system/vice/JiffyDOS_1541-II.bin"] },
  { id: "jiffy-1571", urls: ["/system/vice/JiffyDOS_1571.bin", "/system/vice/JiffyDOS_1571_repl310654.bin"] },
  { id: "jiffy-1581", urls: ["/system/vice/JiffyDOS_1581.bin"] },
  { id: "cmdhd", urls: ["/system/vice/dosCMDHD.bin", "/system/vice/cmdhd.bin"] },
];

export async function listRoms(): Promise<Omit<StoredRom, "data">[]> {
  const db = await openExpansionDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.roms, "readonly").objectStore(STORES.roms).getAll();
    req.onsuccess = () => {
      const rows = (req.result as StoredRom[]).map(({ data: _d, ...meta }) => meta);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getRom(id: string): Promise<StoredRom | null> {
  const db = await openExpansionDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.roms, "readonly").objectStore(STORES.roms).get(id);
    req.onsuccess = () => resolve((req.result as StoredRom) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putRom(id: string, name: string, data: ArrayBuffer): Promise<void> {
  const row: StoredRom = { id, name, size: data.byteLength, addedAt: Date.now(), data };
  const db = await openExpansionDb();
  const tx = db.transaction(STORES.roms, "readwrite");
  tx.objectStore(STORES.roms).put(row);
  await txDone(tx);
}

export async function removeRom(id: string): Promise<void> {
  const db = await openExpansionDb();
  const tx = db.transaction(STORES.roms, "readwrite");
  tx.objectStore(STORES.roms).delete(id);
  await txDone(tx);
}

/** Map VICE system filenames → ROM bytes for injection at boot. */
export async function romFileMap(): Promise<Record<string, Uint8Array>> {
  const db = await openExpansionDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.roms, "readonly").objectStore(STORES.roms).getAll();
    req.onsuccess = () => {
      const out: Record<string, Uint8Array> = {};
      for (const row of req.result as StoredRom[]) {
        const def = ROM_CATALOG.find((d) => d.id === row.id);
        const bytes = new Uint8Array(row.data);
        out[row.name] = bytes;
        for (const fname of def?.files ?? [row.name]) {
          out[fname] = bytes;
        }
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

export function catalogFiles(id: string): string[] {
  return ROM_CATALOG.find((d) => d.id === id)?.files ?? [];
}

/** Map uploaded filename (incl. versioned JiffyDOS) to catalog ROM id. */
export function matchRomCatalogId(fileName: string, byteLength: number): string | null {
  const upper = fileName.toUpperCase();
  for (const def of ROM_CATALOG) {
    if (def.files.some((f) => f.toUpperCase() === upper)) return def.id;
  }
  if (byteLength < 4096) return null;
  if (/JIFFYDOS_C64|JIFFY.?DOS.?C64/i.test(upper)) return "jiffy-c64";
  if (/JIFFYDOS_1541|JIFFY.?DOS.?1541/i.test(upper)) return "jiffy-1541";
  if (/JIFFYDOS_1571|JIFFY.?DOS.?1571/i.test(upper)) return "jiffy-1571";
  if (/JIFFYDOS_1581|JIFFY.?DOS.?1581/i.test(upper)) return "jiffy-1581";
  if (/CMDHD|DOSCMDHD|HDD-DOS/i.test(upper)) return "cmdhd";
  return null;
}

function jiffyBytes(roms: Record<string, Uint8Array>, id: "jiffy-c64" | "jiffy-1541"): Uint8Array | null {
  for (const n of catalogFiles(id)) {
    const b = roms[n];
    if (b && b.byteLength >= 4096) return b;
  }
  const re = id === "jiffy-c64" ? /JIFFYDOS_C64|JIFFY.?DOS.?C64/i : /JIFFYDOS_1541|JIFFY.?DOS.?1541/i;
  for (const [name, b] of Object.entries(roms)) {
    if (b.byteLength >= 4096 && re.test(name)) return b;
  }
  return null;
}

/** Bytes in a romFileMap that are a usable Jiffy C64 + 1541 pair. */
export function romsHaveJiffyPair(roms: Record<string, Uint8Array>): boolean {
  return Boolean(jiffyBytes(roms, "jiffy-c64") && jiffyBytes(roms, "jiffy-1541"));
}

/** Reject uniform placeholder ROMs (QA synth) — enabling them as KERNAL bricks VICE. */
export function jiffyC64RomBootSafe(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.byteLength < 4096) return false;
  const slice = bytes.subarray(0, Math.min(bytes.byteLength, 2048));
  const uniq = new Set(slice);
  if (uniq.size < 6) return false;
  const text = new TextDecoder("latin1").decode(slice);
  if (/JIFFY|COPYRIGHT|MOS\s*TECHNOLOGY|COMMODORE/i.test(text)) return true;
  return uniq.size >= 32;
}

export function jiffyPairBootSafe(roms: Record<string, Uint8Array>): boolean {
  return jiffyC64RomBootSafe(jiffyBytes(roms, "jiffy-c64"));
}

/** VICE libretro expects canonical filenames under system/vice — always inject these. */
export function jiffyRomPayload(roms: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = { ...roms };
  const c64 = jiffyBytes(roms, "jiffy-c64");
  const d41 = jiffyBytes(roms, "jiffy-1541");
  const c64Name = catalogFiles("jiffy-c64")[0];
  const d41Name = catalogFiles("jiffy-1541")[0];
  if (c64 && c64Name) out[c64Name] = c64;
  if (d41 && d41Name) out[d41Name] = d41;
  return out;
}

export async function hasCmdRom(): Promise<boolean> {
  return Boolean(await getRom("cmdhd"));
}

/** Try fetching bundled ROM URLs when user hasn't uploaded yet. */
export async function prefetchBundledRoms(): Promise<string[]> {
  const have = new Set((await listRoms()).map((r) => r.id));
  const added: string[] = [];
  for (const entry of ROM_FETCH) {
    if (have.has(entry.id)) continue;
    for (const url of entry.urls) {
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (!res.ok) continue;
        const get = await fetch(url);
        if (!get.ok) continue;
        const buf = await get.arrayBuffer();
        if (buf.byteLength < 4096) continue;
        await putRom(entry.id, url.split("/").pop() || entry.id, buf);
        added.push(entry.id);
        break;
      } catch {
        /* optional */
      }
    }
  }
  return added;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
