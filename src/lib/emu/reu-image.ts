import type { ReuSize } from "./types";

export const GROK64_REU_IMAGE_PATH = "/data/saves/grok64.reu";

export interface C64uRunMeFirst {
  reuEnabled: boolean | null;
  reuSizeKb: number | null;
  reuSize: ReuSize | null;
  preload: boolean | null;
  preloadImage: string | null;
}

export interface ReuCandidate {
  name: string;
  data: Uint8Array;
  id?: string;
}

export interface ReuPick {
  candidate: ReuCandidate;
  reason: string;
  cfg: C64uRunMeFirst | null;
  score: number;
}

const VICE_REU_KB = [128, 256, 512, 1024, 2048, 4096, 8192, 16384] as const;

export function isReuImageName(name: string): boolean {
  return /\.(reu|nuv)$/i.test(name);
}

/** Nuvie player path — keep wrapping these; BluREU-class dumps must not go through it. */
export function isNuvieReuName(name: string): boolean {
  return /\.nuv$/i.test(name) || /\bnuvie\b/i.test(name);
}

export function fileBaseName(name: string): string {
  const n = name.replace(/\\/g, "/");
  return n.split("/").pop() ?? name;
}

export function fileParentDir(name: string): string {
  const n = name.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(0, i).toLowerCase() : "";
}

export function reuStem(name: string): string {
  return fileBaseName(name)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

export function reuSizeFromKb(kb: number): ReuSize {
  if (kb <= 0) return "none";
  if (kb <= 256) return "256kB";
  if (kb <= 512) return "512kB";
  if (kb <= 2048) return "2048kB";
  return "16384kB";
}

export function reuSizeFromByteLength(n: number): ReuSize {
  return reuSizeFromKb(Math.round(n / 1024));
}

export function reuSizeKbForVice(size: ReuSize): number {
  if (size === "256kB") return 256;
  if (size === "512kB") return 512;
  if (size === "2048kB") return 2048;
  if (size === "16384kB") return 16384;
  return 0;
}

export function snapReuKb(kb: number): number {
  if (kb <= 0) return 0;
  for (const legal of VICE_REU_KB) {
    if (legal >= kb) return legal;
  }
  return 16384;
}

function parseOnOff(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (v === "enabled" || v === "on" || v === "true" || v === "1" || v === "yes") return true;
  if (v === "disabled" || v === "off" || v === "false" || v === "0" || v === "no") return false;
  return null;
}

function parseReuSizeValue(value: string): number | null {
  const raw = value.trim().toLowerCase().replace(/,/g, "");
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(mb|m|kb|k)?/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] ?? (n <= 64 ? "mb" : "kb");
  if (unit === "mb" || unit === "m") return Math.round(n * 1024);
  return Math.round(n);
}

/** C64 Ultimate / C64U `RunMeFirst.cfg` — honor REU size; USB preload paths are host-local. */
export function parseC64uRunMeFirst(text: string): C64uRunMeFirst {
  const out: C64uRunMeFirst = {
    reuEnabled: null,
    reuSizeKb: null,
    reuSize: null,
    preload: null,
    preloadImage: null,
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("[") || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    if (key === "ram expansion unit") out.reuEnabled = parseOnOff(value);
    else if (key === "reu size") {
      out.reuSizeKb = parseReuSizeValue(value);
      out.reuSize = out.reuSizeKb != null ? reuSizeFromKb(out.reuSizeKb) : null;
    } else if (key === "reu preload") out.preload = parseOnOff(value);
    else if (key === "reu preload image") {
      const base = fileBaseName(value.replace(/\\/g, "/"));
      out.preloadImage = base || null;
    }
  }
  return out;
}

export function isC64uReuCfgName(name: string): boolean {
  return /\.cfg$/i.test(name);
}

export function looksLikeC64uReuCfg(text: string): boolean {
  return /ram\s*expansion\s*unit|reu\s*size|reu\s*preload/i.test(text);
}

export function reuPairZipFiles(
  prgName: string,
  prg: Uint8Array,
  reu: Uint8Array,
): { zipName: string; prgName: string; reuName: string; files: Record<string, Uint8Array> } {
  const base = fileBaseName(prgName).replace(/\.[^.]+$/, "") || "program";
  const boot = /\.prg$/i.test(fileBaseName(prgName)) ? fileBaseName(prgName) : `${base}.prg`;
  const reuName = `${base}.reu`;
  return {
    zipName: `${base}.zip`,
    prgName: boot,
    reuName,
    files: { [boot]: prg, [reuName]: reu },
  };
}

