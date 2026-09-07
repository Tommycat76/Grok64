import type { IecDrive, IecUnit, MediaKind } from "./types";
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

export function floppyNeedsRecycle(
  liveIec: IecDrive,
  liveWorkDisk?: string | null,
  user?: DriveAttach,
): boolean {
  if (isFsWorkDisk(liveWorkDisk)) return true;
  if (liveIec === "sd2iec") return true;
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
}): PlayPlan {
  const work = !!input.work;
  const kind = playKindOf(input.filename, work);
  const user: DriveAttach = { iec: input.userIec, unit: input.userUnit };
  const attach = work ? null : iecForAutostart(kindOf(input.filename));
  const autostart = input.autostart !== false && kind !== "basic";

  if (kind === "floppy" && attach) {
    const recycle = floppyNeedsRecycle(input.liveIec, input.liveWorkDisk, user);
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
    autostartAfterReady: autostart && kind !== "basic",
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
  if (live.iec === "cmdhd") {
    return {
      vice_work_disk: "disabled",
      vice_virtual_device_traps: "disabled",
      vice_drive_true_emulation: "enabled",
    };
  }
  if (live.iec === "sd2iec") {
    return {
      vice_work_disk: `${live.unit}_fs`,
      vice_virtual_device_traps: "enabled",
      vice_drive_true_emulation: "disabled",
    };
  }
  if (live.iec === "1581") {
    return {
      vice_work_disk: `${live.unit}_d81`,
      vice_virtual_device_traps: "disabled",
      vice_drive_true_emulation: "enabled",
    };
  }
  return {
    vice_work_disk: `${live.unit}_d64`,
    vice_virtual_device_traps: "disabled",
    vice_drive_true_emulation: "enabled",
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
export function viceRcForUser(user: DriveAttach, live: DriveAttach): string {
  const lines = [
    "[C64]",
    `Drive8Type=${live.unit === 8 ? viceDriveTypeCode(live.iec) : 1541}`,
  ];
  if (user.iec === "cmdhd" && user.unit !== 8) {
    lines.push(`Drive${user.unit}Type=${viceDriveTypeCode("cmdhd")}`);
  } else if (live.iec === "cmdhd" && live.unit !== 8) {
    lines.push(`Drive${live.unit}Type=${viceDriveTypeCode("cmdhd")}`);
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

/** SD2IEC disk-change button: wrap to the next/previous image. */
export function nextDiskIndex(current: number, count: number, dir: 1 | -1 = 1): number {
  if (count <= 0) return 0;
  return ((current + dir) % count + count) % count;
}
