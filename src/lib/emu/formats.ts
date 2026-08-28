import type { MediaKind } from "./types";

export const ACCEPT_EXT =
  ".prg,.p00,.d64,.d71,.d81,.g64,.g71,.t64,.tap,.crt,.bin,.zip,.vsf,.sav,.m3u,.sid,.n64";

export const KIND_LABEL: Record<MediaKind, string> = {
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

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function kindOf(name: string): MediaKind {
  const e = extOf(name);
  const map: Record<string, MediaKind> = {
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
  return map[e] ?? "unknown";
}

export function bootFileName(name: string, kind?: MediaKind): string {
  const cleaned = name.replace(/[#<$+%>!`&*'|{}/\\?"=@:^\r\n]/g, "").trim() || "software";
  if (kindOf(cleaned) !== "unknown") return cleaned;
  const ext = kind && kind !== "unknown" && kind !== "zip" ? kind : "d64";
  return `${cleaned}.${ext}`;
}

const D64_BAM = 17 * 21 * 256;

export function d64DiskName(data: Uint8Array): string | null {
  if (data.byteLength < D64_BAM + 0xa0) return null;
  const raw = data.subarray(D64_BAM + 0x90, D64_BAM + 0xa0);
  let s = "";
  for (const b of raw) s += String.fromCharCode(b === 0xa0 ? 32 : b & 0x7f);
  const name = s.replace(/\0/g, " ").trim();
  return name || null;
}

export function isWorkDiskImage(data: ArrayBuffer | Uint8Array): boolean {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  return d64DiskName(u8)?.toUpperCase() === "WORK DISK";
}

export function slotFor(kind: MediaKind): "disk" | "tape" | "cart" | "prg" | "state" {
  if (["d64", "d71", "d81", "g64", "g71", "zip", "m3u"].includes(kind)) return "disk";
  if (kind === "t64" || kind === "tap") return "tape";
  if (kind === "crt" || kind === "bin") return "cart";
  if (kind === "vsf" || kind === "sav") return "state";
  return "prg";
}

export function needsTypedBoot(kind: MediaKind): boolean {
  return kind === "d64" || kind === "d71" || kind === "d81" || kind === "g64" || kind === "g71" || kind === "m3u";
}

export function isDiskKind(kind: MediaKind): boolean {
  return kind === "d64" || kind === "d71" || kind === "d81" || kind === "g64" || kind === "g71" || kind === "m3u";
}

export function driveForPlay(
  resolved: "true" | "fast",
  opts: { typedDisk?: boolean; workDisk?: boolean } = {},
): "true" | "fast" {
  if (opts.workDisk) return resolved;
  if (opts.typedDisk) return "true";
  return resolved;
}

