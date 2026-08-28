import type { CorePref, DriveMode, MachineId, SidEngine, SidModel, VideoPref } from "./types";
import {
  resolveCore,
  resolveDrive,
  resolveVideo,
  snapshotDevice,
  type DeviceSnapshot,
  type VideoHz,
} from "./detect";
import { type VideoSource } from "./region";

export interface MachineDef {
  id: MachineId;
  label: string;
  short: string;
  core: string;
  fallbackCore?: string;
  family: "c64" | "c128" | "vic20" | "plus4" | "pet";
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
    blurb: "Picks PAL or NTSC from the software so it runs as the coder intended. Fast core on phones and budget tablets (Onn, iPhone).",
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

export function machineById(id: MachineId): MachineDef {
  return MACHINES.find((m) => m.id === id) ?? MACHINES[0]!;
}

export function sidOptions(engine: SidEngine, model: SidModel): Record<string, string> {
  const opts: Record<string, string> = {
    vice_sid_engine: engine,
  };
  if (model !== "default") opts.vice_sid_model = model;
  opts.vice_resid_sampling_method = engine === "FastSID" ? "Fast" : "Interpolation";
  return opts;
}

export interface ResolvePrefs {
  machineId: MachineId;
  videoStandard: VideoPref;
  coreMode: CorePref;
  driveMode: DriveMode;
}

export interface ResolvedMachine {
  machineId: MachineId;
  family: MachineDef["family"];
  core: string;
  fallbackCore?: string;
  standard: VideoHz;
  videoSource: VideoSource;
  drive: "true" | "fast";
  coreMode: "accurate" | "fast";
  device: DeviceSnapshot["device"];
  label: string;
  short: string;
  chip: string;
  options: Record<string, string>;
  snap: DeviceSnapshot;
}

function c64Model(id: MachineId, standard: VideoHz): string {
  if (id === "c64c-pal") return standard === "ntsc" ? "C64C NTSC" : "C64C PAL";
  return standard === "ntsc" ? "C64 NTSC" : "C64 PAL";
}

export function resolveMachine(
  prefs: ResolvePrefs,
  snap: DeviceSnapshot = snapshotDevice(),
  software: VideoHz | null = null,
): ResolvedMachine {
  const mac = machineById(prefs.machineId);
  const family = mac.family;
  let standard = resolveVideo(prefs.videoStandard, software);
  let videoSource: VideoSource =
    prefs.videoStandard === "auto" ? (software ? "software" : "default") : "override";
  if (prefs.machineId === "c64-pal" && prefs.videoStandard === "auto") {
    standard = "pal";
    videoSource = "override";
  }
  if (prefs.machineId === "c64-ntsc" && prefs.videoStandard === "auto") {
    standard = "ntsc";
    videoSource = "override";
  }
  if (prefs.machineId === "c64c-pal" && prefs.videoStandard === "auto") {
    standard = "pal";
    videoSource = "override";
  }

  let coreMode = resolveCore(prefs.coreMode, snap);
  if (prefs.machineId === "c64-fast") coreMode = "fast";
  if (prefs.machineId === "c64-pal" && prefs.coreMode === "auto") coreMode = "accurate";
  if (prefs.machineId === "c64-ntsc" && prefs.coreMode === "auto") coreMode = "accurate";

  const drive = resolveDrive(prefs.driveMode, coreMode);
  const useFastCore = family === "c64" && coreMode === "fast" && prefs.machineId !== "scpu";
  const actualCore = useFastCore ? "vice_x64" : mac.core;

  const options: Record<string, string> = { ...mac.options };
  if (family === "c64" && prefs.machineId !== "scpu") {
    options.vice_c64_model = c64Model(prefs.machineId, standard);
    options.vice_external_palette = standard === "ntsc" ? "pepto-ntsc" : "pepto-pal";
  } else if (!options.vice_external_palette) {
    options.vice_external_palette = standard === "ntsc" ? "pepto-ntsc" : "pepto-pal";
  }

  const hz = standard === "ntsc" ? "NTSC" : "PAL";
  const chipBits = [hz];
  if (useFastCore) chipBits.push("FAST");
  const chip = chipBits.join(" · ");
  const label =
    prefs.machineId === "c64-auto"
      ? `C64 ${hz}${useFastCore ? " Fast" : ""}`
      : mac.label;

  return {
    machineId: prefs.machineId,
    family,
    core: actualCore,
    fallbackCore: mac.fallbackCore,
    standard,
    videoSource,
    drive,
    coreMode: useFastCore ? "fast" : "accurate",
    device: snap.device,
    label,
    short: useFastCore ? "FAST" : hz,
    chip,
    options,
    snap,
  };
}

export function detectLine(resolved: ResolvedMachine): string {
  const { snap, standard, coreMode, drive, videoSource } = resolved;
  const hz = standard === "ntsc" ? "NTSC 60 Hz" : "PAL 50 Hz";
  const hzBit =
    videoSource === "software"
      ? `${hz} from title`
      : videoSource === "override"
        ? hz
        : `${hz} default`;
  const core = coreMode === "fast" ? "Fast core" : "Accurate core";
  const drv = drive === "fast" ? "fast 1541 traps" : "true 1541";
  const mem = snap.memoryGb != null ? ` · ${snap.memoryGb} GB RAM` : "";
  return `${snap.label} · ${hzBit} · ${core} · ${drv}${mem}`;
}
