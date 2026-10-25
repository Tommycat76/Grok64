/**
 * Grok64 JS wrappers for WASM exports. Never assign cwrap results onto Module._name —
 * Emscripten getCFunc(ident) resolves Module["_"+ident], so overwriting _grok64_* causes
 * ccall → cwrap → ccall infinite recursion (Tom c8674de / blob line 11 ~221041).
 */

import {
  grok64DiskAttachCallable,
  grok64DiskAttachCallableEmu,
  grok64WorkDiskRefreshCallableEmu,
} from "./grok64-wasm-direct";
import type { Grok64WasmModule } from "./grok64-wasm-bind";

/** Bumped when WASM bind strategy changes; About / QA can detect stale app JS. */
export const GROK64_WASM_BIND_REV = "diskapi-v27-core-ca4d09efaee4";

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
  driveImageBytes?: (unit: number, drive: number) => number | null;
  driveBamDiskName?: (unit: number, drive: number) => string | null;
  driveLastErrorCode?: (unit: number) => number | null;
  driveErrorChannel?: (unit: number) => string | null;
  driveReloadImage?: (unit: number, drive: number) => number;
  driveIecDevice?: (unit: number) => number | null;
  driveVirtualDevice?: (unit: number) => number | null;
  driveUnitTrueEmulation?: (unit: number) => number | null;
  driveUnitType?: (unit: number) => number | null;
  driveUnitEnabled?: (unit: number) => number | null;
  romLoaded?: () => number | null;
  driveSerialDeviceType?: (unit: number) => number | null;
  driveVdriveErrorIsVirtual?: (unit: number) => number | null;
  driveTdeImageBytes?: (unit: number, drive?: number) => number | null;
  driveGcrLoaded?: (unit: number, drive?: number) => number | null;
  driveVdriveImageSame?: (unit: number, drive?: number) => number | null;
  driveSyncTdeImage?: (unit: number, drive?: number) => number;
  driveFilesystemDevice?: (unit: number) => number | null;
  driveCpuClock?: (unit: number) => number | null;
  driveIecBusLines?: (unit: number) => number | null;
  iecBusReconcile?: (unit: number) => number;
  loadDollarDiagCapture?: (unit: number) => Record<string, unknown> | null;
  viceApplySafeFloppyProfile?: (unit: number) => number;
  viceDriveResourceSnapshot?: () => Record<string, unknown> | null;
  driveSetType?: (unit: number, type: number) => number;
  reuAttach?: (path: string, sizeKb: number) => number;
  reuSizeKb?: () => number | null;
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
  mainCpuClock?: () => number | null;
  retroGetMemoryData: (id: number) => number;
  retroGetMemorySize: (id: number) => number;
  mouseMove?: (dx: number, dy: number) => void;
  mouseButtons?: (left: number, right: number) => void;
  mousePlug?: (port: number, on: number) => number;
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

/** True when the WASM module exposes grok64_work_disk_refresh (callable, not just JS wrapper). */
export function grok64WorkDiskRefreshExportReady(mod: Grok64ModuleBag | null | undefined): boolean {
  return grok64WorkDiskRefreshCallableEmu(mod ? { Module: mod } : null);
}

/** True when grok64_disk_attach resolves to a WASM function. */
export function grok64DiskAttachExportReady(mod: Grok64ModuleBag | null | undefined): boolean {
  return grok64DiskAttachCallableEmu(mod ? { Module: mod } : null);
}
