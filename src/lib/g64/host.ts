import { g64log } from "./log";
import { sidOptions } from "./machines";
import { PAD, type EjsFs, type EjsInstance, type JoyPort } from "./types";

export type { JoyPort } from "./types";
export { PAD };

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
const TOUCH_ID = "Grok64 Touch";

const buttons = Array.from({ length: 16 }, () => ({
  pressed: false,
  touched: false,
  value: 0,
}));
const axes = [0, 0, 0, 0];

function fakePad(index: number) {
  return {
    id: TOUCH_ID,
    index,
    connected: true,
    mapping: "standard" as const,
    buttons: buttons as unknown as GamepadButton[],
    axes,
    timestamp: 0,
    hapticActuators: [] as GamepadHapticActuator[],
    vibrationActuator: null,
  };
}

const pad0 = fakePad(0);
let keyboardBound = false;
let allowRestart = false;
let canvasPatched = false;
let scriptsPromise: Promise<void> | null = null;
let padsHooked = false;

export interface BootOpts {
  gameUrl: string;
  gameName?: string;
  core: string;
  machineOptions: Record<string, string>;
  sidEngine: string;
  sidModel: string;
  driveMode: string;
  joyPort: JoyPort;
  volume: number;
  autostart?: boolean;
  onStart: () => void;
  onReady?: () => void;
  onError?: (msg: string) => void;
}

function patchCanvas() {
  if (canvasPatched || typeof HTMLCanvasElement === "undefined") return;
  canvasPatched = true;
  const proto = HTMLCanvasElement.prototype;
  const orig = proto.getContext;
  proto.getContext = function (this: HTMLCanvasElement, type, attrs) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
      return orig.call(this, type, { ...attrs, preserveDrawingBuffer: true, antialias: false });
    }
    return orig.call(this, type, attrs);
  } as typeof proto.getContext;
}

function guardRestart(inst: EjsInstance) {
  const gm = inst.gameManager;
  if (gm && !gm.__g64guard) {
    gm.__g64guard = true;
    const restart = gm.restart?.bind(gm);
    if (restart) {
      gm.restart = () => {
        if (!allowRestart) {
          g64log("restart-blocked");
          return;
        }
        g64log("restart-ok");
        restart();
      };
    }
    if (gm.functions?.restart) {
      const fn = gm.functions.restart.bind(gm.functions);
      gm.functions.restart = () => {
        if (!allowRestart) {
          g64log("restart-blocked-fn");
          return;
        }
        fn();
      };
    }
    const wrap = (fn: (p: number, i: number, v: number) => void) => (p: number, i: number, v: number) => {
      if (i >= 24 && i <= 26) {
        if (v) g64log("ejs-special-blocked", { player: p, index: i, value: v });
        return;
      }
      fn(p, i, v);
    };
    if (gm.simulateInput) gm.simulateInput = wrap(gm.simulateInput.bind(gm));
    if (gm.functions?.simulateInput) {
      gm.functions.simulateInput = wrap(gm.functions.simulateInput.bind(gm.functions));
    }
  }
  const mod = inst.Module;
  if (mod && !mod.__g64abort) {
    mod.__g64abort = true;
    mod.abort = () => {
      g64log("abort-blocked");
    };
  }
}

function setPadButton(index: number, down: boolean) {
  buttons[index]!.pressed = down;
  buttons[index]!.touched = down;
  buttons[index]!.value = +!!down;
}

function hookGamepads() {
  if (padsHooked) return;
  padsHooked = true;
  const nav = navigator as Navigator & { webkitGetGamepads?: () => (Gamepad | null)[] };
  const orig = nav.getGamepads?.bind(nav);
  const webkit = nav.webkitGetGamepads?.bind(nav);
  const mixed = () => {
    pad0.timestamp = performance.now();
    const real = orig ? Array.from(orig()) : webkit ? Array.from(webkit()) : [];
    return [pad0 as unknown as Gamepad, real[1] ?? null, real[2] ?? null, real[3] ?? null];
  };
  try {
    Object.defineProperty(nav, "getGamepads", { configurable: true, value: mixed });
  } catch {
    nav.getGamepads = mixed as Navigator["getGamepads"];
  }
  if (nav.webkitGetGamepads) {
    try {
      Object.defineProperty(nav, "webkitGetGamepads", { configurable: true, value: mixed });
    } catch {
      nav.webkitGetGamepads = mixed;
    }
  }
}

