import { detectDevice, detectOs, isIos, isIosPhone, isTouchMobile } from "./detect";
import { sidOptions } from "./machines";
import {
  catalogFiles,
  hasCmdRom,
  hasJiffyPair,
  jiffyRomPayload,
  romFileMap,
  jiffyPairBootSafe,
  romsHaveJiffyPair,
} from "./roms";
import {
  clearSessionMedia,
  removeSessionCart,
  sessionDiskOnUnit,
  sessionMediaList,
  setSessionDisk,
  type SessionMediaSlot,
} from "./session-media";
import { buildViceExtras, workDiskFor } from "./vice-extras";
import {
  defaultIecMap,
  iecMapFromLegacy,
  liveDriveOptions,
  CART_PLAY_UNLOCK_VICE_OPTS,
  PLAY_UNLOCK_VICE_OPTS,
  viceDriveTypeVars,
  viceMapFromIecMap,
  viceRcForDrives,
  viceRcFloppyIsolateProfile,
  viceRcSafeFloppyProfile,
  iecMapUnitIsSd2iec,
  withLiveFloppy,
  type DriveAttach,
} from "./play-session";
import { viceGeosFloppyOptions } from "./vice-geos";
import { viceReal1541TimingOptions } from "./vice-timing";
import { cmdDriveMap, cmdSwapUnits, sd2iecSwapUnit } from "./hw-buttons";
import {
  attachGrok64Sd2iec,
  bindGrok64WasmExports,
  detachGrok64Sd2iec,
  ensureGrok64WasmExports,
  tickGrok64Iec,
  wireGrok64ViceHost,
} from "./grok64-vice-bridge";
import { grok64RetroKeyboardAvailable } from "./grok64-keyboard";
import { reportMountFailure, runMountStage } from "./disk-mount-stage";
import { grok64DiskApi, grok64WasmApi } from "./grok64-api";
import { GROK64_REU_IMAGE_PATH, snapReuKb } from "./reu-image";
import { grok64DiskAttachCallableEmu } from "./grok64-wasm-direct";
import { grok64CoreBuildIdForUrl, grok64CoreManifestSummary, GROK64_CORE_BUILD_ID } from "./grok64-core-build";
import { appendGrok64CoreUrlCacheParams } from "./grok64-core-url";
import {
  grok64CoreBuildIdLoaded,
  grok64CoreBuildMatchesExpected,
  loadedCoreGlueInfo,
  recordGrok64CoreGlue,
} from "./grok64-core-loaded";
import {
  maybeAutoRefreshStaleEmulatorCore,
  patchEmulatorJsDownloaderCoreCacheBypass,
  patchFetchNoStoreForGrok64Core,
  patchIndexedDbForEmulatorJsCache,
  purgeAllEmulatorJsCoreRows,
  purgeEmulatorJsLegacyCoreViceRows,
  syncEmulatorJsCoreCacheWithManifest,
} from "./grok64-ejs-core-cache";

export { patchIndexedDbForEmulatorJsCache } from "./grok64-ejs-core-cache";
import {
  grok64DiskExportsReady,
  resolveViceDiskAttachPath,
  viceAttachedImage,
  viceDiskAttachCandidates,
  grok64IecAttachD64Path,
  probeViceAttachPaths,
  viceReattachDiskAsync,
  viceRetroSaveDirectory,
  recordViceLastAttach,
  ensureViceLastAttachRecorded,
  refreshViceWorkDiskAttached,
  grok64DiskModule,
  runSerializedDiskAttach,
  bindGrok64DiskExports,
  viceDiskLastAttachDiag,
  viceBusSerialRoutingOk,
  viceDriveBusProbe,
  grok64IecAttachD81Path,
  prepareDriveForAttach,
  viceUnitIsMfmDrive,
  attachesOwnImageOnly,
} from "./vice-disk";
import { writeC64Bytes } from "./c64-memory";
import {
  isAcceptedD64ByteLength,
  isAcceptedD81ByteLength,
  isCartridgePayload,
  isGcrDiskKind,
  kindOf,
} from "./formats";
import type { FastLoadCartKind } from "./jiffy-cart-compat";
import { jiffyAllowedDuringCartBoot } from "./jiffy-cart-compat";
import { readScreenText, screenTextHasReady } from "./screen-text";
import { setSessionCart } from "./session-media";
import type { SdPartition } from "./sd2iec";
import type { Sd2iecVolume } from "./sd2iec-volume";
import type {
  DriveMode,
  IecDrive,
  IecMap,
  IecUnit,
  JoyPort,
  ReuSize,
  ScpuSimm,
  SidChipModel,
  SidEngine,
  SidExtraAddress,
  SidModel,
} from "./types";
import type { SidLayout } from "./machines";
import { RETRO_BTN } from "./types";
import { glog } from "./debug";
import { stopIosPresent, stripIosPresent } from "./ios-present";
import {
  addMouse1351Delta,
  createMouse1351Accum,
  dpadForAxes,
  resetMouse1351Accum,
  takeMouse1351Frame,
} from "./mouse-1351";

const CDN_DATA = "https://cdn.emulatorjs.org/stable/data/";

/** Local Grok64 VICE core tree (usually only `cores/vice_x64sc-wasm.data`). */
export function grok64ViceCoreRoot(): string | null {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_GROK64_VICE_DATAPATH) {
    return String(import.meta.env.VITE_GROK64_VICE_DATAPATH).replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const w = window as unknown as { __GROK64_VICE_DATA?: string };
    if (w.__GROK64_VICE_DATA) return w.__GROK64_VICE_DATA.replace(/\/$/, "");
  }
  return null;
}

/** EmulatorJS data root — CDN runtime; Grok64 blobs overridden via `filePaths`. */
export function emulatorDataPath(): string {
  return CDN_DATA;
}

export const GROK64_IEC_CORE_BLOB = "vice_x64sc-grok64-iec-wasm.data";

function withGrok64CoreCacheBust(url: string): string {
  return appendGrok64CoreUrlCacheParams(url);
}

/** Absolute URL of the Grok64 IEC 7z core (when configured). */
export function grok64CoreBlobUrl(): string | null {
  const root = grok64ViceCoreRoot();
  if (!root) return null;
  const rel = `${root.startsWith("/") ? root : `/${root}`}/cores/${GROK64_IEC_CORE_BLOB}`;
  let url = rel;
  if (typeof window !== "undefined" && window.location?.origin) {
    url = `${window.location.origin}${rel}`;
  }
  return withGrok64CoreCacheBust(url);
}

function grok64LocalDataUrl(rel: string): string | null {
  const root = grok64ViceCoreRoot();
  if (!root || typeof window === "undefined" || !window.location?.origin) return null;
  const base = root.startsWith("/") ? root : `/${root}`;
  return `${window.location.origin}${base}/${rel.replace(/^\//, "")}`;
}

/** EmulatorJS `filePaths` keys are bare filenames (see emulator.js downloadFile). */
const GROK64_VICE_CORE_DATA_NAMES = [
  "vice_x64sc-wasm.data",
  "vice_x64sc-legacy-wasm.data",
  "vice_x64sc-thread-wasm.data",
  "vice_x64sc-thread-legacy-wasm.data",
] as const;

export function isGrok64ViceCoreDataLeaf(leaf: string): boolean {
  return /^vice_.*-wasm\.data$/i.test(leaf);
}

/** Per-file overrides (custom vice_x64sc WASM + shipped compression/reports). */
export function grok64EmulatorFilePaths(): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const core = grok64CoreBlobUrl();
  if (core) {
    for (const name of GROK64_VICE_CORE_DATA_NAMES) out[name] = core;
  }
  for (const name of ["extract7z.js", "extractzip.js", "libunrar.js", "libunrar.wasm"]) {
    const local = grok64LocalDataUrl(`compression/${name}`);
    if (local) out[name] = local;
  }
  const report = grok64LocalDataUrl("cores/reports/vice_x64sc.json");
  if (report) out["vice_x64sc.json"] = report;
  return Object.keys(out).length ? out : undefined;
}

export type Grok64CoreLoadRecord = { leaf: string; url: string; action: string; at: number };

export type Grok64CoreStatus = {
  kind: string;
  blobUrl: string | null;
  datapath: string | null;
  loads: Grok64CoreLoadRecord[];
  blockedStock: string[];
  attach: boolean;
  c64read: boolean;
  diskAttach: boolean;
  diskExportsPresent: boolean;
  coreBuildId: string | null;
  coreBuildIdExpected: string | null;
  coreBuildIdLoaded: string | null;
  coreBuildMatches: boolean;
  loadedGlueSha12: string | null;
  loadedGlueHasDiskExports: boolean;
  coreUrlBuildId: string | null;
  iecBackend: string;
};

export function grok64CoreStatus(emu: EjsInstance | null): Grok64CoreStatus {
  const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : {};
  const mod = emu?.Module as Parameters<typeof bindGrok64WasmExports>[0] | undefined;
  if (mod) bindGrok64WasmExports(mod);
  const wasmApi = grok64WasmApi(mod);
  const manifest = grok64CoreManifestSummary();
  const diskExportsPresent = grok64DiskAttachCallableEmu(emu) || grok64DiskExportsReady(emu);
  return {
    kind: "vice_x64sc-grok64-iec",
    blobUrl: grok64CoreBlobUrl(),
    datapath: grok64ViceCoreRoot(),
    loads: (w.__GROK64_CORE_LOADS__ as Grok64CoreLoadRecord[]) ?? [],
    blockedStock: (w.__GROK64_STOCK_CORE_BLOCKED__ as string[]) ?? [],
    attach: typeof wasmApi?.sd2iecAttach === "function",
    c64read: typeof wasmApi?.c64Read === "function",
    diskAttach: diskExportsPresent,
    diskExportsPresent,
    coreBuildId: GROK64_CORE_BUILD_ID || manifest.buildId || null,
    coreBuildIdExpected: GROK64_CORE_BUILD_ID || manifest.buildId || null,
    coreBuildIdLoaded: grok64CoreBuildIdLoaded(),
    coreBuildMatches: grok64CoreBuildMatchesExpected(),
    loadedGlueSha12: loadedCoreGlueInfo()?.glueSha12 ?? null,
    loadedGlueHasDiskExports: loadedCoreGlueInfo()?.glueHasDiskExports ?? false,
    coreUrlBuildId: manifest.urlBuildId,
    iecBackend: grok64ViceCoreRoot() ? "grok64-datapath" : "cdn-stock",
  };
}

const DATA = CDN_DATA;

const SCRIPTS = [
  "nipplejs.js",
  "emulator.js",
  "shaders.js",
  "storage.js",
  "gamepad.js",
  "GameManager.js",
  "socket.io.min.js",
  "compression.js",
];

declare global {
  interface Window {
    EmulatorJS?: new (el: string | HTMLElement, config: Record<string, unknown>) => EjsInstance;
    EJS_SHADERS?: Record<string, string>;
  }
}

interface EmscriptenFS {
  readdir: (p: string) => string[];
  stat: (p: string) => { mode: number; size?: number };
  isDir?: (mode: number) => boolean;
  readFile: (p: string, opts?: { encoding?: string }) => Uint8Array | string;
  writeFile: (p: string, d: Uint8Array | string) => void;
  mkdir?: (p: string) => void;
  unlink?: (p: string) => void;
  syncfs?: (populate: boolean, cb?: (err?: unknown) => void) => void;
}

type PadMap = Record<number, { value: string; value2: string }>;

export interface EjsInstance {
  pause: () => void;
  fileName?: string;
  gameManager?: {
    restart: () => void;
    simulateInput: (player: number, index: number, value: number) => void;
    toggleMainLoop: (on: number) => void;
    toggleFastForward: (on: boolean) => void;
    setVariable: (option: string, value: string) => void;
    getCoreOptions: () => unknown;
    getState: () => Uint8Array | Promise<Uint8Array>;
    loadState: (s: Uint8Array) => void;
    screenshot: () => Promise<Uint8Array>;
    getDiskCount: () => number;
    getCurrentDisk: () => number;
    setCurrentDisk: (n: number) => void;
    setKeyboardEnabled?: (on: boolean) => void;
    functions?: {
      simulateInput?: (player: number, index: number, value: number) => void;
      restart?: () => void;
      screenshot?: () => void;
    };
    FS?: EmscriptenFS;
  };
  Module?: {
    FS?: EmscriptenFS;
    abort?: () => void;
    pauseMainLoop?: () => void;
    canvas?: HTMLElement;
    AL?: { currentCtx?: { sources?: { gain?: { context?: AudioContext } }[] } };
    _simulate_input?: (player: number, index: number, value: number) => void;
    _retro_set_controller_port_device?: (port: number, device: number) => void;
    cwrap?: (name: string, ret: string | null, args: string[]) => (...a: unknown[]) => unknown;
  };
  on: (ev: string, cb: (...args: unknown[]) => void) => void;
  callEvent?: (ev: string, ...args: unknown[]) => void;
  volume?: number;
  paused?: boolean;
  elements?: { container?: HTMLElement; parent?: HTMLElement };
  gamepadSelection?: string[];
  controls?: Record<number, Record<number, { value?: number | string; value2?: string }>>;
  gamepad?: { gamepads?: { id: string; index: number }[]; getGamepads?: () => (Gamepad | null)[] };
  gamepadEvent?: (e: {
    type: string;
    index: number;
    label: string;
    gamepadIndex: number;
    value?: number;
    axis?: string;
  }) => void;
}

const PAD_ID = "Grok64 Touch";
const padButtons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
const padAxes = [0, 0, 0, 0];

function makePad(index: number) {
  return {
    id: PAD_ID,
    index,
    connected: true,
    mapping: "standard" as const,
    buttons: padButtons,
    axes: padAxes,
    timestamp: 0,
    hapticActuators: [] as unknown[],
    vibrationActuator: null,
  };
}

const virtualPad0 = makePad(0);
let padInstalled = false;
let keyboardArmed = false;
let restartArmed = false;
let webglPatched = false;
let userJoyPort: JoyPort = 2;

/**
 * CriOS WebGL — restored #14 / #18 / #39 host wiring.
 *
 * Read `docs/IOS_CRT_KNOWN_FAILURES.md` first.
 *
 * PR #14: iOS WebKit will not composite the C64 framebuffer without
 * preserveDrawingBuffer (VICE screenshot succeeds while the CRT stays
 * black). #42 later pre-sized the canvas to 384×272 and froze
 * width/height (`lockIosBacking`). #53 put CSS 100% of the ee0b445
 * glass back on top of that lock → Tom CriOS solid black (`3dc22be`).
 *
 * Restore the simple patch: merge preserveDrawingBuffer on iOS, stash
 * VICE's context so ios-paint never getContext()s, and leave backing
 * size to VICE. No lockIosBacking, no clientWidth lie, no viewport remap.
 */
function preserveWebglBuffer() {
  if (webglPatched || typeof HTMLCanvasElement === "undefined") return;
  webglPatched = true;
  const ios = isIos();
  const proto = HTMLCanvasElement.prototype;
  const orig = proto.getContext;
  proto.getContext = function patchedContext(
    this: HTMLCanvasElement,
    type: string,
    attrs?: Record<string, unknown>,
  ) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
      // #14: iOS compositor needs preserveDrawingBuffer. Android tablets
      // do not and pay a large fill-rate cost when it is forced on.
      const merged: Record<string, unknown> = { ...attrs, antialias: false, alpha: false };
      if (ios) merged.preserveDrawingBuffer = true;
      const ctx = orig.call(this, type, merged);
      // Remember VICE's context. ios-paint must never getContext() itself —
      // a second getContext with different attrs returns null on WebKit, and a
      // first getContext before RetroArch steals the canvas (black CRT).
      if (ctx) {
        (this as HTMLCanvasElement & { __g64gl?: unknown }).__g64gl = ctx;
      }
      return ctx;
    }
    return orig.call(this, type, attrs as never);
  } as typeof proto.getContext;
}

type GuardedGm = {
  restart: () => void;
  simulateInput: (player: number, index: number, value: number) => void;
  functions?: {
    restart?: () => void;
    simulateInput?: (player: number, index: number, value: number) => void;
  };
  __g64guard?: boolean;
};

