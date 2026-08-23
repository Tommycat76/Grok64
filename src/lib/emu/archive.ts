/**
 * Archive / boot-file picker (reconstructed).
 * Prefer clean originals; skip junk releases.
 */

const SKIP = [
  /construction\s*kit/i,
  /\btrainer\b/i,
  /awally/i,
  /\bhack\b/i,
  /preview\s*only/i,
];

const PREFER = [
  /first\s*star/i,
  /1984/i,
  /\boriginal\b/i,
  /cr_nova/i,
];

export function isJunkRelease(name: string): boolean {
  return SKIP.some((re) => re.test(name));
}

export function rankBootCandidate(name: string): number {
  let score = 0;
  if (isJunkRelease(name)) score -= 100;
  for (const re of PREFER) if (re.test(name)) score += 20;
  if (/\.d64$/i.test(name)) score += 5;
  if (/\.crt$/i.test(name)) score += 8;
  return score;
}

/** Pick best bootable file from a list of names/paths inside an archive or search hit. */
export function pickBootFile(files: string[]): string | null {
  if (!files.length) return null;
  const ranked = [...files].sort((a, b) => rankBootCandidate(b) - rankBootCandidate(a));
  const best = ranked[0];
  if (isJunkRelease(best) && ranked.length === 1) return best;
  if (isJunkRelease(best)) {
    const nonJunk = ranked.find((f) => !isJunkRelease(f));
    return nonJunk || best;
  }
  return best;
}

export async function toArrayBuffer(data: Blob | ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  if (data instanceof ArrayBuffer) return data;
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return data.arrayBuffer();
}
