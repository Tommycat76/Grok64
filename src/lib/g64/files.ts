import { unzipSync } from "fflate";

export const ACCEPT =
  ".prg,.p00,.d64,.d71,.d81,.g64,.g71,.t64,.tap,.crt,.bin,.zip,.vsf,.sav,.m3u,.sid,.n64";

export type FileKind =
  | "prg"
  | "p00"
  | "d64"
  | "d71"
  | "d81"
  | "g64"
  | "g71"
  | "t64"
  | "tap"
  | "crt"
  | "bin"
  | "zip"
  | "vsf"
  | "sav"
  | "m3u"
  | "sid"
  | "unknown";

export const KIND_LABEL: Record<FileKind, string> = {
  prg: "Program",
  p00: "PC64 PRG",
  d64: "1541 disk",
  d71: "1571 disk",
  d81: "1581 disk",
  g64: "GCR disk",
  g71: "1571 GCR",
  t64: "Tape archive",
  tap: "Raw tape",
  crt: "Cartridge",
  bin: "Raw binary",
  zip: "Archive",
  vsf: "VICE state",
  sav: "Save state",
  m3u: "Multi-disk",
  sid: "SID music",
  unknown: "File",
};

export function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function kindOf(name: string): FileKind {
  const map: Record<string, FileKind> = {
    prg: "prg",
    p00: "p00",
    d64: "d64",
    d71: "d71",
    d81: "d81",
    g64: "g64",
    g71: "g71",
    t64: "t64",
    tap: "tap",
    crt: "crt",
    bin: "bin",
    zip: "zip",
    vsf: "vsf",
    sav: "sav",
    m3u: "m3u",
    sid: "sid",
  };
  return map[extOf(name)] ?? "unknown";
}

export function safeName(name: string, fallback?: FileKind) {
  const n = name.replace(/[#<$+%>!`&*'|{}/\\?"=@:^\r\n]/g, "").trim() || "software";
  return kindOf(n) === "unknown"
    ? `${n}.${fallback && fallback !== "unknown" && fallback !== "zip" ? fallback : "d64"}`
    : n;
}

export function isDiskKind(k: FileKind) {
  return k === "d64" || k === "d71" || k === "d81" || k === "g64" || k === "g71" || k === "m3u";
}

export function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

export function fromBase64(b64: string) {
  const t = atob(b64);
  const n = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) n[i] = t.charCodeAt(i);
  return n;
}

export function toBase64(u: Uint8Array) {
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!);
  return btoa(s);
}

const C64_FILE = /\.(prg|p00|d64|d71|d81|g64|g71|t64|tap|crt|bin|sid|zip)$/i;

export interface NamedBuf {
  name: string;
  data: Uint8Array;
  size?: number;
}

export function expandArchive(name: string, data: Uint8Array): NamedBuf[] {
  if (!/\.zip$/i.test(name)) return [{ name, data }];
  try {
    const files = unzipSync(data);
    const out: NamedBuf[] = [];
    for (const [path, buf] of Object.entries(files)) {
      const n = path.split("/").pop() ?? path;
      if (!n || n.startsWith(".") || !C64_FILE.test(n) || /\.zip$/i.test(n)) continue;
      out.push({ name: n, data: buf });
    }
    return out.length ? out : [{ name, data }];
  } catch {
    return [{ name, data }];
  }
}

const ORDER: Record<string, number> = {
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

const JUNK =
  /preview|readme|\.nfo$|docs?$|side\s*b|disk\s*(2|3|b)\b|construction|\bkit\b|trainer|awally|a[\s._-]*wally|editor|designer|cheat|\+\d{1,2}\b/i;
const PREFER = /first[\s._-]*star|original|\((?:usa|us)\)/i;

export function isJunkRelease(name: string) {
  return JUNK.test(name);
}

export function pickBootFile<T extends { name: string }>(files: T[]): T | null {
  if (!files.length) return null;
  const typed = files.filter((f) => kindOf(f.name) !== "unknown" && kindOf(f.name) !== "zip");
  const pool = typed.length ? typed : files;
  const clean = pool.filter((f) => !JUNK.test(f.name));
  const ranked = [...(clean.length ? clean : pool)].sort((a, b) => {
    const ka = ORDER[kindOf(a.name)] ?? 50;
    const kb = ORDER[kindOf(b.name)] ?? 50;
    if (ka !== kb) return ka - kb;
    const pa = +!PREFER.test(a.name);
    const pb = +!PREFER.test(b.name);
    return pa === pb ? a.name.length - b.name.length : pa - pb;
  });
  return ranked[0] ?? null;
}

export function diskBanner(data: Uint8Array) {
  if (data.byteLength < 91552) return null;
  const t = data.subarray(91536, 91552);
  let n = "";
  for (const b of t) n += String.fromCharCode(b === 160 ? 32 : b & 127);
  return n.replace(/\0/g, " ").trim() || null;
}

export function isWorkDisk(data: ArrayBuffer | Uint8Array) {
  const u = data instanceof Uint8Array ? data : new Uint8Array(data);
  return diskBanner(u)?.toUpperCase() === "WORK DISK";
}
