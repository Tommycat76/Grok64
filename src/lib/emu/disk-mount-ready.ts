import type { EjsInstance } from "./host";
import {
  applyIecUnitFloppy,
  applyRuntimeOptions,
  bumpCrtPaint,
  disarmAutostart,
  flushEmuFs,
  hardReset,
  resyncSessionDiskToVice,
  viceReattachSessionDisk,
} from "./host";
import { sessionDiskOnUnit } from "./session-media";
import { isGcrDiskKind, kindOf } from "./formats";
import type { IecDrive, IecUnit } from "./types";
import { isIosPhone } from "./detect";
import { glog } from "./debug";
import { runMountStage } from "./disk-mount-stage";
import { lastViceDiskAttach } from "./vice-disk";

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
    glog("floppy-mount-ready", { afterDriveRefresh: true, kind: diskKind, unit: live.unit });
    await runMountStage("resync-session-disk", async () => {
      resyncSessionDiskToVice(emu, live.unit);
    });
    const rc = await runMountStage("vice-reattach-session", () => viceReattachSessionDisk(emu, live.unit), 60_000);
    if (rc !== 0) {
      const last = lastViceDiskAttach(live.unit);
      throw new Error(`VICE disk reattach failed (rc=${rc})${last ? ` path=${last.path} attachRc=${last.rc}` : ""}`);
    }
    await runMountStage("flush-after-reattach", () => flushEmuFs(emu, isIosPhone() ? 2000 : 400));
    bumpCrtPaint(emu);
    return;
  }
  glog("floppy-mount-ready", { afterDriveRefresh: false, kind: diskKind, unit: live.unit });
  applyRuntimeOptions(emu, {
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
  });
  if (!diskKind || !isGcrDiskKind(diskKind)) {
    await runMountStage("hard-reset-ready", async () => {
      hardReset(emu);
      await flushEmuFs(emu, isIosPhone() ? 2000 : 800);
    });
  }
  await runMountStage("resync-session-disk", async () => {
    resyncSessionDiskToVice(emu, live.unit);
  });
  const rcCold = await runMountStage("vice-reattach-session", () => viceReattachSessionDisk(emu, live.unit), 60_000);
  if (rcCold !== 0) {
    throw new Error(`VICE disk reattach failed (rc=${rcCold})`);
  }
  bumpCrtPaint(emu);
}
