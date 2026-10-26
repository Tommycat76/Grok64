import type { RamEmu } from "./c64-memory";
import { readScreenText, screenRamShowsGeosCatalog } from "./screen-text";
import type { ReuSize } from "./types";

/** GEOS 2.0, Wheels, gateWay, etc. — boot via 1541-II + named LOAD (never LOAD"*"). */
export function isGeosFamilyDiskName(name: string): boolean {
  return /\.(d64|d81|g64|g71)$/i.test(name) && /geos|wheels|gateway|geo\s*boot/i.test(name);
}

/** Maurice Randall / Click Here Wheels 64 (GEOS successor). */
export function isWheelsDiskName(name: string): boolean {
  return /\.(d64|d81|g64)$/i.test(name) && /wheels/i.test(name);
}

/** Wheels requires RAM expansion (512K+ per Click Here docs). */
export const WHEELS_MIN_REU: ReuSize = "512kB";

/** Default when user has REU off — 2 MB is a safe VICE size for Wheels desktop. */
export const WHEELS_BOOT_REU: ReuSize = "2048kB";

const REU_RANK: Record<ReuSize, number> = {
  none: 0,
  "256kB": 1,
  "512kB": 2,
  "2048kB": 3,
  "16384kB": 4,
};

/** Pick REU for a GEOS-family disk; Wheels bumps sub-512K settings. */
export function reuForGeosFamilyDisk(fileName: string, current: ReuSize): ReuSize {
  if (!isWheelsDiskName(fileName)) return current;
  if (REU_RANK[current] >= REU_RANK[WHEELS_MIN_REU]) return current;
  return WHEELS_BOOT_REU;
}

export function geosFamilyLoadMs(fileName: string): number {
  return isWheelsDiskName(fileName) ? 55_000 : 48_000;
}

export function geosFamilyPlayLockMs(fileName: string): number {
  return isWheelsDiskName(fileName) ? 70_000 : 55_000;
}

/** Text heuristics for desktop QA (Wheels is mostly graphical). */
/** BASIC READY after a GEOS boot attempt means the OS did not stay up. */
export function geosBootStuckAtBasic(screen: string): boolean {
  const tail = screen.split("\n").slice(-10).join("\n");
  const compact = tail.replace(/\s+/g, " ").trim();
  return (
    /COMMODORE 64 BASIC/i.test(tail) &&
    /\bREADY\b/i.test(tail) &&
    (/^READY\.?$/i.test(compact) || compact.length < 120)
  );
}

export function geosFamilyDesktopOk(screen: string, fileName?: string): boolean {
  const bad = /FILE NOT FOUND|DEVICE NOT PRESENT|I\/O ERROR/i.test(screen);
  if (bad) return false;
  if (fileName && isWheelsDiskName(fileName)) {
    if (/REU|RAM\s*EXPANS|NO\s*REU|EXPANSION\s*NOT/i.test(screen)) return false;
    return /WHEELS|DASH\s*BOARD|DASHBOARD|TOOL\s*BOX|CLICK\s*HERE|GEOS/i.test(screen);
  }
  return /GEOS|DESK|INFO|DIRECTORY|GEODISC|GEOSDISK|deskTop|DISK\s+(NOT\s+)?(READY|FULL)/i.test(screen);
}

export function geosBootSucceeded(screen: string, fileName?: string): boolean {
  if (geosBootStuckAtBasic(screen)) return false;
  const tail = screen.split("\n").slice(-14).join("\n");
  return geosFamilyDesktopOk(tail, fileName);
}

/** Preferred LOAD line for GEOS-family system disks (GEOS 2.0 vs Wheels). */
export function geosBootLoadLine(fileName: string): string {
  return geosBootLoadCandidates(fileName)[0];
}

/** Try in order until one loads (fixture / mastering varies). */
export function geosBootLoadCandidates(fileName: string): string[] {
  if (isWheelsDiskName(fileName)) return ['LOAD"GEOS",8,1', 'LOAD"RBOOT",8,1'];
  return ['LOAD"GEOS",8,1', 'LOAD"RBOOT",8,1'];
}

/** After RUN, GEOS deskTop is graphical — KERNAL screen text may be garbage. */
export function geosBootLooksLaunched(screen: string): boolean {
  const tail = screen.split("\n").slice(-14).join("\n");
  if (/FILE NOT FOUND|DEVICE NOT PRESENT|I\/O ERROR|SYNTAX\s+ERROR/i.test(tail)) return false;
  if (/SEARCHING FOR|LOADING|LOAD"/i.test(tail)) return false;
  if (geosBootStuckAtBasic(tail)) return false;
  return /GEOS|DESK|DISK|DIRECTORY|GEODISC|WHEELS|deskTop/i.test(tail);
}

/**
 * GEOS stock JOYSTICK driver reads the CIA port where the 1351 lives (saved mouse
 * port). Engage host joystick override only while a GEOS-family system disk is
 * active and the machine is past BASIC/LOAD — not for opposite-port games.
 */
export function geosHostStickOverrideWanted(
  emu: RamEmu | null,
  insertedDiskName: string | null | undefined,
): boolean {
  const disk = (insertedDiskName || "").trim();
  if (!emu || !disk || !isGeosFamilyDiskName(disk)) return false;
  const screen = readScreenText(emu);
  if (geosBootStuckAtBasic(screen)) return false;
  if (/FILE NOT FOUND|DEVICE NOT PRESENT|I\/O ERROR/i.test(screen)) return false;
  if (/SEARCHING FOR|LOADING|LOAD"/i.test(screen)) return false;
  if (geosBootSucceeded(screen, disk) || geosBootLooksLaunched(screen)) return true;
  if (screenRamShowsGeosCatalog(emu)) return true;
  return false;
}
