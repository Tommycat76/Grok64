/**
 * Device snapshot for layout (phone / tablet / desktop).
 * Reconstructed from Grok64 build session.
 */

export type DeviceKind = "phone" | "tablet" | "desktop";

export interface DeviceSnapshot {
  kind: DeviceKind;
  width: number;
  height: number;
  coarsePointer: boolean;
  ua: string;
}

export function detectDevice(
  width = typeof window !== "undefined" ? window.innerWidth : 390,
  height = typeof window !== "undefined" ? window.innerHeight : 844,
  ua = typeof navigator !== "undefined" ? navigator.userAgent : ""
): DeviceSnapshot {
  const coarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  const isTabletUA = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua);
  const isPhoneUA = /iPhone|Android.*Mobile|Mobile/i.test(ua);

  let kind: DeviceKind = "desktop";
  if (isTabletUA || (coarsePointer && width >= 768 && width < 1280)) {
    kind = "tablet";
  } else if (isPhoneUA || (coarsePointer && width < 768) || width < 600) {
    kind = "phone";
  } else if (width >= 768 && width < 1280 && height > width) {
    kind = "tablet";
  }

  return { kind, width, height, coarsePointer, ua };
}
