/** Guards for IndexedDB library row write-back (autosave / MEMFS flush). */

import {
  isCartridgePayload,
  isDiskKind,
  isLikelyBlankD64Payload,
  isWorkDiskImage,
  kindOf,
} from "./formats";
import { isWorkDisk } from "./library";

/** Only floppy library rows may receive mounted-disk bytes from the emulator. */
export function libraryRowAllowsDiskWriteBack(fileName: string, data: ArrayBuffer | Uint8Array): boolean {
  const rowKind = kindOf(fileName);
  if (!isDiskKind(rowKind)) return false;
  if (/\.(crt|bin)$/i.test(fileName)) return false;
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (isCartridgePayload(u8, fileName)) return false;
  if (isWorkDisk(fileName)) return isWorkDiskImage(u8);
  if (isLikelyBlankD64Payload(u8) || isWorkDiskImage(u8)) return false;
  return true;
}
