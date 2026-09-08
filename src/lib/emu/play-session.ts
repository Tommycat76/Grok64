import type { IecDrive, IecMap, IecSlot, IecUnit, MediaKind } from "./types";
import { IEC_UNITS } from "./types";
import { floppyPlayCanHotSwap, iecForAutostart, isFsWorkDisk, kindOf, needsTypedBoot } from "./formats";

/**
 * One play / IEC state machine.
 *
 * User preference (Settings / chips) is never silently overwritten.
 * Live attach is what the running VICE core actually has on the bus.
 *
 * C64 OS-class layout (official VICE guide):
 *   - Device 8 is a real 1541/1581 whenever Autostart must LOAD"*",8,1
 *   - CMD HD is a real VICE CMD HD (dosCMDHD.bin on the drive CPU, true
 *     drive ON, virtual traps OFF). Prefer unit 9 so floppy Play does not
 *     evict the HD.
 *   - SD2IEC is the virtual FAT card (VICE `N_fs` + partition files), NOT
 *     KERNAL SoftIEC / C64 Ultimate-style vector patches. Floppy Play may
 *     temporarily recycle unit 8 to a 1541; the card preference stays.
 *
 * Autostart is applied only after FS + ROMs + drive attach are ready.
 * Booting with vice_autostart=enabled is what froze CriOS (LOAD before
 * unit 8 exists, or Jiffy enabled without ROMs in the new core).
 */

export type PlayKind = "basic" | "floppy" | "prg" | "tape" | "cart" | "sid";

export type BusyPhase = "idle" | "boot" | "play" | "jiffy" | "rebuild" | "drive";

export interface DriveAttach {
  iec: IecDrive;
  unit: IecUnit;
}

export interface PlayPlan {
  kind: PlayKind;
  /** Settings — never mutated by Play. */
  user: DriveAttach;
  /** What the core must have while this title runs. */
  live: DriveAttach;
  /** Floppy Autostart attach (1541/1581 @ 8). */
  attach: DriveAttach | null;
  recycle: boolean;
  /** Always false at core-start; kicked after prepareCore. */
  autostartAfterReady: boolean;
  trueDrive: boolean;
  /** KERNAL SoftIEC hooks — always off. Real CMD / VICE FS only. */
  softIec: false;
  status: string;
}

export function playKindOf(filename: string, work: boolean): PlayKind {
  if (work) return "basic";
  const kind = kindOf(filename);
  if (needsTypedBoot(kind)) return "floppy";
  if (kind === "t64" || kind === "tap") return "tape";
  if (kind === "crt" || kind === "bin") return "cart";
  if (kind === "sid") return "sid";
  return "prg";
}

/** CMD HD on 9–11 leaves a real 1541 on 8 — floppy Play can hot-swap. */
export function cmdKeepsFloppyUnit8(user: DriveAttach): boolean {
  return user.iec === "cmdhd" && user.unit !== 8;
}

export function unit8IsRealFloppy(live: DriveAttach, liveWorkDisk?: string | null): boolean {
  if (live.unit !== 8) return false;
  if (live.iec === "sd2iec" || live.iec === "cmdhd") return false;
  if (isFsWorkDisk(liveWorkDisk)) return false;
  return live.iec === "1541" || live.iec === "1581";
}

export type RecycleExtra = {
  /**
   * CriOS floppy Autostart must never take the stale-session `hot-swap`
   * log → DNP. plan.recycle stays true so Play always attaches a real
   * 1541 #8. After READY, that recycle is in-place on the live canvas
   * (#18/#30). WASM destroyEmu after READY is known-failure #13.
   */
  iosPhone?: boolean;
  jiffyWant?: boolean;
  /** True only after ROMs landed in VICE FS and vice_jiffydos was enabled. */
  jiffyLive?: boolean;
};

/**
 * After Tom's #54 READY paints, Play must keep that WebGL canvas.
 * `#37` WASM-recycle (destroyEmu + second VICE) is black CRT → splash.
 * `#18`/`#30` attached the disk on the live core and games ran.
 */
export function iosPlayKeepsLiveCrt(input: {
  iosPhone?: boolean;
  hasLiveFs: boolean;
  kind: PlayKind;
}): boolean {
  if (!input.iosPhone || !input.hasLiveFs) return false;
  return input.kind === "floppy" || input.kind === "prg" || input.kind === "tape" || input.kind === "sid";
}

