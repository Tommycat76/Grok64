/** Convert a PSID/RSID tune into a C64 PRG that inits and plays it under VICE. */

export type SidVideo = "pal" | "ntsc" | "both" | "unknown";

interface PsidInfo {
  load: number;
  init: number;
  play: number;
  songs: number;
  start: number;
  data: Uint8Array;
  name: string;
  author: string;
  video: SidVideo;
}

function be16(v: DataView, o: number) {
  return v.getUint16(o);
}

function cstring(bytes: Uint8Array, start: number, len: number) {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = bytes[start + i] ?? 0;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function sidVideo(sid: Uint8Array, version: number): SidVideo {
  if (version < 2 || sid.length < 0x78) return "unknown";
  const flags = (sid[0x76]! << 8) | sid[0x77]!;
  const bits = (flags >> 2) & 0x3;
  if (bits === 1) return "pal";
  if (bits === 2) return "ntsc";
  if (bits === 3) return "both";
  return "unknown";
}

export function parsePsid(sid: Uint8Array): PsidInfo | null {
  if (sid.length < 0x76) return null;
  const magic = String.fromCharCode(sid[0]!, sid[1]!, sid[2]!, sid[3]!);
  if (magic !== "PSID" && magic !== "RSID") return null;
  const v = new DataView(sid.buffer, sid.byteOffset, sid.byteLength);
  const version = be16(v, 4);
  const dataOff = be16(v, 6);
  let load = be16(v, 8);
  const init = be16(v, 10);
  const play = be16(v, 12);
  const songs = Math.max(1, be16(v, 14));
  const start = Math.max(1, be16(v, 16));
  if (dataOff < 0x76 || dataOff >= sid.length) return null;
  let payload = sid.subarray(dataOff);
  if (load === 0) {
    if (payload.length < 2) return null;
    load = payload[0]! | (payload[1]! << 8);
    payload = payload.subarray(2);
  }
  if (load < 0x0200 || load > 0xff00) return null;
  if (payload.length < 1 || load + payload.length > 0x10000) return null;
  const nameOff = version >= 2 ? 0x16 : 0x16;
  return {
    load,
    init: init || load,
    play,
    songs,
    start,
    data: payload,
    name: cstring(sid, nameOff, 32),
    author: cstring(sid, nameOff + 32, 32),
    video: sidVideo(sid, version),
  };
}

function basicSys(addr: number): Uint8Array {
  const digits = String(addr).split("").map((d) => d.charCodeAt(0));
  const next = 0x0801 + 2 + 2 + 1 + digits.length + 1;
  const out = new Uint8Array(2 + 2 + 1 + digits.length + 1 + 2);
  out[0] = next & 0xff;
  out[1] = next >> 8;
  out[2] = 10;
  out[3] = 0;
  out[4] = 0x9e;
  out.set(digits, 5);
  out[5 + digits.length] = 0;
  return out;
}

function playerAt(base: number, init: number, play: number, song: number): Uint8Array {
  const songVal = Math.max(0, song - 1) & 0xff;
  const loop = base + 0x2a;
  const irq = base + 0x2d;
  if (play === 0) {
    return Uint8Array.from([
      0x78,
      0xa9, songVal,
      0x20, init & 0xff, init >> 8,
      0x58,
      0x4c, (base + 7) & 0xff, (base + 7) >> 8,
    ]);
  }
  return Uint8Array.from([
    0x78,
    0xa9, songVal,
    0x20, init & 0xff, init >> 8,
    0xa9, irq & 0xff,
    0x8d, 0x14, 0x03,
    0xa9, irq >> 8,
    0x8d, 0x15, 0x03,
    0xa9, 0x7f,
    0x8d, 0x0d, 0xdc,
    0x8d, 0x0d, 0xdd,
    0xad, 0x0d, 0xdc,
    0xad, 0x0d, 0xdd,
    0xa9, 0x01,
    0x8d, 0x1a, 0xd0,
    0xa9, 0x00,
    0x8d, 0x12, 0xd0,
    0xa9, 0x1b,
    0x8d, 0x11, 0xd0,
    0x58,
    0x4c, loop & 0xff, loop >> 8,
    0xa9, 0xff,
    0x8d, 0x19, 0xd0,
    0x20, play & 0xff, play >> 8,
    0x4c, 0x81, 0xea,
  ]);
}

export function psidToPrg(sid: Uint8Array, song?: number): Uint8Array {
  const info = parsePsid(sid);
  if (!info) throw new Error("Not a SID tune (PSID/RSID).");
  const playerAddr = 0xc000;
  const player = playerAt(playerAddr, info.init, info.play, song ?? info.start);
  const sidEnd = info.load + info.data.length;
  const playerEnd = playerAddr + player.length;
  const overlaps = info.load < playerEnd && sidEnd > playerAddr;
  if (overlaps) {
    throw new Error("This SID overlaps the player stub — try another tune.");
  }
  const lo = 0x0801;
  const hi = Math.max(playerEnd, sidEnd, lo + 16);
  if (hi - lo > 0xdc00) throw new Error("SID image is too large to wrap as a PRG.");
  const body = new Uint8Array(hi - lo);
  const stub = basicSys(playerAddr);
  body.set(stub, 0);
  body.set(player, playerAddr - lo);
  body.set(info.data, info.load - lo);
  const prg = new Uint8Array(2 + body.length);
  prg[0] = lo & 0xff;
  prg[1] = lo >> 8;
  prg.set(body, 2);
  return prg;
}

export function isSid(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const magic = String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!);
  return magic === "PSID" || magic === "RSID";
}
