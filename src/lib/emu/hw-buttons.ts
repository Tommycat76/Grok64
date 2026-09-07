import type { IecDrive, IecUnit } from "./types";

/**
 * GENERAL HARDWARE-BUTTON RULE
 *
 * Every attached device that has physical buttons is represented in the UI
 * with the same short-press / long-press map as the real hardware. Not stubs.
 *
 *   SD2IEC disk-change: short = next image, hold ≥1s = previous
 *   SD2IEC SWAP 8/9:    short = 8↔9, hold = restore device 8
 *   CMD HD SWAP:        short = exchange device number with #8, hold = restore
 *   Cart freeze:        short = freeze line (Action Replay / Retro Replay),
 *                       hold = cart RESET (Retro Replay reset button)
 *   SuperCPU RESET:     short = machine reset through the SuperCPU
 *
 * Long-press threshold matches sd2iec firmware (~1000 ms). Action fires on
 * release so a hold is not also a tap.
 */

export const HW_LONG_MS = 1000;

export type HwDeviceId = "cart" | "sd2iec" | "cmdhd" | "scpu";
export type HwPress = "short" | "long";

export type HwAction =
  | "cart-freeze"
  | "cart-reset"
  | "sd2iec-next"
  | "sd2iec-prev"
  | "sd2iec-swap89"
  | "sd2iec-unit8"
  | "cmd-swap"
  | "cmd-unswap"
  | "scpu-reset";

export interface HwButtonSpec {
  id: string;
  device: HwDeviceId;
  label: string;
  shortAction: HwAction;
  longAction?: HwAction;
  longMs: number;
  shortHint: string;
  longHint?: string;
}

export const HW_BUTTONS: HwButtonSpec[] = [
  {
    id: "cart-fz",
    device: "cart",
    label: "CART FZ",
    shortAction: "cart-freeze",
    longAction: "cart-reset",
    longMs: HW_LONG_MS,
    shortHint: "Cartridge freeze — Action Replay / Retro Replay / Freeze Frame",
    longHint: "Hold — cart RESET (Retro Replay reset button)",
  },
  {
    id: "sd-disk",
    device: "sd2iec",
    label: "SD FZ",
    shortAction: "sd2iec-next",
    longAction: "sd2iec-prev",
    longMs: HW_LONG_MS,
    shortHint: "SD2IEC disk-change — next image",
    longHint: "Hold — previous image (real sd2iec long press)",
  },
  {
    id: "sd-swap",
    device: "sd2iec",
    label: "SD 8/9",
    shortAction: "sd2iec-swap89",
    longAction: "sd2iec-unit8",
    longMs: HW_LONG_MS,
    shortHint: "SD2IEC SWAP — device number 8 ↔ 9",
    longHint: "Hold — restore device 8",
  },
  {
    id: "cmd-swap",
    device: "cmdhd",
    label: "CMD SW",
    shortAction: "cmd-swap",
    longAction: "cmd-unswap",
    longMs: HW_LONG_MS,
    shortHint: "CMD HD SWAP — exchange device number with #8",
    longHint: "Hold — restore original device numbers",
  },
  {
    id: "scpu-rst",
    device: "scpu",
    label: "SCPU RST",
    shortAction: "scpu-reset",
    longMs: HW_LONG_MS,
    shortHint: "SuperCPU RESET button",
  },
];

export function classifyPress(heldMs: number, longMs = HW_LONG_MS): HwPress {
  return heldMs >= longMs ? "long" : "short";
}

export function actionForPress(spec: HwButtonSpec, press: HwPress): HwAction {
  if (press === "long" && spec.longAction) return spec.longAction;
  return spec.shortAction;
}

export function hwButtonById(id: string): HwButtonSpec | undefined {
  return HW_BUTTONS.find((b) => b.id === id);
}

export interface HwAttachState {
  cart?: boolean;
  sd2iec?: boolean;
  cmdhd?: boolean;
  scpu?: boolean;
}

/** Buttons that must be on screen for the currently attached hardware. */
export function visibleHwButtons(attached: HwAttachState): HwButtonSpec[] {
  return HW_BUTTONS.filter((b) => {
    if (b.device === "cart") return attached.cart !== false;
    if (b.device === "sd2iec") return attached.sd2iec !== false;
    if (b.device === "cmdhd") return !!attached.cmdhd;
    if (b.device === "scpu") return !!attached.scpu;
    return false;
  });
}

/**
 * CMD HD SWAP: the front-panel button always exchanges with device 8.
 * `home` is the unit the HD is configured for (settings). `swapped` is the
 * live button state — not a settings change.
 */
export function cmdSwapUnits(
  home: IecUnit,
  swapped: boolean,
): { cmd: IecUnit; floppy: IecUnit } {
  const rest: IecUnit = home === 8 ? 9 : home;
  if (!swapped) {
    return { cmd: home, floppy: home === 8 ? 9 : 8 };
  }
  return { cmd: home === 8 ? 9 : 8, floppy: home };
}

export function cmdDriveMap(home: IecUnit, swapped: boolean): Partial<Record<IecUnit, IecDrive>> {
  const { cmd, floppy } = cmdSwapUnits(home, swapped);
  const map: Partial<Record<IecUnit, IecDrive>> = {};
  map[cmd] = "cmdhd";
  map[floppy] = "1541";
  return map;
}

/** SD2IEC SWAP 8/9 button — firmware only toggles the 8/9 pair. */
export function sd2iecSwapUnit(current: IecUnit): IecUnit {
  return current === 8 ? 9 : 8;
}

export function hwButtonTitle(spec: HwButtonSpec): string {
  return spec.longHint ? `${spec.shortHint}. ${spec.longHint}` : spec.shortHint;
}
