/** Persisted on-screen control positions (percent within the control strip). */

export type ControlId = "stick" | "fire" | "jump" | "touchpad" | "mouseL" | "mouseR";

export interface ControlPos {
  /** 0–100 from the left edge of the control strip */
  left: number;
  /** 0–100 from the bottom edge of the control strip */
  bottom: number;
}

export type ControlLayout = Record<ControlId, ControlPos>;

/** Edge anchor keeps wide controls inside the strip when layout edit is on. */
const ANCHOR: Record<ControlId, "start" | "end" | "center"> = {
  stick: "start",
  touchpad: "start",
  fire: "end",
  jump: "end",
  mouseL: "end",
  mouseR: "end",
};

/** Factory defaults — used only in layout-edit drag mode (normal play uses CSS grid dock). */
export const DEFAULT_CONTROL_LAYOUT: ControlLayout = {
  stick: { left: 4, bottom: 0 },
  fire: { left: 96, bottom: 0 },
  jump: { left: 72, bottom: 0 },
  touchpad: { left: 4, bottom: 0 },
  mouseL: { left: 78, bottom: 0 },
  mouseR: { left: 96, bottom: 0 },
};

export function layoutStyle(
  pos: ControlPos,
  id: ControlId,
): { position: "absolute"; left: string; bottom: string; transform: string } {
  const anchor = ANCHOR[id];
  const tx = anchor === "start" ? "0" : anchor === "end" ? "-100%" : "-50%";
  return {
    position: "absolute",
    left: `${pos.left}%`,
    bottom: `${pos.bottom}%`,
    transform: `translate(${tx}, 0)`,
  };
}

export function clampLayout(layout: ControlLayout): ControlLayout {
  const out = { ...layout };
  for (const id of Object.keys(out) as ControlId[]) {
    const anchor = ANCHOR[id];
    const minL = anchor === "start" ? 0 : anchor === "end" ? 18 : 8;
    const maxL = anchor === "start" ? 82 : anchor === "end" ? 100 : 92;
    out[id] = {
      left: Math.max(minL, Math.min(maxL, out[id].left)),
      bottom: Math.max(0, Math.min(40, out[id].bottom)),
    };
  }
  return out;
}
