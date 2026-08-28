import { unzipSync } from "fflate";
import { kindOf } from "./formats";
import type { MediaKind } from "./types";

const C64_EXT = /\.(prg|p00|d64|d71|d81|g64|g71|t64|tap|crt|bin|sid|zip)$/i;

export function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function explodeArchive(name: string, data: Uint8Array): { name: string; data: Uint8Array }[] {
  if (!/\.zip$/i.test(name)) return [{ name, data }];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    return [{ name, data }];
  }
  const out: { name: string; data: Uint8Array }[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    const base = path.split("/").pop() ?? path;
    if (!base || base.startsWith(".") || !C64_EXT.test(base)) continue;
    if (/\.zip$/i.test(base)) continue;
    out.push({ name: base, data: bytes });
  }
  return out.length ? out : [{ name, data }];
}

const RANK: Partial<Record<MediaKind, number>> = {
  crt: 0,
  d64: 1,
  d71: 2,
  d81: 3,
  g64: 4,
  g71: 5,
  prg: 6,
  p00: 7,
  t64: 8,
  tap: 9,
  bin: 10,
  sid: 11,
  zip: 12,
};

const SKIP =
  /preview|readme|\.nfo$|docs?$|side\s*b|disk\s*(2|3|b)\b|construction|\bkit\b|trainer|awally|a[\s._-]*wally|editor|designer|cheat|\+\d{1,2}\b/i;
const PREFER = /first[\s._-]*star|original|\((?:usa|us)\)/i;

export function isJunkRelease(name: string): boolean {
  return SKIP.test(name);
}

export function pickBootFile<T extends { name: string }>(files: T[]): T | null {
  if (!files.length) return null;
  const playable = files.filter((f) => kindOf(f.name) !== "unknown" && kindOf(f.name) !== "zip");
  const pool = playable.length ? playable : files;
  const preferred = pool.filter((f) => !SKIP.test(f.name));
  const ranked = [...(preferred.length ? preferred : pool)].sort((a, b) => {
    const ra = RANK[kindOf(a.name)] ?? 50;
    const rb = RANK[kindOf(b.name)] ?? 50;
    if (ra !== rb) return ra - rb;
    const pa = PREFER.test(a.name) ? 0 : 1;
    const pb = PREFER.test(b.name) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.name.length - b.name.length;
  });
  return ranked[0] ?? null;
}
