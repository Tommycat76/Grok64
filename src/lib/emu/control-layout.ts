/** Persisted on-screen control positions (percent within the control strip). */

export type ControlId = "stick" | "fire" | "jump" | "touchpad" | "mouseL" | "mouseR";

export interface ControlPos {
  /** 0–100 from the left edge of the control strip */
  left: number;
  /** 0–100 from the bottom edge of the control strip */
  bottom: number;
}

export type ControlLayout = Record<ControlId, ControlPos>;

/** Factory defaults — matches the pre-sync phone/tablet dock layout. */
export const DEFAULT_CONTROL_LAYOUT: ControlLayout = {
  stick: { left: 2, bottom: 0 },
  fire: { left: 78, bottom: 0 },
  jump: { left: 62, bottom: 0 },
  touchpad: { left: 2, bottom: 0 },
  mouseL: { left: 72, bottom: 0 },
  mouseR: { left: 86, bottom: 0 },
};

export function layoutStyle(pos: ControlPos): { position: "absolute"; left: string; bottom: string; transform: string } {
  return {
    position: "absolute",
    left: `${pos.left}%`,
    bottom: `${pos.bottom}%`,
    transform: "translate(-50%, 0)",
  };
}

export function clampLayout(layout: ControlLayout): ControlLayout {
  const out = { ...layout };
  for (const id of Object.keys(out) as ControlId[]) {
    out[id] = {
      left: Math.max(2, Math.min(98, out[id].left)),
      bottom: Math.max(0, Math.min(40, out[id].bottom)),
    };
  }
  return out;
}