const CONTROL_MAP: [number, string][] = [
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
  [16, "LEFT_STICK_X:+1"],
  [17, "LEFT_STICK_X:-1"],
  [18, "LEFT_STICK_Y:+1"],
  [19, "LEFT_STICK_Y:-1"],
];

function bindControls(inst: EjsInstance) {
  try {
    inst.controls ||= {};
    inst.controls[0] ||= {};
    for (const [idx, value2] of CONTROL_MAP) {
      const row = inst.controls[0][idx] ?? {};
      row.value2 = value2;
      inst.controls[0][idx] = row;
    }
  } catch {
    /* core not ready */
  }
}

function bindGamepad(inst: EjsInstance | null) {
  if (!inst) return;
  hookGamepads();
  try {
    const gp = (inst as unknown as { gamepad?: { getGamepads?: () => (Gamepad | null)[] } }).gamepad;
    if (gp) gp.getGamepads = () => [pad0 as unknown as Gamepad, null, null, null];
  } catch {
    /* ignore */
  }
  try {
    if (!Array.isArray(inst.gamepadSelection)) inst.gamepadSelection = ["", "", "", ""];
    inst.gamepadSelection[0] = `${TOUCH_ID}_0`;
    inst.gamepadSelection[1] = "";
  } catch {
    /* ignore */
  }
  bindControls(inst);
}

