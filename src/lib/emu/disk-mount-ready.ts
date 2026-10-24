import type { EjsInstance } from "./host";
import {
  applyIecUnitFloppy,
  applyRuntimeOptions,
  bumpCrtPaint,
  disarmAutostart,
  flushEmuFs,
  hardReset,
  resyncSessionDiskToVice,
} from "./host";
import { sessionDiskOnUnit } from "./session-media";
import { isGcrDiskKind, kindOf } from "./formats";
import type { IecDrive, IecUnit } from "./types";
import { isIosPhone } from "./detect";

/**
 * After a disk image is on unit 8: true drive, hard reset to bare READY.
 * Never types LOAD (no LOAD"$" or LOAD"*"). See docs/DISK_MOUNT_POLICY.md.
 */
export async function presentFloppyMountReady(
  emu: EjsInstance | null,
  live: { iec: IecDrive; unit: IecUnit },
  opts?: { afterDriveRefresh?: boolean },
): Promise<void> {
  if (!emu) return;
  disarmAutostart(emu, "disk");
  const slot = sessionDiskOnUnit(live.unit);
  const diskKind = slot ? kindOf(slot.name) : null;
  applyIecUnitFloppy(emu, live.iec, live.unit, diskKind);
  if (opts?.afterDriveRefresh) {
    await flushEmuFs(emu, isIosPhone() ? 2000 : 400);
    bumpCrtPaint(emu);
    return;
  }
  applyRuntimeOptions(emu, {
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
  });
  if (!diskKind || !isGcrDiskKind(diskKind)) {
    hardReset(emu);
    await flushEmuFs(emu, isIosPhone() ? 2000 : 800);
  }
  resyncSessionDiskToVice(emu, live.unit);
  bumpCrtPaint(emu);
}
