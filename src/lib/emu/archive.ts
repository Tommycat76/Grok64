import { unzipSync } from "fflate";
import { isCracktroName, listD64Directory, namesFuzzyMatch } from "./d64";
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

export function u8ToB64(data: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < data.length; i += step) {
    bin += String.fromCharCode(...data.subarray(i, i + step));
  }
  return btoa(bin);
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
  /preview|readme|\.nfo$|docs?$|construction|\bkit\b|trainer|awally|a[\s._-]*wally|editor|designer|cheat|\+\d{1,2}\b/i;
const SIDE_B = /side\s*b|disk\s*(2|3|b)\b/i;
const PREFER = /first[\s._-]*star|original|\((?:usa|us)\)/i;

export function isJunkRelease(name: string): boolean {
  return SKIP.test(name);
}

export function bootFileScore(
  name: string,
  title?: string,
  data?: Uint8Array | ArrayBuffer | null,
): number {
  let score = 0;
  const kind = kindOf(name);
  score -= (RANK[kind] ?? 50) * 10;
  if (SKIP.test(name)) score -= 80;
  if (SIDE_B.test(name)) score -= 8;
  if (PREFER.test(name)) score += 12;
  if (title && namesFuzzyMatch(name, title)) score += 20;
  if (/intro|cracktro|\bcrack\b/i.test(name) && !/paradroid|uridium/i.test(name)) score -= 25;
  const raw =
    data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
  if (raw && (kind === "d64" || kind === "d71")) {
    const dir = listD64Directory(raw);
    const prgs = dir.filter((e) => e.prg);
    const first = prgs[0];
    const game =
      title && prgs.find((e) => namesFuzzyMatch(e.name, title) && !isCracktroName(e.name));
    if (game) score += 40;
    if (first && isCracktroName(first.name) && !game) score -= 30;
    if (first && game && first.slot !== game.slot && isCracktroName(first.name)) score += 10;
  }
  score -= Math.min(name.length, 80) / 20;
  return score;
}

export function pickBootFile<T extends { name: string; data?: Uint8Array | ArrayBuffer }>(
  files: T[],
  title?: string,
): T | null {
  if (!files.length) return null;
  const playable = files.filter((f) => kindOf(f.name) !== "unknown" && kindOf(f.name) !== "zip");
  const pool = playable.length ? playable : files;
  const preferred = pool.filter((f) => !SKIP.test(f.name));
  const ranked = [...(preferred.length ? preferred : pool)].sort((a, b) => {
    const sa = bootFileScore(a.name, title, a.data);
    const sb = bootFileScore(b.name, title, b.data);
    if (sa !== sb) return sb - sa;
    return a.name.length - b.name.length;
  });
  return ranked[0] ?? null;
}
