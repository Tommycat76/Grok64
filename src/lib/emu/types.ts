export type MediaKind =
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

export type MachineId =
  | "c64-auto"
  | "c64-pal"
  | "c64-ntsc"
  | "c64c-pal"
  | "c64-fast"
  | "scpu"
  | "c128"
  | "vic20"
  | "plus4"
  | "pet";

export type SidEngine = "ReSID" | "FastSID" | "ReSID-fp";
export type SidModel = "6581" | "8580" | "default";
export type DriveMode = "auto" | "true" | "fast";
export type VideoPref = "auto" | "pal" | "ntsc";
export type CorePref = "auto" | "accurate" | "fast";
export type JoyPort = 1 | 2;

export interface LibraryItem {
  id: string;
  name: string;
  kind: MediaKind;
  source: "bundled" | "local" | "cloud" | "catalog";
  size: number;
  addedAt: number;
  lastPlayed?: number;
  bundledPath?: string;
}

export interface StoredFile extends LibraryItem {
  data: ArrayBuffer;
}

export interface BundledTitle {
  id: string;
  name: string;
  kind: MediaKind;
  path: string;
  blurb: string;
  tag: "demo" | "game" | "utility" | "disk" | "cart" | "tape";
}

export interface ControlBinding {
  action: ActionId;
  keys: string[];
  padButtons: number[];
  padAxes: { axis: number; dir: -1 | 1 }[];
}

export type ActionId =
  | "up"
  | "down"
  | "left"
  | "right"
  | "fire"
  | "fire2"
  | "space"
  | "runstop"
  | "commodore"
  | "return";

export const RETRO_BTN = {
  B: 0,
  Y: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  A: 8,
  X: 9,
  L: 10,
  R: 11,
} as const;
