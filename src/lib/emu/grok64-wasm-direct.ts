/**
 * Call Grok64 WASM exports without Emscripten cwrap/ccall (getCFunc → Module._name).
 * Resolves the raw function at call time from Module, asm, or wasmExports.
 */

import type { Grok64ModuleBag } from "./grok64-api";
import { grok64PristineCcall } from "./grok64-wasm-bind";

type WasmBag = Grok64ModuleBag & {
  asm?: Record<string, unknown>;
  wasmExports?: Record<string, unknown>;
  instance?: WebAssembly.Instance;
  stackSave?: () => number;
  stackRestore?: (sp: number) => void;
  stringToUTF8OnStack?: (str: string) => number;
  stringToUTF8?: (str: string, ptr: number, maxBytes: number) => void;
  lengthBytesUTF8?: (str: string) => number;
  _malloc?: (n: number) => number;
  malloc?: (n: number) => number;
  _free?: (ptr: number) => void;
  free?: (ptr: number) => void;
  HEAPU8?: Uint8Array;
  ccall?: (
    ident: string,
    returnType: string,
    argTypes: string[],
    args: unknown[],
  ) => unknown;
  allocateUTF8?: (str: string) => number;
  _allocateUTF8?: (str: string) => number;
};

type WasmFn = (...args: unknown[]) => unknown;

const EXPECTED_GROK64_EXPORTS = [
  "grok64_sd2iec_attach",
  "grok64_sd2iec_poll",
  "grok64_sd2iec_detach",
  "grok64_c64_read",
  "grok64_c64_write",
  "grok64_kbdbuf_feed",
  "grok64_kbdbuf_feed_runcmd",
  "grok64_kbdbuf_flush",
  "grok64_cartridge_trigger_freeze",
  "grok64_retro_keyboard",
  "grok64_main_cpu_clock",
  "grok64_disk_attach",
  "grok64_disk_attach_deferred",
  "grok64_disk_detach",
  "grok64_disk_get_name",
  "grok64_retro_save_directory",
  "grok64_disk_last_attach_rc",
  "grok64_work_disk_refresh",
  "grok64_disk_last_attach_diag",
  "grok64_fs_stat_bytes",
  "grok64_drive_image_bytes",
  "grok64_drive_bam_disk_name",
  "grok64_drive_last_error_code",
  "grok64_drive_error_channel",
  "grok64_drive_reload_image",
  "grok64_drive_iec_device",
  "grok64_drive_virtual_device",
  "grok64_drive_unit_true_emulation",
  "grok64_drive_unit_type",
  "grok64_drive_unit_enabled",
  "grok64_rom_loaded",
  "grok64_drive_serial_device_type",
  "grok64_drive_vdrive_error_is_virtual",
  "grok64_drive_tde_image_bytes",
  "grok64_drive_gcr_loaded",
  "grok64_drive_vdrive_image_same",
  "grok64_drive_sync_tde_image",
  "grok64_iec_bus_reconcile",
  "grok64_drive_filesystem_device",
  "grok64_drive_cpu_clock",
  "grok64_drive_iec_bus_lines",
  "grok64_load_dollar_diag_capture",
  "grok64_vice_apply_safe_floppy_profile",
  "grok64_vice_drive_resource_snapshot",
  "grok64_drive_set_type",
  "grok64_reu_attach",
  "grok64_reu_size_kb",
] as const;

function wasmUtf8JsonExport(
  mod: Grok64ModuleBag,
  exportName: string,
  ...args: unknown[]
): Record<string, unknown> {
  const fn = resolveWasmExport(mod, exportName);
  if (!fn) return { captureError: `missing wasm export ${exportName}` };
  let raw: unknown;
  try {
    raw = fn(...args);
  } catch (e) {
    return { captureError: String(e) };
  }
  const ptr = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!ptr) return { captureError: `empty pointer from ${exportName}` };
  const str = mod.UTF8ToString?.(ptr);
  if (!str) return { captureError: `UTF8 decode failed for ${exportName}` };
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return { raw: str };
  }
}

