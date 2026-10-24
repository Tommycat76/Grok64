/**
 * Call Grok64 WASM exports without Emscripten cwrap/ccall (getCFunc → Module._name).
 * Resolves the raw function at call time from Module, asm, or wasmExports.
 */

import type { Grok64ModuleBag } from "./grok64-api";

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
  _free?: (ptr: number) => void;
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
  "grok64_disk_attach",
  "grok64_disk_attach_deferred",
  "grok64_disk_detach",
  "grok64_disk_get_name",
  "grok64_retro_save_directory",
  "grok64_disk_last_attach_rc",
  "grok64_work_disk_refresh",
  "grok64_disk_last_attach_diag",
  "grok64_fs_stat_bytes",
] as const;

function asFn(v: unknown): WasmFn | null {
  return typeof v === "function" ? (v as WasmFn) : null;
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

export function grok64DiskAttachCallable(mod: Grok64ModuleBag | null | undefined): boolean {
  return resolveWasmExport(mod, "grok64_disk_attach") != null;
}

export function grok64WorkDiskRefreshCallable(mod: Grok64ModuleBag | null | undefined): boolean {
  return resolveWasmExport(mod, "grok64_work_disk_refresh") != null;
}

export function listGrok64WasmExportNames(mod: Grok64ModuleBag | null | undefined): string[] {
  if (!mod) return [];
  const out = new Set<string>();
  const m = mod as WasmBag & Record<string, unknown>;
  for (const key of Object.keys(m)) {
    if (/grok64_/i.test(key) && asFn(m[key])) out.add(key.replace(/^_/, ""));
  }
  for (const bag of [m.wasmExports, m.asm, m.instance?.exports as Record<string, unknown> | undefined]) {
    if (!bag) continue;
    for (const key of Object.keys(bag)) {
      if (/grok64_/i.test(key) && asFn(bag[key])) out.add(key.replace(/^_/, ""));
    }
  }
  for (const name of EXPECTED_GROK64_EXPORTS) {
    if (resolveWasmExport(mod, name)) out.add(name);
  }
  return [...out].sort();
}

export function grok64WasmExportDiag(mod: Grok64ModuleBag | null | undefined) {
  const callable: Record<string, boolean> = {};
  for (const name of EXPECTED_GROK64_EXPORTS) {
    callable[name] = resolveWasmExport(mod, name) != null;
  }
  return {
    wasmExportNames: listGrok64WasmExportNames(mod),
    callable,
    diskAttach: callable.grok64_disk_attach ?? false,
    workDiskRefresh: callable.grok64_work_disk_refresh ?? false,
  };
}

function withUtf8Arg(mod: WasmBag, str: string, run: (ptr: number) => number): number {
  const stackSave = mod.stackSave;
  const stackRestore = mod.stackRestore;
  const stringToUTF8OnStack = mod.stringToUTF8OnStack;
  if (stackSave && stackRestore && stringToUTF8OnStack) {
    const sp = stackSave();
    try {
      const ptr = stringToUTF8OnStack(str);
      return run(ptr);
    } finally {
      stackRestore(sp);
    }
  }
  const malloc = mod._malloc;
  const free = mod._free;
  const stringToUTF8 = mod.stringToUTF8;
  const lengthBytesUTF8 = mod.lengthBytesUTF8;
  if (malloc && free && stringToUTF8 && lengthBytesUTF8) {
    const len = lengthBytesUTF8(str) + 1;
    const ptr = malloc(len);
    try {
      stringToUTF8(str, ptr, len);
      return run(ptr);
    } finally {
      free(ptr);
    }
  }
  return -98;
}

export function bindGrok64DiskApiDirect(mod: Grok64ModuleBag): boolean {
  if (mod.grok64DiskApi && grok64DiskAttachCallable(mod)) return true;
  if (!grok64DiskAttachCallable(mod)) return false;

  mod.grok64DiskApi = {
    diskAttach: (unit, drive, path) => {
      const fn = resolveWasmExport(mod, "grok64_disk_attach");
      if (!fn) return -99;
      return withUtf8Arg(mod as WasmBag, path, (ptr) => Number(fn(unit, drive, ptr)));
    },
    diskAttachDeferred: (unit, drive, path) => {
      const fn = resolveWasmExport(mod, "grok64_disk_attach_deferred");
      if (!fn) return -99;
      return withUtf8Arg(mod as WasmBag, path, (ptr) => Number(fn(unit, drive, ptr)));
    },
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
    fsStatBytes: (path) => {
      const fn = resolveWasmExport(mod, "grok64_fs_stat_bytes");
      if (!fn) return -99;
      return withUtf8Arg(mod as WasmBag, path, (ptr) => Number(fn(ptr)));
    },
  };
  return true;
}

export function bindGrok64WasmApiDirect(mod: Grok64ModuleBag): boolean {
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
      return withUtf8Arg(mod as WasmBag, text, (ptr) => Number(fn(ptr)));
    },
    kbdbufFeedRuncmd: (text) => {
      const fn = resolveWasmExport(mod, "grok64_kbdbuf_feed_runcmd");
      if (!fn) return -1;
      return withUtf8Arg(mod as WasmBag, text, (ptr) => Number(fn(ptr)));
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
