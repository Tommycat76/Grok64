import { detectDevice, type DeviceSnap } from "./detect";

export interface MachineDef {
  id: string;
  label: string;
  short: string;
  core: string;
  fallbackCore?: string;
  family: string;
  focus: boolean;
  dualScreen?: boolean;
  blurb: string;
  options: Record<string, string>;
}

export const MACHINES: MachineDef[] = [
  {
    id: "c64-auto",
    label: "C64 Auto",
    short: "AUTO",
    core: "c64",
    family: "c64",
    focus: true,
    blurb:
      "Picks PAL or NTSC from the software so it runs as the coder intended. Fast core on phones and budget tablets (Onn, iPhone).",
    options: {},
  },
  {
    id: "c64-pal",
    label: "C64 PAL",
    short: "PAL",
    core: "c64",
    family: "c64",
    focus: true,
    blurb: "Cycle-accurate VICE x64sc, 50 Hz. European and Australian machines.",
    options: { vice_c64_model: "C64 PAL" },
  },
  {
    id: "c64-ntsc",
    label: "C64 NTSC",
    short: "NTSC",
    core: "c64",
    family: "c64",
    focus: true,
    blurb: "Cycle-accurate VICE x64sc, 60 Hz. North American and Japanese machines.",
    options: { vice_c64_model: "C64 NTSC" },
  },
  {
    id: "c64c-pal",
    label: "C64C PAL",
    short: "C64C",
    core: "c64",
    family: "c64",
    focus: true,
    blurb: "Later board, 8580 SID by default.",
    options: { vice_c64_model: "C64C PAL" },
  },
  {
    id: "c64-fast",
    label: "C64 Fast",
    short: "FAST",
    core: "vice_x64",
    family: "c64",
    focus: true,
    blurb: "Older x64 core. Forced on when Auto detects a phone or budget tablet.",
    options: {},
  },
  {
    id: "scpu",
    label: "C64 SuperCPU",
    short: "SCPU",
    core: "vice_xscpu64",
    fallbackCore: "c64",
    family: "c64",
    focus: true,
    blurb: "CMD SuperCPU (65816). Falls back to C64 if the WASM core is missing.",
    options: {},
  },
  {
    id: "c128",
    label: "C128",
    short: "128",
    core: "c128",
    family: "c128",
    focus: false,
    dualScreen: true,
    blurb: "VICE x128. 40-col VIC-II and 80-col VDC — toggle in settings.",
    options: {},
  },
  {
    id: "vic20",
    label: "VIC-20",
    short: "VIC",
    core: "vic20",
    family: "vic20",
    focus: false,
    blurb: "VICE xvic. Ready for later VIC-20 software.",
    options: {},
  },
  {
    id: "plus4",
    label: "Plus/4",
    short: "+4",
    core: "plus4",
    family: "plus4",
    focus: false,
    blurb: "VICE xplus4.",
    options: {},
  },
  {
    id: "pet",
    label: "PET",
    short: "PET",
    core: "pet",
    family: "pet",
    focus: false,
    blurb: "VICE xpet.",
    options: {},
  },
];

export function findMachine(id: string) {
  return MACHINES.find((m) => m.id === id) ?? MACHINES[0]!;
}

export function sidOptions(engine: string, model: string) {
  const n: Record<string, string> = { vice_sid_engine: engine };
  if (model !== "default") n.vice_sid_model = model;
  n.vice_resid_sampling_method = engine === "FastSID" ? "Fast" : "Interpolation";
  return n;
}

function c64Model(machineId: string, standard: string) {
  if (machineId === "c64c-pal") return standard === "ntsc" ? "C64C NTSC" : "C64C PAL";
  return standard === "ntsc" ? "C64 NTSC" : "C64 PAL";
}

export interface ResolvedMachine {
  machineId: string;
  family: string;
  core: string;
  fallbackCore?: string;
  standard: "pal" | "ntsc";
  videoSource: "software" | "override" | "default";
  drive: string;
  coreMode: "fast" | "accurate";
  device: string;
  label: string;
  short: string;
  chip: string;
  options: Record<string, string>;
  snap: DeviceSnap;
}

