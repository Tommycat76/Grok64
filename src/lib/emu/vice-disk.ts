/**
 * Direct VICE file_system_* disk attach (Grok64 WASM exports).
 * Option flips + MEMFS writes do not replace an image already open on unit 8.
 */
import { glog } from "./debug";
import type { IecUnit } from "./types";
import { isGcrDiskKind, kindOf } from "./formats";
import {
  grok64DiskApi,
  grok64WorkDiskRefreshExportReady,
  type Grok64ModuleBag,
} from "./grok64-api";
import {
  grok64PristineCwrap,
  type Grok64WasmModule,
  isGrok64DiskExportsBound,
  markGrok64DiskExportsBound,
} from "./grok64-wasm-bind";

type EmuFs = { stat?: (p: string) => unknown };

function fsOf(emu: ViceDiskEmu | null): EmuFs | null {
  const e = emu as { Module?: { FS?: EmuFs }; gameManager?: { FS?: EmuFs } } | null;
  return e?.Module?.FS ?? e?.gameManager?.FS ?? null;
}

function diskMod(emu: ViceDiskEmu | null): Grok64ModuleBag | null {
  const e = emu as { Module?: Grok64ModuleBag & { UTF8ToString?: (ptr: number) => string } } | null;
  const mod = e?.Module ?? null;
  if (mod && !mod.UTF8ToString) {
    const m = mod as Grok64ModuleBag & { UTF8ToString?: (ptr: number) => string };
    m.UTF8ToString =
      m.UTF8ToString ??
      ((mod as { UTF8ToString?: (ptr: number) => string }).UTF8ToString ??
        (globalThis as { UTF8ToString?: (ptr: number) => string }).UTF8ToString);
  }
  return mod;
}

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

export function bindGrok64DiskExports(mod: Grok64ModuleBag): void {
  if (isGrok64DiskExportsBound(mod)) return;
  const wrap = grok64PristineCwrap(mod as Grok64WasmModule);
  if (!wrap) return;
  try {
    if (!mod.grok64DiskApi) {
      mod.grok64DiskApi = {
        diskAttach: wrap("grok64_disk_attach", "number", ["number", "number", "string"]) as (
          unit: number,
          drive: number,
          path: string,
        ) => number,
        diskAttachDeferred: wrap("grok64_disk_attach_deferred", "number", [
          "number",
          "number",
          "string",
        ]) as (unit: number, drive: number, path: string) => number,
        sd2iecPoll: wrap("grok64_sd2iec_poll", null, []) as () => void,
        diskDetach: wrap("grok64_disk_detach", null, ["number", "number"]) as (
          unit: number,
          drive: number,
        ) => void,
        diskGetName: wrap("grok64_disk_get_name", "number", ["number", "number"]) as (
          unit: number,
          drive: number,
        ) => number,
        retroSaveDirectory: wrap("grok64_retro_save_directory", "number", []) as () => number,
        diskLastAttachRc: wrap("grok64_disk_last_attach_rc", "number", []) as () => number,
        workDiskRefresh: wrap("grok64_work_disk_refresh", "number", ["number"]) as (unit: number) => number,
        diskLastAttachDiag: wrap("grok64_disk_last_attach_diag", "number", []) as () => number,
        fsStatBytes: wrap("grok64_fs_stat_bytes", "number", ["string"]) as (path: string) => number,
      };
    }
    markGrok64DiskExportsBound(mod);
  } catch {
    /* stock core */
  }
}

export function grok64DiskExportsReady(emu: ViceDiskEmu | null): boolean {
  const mod = diskMod(emu);
  if (!mod) return false;
  if (!grok64DiskApi(mod)) bindGrok64DiskExports(mod);
  return typeof grok64DiskApi(mod)?.diskAttach === "function";
}

export { grok64WorkDiskRefreshExportReady };