function decodeText(data: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(data);
}

function cfgFromFiles(files: { name: string; data?: Uint8Array; text?: string }[]): C64uRunMeFirst | null {
  let best: C64uRunMeFirst | null = null;
  for (const f of files) {
    if (!isC64uReuCfgName(f.name)) continue;
    const text = f.text ?? (f.data ? decodeText(f.data) : "");
    if (!looksLikeC64uReuCfg(text)) continue;
    const parsed = parseC64uRunMeFirst(text);
    if (parsed.reuSizeKb != null || parsed.preloadImage || parsed.reuEnabled != null) {
      best = parsed;
      if (parsed.reuSizeKb != null) return parsed;
    }
  }
  return best;
}

function sameDir(a: string, b: string): boolean {
  return fileParentDir(a) === fileParentDir(b);
}

function stemPrefixScore(boot: string, reuName: string): number {
  const a = reuStem(boot);
  const b = reuStem(reuName);
  if (!a || !b || a === b) return a && b && a === b ? 40 : 0;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 3 || !long.startsWith(short)) return 0;
  const bootHasReu = /reu/i.test(fileBaseName(boot));
  if (short.length < 4 && !bootHasReu) return 0;
  return 70 + Math.min(short.length, 20);
}

/**
 * Pick a .reu to preload with a program — same-basename, zip sibling, C64U cfg,
 * or a stem match (blu.reu next to BluREU_Crest.prg). Never per-title hardcoded.
 */
export function pickCompanionReu(input: {
  bootName: string;
  parts?: ReuCandidate[];
  library?: ReuCandidate[];
  armed?: ReuCandidate | null;
}): ReuPick | null {
  const boot = input.bootName;
  const pool = [...(input.parts ?? []), ...(input.library ?? [])];
  const cfg = cfgFromFiles(pool);
  const reus = pool.filter((f) => isReuImageName(f.name) && !isNuvieReuName(f.name) && f.data?.byteLength);
  if (input.armed?.data?.byteLength && !isNuvieReuName(input.armed.name)) {
    return { candidate: input.armed, reason: "armed", cfg, score: 200 };
  }
  if (!reus.length) return null;

  const bootBase = fileBaseName(boot).replace(/\.[^.]+$/, "");
  const wantExact = `${bootBase}.reu`.toLowerCase();
  const preloadBase = cfg?.preloadImage ? fileBaseName(cfg.preloadImage).toLowerCase() : "";

  const ranked: ReuPick[] = [];
  const consider = (candidate: ReuCandidate, score: number, reason: string) => {
    if (score > 0) ranked.push({ candidate, reason, cfg, score });
  };

  for (const reu of reus) {
    const base = fileBaseName(reu.name).toLowerCase();
    if (base === wantExact) consider(reu, 100, "same-basename");
    if (preloadBase && (base === preloadBase || reuStem(reu.name) === reuStem(preloadBase))) {
      consider(reu, 90, "cfg-preload");
    }
    const stem = stemPrefixScore(boot, reu.name);
    if (stem) consider(reu, stem, "stem");
  }

  const dirReus = reus.filter((r) => sameDir(r.name, boot) && fileParentDir(boot));
  if (dirReus.length === 1) consider(dirReus[0]!, 80, "same-folder");

  const cfgFiles = pool.filter((f) => isC64uReuCfgName(f.name));
  if (cfg && cfgFiles.length) {
    const cfgDir = fileParentDir(cfgFiles[0]!.name);
    const near = cfgDir ? reus.filter((r) => fileParentDir(r.name) === cfgDir) : reus;
    if (near.length === 1) consider(near[0]!, 75, "cfg-neighbor");
    if (reus.length === 1) consider(reus[0]!, 50, "cfg-only-reu");
  }

  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best && best.score >= 50 ? best : null;
}

export function resolveReuPlaySize(input: {
  bytes: number;
  cfg?: C64uRunMeFirst | null;
}): ReuSize {
  if (input.cfg?.reuSize && input.cfg.reuSize !== "none") return input.cfg.reuSize;
  return reuSizeFromByteLength(input.bytes);
}
