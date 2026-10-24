/**
 * Direct VICE file_system_* disk attach (Grok64 WASM exports).
 * Option flips + MEMFS writes do not replace an image already open on unit 8.
 */
import { glog } from "./debug";
import type { IecUnit } from "./types";
import { isGcrDiskKind, kindOf } from "./formats";

type EmuFs = { stat?: (p: string) => unknown };

function fsOf(emu: ViceDiskEmu | null): EmuFs | null {
  const e = emu as { Module?: { FS?: EmuFs }; gameManager?: { FS?: EmuFs } } | null;
  return e?.Module?.FS ?? e?.gameManager?.FS ?? null;
}

function diskMod(emu: ViceDiskEmu | null): DiskModule | null {
  const e = emu as { Module?: DiskModule & { UTF8ToString?: (ptr: number) => string } } | null;
  const mod = e?.Module ?? null;
  if (mod && !mod.UTF8ToString) {
    const m = mod as DiskModule & { UTF8ToString?: (ptr: number) => string };
    m.UTF8ToString =
      m.UTF8ToString ??
      ((mod as { UTF8ToString?: (ptr: number) => string }).UTF8ToString ??
        (globalThis as { UTF8ToString?: (ptr: number) => string }).UTF8ToString);
  }
  return mod;
}

type DiskModule = {
  _grok64_disk_attach?: (unit: number, drive: number, path: string) => number;
  _grok64_disk_attach_deferred?: (unit: number, drive: number, path: string) => number;
  _grok64_sd2iec_poll?: () => void;
  _grok64_disk_detach?: (unit: number, drive: number) => void;
  _grok64_disk_get_name?: (unit: number, drive: number) => number;
  _grok64_retro_save_directory?: () => number;
  _grok64_disk_last_attach_rc?: () => number;
  UTF8ToString?: (ptr: number) => string;
  cwrap?: (...args: unknown[]) => unknown;
};

/** Loosely typed emu handle — avoids a host.ts import cycle. */
export type ViceDiskEmu = unknown;

const WORK_DISK_PATHS = [
  "/data/saves/vice_work.d64",
  "/home/web_user/retroarch/userdata/saves/vice_work.d64",
];

export type ViceDiskAttachRecord = {
  path: string;
  rc: number;
  before: string | null;
  after: string | null;
  at: number;
};

const lastAttachByUnit = new Map<number, ViceDiskAttachRecord>();

export function lastViceDiskAttach(unit: IecUnit = 8): ViceDiskAttachRecord | null {
  return lastAttachByUnit.get(unit) ?? null;
}

export function recordViceLastAttach(unit: IecUnit, record: ViceDiskAttachRecord): void {
  lastAttachByUnit.set(unit, record);
}

export function grok64DiskExportsReady(emu: ViceDiskEmu | null): boolean {
  const mod = diskMod(emu);
  if (!mod) return false;
  if (!mod._grok64_disk_attach) bindGrok64DiskExports(mod);
  return typeof mod._grok64_disk_attach === "function";
}

let bindingDiskExports = false;

export function bindGrok64DiskExports(mod: DiskModule): void {
  if (bindingDiskExports) return;
  const wrap = mod.cwrap;
  if (!wrap) return;
  bindingDiskExports = true;
  try {
    if (!mod._grok64_disk_attach) {
      mod._grok64_disk_attach = wrap("grok64_disk_attach", "number", ["number", "number", "string"]) as (
        unit: number,
        drive: number,
        path: string,
      ) => number;
    }
    if (!mod._grok64_disk_attach_deferred) {
      mod._grok64_disk_attach_deferred = wrap("grok64_disk_attach_deferred", "number", [
        "number",
        "number",
        "string",
      ]) as (unit: number, drive: number, path: string) => number;
    }
    if (!mod._grok64_sd2iec_poll) {
      mod._grok64_sd2iec_poll = wrap("grok64_sd2iec_poll", null, []) as () => void;
    }
    if (!mod._grok64_disk_detach) {
      mod._grok64_disk_detach = wrap("grok64_disk_detach", null, ["number", "number"]) as (
        unit: number,
        drive: number,
      ) => void;
    }
    // Always refresh: stale "string" cwrap from an older bundle causes attach/get_name recursion.
    mod._grok64_disk_get_name = wrap("grok64_disk_get_name", "number", ["number", "number"]) as (
      unit: number,
      drive: number,
    ) => number;
    if (!mod._grok64_retro_save_directory) {
      mod._grok64_retro_save_directory = wrap("grok64_retro_save_directory", "number", []) as () => number;
    }
    if (!mod._grok64_disk_last_attach_rc) {
      mod._grok64_disk_last_attach_rc = wrap("grok64_disk_last_attach_rc", "number", []) as () => number;
    }
  } catch {
    /* stock core */
  } finally {
    bindingDiskExports = false;
  }
}

