import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { JoyPort } from "./types";

export type BindAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "fire"
  | "fire2"
  | "space"
  | "runstop"
  | "commodore"
  | "return";

export interface Bind {
  action: BindAction;
  keys: string[];
  padButtons: number[];
  padAxes: { axis: number; dir: number }[];
}

export const DEFAULT_BINDS: Bind[] = [
  { action: "up", keys: ["ArrowUp", "KeyW"], padButtons: [12], padAxes: [{ axis: 1, dir: -1 }] },
  { action: "down", keys: ["ArrowDown", "KeyS"], padButtons: [13], padAxes: [{ axis: 1, dir: 1 }] },
  { action: "left", keys: ["ArrowLeft", "KeyA"], padButtons: [14], padAxes: [{ axis: 0, dir: -1 }] },
  { action: "right", keys: ["ArrowRight", "KeyD"], padButtons: [15], padAxes: [{ axis: 0, dir: 1 }] },
  { action: "fire", keys: ["Space", "KeyK"], padButtons: [0, 2], padAxes: [] },
  { action: "fire2", keys: ["KeyL"], padButtons: [1], padAxes: [] },
  { action: "space", keys: [], padButtons: [3], padAxes: [] },
  { action: "runstop", keys: [], padButtons: [9], padAxes: [] },
  { action: "commodore", keys: [], padButtons: [8], padAxes: [] },
  { action: "return", keys: [], padButtons: [11], padAxes: [] },
];

export const BIND_LABELS: Record<BindAction, string> = {
  up: "Joystick up",
  down: "Joystick down",
  left: "Joystick left",
  right: "Joystick right",
  fire: "Fire",
  fire2: "Fire 2",
  space: "Space",
  runstop: "RUN/STOP",
  commodore: "C=",
  return: "RETURN",
};

export interface LibraryItem {
  id: string;
  name: string;
  kind: string;
  source: string;
  size: number;
  addedAt: number;
  lastPlayed?: number;
}

export interface G64State {
  machineId: string;
  videoStandard: "auto" | "ntsc" | "pal";
  coreMode: "auto" | "accurate" | "fast";
  sidEngine: "ReSID" | "FastSID" | "ReSID-fp";
  sidModel: "6581" | "8580" | "default";
  driveMode: "auto" | "true" | "fast";
  joyPort: JoyPort;
  crtFilter: boolean;
  showJoystick: boolean;
  showKeyboard: boolean;
  arrowsAreJoy: boolean;
  volume: number;
  binds: Bind[];
  powered: boolean;
  running: boolean;
  paused: boolean;
  warped: boolean;
  muted: boolean;
  booting: boolean;
  bootMsg: string;
  libraryOpen: boolean;
  settingsOpen: boolean;
  mapperOpen: boolean;
  aboutOpen: boolean;
  padName: string | null;
  library: LibraryItem[];
  currentTitle: string | null;
  setMachine: (id: string) => void;
  setVideoStandard: (v: G64State["videoStandard"]) => void;
  setCoreMode: (v: G64State["coreMode"]) => void;
  setSidEngine: (v: G64State["sidEngine"]) => void;
  setSidModel: (v: G64State["sidModel"]) => void;
  setDriveMode: (v: G64State["driveMode"]) => void;
  setJoyPort: (p: JoyPort) => void;
  setCrtFilter: (v: boolean) => void;
  setShowJoystick: (v: boolean) => void;
  setShowKeyboard: (v: boolean) => void;
  setArrowsAreJoy: (v: boolean) => void;
  setVolume: (v: number) => void;
  setBind: (action: BindAction, patch: Partial<Bind>) => void;
  resetBinds: () => void;
  powerOn: () => void;
  setRunning: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setWarped: (v: boolean) => void;
  setMuted: (v: boolean) => void;
  setBooting: (v: boolean, msg?: string) => void;
  setLibraryOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setMapperOpen: (v: boolean) => void;
  setAboutOpen: (v: boolean) => void;
  setPadName: (v: string | null) => void;
  setLibrary: (v: LibraryItem[]) => void;
  setCurrentTitle: (v: string | null) => void;
}

