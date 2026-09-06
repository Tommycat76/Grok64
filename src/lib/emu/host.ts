import { detectOs, isIos, isIosPhone, isTouchMobile } from "./detect";
import { sidOptions } from "./machines";
import { hasJiffyPair, romFileMap } from "./roms";
import { buildViceExtras, workDiskFor } from "./vice-extras";
import type { DriveMode, IecDrive, IecUnit, JoyPort, ReuSize, ScpuSimm, SidEngine, SidModel } from "./types";
import { RETRO_BTN } from "./types";
import { glog } from "./debug";

const DATA = "https://cdn.emulatorjs.org/stable/data/";

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
      // iOS WebKit needs preserveDrawingBuffer for CRT compositing; Android tablets do not
      // and pay a large fill-rate cost when it is forced on every WebGL context.
      const merged: Record<string, unknown> = { ...attrs, antialias: false, alpha: false };
      if (ios) merged.preserveDrawingBuffer = true;
      return orig.call(this, type, merged);
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
  padAxes[0] = 0;
  padAxes[1] = 0;
  padAxes[2] = 0;
  padAxes[3] = 0;
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

export function ensureRuntime(): Promise<void> {
  if (scriptsReady) return scriptsReady;
  if (typeof window !== "undefined" && window.EmulatorJS && (window as unknown as { nipplejs?: unknown }).nipplejs) {
    return Promise.resolve();
  }
  scriptsReady = (async () => {
    await loadCss(`${DATA}emulator.css`);
    for (const file of SCRIPTS) {
      await loadScript(`${DATA}src/${file}`);
    }
    if (!window.EmulatorJS) throw new Error("EmulatorJS failed to initialize");
    patchEjsInput();
  })().catch((err) => {
    scriptsReady = null;
    throw err;
  });
  return scriptsReady;
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
        'input_player1_l_x_plus = "nul"\n' +
        'input_player1_l_x_minus = "nul"\n' +
        'input_player1_l_y_plus = "nul"\n' +
        'input_player1_l_y_minus = "nul"\n' +
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
        'input_menu_toggle = "nul"\n'
      );
    };
  }
  const Ejs = window.EmulatorJS as unknown as { prototype?: { getCoreSettings?: () => string; __g64opt?: boolean } };
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
}

