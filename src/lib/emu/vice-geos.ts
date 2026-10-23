import type { IecUnit } from "./types";

/** GEOS needs a true 1541-II (DRIVE_TYPE_1541II = 1542) on unit 8. */
export function viceGeosFloppyOptions(unit: IecUnit = 8): Record<string, string> {
  return {
    [`vice_drive${unit}_type`]: "1542",
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
    /** GEOS .d64 is written to WORK DISK.D64 and presented on unit 8 (true 1541-II). */
    vice_work_disk: `${unit}_d64`,
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
  };
}
