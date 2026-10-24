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
  _grok64_disk_get_name?: (unit: number, drive: number) => string;
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
    if (!mod._grok64_disk_get_name) {
      mod._grok64_disk_get_name = wrap("grok64_disk_get_name", "string", ["number", "number"]) as (
        unit: number,
        drive: number,
      ) => string;
    }
    if (!mod._grok64_retro_save_directory) {
      mod._grok64_retro_save_directory = wrap("grok64_retro_save_directory", "number", []) as () => number;
    }
    if (!mod._grok64_disk_last_attach_rc) {
      mod._grok64_disk_last_attach_rc = wrap("grok64_disk_last_attach_rc", "number", []) as () => number;
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

export function viceRetroSaveDirectory(emu: ViceDiskEmu | null): string | null {
  if (!grok64DiskExportsReady(emu)) return null;
  const mod = diskMod(emu)!;
  if (!mod._grok64_retro_save_directory) return null;
  const ptr = mod._grok64_retro_save_directory();
  const raw = mod.UTF8ToString && ptr ? mod.UTF8ToString(ptr) : "";
  const dir = raw.trim().replace(/\/$/, "");
  return dir || null;
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
    for (const p of WORK_DISK_PATHS) push(p);
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
  const before = viceAttachedImage(emu, unit, drive);
  try {
    const defer = mod._grok64_disk_attach_deferred;
    const poll = mod._grok64_sd2iec_poll;
    let rc = -1;
    if (defer && poll) {
      rc = defer(unit, drive, path);
      for (let i = 0; i < 240 && rc === 0; i++) {
        poll();
      }
      const attachRc = mod._grok64_disk_last_attach_rc?.();
      rc = typeof attachRc === "number" && attachRc >= 0 ? attachRc : -1;
      if (rc < 0 && viceAttachedImage(emu, unit, drive)) {
        rc = 0;
      }
    } else {
      rc = mod._grok64_disk_attach?.(unit, drive, path) ?? -1;
    }
    const after = viceAttachedImage(emu, unit, drive);
    lastAttachByUnit.set(unit, { path, rc, before, after, at: Date.now() });
    glog("vice-disk-reattach", { unit, path, rc, before, after });
    return rc;
  } catch (e) {
    glog("vice-disk-reattach-err", { unit, path, err: String(e) });
    return -1;
  }
}
