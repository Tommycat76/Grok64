import type { IecUnit } from "./types";

/** GEOS needs a true 1541-II (DRIVE_TYPE_1541II = 1542) on unit 8. */
export function viceGeosFloppyOptions(unit: IecUnit = 8): Record<string, string> {
  return {
    [`vice_drive${unit}_type`]: "1542",
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
    /** GEOS system disk replaces the blank work disk on this unit only. */
    vice_work_disk: "disabled",
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
  };
}