/** JS wrapper failed to marshal a UTF-8 path (distinct from C errno). */
export const GROK64_UTF8_MARSHAL_ERR = -98;

const diskBindEmu = new WeakMap<Grok64ModuleBag, unknown>();

function asFn(v: unknown): WasmFn | null {
  return typeof v === "function" ? (v as WasmFn) : null;
}

/** All Emscripten Module bags that may host Grok64 exports (EJS sometimes uses __ejs.Module). */
export function emuWasmModuleBags(emu: unknown): Grok64ModuleBag[] {
  const e = emu as {
    Module?: Grok64ModuleBag;
    gameManager?: { Module?: Grok64ModuleBag };
  } | null;
  const w =
    typeof window !== "undefined"
      ? (window as unknown as { __ejs?: { Module?: Grok64ModuleBag } }).__ejs
      : null;
  const out: Grok64ModuleBag[] = [];
  const push = (m: Grok64ModuleBag | null | undefined) => {
    if (m && !out.includes(m)) out.push(m);
  };
  push(e?.Module);
  push(e?.gameManager?.Module);
  push(w?.Module);
  return out;
}

/** Resolve a WASM export by logical name (no leading underscore). */
export function resolveWasmExport(mod: Grok64ModuleBag | null | undefined, baseName: string): WasmFn | null {
  if (!mod) return null;
  const m = mod as WasmBag & Record<string, unknown>;
  const names = [`_${baseName}`, baseName];
  for (const n of names) {
    const hit = asFn(m[n]);
    if (hit) return hit;
  }
  for (const bag of [m.wasmExports, m.asm, m.instance?.exports as Record<string, unknown> | undefined]) {
    if (!bag) continue;
    for (const n of names) {
      const hit = asFn(bag[n]);
      if (hit) return hit;
    }
  }
  return null;
}

