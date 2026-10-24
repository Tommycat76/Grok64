import {
  D64_STANDARD_SIZE,
  D64_SIZE_35_WITH_ERROR,
  D64_SIZE_40,
  D64_SIZE_40_WITH_ERROR,
  isAcceptedD64ByteLength,
} from "./formats";

/** Commodore DOS FDC “no error” code in the 683-byte D64 error-info tail. */
export const D64_FDC_ERR_OK = 1;

function errorTailByteLength(total: number): number | null {
  if (total === D64_SIZE_35_WITH_ERROR) return D64_SIZE_35_WITH_ERROR - D64_STANDARD_SIZE;
  if (total === D64_SIZE_40_WITH_ERROR) return D64_SIZE_40_WITH_ERROR - D64_SIZE_40;
  return null;
}

/**
 * Normalize D64 error-info tail bytes before MEMFS / vice_work mirror.
 * Byte 0 is not a valid FDC code in VICE (OK = 1); zero-filled tails break TDE GCR on 175531 images.
 */
export function normalizeD64ErrorInfoTail(data: Uint8Array): Uint8Array {
  if (!isAcceptedD64ByteLength(data.byteLength) || data.byteLength === D64_STANDARD_SIZE) {
    return data;
  }
  const tailLen = errorTailByteLength(data.byteLength);
  if (tailLen == null || tailLen <= 0) return data;
  const tailStart = data.byteLength - tailLen;
  let changed = false;
  for (let i = 0; i < tailLen; i++) {
    if (data[tailStart + i] === 0) changed = true;
  }
  if (!changed) return data;
  const out = data.slice();
  for (let i = 0; i < tailLen; i++) {
    if (out[tailStart + i] === 0) out[tailStart + i] = D64_FDC_ERR_OK;
  }
  return out;
}
