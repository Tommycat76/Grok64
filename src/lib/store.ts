/**
 * Zustand store — settings partialized; joyPort default 2.
 * Reconstructed from Grok64 build session.
 */

import { create } from "zustand";
import type { JoyPort } from "./emu/host";

export interface G64Settings {
  joyPort: JoyPort;
  showJoystick: boolean;
  showKeyboard: boolean;
  warp: boolean;
}

export interface G64State extends G64Settings {
  powered: boolean;
  booting: boolean;
  running: boolean;
  title: string | null;
  setJoyPort: (p: JoyPort) => void;
  setShowJoystick: (v: boolean) => void;
  setShowKeyboard: (v: boolean) => void;
  setWarp: (v: boolean) => void;
  setPowered: (v: boolean) => void;
  setBooting: (v: boolean) => void;
  setRunning: (v: boolean) => void;
  setTitle: (t: string | null) => void;
}

export const useG64 = create<G64State>((set) => ({
  joyPort: 2,
  showJoystick: true,
  showKeyboard: false,
  warp: false,
  powered: false,
  booting: false,
  running: false,
  title: null,
  setJoyPort: (joyPort) => set({ joyPort }),
  setShowJoystick: (showJoystick) => set({ showJoystick }),
  setShowKeyboard: (showKeyboard) => set({ showKeyboard }),
  setWarp: (warp) => set({ warp }),
  setPowered: (powered) => set({ powered }),
  setBooting: (booting) => set({ booting }),
  setRunning: (running) => set({ running }),
  setTitle: (title) => set({ title }),
}));

/** Settings keys safe to persist (no ephemeral boot flags). */
export const SETTINGS_KEYS: (keyof G64Settings)[] = [
  "joyPort",
  "showJoystick",
  "showKeyboard",
  "warp",
];
