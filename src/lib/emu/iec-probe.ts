/** IEC / drive status from WASM exports only — never type into the C64 keyboard. */
import type { ViceDriveLiveProbe } from "./vice-disk";

export type WasmIecDriveState = {
  errorChannel: string;
  errorCode: number | null;
  isVirtual: boolean;
  isCbmDos: boolean;
  driveUnitType: number | null;
};

export function wasmIecDriveStateFromLive(live: ViceDriveLiveProbe | null | undefined): WasmIecDriveState {
  const ch = String(live?.wasmErrorChannel ?? live?.wasmVdriveErrorChannel ?? "").trim();
  const isVirtual =
    live?.wasmVdriveErrorIsVirtual === 1 || /VIRTUAL\s+DRIVE/i.test(ch);
  const isCbmDos = /CBM\s+DOS/i.test(ch) && !isVirtual;
  return {
    errorChannel: ch,
    errorCode: live?.wasmErrorCode ?? null,
    isVirtual,
    isCbmDos,
    driveUnitType: live?.wasmDriveUnitType ?? null,
  };
}
