import type { JoyPort } from "./types";

export type ReuSize = "none" | "256kB" | "512kB" | "2048kB" | "16384kB";
export type IecDrive = "1541" | "1581" | "sd2iec" | "cmdhd";
export type IecUnit = 8 | 9 | 10 | 11;
export type ScpuSimm = "0" | "1" | "2" | "4" | "8" | "16";

export const REU_LABEL: Record<ReuSize, string> = {
  none: "Off",
  "256kB": "256K",
  "512kB": "512K",
  "2048kB": "2 MB",
  "16384kB": "16 MB",
};

export const IEC_LABEL: Record<IecDrive, string> = {
  "1541": "1541",
  "1581": "1581",
  sd2iec: "SD2IEC",
  cmdhd: "CMD HD",
};

export const SCPU_SIMM_LABEL: Record<ScpuSimm, string> = {
  "0": "0",
  "1": "1 MB",
  "2": "2 MB",
  "4": "4 MB",
  "8": "8 MB",
  "16": "16 MB",
};

export function needsBigReu(name: string): boolean {
  return /\bnuvie\b|\.nuv($|\.)|\.reu($|\.)|c64[\s._-]?os/i.test(name);
}

export function needsScpu(name: string): boolean {
  return /super[\s._-]?cpu|\bscpu\b|metal[\s._-]?dust/i.test(name);
}

function workDiskFor(iec: IecDrive, unit: IecUnit = 8): string {
  if (iec === "sd2iec" || iec === "cmdhd") return `${unit}_fs`;
  if (iec === "1581") return `${unit}_d81`;
  if (iec === "1541") return `${unit}_d64`;
  return "disabled";
}

export function viceExpandOptions(opts: {
  reu: ReuSize;
  iec: IecDrive;
  iecUnit?: IecUnit;
  mouse: boolean;
  joyPort: JoyPort;
  scpu?: boolean;
  scpuSimm?: ScpuSimm;
  scpuTurbo?: boolean;
  jiffy?: boolean;
}): Record<string, string> {
  const unit = opts.iecUnit ?? 8;
  const o: Record<string, string> = {
    vice_ram_expansion_unit: opts.reu,
    vice_floppy_multidrive: "enabled",
  };
  if (opts.iec === "sd2iec" || opts.iec === "cmdhd") {
    o.vice_work_disk = workDiskFor(opts.iec, unit);
    o.vice_virtual_device_traps = "enabled";
  } else {
    o.vice_work_disk = workDiskFor(opts.iec, unit);
  }
  if (opts.mouse) {
    const p1 = opts.joyPort === 1;
    o.vice_joyport = p1 ? "1" : "2";
    o.vice_joyport_type = p1 ? "3" : "1";
    o.vice_joyport2_type = p1 ? "1" : "3";
    o.vice_analogmouse = "left";
    o.vice_mouse_speed = "120";
    o.vice_analogmouse_speed = "1.0";
  } else {
    o.vice_joyport = opts.joyPort === 1 ? "1" : "2";
    o.vice_joyport_type = "1";
    o.vice_joyport2_type = "1";
    o.vice_analogmouse = "disabled";
  }
  if (opts.scpu) {
    o.vice_supercpu_simm_size = opts.scpuSimm ?? "16";
    o.vice_supercpu_speed_switch = opts.scpuTurbo === false ? "disabled" : "enabled";
  }
  o.vice_jiffydos = opts.jiffy ? "enabled" : "disabled";
  return o;
}