/** Cart / PRG / tape / SID must not WASM-recycle after READY (#13 / IM remount). */
export function iosInPlaceMediaKind(kind: PlayKind): boolean {
  return kind === "cart" || kind === "prg" || kind === "tape" || kind === "sid";
}

/**
 * After power-on, iOS Play of a live title must stay on the VICE instance.
 * Floppy stays unit-8 in-place. Cart/disk/PRG must not drop to the power splash.
 * WASM recycle / startWithUrl after READY is known-failure #13.
 */
export function iosMustKeepLiveCore(input: {
  iosPhone?: boolean;
  /** iPad — same splash remount as iPhone if Play WASM-recycles. */
  ios?: boolean;
  powered: boolean;
  hasEmu: boolean;
  kind: PlayKind;
}): boolean {
  return Boolean((input.iosPhone || input.ios) && input.powered && input.hasEmu && input.kind !== "basic");
}

/**
 * Catalog / folder Play while the C64 is already powered must wait for the
 * live core and attach in-place. A second startWithUrl aborts cold BASIC
 * (loadGen) and WASM-recycles to the power splash (#13).
 */
export function shouldWaitForLiveCore(input: {
  iosPhone?: boolean;
  ios?: boolean;
  powered: boolean;
  kind: PlayKind;
  work?: boolean;
}): boolean {
  if (input.work || input.kind === "basic") return false;
  if (!input.powered) return false;
  return Boolean(input.iosPhone || input.ios);
}

/** Explicit power / Reset / recover BASIC boot — never blocked by leftover play locks. */
export function isColdBasicStart(opts: { autostart?: boolean; title?: string | null }): boolean {
  return opts.autostart === false && isBasicTitle(opts.title);
}

/**
 * Please-hold is a DOM chip over a live CRT — dismiss as soon as boot has
 * settled, READY is running, or the live WebGL present has happened.
 * Do not wait on a timer that outlives READY.
 */
export function shouldDismissPictureHold(input: {
  hold: boolean;
  booting: boolean;
  running: boolean;
  paintSettled: boolean;
}): boolean {
  if (!input.hold) return false;
  if (input.paintSettled) return true;
  if (input.running && !input.booting) return true;
  return false;
}

const LIVE_PLAY_KEY = "g64-live-play";
let livePlayMem: string | null = null;

function isBasicTitle(title?: string | null): boolean {
  const t = (title || "").trim();
  return !t || t === "BASIC" || t === "BASIC READY";
}

/** Sticky across a React remount (sessionStorage + module). Cleared on Reset / power. */
export function markLivePlay(title?: string | null) {
  if (isBasicTitle(title)) return;
  const t = (title || "").trim();
  livePlayMem = t;
  try {
    sessionStorage.setItem(LIVE_PLAY_KEY, t);
  } catch {
    /* private mode */
  }
}

export function clearLivePlay() {
  livePlayMem = null;
  try {
    sessionStorage.removeItem(LIVE_PLAY_KEY);
  } catch {
    /* private mode */
  }
}

export function livePlayTitle(): string | null {
  if (livePlayMem) return livePlayMem;
  try {
    const stored = sessionStorage.getItem(LIVE_PLAY_KEY);
    if (stored) livePlayMem = stored;
    return stored;
  } catch {
    return null;
  }
}

export function hasLivePlay(title?: string | null): boolean {
  if (livePlayTitle()) return true;
  return !isBasicTitle(title);
}

/**
 * Mid-play / live-session must never drop `powered` back to the splash.
 * Only a failed *cold* BASIC start with no FS may remount the power button.
 * Refs reset to basic/!inGameplay on remount — live-play + title still refuse.
 */
export function shouldDropToSplash(input: {
  playMode: string;
  playLock: boolean;
  inGameplay: boolean;
  powered: boolean;
  hasFs: boolean;
  title?: string | null;
  livePlay?: boolean;
}): boolean {
  if (!input.powered) return false;
  if (input.playLock || input.inGameplay) return false;
  if (input.livePlay || livePlayTitle()) return false;
  if (!isBasicTitle(input.title)) return false;
  if (input.playMode !== "basic") return false;
  if (input.hasFs) return false;
  return true;
}

/**
 * iPhone startWithUrl must not recycle WASM after READY — including after a
 * remount that reset playModeRef to "basic" while a game title is still live.
 * Explicit cold BASIC (power / recover) must still be allowed to boot READY.
 */
