import { parseSid } from "./sid";
import type { JoyPort } from "./types";

const PAL_TAG = /(?:^|[^a-z0-9])pal(?:[-_ ]?(?:b|n|m|i))?(?:[^a-z0-9]|$)/i;
const NTSC_TAG = /(?:^|[^a-z0-9])ntsc(?:[-_ ]?[uj])?(?:[^a-z0-9]|$)/i;
const EUR =
  /\((?:europe|eur|uk|england|great britain|gb|germany|ger|deutschland|france|fr|italy|it|spain|es|netherlands|holland|nl|sweden|se|finland|fi|denmark|dk|norway|no|australia|aus|austria|switzerland|poland|hungary|belgium|portugal|ireland|new zealand|nz)\)/i;
const US = /\((?:usa|us|canada|can|japan|jp|america|north america)\)/i;
const NTSC_TITLES =
  "m.u.l.e.,m.u.l.e,mule,archon,archon ii,ghostbusters,summer games,winter games,world games,california games,impossible mission,boulder dash,rockford,lode runner,jumpman,racing destruction set,seven cities of gold,heart of africa,mail order monsters,little computer people,bard's tale,bards tale,wasteland,raid on bungeling bay,pitstop,epyx fast load".split(
    ",",
  );
const PAL_TITLES =
  "last ninja.turrican.wizball.paradroid.uridium.international karate.great giana sisters.giana sisters.creatures.mayhem in monsterland.monty on the run.auf wiedersehen monty.sanxion.cybernoid.armalyte.hawkeye.the sentinel.head over heels.green beret.turbo outrun.ghouls 'n' ghosts.ghouls n ghosts.bionic commando.comic bakery.ocean loader.myth".split(
    ".",
  );

function fold(s: string) {
  return s
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hay(names: (string | undefined)[]) {
  return names.filter(Boolean).map((n) => fold(n!)).join(" · ");
}

function titled(haystack: string, list: string[]) {
  return list.some((t) => {
    const n = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s._-]*");
    const tail = t.replace(/[\s._-]+/g, "").length >= 6 ? "" : "(?:[^a-z0-9]|$)";
    return new RegExp(`(?:^|[^a-z0-9])${n}${tail}`, "i").test(haystack);
  });
}

function scanAscii(data: Uint8Array, needle: string) {
  const n = needle.toUpperCase();
  const r = n.length;
  if (data.length < r) return false;
  const lim = Math.min(data.length, 98304);
  outer: for (let i = 0; i <= lim - r; i++) {
    for (let j = 0; j < r; j++) {
      let b = data[i + j]!;
      if (b >= 97 && b <= 122) b -= 32;
      if (b !== n.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

export function detectSoftwareStandard(input: {
  names?: (string | undefined)[];
  data?: ArrayBuffer | Uint8Array;
} | string): "pal" | "ntsc" | null {
  const names = typeof input === "string" ? [input] : (input.names ?? []);
  const raw =
    typeof input === "string"
      ? undefined
      : input.data instanceof ArrayBuffer
        ? new Uint8Array(input.data)
        : input.data;
  const h = hay(names);
  if (!h && !raw) return null;
  const palTag = PAL_TAG.test(h);
  const ntscTag = NTSC_TAG.test(h);
  if (palTag && !ntscTag) return "pal";
  if (ntscTag && !palTag) return "ntsc";
  const sid = raw ? parseSid(raw) : null;
  if (sid?.video === "pal" || sid?.video === "ntsc") return sid.video;
  const eur = EUR.test(h);
  const us = US.test(h);
  if (eur && !us) return "pal";
  if (us && !eur) return "ntsc";
  if (raw) {
    const p = scanAscii(raw, "PAL VERSION") || scanAscii(raw, "PAL ONLY") || scanAscii(raw, "MADE FOR PAL");
    const n = scanAscii(raw, "NTSC VERSION") || scanAscii(raw, "NTSC ONLY") || scanAscii(raw, "MADE FOR NTSC");
    if (p && !n) return "pal";
    if (n && !p) return "ntsc";
  }
  if (sid?.video === "both") return null;
  if (titled(h, NTSC_TITLES) && !titled(h, PAL_TITLES)) return "ntsc";
  if (titled(h, PAL_TITLES) && !titled(h, NTSC_TITLES)) return "pal";
  return null;
}

const PORT1 = ["boulder dash", "boulderdash", "rockford"];

export function detectJoyPort(input: { names?: (string | undefined)[] } | string): JoyPort {
  const names = typeof input === "string" ? [input] : (input.names ?? []);
  return titled(hay(names), PORT1) ? 1 : 2;
}
