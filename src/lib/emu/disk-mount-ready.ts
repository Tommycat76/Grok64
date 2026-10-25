import type { EjsInstance } from "./host";
import {
  applyIecUnitFloppy,
  applyRuntimeOptions,
  bumpCrtPaint,
  detachLibretroWorkDiskManager,
  disarmAutostart,
  flushEmuFs,
  hardReset,
  resyncSessionDiskToVice,
  ensureViceSessionDiskAttached,
} from "./host";
import { sessionDiskOnUnit } from "./session-media";
import { isGcrDiskKind, kindOf } from "./formats";
import { floppyIecForKind } from "./play-session";
import type { IecDrive, IecUnit } from "./types";
import { isIosPhone } from "./detect";
import { glog } from "./debug";
import { runMountStage } from "./disk-mount-stage";
import {
  ensureViceLastAttachRecorded,
  lastViceDiskAttach,
  VICE_ATTACH_WRONG_DRIVE,
  viceDiskLastAttachDiag,
  waitDriveFirmwareReady,
} from "./vice-disk";

export function formatViceReattachFailure(
  rc: number,
  last: ReturnType<typeof lastViceDiskAttach>,
  viceDiag: string | null,
): string {
  const vice = last?.viceDiag ?? viceDiag;
  const bits = [
    last?.path ? `path=${last.path}` : null,
    last && last.attachRc != null ? `attachRc=${last.attachRc}` : last ? `attachRc=${last.rc}` : null,
    last?.stage ? `stage=${last.stage}` : null,
    last?.jsReason ? `reason=${last.jsReason}` : null,
    vice ? `vice=${vice}` : null,
    last?.driveType != null ? `driveType=${last.driveType}` : null,
    last?.wasmFsStat != null ? `wasm=${last.wasmFsStat}` : null,
  ].filter(Boolean);
  const extra = bits.length ? ` ${bits.join(" ")}` : "";
  return `VICE disk reattach failed (rc=${rc})${extra}`;
}

function reattachFailure(emu: EjsInstance, unit: IecUnit, rc: number): Error {
  if (rc === VICE_ATTACH_WRONG_DRIVE) {
    return new Error(`Drive #${unit} rejected the disk (${viceDiskLastAttachDiag(emu) ?? "wrong drive type for this image"})`);
  }
  return new Error(formatViceReattachFailure(rc, lastViceDiskAttach(unit), viceDiskLastAttachDiag(emu)));
}

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
  applyIecUnitFloppy(emu, diskKind ? floppyIecForKind(diskKind) : "1541", live.unit, diskKind);
  if (opts?.afterDriveRefresh) {
    glog("floppy-mount-ready", { afterDriveRefresh: true, kind: diskKind, unit: live.unit });
    await runMountStage("work-disk-manager-off", () => detachLibretroWorkDiskManager(emu, live.unit));
    await runMountStage("resync-session-disk", async () => {
      resyncSessionDiskToVice(emu, live.unit);
    });
    const rc = await runMountStage("vice-reattach-session", () =>
      ensureViceSessionDiskAttached(emu, live.unit, diskKind),
    60_000);
    if (rc !== 0) throw reattachFailure(emu, live.unit, rc);
    ensureViceLastAttachRecorded(emu, live.unit);
    await runMountStage("flush-after-reattach", () => flushEmuFs(emu, isIosPhone() ? 2000 : 400));
    ensureViceLastAttachRecorded(emu, live.unit);
    await runMountStage("drive-firmware-ready", () => waitDriveFirmwareReady(emu, live.unit));
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
  const rcCold = await runMountStage("vice-reattach-session", () =>
    ensureViceSessionDiskAttached(emu, live.unit, diskKind),
  60_000);
  if (rcCold !== 0) throw reattachFailure(emu, live.unit, rcCold);
  ensureViceLastAttachRecorded(emu, live.unit);
  await runMountStage("drive-firmware-ready", () => waitDriveFirmwareReady(emu, live.unit));
  bumpCrtPaint(emu);
}
