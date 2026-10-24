/**
 * Direct VICE file_system_* disk attach (Grok64 WASM exports).
 * Option flips + MEMFS writes do not replace an image already open on unit 8.
 */
import { bindGrok64WasmExports } from "./grok64-vice-bridge";
import { glog } from "./debug";
import type { IecUnit } from "./types";
import { isGcrDiskKind, kindOf } from "./formats";

type EmuFs = { stat?: (p: string) => unknown };

function fsOf(emu: ViceDiskEmu | null): EmuFs | null {
  const e = emu as { Module?: { FS?: EmuFs }; gameManager?: { FS?: EmuFs } } | null;
  return e?.Module?.FS ?? e?.gameManager?.FS ?? null;
}

function diskMod(emu: ViceDiskEmu | null): DiskModule | null {
  const e = emu as { Module?: DiskModule } | null;
  return e?.Module ?? null;
}

type DiskModule = {
  _grok64_disk_attach?: (unit: number, drive: number, path: string) => number;
  _grok64_disk_detach?: (unit: number, drive: number) => void;
  _grok64_disk_get_name?: (unit: number, drive: number) => string;
  cwrap?: (...args: unknown[]) => unknown;
};

/** Loosely typed emu handle — avoids a host.ts import cycle. */
export type ViceDiskEmu = unknown;

const WORK_DISK_PATHS = [
  "/data/saves/vice_work.d64",
  "/home/web_user/retroarch/userdata/saves/vice_work.d64",
];

export function grok64DiskExportsReady(emu: ViceDiskEmu | null): boolean {
  const mod = diskMod(emu);
  if (!mod) return false;
  bindGrok64WasmExports(mod as Parameters<typeof bindGrok64WasmExports>[0]);
  bindGrok64DiskExports(mod);
  return typeof mod._grok64_disk_attach === "function" && typeof mod._grok64_disk_get_name === "function";
}

export function bindGrok64DiskExports(mod: DiskModule): void {
  const wrap = mod.cwrap;
  if (!wrap) return;
  try {
    if (!mod._grok64_disk_attach) {
      mod._grok64_disk_attach = wrap("grok64_disk_attach", "number", ["number", "number", "string"]) as (
        unit: number,
        drive: number,
        path: string,
      ) => number;
    }
    if (!mod._grok64_disk_detach) {
      mod._grok64_disk_detach = wrap("grok64_disk_detach", null, ["number", "number"]) as (
        unit: number,
        drive: number,
      ) => void;
    }
    if (!mod._grok64_disk_get_name) {
      mod._grok64_disk_get_name = wrap("grok64_disk_get_name", "string", ["number", "number"]) as (
        unit: number,
        drive: number,
      ) => string;
    }
  } catch {
    /* stock core */
  }
}

/** VICE's view of the image path on IEC unit N (file_system_get_disk_name). */
export function viceAttachedImage(emu: ViceDiskEmu | null, unit: IecUnit = 8, drive = 0): string | null {
  if (!grok64DiskExportsReady(emu)) return null;
  const mod = diskMod(emu)!;
  try {
    const name = mod._grok64_disk_get_name?.(unit, drive) ?? "";
    return name.trim() ? name : null;
  } catch {
    return null;
  }
}

function pathExistsOnFs(emu: ViceDiskEmu | null, path: string): boolean {
  const FS = fsOf(emu);
  if (!FS?.stat) return false;
  try {
    FS.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** MEMFS path VICE should open for the current session floppy on `unit`. */
export function resolveViceDiskAttachPath(
  emu: ViceDiskEmu | null,
  unit: IecUnit,
  fileName: string,
): string | null {
  const base = fileName.replace(/^\//, "");
  const kind = kindOf(base);
  if (isGcrDiskKind(kind)) {
    for (const p of [`/${base}`, base, `//${base}`]) {
      if (pathExistsOnFs(emu, p.replace(/^\/\//, "/"))) return p.replace(/^\/\//, "/");
    }
    return `/${base}`;
  }
  for (const p of WORK_DISK_PATHS) {
    if (pathExistsOnFs(emu, p)) return p;
  }
  for (const p of [`/${base}`, base]) {
    if (pathExistsOnFs(emu, p)) return p.startsWith("/") ? p : `/${p}`;
  }
  return WORK_DISK_PATHS[0];
}

/**
 * Detach + attach on VICE unit 8 (drive 0). Returns attach rc (&lt;0 fail) or 0 ok; -99 if exports missing.
 */
export function viceReattachDisk(
  emu: ViceDiskEmu | null,
  unit: IecUnit,
  path: string,
  drive = 0,
): number {
  if (!path?.trim()) return -1;
  if (!grok64DiskExportsReady(emu)) return -99;
  const mod = diskMod(emu)!;
  const before = viceAttachedImage(emu, unit, drive);
  try {
    const rc = mod._grok64_disk_attach?.(unit, drive, path) ?? -1;
    const after = viceAttachedImage(emu, unit, drive);
    glog("vice-disk-reattach", { unit, path, rc, before, after });
    return rc;
  } catch (e) {
    glog("vice-disk-reattach-err", { unit, path, err: String(e) });
    return -1;
  }
}
