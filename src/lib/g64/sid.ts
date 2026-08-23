function u16(v: DataView, o: number) {
  return v.getUint16(o);
}
function cstr(e: Uint8Array, o: number, n: number) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const b = e[o + i] ?? 0;
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s.trim();
}

export interface SidTune {
  load: number;
  init: number;
  play: number;
  songs: number;
  start: number;
  data: Uint8Array;
  name: string;
  author: string;
  video: "pal" | "ntsc" | "both" | "unknown";
}

function sidVideo(e: Uint8Array, version: number): SidTune["video"] {
  if (version < 2 || e.length < 120) return "unknown";
  const n = (((e[118]! << 8) | e[119]!) >> 2) & 3;
  return n === 1 ? "pal" : n === 2 ? "ntsc" : n === 3 ? "both" : "unknown";
}

export function parseSid(e: Uint8Array): SidTune | null {
  if (e.length < 118) return null;
  const mag = String.fromCharCode(e[0]!, e[1]!, e[2]!, e[3]!);
  if (mag !== "PSID" && mag !== "RSID") return null;
  const n = new DataView(e.buffer, e.byteOffset, e.byteLength);
  const version = u16(n, 4);
  const dataOff = u16(n, 6);
  let load = u16(n, 8);
  const init = u16(n, 10);
  const play = u16(n, 12);
  const songs = Math.max(1, u16(n, 14));
  const start = Math.max(1, u16(n, 16));
  if (dataOff < 118 || dataOff >= e.length) return null;
  let data = e.subarray(dataOff);
  if (load === 0) {
    if (data.length < 2) return null;
    load = data[0]! | (data[1]! << 8);
    data = data.subarray(2);
  }
  if (load < 512 || load > 65280 || data.length < 1 || load + data.length > 65536) return null;
  return {
    load,
    init: init || load,
    play,
    songs,
    start,
    data,
    name: cstr(e, 22, 32),
    author: cstr(e, 54, 32),
    video: sidVideo(e, version),
  };
}

export function isSid(e: Uint8Array) {
  if (e.length < 4) return false;
  const mag = String.fromCharCode(e[0]!, e[1]!, e[2]!, e[3]!);
  return mag === "PSID" || mag === "RSID";
}

function sysLine(addr: number) {
  const t = String(addr)
    .split("")
    .map((c) => c.charCodeAt(0));
  const n = 2054 + t.length + 1;
  const r = new Uint8Array(5 + t.length + 1 + 2);
  r[0] = n & 255;
  r[1] = n >> 8;
  r[2] = 10;
  r[3] = 0;
  r[4] = 158;
  r.set(t, 5);
  r[5 + t.length] = 0;
  return r;
}

function playerStub(base: number, init: number, play: number, song: number) {
  const songByte = Math.max(0, song - 1) & 255;
  const loop = base + 42;
  const irq = base + 45;
  if (play === 0) {
    return Uint8Array.from([
      120, 169, songByte, 32, init & 255, init >> 8, 88, 76, (base + 7) & 255, (base + 7) >> 8,
    ]);
  }
  return Uint8Array.from([
    120, 169, songByte, 32, init & 255, init >> 8, 169, irq & 255, 141, 20, 3, 169, irq >> 8, 141,
    21, 3, 169, 127, 141, 13, 220, 141, 13, 221, 173, 13, 220, 173, 13, 221, 169, 1, 141, 26, 208,
    169, 0, 141, 18, 208, 169, 27, 141, 17, 208, 88, 76, loop & 255, loop >> 8, 169, 255, 141, 25,
    208, 32, play & 255, play >> 8, 76, 129, 234,
  ]);
}

/** Wrap a PSID/RSID as a PRG with a tiny player at $C000. */
export function wrapSid(raw: Uint8Array, song?: number) {
  const n = parseSid(raw);
  if (!n) throw new Error("Not a SID tune (PSID/RSID).");
  const stubAddr = 49152;
  const stub = playerStub(stubAddr, n.init, n.play, song ?? n.start);
  const dataEnd = n.load + n.data.length;
  const stubEnd = stubAddr + stub.length;
  if (n.load < stubEnd && dataEnd > stubAddr) {
    throw new Error("This SID overlaps the player stub — try another tune.");
  }
  const start = 2049;
  const end = Math.max(stubEnd, dataEnd, 2065);
  if (end - start > 56320) throw new Error("SID image is too large to wrap as a PRG.");
  const body = new Uint8Array(end - start);
  body.set(sysLine(stubAddr), 0);
  body.set(stub, 47103);
  body.set(n.data, n.load - start);
  const prg = new Uint8Array(2 + body.length);
  prg[0] = 1;
  prg[1] = 8;
  prg.set(body, 2);
  return prg;
}
