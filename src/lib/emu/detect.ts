export type DeviceClass = "phone" | "tablet" | "desktop";
export type VideoHz = "pal" | "ntsc";
export type VideoPref = "auto" | "pal" | "ntsc";
export type CorePref = "auto" | "accurate" | "fast";
export type DrivePref = "auto" | "true" | "fast";

export interface DeviceSnapshot {
  device: DeviceClass;
  preferFast: boolean;
  os: "ios" | "android" | "other";
  label: string;
  memoryGb: number | null;
  cores: number | null;
  onn: boolean;
}

function uaString(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export function detectOs(): DeviceSnapshot["os"] {
  const ua = uaString();
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

export function isOnnTablet(ua = uaString()): boolean {
  return /onn|TBAF|TBA10|TBA11|100026191|100135923|100092980|Walmart/i.test(ua);
}

export function detectDevice(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  const ua = uaString();
  const w = Math.min(window.innerWidth, window.innerHeight);
  const h = Math.max(window.innerWidth, window.innerHeight);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const fineHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const uaMobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
    ?.mobile;
  const iPad =
    /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const iPhone = /iPhone|iPod/.test(ua);
  const android = /Android/i.test(ua);
  const androidPhone = android && /Mobile/i.test(ua);
  const androidTablet = android && !/Mobile/i.test(ua);
  const onn = isOnnTablet(ua);

  if (iPad || androidTablet || onn) return "tablet";
  if (iPhone || androidPhone || uaMobile === true) {
    if (w >= 600 && h >= 900) return "tablet";
    return "phone";
  }
  if (coarse && w >= 600) return "tablet";
  if (!coarse && fineHover && w >= 800) return "desktop";
  if (w < 600) return "phone";
  if (coarse) return "tablet";
  return "desktop";
}

export function detectPreferFast(device: DeviceClass = detectDevice()): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = uaString();
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const cores = navigator.hardwareConcurrency || null;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  const iPhone = /iPhone|iPod/.test(ua);
  const onn = isOnnTablet(ua);

  if (iPhone) return true;
  if (onn) return true;
  if (device === "phone") return true;
  if (device === "tablet") {
    if (mem != null && mem <= 6) return true;
    if (mem == null && /Android/i.test(ua) && (cores == null || cores <= 8)) return true;
  }
  if (saveData && device !== "desktop") return true;
  return false;
}

export function snapshotDevice(): DeviceSnapshot {
  if (typeof window === "undefined") {
    return {
      device: "desktop",
      preferFast: false,
      os: "other",
      label: "Desktop",
      memoryGb: null,
      cores: null,
      onn: false,
    };
  }
  const device = detectDevice();
  const os = detectOs();
  const onn = isOnnTablet();
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const cores = navigator.hardwareConcurrency || null;
  const preferFast = detectPreferFast(device);
  const osLabel = os === "ios" ? "iOS" : os === "android" ? "Android" : "Desktop";
  const kind = device === "phone" ? "phone" : device === "tablet" ? (onn ? "Onn tablet" : "tablet") : "computer";
  return {
    device,
    preferFast,
    os,
    label: `${osLabel} ${kind}`,
    memoryGb: mem,
    cores,
    onn,
  };
}

export function resolveVideo(pref: VideoPref, software: VideoHz | null): VideoHz {
  if (pref === "auto") return software ?? "pal";
  return pref;
}

export function resolveCore(pref: CorePref, snap: DeviceSnapshot): "accurate" | "fast" {
  if (pref === "auto") return snap.preferFast ? "fast" : "accurate";
  return pref;
}

export function resolveDrive(
  pref: DrivePref,
  core: "accurate" | "fast",
): "true" | "fast" {
  if (pref === "auto") return core === "fast" ? "fast" : "true";
  return pref;
}
