import type { IecDrive, IecUnit, JoyPort, ReuSize, ScpuSimm } from "./types";

export interface ViceExtrasInput {
  reu: ReuSize;
  iec: IecDrive;
  iecUnit?: IecUnit;
  mouse: boolean;
  joyPort: JoyPort;
  scpu: boolean;
  scpuSimm?: ScpuSimm;
  scpuTurbo?: boolean;
  jiffy?: boolean;
}

/** VICE libretro `vice_work_disk` value for IEC units 8–11 (1541/1581/SD2IEC/CMD HD). */
export function workDiskFor(iec: IecDrive, unit: IecUnit = 8): string {
  if (iec === "sd2iec" || iec === "cmdhd") return `${unit}_fs`;
  if (iec === "1581") return `${unit}_d81`;
  if (iec === "1541") return `${unit}_d64`;
  return "disabled";
}

/** VICE libretro options for REU, IEC storage, mouse, SuperCPU, JiffyDOS. */
export function buildViceExtras(input: ViceExtrasInput): Record<string, string> {
  const opts: Record<string, string> = {
    vice_ram_expansion_unit: input.reu,
    vice_floppy_multidrive: "enabled",
  };

  const unit = input.iecUnit ?? 8;
  if (input.iec === "sd2iec" || input.iec === "cmdhd") {
    opts.vice_work_disk = workDiskFor(input.iec, unit);
    opts.vice_virtual_device_traps = "enabled";
  } else {
    opts.vice_work_disk = workDiskFor(input.iec, unit);
  }

  if (input.mouse) {
    const joyOn1 = input.joyPort === 1;
    opts.vice_joyport = joyOn1 ? "1" : "2";
    opts.vice_joyport_type = joyOn1 ? "3" : "1";
    opts.vice_joyport2_type = joyOn1 ? "1" : "3";
    opts.vice_analogmouse = "left";
    opts.vice_mouse_speed = "120";
    opts.vice_analogmouse_speed = "1.0";
  } else {
    opts.vice_joyport = input.joyPort === 1 ? "1" : "2";
    opts.vice_joyport_type = "1";
    opts.vice_joyport2_type = "1";
    opts.vice_analogmouse = "disabled";
  }

  if (input.scpu) {
    opts.vice_supercpu_simm_size = input.scpuSimm ?? "16";
    opts.vice_supercpu_speed_switch = input.scpuTurbo === false ? "disabled" : "enabled";
  }

  opts.vice_jiffydos = input.jiffy ? "enabled" : "disabled";
  return opts;
}

export function wantsLargeReu(name: string): boolean {
  return /\bnuvie\b|\.nuv($|\.)|\.reu($|\.)|c64[\s._-]?os/i.test(name);
}

export function wantsSuperCpu(name: string): boolean {
  return /super[\s._-]?cpu|\bscpu\b|metal[\s._-]?dust/i.test(name);
}

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
