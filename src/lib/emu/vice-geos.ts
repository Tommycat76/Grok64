import type { IecUnit } from "./types";

/** GEOS on unit 8 — keep 1541 (do not flip to 1541-II / 1542 on insert). */
export function viceGeosFloppyOptions(unit: IecUnit = 8): Record<string, string> {
  return {
    [`vice_drive${unit}_type`]: "1541",
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
    vice_work_disk: "disabled",
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
  };
}