function diskNameFromModule(
  mod: DiskModule & { UTF8ToString?: (ptr: number) => string },
  unit: number,
  drive: number,
): string | null {
  if (!mod._grok64_disk_get_name) return null;
  try {
    const ptr = mod._grok64_disk_get_name(unit, drive);
    if (!ptr) return null;
    const raw = mod.UTF8ToString ? mod.UTF8ToString(ptr) : "";
    const name = raw.trim();
    return name || null;
  } catch {
    return null;
  }
}

/** VICE's view of the image path on IEC unit N (file_system_get_disk_name). */
export function viceAttachedImage(emu: ViceDiskEmu | null, unit: IecUnit = 8, drive = 0): string | null {
  const mod = diskMod(emu) as DiskModule & { UTF8ToString?: (ptr: number) => string };
  if (!mod?._grok64_disk_get_name) return null;
  return diskNameFromModule(mod, unit, drive);
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

export function viceRetroSaveDirectory(emu: ViceDiskEmu | null): string | null {
  const mod = diskMod(emu) as DiskModule & { UTF8ToString?: (ptr: number) => string; cwrap?: (...a: unknown[]) => unknown };
  if (!mod) return null;
  if (!mod._grok64_retro_save_directory && mod.cwrap) bindGrok64DiskExports(mod);
  if (!mod._grok64_retro_save_directory) return null;
  try {
    const ptr = mod._grok64_retro_save_directory();
    const raw = mod.UTF8ToString && ptr ? mod.UTF8ToString(ptr) : "";
    const dir = raw.trim().replace(/\/$/, "");
    return dir || null;
  } catch {
    return null;
  }
}

/** Candidate MEMFS paths to try for file_system_attach_disk on `unit`. */
export function viceDiskAttachCandidates(
  emu: ViceDiskEmu | null,
  unit: IecUnit,
  fileName: string,
): string[] {
  const base = fileName.replace(/^\//, "");
  const kind = kindOf(base);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    const norm = p.startsWith("/") ? p : `/${p}`;
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  };

  const saveDir = viceRetroSaveDirectory(emu);
  if (saveDir) {
    push(`${saveDir}/vice_work.d64`);
  }

  if (isGcrDiskKind(kind)) {
    push(`/${base}`);
    push(base);
  } else {
    push(`/${base}`);
    if (!saveDir) {
      for (const p of WORK_DISK_PATHS) push(p);
    }
  }

  return out.filter((p) => pathExistsOnFs(emu, p));
}

/** Preferred MEMFS path for the current session floppy on `unit`. */
export function resolveViceDiskAttachPath(
  emu: ViceDiskEmu | null,
  unit: IecUnit,
  fileName: string,
): string | null {
  const candidates = viceDiskAttachCandidates(emu, unit, fileName);
  return candidates[0] ?? null;
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
  try {
    let rc = mod._grok64_disk_attach?.(unit, drive, path) ?? -1;
    if (rc < 0) {
      const attachRc = mod._grok64_disk_last_attach_rc?.();
      if (typeof attachRc === "number" && attachRc >= 0) rc = attachRc;
    }
    const after =
      rc === 0 ? diskNameFromModule(mod as DiskModule & { UTF8ToString?: (p: number) => string }, unit, drive) : null;
    lastAttachByUnit.set(unit, { path, rc, before: null, after, at: Date.now() });
    glog("vice-disk-reattach", { unit, path, rc, after, sync: true });
    return rc;
  } catch (e) {
    const stack =
      e instanceof Error && e.stack
        ? e.stack.split("\n").slice(0, 30).join("\n")
        : undefined;
    glog("vice-disk-reattach-err", { unit, path, err: String(e), stack });
    if (e instanceof RangeError || (e instanceof Error && /call stack/i.test(e.message))) {
      throw e;
    }
    return -1;
  }
}
