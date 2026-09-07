import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ActionId,
  ControlBinding,
  CorePref,
  DriveMode,
  IecDrive,
  IecUnit,
  JoyPort,
  LibraryItem,
  MachineId,
  PadSide,
  ReuSize,
  ScpuSimm,
  SidEngine,
  SidModel,
  VideoPref,
} from "./types";
import { clampLayout, DEFAULT_CONTROL_LAYOUT, type ControlId, type ControlLayout } from "./control-layout";

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
  stickGate: "4way" | "8way";
  jumpBtn: boolean;
  reuSize: ReuSize;
  iecDrive: IecDrive;
  iecUnit: IecUnit;
  mouseMode: boolean;
  padSide: PadSide;
  layoutEdit: boolean;
  controlLayout: ControlLayout;
  scpuSimm: ScpuSimm;
  scpuTurbo: boolean;
  jiffyDos: boolean;
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
  setStickGate: (g: "4way" | "8way") => void;
  setJumpBtn: (v: boolean) => void;
  setReuSize: (v: ReuSize) => void;
  setIecDrive: (v: IecDrive) => void;
  setIecUnit: (v: IecUnit) => void;
  setMouseMode: (v: boolean) => void;
  setPadSide: (v: PadSide) => void;
  setLayoutEdit: (v: boolean) => void;
  setControlPos: (id: ControlId, pos: Partial<ControlLayout[ControlId]>) => void;
  resetControlLayout: () => void;
  setScpuSimm: (v: ScpuSimm) => void;
  setScpuTurbo: (v: boolean) => void;
  setJiffyDos: (v: boolean) => void;
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
  bootProgress: number;
  libraryOpen: boolean;
  settingsOpen: boolean;
  mapperOpen: boolean;
  aboutOpen: boolean;
  snapsOpen: boolean;
  padName: string | null;
  library: LibraryItem[];
  currentTitle: string | null;
  powerOn: () => void;
  setRunning: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setWarped: (v: boolean) => void;
  setMuted: (v: boolean) => void;
  setBooting: (v: boolean, msg?: string, progress?: number) => void;
  setLibraryOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setMapperOpen: (v: boolean) => void;
  setAboutOpen: (v: boolean) => void;
  setSnapsOpen: (v: boolean) => void;
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
      stickGate: "4way",
      jumpBtn: false,
      reuSize: "none",
      iecDrive: "1541",
      iecUnit: 8,
      mouseMode: false,
      padSide: "left",
      layoutEdit: false,
      controlLayout: { ...DEFAULT_CONTROL_LAYOUT },
      scpuSimm: "16",
      scpuTurbo: true,
      jiffyDos: false,
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
      setStickGate: (stickGate) => set({ stickGate }),
      setJumpBtn: (jumpBtn) => set({ jumpBtn }),
      setReuSize: (reuSize) => set({ reuSize }),
      setIecDrive: (iecDrive) => set({ iecDrive }),
      setIecUnit: (iecUnit) => set({ iecUnit }),
      setMouseMode: (mouseMode) => set({ mouseMode }),
      setPadSide: (padSide) => set({ padSide }),
      setLayoutEdit: (layoutEdit) => set({ layoutEdit }),
      setControlPos: (id, pos) =>
        set((s) => ({
          controlLayout: clampLayout({
            ...s.controlLayout,
            [id]: { ...s.controlLayout[id], ...pos },
          }),
        })),
      resetControlLayout: () => set({ controlLayout: { ...DEFAULT_CONTROL_LAYOUT } }),
      setScpuSimm: (scpuSimm) => set({ scpuSimm }),
      setScpuTurbo: (scpuTurbo) => set({ scpuTurbo }),
      setJiffyDos: (jiffyDos) => set({ jiffyDos }),
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
      bootProgress: 0,
      libraryOpen: false,
      settingsOpen: false,
      mapperOpen: false,
      aboutOpen: false,
      snapsOpen: false,
      padName: null,
      library: [],
      currentTitle: null,
      powerOn: () => set({ powered: true }),
      setRunning: (running) => set({ running }),
      setPaused: (paused) => set({ paused }),
      setWarped: (warped) => set({ warped }),
      setMuted: (muted) => set({ muted }),
      setBooting: (booting, bootMsg = "", bootProgress = booting ? 8 : 0) =>
        set({ booting, bootMsg, bootProgress: booting ? bootProgress : 0 }),
      setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setMapperOpen: (mapperOpen) => set({ mapperOpen }),
      setAboutOpen: (aboutOpen) => set({ aboutOpen }),
      setSnapsOpen: (snapsOpen) => set({ snapsOpen }),
      setPadName: (padName) => set({ padName }),
      setLibrary: (library) => set({ library }),
      setCurrentTitle: (currentTitle) => set({ currentTitle }),
    }),
    {
      name: "grok64-settings",
      version: 10,
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
        stickGate: s.stickGate,
        jumpBtn: s.jumpBtn,
        reuSize: s.reuSize,
        iecDrive: s.iecDrive,
        iecUnit: s.iecUnit,
        mouseMode: s.mouseMode,
        padSide: s.padSide,
        controlLayout: s.controlLayout,
        scpuSimm: s.scpuSimm,
        scpuTurbo: s.scpuTurbo,
        jiffyDos: s.jiffyDos,
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
          "stickGate",
          "jumpBtn",
          "reuSize",
          "iecDrive",
          "iecUnit",
          "mouseMode",
          "padSide",
          "controlLayout",
          "scpuSimm",
          "scpuTurbo",
          "jiffyDos",
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
        if (version < 6) {
          if (!p.stickGate) p.stickGate = "4way";
          if (p.jumpBtn === undefined) p.jumpBtn = false;
        }
        if (version < 8) {
          if (![8, 9, 10, 11].includes(p.iecUnit as number)) p.iecUnit = 8;
        }
        if (version < 9) {
          p.controlLayout = { ...DEFAULT_CONTROL_LAYOUT };
        }
        if (version < 10) {
          p.controlLayout = { ...DEFAULT_CONTROL_LAYOUT };
        }
        if (version < 7) {
          if (!p.reuSize) p.reuSize = "none";
          if (!p.iecDrive || !["1541", "1581", "sd2iec", "cmdhd"].includes(p.iecDrive as string)) {
            p.iecDrive = "1541";
          }
          if (typeof p.mouseMode !== "boolean") p.mouseMode = false;
          if (p.padSide !== "right") p.padSide = "left";
          if (!["0", "1", "2", "4", "8", "16"].includes(p.scpuSimm as string)) p.scpuSimm = "16";
          if (typeof p.scpuTurbo !== "boolean") p.scpuTurbo = true;
          if (typeof p.jiffyDos !== "boolean") p.jiffyDos = false;
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
