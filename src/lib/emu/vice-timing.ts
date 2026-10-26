import type { IecUnit } from "./types";

/** Real 1541 @ 1× for load-timing benchmarks (no warp, no virtual-device traps). */
export function viceReal1541TimingOptions(unit: IecUnit = 8): Record<string, string> {
  return {
    [`vice_drive${unit}_type`]: "1541",
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
    vice_work_disk: `${unit}_d64`,
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
  };
}
