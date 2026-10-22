import { packPrgsToD64, stripP00 } from "./d64";
import { estimatePrgBlocks, packPrgsToD81 } from "./d81";
import type { SdPartition } from "./sd2iec";

/** 1541 D64 holds ~664 usable blocks; larger SD folders need 1581 D81. */
export const D64_BLOCK_BUDGET = 660;

export type Sd2iecVolumeFormat = "d64" | "d81";
export type Sd2iecDriveType = "1541" | "1581";

export interface Sd2iecVolume {
  data: Uint8Array;
  format: Sd2iecVolumeFormat;
  driveType: Sd2iecDriveType;
  blocksUsed: number;
}

let lastVolume: Sd2iecVolume | null = null;

export function lastSd2iecVolume(): Sd2iecVolume | null {
  return lastVolume;
}

export function setLastSd2iecVolume(vol: Sd2iecVolume | null) {
  lastVolume = vol;
}

function collectFiles(parts: SdPartition[]): { name: string; data: Uint8Array }[] {
  const files: { name: string; data: Uint8Array }[] = [];
  for (const part of parts) {
    for (const f of part.files) {
      const raw = new Uint8Array(f.data);
      if (/\.d64$/i.test(f.name) && raw.byteLength >= 174848) {
        return [{ name: f.name, data: raw.subarray(0, 174848) }];
      }
      const p00 = stripP00(raw);
      const payload = p00 ?? raw;
      if (payload.byteLength >= 2) {
        const path = f.path ? `${f.path}/${f.name}` : f.name;
        files.push({ name: path, data: payload });
      }
    }
  }
  return files;
}

export function estimateSd2iecBlocks(parts: SdPartition[]): number {
  return collectFiles(parts).reduce((n, f) => n + estimatePrgBlocks(f.data), 0);
}

/** Build D64 or D81 image from SD card partitions. */
export function buildSd2iecVolume(parts: SdPartition[], diskName = "SD2IEC"): Sd2iecVolume {
  const files = collectFiles(parts);
  if (!files.length) {
    const empty = packPrgsToD64([{ name: "EMPTY.PRG", data: new Uint8Array([1, 8, 0, 10, 0]) }], diskName);
    const vol = { data: empty, format: "d64" as const, driveType: "1541" as const, blocksUsed: 1 };
    setLastSd2iecVolume(vol);
    return vol;
  }
  if (/\.d64$/i.test(files[0]!.name) && files[0]!.data.byteLength >= 174848) {
    const vol = {
      data: files[0]!.data,
      format: "d64" as const,
      driveType: "1541" as const,
      blocksUsed: 683,
    };
    setLastSd2iecVolume(vol);
    return vol;
  }
  const blocksNeeded = files.reduce((n, f) => n + estimatePrgBlocks(f.data), 0);
  if (blocksNeeded <= D64_BLOCK_BUDGET) {
    try {
      const data = packPrgsToD64(files, diskName);
      const vol = { data, format: "d64" as const, driveType: "1541" as const, blocksUsed: blocksNeeded };
      setLastSd2iecVolume(vol);
      return vol;
    } catch {
      /* fall through to D81 */
    }
  }
  const data = packPrgsToD81(files, diskName);
  const vol = { data, format: "d81" as const, driveType: "1581" as const, blocksUsed: blocksNeeded };
  setLastSd2iecVolume(vol);
  return vol;
}

/** @deprecated use buildSd2iecVolume */
export function buildSd2iecD64(parts: SdPartition[], diskName = "SD2IEC"): Uint8Array {
  return buildSd2iecVolume(parts, diskName).data;
}
