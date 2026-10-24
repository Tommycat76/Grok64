import type { FastLoadCartKind } from "@/lib/emu/jiffy-cart-compat";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ActionId,
  ControlBinding,
  CorePref,
  DriveMode,
  IecDrive,
  IecMap,
  IecSlot,
  IecUnit,
  JoyPort,
  LibraryItem,
  MachineId,
  PadSide,
  ReuSize,
  ScpuSimm,
  SidChipModel,
  SidEngine,
  SidExtraAddress,
  SidModel,
  VideoPref,
} from "./types";
import { clampLayout, DEFAULT_CONTROL_LAYOUT, type ControlId, type ControlLayout } from "./control-layout";
import { defaultIecMap, iecMapFromLegacy, setIecSlot as patchIecSlot, userAttachFromMap } from "./play-session";

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
  sid2Address: SidExtraAddress;
  sid2Model: SidChipModel;
  sid3Address: SidExtraAddress;
  sid3Model: SidChipModel;
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
  iecMap: IecMap;
  mouseMode: boolean;
  padSide: PadSide;
  layoutEdit: boolean;
  controlLayout: ControlLayout;
  scpuSimm: ScpuSimm;
  scpuTurbo: boolean;
  jiffyDos: boolean;
  /** Host folder / mounted .img writes (off by default). */
  sd2iecWriteEnabled: boolean;
  debugLog: boolean;
  volume: number;
  binds: ControlBinding[];
  setMachine: (id: MachineId) => void;
  setVideoStandard: (v: VideoPref) => void;
  setCoreMode: (c: CorePref) => void;
  setSidEngine: (e: SidEngine) => void;
  setSidModel: (m: SidModel) => void;
  setSid2Address: (a: SidExtraAddress) => void;
  setSid2Model: (m: SidChipModel) => void;
  setSid3Address: (a: SidExtraAddress) => void;
  setSid3Model: (m: SidChipModel) => void;
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
  setIecSlot: (unit: IecUnit, slot: IecSlot) => void;
  setMouseMode: (v: boolean) => void;
  setPadSide: (v: PadSide) => void;
  setLayoutEdit: (v: boolean) => void;
  setControlPos: (id: ControlId, pos: Partial<ControlLayout[ControlId]>) => void;
  resetControlLayout: () => void;
  setScpuSimm: (v: ScpuSimm) => void;
  setScpuTurbo: (v: boolean) => void;
  setJiffyDos: (v: boolean) => void;
  setSd2iecWriteEnabled: (v: boolean) => void;
  setDebugLog: (v: boolean) => void;
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
  libraryTab: "catalog" | "library";
  sessionRestoreHint: string | null;
  /** cart vs floppy/disk — drives resume banner copy. */
  sessionRestoreKind: "cart" | "floppy" | null;
  settingsOpen: boolean;
  mapperOpen: boolean;
  aboutOpen: boolean;
  snapsOpen: boolean;
  padName: string | null;
  library: LibraryItem[];
  currentTitle: string | null;
  /** Last floppy inserted in-session (shown instead of blank.d64 / WORK DISK path). */
  insertedDiskName: string | null;
  /** Active freezer / fast-load CRT this session (for JiffyDOS compatibility). */
  fastLoadCart: FastLoadCartKind | null;
  powerOn: () => void;
  powerOff: () => void;
  setRunning: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  setWarped: (v: boolean) => void;
  setMuted: (v: boolean) => void;
  setBooting: (v: boolean, msg?: string, progress?: number) => void;
  setLibraryOpen: (v: boolean) => void;
  setLibraryTab: (tab: "catalog" | "library") => void;
  setSessionRestoreHint: (hint: string | null, kind?: "cart" | "floppy" | null) => void;
  setSettingsOpen: (v: boolean) => void;
  setMapperOpen: (v: boolean) => void;
  setAboutOpen: (v: boolean) => void;
  setSnapsOpen: (v: boolean) => void;
  setPadName: (n: string | null) => void;
  setLibrary: (items: LibraryItem[]) => void;
  setCurrentTitle: (n: string | null) => void;
  setInsertedDiskName: (n: string | null) => void;
  setFastLoadCart: (cart: FastLoadCartKind | null) => void;
}

function withIecMap(map: IecMap) {
  const user = userAttachFromMap(map);
  return { iecMap: map, iecDrive: user.iec, iecUnit: user.unit };
}