export function shouldRefuseStartRecycle(input: {
  iosPhone?: boolean;
  powered: boolean;
  playMode: string;
  inGameplay: boolean;
  title?: string | null;
  livePlay?: boolean;
  coldBasic?: boolean;
}): boolean {
  if (!input.iosPhone || !input.powered) return false;
  if (input.coldBasic) return false;
  if (input.playMode !== "basic" || input.inGameplay) return true;
  if (input.livePlay || livePlayTitle()) return true;
  return !isBasicTitle(input.title);
}

/**
 * Periodic savestate + VICE FS walk on CriOS during floppy play can kill the
 * tab (Paradroid transfer). Skip that persist — not a CRT path.
 */
export function shouldSkipPlayPersist(input: {
  iosPhone?: boolean;
  /** iPad / any iOS — captureState during cart/disk play remounts splash. */
  ios?: boolean;
  playMode: string;
  inGameplay: boolean;
  title?: string | null;
  livePlay?: boolean;
}): boolean {
  if (!input.iosPhone && !input.ios) return false;
  if (input.inGameplay || input.playMode !== "basic") return true;
  if (input.livePlay || livePlayTitle()) return true;
  return !isBasicTitle(input.title);
}

export function floppyNeedsRecycle(
  liveIec: IecDrive,
  liveWorkDisk?: string | null,
  user?: DriveAttach,
  extra?: RecycleExtra,
): boolean {
  // iPhone: every floppy Play *plans* a 1541 #8 recycle (never the
  // stale-session hot-swap → DNP). Grok64App applies that in-place when
  // VICE FS is already live — it must not destroy the GL canvas (#13).
  if (extra?.iosPhone) return true;
  if (isFsWorkDisk(liveWorkDisk)) return true;
  if (liveIec === "sd2iec") return true;
  // User still has SD2IEC as the Settings drive — live session may have been
  // flipped to 1541 by a prior Play. CriOS and desktop both recycle.
  if (user?.iec === "sd2iec") return true;
  if (liveIec === "cmdhd") {
    if (!user || user.unit === 8) return true;
    return !(liveWorkDisk === "8_d64" || liveWorkDisk === "8_d81");
  }
  return !floppyPlayCanHotSwap(liveIec, liveWorkDisk);
}

export function planPlay(input: {
  filename: string;
  work?: boolean;
  userIec: IecDrive;
  userUnit: IecUnit;
  liveIec: IecDrive;
  liveWorkDisk?: string | null;
  autostart?: boolean;
  iosPhone?: boolean;
  jiffyWant?: boolean;
  jiffyLive?: boolean;
}): PlayPlan {
  const work = !!input.work;
  const kind = playKindOf(input.filename, work);
  const user: DriveAttach = { iec: input.userIec, unit: input.userUnit };
  const attach = work ? null : iecForAutostart(kindOf(input.filename));
  const autostart = input.autostart !== false && kind !== "basic";

  if (kind === "floppy" && attach) {
    const recycle = floppyNeedsRecycle(input.liveIec, input.liveWorkDisk, user, {
      iosPhone: input.iosPhone,
      jiffyWant: input.jiffyWant,
      jiffyLive: input.jiffyLive,
    });
    return {
      kind,
      user,
      live: attach,
      attach,
      recycle,
      autostartAfterReady: autostart,
      trueDrive: true,
      softIec: false,
      status: recycle
        ? `Rebuilding 1541 #8 for ${input.filename}…`
        : `Mounting floppy on 1541 #8…`,
    };
  }

  const live: DriveAttach =
    (user.iec === "cmdhd" || user.iec === "sd2iec") && user.unit !== 8
      ? { iec: "1541", unit: 8 }
      : user;

  return {
    kind,
    user,
    live,
    attach: null,
    recycle: false,
    autostartAfterReady: autostart,
    trueDrive: live.iec === "1541" || live.iec === "1581" || user.iec === "cmdhd",
    softIec: false,
    status:
      kind === "basic"
        ? user.iec === "cmdhd"
          ? "Cold start · CMD HD…"
          : user.iec === "sd2iec"
            ? "Cold start · SD2IEC…"
            : "Cold start…"
        : `Loading ${input.filename}…`,
  };
}