function wasmRuntimeBags(emu: unknown, primary: Grok64ModuleBag | null): WasmBag[] {
  const seen = new Set<WasmBag>();
  const out: WasmBag[] = [];
  const push = (m: WasmBag | null | undefined) => {
    if (m && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  };
  push(primary as WasmBag);
  const e = emu as { Module?: WasmBag; gameManager?: { Module?: WasmBag; FS?: unknown } } | null;
  push(e?.Module);
  push(e?.gameManager?.Module);
  for (const m of emuWasmModuleBags(emu)) push(m as WasmBag);
  return out;
}

/** Merge heap + alloc helpers from every Module bag (EJS splits FS vs WASM heap). */
export function mergedWasmRuntime(emu: unknown, primary: Grok64ModuleBag | null): WasmBag {
  const bags = wasmRuntimeBags(emu, primary);
  const merged = { ...(bags[0] ?? {}) } as WasmBag;
  const keys = [
    "HEAPU8",
    "_malloc",
    "malloc",
    "_free",
    "free",
    "ccall",
    "allocateUTF8",
    "_allocateUTF8",
    "stringToUTF8",
    "lengthBytesUTF8",
    "stackSave",
    "stackRestore",
    "stringToUTF8OnStack",
  ] as const;
  for (const key of keys) {
    for (const b of bags) {
      const v = (b as WasmBag)[key];
      if (merged[key] == null && v != null) {
        (merged as Record<string, unknown>)[key] = v;
      }
    }
  }
  const mem = (merged as WasmBag & { wasmMemory?: WebAssembly.Memory }).wasmMemory;
  if (mem?.buffer && (!merged.HEAPU8 || merged.HEAPU8.buffer !== mem.buffer)) {
    merged.HEAPU8 = new Uint8Array(mem.buffer);
  }
  return merged;
}

function resolveAlloc(rt: WasmBag): { malloc: (n: number) => number; free: (ptr: number) => void } | null {
  const bags: Record<string, unknown>[] = [
    rt,
    rt.wasmExports,
    rt.asm,
    rt.instance?.exports as Record<string, unknown>,
  ].filter(Boolean) as Record<string, unknown>[];
  for (const bag of bags) {
    const malloc = asFn(bag._malloc) ?? asFn(bag.malloc);
    const free = asFn(bag._free) ?? asFn(bag.free);
    if (malloc && free) {
      return {
        malloc: (n) => Number(malloc(n)),
        free: (ptr) => {
          free(ptr);
        },
      };
    }
  }
  return null;
}

function tryCcallStringArg(rt: WasmBag, exportName: string, path: string): number | null {
  const ccall = grok64PristineCcall(rt) ?? rt.ccall;
  if (!ccall) return null;
  try {
    const out = ccall(exportName, "number", ["string"], [path]);
    if (typeof out === "number" && !Number.isNaN(out)) return out;
  } catch {
    /* fall through */
  }
  return null;
}

/** About/diag: can WASM stat see a MEMFS path (not GROK64_UTF8_MARSHAL_ERR). */
export function grok64Utf8PathMarshalProbe(
  emu: unknown,
  primary: Grok64ModuleBag | null,
  path: string,
): { bytes: number; marshalErr: boolean } {
  const mod = primary;
  if (!mod || !resolveWasmExport(mod, "grok64_fs_stat_bytes")) {
    return { bytes: GROK64_UTF8_MARSHAL_ERR, marshalErr: true };
  }
  const fn = resolveWasmExport(mod, "grok64_fs_stat_bytes")!;
  const rt = mergedWasmRuntime(emu, mod);
  const viaCcall = tryCcallStringArg(rt, "grok64_fs_stat_bytes", path);
  if (viaCcall != null) return { bytes: viaCcall, marshalErr: false };
  const bytes = withUtf8Arg(emu, mod, path, (ptr) => Number(fn(ptr)));
  return { bytes, marshalErr: bytes === GROK64_UTF8_MARSHAL_ERR };
}

export function withUtf8Arg(
  emu: unknown,
  primary: Grok64ModuleBag | null,
  str: string,
  run: (ptr: number) => number,
): number {
  const rt = mergedWasmRuntime(emu, primary);
  const allocUtf8 = rt.allocateUTF8 ?? rt._allocateUTF8;
  const freeFn = rt._free ?? rt.free;
  if (typeof allocUtf8 === "function" && typeof freeFn === "function") {
    const ptr = Number(allocUtf8(str));
    try {
      return run(ptr);
    } finally {
      freeFn(ptr);
    }
  }

  const stackSave = rt.stackSave;
  const stackRestore = rt.stackRestore;
  const stringToUTF8OnStack = rt.stringToUTF8OnStack;
  if (stackSave && stackRestore && stringToUTF8OnStack) {
    const sp = stackSave();
    try {
      const ptr = stringToUTF8OnStack(str);
      return run(ptr);
    } finally {
      stackRestore(sp);
    }
  }

  const stringToUTF8 = rt.stringToUTF8;
  const lengthBytesUTF8 = rt.lengthBytesUTF8;
  const alloc = resolveAlloc(rt);
  if (alloc && stringToUTF8 && lengthBytesUTF8) {
    const len = lengthBytesUTF8(str) + 1;
    const ptr = alloc.malloc(len);
    try {
      stringToUTF8(str, ptr, len);
      return run(ptr);
    } finally {
      alloc.free(ptr);
    }
  }
  const heap = rt.HEAPU8;
  if (alloc && heap) {
    const enc = new TextEncoder();
    const bytes = enc.encode(`${str}\0`);
    const ptr = alloc.malloc(bytes.length);
    try {
      heap.set(bytes, ptr);
      return run(ptr);
    } finally {
      alloc.free(ptr);
    }
  }
  return GROK64_UTF8_MARSHAL_ERR;
}

export function grok64DiskAttachCallable(mod: Grok64ModuleBag | null | undefined): boolean {
  if (resolveWasmExport(mod, "grok64_disk_attach")) return true;
  return false;
}

export function grok64WorkDiskRefreshCallable(mod: Grok64ModuleBag | null | undefined): boolean {
  return resolveWasmExport(mod, "grok64_work_disk_refresh") != null;
}

export function grok64WorkDiskRefreshCallableEmu(emu: unknown): boolean {
  return emuWasmModuleBags(emu).some((mod) => grok64WorkDiskRefreshCallable(mod));
}

export function grok64DiskAttachCallableEmu(emu: unknown): boolean {
  for (const mod of emuWasmModuleBags(emu)) {
    if (grok64DiskAttachCallable(mod)) return true;
  }
  return false;
}

export function listGrok64WasmExportNames(mod: Grok64ModuleBag | null | undefined): string[] {
  const mods = mod ? [mod] : [];
  const out = new Set<string>();
  for (const m of mods) {
    const bag = m as WasmBag & Record<string, unknown>;
    for (const key of Object.keys(bag)) {
      if (/grok64_/i.test(key) && asFn(bag[key])) out.add(key.replace(/^_/, ""));
    }
    for (const wasmBag of [bag.wasmExports, bag.asm, bag.instance?.exports as Record<string, unknown> | undefined]) {
      if (!wasmBag) continue;
      for (const key of Object.keys(wasmBag)) {
        if (/grok64_/i.test(key) && asFn(wasmBag[key])) out.add(key.replace(/^_/, ""));
      }
    }
    for (const name of EXPECTED_GROK64_EXPORTS) {
      if (resolveWasmExport(m, name)) out.add(name);
    }
  }
  return [...out].sort();
}

export function listGrok64WasmExportNamesEmu(emu: unknown): string[] {
  const out = new Set<string>();
  for (const mod of emuWasmModuleBags(emu)) {
    for (const n of listGrok64WasmExportNames(mod)) out.add(n);
  }
  return [...out].sort();
}

export function grok64WasmExportDiag(mod: Grok64ModuleBag | null | undefined) {
  return grok64WasmExportDiagEmu(mod ? { Module: mod } : null);
}

export function grok64WasmExportDiagEmu(emu: unknown) {
  const callable: Record<string, boolean> = {};
  for (const name of EXPECTED_GROK64_EXPORTS) {
    callable[name] = emuWasmModuleBags(emu).some((mod) => resolveWasmExport(mod, name) != null);
  }
  return {
    wasmExportNames: listGrok64WasmExportNamesEmu(emu),
    callable,
    diskAttach: callable.grok64_disk_attach ?? false,
    workDiskRefresh: callable.grok64_work_disk_refresh ?? false,
  };
}

export function bindGrok64DiskApiDirect(mod: Grok64ModuleBag, emu?: unknown): boolean {
  if (emu != null) diskBindEmu.set(mod, emu);
  const boundEmu = () => diskBindEmu.get(mod) ?? emu ?? { Module: mod };

  if (mod.grok64DiskApi && grok64DiskAttachCallable(mod)) return true;
  if (!grok64DiskAttachCallable(mod)) return false;

  const callWithPath = (exportName: string, invoke: (fn: WasmFn, ptr: number) => number, path: string) => {
    const fn = resolveWasmExport(mod, exportName);
    if (!fn) return -99;
    const rt = mergedWasmRuntime(boundEmu(), mod);
    const viaCcall = tryCcallStringArg(rt, exportName, path);
    if (viaCcall != null) return viaCcall;
    return withUtf8Arg(boundEmu(), mod, path, (ptr) => invoke(fn, ptr));
  };

  mod.grok64DiskApi = {
    diskAttach: (unit, drive, path) =>
      callWithPath("grok64_disk_attach", (fn, ptr) => Number(fn(unit, drive, ptr)), path),
    diskAttachDeferred: (unit, drive, path) =>
      callWithPath("grok64_disk_attach_deferred", (fn, ptr) => Number(fn(unit, drive, ptr)), path),
    sd2iecPoll: () => {
      resolveWasmExport(mod, "grok64_sd2iec_poll")?.();
    },
    diskDetach: (unit, drive) => {
      resolveWasmExport(mod, "grok64_disk_detach")?.(unit, drive);
    },
    diskGetName: (unit, drive) => {
      const fn = resolveWasmExport(mod, "grok64_disk_get_name");
      if (!fn) return 0;
      return Number(fn(unit, drive));
    },
    retroSaveDirectory: () => {
      const fn = resolveWasmExport(mod, "grok64_retro_save_directory");
      if (!fn) return 0;
      return Number(fn());
    },
    diskLastAttachRc: () => {
      const fn = resolveWasmExport(mod, "grok64_disk_last_attach_rc");
      if (!fn) return -1;
      return Number(fn());
    },
    workDiskRefresh: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_work_disk_refresh");
      if (!fn) return -99;
      return Number(fn(unit));
    },
    diskLastAttachDiag: () => {
      const fn = resolveWasmExport(mod, "grok64_disk_last_attach_diag");
      if (!fn) return 0;
      return Number(fn());
    },
    fsStatBytes: (path) => callWithPath("grok64_fs_stat_bytes", (fn, ptr) => Number(fn(ptr)), path),
    driveImageBytes: (unit, drive) => {
      const fn = resolveWasmExport(mod, "grok64_drive_image_bytes");
      if (!fn) return null;
      return Number(fn(unit, drive));
    },
    driveBamDiskName: (unit, drive) => {
      const fn = resolveWasmExport(mod, "grok64_drive_bam_disk_name");
      if (!fn) return null;
      const rt = mergedWasmRuntime(boundEmu(), mod);
      const alloc = resolveAlloc(rt);
      if (!alloc) return null;
      const ptr = alloc.malloc(32);
      try {
        const n = Number(fn(unit, drive, ptr, 32));
        if (n < 0) return null;
        return mod.UTF8ToString ? mod.UTF8ToString(ptr).trim() : null;
      } finally {
        alloc.free(ptr);
      }
    },
    driveLastErrorCode: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_last_error_code");
      if (!fn) return null;
      return Number(fn(unit));
    },
    driveErrorChannel: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_error_channel");
      if (!fn) return null;
      const ptr = Number(fn(unit));
      if (!ptr) return "";
      return mod.UTF8ToString ? mod.UTF8ToString(ptr).trim() : "";
    },
    driveReloadImage: (unit, drive) => {
      const fn = resolveWasmExport(mod, "grok64_drive_reload_image");
      if (!fn) return -99;
      return Number(fn(unit, drive));
    },
    driveIecDevice: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_iec_device");
      if (!fn) return null;
      return Number(fn(unit));
    },
    driveVirtualDevice: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_virtual_device");
      if (!fn) return null;
      return Number(fn(unit));
    },
    driveUnitTrueEmulation: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_unit_true_emulation");
      if (!fn) return null;
      return Number(fn(unit));
    },
    driveUnitType: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_unit_type");
      if (!fn) return null;
      return Number(fn(unit));
    },
    driveUnitEnabled: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_unit_enabled");
      if (!fn) return null;
      return Number(fn(unit));
    },
    romLoaded: () => {
      const fn = resolveWasmExport(mod, "grok64_rom_loaded");
      if (!fn) return null;
      return Number(fn());
    },
    driveSerialDeviceType: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_serial_device_type");
      if (!fn) return null;
      return Number(fn(unit));
    },
    driveVdriveErrorIsVirtual: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_vdrive_error_is_virtual");
      if (!fn) return null;
      return Number(fn(unit));
    },
    driveTdeImageBytes: (unit, drive = 0) => {
      const fn = resolveWasmExport(mod, "grok64_drive_tde_image_bytes");
      if (!fn) return null;
      return Number(fn(unit, drive));
    },
    driveGcrLoaded: (unit, drive = 0) => {
      const fn = resolveWasmExport(mod, "grok64_drive_gcr_loaded");
      if (!fn) return null;
      return Number(fn(unit, drive));
    },
    driveVdriveImageSame: (unit, drive = 0) => {
      const fn = resolveWasmExport(mod, "grok64_drive_vdrive_image_same");
      if (!fn) return null;
      return Number(fn(unit, drive));
    },
    driveSyncTdeImage: (unit, drive = 0) => {
      const fn = resolveWasmExport(mod, "grok64_drive_sync_tde_image");
      if (!fn) return -99;
      return Number(fn(unit, drive));
    },
    driveFilesystemDevice: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_filesystem_device");
      if (!fn) return null;
      return Number(fn(unit));
    },
    driveCpuClock: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_cpu_clock");
      if (!fn) return null;
      return Number(fn(unit));
    },
    driveIecBusLines: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_drive_iec_bus_lines");
      if (!fn) return null;
      return Number(fn(unit));
    },
    iecBusReconcile: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_iec_bus_reconcile");
      if (!fn) return -99;
      return Number(fn(unit));
    },
    loadDollarDiagCapture: (unit) => wasmUtf8JsonExport(mod, "grok64_load_dollar_diag_capture", unit),
    viceApplySafeFloppyProfile: (unit) => {
      const fn = resolveWasmExport(mod, "grok64_vice_apply_safe_floppy_profile");
      if (!fn) return -99;
      return Number(fn(unit));
    },
    viceDriveResourceSnapshot: () => wasmUtf8JsonExport(mod, "grok64_vice_drive_resource_snapshot"),
    driveSetType: (unit, type) => {
      const fn = resolveWasmExport(mod, "grok64_drive_set_type");
      if (!fn) return -99;
      return Number(fn(unit, type));
    },
    reuAttach: (path, sizeKb) => {
      const fn = resolveWasmExport(mod, "grok64_reu_attach");
      if (!fn) return -99;
      return withUtf8Arg(boundEmu(), mod, path, (ptr) => Number(fn(ptr, sizeKb)));
    },
    reuSizeKb: () => {
      const fn = resolveWasmExport(mod, "grok64_reu_size_kb");
      if (!fn) return null;
      return Number(fn());
    },
  };
  return true;
}

