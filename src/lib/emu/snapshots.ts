import { openExpansionDb, STORES, txDone } from "./expansion-db";
import type { IecDrive, IecUnit, JoyPort, MachineId, ReuSize, ScpuSimm } from "./types";

export interface HardwareRecipe {
  machineId: MachineId;
  videoStandard: string;
  coreMode: string;
  driveMode: string;
  reuSize: ReuSize;
  iecDrive: IecDrive;
  iecUnit: IecUnit;
  mouseMode: boolean;
  scpuSimm: ScpuSimm;
  scpuTurbo: boolean;
  joyPort: JoyPort;
  jiffyDos: boolean;
}

export interface SnapshotRecord {
  id: string;
  kind: "hardware" | "memory";
  title: string;
  savedAt: number;
  recipe: HardwareRecipe;
  data: ArrayBuffer;
}

export function freezeSlot(n: number): string {
  return `freeze-${n}`;
}

export function recipeSummary(recipe: HardwareRecipe): string {
  return [
    recipe.machineId === "scpu" ? "SCPU" : "C64",
    recipe.reuSize === "none" ? "no REU" : `REU ${recipe.reuSize}`,
    recipe.iecDrive.toUpperCase(),
    recipe.iecUnit !== 8 ? `#${recipe.iecUnit}` : null,
    recipe.jiffyDos ? "Jiffy" : null,
    recipe.mouseMode ? "1351" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function listSnapshots(): Promise<Omit<SnapshotRecord, "data">[]> {
  const db = await openExpansionDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.snaps, "readonly").objectStore(STORES.snaps).getAll();
    req.onsuccess = () => {
      const rows = (req.result as SnapshotRecord[]).map(({ data: _d, ...meta }) => meta);
      rows.sort((a, b) => b.savedAt - a.savedAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getSnapshot(id: string): Promise<SnapshotRecord | null> {
  const db = await openExpansionDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.snaps, "readonly").objectStore(STORES.snaps).get(id);
    req.onsuccess = () => resolve((req.result as SnapshotRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putSnapshot(row: SnapshotRecord): Promise<void> {
  const db = await openExpansionDb();
  const tx = db.transaction(STORES.snaps, "readwrite");
  tx.objectStore(STORES.snaps).put(row);
  await txDone(tx);
}

export async function deleteSnapshot(id: string): Promise<void> {
  const db = await openExpansionDb();
  const tx = db.transaction(STORES.snaps, "readwrite");
  tx.objectStore(STORES.snaps).delete(id);
  await txDone(tx);
}
