import type { ReuSize } from "./types";

/** GEOS 2.0, Wheels, gateWay, etc. — boot via 1541-II + LOAD"*",8,1. */
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
  const compact = screen.replace(/\s+/g, " ").trim();
  return (
    /COMMODORE 64 BASIC/i.test(screen) &&
    /\bREADY\b/i.test(screen) &&
    (/^READY\.?$/i.test(compact) || compact.length < 240)
  );
}

export function geosFamilyDesktopOk(screen: string, fileName?: string): boolean {
  const bad = /FILE NOT FOUND|DEVICE NOT PRESENT|I\/O ERROR/i.test(screen);
  if (bad) return false;
  if (fileName && isWheelsDiskName(fileName)) {
    if (/REU|RAM\s*EXPANS|NO\s*REU|EXPANSION\s*NOT/i.test(screen)) return false;
    return /WHEELS|DASH\s*BOARD|DASHBOARD|TOOL\s*BOX|CLICK\s*HERE|GEOS/i.test(screen);
  }
  return /GEOS|DESK|INFO|DISK|DIRECTORY|GEODISC|GEOSDISK|64\s*K|deskTop/i.test(screen);
}

export function geosBootSucceeded(screen: string, fileName?: string): boolean {
  if (geosBootStuckAtBasic(screen)) return false;
  return geosFamilyDesktopOk(screen, fileName);
}

/** Preferred LOAD line for GEOS-family system disks (GEOS 2.0 vs Wheels). */
export function geosBootLoadLine(fileName: string): string {
  if (isWheelsDiskName(fileName)) return 'LOAD"*",8,1';
  return 'LOAD"GEOS",8,1';
}

/** After RUN, GEOS deskTop is graphical — KERNAL screen text may be garbage. */
export function geosBootLooksLaunched(screen: string): boolean {
  if (/FILE NOT FOUND|DEVICE NOT PRESENT|I\/O ERROR|SYNTAX\s+ERROR/i.test(screen)) return false;
  if (geosBootStuckAtBasic(screen)) return false;
  const compact = screen.replace(/\s+/g, "");
  return compact.length > 40 && !/^READY\.?$/i.test(compact);
}