function diskNameFromModule(
  mod: Grok64ModuleBag & { UTF8ToString?: (ptr: number) => string },
  unit: number,
  drive: number,
): string | null {
  const api = grok64DiskApi(mod);
  if (!api?.diskGetName) return null;
  try {
    const ptr = api.diskGetName(unit, drive);
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
  const mod = diskMod(emu);
  if (!mod || !grok64DiskApi(mod)?.diskGetName) return null;
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

function pathByteLength(emu: ViceDiskEmu | null, path: string): number | null {
  const FS = fsOf(emu) as { readFile?: (p: string) => Uint8Array | string } | null;
  if (!FS?.readFile) return null;
  try {
    const raw = FS.readFile(path);
    if (raw instanceof Uint8Array) return raw.byteLength;
    if (typeof raw === "string") return raw.length;
  } catch {
    /* */
  }
  return null;
}

export function viceDiskLastAttachDiag(emu: ViceDiskEmu | null): string | null {
  const mod = diskMod(emu);
  if (!mod) return null;
  if (!grok64DiskApi(mod)?.diskLastAttachDiag && mod.cwrap) bindGrok64DiskExports(mod);
  const diag = grok64DiskApi(mod)?.diskLastAttachDiag;
  if (!diag) return null;
  try {
    const ptr = diag();
    if (!ptr) return null;
    const raw = mod.UTF8ToString ? mod.UTF8ToString(ptr) : "";
    return raw.trim() || null;
  } catch {
    return null;
  }
}

/** WASM-side stat of MEMFS path (bytes, or negative errno). */
export function viceWasmFsStatBytes(emu: ViceDiskEmu | null, path: string): number | null {
  const mod = diskMod(emu);
  if (!mod || !path?.trim()) return null;
  if (!grok64DiskApi(mod)?.fsStatBytes && mod.cwrap) bindGrok64DiskExports(mod);
  const stat = grok64DiskApi(mod)?.fsStatBytes;
  if (!stat) return null;
  try {
    return stat(path);
  } catch {
    return null;
  }
}

export function viceRetroSaveDirectory(emu: ViceDiskEmu | null): string | null {
  const mod = diskMod(emu);
  if (!mod) return null;
  if (!grok64DiskApi(mod)?.retroSaveDirectory && mod.cwrap) bindGrok64DiskExports(mod);
  const dirFn = grok64DiskApi(mod)?.retroSaveDirectory;
  if (!dirFn) return null;
  try {
    const ptr = dirFn();
    const raw = mod.UTF8ToString && ptr ? mod.UTF8ToString(ptr) : "";
    const dir = raw.trim().replace(/\/$/, "");
    return dir || null;
  } catch {
    return null;
  }
}

/** Candidate MEMFS paths to try for file_system_attach_disk on `unit`. */
export function probeViceAttachPaths(
  emu: ViceDiskEmu | null,
  unit: IecUnit,
  fileName: string,
): { path: string; jsFsBytes: number | null; wasmFsStat: number | null }[] {
  return viceDiskAttachCandidates(emu, unit, fileName).map((path) => ({
    path,
    jsFsBytes: pathByteLength(emu, path),
    wasmFsStat: viceWasmFsStatBytes(emu, path),
  }));
}

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
    push("/data/saves/vice_work.d64");
    if (saveDir) push(`${saveDir}/vice_work.d64`);
    push(`/${base}`);
    push(base);
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
/** Re-attach `vice_work.d64` under retro_save_directory (custom core export). */
export function refreshViceWorkDiskAttached(emu: ViceDiskEmu | null, unit: IecUnit = 8): number {
  if (!grok64DiskExportsReady(emu)) return -99;
  const mod = diskMod(emu)!;
  const api = grok64DiskApi(mod);
  if (!api?.workDiskRefresh) return -99;
  try {
    const rc = api.workDiskRefresh(unit);
    const attachRc = api.diskLastAttachRc?.();
    const out = rc >= 0 ? rc : typeof attachRc === "number" && attachRc >= 0 ? attachRc : rc;
    const after =
      out === 0
        ? diskNameFromModule(mod, unit, 0)
        : null;
    lastAttachByUnit.set(unit, {
      path: `${viceRetroSaveDirectory(emu) ?? "/data/saves"}/vice_work.d64`,
      rc: out,
      before: null,
      after,
      at: Date.now(),
    });
    glog("vice-work-disk-refresh", { unit, rc: out, after });
    return out;
  } catch (e) {
    glog("vice-work-disk-refresh-err", { unit, err: String(e) });
    return -1;
  }
}

export function viceReattachDisk(
  emu: ViceDiskEmu | null,
  unit: IecUnit,
  path: string,
  drive = 0,
): number {
  if (!path?.trim()) return -1;
  if (!grok64DiskExportsReady(emu)) return -99;
  const mod = diskMod(emu)!;
  const api = grok64DiskApi(mod);
  if (!api?.diskAttach) return -99;
  try {
    let rc = api.diskAttach(unit, drive, path) ?? -1;
    const attachRc = api.diskLastAttachRc?.();
    if (rc < 0 && typeof attachRc === "number" && attachRc >= 0) rc = attachRc;
    const after = rc === 0 ? diskNameFromModule(mod, unit, drive) : null;
    lastAttachByUnit.set(unit, { path, rc, before: null, after, at: Date.now() });
    const jsSize = pathExistsOnFs(emu, path) ? pathByteLength(emu, path) : null;
    const wasmStat = viceWasmFsStatBytes(emu, path);
    glog("vice-disk-reattach", {
      unit,
      path,
      rc,
      after,
      attachRc: api.diskLastAttachRc?.(),
      diag: viceDiskLastAttachDiag(emu),
      jsFsBytes: jsSize,
      wasmFsStat: wasmStat,
    });
    return rc;
  } catch (e) {
    const stack =
      e instanceof Error && e.stack
        ? e.stack.split("\n").slice(0, 40).join("\n")
        : undefined;
    glog("vice-disk-reattach-err", { unit, path, err: String(e), stack });
    if (e instanceof RangeError || (e instanceof Error && /call stack/i.test(e.message))) {
      throw e;
    }
    return -1;
  }
}