export function guardCore(emu: EjsInstance | null) {
  if (!emu) return;
  const gm = emu.gameManager as GuardedGm | undefined;
  if (gm && !gm.__g64guard) {
    gm.__g64guard = true;
    const origRestart = gm.restart.bind(gm);
    gm.restart = () => {
      if (!restartArmed) {
        glog("restart-blocked");
        return;
      }
      glog("restart-ok");
      origRestart();
    };
    if (gm.functions?.restart) {
      const inner = gm.functions.restart.bind(gm.functions);
      gm.functions.restart = () => {
        if (!restartArmed) {
          glog("restart-blocked-fn");
          return;
        }
        inner();
      };
    }
    const wrapSim = (fn: ((player: number, index: number, value: number) => void) | undefined) => {
      if (!fn) return fn;
      return (player: number, index: number, value: number) => {
        if (index >= 24 && index <= 26) {
          if (value) glog("ejs-special-blocked", { player, index, value });
          return;
        }
        fn(player, index, value);
      };
    };
    if (gm.simulateInput) gm.simulateInput = wrapSim(gm.simulateInput.bind(gm))!;
    if (gm.functions?.simulateInput) {
      gm.functions.simulateInput = wrapSim(gm.functions.simulateInput.bind(gm.functions));
    }
  }
  const mod = emu.Module as { abort?: () => void; __g64abort?: boolean } | undefined;
  if (mod && !mod.__g64abort) {
    mod.__g64abort = true;
    mod.abort = () => {
      glog("abort-blocked");
    };
  }
  if (grok64ViceCoreRoot()) {
    ensureGrok64WasmExports(emu);
    wireGrok64ViceHost(emu);
    void maybeAutoRefreshStaleEmulatorCore(emu);
  }
}

function btn(i: number, on: boolean) {
  padButtons[i].pressed = on;
  padButtons[i].touched = on;
  padButtons[i].value = on ? 1 : 0;
}

let origGetGamepads: Navigator["getGamepads"] | null = null;
const NATIVE_PADS = "__g64NativePads";

export function listRealGamepads(): Gamepad[] {
  if (typeof navigator === "undefined") return [];
  try {
    const nav = navigator as Navigator & { [NATIVE_PADS]?: Navigator["getGamepads"] };
    const fn = origGetGamepads ?? nav[NATIVE_PADS] ?? navigator.getGamepads?.bind(navigator);
    const list = fn ? Array.from(fn.call(navigator)) : [];
    return list.filter((p): p is Gamepad => Boolean(p && p.connected && p.id && p.id !== PAD_ID));
  } catch {
    return [];
  }
}

export function hasRealGamepad(): boolean {
  return listRealGamepads().length > 0;
}

export function installVirtualPad() {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    webkitGetGamepads?: () => (Gamepad | null)[];
    [NATIVE_PADS]?: Navigator["getGamepads"];
  };
  if (!nav[NATIVE_PADS] && nav.getGamepads && !(nav.getGamepads as { __g64pad?: boolean }).__g64pad) {
    nav[NATIVE_PADS] = nav.getGamepads.bind(nav);
  }
  origGetGamepads = nav[NATIVE_PADS] ?? origGetGamepads;
  if (padInstalled) return;
  padInstalled = true;
  const orig = origGetGamepads;
  const origWeb = nav.webkitGetGamepads?.bind(nav);
  const list = () => {
    const now = performance.now();
    virtualPad0.timestamp = now;
    let real: (Gamepad | null)[] = [];
    try {
      if (orig && orig !== list) real = Array.from(orig());
      else if (origWeb) real = Array.from(origWeb());
    } catch {
      real = [];
    }
    const extras = real.filter((p) => p && p.id !== PAD_ID);
    return [
      virtualPad0 as unknown as Gamepad,
      extras[0] ?? null,
      extras[1] ?? null,
      extras[2] ?? null,
    ];
  };
  (list as { __g64pad?: boolean }).__g64pad = true;
  try {
    Object.defineProperty(nav, "getGamepads", { configurable: true, value: list });
  } catch {
    nav.getGamepads = list as Navigator["getGamepads"];
  }
  if (nav.webkitGetGamepads) {
    try {
      Object.defineProperty(nav, "webkitGetGamepads", { configurable: true, value: list });
    } catch {
      nav.webkitGetGamepads = list;
    }
  }
}

export function bindVirtualPad(emu: EjsInstance | null) {
  if (!emu) return;
  installVirtualPad();
  try {
    const gp = emu.gamepad;
    if (gp) {
      gp.getGamepads = () => [virtualPad0 as unknown as Gamepad, null, null, null];
    }
  } catch {
    /* ignore */
  }
  try {
    if (!Array.isArray(emu.gamepadSelection)) emu.gamepadSelection = ["", "", "", ""];
    emu.gamepadSelection[0] = `${PAD_ID}_0`;
    emu.gamepadSelection[1] = "";
  } catch {
    /* ignore */
  }
  ensureValue2(emu);
}

function ensureValue2(emu: EjsInstance | null) {
  if (!emu) return;
  const maps: [number, string][] = [
    [0, "BUTTON_2"],
    [1, "BUTTON_4"],
    [2, "SELECT"],
    [3, "START"],
    [4, "DPAD_UP"],
    [5, "DPAD_DOWN"],
    [6, "DPAD_LEFT"],
    [7, "DPAD_RIGHT"],
    [8, "BUTTON_1"],
    [9, "BUTTON_3"],
    [10, "LEFT_TOP_SHOULDER"],
    [11, "RIGHT_TOP_SHOULDER"],
    [16, "LEFT_STICK_X:+1"],
    [17, "LEFT_STICK_X:-1"],
    [18, "LEFT_STICK_Y:+1"],
    [19, "LEFT_STICK_Y:-1"],
  ];
  try {
    if (!emu.controls) emu.controls = {};
    if (!emu.controls[0]) emu.controls[0] = {};
    for (const [idx, label] of maps) {
      const row = emu.controls[0][idx] ?? {};
      row.value = "unbound";
      row.value2 = label;
      emu.controls[0][idx] = row;
    }
  } catch {
    /* ignore */
  }
}

function setVirtualPad(dx: number, dy: number, fire: boolean) {
  const dead = 0.32;
  btn(14, dx < -dead);
  btn(15, dx > dead);
  btn(12, dy < -dead);
  btn(13, dy > dead);
  btn(0, fire);
  btn(1, false);
  virtualPad0.timestamp = performance.now();
}

let scriptsReady: Promise<void> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function loadCss(href: string) {
  return new Promise<void>((resolve) => {
    const existing = document.querySelector(`link[href="${href}"]`);
    if (existing) {
      resolve();
      return;
    }
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    l.onload = () => resolve();
    l.onerror = () => resolve();
    document.head.appendChild(l);
  });
}

/** Warm the VICE WASM payload so power-on is not a ~39s blank on first paint. */
export function prefetchViceCores() {
  if (typeof fetch === "undefined") return;
  if (grok64ViceCoreRoot()) {
    const blob = grok64CoreBlobUrl();
    if (blob) void fetch(blob, { mode: "cors", credentials: "omit", cache: "no-store" }).catch(() => undefined);
    return;
  }
  const blob = grok64CoreBlobUrl();
  if (blob) {
    void fetch(blob, { mode: "cors", credentials: "omit", cache: "no-store" }).catch(() => undefined);
    return;
  }
  const names = isIosPhone() ? ["vice_x64sc"] : ["vice_x64sc"];
  for (const n of names) {
    for (const ext of ["-wasm.js", "-wasm.data"] as const) {
      void fetch(`${DATA}cores/${n}${ext}`, { mode: "cors", credentials: "omit" }).catch(() => undefined);
    }
  }
}

function applyGrok64EmulatorJsRuntimePatches(): void {
  patchEjsGrok64CoreDownload();
  patchEjsInitGameCoreGlue();
  patchEmulatorJsDownloaderCoreCacheBypass();
}

export function ensureRuntime(): Promise<void> {
  if (scriptsReady) return scriptsReady;
  if (typeof window !== "undefined" && window.EmulatorJS && (window as unknown as { nipplejs?: unknown }).nipplejs) {
    if (!scriptsReady) {
      scriptsReady = (async () => {
        patchIndexedDbForEmulatorJsCache();
        patchFetchNoStoreForGrok64Core();
        await syncEmulatorJsCoreCacheWithManifest().catch(() => undefined);
        applyGrok64EmulatorJsRuntimePatches();
      })();
    }
    return scriptsReady;
  }
  scriptsReady = (async () => {
    patchIndexedDbForEmulatorJsCache();
    patchFetchNoStoreForGrok64Core();
    await syncEmulatorJsCoreCacheWithManifest().catch(() => undefined);
    await loadCss(`${DATA}emulator.css`);
    for (const file of SCRIPTS) {
      await loadScript(`${DATA}src/${file}`);
    }
    if (!window.EmulatorJS) throw new Error("EmulatorJS failed to initialize");
    patchEjsInput();
    applyGrok64EmulatorJsRuntimePatches();
  })().catch((err) => {
    scriptsReady = null;
    throw err;
  });
  return scriptsReady;
}

function recordGrok64CoreLoad(leaf: string, url: string, action: string) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __GROK64_CORE_LOADS__?: Grok64CoreLoadRecord[] };
  if (!w.__GROK64_CORE_LOADS__) w.__GROK64_CORE_LOADS__ = [];
  w.__GROK64_CORE_LOADS__.push({ leaf, url, action, at: Date.now() });
}

function recordBlockedStockCore(url: string) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __GROK64_STOCK_CORE_BLOCKED__?: string[] };
  if (!w.__GROK64_STOCK_CORE_BLOCKED__) w.__GROK64_STOCK_CORE_BLOCKED__ = [];
  w.__GROK64_STOCK_CORE_BLOCKED__.push(url);
}

/** EmulatorJS core path includes `?v=` — force single Grok64 blob; never CDN-fallback stock vice cores. */
function patchEjsGrok64CoreDownload() {
  const url = grok64CoreBlobUrl();
  if (!url) return;
  const EJS = (window as unknown as {
    EmulatorJS?: { prototype: { downloadFile?: (...a: unknown[]) => unknown; __g64Core?: boolean } };
  }).EmulatorJS;
  const proto = EJS?.prototype;
  if (!proto?.downloadFile || proto.__g64Core) return;
  proto.__g64Core = true;
  const orig = proto.downloadFile;
  proto.downloadFile = function patchedDownload(...args: unknown[]) {
    const path = String(args[0] ?? "");
    const leaf = path.split("?")[0].split("/").pop() ?? "";
    const isViceCoreData = isGrok64ViceCoreDataLeaf(leaf);
    const filePaths = (this as { config?: { filePaths?: Record<string, string> } }).config?.filePaths;
    const canonical = grok64CoreBlobUrl();
    if (isViceCoreData) {
      void purgeAllEmulatorJsCoreRows("pre-vice-download").catch(() => undefined);
      void purgeEmulatorJsLegacyCoreViceRows("pre-vice-download").catch(() => undefined);
      recordGrok64CoreLoad(leaf, filePaths?.[leaf] ?? canonical ?? url, filePaths?.[leaf] ? "filePaths" : "redirect");
      if (canonical && filePaths) {
        for (const name of GROK64_VICE_CORE_DATA_NAMES) {
          filePaths[name] = canonical;
        }
      }
      if (!filePaths?.[leaf]) {
        args[0] = canonical ?? url;
        if (args.length > 3) args[3] = true;
      }
      args[6] = true;
    }
    if (/cdn\.emulatorjs\.org/i.test(path) && /\/cores\/vice_.*wasm\.data/i.test(path)) {
      recordBlockedStockCore(path);
      recordGrok64CoreLoad(leaf || path, url, "blocked-cdn");
      args[0] = url;
      if (args.length > 3) args[3] = true;
    }
    const dt = (this as { downloadType?: { core?: { cdnFallback?: boolean } } }).downloadType;
    let prevFb: boolean | undefined;
    if (isViceCoreData && dt?.core) {
      prevFb = dt.core.cdnFallback;
      dt.core.cdnFallback = false;
    }
    try {
      const out = orig.apply(this, args);
      if (out && typeof (out as Promise<unknown>).then === "function") {
        return (out as Promise<unknown>).then((res) => {
          if (res === -1 && isViceCoreData) {
            throw new Error(`Grok64 core download failed for ${leaf}`);
          }
          return res;
        });
      }
      return out;
    } finally {
      if (prevFb !== undefined && dt?.core) dt.core.cdnFallback = prevFb;
    }
  };
}

function patchEjsInitGameCoreGlue() {
  const EJS = (window as unknown as {
    EmulatorJS?: { prototype: { initGameCore?: (js: unknown, wasm: unknown, thread: unknown) => void; __g64Glue?: boolean } };
  }).EmulatorJS;
  const proto = EJS?.prototype;
  if (!proto?.initGameCore || proto.__g64Glue) return;
  proto.__g64Glue = true;
  const orig = proto.initGameCore;
  proto.initGameCore = function patchedInitGameCore(js: unknown, wasm: unknown, thread: unknown) {
    try {
      if (js instanceof Uint8Array) recordGrok64CoreGlue(js);
      else if (js instanceof ArrayBuffer) recordGrok64CoreGlue(js);
      else if (typeof js === "string") recordGrok64CoreGlue(js);
    } catch {
      /* ignore */
    }
    return orig.call(this, js, wasm, thread);
  };
}

function patchEjsInput() {
  const GM = (window as unknown as { EJS_GameManager?: { prototype: { getRetroArchCfg?: () => string; __g64pad?: boolean } } })
    .EJS_GameManager;
  const proto = GM?.prototype;
  if (proto && !proto.__g64pad && typeof proto.getRetroArchCfg === "function") {
    proto.__g64pad = true;
    const orig = proto.getRetroArchCfg;
    proto.getRetroArchCfg = function patchedCfg(this: unknown) {
      const iosAudio = isIosPhone()
        ? "audio_latency = 320\n" + "audio_block_frames = 512\n" + "audio_out_rate = 48000\n"
        : isTouchMobile()
          ? "audio_latency = 224\n" + "audio_block_frames = 384\n" + "audio_out_rate = 48000\n"
          : "audio_latency = 160\n";
      const sync = isTouchMobile()
        ? "audio_sync = true\n" + "audio_max_timing_skew = 0.08\n" + "audio_rate_control = true\n"
        : "audio_sync = true\n" + "audio_max_timing_skew = 0.05\n" + "audio_rate_control = true\n";
      return (
        orig.call(this) +
        "video_gpu_screenshot = false\n" +
        "video_vsync = true\n" +
        "autosave_interval = 0\n" +
        "savestate_auto_load = false\n" +
        "savestate_auto_save = false\n" +
        iosAudio +
        sync +
        'input_libretro_device_p1 = "1"\n' +
        'input_libretro_device_p2 = "0"\n' +
        "input_player1_analog_dpad_mode = 0\n" +
        "input_player1_joypad_index = 0\n" +
        "input_autodetect_enable = false\n" +
        "input_max_users = 1\n" +
        'input_player1_a = "nul"\n' +
        'input_player1_b = "nul"\n' +
        'input_player1_x = "nul"\n' +
        'input_player1_y = "nul"\n' +
        'input_player1_l = "nul"\n' +
        'input_player1_r = "nul"\n' +
        'input_player1_l2 = "nul"\n' +
        'input_player1_r2 = "nul"\n' +
        'input_player1_l3 = "nul"\n' +
        'input_player1_r3 = "nul"\n' +
        'input_player1_start = "nul"\n' +
        'input_player1_select = "nul"\n' +
        'input_player1_up = "nul"\n' +
        'input_player1_down = "nul"\n' +
        'input_player1_left = "nul"\n' +
        'input_player1_right = "nul"\n' +
        'input_player1_l_x_plus = "+0"\n' +
        'input_player1_l_x_minus = "-0"\n' +
        'input_player1_l_y_plus = "+1"\n' +
        'input_player1_l_y_minus = "-1"\n' +
        'input_player1_up_axis = "nul"\n' +
        'input_player1_down_axis = "nul"\n' +
        'input_player1_left_axis = "nul"\n' +
        'input_player1_right_axis = "nul"\n' +
        'input_player1_up_btn = "nul"\n' +
        'input_player1_down_btn = "nul"\n' +
        'input_player1_left_btn = "nul"\n' +
        'input_player1_right_btn = "nul"\n' +
        'input_enable_hotkey = "nul"\n' +
        'input_pause_toggle = "nul"\n' +
        'input_reset = "nul"\n' +
        'input_exit_emulator = "nul"\n' +
        'input_menu_toggle = "nul"\n' +
        'input_load_state = "nul"\n' +
        'input_save_state = "nul"\n' +
        'input_state_slot_increase = "nul"\n' +
        'input_state_slot_decrease = "nul"\n'
      );
    };
  }
  const Ejs = window.EmulatorJS as unknown as {
    prototype?: {
      getCoreSettings?: () => string;
      keyChange?: (e: KeyboardEvent) => void;
      __g64opt?: boolean;
      __g64keys?: boolean;
    };
  };
  const eproto = Ejs?.prototype;
  if (eproto && !eproto.__g64opt && typeof eproto.getCoreSettings === "function") {
    eproto.__g64opt = true;
    eproto.getCoreSettings = function patchedOpts(this: { config?: { defaultOptions?: Record<string, string> } }) {
      const opts = this.config?.defaultOptions || {};
      let rv = "";
      for (const k of Object.keys(opts)) {
        rv += `${k} = "${opts[k]}"\n`;
      }
      return rv;
    };
  }
  if (eproto && !eproto.__g64keys && typeof eproto.keyChange === "function") {
    eproto.__g64keys = true;
    const origKey = eproto.keyChange;
    eproto.keyChange = function patchedKeys(this: unknown, e: KeyboardEvent) {
      // Space is PETSCII $20. Never Start / Reset / retro-pad.
      if (e.code === "Space" || e.key === " " || (e as KeyboardEvent & { keyCode?: number }).keyCode === 32) {
        return;
      }
      return origKey.call(this, e);
    };
  }
}