export function setFakePad(x: number, y: number, fire: boolean) {
  const dead = 0.32;
  setPadButton(14, x < -dead);
  setPadButton(15, x > dead);
  setPadButton(12, y < -dead);
  setPadButton(13, y > dead);
  setPadButton(0, fire);
  setPadButton(1, false);
  axes[0] = 0;
  axes[1] = 0;
  axes[2] = 0;
  axes[3] = 0;
  pad0.timestamp = performance.now();
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

function loadCss(href: string) {
  return new Promise<void>((resolve) => {
    if (document.querySelector(`link[href="${href}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement("link");
    el.rel = "stylesheet";
    el.href = href;
    el.onload = () => resolve();
    el.onerror = () => resolve();
    document.head.appendChild(el);
  });
}

function patchEjsPrototypes() {
  const gm = window.EJS_GameManager?.prototype;
  if (gm && !gm.__g64pad && typeof gm.getRetroArchCfg === "function") {
    gm.__g64pad = true;
    const orig = gm.getRetroArchCfg;
    gm.getRetroArchCfg = function () {
      return (
        orig.call(this) +
        `video_gpu_screenshot = false
autosave_interval = 0
savestate_auto_load = false
savestate_auto_save = false
input_libretro_device_p1 = "1"
input_libretro_device_p2 = "0"
input_player1_analog_dpad_mode = 0
input_player1_joypad_index = 0
input_autodetect_enable = false
input_max_users = 1
`
      );
    };
  }
  const ejs = window.EmulatorJS?.prototype as
    | { __g64opt?: boolean; getCoreSettings?: () => string; config?: { defaultOptions?: Record<string, string> } }
    | undefined;
  if (ejs && !ejs.__g64opt && typeof ejs.getCoreSettings === "function") {
    ejs.__g64opt = true;
    ejs.getCoreSettings = function () {
      const opts = this.config?.defaultOptions || {};
      let out = "";
      for (const k of Object.keys(opts)) out += `${k} = "${opts[k]}"\n`;
      return out;
    };
  }
}

export function loadEmulatorJs() {
  if (scriptsPromise) return scriptsPromise;
  if (typeof window !== "undefined" && window.EmulatorJS && window.nipplejs) return Promise.resolve();
  scriptsPromise = (async () => {
    await loadCss(`${DATA}emulator.css`);
    for (const file of SCRIPTS) await loadScript(`${DATA}src/${file}`);
    if (!window.EmulatorJS) throw new Error("EmulatorJS failed to initialize");
    patchEjsPrototypes();
  })().catch((err) => {
    scriptsPromise = null;
    throw err;
  });
  return scriptsPromise;
}

export function viceJoyOptions(port: JoyPort) {
  return {
    vice_joyport: port === 1 ? "1" : "2",
    vice_joyport_type: "1",
    vice_retropad_options: "disabled",
    vice_keyrah_keypad_mappings: "disabled",
  };
}

function defaultOptions(opts: BootOpts) {
  const trueDrive = opts.driveMode === "true";
  return {
    ...opts.machineOptions,
    ...sidOptions(opts.sidEngine, opts.sidModel),
    vice_drive_true_emulation: trueDrive ? "enabled" : "disabled",
    vice_virtual_device_traps: trueDrive ? "disabled" : "enabled",
    vice_autostart: opts.autostart === false ? "disabled" : "enabled",
    vice_autostart_warp: opts.autostart === false ? "disabled" : "enabled",
    vice_autoloadwarp: opts.autostart === false ? "disabled" : "enabled",
    vice_reset: opts.autostart === false ? "hard" : "autostart",
    vice_statusbar: "disabled",
    vice_vkbd: "disabled",
    ...viceJoyOptions(opts.joyPort),
    shader: "disabled",
  };
}

function defaultControllers() {
  const p0 = {
    0: { value: "x", value2: "BUTTON_2" },
    1: { value: "s", value2: "BUTTON_4" },
    2: { value: "v", value2: "SELECT" },
    3: { value: "enter", value2: "START" },
    4: { value: "up arrow", value2: "DPAD_UP" },
    5: { value: "down arrow", value2: "DPAD_DOWN" },
    6: { value: "left arrow", value2: "DPAD_LEFT" },
    7: { value: "right arrow", value2: "DPAD_RIGHT" },
    8: { value: "z", value2: "BUTTON_1" },
    9: { value: "a", value2: "BUTTON_3" },
    10: { value: "q", value2: "LEFT_TOP_SHOULDER" },
    11: { value: "e", value2: "RIGHT_TOP_SHOULDER" },
    16: { value: "h", value2: "LEFT_STICK_X:+1" },
    17: { value: "f", value2: "LEFT_STICK_X:-1" },
    18: { value: "g", value2: "LEFT_STICK_Y:+1" },
    19: { value: "t", value2: "LEFT_STICK_Y:-1" },
  };
  return { 0: { ...p0 }, 1: {}, 2: {}, 3: {} };
}

export async function createEjs(mount: HTMLElement, opts: BootOpts) {
  await loadEmulatorJs();
  patchCanvas();
  keyboardBound = false;
  const cfg = {
    gameUrl: opts.gameUrl,
    dataPath: DATA,
    system: opts.core,
    gameName: (opts.gameName || "GROK64").replace(/[#<$+%>!`&*'|{}/\\?"=@:^\r\n]/g, "").trim() || "GROK64",
    color: "#c8ccd4",
    backgroundColor: "#0a0a0b",
    volume: opts.volume,
    startOnLoad: true,
    threads: false,
    noAutoFocus: false,
    disableAutoLang: true,
    disableLocalStorage: true,
    disableCue: true,
    language: "en-US",
    browserMode: 2,
    defaultOptions: defaultOptions(opts),
    defaultControllers: defaultControllers(),
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
  mount.innerHTML = "";
  hookGamepads();
  const inst = new window.EmulatorJS!("#grok64-player", cfg);
  window.__ejs = inst;
  let started = false;
  inst.on("start", () => {
    if (started) return;
    started = true;
    plugJoysticks(inst, opts.joyPort);
    guardRestart(inst);
    opts.onStart();
  });
  inst.on("ready", () => opts.onReady?.());
  inst.on("error", (...args: unknown[]) => {
    const msg =
      args
        .map((a) => (a instanceof Error ? a.message : String(a ?? "")))
        .filter(Boolean)
        .join(" ") || "Emulator error";
    opts.onError?.(msg);
  });
  return inst;
}

export function audioSuspended(inst: EjsInstance | null) {
  try {
    const sources = inst?.Module?.AL?.currentCtx?.sources;
    if (sources) {
      for (const s of sources) if (s?.gain?.context?.state === "suspended") return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function resumeAudio(inst: EjsInstance | null) {
  try {
    const sources = inst?.Module?.AL?.currentCtx?.sources;
    if (sources) {
      for (const s of sources) {
        const ctx = s?.gain?.context;
        if (ctx && ctx.state === "suspended") void ctx.resume();
      }
    }
  } catch {
    /* ignore */
  }
  try {
    inst?.gameManager?.toggleMainLoop?.(1);
  } catch {
    /* ignore */
  }
  if (inst) {
    try {
      inst.paused = false;
    } catch {
      /* ignore */
    }
  }
}

export function clickEjsOverlay(root: HTMLElement | null, mode: "play" | "boot" = "play") {
  if (!root) return;
  const nodes = root.querySelectorAll("button, a, .ejs_menu_button, .ejs_popup_container");
  for (const el of nodes) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    const resume = /resume emulator|click to resume/i.test(text);
    const play = /play now|click here to start/i.test(text);
    if (resume || (mode === "boot" && play)) (el as HTMLElement).click();
  }
}

export function plugJoysticks(inst: EjsInstance | null, port: JoyPort = 2) {
  if (!inst) return;
  guardRestart(inst);
  if (!keyboardBound) {
    try {
      inst.gameManager?.setKeyboardEnabled?.(true);
    } catch {
      /* ignore */
    }
    keyboardBound = true;
  }
  bindGamepad(inst);
  for (let i = 0; i < 16; i++) simulateButton(inst, i, false);
  try {
    inst.gameManager?.setVariable?.("vice_joyport", port === 1 ? "1" : "2");
  } catch {
    /* ignore */
  }
  const canvas = inst.Module?.canvas ?? document.querySelector<HTMLCanvasElement>("#grok64-player canvas");
  if (canvas && !canvas.id) canvas.id = "canvas";
  try {
    inst.elements?.parent?.focus?.();
  } catch {
    /* ignore */
  }
}

function rawSim(inst: EjsInstance | null, player: number, index: number, value: number) {
  const gm = inst?.gameManager;
  const mod = inst?.Module;
  try {
    gm?.functions?.simulateInput?.(player, index, value);
  } catch {
    /* ignore */
  }
  try {
    gm?.simulateInput?.(player, index, value);
  } catch {
    /* ignore */
  }
  try {
    mod?._simulate_input?.(player, index, value);
  } catch {
    /* ignore */
  }
}

export function simulateButton(inst: EjsInstance | null, index: number, down: boolean) {
  rawSim(inst, 0, index, down ? (index >= 16 && index <= 23 ? 32767 : 1) : 0);
}

export function setJoyVector(inst: EjsInstance | null, x: number, y: number, fire: boolean) {
  setFakePad(x, y, fire);
  const dead = 0.32;
  simulateButton(inst, PAD.LEFT, x < -dead);
  simulateButton(inst, PAD.RIGHT, x > dead);
  simulateButton(inst, PAD.UP, y < -dead);
  simulateButton(inst, PAD.DOWN, y > dead);
  simulateButton(inst, PAD.B, fire);
  simulateButton(inst, PAD.A, false);
  simulateButton(inst, PAD.Y, false);
  simulateButton(inst, 16, false);
  simulateButton(inst, 17, false);
  simulateButton(inst, 18, false);
  simulateButton(inst, 19, false);
}

export function restartEmu(inst: EjsInstance | null) {
  guardRestart(inst!);
  allowRestart = true;
  try {
    inst?.gameManager?.restart?.();
  } catch {
    /* ignore */
  }
  allowRestart = false;
}

export function setVariables(inst: EjsInstance | null, vars: Record<string, string>) {
  if (!inst?.gameManager?.setVariable) return;
  for (const [k, v] of Object.entries(vars)) {
    try {
      inst.gameManager.setVariable(k, v);
    } catch {
      /* ignore */
    }
  }
}

export function kickAutostart(inst: EjsInstance | null, trueDrive = false) {
  setVariables(inst, {
    vice_autostart: "enabled",
    vice_autostart_warp: "enabled",
    vice_autoloadwarp: "enabled",
    vice_reset: "autostart",
    ...(trueDrive
      ? { vice_drive_true_emulation: "enabled", vice_virtual_device_traps: "disabled" }
      : {}),
  });
  restartEmu(inst);
  plugJoysticks(inst);
}

export function hardReset(inst: EjsInstance | null) {
  setVariables(inst, {
    vice_autostart: "disabled",
    vice_autostart_warp: "disabled",
    vice_autoloadwarp: "disabled",
    vice_reset: "hard",
  });
  restartEmu(inst);
}

export function setPaused(inst: EjsInstance | null, paused: boolean) {
  try {
    inst?.gameManager?.toggleMainLoop?.(+!paused);
  } catch {
    /* ignore */
  }
}

export function setWarped(inst: EjsInstance | null, warped: boolean) {
  try {
    inst?.gameManager?.toggleFastForward?.(warped);
  } catch {
    /* ignore */
  }
}

function getFs(inst: EjsInstance | null): EjsFs | null {
  return inst?.gameManager?.FS ?? inst?.Module?.FS ?? null;
}

const SAVE_FILE = /\.(srm|sav|state|rtc|auto)$/i;

export function wipeSaves(inst: EjsInstance | null) {
  const fs = getFs(inst);
  if (!fs?.readdir) return;
  const walk = (path: string, depth: number) => {
    if (depth > 3) return;
    let names: string[] = [];
    try {
      names = fs.readdir!(path);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "." || name === "..") continue;
      const full = path === "/" ? `/${name}` : `${path}/${name}`;
      try {
        const st = fs.stat!(full);
        const dir = fs.isDir ? fs.isDir(st.mode) : (st.mode & 61440) === 16384;
        if (dir) {
          if (depth === 0 && name !== "data") continue;
          walk(full, depth + 1);
        } else if ((SAVE_FILE.test(name) || /quick\.state$/i.test(name)) && fs.unlink) {
          fs.unlink(full);
        }
      } catch {
        /* ignore */
      }
    }
  };
  walk("/data/saves", 0);
  for (const name of ["game.state", "1-quick.state", "2-quick.state", "3-quick.state"]) {
    try {
      fs.unlink?.(`/${name}`);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.syncfs?.(false, () => undefined);
  } catch {
    /* ignore */
  }
}

export function destroyEmu(inst: EjsInstance | null, mount: HTMLElement | null) {
  keyboardBound = false;
  try {
    inst?.gameManager?.toggleMainLoop?.(0);
  } catch {
    /* ignore */
  }
  try {
    inst?.Module?.pauseMainLoop?.();
  } catch {
    /* ignore */
  }
  try {
    wipeSaves(inst);
  } catch {
    /* ignore */
  }
  try {
    delete (window as unknown as { EJS_Runtime?: unknown }).EJS_Runtime;
  } catch {
    /* ignore */
  }
  for (const el of Array.from(document.querySelectorAll("script"))) {
    if (el.src.startsWith("blob:")) {
      el.remove();
      try {
        URL.revokeObjectURL(el.src);
      } catch {
        /* ignore */
      }
    }
  }
  if (mount) mount.innerHTML = "";
}

export async function recycleEmu(inst: EjsInstance | null, mount: HTMLElement | null) {
  destroyEmu(inst, mount);
  await new Promise((r) => setTimeout(r, 250));
}

export function ensureCanvasSize(root: HTMLElement | null, inst: EjsInstance | null) {
  if (!root) return;
  const canvas = inst?.Module?.canvas || root.querySelector("canvas");
  if (canvas && !(canvas.width >= 64 && canvas.height >= 64)) {
    try {
      canvas.width = 384;
      canvas.height = 272;
    } catch {
      /* ignore */
    }
  }
}

export function listMedia(inst: EjsInstance | null) {
  const fs = getFs(inst);
  if (!fs?.readdir || !fs.readFile) return [] as { name: string; data: Uint8Array }[];
  const out: { name: string; data: Uint8Array }[] = [];
  const skip = new Set(["dev", "proc", "core", "tmp"]);
  const media = /\.(d64|d71|d81|g64|g71|crt|tap|t64)$/i;
  const walk = (path: string, depth: number) => {
    if (depth > 5 || out.length > 8) return;
    let names: string[] = [];
    try {
      names = fs.readdir!(path);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "." || name === ".." || skip.has(name)) continue;
      const full = path === "/" ? `/${name}` : `${path}/${name}`;
      try {
        const st = fs.stat!(full);
        const dir = fs.isDir ? fs.isDir(st.mode) : (st.mode & 61440) === 16384;
        if (dir) walk(full, depth + 1);
        else if (media.test(name)) {
          const raw = fs.readFile!(full, { encoding: "binary" });
          const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw as unknown as ArrayBuffer);
          if (data.byteLength > 64) out.push({ name, data });
        }
      } catch {
        /* ignore */
      }
    }
  };
  walk("/", 0);
  return out;
}

export function currentFileName(inst: EjsInstance | null) {
  const n = inst?.fileName;
  if (typeof n === "string" && n.trim()) return n.replace(/^\//, "");
  const media = listMedia(inst);
  return (media.find((f) => /\.d64$/i.test(f.name)) ?? media[0])?.name ?? null;
}

export function hasFs(inst: EjsInstance | null) {
  const fs = getFs(inst);
  return !!(fs?.writeFile && fs.readFile);
}

export function writeBootFile(inst: EjsInstance | null, data: Uint8Array, name?: string | null) {
  const fs = getFs(inst);
  if (!fs?.writeFile) return false;
  const file = name || currentFileName(inst);
  const candidates: string[] = [];
  if (file) {
    candidates.push(file.startsWith("/") ? file : `/${file}`, file.replace(/^\//, ""));
  }
  candidates.push("/WORK DISK.D64", "WORK DISK.D64");
  const seen = new Set<string>();
  for (const path of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      fs.writeFile(path, data);
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

export async function snapshotState(inst: EjsInstance | null) {
  try {
    const st = inst?.gameManager?.getState?.();
    if (!st) return null;
    const data = await st;
    return data instanceof Uint8Array ? data : null;
  } catch {
    return null;
  }
}