/**
 * VICE resources for a live attach.
 * CMD HD: real drive firmware (ROM injected separately), no FS-device, no traps.
 * SD2IEC: VICE directory device (`N_fs`) for the FAT card — not KERNAL patches.
 * 1541/1581: true drive + matching work disk.
 */
export function liveDriveOptions(live: DriveAttach): Record<string, string> {
  const typeKey = `vice_drive${live.unit}_type`;
  const typed = { [typeKey]: viceDriveTypeOption(live.iec) };
  if (live.iec === "cmdhd") {
    return {
      vice_work_disk: "disabled",
      vice_virtual_device_traps: "disabled",
      vice_drive_true_emulation: "enabled",
      ...typed,
    };
  }
  if (live.iec === "sd2iec") {
    return {
      vice_work_disk: `${live.unit}_fs`,
      vice_virtual_device_traps: "enabled",
      vice_drive_true_emulation: "disabled",
      ...typed,
    };
  }
  if (live.iec === "1581") {
    return {
      vice_work_disk: `${live.unit}_d81`,
      vice_virtual_device_traps: "disabled",
      vice_drive_true_emulation: "enabled",
      ...typed,
    };
  }
  return {
    vice_work_disk: `${live.unit}_d64`,
    vice_virtual_device_traps: "disabled",
    vice_drive_true_emulation: "enabled",
    ...typed,
  };
}

/** VICE DriveNType values (drive/drive.h). 4844 = CMD HD. */
export function viceDriveTypeCode(iec: IecDrive): number {
  if (iec === "cmdhd") return 4844;
  if (iec === "1581") return 1581;
  return 1541;
}

/** libretro-vice `vice_driveN_type` strings. */
export function viceDriveTypeOption(iec: IecDrive): string {
  if (iec === "cmdhd") return "CMD HD";
  if (iec === "1581") return "1581";
  if (iec === "sd2iec") return "None";
  return "1541";
}

export function viceDriveTypeVars(map: Partial<Record<IecUnit, IecDrive>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const unit of [8, 9, 10, 11] as IecUnit[]) {
    const iec = map[unit];
    out[`vice_drive${unit}_type`] = iec ? viceDriveTypeOption(iec) : "None";
  }
  return out;
}

/** vicerc for an explicit unit→drive map (CMD SWAP, multi-drive). */
export function viceRcForDrives(map: Partial<Record<IecUnit, IecDrive>>, virtualDevices = false): string {
  const lines = ["[C64]"];
  for (const unit of [8, 9, 10, 11] as IecUnit[]) {
    const iec = map[unit];
    lines.push(`Drive${unit}Type=${iec ? viceDriveTypeCode(iec) : 0}`);
  }
  lines.push("DriveTrueEmulation=1");
  lines.push(virtualDevices ? "VirtualDevices=1" : "VirtualDevices=0");
  return `${lines.join("\n")}\n`;
}

/**
 * vicerc snippet so CMD HD is a real drive (firmware ROM + drive CPU),
 * and unit 8 stays a 1541 when CMD lives on 9–11.
 */
export function viceRcForUser(
  user: DriveAttach,
  live: DriveAttach,
  opts?: { cmdRom?: boolean },
): string {
  const drive8 =
    live.unit === 8 && live.iec !== "sd2iec" ? viceDriveTypeCode(live.iec) : 1541;
  const lines = ["[C64]", `Drive8Type=${drive8}`];
  const cmdUnit =
    user.iec === "cmdhd" && user.unit !== 8
      ? user.unit
      : live.iec === "cmdhd" && live.unit !== 8
        ? live.unit
        : null;
  if (cmdUnit != null && opts?.cmdRom !== false) {
    lines.push(`Drive${cmdUnit}Type=${viceDriveTypeCode("cmdhd")}`);
  }
  if (user.iec === "cmdhd" && user.unit === 8 && live.iec !== "cmdhd") {
    /* Floppy Play stole #8 — keep user HD preference out of the live 1541. */
  }
  lines.push("DriveTrueEmulation=1");
  if (live.iec === "sd2iec") {
    lines.push("VirtualDevices=1");
  } else {
    lines.push("VirtualDevices=0");
  }
  return `${lines.join("\n")}\n`;
}

export function busyLabel(phase: BusyPhase, fallback = "Loading…"): string {
  if (phase === "idle") return "";
  if (phase === "boot") return fallback || "Loading Commodore 64…";
  if (phase === "play") return fallback || "Loading…";
  if (phase === "jiffy") return fallback || "Applying JiffyDOS…";
  if (phase === "rebuild") return fallback || "Rebuilding core…";
  if (phase === "drive") return fallback || "Mounting drive…";
  return fallback;
}