export interface BootConfig {
  gameUrl: string;
  gameName: string;
  core: string;
  machineOptions: Record<string, string>;
  sidEngine: SidEngine;
  sidModel: SidModel;
  sid2?: SidExtraAddress;
  sid2Model?: SidChipModel;
  sid3?: SidExtraAddress;
  sid3Model?: SidChipModel;
  driveMode: Exclude<DriveMode, "auto">;
  joyPort: JoyPort;
  volume: number;
  autostart?: boolean;
  reu?: ReuSize;
  iec?: IecDrive;
  iecUnit?: IecUnit;
  mouse?: boolean;
  scpu?: boolean;
  scpuSimm?: ScpuSimm;
  scpuTurbo?: boolean;
  jiffy?: boolean;
  onStart: () => void;
  onReady?: () => void;
  onError?: (msg: string) => void;
}

function coreOptions(cfg: BootConfig): Record<string, string> {
  const trueDrive = cfg.driveMode === "true";
  return {
    ...cfg.machineOptions,
    ...sidOptions({
      engine: cfg.sidEngine,
      model: cfg.sidModel,
      sid2: cfg.sid2 ?? "disabled",
      sid2Model: cfg.sid2Model ?? "default",
      sid3: cfg.sid3 ?? "disabled",
      sid3Model: cfg.sid3Model ?? "default",
    }),
    vice_drive_true_emulation: trueDrive ? "enabled" : "disabled",
    vice_virtual_device_traps: trueDrive ? "disabled" : "enabled",
    vice_autostart: cfg.autostart === false ? "disabled" : "enabled",
    vice_autostart_warp: cfg.autostart === false ? "disabled" : "enabled",
    vice_autoloadwarp: cfg.autostart === false ? "disabled" : "enabled",
    vice_reset: cfg.autostart === false ? "hard" : "autostart",
    vice_statusbar: "disabled",
    vice_vkbd: "disabled",
    vice_keyboard_input: "enabled",
    // "disabled" makes the core drop every key while joystick fire is held (screen click).
    vice_physical_keyboard_pass_through: "enabled",
    ...viceJoyOptions(cfg.joyPort),
    ...buildViceExtras({
      reu: cfg.reu ?? "none",
      iec: cfg.iec ?? "1541",
      iecUnit: cfg.iecUnit ?? 8,
      mouse: !!cfg.mouse,
      joyPort: cfg.joyPort,
      scpu: !!cfg.scpu,
      scpuSimm: cfg.scpuSimm,
      scpuTurbo: cfg.scpuTurbo,
      jiffy: !!cfg.jiffy,
    }),
    shader: "disabled",
  };
}

