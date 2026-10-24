/**
 * Grok64 JS wrappers for WASM exports. Never assign cwrap results onto Module._name —
 * Emscripten getCFunc(ident) resolves Module["_"+ident], so overwriting _grok64_* causes
 * ccall → cwrap → ccall infinite recursion (Tom c8674de / blob line 11 ~221041).
 */

import type { Grok64WasmModule } from "./grok64-wasm-bind";

export type Grok64DiskApi = {
  diskAttach: (unit: number, drive: number, path: string) => number;
  diskAttachDeferred: (unit: number, drive: number, path: string) => number;
  sd2iecPoll: () => void;
  diskDetach: (unit: number, drive: number) => void;
  diskGetName: (unit: number, drive: number) => number;
  retroSaveDirectory: () => number;
  diskLastAttachRc: () => number;
  workDiskRefresh: (unit: number) => number;
  diskLastAttachDiag: () => number;
  fsStatBytes: (path: string) => number;
};

export type Grok64WasmApi = {
  sd2iecAttach: (unit: number) => void;
  sd2iecPoll: () => void;
  sd2iecDetach: (unit: number) => void;
  c64Read: (addr: number) => number;
  c64Write: (addr: number, value: number) => void;
  kbdbufFeed: (text: string) => number;
  kbdbufFeedRuncmd: (text: string) => number;
  kbdbufFlush: () => void;
  cartridgeTriggerFreeze: () => void;
  retroKeyboard: (code: number, down: number, character: number, mod: number) => void;
  retroGetMemoryData: (id: number) => number;
  retroGetMemorySize: (id: number) => number;
};

export type Grok64ModuleBag = Grok64WasmModule & {
  grok64DiskApi?: Grok64DiskApi;
  grok64WasmApi?: Grok64WasmApi;
  UTF8ToString?: (ptr: number) => string;
};

export function grok64DiskApi(mod: Grok64ModuleBag | null | undefined): Grok64DiskApi | null {
  return mod?.grok64DiskApi ?? null;
}

export function grok64WasmApi(mod: Grok64ModuleBag | null | undefined): Grok64WasmApi | null {
  return mod?.grok64WasmApi ?? null;
}

/** True when the custom core exports grok64_work_disk_refresh (bound on grok64DiskApi). */
export function grok64WorkDiskRefreshExportReady(mod: Grok64ModuleBag | null | undefined): boolean {
  return typeof mod?.grok64DiskApi?.workDiskRefresh === "function";
}
