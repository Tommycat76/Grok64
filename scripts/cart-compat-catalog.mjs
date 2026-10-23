/**
 * Cartridge compatibility matrix catalog — fixtures from Internet Archive
 * C64-CRT-Collection (see scripts/fetch-fixtures.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FIX = join(process.cwd(), "fixtures", "carts");

/** @typedef {"stock"|"jiffy"} KernalMode */

/**
 * @typedef CartEntry
 * @property {string} id
 * @property {string} label
 * @property {string} fixture — basename under fixtures/carts/
 * @property {RegExp} zipPattern — match inside C64-CRT-collection.zip
 * @property {string|null} expectedKind — FastLoadCartKind from jiffy-cart-compat
 * @property {RegExp} menuRe — title/menu heuristics on screen text
 * @property {boolean} freezer
 * @property {boolean} gameLoad — run boulder-dash through cart when disk present
 * @property {"incompatible"|"caution"|"compatible"|"redundant"} jiffyLevel
 * @property {boolean} jiffySuppress — resolveJiffyWant should force Jiffy off
 * @property {string} [notes]
 */

export const CART_COMPAT_CATALOG = /** @type {CartEntry[]} */ ([
  {
    id: "ss5",
    label: "Super Snapshot v5.00 NTSC",
    fixture: "ss5.crt",
    zipPattern: /Super_Snapshot_v5\.00_1990_NTSC/i,
    expectedKind: "super-snapshot-5",
    menuRe: /SNAPSHOT|SUPER|FREEZE|TURBO|SS\s*5|MENU/i,
    freezer: true,
    gameLoad: false,
    jiffyLevel: "incompatible",
    jiffySuppress: true,
    notes: "Tom priority — menu, freeze, fast load, monitor (floppy game under SS not auto-tested)",
  },
  {
    id: "ss4",
    label: "Super Snapshot v4.0 NTSC",
    fixture: "ss4.crt",
    zipPattern: /Super_Snapshot_v4\.0_1989_NTSC/i,
    expectedKind: "super-snapshot-4",
    menuRe: /SNAPSHOT|SUPER|FREEZE|TURBO|MENU/i,
    freezer: true,
    gameLoad: false,
    jiffyLevel: "incompatible",
    jiffySuppress: true,
  },
  {
    id: "epyx-fl",
    label: "Epyx FastLoad v1",
    fixture: "epyx-fastload.crt",
    zipPattern: /Epyx_FastLoad_1984_v1/i,
    expectedKind: "epyx-fastload",
    menuRe: /FAST\s*LOAD|EPYX|READY/i,
    freezer: false,
    gameLoad: true,
    jiffyLevel: "redundant",
    jiffySuppress: false,
  },
  {
    id: "ar6",
    label: "Action Replay v6.0 PAL",
    fixture: "ar6.crt",
    zipPattern: /Action_Replay_V6\.0_6\.0_1989_PAL/i,
    expectedKind: "action-replay",
    menuRe: /REPLAY|ACTION|AR\s|FREEZE|READY/i,
    freezer: true,
    gameLoad: false,
    jiffyLevel: "caution",
    jiffySuppress: false,
  },
  {
    id: "ar5",
    label: "Action Replay v5.0 PAL",
    fixture: "ar5.crt",
    zipPattern: /Action_Replay_V5\.0_5\.0_1988_PAL\.crt$/i,
    expectedKind: "action-replay",
    menuRe: /REPLAY|ACTION|FREEZE/i,
    freezer: true,
    gameLoad: false,
    jiffyLevel: "caution",
    jiffySuppress: false,
  },
  {
    id: "ar4",
    label: "Action Replay MK4 1988 PAL",
    fixture: "ar4.crt",
    zipPattern: /Action_Replay_MK4_1988_PAL/i,
    expectedKind: "action-replay",
    menuRe: /REPLAY|ACTION|FREEZE/i,
    freezer: true,
    gameLoad: false,
    jiffyLevel: "caution",
    jiffySuppress: false,
  },
  {
    id: "fc3",
    label: "Final Cartridge III v1",
    fixture: "fc3.crt",
    zipPattern: /Final_Cartridge_3_1987-09_v1/i,
    expectedKind: "final-cartridge-3",
    menuRe: /FINAL|CARTRIDGE|FC|FREEZE|READY/i,
    freezer: true,
    gameLoad: false,
    jiffyLevel: "compatible",
    jiffySuppress: false,
  },
  {
    id: "fc2",
    label: "Final Cartridge II 1987",
    fixture: "fc2.crt",
    zipPattern: /Final_Cartridge_2_1987\.crt$/i,
    expectedKind: "final-cartridge-2",
    menuRe: /FINAL|CARTRIDGE|FREEZE/i,
    freezer: true,
    gameLoad: false,
    jiffyLevel: "caution",
    jiffySuppress: false,
  },
  {
    id: "fc1",
    label: "Final Cartridge I v1 1986",
    fixture: "fc1.crt",
    zipPattern: /Final_Cartridge_1_v1_1986/i,
    expectedKind: "final-cartridge-1",
    menuRe: /FINAL|CARTRIDGE|KILLER|FREEZE/i,
    freezer: true,
    gameLoad: false,
    jiffyLevel: "caution",
    jiffySuppress: false,
  },
  {
    id: "kcs",
    label: "KCS Power Cartridge 1985 v1",
    fixture: "kcs-power.crt",
    zipPattern: /KCS_Power_Cartridge_1985_v1/i,
    expectedKind: "kcs-power",
    menuRe: /KCS|POWER|CARTRIDGE|READY/i,
    freezer: false,
    gameLoad: true,
    jiffyLevel: "caution",
    jiffySuppress: false,
  },
  {
    id: "warp",
    label: "Warp Speed v1 1987",
    fixture: "warp-speed.crt",
    zipPattern: /WarpSpeed_v1_1987/i,
    expectedKind: "warp-speed",
    menuRe: /WARP|SPEED|READY/i,
    freezer: false,
    gameLoad: true,
    jiffyLevel: "caution",
    jiffySuppress: false,
  },
  {
    id: "easyflash",
    label: "EasyFlash (macks-easyflash)",
    fixture: "easyflash.crt",
    zipPattern: /macks-easyflash/i,
    expectedKind: "other-fastload",
    menuRe: /EASY|FLASH|READY|MENU/i,
    freezer: false,
    gameLoad: false,
    jiffyLevel: "caution",
    jiffySuppress: false,
    notes: "Flash cart — menu varies by flashed image; boot smoke only",
  },
  // Not in IA zip — documented as missing fixtures
  {
    id: "retro-replay",
    label: "Retro Replay",
    fixture: "retro-replay.crt",
    zipPattern: /superfluid-0\.8-rr_menu|retro-replay/i,
    expectedKind: "other-fastload",
    menuRe: /REPLAY|RETRO/i,
    freezer: true,
    gameLoad: false,
    jiffyLevel: "caution",
    jiffySuppress: false,
    notes: "IA superfluid RR menu CRT; optional retro-replay-rom.crt from CSDb ROM",
  },
  {
    id: "expert",
    label: "Expert Cartridge",
    fixture: "expert.crt",
    zipPattern: /Expert\.crt/i,
    expectedKind: "other-fastload",
    menuRe: /EXPERT/i,
    freezer: true,
    gameLoad: false,
    jiffyLevel: "caution",
    jiffySuppress: false,
    notes: "PvdP-CRT-collection.zip",
  },
  {
    id: "simons-basic",
    label: "Simons' BASIC",
    fixture: "simons-basic.crt",
    zipPattern: /SIMONBAS/i,
    expectedKind: "other-fastload",
    menuRe: /SIMON|BASIC/i,
    freezer: false,
    gameLoad: false,
    jiffyLevel: "compatible",
    jiffySuppress: false,
    notes: "PvdP-CRT-collection.zip",
  },
  {
    id: "magic-desk",
    label: "Magic Desk",
    fixture: "magic-desk.crt",
    zipPattern: /magic_desk/i,
    expectedKind: "other-fastload",
    menuRe: /MAGIC|DESK/i,
    freezer: false,
    gameLoad: false,
    jiffyLevel: "compatible",
    jiffySuppress: false,
    notes: "PvdP-CRT-collection.zip",
  },
]);

export function cartFixturePath(entry) {
  return join(FIX, entry.fixture);
}

export function cartPlayName(entry) {
  const src = join(FIX, entry.fixture.replace(/\.crt$/i, ".source.txt"));
  if (existsSync(src)) {
    const line = readFileSync(src, "utf8").trim();
    if (line) return line.split("/").pop() ?? entry.fixture;
  }
  return entry.fixture;
}

export function cartFixturePresent(entry) {
  return existsSync(cartFixturePath(entry));
}