export function bindGrok64WasmApiDirect(mod: Grok64ModuleBag, emu?: unknown): boolean {
  const hasSd2iec = resolveWasmExport(mod, "grok64_sd2iec_attach") != null;
  const hasC64 = resolveWasmExport(mod, "grok64_c64_read") != null;
  if (!hasSd2iec && !hasC64) return false;

  mod.grok64WasmApi = {
    sd2iecAttach: (unit) => {
      resolveWasmExport(mod, "grok64_sd2iec_attach")?.(unit);
    },
    sd2iecPoll: () => {
      resolveWasmExport(mod, "grok64_sd2iec_poll")?.();
    },
    sd2iecDetach: (unit) => {
      resolveWasmExport(mod, "grok64_sd2iec_detach")?.(unit);
    },
    c64Read: (addr) => {
      const fn = resolveWasmExport(mod, "grok64_c64_read");
      return fn ? Number(fn(addr)) : 0;
    },
    c64Write: (addr, value) => {
      resolveWasmExport(mod, "grok64_c64_write")?.(addr, value);
    },
    kbdbufFeed: (text) => {
      const fn = resolveWasmExport(mod, "grok64_kbdbuf_feed");
      if (!fn) return -1;
      return withUtf8Arg(emu ?? { Module: mod }, mod, text, (ptr) => Number(fn(ptr)));
    },
    kbdbufFeedRuncmd: (text) => {
      const fn = resolveWasmExport(mod, "grok64_kbdbuf_feed_runcmd");
      if (!fn) return -1;
      return withUtf8Arg(emu ?? { Module: mod }, mod, text, (ptr) => Number(fn(ptr)));
    },
    kbdbufFlush: () => {
      resolveWasmExport(mod, "grok64_kbdbuf_flush")?.();
    },
    cartridgeTriggerFreeze: () => {
      resolveWasmExport(mod, "grok64_cartridge_trigger_freeze")?.();
    },
    retroKeyboard: (code, down, character, modbits) => {
      resolveWasmExport(mod, "grok64_retro_keyboard")?.(code, down, character, modbits);
    },
    mainCpuClock: () => {
      const fn = resolveWasmExport(mod, "grok64_main_cpu_clock");
      if (!fn) return null;
      const clk = Number(fn());
      return Number.isFinite(clk) ? clk : null;
    },
    retroGetMemoryData: (id) => {
      const fn = resolveWasmExport(mod, "retro_get_memory_data");
      return fn ? Number(fn(id)) : 0;
    },
    retroGetMemorySize: (id) => {
      const fn = resolveWasmExport(mod, "retro_get_memory_size");
      return fn ? Number(fn(id)) : 0;
    },
  };
  return true;
}