const SETTINGS = [
  "machineId",
  "videoStandard",
  "coreMode",
  "sidEngine",
  "sidModel",
  "driveMode",
  "joyPort",
  "crtFilter",
  "showJoystick",
  "arrowsAreJoy",
  "volume",
  "binds",
] as const;

export const useG64 = create<G64State>()(
  persist(
    (set) => ({
      machineId: "c64-auto",
      videoStandard: "auto",
      coreMode: "auto",
      sidEngine: "ReSID",
      sidModel: "6581",
      driveMode: "auto",
      joyPort: 2,
      crtFilter: true,
      showJoystick: true,
      showKeyboard: false,
      arrowsAreJoy: true,
      volume: 0.7,
      binds: DEFAULT_BINDS,
      powered: false,
      running: false,
      paused: false,
      warped: false,
      muted: false,
      booting: false,
      bootMsg: "",
      libraryOpen: false,
      settingsOpen: false,
      mapperOpen: false,
      aboutOpen: false,
      padName: null,
      library: [],
      currentTitle: null,
      setMachine: (machineId) => set({ machineId }),
      setVideoStandard: (videoStandard) => set({ videoStandard }),
      setCoreMode: (coreMode) => set({ coreMode }),
      setSidEngine: (sidEngine) => set({ sidEngine }),
      setSidModel: (sidModel) => set({ sidModel }),
      setDriveMode: (driveMode) => set({ driveMode }),
      setJoyPort: (joyPort) => set({ joyPort }),
      setCrtFilter: (crtFilter) => set({ crtFilter }),
      setShowJoystick: (showJoystick) => set({ showJoystick }),
      setShowKeyboard: (showKeyboard) => set({ showKeyboard }),
      setArrowsAreJoy: (arrowsAreJoy) => set({ arrowsAreJoy }),
      setVolume: (volume) => set({ volume }),
      setBind: (action, patch) =>
        set((s) => ({
          binds: s.binds.map((b) => (b.action === action ? { ...b, ...patch } : b)),
        })),
      resetBinds: () => set({ binds: DEFAULT_BINDS }),
      powerOn: () => set({ powered: true }),
      setRunning: (running) => set({ running }),
      setPaused: (paused) => set({ paused }),
      setWarped: (warped) => set({ warped }),
      setMuted: (muted) => set({ muted }),
      setBooting: (booting, bootMsg = "") => set({ booting, bootMsg }),
      setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setMapperOpen: (mapperOpen) => set({ mapperOpen }),
      setAboutOpen: (aboutOpen) => set({ aboutOpen }),
      setPadName: (padName) => set({ padName }),
      setLibrary: (library) => set({ library }),
      setCurrentTitle: (currentTitle) => set({ currentTitle }),
    }),
    {
      name: "grok64-settings",
      version: 3,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => undefined,
              removeItem: () => undefined,
            }
          : localStorage,
      ),
      partialize: (s) => {
        const out: Record<string, unknown> = {};
        for (const k of SETTINGS) out[k] = s[k];
        return out as Partial<G64State>;
      },
      merge: (persisted, current) => {
        const n = (persisted ?? {}) as Record<string, unknown>;
        const i = { ...current };
        for (const k of SETTINGS) {
          if (n[k] !== undefined) (i as Record<string, unknown>)[k] = n[k];
        }
        return i;
      },
      migrate: (persisted, version) => {
        const n = { ...(persisted as Record<string, unknown>) };
        if (version < 2) {
          if (!n.machineId || n.machineId === "c64-pal") n.machineId = "c64-auto";
          if (!n.driveMode || n.driveMode === "true") n.driveMode = "auto";
          n.videoStandard ||= "auto";
          n.coreMode ||= "auto";
        }
        delete n.powered;
        delete n.running;
        delete n.booting;
        delete n.bootMsg;
        return n as unknown as G64State;
      },
    },
  ),
);