export async function bootEmulator(el: HTMLElement, cfg: BootConfig): Promise<EjsInstance> {
  patchIndexedDbForEmulatorJsCache();
  patchFetchNoStoreForGrok64Core();
  await syncEmulatorJsCoreCacheWithManifest().catch(() => undefined);
  await ensureRuntime();
  applyGrok64EmulatorJsRuntimePatches();
  preserveWebglBuffer();
  keyboardArmed = false;
  clearRuntimeViceOpts();
  const defaults = coreOptions(cfg);
  rememberWorkDisk(defaults.vice_work_disk);
  const dataPath = emulatorDataPath();
  const filePaths = grok64EmulatorFilePaths();
  const config: Record<string, unknown> = {
    gameUrl: cfg.gameUrl,
    dataPath,
    ...(filePaths ? { filePaths } : {}),
    system: cfg.core,
    gameName: (cfg.gameName || "GROK64").replace(/[#<$+%>!`&*'|{}/\\?"=@:^\r\n]/g, "").trim() || "GROK64",
    color: "#c8ccd4",
    backgroundColor: "#0a0a0b",
    volume: cfg.volume,
    startOnLoad: true,
    webgl2: true,
    threads: false,
    noAutoFocus: false,
    disableAutoLang: true,
    disableLocalStorage: true,
    disableCue: true,
    language: "en-US",
    browserMode: 2,
    keyboardInput: "enabled",
    defaultOptions: defaults,
    defaultControllers: padControllers(),
    retroarchOpts: [
      { name: "input_libretro_device_p1", default: "1", isString: false },
      { name: "input_libretro_device_p2", default: "0", isString: false },
    ],
    buttonOpts: {
      playPause: false,
      restart: false,
      mute: false,
      settings: false,
      fullscreen: false,
      saveState: false,
      loadState: false,
      screenshot: false,
      gamepad: false,
      cheat: false,
      volume: false,
      saveSavFiles: false,
      loadSavFiles: false,
      quickSave: false,
      quickLoad: false,
      cacheManager: false,
    },
    VirtualGamepadSettings: undefined,
  };

  el.innerHTML = "";
  installVirtualPad();
  const emu = new window.EmulatorJS!("#grok64-player", config);
  (window as unknown as { __ejs?: EjsInstance }).__ejs = emu;
  let started = false;
  emu.on("start", () => {
    if (started) return;
    started = true;
    plugJoysticks(emu, cfg.joyPort);
    guardCore(emu);
    cfg.onStart();
  });
  emu.on("ready", () => cfg.onReady?.());
  emu.on("error", (...args: unknown[]) => {
    const msg = args.map((a) => (a instanceof Error ? a.message : String(a ?? ""))).filter(Boolean).join(" ") || "Emulator error";
    cfg.onError?.(msg);
  });
  return emu;
}

function audioCtxLocked(ctx: { state?: string } | null | undefined): boolean {
  return ctx?.state === "suspended" || ctx?.state === "interrupted";
}

function resumeAudioCtx(ctx: { state?: string; resume?: () => Promise<void> } | null | undefined) {
  if (!ctx || typeof ctx.resume !== "function") return;
  if (audioCtxLocked(ctx)) void ctx.resume().catch(() => undefined);
}

export function audioLocked(emu: EjsInstance | null): boolean {
  try {
    const al = emu?.Module?.AL?.currentCtx;
    if (audioCtxLocked(al as { state?: string } | undefined)) return true;
    const sources = al?.sources;
    if (sources) {
      for (const src of sources) {
        if (audioCtxLocked(src?.gain?.context)) return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function unlockAudio(emu: EjsInstance | null) {
  try {
    const al = emu?.Module?.AL?.currentCtx;
    resumeAudioCtx(al as { state?: string; resume?: () => Promise<void> } | undefined);
    const sources = al?.sources;
    if (sources) {
      for (const src of sources) {
        resumeAudioCtx(src?.gain?.context);
      }
    }
  } catch {
    /* ignore */
  }
  try {
    emu?.gameManager?.toggleMainLoop(1);
  } catch {
    /* ignore */
  }
  if (emu) {
    try {
      emu.paused = false;
    } catch {
      /* ignore */
    }
  }
}

export function suspendAudio(emu: EjsInstance | null) {
  try {
    const sources = emu?.Module?.AL?.currentCtx?.sources;
    if (sources) {
      for (const src of sources) {
        const ctx = src?.gain?.context;
        if (ctx && ctx.state === "running") {
          void ctx.suspend().catch(() => undefined);
        }
      }
    }
  } catch {
    /* ignore */
  }
}

export function dismissEjsPrompts(root: HTMLElement | null, mode: "boot" | "play" = "play") {
  if (!root || typeof (root as HTMLElement).querySelectorAll !== "function") return;
  const nodes = root.querySelectorAll("button, a, .ejs_menu_button, .ejs_popup_container");
  for (const el of nodes) {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    const resume = /resume emulator|click to resume/i.test(t);
    const playNow = /play now|click here to start/i.test(t);
    if (resume || (mode === "boot" && playNow)) {
      (el as HTMLElement).click();
    }
  }
}

export function viceJoyOptions(port: JoyPort): Record<string, string> {
  return {
    vice_joyport: port === 1 ? "1" : "2",
    vice_joyport_type: "1",
    vice_retropad_options: "disabled",
    vice_keyrah_keypad_mappings: "disabled",
    vice_mapper_up: "---",
    vice_mapper_down: "---",
    vice_mapper_left: "---",
    vice_mapper_right: "---",
    vice_mapper_lu: "---",
    vice_mapper_ld: "---",
    vice_mapper_ll: "---",
    vice_mapper_lr: "---",
    vice_mapper_ru: "---",
    vice_mapper_rd: "---",
    vice_mapper_rl: "---",
    vice_mapper_rr: "---",
  };
}

function padMap(): PadMap {
  const unbound = { value: "unbound", value2: "" };
  return {
    0: { value: "unbound", value2: "BUTTON_2" },
    1: { value: "unbound", value2: "BUTTON_4" },
    2: { value: "unbound", value2: "SELECT" },
    3: { value: "unbound", value2: "START" },
    4: { value: "unbound", value2: "DPAD_UP" },
    5: { value: "unbound", value2: "DPAD_DOWN" },
    6: { value: "unbound", value2: "DPAD_LEFT" },
    7: { value: "unbound", value2: "DPAD_RIGHT" },
    8: { value: "unbound", value2: "BUTTON_1" },
    9: { value: "unbound", value2: "BUTTON_3" },
    10: { value: "unbound", value2: "LEFT_TOP_SHOULDER" },
    11: { value: "unbound", value2: "RIGHT_TOP_SHOULDER" },
    16: { ...unbound, value2: "LEFT_STICK_X:+1" },
    17: { ...unbound, value2: "LEFT_STICK_X:-1" },
    18: { ...unbound, value2: "LEFT_STICK_Y:+1" },
    19: { ...unbound, value2: "LEFT_STICK_Y:-1" },
  };
}

export function padControllers() {
  const p = padMap();
  return { 0: { ...p }, 1: {}, 2: {}, 3: {} };
}

export function plugJoysticks(emu: EjsInstance | null, _port: JoyPort = 2) {
  if (!emu) return;
  userJoyPort = _port;
  guardCore(emu);
  const grokKbd = grok64RetroKeyboardAvailable(emu);
  applyRuntimeOptions(emu, {
    vice_physical_keyboard_pass_through: "enabled",
    vice_keyboard_input: "enabled",
  });
  try {
    // Single keyboard path: libretro export OR EmulatorJS rwebinput — never both.
    emu.gameManager?.setKeyboardEnabled?.(!grokKbd);
  } catch {
    /* ignore */
  }
  keyboardArmed = true;
  bindVirtualPad(emu);
  window.setTimeout(() => ensureValue2(emu), 250);
  window.setTimeout(() => ensureValue2(emu), 1200);
  for (let i = 0; i < 16; i++) joyInput(emu, i, false);
  try {
    emu.gameManager?.setVariable?.("vice_joyport", _port === 1 ? "1" : "2");
  } catch {
    /* ignore */
  }
  const canvas =
    (emu.Module?.canvas as HTMLElement | undefined) ??
    (document.querySelector("#grok64-player canvas") as HTMLElement | null);
  if (canvas && !canvas.id) canvas.id = "canvas";
  try {
    emu.elements?.parent?.focus?.();
  } catch {
    /* ignore */
  }
}

function rawSim(emu: EjsInstance | null, player: number, index: number, value: number) {
  const gm = emu?.gameManager;
  const mod = emu?.Module;
  try {
    gm?.functions?.simulateInput?.(player, index, value);
  } catch {
    /* ignore */
  }
  try {
    gm?.simulateInput(player, index, value);
  } catch {
    /* ignore */
  }
  try {
    mod?._simulate_input?.(player, index, value);
  } catch {
    /* ignore */
  }
}

export function joyInput(emu: EjsInstance | null, index: number, down: boolean, player = 0) {
  const analog = index >= 16 && index <= 23;
  const value = down ? (analog ? 0x7fff : 1) : 0;
  rawSim(emu, player, index, value);
}

/** When a 1351 is on the selected port, digital stick goes to libretro player 1 (the other C64 port). */
export function digitalJoyPlayer(mouseMode: boolean): 0 | 1 {
  return mouseMode ? 1 : 0;
}

export function setJoyVector(emu: EjsInstance | null, dx: number, dy: number, fire: boolean, player = 0) {
  setVirtualPad(dx, dy, fire);
  const dead = 0.32;
  const left = dx < -dead;
  const right = dx > dead;
  const up = dy < -dead;
  const down = dy > dead;
  joyInput(emu, RETRO_BTN.LEFT, left, player);
  joyInput(emu, RETRO_BTN.RIGHT, right, player);
  joyInput(emu, RETRO_BTN.UP, up, player);
  joyInput(emu, RETRO_BTN.DOWN, down, player);
  joyInput(emu, RETRO_BTN.B, fire, player);
  joyInput(emu, RETRO_BTN.A, false, player);
  joyInput(emu, RETRO_BTN.Y, false, player);
}

function analogStick(emu: EjsInstance | null, ax: number, ay: number, player = 0) {
  const x = Math.round(Math.max(-1, Math.min(1, ax)) * 0x7fff);
  const y = Math.round(Math.max(-1, Math.min(1, ay)) * 0x7fff);
  rawSim(emu, player, 16, x > 0 ? x : 0);
  rawSim(emu, player, 17, x < 0 ? -x : 0);
  rawSim(emu, player, 18, y > 0 ? y : 0);
  rawSim(emu, player, 19, y < 0 ? -y : 0);
}

/** 1351 mouse: analog stick this poll equals the leftover pixel deltas (see mouse-1351.ts). */
export function setMouseAnalog(
  emu: EjsInstance | null,
  ax: number,
  ay: number,
  leftDown: boolean,
  rightDown: boolean,
) {
  const cx = Math.max(-1, Math.min(1, ax));
  const cy = Math.max(-1, Math.min(1, ay));
  const pad = dpadForAxes(cx, cy);
  padAxes[0] = cx;
  padAxes[1] = cy;
  padAxes[2] = 0;
  padAxes[3] = 0;
  btn(0, leftDown);
  btn(1, rightDown);
  btn(14, pad.left);
  btn(15, pad.right);
  btn(12, pad.up);
  btn(13, pad.down);
  virtualPad0.timestamp = performance.now();
  analogStick(emu, cx, cy);
  try {
    emu?.gamepadEvent?.({ type: "axis", index: 0, label: "LEFT_STICK_X", gamepadIndex: 0, value: cx });
    emu?.gamepadEvent?.({ type: "axis", index: 1, label: "LEFT_STICK_Y", gamepadIndex: 0, value: cy });
    if (leftDown) emu?.gamepadEvent?.({ type: "button", index: 0, label: "BUTTON_2", gamepadIndex: 0, value: 1 });
    if (rightDown) emu?.gamepadEvent?.({ type: "button", index: 1, label: "BUTTON_4", gamepadIndex: 0, value: 1 });
  } catch {
    /* ignore */
  }
  joyInput(emu, RETRO_BTN.B, leftDown);
  joyInput(emu, RETRO_BTN.A, rightDown);
  // Analog may never reach RETRO_DEVICE_ANALOG; vice-libretro still turns these
  // bits into retro_mouse_move → VICE mouse_move → 1351 POT X/Y.
  joyInput(emu, RETRO_BTN.LEFT, pad.left);
  joyInput(emu, RETRO_BTN.RIGHT, pad.right);
  joyInput(emu, RETRO_BTN.UP, pad.up);
  joyInput(emu, RETRO_BTN.DOWN, pad.down);
}

export function clearMouseAnalog(emu: EjsInstance | null) {
  setMouseAnalog(emu, 0, 0, false, false);
}

const hostMouse1351 = createMouse1351Accum();
const hostMouseBtn = { left: false, right: false };
let hostMouseHeld = { ax: 0, ay: 0 };
let hostMouseFlushAt = 0;

export function addHostMouseDelta(dx: number, dy: number) {
  addMouse1351Delta(hostMouse1351, dx, dy);
}

export function setHostMouseButtons(left: boolean, right: boolean) {
  hostMouseBtn.left = left;
  hostMouseBtn.right = right;
}

/** Hold this frame's analog until the next VICE poll (~one video frame). */
export function flushHostMouse1351(emu: EjsInstance | null, periodMs = 20) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - hostMouseFlushAt >= periodMs) {
    hostMouseFlushAt = now;
    hostMouseHeld = takeMouse1351Frame(hostMouse1351);
  }
  setMouseAnalog(emu, hostMouseHeld.ax, hostMouseHeld.ay, hostMouseBtn.left, hostMouseBtn.right);
}

export function clearHostMouse1351(emu: EjsInstance | null) {
  resetMouse1351Accum(hostMouse1351);
  hostMouseBtn.left = false;
  hostMouseBtn.right = false;
  hostMouseHeld = { ax: 0, ay: 0 };
  hostMouseFlushAt = 0;
  clearMouseAnalog(emu);
}

export function resetEmu(emu: EjsInstance | null) {
  guardCore(emu);
  restartArmed = true;
  try {
    emu?.gameManager?.restart();
  } catch {
    /* ignore */
  }
  restartArmed = false;
}

export function autostartReset(emu: EjsInstance | null, trueDrive = false) {
  applyRuntimeOptions(emu, {
    vice_autostart: "enabled",
    vice_autostart_warp: "enabled",
    vice_autoloadwarp: "enabled",
    vice_reset: "autostart",
    ...(trueDrive
      ? {
          vice_drive_true_emulation: "enabled",
          vice_virtual_device_traps: "disabled",
        }
      : {}),
  });
  resetEmu(emu);
  plugJoysticks(emu);
}

export function setPaused(emu: EjsInstance | null, paused: boolean) {
  try {
    emu?.gameManager?.toggleMainLoop(paused ? 0 : 1);
  } catch {
    /* ignore */
  }
}

export function setWarp(emu: EjsInstance | null, on: boolean) {
  try {
    emu?.gameManager?.toggleFastForward(on);
  } catch {
    /* ignore */
  }
}

export function destroyEmu(emu: EjsInstance | null, el: HTMLElement | null) {
  resetFitCache();
  lastJiffy = false;
  stopIosPresent();
  keyboardArmed = false;
  try {
    emu?.gameManager?.toggleMainLoop(0);
  } catch {
    /* ignore */
  }
  try {
    emu?.Module?.pauseMainLoop?.();
  } catch {
    /* ignore */
  }
  try {
    clearRetroSaves(emu);
  } catch {
    /* ignore */
  }
  try {
    delete (window as unknown as { EJS_Runtime?: unknown }).EJS_Runtime;
  } catch {
    /* ignore */
  }
  for (const s of Array.from(document.querySelectorAll("script"))) {
    if (s.src.startsWith("blob:")) {
      s.remove();
      try {
        URL.revokeObjectURL(s.src);
      } catch {
        /* ignore */
      }
    }
  }
  if (el) el.innerHTML = "";
}

let fitting = false;
let lastFitBox = { pw: 0, ph: 0, bw: 0, bh: 0 };

export function resetFitCache() {
  lastFitBox = { pw: 0, ph: 0, bw: 0, bh: 0 };
}

/** Desktop/Chromium: nudge compositor so the CRT repaints without a mouse move. */
export function bumpCrtPaint(emu: EjsInstance | null) {
  const canvas =
    (emu?.Module?.canvas as HTMLCanvasElement | undefined) ??
    (document.querySelector("#grok64-player canvas:not(.g64-ios-present)") as HTMLCanvasElement | null);
  if (!canvas) return;
  try {
    const prev = canvas.style.getPropertyValue("transform");
    canvas.style.setProperty("transform", "translateZ(0.001px)");
    void canvas.offsetWidth;
    requestAnimationFrame(() => {
      canvas.style.setProperty("transform", prev || "none");
    });
  } catch {
    /* ignore */
  }
  try {
    emu?.gameManager?.toggleMainLoop?.(1);
  } catch {
    /* ignore */
  }
}

export function fitEmu(el: HTMLElement | null, emu: EjsInstance | null, force = false) {
  if (!el || fitting) return;
  fitting = true;
  const canvas =
    (emu?.Module?.canvas as HTMLCanvasElement | undefined) ||
    (el.querySelector("canvas:not(.g64-ios-mirror):not(.g64-ios-present)") as HTMLCanvasElement | null);
  try {
    if (canvas) {
      const parent = canvas.parentElement ?? el;
      const cw = Math.max(parent.clientWidth, el.clientWidth, 200);
      const ch = Math.max(parent.clientHeight, el.clientHeight, 160);
      const touchMobile = isTouchMobile();
      const tablet = detectDevice() === "tablet";
      const iosPhone = isIosPhone();
      const boxStable =
        !force &&
        Math.abs(cw - lastFitBox.pw) < 3 &&
        Math.abs(ch - lastFitBox.ph) < 3 &&
        lastFitBox.bw >= 384 &&
        lastFitBox.bh >= 272;
      // Touch mobile: DPR 1 keeps fill-rate sane on Onn tablets and iPhone alike.
      const dpr = touchMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      let bw = Math.max(384, Math.round(cw * dpr));
      let bh = Math.max(272, Math.round(ch * dpr));
      if (touchMobile) {
        const maxW = 960;
        const maxH = 600;
        if (bw > maxW || bh > maxH) {
          const scale = Math.min(maxW / bw, maxH / bh);
          bw = Math.max(384, Math.round(bw * scale));
          bh = Math.max(272, Math.round(bh * scale));
        }
      }
      const backingOk = canvas.width === bw && canvas.height === bh && canvas.width >= 64;
      // VICE owns a live backing store. #14/#18/#39: reassigning
      // canvas.width wipes CriOS. On the Onn tablet the same assignment is
      // the postage stamp: EJS sizes the backing to the glass and
      // RetroArch sets its GL viewport to match, then the old #40 384×272
      // lock shrank the drawing buffer under that viewport (measured:
      // buffer 384×272 vs viewport 772×584). The picture then stays a
      // 384×272 stamp no matter how large the bezel is, which is why the
      // #64 measured width and the #66 384:272 frame both left it
      // unchanged. Only size a degenerate (cold / 0-box) canvas.
      const backingLive = canvas.width >= 64 && canvas.height >= 64;
      const canResizeBacking = !(iosPhone || tablet) || !backingLive;
      if (
        canResizeBacking &&
        !backingOk &&
        (force || !boxStable || canvas.width < 64 || canvas.height < 64)
      ) {
        canvas.width = bw;
        canvas.height = bh;
        lastFitBox = { pw: cw, ph: ch, bw, bh };
      } else if (!boxStable) {
        lastFitBox = { pw: cw, ph: ch, bw: canvas.width, bh: canvas.height };
      }
      canvas.style.display = "block";
      canvas.style.visibility = "visible";
      if (tablet) {
        // Android tablet: CSS 100% of the glass, same as desktop (which
        // fills). No 384px CSS + transform:scale (#40) — Onn can drop that
        // on the GL layer, and it fought RetroArch's viewport.
        applyTabletCrtStyle(canvas, el, parent);
      } else if (iosPhone) {
        applyIosCrtStyle(canvas, el, parent);
      } else {
        clearNativeFbCrtStyle(canvas);
        canvas.style.width = "100%";
        canvas.style.height = "100%";
      }
    }
    const parent = el.querySelector(".ejs_canvas_parent") as HTMLElement | null;
    if (parent) {
      parent.style.width = "100%";
      parent.style.height = "100%";
      parent.style.display = "block";
    }
  } catch {
    /* ignore */
  } finally {
    fitting = false;
  }
}

const NATIVE_FB_PROPS = [
  "inset",
  "left",
  "top",
  "right",
  "bottom",
  "width",
  "height",
  "max-width",
  "max-height",
  "transform",
  "transform-origin",
  "object-fit",
  "object-position",
] as const;

function clearNativeFbCrtStyle(canvas: HTMLCanvasElement) {
  for (const prop of NATIVE_FB_PROPS) canvas.style.removeProperty(prop);
  canvas.classList.remove("g64-tablet-fb", "g64-ios-fb");
}

/**
 * Android tablet CRT fill — CSS owns the display box, VICE owns the buffer.
 *
 * The glass is already the 384:272 CRT frame, so the canvas just fills it
 * (`.g64-screen canvas` is `inset:0; width/height:100% !important`). This
 * function only strips the legacy #40 geometry (384px CSS + `transform:
 * scale()`), which Onn Chrome could drop on the GL layer and which fought
 * RetroArch's own viewport. It must never set a pixel size or a transform:
 * a canvas box that disagrees with the drawing buffer is the stamp.
 * Phone / CriOS must not call this.
 */
export function applyTabletCrtStyle(
  canvas: HTMLCanvasElement,
  el: HTMLElement,
  parent: HTMLElement,
) {
  clearNativeFbCrtStyle(canvas);
  const player =
    (el.id === "grok64-player" ? el : (el.closest("#grok64-player") as HTMLElement | null)) ?? el;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const canvasParent = canvas.parentElement ?? parent;
  if (canvasParent && canvasParent !== player) {
    canvasParent.style.width = "100%";
    canvasParent.style.height = "100%";
  }
  player.style.width = "100%";
  player.style.height = "100%";
}

/**
 * Flatten leftover #51/#52 zoom/slot wrappers from cached markup.
 * display:contents in CSS also makes them layout-transparent.
 */
function unwrapIosZoomChrome(player: HTMLElement) {
  let node = player.parentElement;
  while (
    node &&
    (node.classList.contains("g64-ios-zoom") || node.classList.contains("g64-ios-slot"))
  ) {
    const parent = node.parentElement;
    if (!parent) break;
    parent.insertBefore(player, node);
    node.remove();
    node = player.parentElement;
  }
}

/**
 * CriOS CRT presentation — #14/#18 fit (CSS 100% of the 384:272 glass).
 *
 * Read `docs/IOS_CRT_KNOWN_FAILURES.md` first. This is the original
 * simple path: show the live canvas, fill the aspect-ratio screen.
 * Not 1–12: no zoom, no slot, no wrapper transform on GL, no
 * clientWidth lie, no 2D present, no PNG, no #42 backing lock.
 */
export function applyIosCrtStyle(
  canvas: HTMLCanvasElement,
  el: HTMLElement,
  parent: HTMLElement,
) {
  canvas.classList.remove("g64-tablet-fb");
  clearNativeFbCrtStyle(canvas);
  canvas.classList.add("g64-ios-fb");
  const player =
    (el.id === "grok64-player" ? el : (el.closest("#grok64-player") as HTMLElement | null)) ?? el;
  const box = (player.closest(".g64-screen") as HTMLElement | null) ?? parent;
  unwrapIosZoomChrome(player);
  canvas.style.removeProperty("zoom");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.setProperty("display", "block", "important");
  canvas.style.setProperty("visibility", "visible", "important");
  canvas.style.setProperty("opacity", "1", "important");
  const canvasParent = canvas.parentElement;
  if (canvasParent && canvasParent !== player) {
    canvasParent.style.width = "100%";
    canvasParent.style.height = "100%";
  }
  player.style.width = "100%";
  player.style.height = "100%";
  player.style.removeProperty("zoom");
  stripIosPresent(box);
}

/**
 * Tear down WASM for a *cold* core only. After READY, iPhone Play must
 * recycle unit 8 in-place (#18/#30). Calling this after a painted CRT
 * is known-failure #13 (black canvas → splash remount).
 */
export async function recycleCore(emu: EjsInstance | null, el: HTMLElement | null) {
  destroyEmu(emu, el);
  await new Promise((r) => setTimeout(r, isIosPhone() ? 700 : 250));
}

let lastWorkDisk: string | null = null;
let lastJiffy = false;
const lastRuntimeViceOpts: Record<string, string> = {};

export function runtimeViceOpts(): Record<string, string> {
  return { ...lastRuntimeViceOpts };
}

export function clearRuntimeViceOpts() {
  for (const k of Object.keys(lastRuntimeViceOpts)) delete lastRuntimeViceOpts[k];
}

export function lastAppliedWorkDisk(): string | null {
  return lastWorkDisk;
}

export function lastAppliedJiffy(): boolean {
  return lastJiffy;
}

export function rememberWorkDisk(work: string | null | undefined) {
  if (typeof work === "string" && work.trim()) lastWorkDisk = work.trim();
}

export function rememberJiffyLive(on: boolean) {
  lastJiffy = on;
}

export function applyRuntimeOptions(emu: EjsInstance | null, opts: Record<string, string>) {
  if (!emu?.gameManager?.setVariable) return;
  for (const [k, v] of Object.entries(opts)) {
    try {
      emu.gameManager.setVariable(k, v);
      if (k.startsWith("vice_")) lastRuntimeViceOpts[k] = v;
      if (k === "vice_work_disk") rememberWorkDisk(v);
    } catch {
      /* option may not exist on this core */
    }
  }
}

/** Flush MEMFS/IDBFS so CriOS sees the disk bytes before Autostart types LOAD. */
export async function flushEmuFs(emu: EjsInstance | null, timeoutMs = 1500): Promise<boolean> {
  const surfaces = emuFsSurfaces(emu);
  if (!surfaces.length) return false;
  let anySync = false;
  let allOk = true;
  for (const FS of surfaces) {
    const sync = FS.syncfs;
    if (!sync) continue;
    anySync = true;
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (v: boolean) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      try {
        sync(false, (err?: unknown) => {
          clearTimeout(timer);
          done(!err);
        });
      } catch {
        clearTimeout(timer);
        done(false);
      }
    });
    if (!ok) allOk = false;
  }
  if (!anySync) {
    if (isIosPhone()) await new Promise((r) => setTimeout(r, 80));
    return true;
  }
  return allOk;
}

export function hardReset(emu: EjsInstance | null) {
  applyRuntimeOptions(emu, {
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
    vice_reset: "hard",
  });
  resetEmu(emu);
}

/** BMC64 disk flush: detach+reattach session image on `unit`, then IEC reconcile. */
export async function bmc64FlushSessionDisk(
  emu: EjsInstance | null,
  unit: IecUnit = 8,
  iecMap?: IecMap,
): Promise<number> {
  if (!emu) return -1;
  if (iecMapUnitIsSd2iec(iecMap, unit)) return 0;
  const slot = sessionDiskOnUnit(unit);
  if (!slot?.name && !unitMounts.get(unit)) return 0;
  const bus = viceDriveBusProbe(emu, unit);
  const tdeLive =
    (bus.wasmTdeImageBytes ?? 0) > 174_000 &&
    bus.wasmGcrLoaded === 1 &&
    bus.serialDeviceLabel !== "virt";
  if (!tdeLive) {
    // The isolate profile pins a 1541 on the unit for the next core start; a .d81 needs its 1581.
    if (kindOf(slot?.name ?? unitMounts.get(unit) ?? "") !== "d81") {
      injectViceRc(emu, viceRcFloppyIsolateProfile(unit, iecMap));
    }
    const rc = await viceReattachSessionDisk(emu, unit);
    if (rc < 0) return rc;
    return 0;
  }
  const busRc = await ensureIecBusReconcile(emu, unit, iecMap, { lightVicerc: true });
  if (busRc < 0) return busRc;
  if (iecMap) {
    const merged: IecMap = { ...defaultIecMap(), ...iecMap, [unit]: "1541" };
    restoreUserDriveVicerc(emu, merged);
    await waitRetroFrames(12);
  }
  ensureViceLastAttachRecorded(emu, unit);
  return busRc;
}

/** After Software Insert mount: one IEC reconcile + restore Settings map (no second detach/reattach). */
export async function finishFloppyInsertIec(
  emu: EjsInstance | null,
  unit: IecUnit,
  iecMap?: IecMap,
): Promise<number> {
  if (!emu) return -1;
  if (iecMapUnitIsSd2iec(iecMap, unit)) return 0;
  if (kindOf(sessionDiskOnUnit(unit)?.name ?? "") === "d81") return finishMfmFloppyInsertIec(emu, unit, iecMap);
  const merged: IecMap | undefined = iecMap
    ? { ...defaultIecMap(), ...iecMap, [unit]: "1541" }
    : undefined;
  const multiIecDrive =
    merged &&
    ([8, 9, 10, 11] as IecUnit[]).filter((u) => {
      const slot = merged[u];
      return slot && slot !== "none" && slot !== "sd2iec";
    }).length > 1;
  if (merged && multiIecDrive) {
    injectViceRc(emu, viceRcFloppyIsolateProfile(unit, merged));
    applyRuntimeOptions(emu, {
      vice_drive_true_emulation: "enabled",
      vice_virtual_device_traps: "disabled",
      [`vice_drive${unit}_type`]: "1541",
    });
    await waitRetroFrames(18);
  } else if (merged) {
    restoreUserDriveVicerc(emu, merged);
    await waitRetroFrames(18);
  }
  let busNeed = viceDriveBusProbe(emu, unit);
  const tdeOk = (busNeed.wasmTdeImageBytes ?? 0) > 174_000 && busNeed.wasmGcrLoaded === 1;
  const serialOk = busNeed.serialDeviceLabel === "real";
  if (!serialOk || !tdeOk) {
    const busRc = await ensureIecBusReconcile(emu, unit, iecMap, {
      lightVicerc: !multiIecDrive,
      skipReload: tdeOk,
    });
    if (busRc < 0) return busRc;
  }
  const bus = viceDriveBusProbe(emu, unit);
  if ((bus.wasmTdeImageBytes ?? 0) < 174_000 || bus.wasmGcrLoaded !== 1) {
    glog("finish-floppy-insert-iec-tde-miss", { unit, bus, busNeed });
    return -1;
  }
  if (bus.serialDeviceLabel !== "real") {
    glog("finish-floppy-insert-iec-serial-miss", { unit, bus });
    return -1;
  }
  ensureViceLastAttachRecorded(emu, unit);
  return 0;
}

/** A 1581 reads the .d81 through its WD1770, so there is no GCR track buffer to check, only the drive and image. */
async function finishMfmFloppyInsertIec(emu: EjsInstance, unit: IecUnit, iecMap?: IecMap): Promise<number> {
  if (iecMap) {
    restoreUserDriveVicerc(emu, { ...defaultIecMap(), ...iecMap });
    await waitRetroFrames(18);
  }
  const busRc = await ensureIecBusReconcile(emu, unit, iecMap, { lightVicerc: true, skipReload: true });
  if (busRc < 0) return busRc;
  const mod = grok64DiskModule(emu);
  if (mod) bindGrok64DiskExports(mod, emu);
  const imageBytes = grok64DiskApi(mod)?.driveImageBytes?.(unit, 0) ?? null;
  const bus = viceDriveBusProbe(emu, unit);
  if (!viceUnitIsMfmDrive(emu, unit) || !isAcceptedD81ByteLength(imageBytes ?? 0) || bus.serialDeviceLabel !== "real") {
    glog("finish-floppy-insert-iec-mfm-miss", {
      unit,
      type: grok64DiskApi(mod)?.driveUnitType?.(unit) ?? null,
      imageBytes,
      bus,
    });
    return -1;
  }
  ensureViceLastAttachRecorded(emu, unit);
  return 0;
}

/** Hard reset then re-attach unit 8 session disk when one is mounted (BMC64 flush pattern). */
export async function hardResetAndFlushSessionDisk(emu: EjsInstance | null, iecMap?: IecMap): Promise<number> {
  if (!emu) return -1;
  const hadSession = Boolean(sessionDiskOnUnit(8)?.name);
  hardReset(emu);
  await waitRetroFrames(60);
  if (!hadSession || iecMapUnitIsSd2iec(iecMap, 8)) return 0;
  return bmc64FlushSessionDisk(emu, 8, iecMap);
}

/** After C64 power-on when a session floppy is already mounted on unit 8. */
export async function flushSessionDiskAfterPowerOn(emu: EjsInstance | null, iecMap?: IecMap): Promise<number> {
  if (!emu || !sessionDiskOnUnit(8)?.name || iecMapUnitIsSd2iec(iecMap, 8)) return 0;
  return bmc64FlushSessionDisk(emu, 8, iecMap);
}

/**
 * Cartridge freeze button (Action Replay / Retro Replay / Freeze Frame).
 * VICE libretro `vice_reset=freeze` is the cart freeze line, not a machine reset.
 */
export function cartFreeze(emu: EjsInstance | null): boolean {
  if (!emu?.gameManager?.setVariable && !emu?.gameManager?.restart) return false;
  const mod = emu.Module as Parameters<typeof bindGrok64WasmExports>[0];
  try {
    bindGrok64WasmExports(mod);
    const freezeDirect = grok64WasmApi(mod)?.cartridgeTriggerFreeze;
    if (typeof freezeDirect === "function") {
      freezeDirect();
      repaintAfterCartFreeze(emu);
      return true;
    }
    const freeze =
      mod.cwrap?.("grok64_cartridge_trigger_freeze", null, []) ??
      mod.cwrap?.("cartridge_trigger_freeze", null, []);
    if (typeof freeze === "function") {
      freeze();
      repaintAfterCartFreeze(emu);
      return true;
    }
  } catch {
    /* stock core */
  }
  applyRuntimeOptions(emu, {
    vice_reset: "freeze",
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
  });
  resetEmu(emu);
  repaintAfterCartFreeze(emu);
  return true;
}

/** Freezer UIs (SS/AR/FC) need an extra compositor nudge after vice_reset=freeze. */
export function repaintAfterCartFreeze(emu: EjsInstance | null) {
  bumpCrtPaint(emu);
  try {
    emu?.gameManager?.toggleMainLoop?.(1);
  } catch {
    /* ignore */
  }
  window.setTimeout(() => bumpCrtPaint(emu), 350);
  window.setTimeout(() => bumpCrtPaint(emu), 900);
}

/**
 * Super Snapshot / freezer menus expect standard text-mode VIC banking.
 * Wrong $d011/$d018 after freeze shows repeated header bands on the CRT.
 */
export function isSuperSnapshotCartHint(cartHint?: string | null): boolean {
  if (!cartHint) return false;
  const h = cartHint.toLowerCase();
  return h.includes("super-snapshot") || /^ss\d|snapshot\s*v/i.test(h) || /^ss/i.test(h);
}

/** SS5 sometimes lands in turbo-enhanced BASIC (TURBO V5 + READY) instead of the freezer menu. */
export function ss5TurboBasicWithoutMenu(emu: EjsInstance | null, screenText?: string): boolean {
  const t = screenText ?? readScreenText(emu);
  return (
    /TURBO\s*V5/i.test(t) &&
    /\bREADY\b/i.test(t) &&
    !/SUPER SNAPSHOT|SELECT OPTION|SNAPSHOT BY/i.test(t)
  );
}

export function stabilizeFreezerScreen(emu: EjsInstance | null, cartHint?: string | null) {
  if (!emu || !isSuperSnapshotCartHint(cartHint)) return;
  writeC64Bytes(emu, 0xd011, new Uint8Array([0x1b]));
  writeC64Bytes(emu, 0xd016, new Uint8Array([0x08]));
  writeC64Bytes(emu, 0xd018, new Uint8Array([0x14]));
  writeC64Bytes(emu, 0xd020, new Uint8Array([0x14]));
  bumpCrtPaint(emu);
}

let superSnapshotVicFixGen = 0;

/** Drop pending SS5 VIC poke timers before WASM recycle (stale timers corrupt the next core). */
export function cancelSuperSnapshotVicFix() {
  superSnapshotVicFixGen += 1;
}

/** SS5 menu: repeated LMS header bands when VIC-II text matrix is wrong. */
export function scheduleSuperSnapshotVicFix(emu: EjsInstance | null, cartHint?: string | null) {
  if (!emu || !isSuperSnapshotCartHint(cartHint)) return;
  cancelSuperSnapshotVicFix();
  const gen = superSnapshotVicFixGen;
  for (const ms of [0, 120, 400, 900, 1800, 3500]) {
    window.setTimeout(() => {
      if (gen !== superSnapshotVicFixGen) return;
      if (!emu?.gameManager) return;
      stabilizeFreezerScreen(emu, cartHint);
    }, ms);
  }
}

/** True when the live core booted from (or still has) a CRT in MEMFS. */
export function cartMountedOnCore(emu: EjsInstance | null): boolean {
  if (!emu) return false;
  const boot = bootFileOf(emu);
  if (boot && /\.(crt|bin)$/i.test(boot)) return true;
  return readMountedMedia(emu).some((m) => /\.(crt|bin)$/i.test(m.name));
}

/** Attach a .crt/.bin on the live core — never through floppy autostart / WORK DISK. */
export type CartInPlaceAttachResult = { ok: boolean; writeBoot: boolean; mounted: boolean };

export async function attachCartridgeInPlace(
  emu: EjsInstance | null,
  data: Uint8Array,
  fileName: string,
  opts?: { jiffyDos?: boolean; fastCart?: FastLoadCartKind | null },
): Promise<CartInPlaceAttachResult> {
  if (!emu || !coreHasFs(emu) || !isCartridgePayload(data, fileName)) {
    return { ok: false, writeBoot: false, mounted: false };
  }
  const base = fileName.replace(/^\//, "");
  disarmAutostart(emu, "cart");
  if (!writeBootFile(emu, data, base)) return { ok: false, writeBoot: false, mounted: false };
  emu.fileName = base;
  unitMounts.delete(8);
  setSessionCart(base, data);
  applyRuntimeOptions(emu, {
    ...CART_PLAY_UNLOCK_VICE_OPTS,
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
    vice_work_disk: "disabled",
  });
  await flushEmuFs(emu, isIosPhone() ? 2000 : 800);
  if (opts?.jiffyDos !== undefined) {
    await applyJiffyDos(emu, jiffyAllowedDuringCartBoot(opts.jiffyDos, opts.fastCart ?? null));
  }
  cartBootReset(emu);
  await flushEmuFs(emu, 600);
  bumpCrtPaint(emu);
  const mounted = cartMountedOnCore(emu);
  return { ok: mounted, writeBoot: true, mounted };
}

/** Remove a CRT that was loaded as content and return to the work disk. */
export function cartEject(emu: EjsInstance | null, workDisk?: Uint8Array | null): boolean {
  if (!emu || !coreHasFs(emu)) return false;
  const FS = fsOf(emu);
  if (!FS?.writeFile) return false;
  const boot = bootFileOf(emu);
  const isCartBoot = boot && /\.(crt|bin)$/i.test(boot);
  for (const m of readMountedMedia(emu)) {
    if (/\.(crt|bin)$/i.test(m.name)) {
      try {
        FS.unlink?.(m.name.startsWith("/") ? m.name : `/${m.name}`);
      } catch {
        /* missing */
      }
      try {
        FS.unlink?.(m.name.replace(/^\//, ""));
      } catch {
        /* missing */
      }
    }
  }
  const workName = "WORK DISK.D64";
  if (workDisk && workDisk.byteLength > 0) writeBootFile(emu, workDisk, workName);
  emu.fileName = workName;
  applyRuntimeOptions(emu, {
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
    vice_reset: "hard",
  });
  resetEmu(emu);
  removeSessionCart();
  disarmAutostart(emu, "disk");
  hardReset(emu);
  bumpCrtPaint(emu);
  return Boolean(isCartBoot || workDisk);
}

/** Retro Replay / freezer-cart RESET button (long-press on CART FZ). */
export function cartReset(emu: EjsInstance | null): boolean {
  if (!emu?.gameManager?.setVariable && !emu?.gameManager?.restart) return false;
  applyRuntimeOptions(emu, { vice_reset: "soft" });
  resetEmu(emu);
  return true;
}

/** SuperCPU front-panel RESET — resets the machine through the 65816. */
export function scpuReset(emu: EjsInstance | null): boolean {
  if (!emu) return false;
  hardReset(emu);
  return true;
}

export type CmdSwapResult = {
  ok: boolean;
  swapped: boolean;
  cmd: IecUnit;
  floppy: IecUnit;
};

/**
 * CMD HD SWAP button. Real hardware exchanges the HD's IEC number with #8.
 * Does not change Settings — live button state only. Does not reset the C64
 * (the real SWAP button does not).
 */
export function cmdHdSwap(
  emu: EjsInstance | null,
  home: IecUnit,
  swapped: boolean,
): CmdSwapResult {
  const nextSwapped = swapped;
  const units = cmdSwapUnits(home, nextSwapped);
  const map = cmdDriveMap(home, nextSwapped);
  if (emu) {
    injectViceRc(emu, viceRcForDrives(map, false));
    applyRuntimeOptions(emu, viceDriveTypeVars(map));
    applyIecUnit(emu, "cmdhd", units.cmd);
  }
  return { ok: true, swapped: nextSwapped, cmd: units.cmd, floppy: units.floppy };
}

export type SdSwapResult = {
  ok: boolean;
  unit: IecUnit;
};

/** SD2IEC SWAP 8/9 button — device number only; does not change the image. */
export function sd2iecSwapDevice(emu: EjsInstance | null, unit: IecUnit): SdSwapResult {
  if (emu) applyIecUnit(emu, "sd2iec", unit);
  return { ok: true, unit };
}

export { sd2iecSwapUnit };

export type SdFreezeResult = {
  ok: boolean;
  kind: "disk-swap" | "empty";
  index: number;
  count: number;
};

/**
 * SD2IEC freeze / disk-change button (real hardware: short press = next image).
 * Uses VICE disk-control when a playlist is mounted; otherwise swaps the
 * next floppy bytes the caller provides (card directory).
 */
export function sd2iecFreeze(
  emu: EjsInstance | null,
  disks: { name: string; data: Uint8Array }[] = [],
  dir: 1 | -1 = 1,
  unit: IecUnit = 8,
): SdFreezeResult {
  const gm = emu?.gameManager;
  const playlist = gm?.getDiskCount?.() ?? 0;
  if (playlist > 1 && gm?.setCurrentDisk && gm.getCurrentDisk) {
    const cur = gm.getCurrentDisk();
    const next = ((cur + dir) % playlist + playlist) % playlist;
    gm.setCurrentDisk(next);
    return { ok: true, kind: "disk-swap", index: next, count: playlist };
  }
  if (disks.length > 1 && emu) {
    const boot = bootFileOf(emu);
    const cur = Math.max(
      0,
      disks.findIndex((d) => d.name === boot || boot?.endsWith(d.name)),
    );
    const next = ((cur + dir) % disks.length + disks.length) % disks.length;
    const item = disks[next];
    const wrote = swapBootDisk(emu, item.data, item.name);
    if (wrote) {
      applyIecUnit(emu, "sd2iec", unit);
      resetEmu(emu);
      return { ok: true, kind: "disk-swap", index: next, count: disks.length };
    }
  }
  if (playlist === 1) {
    return { ok: true, kind: "disk-swap", index: 0, count: 1 };
  }
  return { ok: false, kind: "empty", index: 0, count: disks.length };
}

/** Every Emscripten FS surface (Module + GameManager may differ on CDN EmulatorJS). */
export function emuFsSurfaces(emu: EjsInstance | null): EmscriptenFS[] {
  const out: EmscriptenFS[] = [];
  const mod = emu?.Module?.FS;
  const gm = emu?.gameManager?.FS;
  if (mod?.writeFile) out.push(mod);
  if (gm?.writeFile && gm !== mod) out.push(gm);
  return out;
}

/** Prefer Module.FS — WASM `stat()` / grok64_disk_attach only see this tree. */
export function fsOf(emu: EjsInstance | null): EmscriptenFS | null {
  return emu?.Module?.FS ?? emu?.gameManager?.FS ?? null;
}

/** Write the same bytes to every FS surface so WASM and JS agree on MEMFS paths. */
export function writeFsFile(emu: EjsInstance | null, path: string, data: Uint8Array): boolean {
  const norm = path.startsWith("/") ? path : `/${path}`;
  const dir = norm.slice(0, norm.lastIndexOf("/"));
  let wrote = false;
  for (const FS of emuFsSurfaces(emu)) {
    try {
      if (dir.length > 1) mkdirFs(FS, dir);
      FS.writeFile!(norm, data);
      wrote = true;
    } catch {
      /* try other surface */
    }
  }
  return wrote;
}

export function mkdirFs(FS: EmscriptenFS, path: string) {
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur += `/${part}`;
    try {
      FS.mkdir?.(cur);
    } catch {
      /* exists */
    }
  }
}

/** Every path libretro-vice has used for system/vice — iPhone must write all of them. */
export const VICE_SYSTEM_ROOTS = [
  "/home/web_user/retroarch/userdata/system/vice",
  "/home/web_user/retroarch/system/vice",
  "/system/vice",
  "/vice",
] as const;

export const VICE_RC_ROOTS = [
  "/home/web_user/retroarch/userdata/system/vice",
  "/home/web_user/.config/vice",
  "/vice",
] as const;

function fsFileExists(FS: EmscriptenFS, path: string): boolean {
  const names = [path, path.replace(/^\//, ""), `/${path.replace(/^\//, "")}`];
  for (const p of names) {
    try {
      const raw = FS.readFile?.(p, { encoding: "binary" });
      const n =
        raw instanceof Uint8Array ? raw.byteLength : typeof raw === "string" ? raw.length : 0;
      if (n >= 4096) return true;
    } catch {
      /* try stat */
    }
    try {
      const st = FS.stat?.(p);
      if (st && (st.size ?? 0) >= 4096) return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/** True when both Jiffy files are readable from a VICE system root. */
export function jiffyPairLanded(emu: EjsInstance | null): boolean {
  const FS = fsOf(emu);
  if (!FS) return false;
  const c64 = catalogFiles("jiffy-c64");
  const d41 = catalogFiles("jiffy-1541");
  for (const root of VICE_SYSTEM_ROOTS) {
    const hasC64 = c64.some((n) => fsFileExists(FS, `${root}/${n}`));
    const has1541 = d41.some((n) => fsFileExists(FS, `${root}/${n}`));
    if (hasC64 && has1541) return true;
  }
  if (!FS.readdir) return false;
  for (const root of VICE_SYSTEM_ROOTS) {
    try {
      const names = FS.readdir(root);
      const hasC64 = names.some((n) => /JIFFYDOS_C64/i.test(n) && fsFileExists(FS, `${root}/${n}`));
      const has1541 = names.some((n) => /JIFFYDOS_1541/i.test(n) && fsFileExists(FS, `${root}/${n}`));
      if (hasC64 && has1541) return true;
    } catch {
      /* next */
    }
  }
  return false;
}

export function injectRoms(emu: EjsInstance | null, files: Record<string, Uint8Array>): number {
  const FS = fsOf(emu);
  if (!FS?.writeFile) return 0;
  for (const root of VICE_SYSTEM_ROOTS) mkdirFs(FS, root);
  let count = 0;
  for (const [name, data] of Object.entries(files)) {
    for (const root of VICE_SYSTEM_ROOTS) {
      try {
        FS.writeFile(`${root}/${name}`, data);
        count += 1;
      } catch {
        /* try next */
      }
    }
  }
  return count;
}

function finalizeJiffyOption(emu: EjsInstance | null, landed: boolean): boolean {
  applyRuntimeOptions(emu, { vice_jiffydos: landed ? "enabled" : "disabled" });
  lastJiffy = landed;
  if (landed) glog("jiffy-inject-ok");
  else glog("jiffy-inject-miss");
  return landed;
}

/**
 * Inject Jiffy ROMs, flush, then enable. Returns true only when both files
 * landed in VICE FS — IDB presence alone is not success (stock BASIC V2).
 */
export async function applyJiffyDos(emu: EjsInstance | null, want: boolean): Promise<boolean> {
  if (!emu) return false;
  if (!want || !(await hasJiffyPair())) {
    return finalizeJiffyOption(emu, false);
  }
  let roms: Record<string, Uint8Array> = {};
  try {
    roms = await romFileMap();
  } catch {
    return finalizeJiffyOption(emu, false);
  }
  if (!romsHaveJiffyPair(roms)) {
    return finalizeJiffyOption(emu, false);
  }
  if (!jiffyPairBootSafe(roms)) {
    return finalizeJiffyOption(emu, false);
  }
  injectRoms(emu, jiffyRomPayload(roms));
  await flushEmuFs(emu, isIosPhone() ? 2000 : 800);
  return finalizeJiffyOption(emu, jiffyPairLanded(emu));
}

/** Test helper: inject + enable without IDB. Success only if files land. */
export function applyJiffyFromRoms(
  emu: EjsInstance | null,
  want: boolean,
  roms: Record<string, Uint8Array>,
): boolean {
  if (!emu) return false;
  if (!want || !romsHaveJiffyPair(roms) || !jiffyPairBootSafe(roms)) return finalizeJiffyOption(emu, false);
  injectRoms(emu, jiffyRomPayload(roms));
  return finalizeJiffyOption(emu, jiffyPairLanded(emu));
}

export function injectSdWork(
  emu: EjsInstance | null,
  parts: { id: number; files: { name: string; data: Uint8Array }[] }[],
): number {
  const FS = fsOf(emu);
  if (!FS?.writeFile) return 0;
  const roots = isIosPhone()
    ? ["/vice_work"]
    : ["/vice_work", "/home/web_user/retroarch/userdata/saves/vice_work", "/data/vice_work"];
  for (const root of roots) mkdirFs(FS, root);
  let count = 0;
  for (const part of parts) {
    for (const root of roots) {
      const dir = `${root}/${part.id}`;
      mkdirFs(FS, dir);
      for (const file of part.files) {
        try {
          FS.writeFile(`${dir}/${file.name}`, file.data);
          count += 1;
        } catch {
          /* try next */
        }
      }
    }
  }
  return count;
}

export async function probeCore(core: string): Promise<boolean> {
  const bases = ["https://cdn.emulatorjs.org/stable/data/", "https://cdn.emulatorjs.org/latest/data/"];
  for (const base of bases) {
    try {
      const res = await fetch(`${base}cores/${core}-wasm.data`, { method: "HEAD" });
      if (res.ok) return true;
    } catch {
      /* next */
    }
  }
  return false;
}

const SAVE_JUNK = /\.(srm|sav|state|rtc|auto)$/i;

export function clearRetroSaves(emu: EjsInstance | null) {
  const FS = fsOf(emu);
  if (!FS?.readdir) return;
  const wipe = (dir: string, depth: number) => {
    if (depth > 3) return;
    let names: string[] = [];
    try {
      names = FS.readdir(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (n === "." || n === "..") continue;
      const p = dir === "/" ? `/${n}` : `${dir}/${n}`;
      try {
        const st = FS.stat(p);
        const isDir = FS.isDir ? FS.isDir(st.mode) : (st.mode & 0o170000) === 0o040000;
        if (isDir) {
          if (depth === 0 && n !== "data") continue;
          wipe(p, depth + 1);
        } else if (SAVE_JUNK.test(n) || /quick\.state$/i.test(n)) {
          FS.unlink?.(p);
        }
      } catch {
        /* skip */
      }
    }
  };
  wipe("/data/saves", 0);
  for (const n of ["game.state", "1-quick.state", "2-quick.state", "3-quick.state"]) {
    try {
      FS.unlink?.(`/${n}`);
    } catch {
      /* missing */
    }
  }
  try {
    FS.syncfs?.(false, () => undefined);
  } catch {
    /* optional */
  }
}

export function bootFileOf(emu: EjsInstance | null): string | null {
  const n = emu?.fileName;
  if (typeof n === "string" && n.trim()) return n.replace(/^\//, "");
  const media = readMountedMedia(emu);
  const disk = media.find((m) => /\.d64$/i.test(m.name)) ?? media[0];
  return disk?.name ?? null;
}

const unitMounts = new Map<IecUnit, string>();
const WORK_DISK_NAMES = new Set(["WORK DISK.D64", "work disk.d64"]);

/**
 * Mirror a .d64 into paths VICE libretro reads for `vice_work_disk` (see update_work_disk in libretro-core.c).
 * RetroArch save dir is `/data/saves` → `vice_work.d64` is what file_system_attach_disk(8,…) opens.
 */
function retroSaveDirFromModule(emu: EjsInstance | null): string | null {
  return viceRetroSaveDirectory(emu);
}

/** Yield real retro_run frames (setVariable / work_disk updates apply on the main loop). */
export async function waitRetroFrames(frames = 1): Promise<void> {
  if (frames <= 0) return;
  if (typeof window === "undefined") {
    await new Promise((r) => setTimeout(r, frames * 16));
    return;
  }
  for (let i = 0; i < frames; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

/**
 * After MEMFS sync: WASM `grok64_work_disk_refresh` when present, else libretro option toggle on retro frames.
 */
/**
 * Stop libretro `update_work_disk()` from re-attaching `vice_work.d64` over a manual
 * `grok64_disk_attach` (rc 0 but IEC FILE NOT FOUND when work-disk slot fights unit 8).
 */
export async function detachLibretroWorkDiskManager(emu: EjsInstance | null, unit: IecUnit = 8): Promise<void> {
  if (!emu) return;
  applyRuntimeOptions(emu, {
    vice_work_disk: "disabled",
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
  });
  rememberWorkDisk("disabled");
  await waitRetroFrames(12);
  await tickGrok64Iec(emu);
  glog("vice-work-disk-manager-off", { unit });
}

async function reloadViceDriveImageAfterAttach(
  emu: EjsInstance | null,
  unit: IecUnit,
  drive = 0,
): Promise<number> {
  if (!emu) return -1;
  const mod = grok64DiskModule(emu);
  if (!mod) return -99;
  bindGrok64DiskExports(mod, emu);
  const reload = grok64DiskApi(mod)?.driveReloadImage;
  if (!reload) return -99;
  const rc = reload(unit, drive);
  if (rc === 0) {
    await waitRetroFrames(45);
    await tickGrok64Iec(emu);
  }
  glog("vice-drive-reload-image", { unit, drive, rc, diag: viceDiskLastAttachDiag(emu) });
  return rc;
}

export async function bumpViceWorkDiskReload(emu: EjsInstance | null, unit: IecUnit = 8): Promise<void> {
  if (!emu) return;
  const sessionSlot = sessionDiskOnUnit(unit);
  if (sessionSlot?.bytes) syncViceWorkD64(emu, sessionSlot.bytes);
  await flushEmuFs(emu, isIosPhone() ? 2000 : 1200);
  const before = viceAttachedImage(emu, unit);
  const wasmRc = refreshViceWorkDiskAttached(emu, unit);
  if (wasmRc === 0) {
    glog("vice-work-disk-reload", { unit, mode: "wasm-export", before, after: viceAttachedImage(emu, unit) });
    return;
  }
  const workSlot = `${unit}_d64`;
  applyRuntimeOptions(emu, { vice_work_disk: "9_d64" });
  await waitRetroFrames(6);
  applyRuntimeOptions(emu, { vice_work_disk: "disabled" });
  await waitRetroFrames(6);
  applyRuntimeOptions(emu, { vice_work_disk: workSlot });
  rememberWorkDisk(workSlot);
  for (let i = 0; i < 90; i++) {
    await waitRetroFrames(1);
    await tickGrok64Iec(emu);
    const now = viceAttachedImage(emu, unit);
    if (now && !/blank\.d64/i.test(now) && now !== before) break;
  }
  glog("vice-work-disk-reload", {
    unit,
    slot: workSlot,
    mode: wasmRc === -99 ? "core-option" : "core-option-after-wasm-fail",
    wasmRc,
    before,
    after: viceAttachedImage(emu, unit),
  });
}

export function syncViceWorkD64(emu: EjsInstance | null, data: Uint8Array, unit: IecUnit = 8) {
  if (!isAcceptedD64ByteLength(data.byteLength)) return;
  const saveDir = retroSaveDirFromModule(emu) ?? viceRetroSaveDirectory(emu);
  const targets = [
    grok64IecAttachD64Path(unit),
    "/data/saves/vice_work.d64",
    "/home/web_user/retroarch/userdata/saves/vice_work.d64",
    "/vice_work/vice_work.d64",
    "/home/web_user/retroarch/userdata/saves/vice_work/vice_work.d64",
    ...(saveDir ? [`${saveDir}/vice_work.d64`] : []),
  ];
  const seen = new Set<string>();
  for (const path of targets) {
    const norm = path.startsWith("/") ? path : `/${path}`;
    if (seen.has(norm)) continue;
    seen.add(norm);
    writeFsFile(emu, norm, data);
  }
}

/** Force libretro to detach/reattach the work disk image after MEMFS/IDBFS bytes change. */
/**
 * Jiffy C64 KERNAL must be paired with Jiffy 1541 ROM *before* libretro
 * re-attaches `vice_work_disk`. Refreshing first with stock drive DOS then
 * flipping vice_jiffydos leaves unit 8 unreadable (FILE NOT FOUND on LOAD"$").
 */
export type FloppyImageRef = { fileName: string; data: Uint8Array };

function floppyKindFromRef(
  image: FloppyImageRef | null | undefined,
  unit: IecUnit,
): ReturnType<typeof kindOf> | null {
  if (image?.fileName) return kindOf(image.fileName);
  const slot = sessionDiskOnUnit(unit);
  return slot ? kindOf(slot.name) : null;
}

/** GCR (.g64/.g71): content file is the drive image — never mirror into vice_work.d64. */
export async function refreshViceGcrDisk(
  emu: EjsInstance | null,
  unit: IecUnit,
  data: Uint8Array,
  fileName: string,
): Promise<void> {
  if (!emu) return;
  const base = fileName.replace(/^\//, "");
  const disarm = {
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
  };
  writeBootFile(emu, data, base);
  emu.fileName = base;
  unitMounts.set(unit, base);
  setSessionDisk(base, data, unit);
  applyRuntimeOptions(emu, {
    ...disarm,
    vice_work_disk: "disabled",
    [`vice_drive${unit}_type`]: "1541",
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
    vice_reset: "hard",
  });
  resetEmu(emu);
  await flushEmuFs(emu, 1500);
  bumpCrtPaint(emu);
  await new Promise((r) => setTimeout(r, 250));
  await viceReattachSessionDisk(emu, unit);
  glog("gcr-disk-refresh", { unit, file: base, bytes: data.byteLength });
}

/** Live CRT: swap GCR image bytes + reattach without hard-reset (avoids stack/recursion on hot Play). */
export async function refreshViceGcrDiskHot(
  emu: EjsInstance | null,
  unit: IecUnit,
  data: Uint8Array,
  fileName: string,
): Promise<void> {
  if (!emu) return;
  const base = fileName.replace(/^\//, "");
  writeBootFile(emu, data, base);
  emu.fileName = base;
  unitMounts.set(unit, base);
  setSessionDisk(base, data, unit);
  applyIecUnitFloppy(emu, "1541", unit, kindOf(base));
  applyRuntimeOptions(emu, {
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
    vice_work_disk: "disabled",
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
  });
  await flushEmuFs(emu, isIosPhone() ? 2000 : 800);
  bumpCrtPaint(emu);
  await viceReattachSessionDisk(emu, unit);
  await ensureIecBusReconcile(emu, unit);
  glog("gcr-disk-hot-swap", { unit, file: base, bytes: data.byteLength });
}

export function applyIecUnitFloppy(
  emu: EjsInstance | null,
  iec: IecDrive,
  unit: IecUnit,
  diskKind: ReturnType<typeof kindOf> | null,
) {
  if (diskKind === "d81") {
    // libretro's `N_d81` work disk would attach a blank vice_work.d81 over the session disk.
    applyRuntimeOptions(emu, {
      vice_work_disk: "disabled",
      vice_drive_true_emulation: "enabled",
      vice_virtual_device_traps: "disabled",
    });
    rememberWorkDisk("disabled");
    return;
  }
  if (diskKind && isGcrDiskKind(diskKind)) {
    applyRuntimeOptions(emu, {
      [`vice_drive${unit}_type`]: iec === "1581" ? "1581" : "1541",
      vice_work_disk: "disabled",
      vice_drive_true_emulation: "enabled",
      vice_virtual_device_traps: "disabled",
    });
    rememberWorkDisk("disabled");
    return;
  }
  applyIecUnit(emu, iec, unit);
}

export async function applyJiffyThenRefreshWorkDisk(
  emu: EjsInstance | null,
  unit: IecUnit,
  jiffyWant: boolean,
  image?: FloppyImageRef | null,
  opts?: { hotSwap?: boolean },
): Promise<boolean> {
  if (!emu) return false;
  const landed = await runMountStage("jiffy-apply", () => applyJiffyDos(emu, jiffyWant), 30_000);
  if (jiffyWant && !landed) {
    glog("jiffy-floppy-pair-miss");
  }
  const diskKind = floppyKindFromRef(image, unit);
  if (diskKind && isGcrDiskKind(diskKind)) {
    const session = sessionDiskOnUnit(unit);
    const data = image?.data ?? session?.bytes;
    const name = image?.fileName ?? session?.name;
    if (data && name) {
      const refresh = opts?.hotSwap
        ? () => refreshViceGcrDiskHot(emu, unit, data, name)
        : () => refreshViceGcrDisk(emu, unit, data, name);
      await runMountStage(opts?.hotSwap ? "gcr-hot-swap" : "gcr-refresh", refresh, 60_000);
    }
  } else if (opts?.hotSwap) {
    await runMountStage(
      "hot-swap-work-disk",
      async () => {
        const session = sessionDiskOnUnit(unit);
        const data = image?.data ?? session?.bytes;
        if (data) syncViceWorkD64(emu, data);
        resyncSessionDiskToVice(emu, unit);
        await flushEmuFs(emu, isIosPhone() ? 2000 : 1200);
        if (jiffyWant && landed) {
          await waitRetroFrames(60);
          await tickGrok64Iec(emu);
        }
      },
      45_000,
    );
  } else {
    await runMountStage("work-disk-refresh", () => refreshViceWorkDisk(emu, unit), 90_000);
  }
  applyIecUnitFloppy(emu, "1541", unit, diskKind);
  return jiffyWant ? landed : true;
}

export async function refreshViceWorkDisk(emu: EjsInstance | null, unit: IecUnit = 8): Promise<void> {
  if (!emu) return;
  const slot = `${unit}_d64`;
  const disarm = {
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
  };
  applyRuntimeOptions(emu, { ...disarm, vice_work_disk: "disabled", vice_reset: "hard" });
  resetEmu(emu);
  await flushEmuFs(emu, 800);
  applyRuntimeOptions(emu, { ...disarm, vice_work_disk: slot, vice_reset: "hard" });
  resetEmu(emu);
  await flushEmuFs(emu, 1500);
  bumpCrtPaint(emu);
  await new Promise((r) => setTimeout(r, 250));
  resyncSessionDiskToVice(emu, unit);
  await viceReattachSessionDisk(emu, unit);
}

/** After VICE reset, rewrite session floppy bytes to MEMFS + vice_work.d64 mirror. */
export function resyncSessionDiskToVice(emu: EjsInstance | null, unit: IecUnit = 8): boolean {
  const slot = sessionDiskOnUnit(unit);
  if (!slot || !emu) return false;
  const target = slot.name.replace(/^\//, "");
  if (!writeBootFile(emu, slot.bytes, target)) return false;
  emu.fileName = target;
  const k = kindOf(target);
  if (isGcrDiskKind(k)) {
    applyIecUnitFloppy(emu, "1541", unit, k);
    return true;
  }
  if (k === "d81" && isAcceptedD81ByteLength(slot.bytes.byteLength)) {
    writeFsFile(emu, grok64IecAttachD81Path(unit), slot.bytes);
    return true;
  }
  if (/\.d64$/i.test(target) && isAcceptedD64ByteLength(slot.bytes.byteLength)) {
    syncViceWorkD64(emu, slot.bytes, unit);
    writeFsFile(emu, grok64IecAttachD64Path(unit), slot.bytes);
    writeFsFile(emu, `/data/saves/grok64_iec${unit}.d64`, slot.bytes);
  }
  return true;
}

/** Deferred attach flushed on the live IEC poll / emu thread (not a tight sync poll loop). */
export async function viceReattachDiskOnEmuThread(
  emu: EjsInstance | null,
  unit: IecUnit,
  path: string,
  drive = 0,
): Promise<number> {
  if (!emu || !path?.trim()) return -1;
  return runSerializedDiskAttach(async () => {
    if (!grok64DiskExportsReady(emu)) return -99;
    const mod = grok64DiskModule(emu) ?? (emu.Module as Parameters<typeof bindGrok64WasmExports>[0]);
    bindGrok64DiskExports(mod, emu);
    const api = grok64DiskApi(mod);
    const typeRc = prepareDriveForAttach(emu, unit, path);
    if (typeRc < 0) {
      recordViceLastAttach(unit, { path, rc: typeRc, before: null, after: null, at: Date.now() });
      glog("vice-disk-reattach", { unit, path, rc: typeRc, diag: viceDiskLastAttachDiag(emu), stage: "set-type" });
      return typeRc;
    }
    api?.diskDetach?.(unit, drive);
    let rc = api?.diskAttach?.(unit, drive, path) ?? -1;
    const attachRc = api?.diskLastAttachRc?.();
    if (rc < 0 && typeof attachRc === "number" && attachRc >= 0) rc = attachRc;
    const after = rc === 0 ? viceAttachedImage(emu, unit, drive) : null;
    recordViceLastAttach(unit, { path, rc, before: null, after, at: Date.now() });
    glog("vice-disk-reattach", { unit, path, rc, after, syncAttach: true });
    return rc;
  });
}

/** Overwrite stale IDB vicerc routing (FileSystemDevice / IECDevice / VirtualDevice). */
export function viceRcTrueFloppyUnit(unit: IecUnit, iecMap?: IecMap): string {
  return viceRcFloppyIsolateProfile(unit, iecMap);
}

/** Restore vicerc from saved Settings IEC map (after a floppy-isolate session). */
export function restoreUserDriveVicerc(emu: EjsInstance | null, iecMap: IecMap): void {
  if (!emu) return;
  const viceMap = viceMapFromIecMap(iecMap);
  injectViceRc(emu, viceRcForDrives(viceMap, false));
  applyRuntimeOptions(emu, viceDriveTypeVars(viceMap));
}

/** Route KERNAL IEC to true 1541 TDE (drive CPU + GCR), not fsdevice/vdrive traps. */
export async function ensureIecBusReconcile(
  emu: EjsInstance | null,
  unit: IecUnit = 8,
  iecMap?: IecMap,
  opts?: { skipReload?: boolean; lightVicerc?: boolean },
): Promise<number> {
  if (!emu) return -1;
  if (iecMapUnitIsSd2iec(iecMap, unit)) return 0;
  if (!opts?.lightVicerc) {
    injectViceRc(emu, viceRcTrueFloppyUnit(unit, iecMap));
  }
  const mod = grok64DiskModule(emu);
  if (mod) bindGrok64DiskExports(mod, emu);
  const api = grok64DiskApi(mod);
  api?.viceApplySafeFloppyProfile?.(unit);
  const reconcile = api?.iecBusReconcile;
  let rc = reconcile ? reconcile(unit) : (api?.driveSyncTdeImage?.(unit, 0) ?? -99);
  if (rc === 0 && api?.driveReloadImage && !opts?.skipReload) {
    const reloadRc = api.driveReloadImage(unit, 0);
    glog("iec-bus-reconcile-reload", { unit, reloadRc, diag: viceDiskLastAttachDiag(emu) });
  }
  if (!opts?.lightVicerc) {
    applyRuntimeOptions(emu, {
      vice_drive_true_emulation: "enabled",
      vice_virtual_device_traps: "disabled",
      [`vice_drive${unit}_type`]: "1541",
    });
  }
  await waitRetroFrames(opts?.lightVicerc ? 18 : 45);
  await tickGrok64Iec(emu);
  const bus = viceDriveBusProbe(emu, unit);
  glog("iec-bus-reconcile", {
    unit,
    rc,
    diag: viceDiskLastAttachDiag(emu),
    serialDeviceLabel: bus.serialDeviceLabel,
    serialOk: viceBusSerialRoutingOk(bus),
  });
  return rc;
}

/** Hot-swap D64: flush MEMFS, re-attach on emu thread (Jiffy 1541 ROM must see fresh image). */
export async function ensureViceSessionDiskAttached(
  emu: EjsInstance | null,
  unit: IecUnit,
  diskKind: ReturnType<typeof kindOf> | null,
): Promise<number> {
  if (!emu) return -1;
  detachGrok64Sd2iec(emu, unit);
  applyIecUnitFloppy(emu, "1541", unit, diskKind);
  if (diskKind && !isGcrDiskKind(diskKind)) {
    await detachLibretroWorkDiskManager(emu, unit);
    const slot = sessionDiskOnUnit(unit);
    if (slot?.bytes) syncViceWorkD64(emu, slot.bytes);
    await flushEmuFs(emu, isIosPhone() ? 2000 : 1200);
    return viceReattachSessionDisk(emu, unit);
  }
  return viceReattachSessionDisk(emu, unit);
}

/** file_system_detach_disk + file_system_attach_disk for the live session image on `unit`. */
export async function viceReattachSessionDisk(emu: EjsInstance | null, unit: IecUnit = 8): Promise<number> {
  if (!emu) return -1;
  const slot = sessionDiskOnUnit(unit);
  const name = slot?.name ?? bootFileOf(emu) ?? unitMounts.get(unit);
  if (!name) return -1;
  if (slot?.bytes) {
    resyncSessionDiskToVice(emu, unit);
    syncViceWorkD64(emu, slot.bytes);
  }
  await flushEmuFs(emu, isIosPhone() ? 2000 : 800);
  const path = resolveViceDiskAttachPath(emu, unit, name);
  let candidates = viceDiskAttachCandidates(emu, unit, name);
  if (!candidates.length && !attachesOwnImageOnly(kindOf(name))) {
    for (const fallback of [
      "/data/saves/vice_work.d64",
      viceRetroSaveDirectory(emu) ? `${viceRetroSaveDirectory(emu)}/vice_work.d64` : null,
      path,
    ]) {
      if (fallback && probeViceAttachPaths(emu, unit, name).some((p) => p.path === fallback && (p.wasmFsStat ?? 0) > 0)) {
        candidates = [fallback];
        break;
      }
    }
  }
  if (!candidates.length && path) candidates.push(path);
  if (!candidates.length) return -1;
  let lastRc = -1;
  for (const candidate of candidates) {
    lastRc = await viceReattachDiskOnEmuThread(emu, unit, candidate);
    if (lastRc === 0) return 0;
    await new Promise((r) => setTimeout(r, 80));
  }
  if (lastRc === -99) {
    glog("vice-disk-reattach-skip", { reason: "exports-missing", unit, name });
  }
  return lastRc;
}

/** QA: bytes on MEMFS path VICE opens for `8_d64` work disk attach. */
export function viceWorkD64ByteLength(emu: EjsInstance | null): number {
  const FS = fsOf(emu);
  if (!FS?.readFile) return 0;
  for (const path of ["/data/saves/vice_work.d64", "/home/web_user/retroarch/userdata/saves/vice_work.d64"]) {
    try {
      const raw = FS.readFile(path);
      if (raw instanceof Uint8Array) return raw.byteLength;
      if (typeof raw === "string") return raw.length;
    } catch {
      /* try next */
    }
  }
  return 0;
}

export function clearUnitMounts() {
  unitMounts.clear();
  clearSessionMedia();
}

export function applyIecUnit(emu: EjsInstance | null, iec: IecDrive, unit: IecUnit) {
  const opts = liveDriveOptions({ iec, unit });
  rememberWorkDisk(opts.vice_work_disk);
  applyRuntimeOptions(emu, opts);
}

export async function waitForCoreFs(emu: EjsInstance | null, timeoutMs = 12_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (coreHasFs(emu)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return coreHasFs(emu);
}

export function injectViceRc(emu: EjsInstance | null, body: string): number {
  const FS = fsOf(emu);
  if (!FS?.writeFile) return 0;
  for (const root of VICE_RC_ROOTS) mkdirFs(FS, root);
  let n = 0;
  for (const root of VICE_RC_ROOTS) {
    try {
      FS.writeFile(`${root}/vicerc`, body);
      n += 1;
    } catch {
      /* try next */
    }
  }
  return n;
}

/**
 * After the core FS exists: inject Jiffy + CMD ROMs, write vicerc for real
 * CMD HD, mount SD card files, apply live IEC. Does not Autostart.
 * Jiffy is enabled only when both ROMs landed in the new core.
 */
export async function prepareCore(
  emu: EjsInstance | null,
  opts: {
    live: DriveAttach;
    user: DriveAttach;
    jiffyWant: boolean;
    sdParts?: SdPartition[];
    /** Hot-swap must not flip vice_jiffydos — that reset drops unit 8 on CriOS. */
    skipJiffy?: boolean;
    driveMap?: IecMap;
  },
): Promise<{ jiffy: boolean; roms: number; cmd: boolean }> {
  if (!emu) return { jiffy: false, roms: 0, cmd: false };
  let roms = 0;
  let cmd = false;
  try {
    const files = await romFileMap();
    if (Object.keys(files).length) roms = injectRoms(emu, jiffyRomPayload(files));
    const wantsCmd =
      opts.user.iec === "cmdhd" || Object.values(opts.driveMap ?? {}).includes("cmdhd");
    cmd = wantsCmd && (await hasCmdRom());
  } catch {
    /* optional */
  }
  const userMap = opts.driveMap ?? iecMapFromLegacy(opts.user.iec, opts.user.unit);
  const liveMap = withLiveFloppy(userMap, opts.live);
  const viceMap = viceMapFromIecMap(liveMap);
  if (!cmd) {
    for (const unit of [8, 9, 10, 11] as IecUnit[]) {
      if (viceMap[unit] === "cmdhd") delete viceMap[unit];
    }
  }
  injectViceRc(emu, viceRcForDrives(viceMap, false));
  if (opts.live.iec === "sd2iec") {
    wireGrok64ViceHost(emu);
    attachGrok64Sd2iec(emu, opts.live.unit);
  }
  applyRuntimeOptions(emu, viceDriveTypeVars(viceMap));
  applyIecUnit(emu, opts.live.iec, opts.live.unit);
  const jiffy = opts.skipJiffy
    ? lastJiffy
    : await applyJiffyDos(emu, opts.jiffyWant);
  await flushEmuFs(emu, isIosPhone() ? 2000 : 800);
  applyIecUnit(emu, opts.live.iec, opts.live.unit);
  return { jiffy, roms, cmd };
}

/** CRT boot: autostart-style reset without typing LOAD"*",8,1. */
export function cartBootReset(emu: EjsInstance | null) {
  applyRuntimeOptions(emu, {
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
    vice_reset: "autostart",
    vice_work_disk: "disabled",
    vice_drive_true_emulation: "enabled",
    vice_virtual_device_traps: "disabled",
  });
  resetEmu(emu);
}

export function autostartAfterReady(
  emu: EjsInstance | null,
  trueDrive = true,
  opts?: { autoloadWarp?: boolean; /** When false, hard-reset only — never type LOAD"*",8,1 (cart boot). */ arm?: boolean },
) {
  const arm = opts?.arm !== false;
  const base = arm
    ? {
        vice_autostart: "enabled",
        vice_autostart_warp: "enabled",
        vice_autoloadwarp: opts?.autoloadWarp === false ? "disabled" : "enabled",
        vice_reset: "autostart",
      }
    : {
        vice_autostart: "disabled",
        vice_autostart_warp: "disabled",
        vice_autoloadwarp: "disabled",
        vice_reset: "hard",
      };
  applyRuntimeOptions(emu, {
    ...base,
    ...(trueDrive
      ? {
          vice_drive_true_emulation: "enabled",
          vice_virtual_device_traps: "disabled",
        }
      : {}),
  });
  resetEmu(emu);
}

/**
 * Stop Autostart / autoload-warp after LOAD has been typed. Does not restart
 * the core, recycle WASM, or touch unit 8.
 */
export function disarmAutostart(emu: EjsInstance | null, mode?: "cart" | "disk") {
  applyRuntimeOptions(emu, mode === "cart" ? { ...CART_PLAY_UNLOCK_VICE_OPTS } : { ...PLAY_UNLOCK_VICE_OPTS });
  glog("autostart-disarmed", { mode: mode ?? "disk" });
}

function removeMediaFile(FS: EmscriptenFS, name: string) {
  const paths = [name, name.startsWith("/") ? name : `/${name}`];
  for (const p of paths) {
    try {
      FS.unlink?.(p);
    } catch {
      /* missing */
    }
  }
}

/** Enforce one disk image per IEC unit; remounting replaces the prior disk on that unit. */
export function mountDiskOnUnit(
  emu: EjsInstance | null,
  unit: IecUnit,
  data: Uint8Array,
  filename: string,
  iec: IecDrive = "1541",
): boolean {
  const FS = fsOf(emu);
  if (!FS?.writeFile) return false;
  const base = filename.replace(/^\//, "");
  const prev = unitMounts.get(unit);
  if (prev && prev !== base) removeMediaFile(FS, prev);
  for (const [u, name] of unitMounts) {
    if (u !== unit && name === base) unitMounts.delete(u);
  }
  const diskKind = kindOf(base);
  applyIecUnitFloppy(emu, iec, unit, diskKind);
  const wrote = writeBootFile(emu, data, base);
  if (wrote) {
    unitMounts.set(unit, base);
    setSessionDisk(base, data, unit);
    if (/\.d64$/i.test(base) && isAcceptedD64ByteLength(data.byteLength)) {
      syncViceWorkD64(emu, data);
    }
    pruneExtraDisks(emu);
    applyIecUnitFloppy(emu, iec, unit, diskKind);
  }
  return wrote;
}

function pruneExtraDisks(emu: EjsInstance | null) {
  const FS = fsOf(emu);
  if (!FS?.readdir || !FS.unlink) return;
  const keep = new Set([...unitMounts.values(), ...WORK_DISK_NAMES]);
  const boot = bootFileOf(emu);
  if (boot) keep.add(boot);
  for (const m of readMountedMedia(emu)) {
    if (!keep.has(m.name) && /\.(d64|d71|d81|g64|g71)$/i.test(m.name)) {
      removeMediaFile(FS, m.name);
    }
  }
}

/** Hot-swap a game disk without changing IEC unit wiring — keeps emu.fileName valid for autostart. */
export function swapBootDisk(emu: EjsInstance | null, data: Uint8Array, fallbackName?: string | null): boolean {
  const target = bootFileOf(emu) ?? fallbackName ?? null;
  const wrote = writeBootFile(emu, data, target);
  if (wrote && target && /\.d64$/i.test(target) && isAcceptedD64ByteLength(data.byteLength)) {
    syncViceWorkD64(emu, data);
    setSessionDisk(target.replace(/^\//, ""), data, 8);
  }
  return wrote;
}

/**
 * Attach a floppy for VICE autostart: force 1541/1581 on the given unit
 * (unit 8 for LOAD"*",8,1), then overwrite the current boot file.
 * iPhone Play after READY uses this in-place (#18/#30) so the live GL
 * canvas survives. Desktop still WASM-recycles a live SD2IEC 8_fs core
 * (see floppyPlayCanHotSwap). destroyEmu after READY is #13.
 *
 * #60 wrote a *new* filename instead of this overwrite — unit 8 stayed
 * the blank work disk and Autostart typed FILE NOT FOUND (not DNP).
 */
/** C64 CLR via Shift+HOME (libretro path). */
export function clearC64ScreenPetscii(emu: EjsInstance | null): boolean {
  if (!emu) return false;
  void import("./grok64-keyboard").then(({ clearC64ScreenRetro }) => clearC64ScreenRetro(emu));
  return true;
}

/** Wait until KERNAL prints READY (after hard reset / GEOS mount). */
export async function waitForC64Ready(emu: EjsInstance | null, timeoutMs = 45_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const text = readScreenText(emu);
    if (screenTextHasReady(text)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return screenTextHasReady(readScreenText(emu));
}

/** GEOS / Wheels need the stock KERNAL — JiffyDOS ROM breaks LOAD/RUN into the deskTop. */
export async function ensureStockKernal(emu: EjsInstance | null): Promise<boolean> {
  if (!emu) return false;
  await applyJiffyDos(emu, false);
  await flushEmuFs(emu, isIosPhone() ? 2000 : 800);
  return true;
}

/** Mount a GEOS (or other) system disk on unit 8 as true 1541-II, no autostart PRG sniff. */
export async function bootGeosFloppy(
  emu: EjsInstance | null,
  data: Uint8Array,
  fileName: string,
  unit: IecUnit = 8,
  iecMap?: IecMap,
): Promise<boolean> {
  if (!emu || !coreHasFs(emu)) return false;
  await ensureStockKernal(emu);
  wireGrok64ViceHost(emu);
  detachGrok64Sd2iec(emu, unit);
  await tickGrok64Iec(emu);
  const viceMap = iecMap
    ? viceMapFromIecMap({ ...iecMap, [unit]: "1541" })
    : { [unit]: "1541" as IecDrive };
  applyRuntimeOptions(emu, {
    ...viceDriveTypeVars(viceMap),
    ...viceGeosFloppyOptions(unit),
    [`vice_drive${unit}_type`]: "1541",
    vice_work_disk: `${unit}_d64`,
  });
  injectViceRc(emu, viceRcSafeFloppyProfile(unit, iecMap));
  applyIecUnit(emu, "1541", unit);
  disarmAutostart(emu, "disk");

  applyRuntimeOptions(emu, {
    ...viceGeosFloppyOptions(unit),
    [`vice_drive${unit}_type`]: "1541",
    vice_work_disk: `${unit}_d64`,
  });
  applyIecUnit(emu, "1541", unit);

  const target = "WORK DISK.D64";
  if (!writeBootFile(emu, data, target)) return false;
  emu.fileName = target.replace(/^\//, "");
  unitMounts.set(unit, target);
  setSessionDisk(fileName.replace(/^\//, ""), data, unit);
  syncViceWorkD64(emu, data);
  if (viceWorkD64ByteLength(emu) < 174848) {
    glog("geos-work-mirror-miss", { bytes: viceWorkD64ByteLength(emu) });
  }

  const flushed = await flushEmuFs(emu, 3000);
  if (!flushed) return false;
  await refreshViceWorkDisk(emu, unit);
  applyRuntimeOptions(emu, {
    ...viceGeosFloppyOptions(unit),
    [`vice_drive${unit}_type`]: "1541",
    vice_work_disk: `${unit}_d64`,
  });
  resetEmu(emu);
  await flushEmuFs(emu, 1200);
  applyRuntimeOptions(emu, {
    ...viceGeosFloppyOptions(unit),
    [`vice_drive${unit}_type`]: "1541",
    vice_work_disk: `${unit}_d64`,
  });
  return await waitForC64Ready(emu, 45_000);
}

/** VICE autostart LOAD"*",8,1 — fallback when typed LOAD"GEOS" returns to BASIC. */
export async function tryGeosDiskAutostart(emu: EjsInstance | null, unit: IecUnit = 8): Promise<boolean> {
  if (!emu) return false;
  disarmAutostart(emu, "disk");
  applyRuntimeOptions(emu, {
    ...viceGeosFloppyOptions(unit),
    [`vice_drive${unit}_type`]: "1541",
    vice_autostart: "enabled",
    vice_autostart_warp: "enabled",
    vice_autoloadwarp: "enabled",
    vice_reset: "autostart",
  });
  resetEmu(emu);
  await flushEmuFs(emu, 2000);
  bumpCrtPaint(emu);
  return await waitForC64Ready(emu, 60_000);
}

export function attachAutostartDisk(
  emu: EjsInstance | null,
  data: Uint8Array,
  _fallbackName?: string | null,
  iec: IecDrive = "1541",
  unit: IecUnit = 8,
  opts?: { deferViceReattach?: boolean },
): boolean {
  if (isCartridgePayload(data, _fallbackName ?? bootFileOf(emu))) return false;
  // Only overwrite the mounted boot image. A new filename leaves unit 8
  // as the blank work disk — LOAD"*",8,1 then FILE NOT FOUND (#60/#61).
  const mounted = bootFileOf(emu);
  if (!mounted) return false;
  const mountedClean = mounted.replace(/^\//, "");
  const fallback = (_fallbackName || "").replace(/^\//, "");
  const kind = kindOf(fallback || mountedClean);
  const target =
    (kind === "g64" || kind === "g71") && fallback
      ? fallback
      : mountedClean;
  applyIecUnitFloppy(emu, iec, unit, kindOf(target));
  const wrote = writeBootFile(emu, data, target);
  if (wrote) {
    unitMounts.set(unit, target);
    if (emu) emu.fileName = target;
    const label = fallback || target;
    setSessionDisk(label, data, unit);
    if (isAcceptedD64ByteLength(data.byteLength) && /\.d64$/i.test(target)) {
      syncViceWorkD64(emu, data, unit);
    }
    applyIecUnitFloppy(emu, iec, unit, kindOf(target));
    const attachPath = resolveViceDiskAttachPath(emu, unit, label || target);
    if (attachPath && !opts?.deferViceReattach) {
      void runMountStage("autostart-vice-reattach", async () => viceReattachDiskAsync(emu, unit, attachPath)).catch(
        (err) => reportMountFailure("autostart-vice-reattach", err, { unit, attachPath }),
      );
    }
  }
  return wrote;
}

export function coreHasFs(emu: EjsInstance | null): boolean {
  const FS = fsOf(emu);
  return Boolean(FS?.writeFile && FS.readFile);
}

export function mountSd2iecD64(emu: EjsInstance | null, unit: IecUnit, data: Uint8Array): boolean {
  const format = data.byteLength >= 819200 ? "d81" : "d64";
  const driveType = format === "d81" ? "1581" : "1541";
  return mountSd2iecVolume(emu, unit, { data, format, driveType, blocksUsed: 0 });
}

export function mountSd2iecVolume(emu: EjsInstance | null, unit: IecUnit, vol: Sd2iecVolume): boolean {
  const min = vol.format === "d81" ? 819200 : 174848;
  if (!emu || vol.data.byteLength < min) return false;
  const ext = vol.format === "d81" ? "D81" : "D64";
  const name = `SD2IEC${unit}.${ext}`;
  const wrote = writeBootFile(emu, vol.data, name);
  if (wrote) {
    emu.fileName = name;
    unitMounts.set(unit, name);
    glog("sd2iec-volume-mount", { unit, name, format: vol.format, bytes: vol.data.byteLength });
  }
  return wrote;
}

export function remountSd2iecFromParts(
  emu: EjsInstance | null,
  unit: IecUnit,
  _parts?: SdPartition[],
): boolean {
  if (!emu) return false;
  wireGrok64ViceHost(emu);
  attachGrok64Sd2iec(emu, unit);
  applyIecUnit(emu, "sd2iec", unit);
  return true;
}

/** Load a .reu dump into VICE REU RAM (REUfilename + reu_activate). */
export function attachReuImage(
  emu: EjsInstance | null,
  data: Uint8Array,
  sizeKb = 0,
  path = GROK64_REU_IMAGE_PATH,
): number {
  if (!emu || !data.byteLength) return -1;
  if (!writeFsFile(emu, path, data)) return -2;
  const api = grok64DiskApi(emu.Module as Parameters<typeof grok64DiskApi>[0]);
  const fn = api?.reuAttach;
  if (!fn) return -3;
  return fn(path, snapReuKb(sizeKb || Math.round(data.byteLength / 1024)));
}

export function grok64ReuSizeKb(emu: EjsInstance | null): number | null {
  const api = grok64DiskApi(emu?.Module as Parameters<typeof grok64DiskApi>[0]);
  return api?.reuSizeKb?.() ?? null;
}

/** Write sidecar files (e.g. `.reu` next to a `.prg`) before VICE autostart. */
export function writeCompanionMedia(
  emu: EjsInstance | null,
  files: { name: string; data: Uint8Array }[],
): number {
  let n = 0;
  for (const f of files) {
    if (writeBootFile(emu, f.data, f.name.replace(/^\//, ""))) n += 1;
  }
  return n;
}

export function writeBootFile(emu: EjsInstance | null, data: Uint8Array, preferred?: string | null): boolean {
  if (!emuFsSurfaces(emu).length) return false;
  const name = preferred || bootFileOf(emu);
  const candidates: string[] = [];
  if (name) {
    candidates.push(name.startsWith("/") ? name : `/${name}`, name.replace(/^\//, ""));
  }
  candidates.push("/WORK DISK.D64", "WORK DISK.D64");
  const tried = new Set<string>();
  for (const p of candidates) {
    if (tried.has(p)) continue;
    tried.add(p);
    if (writeFsFile(emu, p.startsWith("/") ? p : `/${p}`, data)) return true;
  }
  return false;
}

const MEDIA_EXT = /\.(d64|d71|d81|g64|g71|crt|tap|t64)$/i;
const SKIP_DIR = new Set(["dev", "proc", "core", "tmp"]);

/** UI / QA list — hide stale blank.d64; label work disk after Insert. */
function mergeSessionMedia(
  fsMedia: { name: string; data: Uint8Array }[],
  displayName?: string | null,
): { name: string; data: Uint8Array }[] {
  const session = sessionMediaList();
  if (!session.length) {
    const out: { name: string; data: Uint8Array }[] = [];
    for (const m of fsMedia) {
      if (/^blank\.d64$/i.test(m.name)) continue;
      const isWork = WORK_DISK_NAMES.has(m.name.toUpperCase()) || /^work\s*disk/i.test(m.name);
      if (isWork && displayName) {
        out.push({ name: displayName, data: m.data });
        continue;
      }
      out.push(m);
    }
    if (!out.length && displayName) {
      const work = fsMedia.find(
        (m) => WORK_DISK_NAMES.has(m.name.toUpperCase()) || /work\s*disk/i.test(m.name),
      );
      if (work) out.push({ name: displayName, data: work.data });
    }
    return out;
  }
  const out: SessionMediaSlot[] = [...session];
  for (const m of fsMedia) {
    if (/^blank\.d64$/i.test(m.name)) continue;
    if (WORK_DISK_NAMES.has(m.name.toUpperCase())) continue;
    if (out.some((s) => s.name === m.name)) continue;
    out.push({ name: m.name, bytes: m.data, kind: /\.(crt|bin)$/i.test(m.name) ? "cart" : "disk" });
  }
  return out.map((s) => ({ name: s.name, data: s.bytes }));
}

export function readMountedMediaForUi(
  emu: EjsInstance | null,
  displayName?: string | null,
): { name: string; data: Uint8Array }[] {
  return mergeSessionMedia(readMountedMedia(emu), displayName);
}

export function applyReal1541Timing(emu: EjsInstance | null, unit: IecUnit = 8): void {
  if (!emu) return;
  applyRuntimeOptions(emu, viceReal1541TimingOptions(unit));
  setWarp(emu, false);
}

export function readMountedMedia(emu: EjsInstance | null): { name: string; data: Uint8Array }[] {
  const FS = fsOf(emu);
  if (!FS?.readdir || !FS.readFile) return [];
  const out: { name: string; data: Uint8Array }[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 5 || out.length > 8) return;
    let names: string[] = [];
    try {
      names = FS.readdir(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (n === "." || n === ".." || SKIP_DIR.has(n)) continue;
      const p = dir === "/" ? `/${n}` : `${dir}/${n}`;
      try {
        const st = FS.stat(p);
        const isDir = FS.isDir ? FS.isDir(st.mode) : (st.mode & 0o170000) === 0o040000;
        if (isDir) {
          visit(p, depth + 1);
        } else if (MEDIA_EXT.test(n)) {
          const raw = FS.readFile(p, { encoding: "binary" });
          const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw as unknown as ArrayBuffer);
          if (data.byteLength > 64) out.push({ name: n, data });
        }
      } catch {
        /* skip unreadable */
      }
    }
  };
  visit("/", 0);
  return out;
}

export async function captureState(emu: EjsInstance | null): Promise<Uint8Array | null> {
  try {
    const raw = emu?.gameManager?.getState?.();
    if (!raw) return null;
    const st = await raw;
    return st instanceof Uint8Array ? st : null;
  } catch {
    return null;
  }
}

export function restoreState(emu: EjsInstance | null, data: ArrayBuffer | Uint8Array) {
  try {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    emu?.gameManager?.loadState(u8);
  } catch {
    /* core not ready */
  }
}
