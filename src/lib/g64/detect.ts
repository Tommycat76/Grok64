export type DeviceKind = "phone" | "tablet" | "desktop";
export type OsKind = "ios" | "android" | "other";

export interface DeviceSnap {
  device: DeviceKind;
  preferFast: boolean;
  os: OsKind;
  label: string;
  memoryGb: number | null;
  cores: number | null;
  onn: boolean;
}

function ua() {
  return typeof navigator === "undefined" ? "" : navigator.userAgent || "";
}

export function detectOs(): OsKind {
  const e = ua();
  const ipad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(e) || ipad) return "ios";
  if (/Android/i.test(e)) return "android";
  return "other";
}

export function isOnn(agent = ua()) {
  return /onn|TBAF|TBA10|TBA11|100026191|100135923|100092980|Walmart/i.test(agent);
}

export function detectDeviceKind(): DeviceKind {
  if (typeof window === "undefined") return "desktop";
  const e = ua();
  const t = Math.min(window.innerWidth, window.innerHeight);
  const n = Math.max(window.innerWidth, window.innerHeight);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const mobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
    ?.mobile;
  const ipad =
    /iPad/.test(e) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const iphone = /iPhone|iPod/.test(e);
  const android = /Android/i.test(e);
  const androidPhone = android && /Mobile/i.test(e);
  const androidTablet = android && !/Mobile/i.test(e);
  const onn = isOnn(e);
  if (ipad || androidTablet || onn) return "tablet";
  if (iphone || androidPhone || mobile === true) {
    return t >= 600 && n >= 900 ? "tablet" : "phone";
  }
  if (coarse && t >= 600) return "tablet";
  if (!coarse && fine && t >= 800) return "desktop";
  if (t < 600) return "phone";
  return coarse ? "tablet" : "desktop";
}

export function preferFastCore(kind = detectDeviceKind()) {
  if (typeof navigator === "undefined") return false;
  const e = ua();
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const cores = navigator.hardwareConcurrency || null;
  const save = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    ?.saveData;
  const iphone = /iPhone|iPod/.test(e);
  const onn = isOnn(e);
  return !!(
    iphone ||
    onn ||
    kind === "phone" ||
    (kind === "tablet" &&
      ((mem != null && mem <= 6) ||
        (mem == null && /Android/i.test(e) && (cores == null || cores <= 8)))) ||
    (save && kind !== "desktop")
  );
}

export function detectDevice(): DeviceSnap {
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
  const device = detectDeviceKind();
  const os = detectOs();
  const onn = isOnn();
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  const cores = navigator.hardwareConcurrency || null;
  const osLabel = os === "ios" ? "iOS" : os === "android" ? "Android" : "Desktop";
  const form =
    device === "phone"
      ? "phone"
      : device === "tablet"
        ? onn
          ? "Onn tablet"
          : "tablet"
        : "computer";
  return {
    device,
    preferFast: preferFastCore(device),
    os,
    label: `${osLabel} ${form}`,
    memoryGb,
    cores,
    onn,
  };
}
