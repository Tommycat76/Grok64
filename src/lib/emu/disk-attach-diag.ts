import {
  d64DiskName,
  D64_STANDARD_SIZE,
  isAcceptedD64ByteLength,
  isGcrDiskKind,
  isLikelyBlankD64Payload,
  isWorkDiskImage,
  kindOf,
} from "./formats";
import { lbaDirectorySector1Offset } from "./d64-layout";

export type DiskAttachFingerprint = {
  size: number;
  sha1: string;
  diskLabel: string | null;
  dir18s1Hex: string | null;
  kind: string;
};

export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = await crypto.subtle.digest("SHA-1", copy);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function directorySector18Track1Slice(data: Uint8Array): Uint8Array | null {
  if (data.byteLength < D64_STANDARD_SIZE) return null;
  const off = lbaDirectorySector1Offset();
  if (off + 32 > data.byteLength) return null;
  return data.subarray(off, off + 32);
}

export async function diskAttachFingerprint(bytes: Uint8Array, fileName = ""): Promise<DiskAttachFingerprint> {
  const dir = directorySector18Track1Slice(bytes);
  return {
    size: bytes.byteLength,
    sha1: await sha1Hex(bytes),
    diskLabel: bytes.byteLength >= D64_STANDARD_SIZE ? d64DiskName(bytes) : null,
    dir18s1Hex: dir ? [...dir].map((b) => b.toString(16).padStart(2, "0")).join("") : null,
    kind: kindOf(fileName),
  };
}

export function isG64Payload(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0x47 && bytes[1] === 0x43 && bytes[2] === 0x52;
}

/** Reject blank / work-disk / mislabeled GCR blobs before Play or Insert. */
export function validateFloppyLibraryPayload(
  fileName: string,
  bytes: Uint8Array,
): { ok: true } | { ok: false; reason: string } {
  const kind = kindOf(fileName);
  if (!["d64", "d71", "d81", "g64", "g71"].includes(kind)) {
    return { ok: false, reason: "not-floppy" };
  }
  if (isWorkDiskImage(bytes) || isLikelyBlankD64Payload(bytes)) {
    return { ok: false, reason: "blank-or-work-disk" };
  }
  if (kind === "d64") {
    if (!isAcceptedD64ByteLength(bytes.byteLength)) return { ok: false, reason: "d64-wrong-size" };
    if (isG64Payload(bytes)) return { ok: false, reason: "gcr-bytes-with-d64-name" };
    const label = d64DiskName(bytes);
    if (!label || /^work\s*disk/i.test(label)) return { ok: false, reason: "missing-disk-label" };
  }
  if (isGcrDiskKind(kind)) {
    if (!isG64Payload(bytes)) return { ok: false, reason: "g64-bad-header" };
  }
  return { ok: true };
}
