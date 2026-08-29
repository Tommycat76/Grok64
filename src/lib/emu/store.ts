import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ActionId,
  ControlBinding,
  CorePref,
  DriveMode,
  JoyPort,
  LibraryItem,
  MachineId,
  SidEngine,
  SidModel,
  VideoPref,
} from "./types";

const DEFAULT_BINDS: ControlBinding[] = [
  { action: "up", keys: [], padButtons: [12], padAxes: [{ axis: 1, dir: -1 }] },
  { action: "down", keys: [], padButtons: [13], padAxes: [{ axis: 1, dir: 1 }] },
  { action: "left", keys: [], padButtons: [14], padAxes: [{ axis: 0, dir: -1 }] },
  { action: "right", keys: [], padButtons: [15], padAxes: [{ axis: 0, dir: 1 }] },
  { action: "fire", keys: ["ControlRight"], padButtons: [0, 2], padAxes: [] },
  { action: "fire2", keys: [], padButtons: [1], padAxes: [] },
  { action: "space", keys: [], padButtons: [3], padAxes: [] },
  { action: "runstop", keys: [], padButtons: [9], padAxes: [] },
  { action: "commodore", keys: [], padButtons: [8], padAxes: [] },
  { action: "return", keys: [], padButtons: [11], padAxes: [] },
];

export const ACTION_LABEL: Record<ActionId, string> = {
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

interface SettingsSlice {
  machineId: MachineId;
  videoStandard: VideoPref;
  coreMode: CorePref;
  sidEngine: SidEngine;
  sidModel: SidModel;
  driveMode: DriveMode;
  joyPort: JoyPort;
  crtFilter: boolean;
  showJoystick: boolean;
  showKeyboard: boolean;
  arrowsAreJoy: boolean;
  volume: number;
  binds: ControlBinding[];
  setMachine: (id: MachineId) => void;
  setVideoStandard: (v: VideoPref) => void;
  setCoreMode: (c: CorePref) => void;
  setSidEngine: (e: SidEngine) => void;
  setSidModel: (m: SidModel) => void;
  setDriveMode: (d: DriveMode) => void;
  setJoyPort: (p: JoyPort) => void;
  setCrtFilter: (v: boolean) => void;
  setShowJoystick: (v: boolean) => void;
  setShowKeyboard: (v: boolean) => void;
  setArrowsAreJoy: (v: boolean) => void;
  setVolume: (v: number) => void;
  setBind: (action: ActionId, patch: Partial<ControlBinding>) => void;
  resetBinds: () => void;
}

interface SessionSlice {
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
  setPadName: (n: string | null) => void;
  setLibrary: (items: LibraryItem[]) => void;
  setCurrentTitle: (n: string | null) => void;
}

export const useEmu = create<SettingsSlice & SessionSlice>()(
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
      arrowsAreJoy: false,
      volume: 0.7,
      binds: DEFAULT_BINDS,
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
      version: 5,
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => undefined,
              removeItem: () => undefined,
            }
          : localStorage,
      ),
      partialize: (s) => ({
        machineId: s.machineId,
        videoStandard: s.videoStandard,
        coreMode: s.coreMode,
        sidEngine: s.sidEngine,
        sidModel: s.sidModel,
        driveMode: s.driveMode,
        joyPort: s.joyPort,
        crtFilter: s.crtFilter,
        showJoystick: s.showJoystick,
        arrowsAreJoy: s.arrowsAreJoy,
        volume: s.volume,
        binds: s.binds,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        const keys = [
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
        const next = { ...current };
        for (const k of keys) {
          if (p[k] !== undefined) {
            (next as Record<string, unknown>)[k] = p[k];
          }
        }
        return next;
      },
      migrate: (persisted, version) => {
        const p = { ...(persisted as Record<string, unknown>) };
        if (version < 2) {
          if (!p.machineId || p.machineId === "c64-pal") p.machineId = "c64-auto";
          if (!p.driveMode || p.driveMode === "true") p.driveMode = "auto";
          if (!p.videoStandard) p.videoStandard = "auto";
          if (!p.coreMode) p.coreMode = "auto";
        }
        if (version < 4) {
          p.binds = DEFAULT_BINDS;
        }
        if (version < 5) {
          p.arrowsAreJoy = false;
          p.binds = DEFAULT_BINDS;
        }
        delete p.powered;
        delete p.running;
        delete p.booting;
        delete p.bootMsg;
        return p as typeof persisted;
      },
    },
  ),
);
