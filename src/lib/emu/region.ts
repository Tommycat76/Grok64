import type { VideoHz } from "./detect";
import type { JoyPort } from "./types";
import { parsePsid } from "./psid";

export const DEFAULT_VIDEO: VideoHz = "pal";

export type VideoSource = "software" | "override" | "default";

const EXPLICIT_PAL =
  /(?:^|[^a-z0-9])pal(?:[-_ ]?(?:b|n|m|i))?(?:[^a-z0-9]|$)/i;
const EXPLICIT_NTSC = /(?:^|[^a-z0-9])ntsc(?:[-_ ]?[uj])?(?:[^a-z0-9]|$)/i;
const BRACKET_VIDEO = /[\[{(]\s*(ntsc|pal)\s*[\]})]/i;

const COUNTRY_PAL =
  /\((?:europe|eur|uk|england|great britain|gb|germany|ger|deutschland|france|fr|italy|it|spain|es|netherlands|holland|nl|sweden|se|finland|fi|denmark|dk|norway|no|australia|aus|austria|switzerland|poland|hungary|belgium|portugal|ireland|new zealand|nz)\)/i;
const COUNTRY_NTSC = /\((?:usa|us|canada|can|japan|jp|america|north america)\)/i;

function fold(s: string): string {
  return s
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function haystack(names: string[]): string {
  return names.filter(Boolean).map(fold).join(" · ");
}

function sidStandard(data?: Uint8Array): VideoHz | "both" | null {
  if (!data) return null;
  const info = parsePsid(data);
  if (!info) return null;
  if (info.video === "pal" || info.video === "ntsc") return info.video;
  if (info.video === "both") return "both";
  return null;
}

function asciiHit(data: Uint8Array, phrase: string): boolean {
  const target = phrase.toUpperCase();
  const n = target.length;
  if (data.length < n) return false;
  const limit = Math.min(data.length, 96 * 1024);
  outer: for (let i = 0; i <= limit - n; i++) {
    for (let j = 0; j < n; j++) {
      const c = data[i + j]!;
      const up = c >= 97 && c <= 122 ? c - 32 : c;
      if (up !== target.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

export interface SoftwareHint {
  names?: Array<string | null | undefined>;
  data?: Uint8Array | ArrayBuffer | null;
}

/** [NTSC] / (PAL) / {NTSC} on the filename, plus existing PAL/NTSC tokens. */
export function filenameVideoTag(names: Array<string | null | undefined>): VideoHz | null {
  let pal = false;
  let ntsc = false;
  for (const name of names) {
    if (!name) continue;
    const base = name.replace(/\.[a-z0-9]{2,4}$/i, "");
    const bracket = base.match(BRACKET_VIDEO);
    if (bracket) {
      if (/^ntsc$/i.test(bracket[1]!)) ntsc = true;
      else pal = true;
    }
    const folded = fold(name);
    if (EXPLICIT_PAL.test(folded)) pal = true;
    if (EXPLICIT_NTSC.test(folded)) ntsc = true;
  }
  if (pal && !ntsc) return "pal";
  if (ntsc && !pal) return "ntsc";
  return null;
}

export function detectSoftwareStandard(hint: SoftwareHint | string): VideoHz | null {
  const names = typeof hint === "string" ? [hint] : (hint.names ?? []);
  const raw =
    typeof hint === "string"
      ? undefined
      : hint.data instanceof ArrayBuffer
        ? new Uint8Array(hint.data)
        : hint.data ?? undefined;
  const text = haystack(names.map((n) => n ?? ""));
  if (!text && !raw) return null;

  const tagged = filenameVideoTag(names);
  if (tagged) return tagged;

  const palName = EXPLICIT_PAL.test(text);
  const ntscName = EXPLICIT_NTSC.test(text);
  if (palName && !ntscName) return "pal";
  if (ntscName && !palName) return "ntsc";

  const sid = sidStandard(raw);
  if (sid === "pal" || sid === "ntsc") return sid;

  const palCountry = COUNTRY_PAL.test(text);
  const ntscCountry = COUNTRY_NTSC.test(text);
  if (palCountry && !ntscCountry) return "pal";
  if (ntscCountry && !palCountry) return "ntsc";

  if (raw) {
    const palStr = asciiHit(raw, "PAL VERSION") || asciiHit(raw, "PAL ONLY") || asciiHit(raw, "MADE FOR PAL");
    const ntscStr =
      asciiHit(raw, "NTSC VERSION") || asciiHit(raw, "NTSC ONLY") || asciiHit(raw, "MADE FOR NTSC");
    if (palStr && !ntscStr) return "pal";
    if (ntscStr && !palStr) return "ntsc";
  }

  if (sid === "both") return null;

  return null;
}

const PORT1_TITLES = ["boulder dash", "boulderdash", "rockford"];

function joyKnownHit(text: string, titles: string[]): boolean {
  return titles.some((t) => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flexible = escaped.replace(/ /g, "[\\s._-]*");
    const gluedLen = t.replace(/[\s._-]+/g, "").length;
    const tail = gluedLen >= 6 ? "" : "(?:[^a-z0-9]|$)";
    return new RegExp(`(?:^|[^a-z0-9])${flexible}${tail}`, "i").test(text);
  });
}

export function detectJoyPort(hint: SoftwareHint | string): JoyPort {
  const names = typeof hint === "string" ? [hint] : (hint.names ?? []);
  const text = haystack(names.map((n) => n ?? ""));
  if (joyKnownHit(text, PORT1_TITLES)) return 1;
  return 2;
}

export function resolveSoftwareVideo(hint: SoftwareHint | string): VideoHz {
  return detectSoftwareStandard(hint) ?? DEFAULT_VIDEO;
}

/** Short badge for catalog rows — null when unknown (VICE PAL default at boot). */
export function regionBadge(hint: SoftwareHint | string): "PAL" | "NTSC" | null {
  const v = detectSoftwareStandard(hint);
  if (v === "pal") return "PAL";
  if (v === "ntsc") return "NTSC";
  return null;
}

export function regionHintText(hint: SoftwareHint | string): string | null {
  const badge = regionBadge(hint);
  if (!badge) return null;
  return badge === "NTSC" ? "NTSC 60 Hz" : "PAL 50 Hz";
}