export interface BootConfig {
  gameUrl: string;
  gameName: string;
  core: string;
  machineOptions: Record<string, string>;
  sidEngine: SidEngine;
  sidModel: SidModel;
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

function effectiveReu(reu: ReuSize = "none"): ReuSize {
  if (isIosPhone()) {
    if (reu === "16384kB" || reu === "2048kB" || reu === "512kB") return "256kB";
  }
  return reu;
}

function coreOptions(cfg: BootConfig): Record<string, string> {
  const trueDrive = cfg.driveMode === "true";
  return {
    ...cfg.machineOptions,
    ...sidOptions(cfg.sidEngine, cfg.sidModel),
    vice_drive_true_emulation: trueDrive ? "enabled" : "disabled",
    vice_virtual_device_traps: trueDrive ? "disabled" : "enabled",
    vice_autostart: cfg.autostart === false ? "disabled" : "enabled",
    vice_autostart_warp: cfg.autostart === false ? "disabled" : "enabled",
    vice_autoloadwarp: cfg.autostart === false ? "disabled" : "enabled",
    vice_reset: cfg.autostart === false ? "hard" : "autostart",
    vice_statusbar: "disabled",
    vice_vkbd: "disabled",
    vice_keyboard_input: "enabled",
    vice_physical_keyboard_pass_through: "enabled",
    ...viceJoyOptions(cfg.joyPort),
    ...buildViceExtras({
      reu: effectiveReu(cfg.reu),
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
  await ensureRuntime();
  preserveWebglBuffer();
  keyboardArmed = false;
  const config: Record<string, unknown> = {
    gameUrl: cfg.gameUrl,
    dataPath: DATA,
    system: cfg.core,
    gameName: (cfg.gameName || "GROK64").replace(/[#<$+%>!`&*'|{}/\\?"=@:^\r\n]/g, "").trim() || "GROK64",
    color: "#c8ccd4",
    backgroundColor: "#0a0a0b",
    volume: cfg.volume,
    startOnLoad: true,
    threads: false,
    noAutoFocus: false,
    disableAutoLang: true,
    disableLocalStorage: true,
    disableCue: true,
    language: "en-US",
    browserMode: 2,
    keyboardInput: true,
    defaultOptions: coreOptions(cfg),
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

export function audioLocked(emu: EjsInstance | null): boolean {
  try {
    const sources = emu?.Module?.AL?.currentCtx?.sources;
    if (sources) {
      for (const src of sources) {
        if (src?.gain?.context?.state === "suspended") return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function unlockAudio(emu: EjsInstance | null) {
  try {
    const sources = emu?.Module?.AL?.currentCtx?.sources;
    if (sources) {
      for (const src of sources) {
        const ctx = src?.gain?.context;
        if (ctx && ctx.state === "suspended") {
          void ctx.resume().catch(() => undefined);
        }
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
  if (!root) return;
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
  try {
    emu.gameManager?.setKeyboardEnabled?.(true);
  } catch {
    /* ignore */
  }
  applyRuntimeOptions(emu, {
    vice_physical_keyboard_pass_through: "enabled",
    vice_keyboard_input: "enabled",
  });
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

export function joyInput(emu: EjsInstance | null, index: number, down: boolean) {
  const analog = index >= 16 && index <= 23;
  const value = down ? (analog ? 0x7fff : 1) : 0;
  rawSim(emu, 0, index, value);
}

export function setJoyVector(emu: EjsInstance | null, dx: number, dy: number, fire: boolean) {
  setVirtualPad(dx, dy, fire);
  const dead = 0.32;
  const left = dx < -dead;
  const right = dx > dead;
  const up = dy < -dead;
  const down = dy > dead;
  joyInput(emu, RETRO_BTN.LEFT, left);
  joyInput(emu, RETRO_BTN.RIGHT, right);
  joyInput(emu, RETRO_BTN.UP, up);
  joyInput(emu, RETRO_BTN.DOWN, down);
  joyInput(emu, RETRO_BTN.B, fire);
  joyInput(emu, RETRO_BTN.A, false);
  joyInput(emu, RETRO_BTN.Y, false);
  joyInput(emu, 16, false);
  joyInput(emu, 17, false);
  joyInput(emu, 18, false);
  joyInput(emu, 19, false);
}

/** 1351 mouse via left analog stick (vice_analogmouse=left). */
export function setMouseAnalog(
  emu: EjsInstance | null,
  ax: number,
  ay: number,
  leftDown: boolean,
  rightDown: boolean,
) {
  const cx = Math.max(-1, Math.min(1, ax));
  const cy = Math.max(-1, Math.min(1, ay));
  padAxes[0] = cx;
  padAxes[1] = cy;
  padAxes[2] = 0;
  padAxes[3] = 0;
  btn(0, leftDown);
  btn(1, rightDown);
  btn(14, false);
  btn(15, false);
  btn(12, false);
  btn(13, false);
  virtualPad0.timestamp = performance.now();
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
  joyInput(emu, RETRO_BTN.LEFT, false);
  joyInput(emu, RETRO_BTN.RIGHT, false);
  joyInput(emu, RETRO_BTN.UP, false);
  joyInput(emu, RETRO_BTN.DOWN, false);
}

export function clearMouseAnalog(emu: EjsInstance | null) {
  setMouseAnalog(emu, 0, 0, false, false);
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

export function fitEmu(el: HTMLElement | null, emu: EjsInstance | null, force = false) {
  if (!el || fitting) return;
  fitting = true;
  const canvas =
    (emu?.Module?.canvas as HTMLCanvasElement | undefined) ||
    (el.querySelector("canvas") as HTMLCanvasElement | null);
  try {
    if (canvas) {
      const parent = canvas.parentElement ?? el;
      const cw = Math.max(parent.clientWidth, el.clientWidth, 200);
      const ch = Math.max(parent.clientHeight, el.clientHeight, 160);
      const touchMobile = isTouchMobile();
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
      if (!boxStable && (canvas.width < 64 || canvas.height < 64 || touchMobile)) {
        canvas.width = bw;
        canvas.height = bh;
        lastFitBox = { pw: cw, ph: ch, bw, bh };
      } else if (!boxStable) {
        lastFitBox = { pw: cw, ph: ch, bw: canvas.width, bh: canvas.height };
      }
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      canvas.style.visibility = "visible";
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

export async function recycleCore(emu: EjsInstance | null, el: HTMLElement | null) {
  destroyEmu(emu, el);
  await new Promise((r) => setTimeout(r, isIosPhone() ? 700 : 250));
}

export function applyRuntimeOptions(emu: EjsInstance | null, opts: Record<string, string>) {
  if (!emu?.gameManager?.setVariable) return;
  for (const [k, v] of Object.entries(opts)) {
    try {
      emu.gameManager.setVariable(k, v);
    } catch {
      /* option may not exist on this core */
    }
  }
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

function fsOf(emu: EjsInstance | null): EmscriptenFS | null {
  return emu?.gameManager?.FS ?? emu?.Module?.FS ?? null;
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

export function injectRoms(emu: EjsInstance | null, files: Record<string, Uint8Array>): number {
  const FS = fsOf(emu);
  if (!FS?.writeFile) return 0;
  const roots = isIosPhone()
    ? ["/home/web_user/retroarch/userdata/system/vice"]
    : [
        "/home/web_user/retroarch/userdata/system/vice",
        "/home/web_user/retroarch/system/vice",
        "/system/vice",
        "/vice",
      ];
  for (const root of roots) mkdirFs(FS, root);
  let count = 0;
  for (const [name, data] of Object.entries(files)) {
    for (const root of roots) {
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

/** Inject Jiffy ROMs and flip vice_jiffydos — returns true when both ROMs are present. */
export async function applyJiffyDos(emu: EjsInstance | null, want: boolean): Promise<boolean> {
  if (!emu) return false;
  const on = want && (await hasJiffyPair());
  if (on) {
    try {
      const roms = await romFileMap();
      if (Object.keys(roms).length) injectRoms(emu, roms);
    } catch {
      /* optional */
    }
  }
  applyRuntimeOptions(emu, { vice_jiffydos: on ? "enabled" : "disabled" });
  return on;
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

export function clearUnitMounts() {
  unitMounts.clear();
}

export function applyIecUnit(emu: EjsInstance | null, iec: IecDrive, unit: IecUnit) {
  const work = workDiskFor(iec, unit);
  if (work !== "disabled") {
    applyRuntimeOptions(emu, { vice_work_disk: work });
  }
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
  applyIecUnit(emu, iec, unit);
  const wrote = writeBootFile(emu, data, base);
  if (wrote) {
    unitMounts.set(unit, base);
    pruneExtraDisks(emu);
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
  return writeBootFile(emu, data, target);
}

export function coreHasFs(emu: EjsInstance | null): boolean {
  const FS = fsOf(emu);
  return Boolean(FS?.writeFile && FS.readFile);
}

export function writeBootFile(emu: EjsInstance | null, data: Uint8Array, preferred?: string | null): boolean {
  const FS = fsOf(emu);
  if (!FS?.writeFile) return false;
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
    try {
      FS.writeFile(p, data);
      return true;
    } catch {
      /* try next path */
    }
  }
  return false;
}

const MEDIA_EXT = /\.(d64|d71|d81|g64|g71|crt|tap|t64)$/i;
const SKIP_DIR = new Set(["dev", "proc", "core", "tmp"]);

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