export const useEmu = create<SettingsSlice & SessionSlice>()(
  persist(
    (set) => ({
      machineId: "c64-auto",
      videoStandard: "auto",
      coreMode: "auto",
      sidEngine: "ReSID",
      sidModel: "6581",
      sid2Address: "disabled",
      sid2Model: "default",
      sid3Address: "disabled",
      sid3Model: "default",
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
      iecMap: defaultIecMap(),
      mouseMode: false,
      padSide: "left",
      layoutEdit: false,
      controlLayout: { ...DEFAULT_CONTROL_LAYOUT },
      scpuSimm: "16",
      scpuTurbo: true,
      jiffyDos: false,
      sd2iecWriteEnabled: false,
      debugLog: false,
      volume: 0.7,
      binds: DEFAULT_BINDS,
      setMachine: (machineId) => set({ machineId }),
      setVideoStandard: (videoStandard) => set({ videoStandard }),
      setCoreMode: (coreMode) => set({ coreMode }),
      setSidEngine: (sidEngine) => set({ sidEngine }),
      setSidModel: (sidModel) => set({ sidModel }),
      setSid2Address: (sid2Address) => set({ sid2Address }),
      setSid2Model: (sid2Model) => set({ sid2Model }),
      setSid3Address: (sid3Address) => set({ sid3Address }),
      setSid3Model: (sid3Model) => set({ sid3Model }),
      setDriveMode: (driveMode) => set({ driveMode }),
      setJoyPort: (joyPort) => set({ joyPort }),
      setCrtFilter: (crtFilter) => set({ crtFilter }),
      setShowJoystick: (showJoystick) => set({ showJoystick }),
      setShowKeyboard: (showKeyboard) => set({ showKeyboard }),
      setArrowsAreJoy: (arrowsAreJoy) => set({ arrowsAreJoy }),
      setStickGate: (stickGate) => set({ stickGate }),
      setJumpBtn: (jumpBtn) => set({ jumpBtn }),
      setReuSize: (reuSize) => set({ reuSize }),
      setIecDrive: (iecDrive) =>
        set((s) => {
          const current = s.iecMap ?? defaultIecMap();
          if (iecDrive === "cmdhd") {
            const unit = 9;
            const base = { ...current, 8: current[8] === "cmdhd" ? "1541" : current[8] };
            return withIecMap(patchIecSlot(base, unit, "cmdhd"));
          }
          if (iecDrive === "sd2iec") return withIecMap(patchIecSlot(current, 8, "sd2iec"));
          return withIecMap(patchIecSlot(current, 8, iecDrive));
        }),
      setIecUnit: (iecUnit) => set({ iecUnit }),
      setIecSlot: (unit, slot) => set((s) => withIecMap(patchIecSlot(s.iecMap ?? defaultIecMap(), unit, slot))),
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
      setSd2iecWriteEnabled: (sd2iecWriteEnabled) => {
        set({ sd2iecWriteEnabled });
        void import("./sd2iec-card-source").then((m) => m.setSd2iecWriteEnabled(sd2iecWriteEnabled));
      },
      setDebugLog: (debugLog) => set({ debugLog }),
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
      libraryTab: "catalog",
      sessionRestoreHint: null,
      sessionRestoreKind: null,
      settingsOpen: false,
      mapperOpen: false,
      aboutOpen: false,
      snapsOpen: false,
      padName: null,
      library: [],
      currentTitle: null,
      insertedDiskName: null,
      fastLoadCart: null,
      powerOn: () => set({ powered: true }),
      powerOff: () =>
        set({
          powered: false,
          running: false,
          booting: false,
          bootMsg: "",
          bootProgress: 0,
          paused: false,
          currentTitle: null,
          insertedDiskName: null,
          fastLoadCart: null,
        }),
      setRunning: (running) => set({ running }),
      setPaused: (paused) => set({ paused }),
      setWarped: (warped) => set({ warped }),
      setMuted: (muted) => set({ muted }),
      setBooting: (booting, bootMsg = "", bootProgress = booting ? 8 : 0) =>
        set({ booting, bootMsg, bootProgress: booting ? bootProgress : 0 }),
      setLibraryOpen: (libraryOpen) => set({ libraryOpen }),
      setLibraryTab: (libraryTab) => set({ libraryTab }),
      setSessionRestoreHint: (sessionRestoreHint, kind) =>
        set({
          sessionRestoreHint,
          sessionRestoreKind: sessionRestoreHint ? (kind ?? null) : null,
        }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setMapperOpen: (mapperOpen) => set({ mapperOpen }),
      setAboutOpen: (aboutOpen) => set({ aboutOpen }),
      setSnapsOpen: (snapsOpen) => set({ snapsOpen }),
      setPadName: (padName) => set({ padName }),
      setLibrary: (library) => set({ library }),
      setCurrentTitle: (currentTitle) => set({ currentTitle }),
      setInsertedDiskName: (insertedDiskName) => set({ insertedDiskName }),
      setFastLoadCart: (fastLoadCart) => set({ fastLoadCart }),
    }),
    {
      name: "grok64-settings",
      version: 12,
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
        sid2Address: s.sid2Address,
        sid2Model: s.sid2Model,
        sid3Address: s.sid3Address,
        sid3Model: s.sid3Model,
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
        iecMap: s.iecMap,
        mouseMode: s.mouseMode,
        padSide: s.padSide,
        controlLayout: s.controlLayout,
        scpuSimm: s.scpuSimm,
        scpuTurbo: s.scpuTurbo,
        jiffyDos: s.jiffyDos,
        sd2iecWriteEnabled: s.sd2iecWriteEnabled,
        debugLog: s.debugLog,
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
          "sid2Address",
          "sid2Model",
          "sid3Address",
          "sid3Model",
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
          "iecMap",
          "mouseMode",
          "padSide",
          "controlLayout",
          "scpuSimm",
          "scpuTurbo",
          "jiffyDos",
          "sd2iecWriteEnabled",
          "debugLog",
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
        if (version < 11) {
          const drive = (["1541", "1581", "sd2iec", "cmdhd"].includes(p.iecDrive as string)
            ? p.iecDrive
            : "1541") as IecDrive;
          const unit = ([8, 9, 10, 11].includes(p.iecUnit as number) ? p.iecUnit : 8) as IecUnit;
          p.iecMap = iecMapFromLegacy(drive, unit);
        }
        if (version < 12) {
          if (!p.sid2Address) p.sid2Address = "disabled";
          if (!p.sid3Address) p.sid3Address = "disabled";
          if (!p.sid2Model) p.sid2Model = "default";
          if (!p.sid3Model) p.sid3Model = "default";
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
          if (typeof p.sd2iecWriteEnabled !== "boolean") p.sd2iecWriteEnabled = false;
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