export function resolveMachine(
  e: {
    machineId: string;
    videoStandard: "auto" | "ntsc" | "pal";
    coreMode: "auto" | "accurate" | "fast";
    driveMode: "auto" | "true" | "fast";
  },
  snap: DeviceSnap = detectDevice(),
  softwareStandard: "pal" | "ntsc" | null = null,
): ResolvedMachine {
  const def = findMachine(e.machineId);
  let standard: "pal" | "ntsc" =
    e.videoStandard === "auto" ? (softwareStandard ?? "pal") : e.videoStandard;
  let videoSource: ResolvedMachine["videoSource"] =
    e.videoStandard === "auto" ? (softwareStandard ? "software" : "default") : "override";
  if (e.machineId === "c64-pal" && e.videoStandard === "auto") {
    standard = "pal";
    videoSource = "override";
  }
  if (e.machineId === "c64-ntsc" && e.videoStandard === "auto") {
    standard = "ntsc";
    videoSource = "override";
  }
  if (e.machineId === "c64c-pal" && e.videoStandard === "auto") {
    standard = "pal";
    videoSource = "override";
  }
  let coreMode: "fast" | "accurate" =
    e.coreMode === "auto" ? (snap.preferFast ? "fast" : "accurate") : e.coreMode;
  if (e.machineId === "c64-fast") coreMode = "fast";
  if (e.machineId === "c64-pal" && e.coreMode === "auto") coreMode = "accurate";
  if (e.machineId === "c64-ntsc" && e.coreMode === "auto") coreMode = "accurate";
  const drive =
    e.driveMode === "auto" ? (coreMode === "fast" ? "fast" : "true") : e.driveMode;
  const useFast = def.family === "c64" && coreMode === "fast" && e.machineId !== "scpu";
  const core = useFast ? "vice_x64" : def.core;
  const options = { ...def.options };
  if (def.family === "c64" && e.machineId !== "scpu") {
    options.vice_c64_model = c64Model(e.machineId, standard);
    options.vice_external_palette = standard === "ntsc" ? "pepto-ntsc" : "pepto-pal";
  } else {
    options.vice_external_palette ||= standard === "ntsc" ? "pepto-ntsc" : "pepto-pal";
  }
  const f = standard === "ntsc" ? "NTSC" : "PAL";
  const chip = useFast ? `${f} · FAST` : f;
  const label = e.machineId === "c64-auto" ? `C64 ${f}${useFast ? " Fast" : ""}` : def.label;
  return {
    machineId: e.machineId,
    family: def.family,
    core,
    fallbackCore: def.fallbackCore,
    standard,
    videoSource,
    drive,
    coreMode: useFast ? "fast" : "accurate",
    device: snap.device,
    label,
    short: useFast ? "FAST" : f,
    chip,
    options,
    snap,
  };
}

export function describeResolved(e: ResolvedMachine) {
  const hz = e.standard === "ntsc" ? "NTSC 60 Hz" : "PAL 50 Hz";
  const src =
    e.videoSource === "software"
      ? `${hz} from title`
      : e.videoSource === "override"
        ? hz
        : `${hz} default`;
  const core = e.coreMode === "fast" ? "Fast core" : "Accurate core";
  const drive = e.drive === "fast" ? "fast 1541 traps" : "true 1541";
  const ram = e.snap.memoryGb == null ? "" : ` · ${e.snap.memoryGb} GB RAM`;
  return `${e.snap.label} · ${src} · ${core} · ${drive}${ram}`;
}

/** Disks always use a real 1541 so custom loaders don't freeze. */
export function effectiveDrive(drive: string, opts: { typedDisk?: boolean; workDisk?: boolean } = {}) {
  if (opts.workDisk) return drive;
  if (opts.typedDisk) return "true";
  return drive;
}