export function defaultCmdUnit(current: IecUnit): IecUnit {
  return current === 8 ? 9 : current;
}

export function defaultIecMap(): IecMap {
  return { 8: "1541", 9: "none", 10: "none", 11: "none" };
}

export function iecMapFromLegacy(drive: IecDrive, unit: IecUnit): IecMap {
  const map = defaultIecMap();
  if (drive === "cmdhd" && unit !== 8) {
    map[8] = "1541";
    map[unit] = "cmdhd";
    return map;
  }
  map[8] = unit === 8 ? drive : "1541";
  if (unit !== 8) map[unit] = drive;
  return map;
}

export function setIecSlot(map: IecMap, unit: IecUnit, slot: IecSlot): IecMap {
  const next: IecMap = { ...map, [unit]: slot };
  if (slot === "sd2iec" || slot === "cmdhd") {
    for (const u of IEC_UNITS) {
      if (u !== unit && next[u] === slot) next[u] = u === 8 ? "1541" : "none";
    }
  }
  if (next[8] === "none") next[8] = "1541";
  return next;
}

export function mapHasDrive(map: IecMap | null | undefined, drive: IecDrive): boolean {
  if (!map) return false;
  return IEC_UNITS.some((u) => map[u] === drive);
}

export function unitOfDrive(map: IecMap | null | undefined, drive: IecDrive): IecUnit | null {
  if (!map) return null;
  return IEC_UNITS.find((u) => map[u] === drive) ?? null;
}

export function userAttachFromMap(map: IecMap | null | undefined): DriveAttach {
  if (!map) return { iec: "1541", unit: 8 };
  for (const unit of IEC_UNITS) {
    const slot = map[unit];
    if (slot === "sd2iec" || slot === "cmdhd") return { iec: slot, unit };
  }
  const slot = map[8];
  return { iec: slot === "none" ? "1541" : slot, unit: 8 };
}

export function viceMapFromIecMap(map: IecMap): Partial<Record<IecUnit, IecDrive>> {
  const out: Partial<Record<IecUnit, IecDrive>> = {};
  for (const unit of IEC_UNITS) {
    const slot = map[unit];
    if (slot && slot !== "none") out[unit] = slot;
  }
  return out;
}

export function withLiveFloppy(map: IecMap, live: DriveAttach): IecMap {
  if (live.iec === "1541" || live.iec === "1581") {
    return { ...map, [live.unit]: live.iec };
  }
  return map;
}

/** SD2IEC disk-change button: wrap to the next/previous image. */
export function nextDiskIndex(current: number, count: number, dir: 1 | -1 = 1): number {
  if (count <= 0) return 0;
  return ((current + dir) % count + count) % count;
}

/**
 * After Autostart has typed LOAD"*",8,1 these stay on for the rest of play.
 * Leaving `vice_reset=autostart` armed is what yanked Boulder Dash / Paradroid
 * back to BASIC READY: libretro `emu_reset(0)` power-cycles, and VICE's
 * WAITLOADREADY state machine still hunts for "READY." (or a Space on the
 * HTML Reset button re-fires Autostart).
 *
 * Apply with setVariable only — never restart/recycle here.
 */
export const PLAY_UNLOCK_VICE_OPTS = {
  vice_autostart: "disabled",
  vice_autostart_warp: "disabled",
  vice_autoloadwarp: "disabled",
  vice_reset: "hard",
} as const;

/** Toolbar Reset is always a cold boot to READY — never Autostart re-fire. */
export function userResetKind(_mode?: string): "hard" {
  return "hard";
}

/** Recover/recycle to BASIC only when a cold start actually failed. */
export function shouldRecoverBoot(input: {
  playMode: string;
  playLock: boolean;
  inGameplay: boolean;
  powered: boolean;
  hasFs: boolean;
  title?: string | null;
  livePlay?: boolean;
}): boolean {
  if (!input.powered) return false;
  if (input.playLock || input.inGameplay) return false;
  if (input.livePlay || livePlayTitle()) return false;
  if (!isBasicTitle(input.title)) return false;
  if (input.playMode !== "basic") return false;
  if (input.hasFs) return false;
  return true;
}
