// @ts-nocheck — large loosely-typed emulator shell; runtime is covered by Playwright QA.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Disc3, FolderOpen, Gamepad2, Info, Keyboard as KeyboardIcon, Pause, Play, Power, RotateCcw, Settings, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { C64Keyboard } from "@/components/emu/Keyboard";
import { TouchControls } from "@/components/emu/Joystick";
import { LibrarySheet } from "@/components/emu/LibrarySheet";
import { DiskMountSheet } from "@/components/emu/DiskMountSheet";
import { SettingsSheet } from "@/components/emu/SettingsSheet";
import { applyRecipe, saveSnapshot, SnapshotsSheet } from "@/components/emu/SnapshotsSheet";
import { copyBuffer, getFile, listLibrary, putSaveState, deleteSaveState, touchPlayed, updateFileData, ensureWorkDisk, isWorkDisk, removeFile } from "@/lib/emu/library";
import { useEmu } from "@/lib/emu/store";
import {
  applyRuntimeOptions,
  applyJiffyDos,
  autostartAfterReady,
  bootEmulator,
  bootFileOf,
  captureState,
  clearRetroSaves,
  clearUnitMounts,
  coreHasFs,
  destroyEmu,
  disarmAutostart,
  dismissEjsPrompts,
  ensureRuntime,
  prefetchViceCores,
  fitEmu,
  hardReset,
  hasRealGamepad,
  joyInput,
  listRealGamepads,
  mountDiskOnUnit,
  applyIecUnit,
  attachAutostartDisk,
  cartFreeze,
  cartReset,
  cmdHdSwap,
  flushEmuFs,
  lastAppliedJiffy,
  lastAppliedWorkDisk,
  swapBootDisk,
  sd2iecFreeze,
  sd2iecSwapDevice,
  scpuReset,
  plugJoysticks,
  prepareCore,
  probeCore,
  readMountedMedia,
  recycleCore,
  restoreState,
  resetEmu,
  setJoyVector,
  setPaused,
  setWarp,
  setMouseAnalog,
  clearMouseAnalog,
  audioLocked,
  unlockAudio,
  suspendAudio,
  viceJoyOptions,
  waitForCoreFs,
} from "@/lib/emu/host";
import { hasCmdRom, hasJiffyPair, prefetchBundledRoms } from "@/lib/emu/roms";
import { listPartitions, partitionsForMount, setIecDevice } from "@/lib/emu/sd2iec";
import { buildViceExtras, C64OS_REU, wantsLargeReu, wantsSuperCpu, workDiskFor } from "@/lib/emu/vice-extras";
import { HwHoldChip } from "@/components/emu/HwHoldChip";
import { mapHasDrive, planPlay, shouldRecoverBoot, unitOfDrive, userAttachFromMap } from "@/lib/emu/play-session";
import {
  actionForPress,
  hwButtonById,
  hwButtonTitle,
  sd2iecSwapUnit,
  visibleHwButtons,
  type HwPress,
} from "@/lib/emu/hw-buttons";
import { detectLine, resolveMachine, videoStandardOptions } from "@/lib/emu/machines";
import { snapshotDevice, readViewport, applyViewport, isIosPhone, isTouchMobile } from "@/lib/emu/detect";
import { detectJoyPort, detectSoftwareStandard } from "@/lib/emu/region";
import { RETRO_BTN } from "@/lib/emu/types";
import { dispatchC64Key, isJoyFireKey } from "@/lib/emu/keys";
import { bootFileName, driveForPlay, d64DiskName, isDiskKind, isWorkDiskImage, kindOf, needsTypedBoot } from "@/lib/emu/formats";
import { wrapForDiskSwap, prepareAutostartDisk, wantsCracktroNudge } from "@/lib/emu/d64";
import { isSid, psidToPrg } from "@/lib/emu/psid";
import { toArrayBuffer } from "@/lib/emu/archive";
import { BuildId } from "@/components/emu/BuildId";
import { debugQueryOn, glog, glogFire, setDebugUi, subscribeLog } from "@/lib/emu/debug";
import { readBuildId } from "@/lib/emu/build-id";
import { createMenuJoyGate, menuJoyStep, resetMenuJoyGate } from "@/lib/emu/menu-joy.mjs";
import { applyStickPrecision, createStickPrecision, resetStickPrecision } from "@/lib/emu/stick-precision.mjs";
import { publicUrl } from "@/lib/public-url";
import { pokeAudioUnlock } from "@/lib/emu/audio-unlock";
import {
  forceIosMirrorBlit,
  installIosPaintHooks,
  iosCrtPath,
  iosTapResumeCooldown,
  isIosMirrorActive,
  isIosMirrorPainted,
  isIosPaintSettled,
  presentIosCrt,
  resetIosPaintState,
  scheduleIosCrtPresents,
  shotDisplayCanvas,
  startIosPaintWatchdog,
  stopIosCrt,
  stopIosPaintWatchdog,
  stripIosOverlay,
} from "@/lib/emu/ios-paint";

function frameMsForStandard(standard: string) {
  return standard === "ntsc" ? 1000 / 60 : 20;
}

function playLockDuration(mode: string): number {
  if (isTouchMobile()) return mode === "disk" ? 4500 : 1400;
  return mode === "disk" ? 12_000 : 3500;
}

function gameplayReadyDelay(lockMs: number): number {
  if (isTouchMobile()) return lockMs + 300;
  return Math.max(lockMs + 4000, 20_000);
}

const PlayerMount = memo(function PlayerMount() {
  return <div id="grok64-player" />;
});

let fitTimers: number[] = [];
function scheduleFit() {
  for (const id of fitTimers) window.clearTimeout(id);
  const run = () => {
    const el = document.getElementById("grok64-player");
    const emu = (window as unknown as { __ejs?: Parameters<typeof fitEmu>[1] }).__ejs ?? null;
    fitEmu(el, emu);
  };
  run();
  fitTimers = [50, 160, 400, 800].map((ms) => window.setTimeout(run, ms));
  return fitTimers;
}

export function Grok64App() {
  const s = useEmu();
  const emuRef = useRef(null);
  const blobRef = useRef(null);
  const joyRef = useRef({ x: 0, y: 0, fire: false });
  const libIdRef = useRef(null);
  const persistTimer = useRef(null);
  const playBufferRef = useRef(async () => {});
  const bootHoldRef = useRef(false);
  const bootKickRef = useRef(false);
  const recoverOnceRef = useRef(false);
  const powerOnRef = useRef(() => {});
  const splashRef = useRef(null);
  const loadGenRef = useRef(0);
  const playModeRef = useRef("basic");
  const persistGateRef = useRef(true);
  const inGameplayRef = useRef(false);
  const bootTimersRef = useRef([]);
  const pendingKickRef = useRef(false);
  const bootPathRef = useRef(null);
  const workDiskBytesRef = useRef(null);
  const playLockRef = useRef(false);
  const playLockGen = useRef(0);
  const pendingSnapshotRef = useRef(null);
  const playPayloadRef = useRef(null);
  const sessionIecRef = useRef(s.iecDrive);
  const sessionUnitRef = useRef(s.iecUnit);
  const cmdSwappedRef = useRef(false);
  const hwActionRef = useRef((_id: string, _press: HwPress) => {});
  const [cmdSwapped, setCmdSwapped] = useState(false);
  const [sdUnit, setSdUnit] = useState(s.iecUnit);
  const menuJoyGateRef = useRef(createMenuJoyGate());
  const stickPrecisionRef = useRef(createStickPrecision(20));
  const stickCenterHoldRef = useRef(false);
  const jumpHeldRef = useRef(false);
  const arrowJoyRef = useRef({ up: false, down: false, left: false, right: false });
  const lastJoySentRef = useRef({ x: 0, y: 0, fire: false });
  const fireArmedAt = useRef(0);
  const mouseVelRef = useRef({ x: 0, y: 0 });
  const mouseBtnRef = useRef({ left: false, right: false });
  const [awaitingStart, setAwaitingStart] = useState(false);
  const [iosResume, setIosResume] = useState(false);
  const [diskOpen, setDiskOpen] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [cartLive, setCartLive] = useState(false);
  const cartLiveRef = useRef(false);
  const resetReadyRef = useRef(() => {});
  const [softwareStd, setSoftwareStd] = useState(null);
  const softwareStdRef = useRef(null);
  const [snap, setSnap] = useState({
    device: "phone",
    preferFast: true,
    os: "other",
    label: "Device",
    memoryGb: null,
    cores: null,
    onn: false,
  });
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const [view, setView] = useState({ width: 1280, height: 720, orient: "landscape" });
  const [stickViz, setStickViz] = useState({ x: 0, y: 0 });
  const resolved = useMemo(
    () =>
      resolveMachine(
        {
          machineId: s.machineId,
          videoStandard: s.videoStandard,
          coreMode: s.coreMode,
          driveMode: s.driveMode,
        },
        snap,
        softwareStd,
      ),
    [s.machineId, s.videoStandard, s.coreMode, s.driveMode, snap, softwareStd],
  );
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  const isMenuJoyMode = useCallback(() => {
    const st = useEmu.getState();
    return st.running && !st.booting && !playLockRef.current && !inGameplayRef.current;
  }, []);
  const clearMenuJoyInput = useCallback(() => {
    arrowJoyRef.current = { up: false, down: false, left: false, right: false };
    resetMenuJoyGate(menuJoyGateRef.current);
    lastJoySentRef.current = { x: 0, y: 0, fire: false };
  }, []);
  const emitJoyVector = useCallback((fireOverride) => {
    const emu = emuRef.current;
    if (!emu) return;
    if (playLockRef.current || useEmu.getState().booting) {
      const j = joyRef.current;
      if (j.x !== 0 || j.y !== 0 || j.fire) {
        j.x = 0;
        j.y = 0;
        j.fire = false;
        lastJoySentRef.current = { x: 0, y: 0, fire: false };
        setJoyVector(emu, 0, 0, false);
      }
      return;
    }
    const j = joyRef.current;
    const fire = fireOverride ?? j.fire;
    let x = j.x;
    let y = j.y;
    const a = arrowJoyRef.current;
    if (a.left) x = -1;
    if (a.right) x = 1;
    if (a.up) y = -1;
    if (a.down) y = 1;
    if (jumpHeldRef.current) y = -1;
    if (isMenuJoyMode()) {
      const out = menuJoyStep(menuJoyGateRef.current, x, y, performance.now());
      if (out.x === 0 && out.y === 0) {
        const last = lastJoySentRef.current;
        if (last.x === 0 && last.y === 0 && fire === last.fire) return;
      }
      lastJoySentRef.current = { x: out.x, y: out.y, fire };
      setJoyVector(emu, out.x, out.y, fire);
      return;
    }
    resetMenuJoyGate(menuJoyGateRef.current);
    const st = useEmu.getState();
    if (st.stickGate === "4way") {
      stickPrecisionRef.current.precision = true;
      stickPrecisionRef.current.periodMs = frameMsForStandard(resolvedRef.current.standard);
      const out = applyStickPrecision(
        stickPrecisionRef.current,
        { x, y },
        performance.now(),
        stickCenterHoldRef.current,
      );
      x = out.x;
      y = out.y;
    } else {
      stickPrecisionRef.current.precision = false;
    }
    const last = lastJoySentRef.current;
    if (x === last.x && y === last.y && fire === last.fire) return;
    lastJoySentRef.current = { x, y, fire };
    setJoyVector(emu, x, y, fire);
  }, [isMenuJoyMode]);
  const emitJoyRef = useRef(() => {});
  emitJoyRef.current = emitJoyVector;
  useEffect(() => {
    let raf = 0;
    const last = { width: 0, height: 0, orient: "" };
    const bootSnap = snapshotDevice();
    snapRef.current = bootSnap;
    setSnap(bootSnap);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.g64os = bootSnap.os;
      if (bootSnap.os === "ios" && useEmu.getState().crtFilter) {
        useEmu.getState().setCrtFilter(false);
      }
    }
    const update = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = snapshotDevice();
        const cur = snapRef.current;
        if (
          next.device !== cur.device ||
          next.preferFast !== cur.preferFast ||
          next.os !== cur.os ||
          next.label !== cur.label
        ) {
          setSnap(next);
          snapRef.current = next;
          if (typeof document !== "undefined") document.documentElement.dataset.g64os = next.os;
        }
        const vp = applyViewport(readViewport());
        const changed = last.width !== vp.width || last.height !== vp.height || last.orient !== vp.orient;
        if (!changed) return;
        last.width = vp.width;
        last.height = vp.height;
        last.orient = vp.orient;
        setView(vp);
        scheduleFit();
      });
    };
    update();
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    const so = screen.orientation;
    so?.addEventListener?.("change", update);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      mq.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      so?.removeEventListener?.("change", update);
    };
  }, []);
  useEffect(() => {
    const timers = scheduleFit();
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [s.showKeyboard, view.orient]);
  useEffect(() => {
    void ensureRuntime().catch(() => undefined);
    prefetchViceCores();
    prefetchBundledRoms()
      .then(async (added) => {
        if (added.length && (await hasJiffyPair())) {
          useEmu.getState().setJiffyDos(true);
          toast.message(`JiffyDOS ready — C64 + 1541${added.includes("jiffy-1571") ? " + 1571/1581" : ""}`);
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    installIosPaintHooks(() => ({
      emu: emuRef.current,
      root: document.getElementById("grok64-player"),
    }));
    return () => {
      stopIosPaintWatchdog();
      stopIosCrt();
    };
  }, []);
  useEffect(() => {
    const w = window;
    w.__g64 = {
      playMode: () => playModeRef.current,
      sessionIec: () => sessionIecRef.current,
      userIec: () => useEmu.getState().iecDrive,
      userUnit: () => useEmu.getState().iecUnit,
      reu: () => useEmu.getState().reuSize,
      workDisk: () => lastAppliedWorkDisk(),
      jiffyLive: () => lastAppliedJiffy(),
      title: () => useEmu.getState().currentTitle,
      bootPath: () => bootPathRef.current,
      hasFs: () => coreHasFs(emuRef.current),
      fileName: () => emuRef.current?.fileName ?? null,
      power: () => powerOnRef.current(),
      powered: () => useEmu.getState().powered,
      running: () => useEmu.getState().running,
      booting: () => useEmu.getState().booting,
      playLock: () => playLockRef.current,
      paintSettled: () => isIosPaintSettled(),
      paintPath: () => iosCrtPath(),
      mirrorPainted: () => isIosMirrorPainted(),
      mirrorActive: () => isIosMirrorActive(),
      buildId: () => readBuildId(),
      crt: () => {
        const root = document.getElementById("grok64-player");
        const c = root?.querySelector("canvas");
        const cs = c ? getComputedStyle(c) : null;
        const gl = c && c.__g64gl;
        return {
          path: iosCrtPath(),
          settled: isIosPaintSettled(),
          overlay: Boolean(root?.querySelector(".g64-ios-mirror")),
          live: root?.classList.contains("g64-ios-crt-live") ?? false,
          w: c?.width ?? 0,
          h: c?.height ?? 0,
          cw: c?.clientWidth ?? 0,
          ch: c?.clientHeight ?? 0,
          cssW: cs?.width ?? null,
          cssH: cs?.height ?? null,
          xf: cs?.transform ?? null,
          dbw: gl?.drawingBufferWidth ?? null,
          dbh: gl?.drawingBufferHeight ?? null,
          hidden: c ? cs.visibility === "hidden" || cs.opacity === "0" : true,
        };
      },
      media: () =>
        readMountedMedia(emuRef.current).map((m) => ({
          name: m.name,
          size: m.data.byteLength,
          disk: d64DiskName(m.data),
        })),
      fire: (down) => {
        if (playLockRef.current || useEmu.getState().booting) return;
        joyRef.current.fire = down;
        if (down) {
          joyRef.current.x = 0;
          joyRef.current.y = 0;
        }
        emitJoyRef.current(down);
      },
      stick: (x, y) => {
        joyRef.current.x = x;
        joyRef.current.y = y;
        setStickViz({ x, y });
        emitJoyRef.current();
      },
      load: async (path, name) => {
        const res = await fetch(path);
        const buf = await res.arrayBuffer();
        await playBufferRef.current(name, buf, { autostart: true, title: name });
        return true;
      },
      pad: () => useEmu.getState().padName,
      cartFreeze: () => cartFreeze(emuRef.current),
      cartReset: () => cartReset(emuRef.current),
      scpuReset: () => scpuReset(emuRef.current),
      cmdSwapped: () => cmdSwappedRef.current,
      cmdSwap: (next) => hwActionRef.current("cmd-swap", next === false ? "long" : "short"),
      sdSwap89: () => hwActionRef.current("sd-swap", "short"),
      hwPress: (id, press = "short") => hwActionRef.current(id, press),
      hwButtons: () =>
        visibleHwButtons({
          cart: cartLiveRef.current,
          sd2iec: mapHasDrive(useEmu.getState().iecMap, "sd2iec"),
          cmdhd: mapHasDrive(useEmu.getState().iecMap, "cmdhd"),
          scpu: useEmu.getState().machineId === "scpu",
        }).map((b) => b.id),
      setIecSlot: (unit, slot) => useEmu.getState().setIecSlot(unit, slot),
      iecMap: () => useEmu.getState().iecMap,
      resetReady: () => resetReadyRef.current?.(),
      setCartLive: (v) => {
        cartLiveRef.current = !!v;
        setCartLive(!!v);
      },
      sdFreeze: async (dir = 1) => {
        const parts = await listPartitions();
        const disks = parts.flatMap((p) =>
          p.files
            .filter((f) => /\.(d64|d71|d81|g64|g71)$/i.test(f.name))
            .map((f) => ({ name: f.name, data: new Uint8Array(f.data) })),
        );
        return sd2iecFreeze(emuRef.current, disks, dir as 1 | -1, sessionUnitRef.current);
      },
      plug: () => plugJoysticks(emuRef.current, useEmu.getState().joyPort),
      joyPort: () => useEmu.getState().joyPort,
      joy: () => ({ ...joyRef.current }),
      view: () => ({ ...readViewport(), dataOrient: document.documentElement.dataset.orient ?? null }),
      dispatchKey: (code, key, down) => dispatchC64Key(code, key, down),
      probe: () => {
        const emu = emuRef.current;
        const M = emu?.Module;
        const gm = emu?.gameManager;
        return {
          hasGm: Boolean(gm),
          sim: typeof gm?.simulateInput,
          fnSim: typeof gm?.functions?.simulateInput,
          raw: typeof M?._simulate_input,
          cwrap: typeof M?.cwrap,
          paused: emu?.paused ?? null,
          pads: [...(navigator.getGamepads?.() || [])].map((p) => p?.id ?? null),
          slot: emu?.gamepadSelection?.[0] ?? null,
          parent: Boolean(emu?.elements?.parent),
          value2: emu?.controls?.[0]?.[0]?.value2 ?? null,
          keys: M ? Object.keys(M).filter((k) => /simulat|input|joy|controller/i.test(k)).slice(0, 40) : [],
          cfg: (() => {
            try {
              const FS = gm?.FS ?? M?.FS;
              const raw = FS?.readFile?.("/home/web_user/.config/retroarch/retroarch.cfg", { encoding: "utf8" });
              return typeof raw === "string" ? raw.split("\n").filter((l) => /libretro_device|joypad|analog_dpad/.test(l)).slice(0, 12) : null;
            } catch {
              return null;
            }
          })(),
        };
      },
      opts: () => {
        try {
          const raw = emuRef.current?.gameManager?.getCoreOptions?.() ?? null;
          if (typeof raw === "string") {
            const pick = {};
            for (const line of raw.split(/[\n;|]/)) {
              const m = line.match(/(vice_[a-z0-9_]+)\s*[=:]\s*"?([^"|\n]+)/i);
              if (m) pick[m[1]] = m[2].trim();
            }
            return pick;
          }
          return raw;
        } catch {
          return null;
        }
      },
      canvasShot: () => {
        try {
          const c = shotDisplayCanvas(document.getElementById("grok64-player"));
          if (!c || c.width < 8) return null;
          const url = c.toDataURL("image/png");
          const b64 = url.split(",")[1] || "";
          return { b64, w: c.width, h: c.height, bytes: b64.length, mirror: c.classList.contains("g64-ios-mirror") };
        } catch {
          return null;
        }
      },
      shot: async () => {
        const pack = (u8, src) => {
          let bin = "";
          const n = Math.min(u8.byteLength, 5e5);
          for (let i = 0; i < n; i++) bin += String.fromCharCode(u8[i]);
          return { b64: btoa(bin), bytes: u8.byteLength, src };
        };
        try {
          const u8 = await emuRef.current?.gameManager?.screenshot?.();
          if (u8 && u8.byteLength > 2e3) return pack(u8, "vice");
        } catch {}
        try {
          const c = document.querySelector("#grok64-player canvas");
          if (c && c.width > 8 && c.height > 8) {
            const url = c.toDataURL("image/png");
            const b64 = url.split(",")[1] || "";
            return { b64, bytes: b64.length, src: "canvas" };
          }
        } catch {}
        return null;
      },
    };
    return () => {
      delete w.__g64;
    };
  }, []);
  useEffect(() => {
    if (debugQueryOn()) {
      useEmu.getState().setDebugLog(true);
      setDebugUi(true);
    }
  }, []);
  useEffect(() => {
    setDebugUi(s.debugLog || debugQueryOn());
  }, [s.debugLog]);
  useEffect(() => {
    if (!(s.debugLog || debugQueryOn())) {
      setLogLines([]);
      return;
    }
    return subscribeLog(setLogLines);
  }, [s.debugLog]);
  useEffect(() => {
    const quiet = /setImmediates|Wake Lock|NotAllowedError/i;
    const onErr = (ev) => {
      if (quiet.test(ev.message || "")) {
        ev.preventDefault();
        return;
      }
      glog("window.error", { m: ev.message, src: ev.filename });
    };
    const onRej = (ev) => {
      const m = String(ev.reason ?? "");
      if (quiet.test(m)) {
        ev.preventDefault();
        return;
      }
      glog("unhandled", { m });
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    glog("app-ready", { ua: navigator.userAgent.slice(0, 80) });
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  useEffect(() => {
    if (!s.powered) return;
    const id = window.setInterval(() => {
      const root = document.getElementById("grok64-player");
      if (!root) return;
      dismissEjsPrompts(root, useEmu.getState().booting ? "boot" : "play");
      const canvas = root.querySelector("canvas");
      if (canvas && canvas.clientWidth > 16 && !bootHoldRef.current && !playLockRef.current && emuRef.current) {
        useEmu.getState().setRunning(true);
      }
      if (canvas && (canvas.width < 64 || canvas.height < 64)) {
        fitEmu(root, emuRef.current);
      }
      if (isIosPhone() && emuRef.current && useEmu.getState().running && !isIosPaintSettled()) {
        presentIosCrt(emuRef.current, root, "running");
      }
      if (isIosPhone() && emuRef.current && useEmu.getState().running && !useEmu.getState().muted) {
        if (audioLocked(emuRef.current)) unlockAudio(emuRef.current);
      }
      if (!pendingKickRef.current) setAwaitingStart(false);
    }, 350);
    return () => window.clearInterval(id);
  }, [s.powered]);
  const persistNow = useCallback(async () => {
    if (!persistGateRef.current) return;
    const id = libIdRef.current;
    const emu = emuRef.current;
    if (!id || !emu) return;
    const file = await getFile(id);
    if (!file) return;
    const title = useEmu.getState().currentTitle;
    const workItem = isWorkDisk(file.name);
    if (title === "BASIC" && !workItem) return;
    if (workItem && title && title !== "BASIC") return;
    try {
      if (title !== "BASIC" && inGameplayRef.current) {
        const st = await captureState(emu);
        if (st && st.byteLength > 16) {
          await putSaveState(id, copyBuffer(st), title ?? file.name);
        }
      }
      const media = readMountedMedia(emu);
      const disk = media.find((m) => /\.(d64|d71|d81|g64|g71)$/i.test(m.name)) ?? media[0];
      if (!disk || disk.data.byteLength < 64) return;
      const dataIsWork = isWorkDiskImage(disk.data);
      if (workItem !== dataIsWork) return;
      await updateFileData(id, toArrayBuffer(disk.data));
    } catch {}
  }, []);
  const startIosAutoPaint = useCallback((onPainted?: () => void) => {
    if (isIosPaintSettled()) {
      onPainted?.();
      return;
    }
    const playerEl = document.getElementById("grok64-player");
    startIosPaintWatchdog(emuRef.current, playerEl, {
      onPainted: () => {
        setIosResume(false);
        onPainted?.();
      },
      onTimeout: () => {
        if (useEmu.getState().booting || playLockRef.current) return;
        glog("ios-resume-needed");
        setIosResume(true);
      },
    });
  }, []);
  const beginPlayLock = useCallback(
    (ms, msg) => {
      playLockGen.current += 1;
      const gen = playLockGen.current;
      const lockMs = isTouchMobile() ? playLockDuration(playModeRef.current) : ms;
      playLockRef.current = true;
      bootHoldRef.current = false;
      persistGateRef.current = false;
      inGameplayRef.current = false;
      clearMenuJoyInput();
      joyRef.current.fire = false;
      joyRef.current.x = 0;
      joyRef.current.y = 0;
      setJoyVector(emuRef.current, 0, 0, false);
      s.setRunning(true);
      s.setBooting(true, msg || "Loading…", 80);
      glog("play-lock", { ms: lockMs, msg, gen, ios: isIosPhone() });
      bootTimersRef.current.push(
        window.setTimeout(() => {
          if (playLockGen.current !== gen) return;
          playLockRef.current = false;
          fireArmedAt.current = Date.now() + 300;
          setWarp(emuRef.current, false);
          disarmAutostart(emuRef.current);
          s.setBooting(false);
          s.setRunning(true);
          plugJoysticks(emuRef.current, useEmu.getState().joyPort);
          inGameplayRef.current = true;
          clearMenuJoyInput();
          glog("play-unlock", { title: useEmu.getState().currentTitle, disarmed: true });
          persistGateRef.current = true;
          if (isIosPhone()) {
            const playerEl = document.getElementById("grok64-player");
            presentIosCrt(emuRef.current, playerEl, "play-unlock");
            startIosAutoPaint();
          }
        }, lockMs),
      );
      bootTimersRef.current.push(
        window.setTimeout(() => {
          if (playLockGen.current !== gen) return;
          inGameplayRef.current = true;
          clearMenuJoyInput();
        }, gameplayReadyDelay(lockMs)),
      );
    },
    [s, clearMenuJoyInput, startIosAutoPaint],
  );
  const syncJiffy = useCallback(
    async (emu: typeof emuRef.current, reset: "hard" | "soft" | "none" = "none") => {
      if (!emu) return false;
      const st = useEmu.getState();
      const on = await applyJiffyDos(emu, st.jiffyDos);
      if (reset === "hard") hardReset(emu);
      else if (reset === "soft") resetEmu(emu);
      return on;
    },
    [],
  );
  const resetReady = useCallback(() => {
    const emu = emuRef.current;
    glog("user-reset-ready", { prev: playModeRef.current, title: useEmu.getState().currentTitle });
    playModeRef.current = "basic";
    cartLiveRef.current = false;
    setCartLive(false);
    persistGateRef.current = false;
    pendingKickRef.current = false;
    playLockRef.current = false;
    bootHoldRef.current = false;
    inGameplayRef.current = true;
    setAwaitingStart(false);
    useEmu.getState().setCurrentTitle("BASIC");
    useEmu.getState().setBooting(false);
    applyRuntimeOptions(emu, {
      vice_autostart: "disabled",
      vice_autostart_warp: "disabled",
      vice_autoloadwarp: "disabled",
    });
    void (async () => {
      await syncJiffy(emu, "hard");
      if (isIosPhone()) {
        const playerEl = document.getElementById("grok64-player");
        fitEmu(playerEl, emu);
        presentIosCrt(emu, playerEl, "user-reset", true);
        scheduleIosCrtPresents(emu, playerEl, "user-reset");
      }
    })();
    toast.message("Reset — READY");
  }, [syncJiffy]);
  resetReadyRef.current = resetReady;
  const resumePlayback = useCallback(() => {
    unlockAudio(emuRef.current);
    const playerEl = document.getElementById("grok64-player");
    presentIosCrt(emuRef.current, playerEl, "resume", true);
    iosTapResumeCooldown();
    dismissEjsPrompts(playerEl, "play");
    s.setPaused(false);
    setPaused(emuRef.current, false);
    pendingKickRef.current = false;
    setAwaitingStart(false);
    setIosResume(false);
    glog("resumePlayback");
    void forceIosMirrorBlit(emuRef.current, playerEl, true).then(() => {
      setIosResume(false);
      startIosAutoPaint();
    });
  }, [s, startIosAutoPaint]);
  const kickIosAfterEmuAction = useCallback((emu: typeof emuRef.current, tag: string, gen?: number) => {
    if (!isIosPhone() || !emu) return;
    const playerEl = document.getElementById("grok64-player");
    fitEmu(playerEl, emu);
    stripIosOverlay(playerEl);
    presentIosCrt(emu, playerEl, tag);
    scheduleIosCrtPresents(emu, playerEl, tag);
    startIosAutoPaint(() => {
      if (gen != null && loadGenRef.current !== gen) return;
      if (playLockRef.current || bootHoldRef.current) return;
      useEmu.getState().setBooting(false);
      glog("ios-frame-ok", { tag });
    });
  }, [startIosAutoPaint]);
  const scheduleCracktroNudge = useCallback((title) => {
    if (!wantsCracktroNudge(title || "")) return;
    bootTimersRef.current.push(
      window.setTimeout(() => {
        glog("cracktro-nudge", { title });
        dispatchC64Key("Space", " ", true);
        window.setTimeout(() => dispatchC64Key("Space", " ", false), 90);
        window.setTimeout(() => {
          joyInput(emuRef.current, RETRO_BTN.B, true);
          joyInput(emuRef.current, RETRO_BTN.A, true);
          window.setTimeout(() => {
            joyInput(emuRef.current, RETRO_BTN.B, false);
            joyInput(emuRef.current, RETRO_BTN.A, false);
          }, 90);
        }, 220);
      }, 2200),
    );
  }, []);
  const settleAfterStart = useCallback(
    async (emu, gen, spec) => {
      const setBusy = (msg, p) => {
        if (loadGenRef.current !== gen) return;
        useEmu.getState().setBooting(true, msg, p);
      };
      setBusy("Loading VICE…", 22);
      const fsOk = await waitForCoreFs(emu, isIosPhone() ? 16000 : 10000);
      if (loadGenRef.current !== gen) return;
      if (!fsOk) glog("settle-no-fs");
      setBusy("ROMs · drives · REU…", 42);
      let parts = [];
      try {
        if (spec.user.iec === "sd2iec" || spec.live.iec === "sd2iec") {
          parts = await partitionsForMount();
        }
      } catch {
        /* optional card */
      }
      const st = useEmu.getState();
      const prep = await prepareCore(emu, {
        live: spec.live,
        user: spec.user,
        jiffyWant: st.jiffyDos,
        sdParts: parts,
        driveMap: st.iecMap,
      });
      if (loadGenRef.current !== gen) return;
      glog("core-ready", { ...prep, live: spec.live, user: spec.user, reu: st.reuSize });
      applyIecUnit(emu, spec.live.iec, spec.live.unit);
      applyRuntimeOptions(emu, {
        ...viceJoyOptions(st.joyPort),
        vice_ram_expansion_unit: st.reuSize === "none" && wantsLargeReu(spec.title || "") ? C64OS_REU : st.reuSize,
      });
      if (spec.live.iec === "1541" || spec.live.iec === "1581" || spec.live.iec === "cmdhd") {
        applyRuntimeOptions(emu, {
          vice_drive_true_emulation: "enabled",
          vice_virtual_device_traps: "disabled",
        });
      }
      const pending = pendingSnapshotRef.current;
      if (pending) {
        restoreState(emu, pending.data);
        pendingSnapshotRef.current = null;
      }
      plugJoysticks(emu, st.joyPort);
      unlockAudio(emu);
      setPaused(emu, false);
      try {
        emu.paused = false;
        emu.gameManager?.toggleMainLoop(1);
      } catch {}
      const playerEl = document.getElementById("grok64-player");
      fitEmu(playerEl, emu);
      s.setCurrentTitle(spec.title);
      pendingKickRef.current = false;
      setAwaitingStart(false);
      spec.onStarted?.(emu);
      if (spec.autostartAfterReady) {
        bootHoldRef.current = false;
        s.setRunning(true);
        setBusy(`Loading ${spec.title}…`, 78);
        if (isIosPhone()) await new Promise((r) => setTimeout(r, 140));
        if (loadGenRef.current !== gen) return;
        autostartAfterReady(emu, true, { autoloadWarp: playModeRef.current === "disk" ? false : undefined });
        applyIecUnit(emu, spec.live.iec, spec.live.unit);
        if (isIosPhone())     kickIosAfterEmuAction(emu, "settle", gen);
        beginPlayLock(playLockDuration(playModeRef.current), `Loading ${spec.title}…`);
        scheduleCracktroNudge(spec.title);
      } else {
        if (prep.jiffy) setBusy("Applying JiffyDOS…", 72);
        hardReset(emu);
        applyIecUnit(emu, spec.live.iec, spec.live.unit);
        bootHoldRef.current = false;
        s.setRunning(true);
        if (isIosPhone()) kickIosAfterEmuAction(emu, "settle", gen);
        bootTimersRef.current.push(
          window.setTimeout(() => {
            if (loadGenRef.current !== gen) return;
            useEmu.getState().setBooting(false);
            persistGateRef.current = true;
            inGameplayRef.current = true;
            clearMenuJoyInput();
            if (isIosPhone()) kickIosAfterEmuAction(emu, "ready", gen);
          }, isIosPhone() ? 900 : 500),
        );
      }
      glog("core-start", {
        title: spec.title,
        autostart: spec.autostartAfterReady,
        live: spec.live,
        user: spec.user,
        jiffy: prep.jiffy,
        reu: st.reuSize,
      });
    },
    [s, beginPlayLock, kickIosAfterEmuAction, clearMenuJoyInput, scheduleCracktroNudge],
  );
  const clearBootTimers = () => {
    for (const t of bootTimersRef.current) window.clearTimeout(t);
    bootTimersRef.current = [];
  };
  const releaseBlob = () => {
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
  };
  const startWithUrl = useCallback(
    async (gameUrl, gameName, opts = {}) => {
      loadGenRef.current += 1;
      const gen = loadGenRef.current;
      persistGateRef.current = false;
      inGameplayRef.current = false;
      clearBootTimers();
      let el = null;
      for (let i = 0; i < 40; i++) {
        el = document.getElementById("grok64-player");
        if (el) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!el) {
        persistGateRef.current = true;
        throw new Error("Display not ready");
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (el.clientWidth < 32 || el.clientHeight < 32) {
        const screen = el.parentElement;
        if (screen) {
          screen.style.minHeight = "220px";
          screen.style.minWidth = "280px";
        }
        for (let i = 0; i < 16; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          if (el.clientWidth >= 32 && el.clientHeight >= 32) break;
        }
      }
      const st = useEmu.getState();
      const res = resolveMachine(
        {
          machineId: st.machineId,
          videoStandard: st.videoStandard,
          coreMode: st.coreMode,
          driveMode: st.driveMode,
        },
        snapRef.current,
        softwareStdRef.current,
      );
      resolvedRef.current = res;
      pendingKickRef.current = false;
      setAwaitingStart(false);
      const playDrive = driveForPlay(res.drive, { typedDisk: !!opts.diskLoad || playModeRef.current === "disk" });
      const hz = res.standard === "ntsc" ? "NTSC 60" : "PAL 50";
      s.setBooting(true, opts.autostart === false ? `Cold start · ${hz}…` : `Loading ${opts.title ?? gameName} · ${hz}…`, 10);
      glog("boot-begin", {
        game: gameName,
        core: res.core,
        autostart: false,
        pw: el.clientWidth,
        ph: el.clientHeight,
        sw: el.parentElement?.clientWidth ?? 0,
        sh: el.parentElement?.clientHeight ?? 0,
      });
      if (emuRef.current) {
        stopIosPaintWatchdog();
        stopIosCrt();
        resetIosPaintState();
        await recycleCore(emuRef.current, el);
        emuRef.current = null;
        cmdSwappedRef.current = false;
        setCmdSwapped(false);
      } else {
        stopIosPaintWatchdog();
        stopIosCrt();
        resetIosPaintState();
        destroyEmu(null, el);
      }
      clearUnitMounts();
      bootHoldRef.current = opts.autostart === false;
      const wantsScpu = res.machineId === "scpu" || wantsSuperCpu(gameName);
      let core = res.core;
      let scpuActive = false;
      if (wantsScpu) {
        const hasScpu = await probeCore("vice_xscpu64");
        if (hasScpu) {
          core = "vice_xscpu64";
          scpuActive = true;
        } else {
          core = res.fallbackCore || "c64";
          toast.message("SuperCPU WASM isn't in EmulatorJS — staying on C64. REU still works.");
        }
      }
      if (wantsLargeReu(gameName) && st.reuSize === "none") {
        useEmu.getState().setReuSize(C64OS_REU);
        toast.message("16 MB REU on — real REU for C64 OS / Nuvie");
      }
      try {
        const emu = await bootEmulator(el, {
          gameUrl,
          gameName,
          core,
          machineOptions: res.options,
          sidEngine: st.sidEngine,
          sidModel: st.sidModel,
          driveMode: playDrive,
          joyPort: st.joyPort,
          volume: st.muted ? 0 : st.volume,
          autostart: false,
          reu: wantsLargeReu(gameName) && st.reuSize === "none" ? C64OS_REU : st.reuSize,
          iec: opts.iec ?? sessionIecRef.current ?? st.iecDrive,
          iecUnit: opts.iecUnit ?? sessionUnitRef.current ?? st.iecUnit,
          mouse: st.mouseMode,
          scpu: scpuActive,
          scpuSimm: st.scpuSimm,
          scpuTurbo: st.scpuTurbo,
          jiffy: false,
          onStart: () => {
            if (loadGenRef.current !== gen) return;
            bootPathRef.current = bootFileOf(emu) || gameName;
            applyRuntimeOptions(emu, {
              vice_autostart: "disabled",
              vice_autostart_warp: "disabled",
              vice_autoloadwarp: "disabled",
              ...(opts.diskLoad || playModeRef.current === "disk"
                ? {
                    vice_drive_true_emulation: "enabled",
                    vice_virtual_device_traps: "disabled",
                  }
                : {}),
            });
            void settleAfterStart(emu, gen, {
              title: opts.title ?? gameName,
              autostartAfterReady: opts.autostart !== false && playModeRef.current !== "basic",
              live: {
                iec: opts.iec ?? sessionIecRef.current ?? useEmu.getState().iecDrive,
                unit: opts.iecUnit ?? sessionUnitRef.current ?? useEmu.getState().iecUnit,
              },
              user: {
                iec: opts.userIec ?? useEmu.getState().iecDrive,
                unit: opts.userUnit ?? useEmu.getState().iecUnit,
              },
              onStarted: opts.onStarted,
            });
          },
          onError: (msg) => {
            if (loadGenRef.current === gen) persistGateRef.current = true;
            bootKickRef.current = false;
            s.setBooting(false);
            glog("ejs-error", { m: msg });
            toast.error(msg);
          },
        });
        emuRef.current = emu;
      } catch (err) {
        persistGateRef.current = true;
        bootKickRef.current = false;
        glog("boot-throw", { m: err instanceof Error ? err.message : String(err) });
        if (res.fallbackCore && res.core !== res.fallbackCore) {
          toast.message(`${res.label} WASM missing — using C64`);
          s.setMachine("c64-auto");
        }
        s.setBooting(false, "");
        toast.error(err instanceof Error ? err.message : "Emulator failed to start");
        throw err;
      }
    },
    [s, beginPlayLock, settleAfterStart],
  );
  const playBuffer = useCallback(
    async (filename, data, opts = {}) => {
      await persistNow();
      libIdRef.current = opts.libraryId ?? null;
      playPayloadRef.current = { filename, data, opts };
      const playUnit = opts.iecUnit ?? useEmu.getState().iecUnit;
      setIecDevice(playUnit);
      let payload = data;
      let bootName = bootFileName(filename, kindOf(filename));
      const raw = new Uint8Array(data);
      const work = isWorkDisk(filename) || opts.title === "BASIC" || opts.title === "BASIC READY";
      if (!work && isWorkDiskImage(raw)) {
        if (opts.libraryId) {
          await removeFile(opts.libraryId);
          s.setLibrary(await listLibrary());
        }
        toast.error("That copy is empty. Grab the game again from Catalog.");
        return;
      }
      const detected = work ? null : detectSoftwareStandard({ names: [filename, opts.title], data: raw });
      softwareStdRef.current = detected;
      setSoftwareStd(detected);
      if (kindOf(filename) === "sid" || isSid(raw)) {
        try {
          const prg = psidToPrg(raw);
          payload = toArrayBuffer(prg);
          bootName = bootFileName(filename.replace(/\.sid$/i, "") + ".prg", "prg");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not play SID");
          return;
        }
      }
      releaseBlob();
      let safe;
      try {
        safe = copyBuffer(payload);
      } catch {
        toast.error("That file could not be read. Save it again from Catalog.");
        return;
      }
      if (safe.byteLength < 2) {
        toast.error("That file is empty.");
        return;
      }
      const origKind = kindOf(bootName);
      const diskLoad = !work && needsTypedBoot(origKind) && opts.autostart === false;
      const user = userAttachFromMap(useEmu.getState().iecMap);
      const userIec = user.iec;
      const userUnit = user.unit;
      const liveIec = sessionIecRef.current;
      const liveWork = lastAppliedWorkDisk();
      const jiffyWant = useEmu.getState().jiffyDos;
      const jiffyLive = lastAppliedJiffy();
      const plan = planPlay({
        filename: bootName,
        work,
        userIec,
        userUnit,
        liveIec,
        liveWorkDisk: liveWork,
        autostart: opts.autostart !== false,
        iosPhone: isIosPhone(),
        jiffyWant,
        jiffyLive,
      });
      playModeRef.current = plan.kind === "floppy" ? "disk" : plan.kind === "basic" ? "basic" : "auto";
      cartLiveRef.current = plan.kind === "cart";
      setCartLive(plan.kind === "cart");
      sessionIecRef.current = plan.live.iec;
      sessionUnitRef.current = plan.live.unit;
      const attach = plan.attach;
      // Hard lock: CriOS never enters the hot-swap branch, even if the plan
      // is stale. Tom's #35 log is always hot-swap → DEVICE NOT PRESENT.
      const canHotSwap = !plan.recycle && !isIosPhone();
      if (plan.recycle || isIosPhone()) {
        const reason = isIosPhone()
          ? "ios-floppy"
          : userIec === "sd2iec" && liveIec !== "sd2iec"
            ? "user-sd2iec"
            : jiffyWant && !jiffyLive
              ? "jiffy-kernal"
              : "fs-drive";
        glog("play-recycle", {
          reason,
          from: liveIec,
          work: liveWork,
          iec: plan.live.iec,
          unit: plan.live.unit,
          user: plan.user,
          jiffyWant,
          jiffyLive,
        });
      }
      glog("play", {
        filename,
        kind: origKind,
        diskLoad,
        work,
        bytes: safe.byteLength,
        iec: sessionIecRef.current,
        unit: sessionUnitRef.current,
        userIec,
        userUnit,
        fromIec: liveIec,
        fromWork: liveWork,
        canHotSwap,
        recycle: plan.recycle,
        jiffyWant,
        jiffyLive,
        ios: isIosPhone(),
      });
      if (work) workDiskBytesRef.current = new Uint8Array(safe);
      if (!work && opts.libraryId) {
        await deleteSaveState(opts.libraryId);
      }
      if (emuRef.current && !coreHasFs(emuRef.current)) {
        s.setBooting(true, "Waiting for VICE…");
        const t0 = Date.now();
        while (Date.now() - t0 < 8e3 && !coreHasFs(emuRef.current)) {
          await new Promise((r) => setTimeout(r, 80));
        }
      }
      const title = opts.title ?? filename;
      const assigned = detectJoyPort({ names: [filename, title] });
      const prevPort = useEmu.getState().joyPort;
      if (prevPort !== assigned) {
        useEmu.getState().setJoyPort(assigned);
        glog("joy-autoplug", { port: assigned, filename, title });
        toast.message(`Joystick → Port ${assigned}`);
      }
      if (emuRef.current) {
        applyRuntimeOptions(emuRef.current, viceJoyOptions(assigned));
        plugJoysticks(emuRef.current, assigned);
      }
      const live = Boolean(emuRef.current && coreHasFs(emuRef.current));
      let media = new Uint8Array(safe);
      if (origKind === "d64") {
        media = prepareAutostartDisk(media, bootName, title);
      }
      const wrapped = wrapForDiskSwap(origKind, media, bootName);
      if (live && canHotSwap && emuRef.current && (wrapped || origKind === "d64")) {
        const payloadDisk = wrapped ?? media;
        const playIec = attach?.iec ?? plan.live.iec;
        const playAttachUnit = attach?.unit ?? plan.live.unit;
        s.setBooting(true, plan.status, 35);
        const wrote = attach
          ? attachAutostartDisk(emuRef.current, payloadDisk, bootName, playIec, playAttachUnit)
          : swapBootDisk(emuRef.current, payloadDisk, bootName);
        if (wrote) {
          glog("hot-swap", {
            filename,
            title,
            kind: origKind,
            iec: sessionIecRef.current,
            unit: sessionUnitRef.current,
            workDisk: workDiskFor(sessionIecRef.current, sessionUnitRef.current),
          });
          persistGateRef.current = false;
          inGameplayRef.current = false;
          pendingKickRef.current = false;
          setAwaitingStart(false);
          clearBootTimers();
          clearRetroSaves(emuRef.current);
          const stNow = useEmu.getState();
          const resNow = resolveMachine(
            {
              machineId: stNow.machineId,
              videoStandard: stNow.videoStandard,
              coreMode: stNow.coreMode,
              driveMode: stNow.driveMode,
            },
            snapRef.current,
            detected,
          );
          resolvedRef.current = resNow;
          applyRuntimeOptions(emuRef.current, {
            ...videoStandardOptions(
              {
                machineId: stNow.machineId,
                videoStandard: stNow.videoStandard,
                coreMode: stNow.coreMode,
                driveMode: stNow.driveMode,
              },
              resNow.standard,
            ),
            vice_autostart: "disabled",
            vice_autostart_warp: "disabled",
            vice_autoloadwarp: "disabled",
            vice_reset: "hard",
            vice_ram_expansion_unit: stNow.reuSize,
            ...(attach
              ? {
                  vice_work_disk: workDiskFor(playIec, playAttachUnit),
                  vice_drive_true_emulation: "enabled",
                  vice_virtual_device_traps: "disabled",
                }
              : {}),
            ...viceJoyOptions(useEmu.getState().joyPort),
          });
          if (attach) applyIecUnit(emuRef.current, playIec, playAttachUnit);
          const flushed = await flushEmuFs(emuRef.current, isIosPhone() ? 2000 : 800);
          glog("play-mount", { flushed, workDisk: lastAppliedWorkDisk(), ios: isIosPhone() });
          await prepareCore(emuRef.current, {
            live: plan.live,
            user: plan.user,
            jiffyWant: stNow.jiffyDos,
            skipJiffy: true,
            driveMap: stNow.iecMap,
          });
          applyIecUnit(emuRef.current, playIec, playAttachUnit);
          plugJoysticks(emuRef.current, useEmu.getState().joyPort);
          if (isIosPhone()) resetIosPaintState();
          s.setCurrentTitle(title);
          s.setRunning(true);
          if (work) {
            hardReset(emuRef.current);
            playLockRef.current = false;
            bootHoldRef.current = false;
            bootTimersRef.current.push(
              window.setTimeout(() => {
                persistGateRef.current = true;
                inGameplayRef.current = true;
                clearMenuJoyInput();
                useEmu.getState().setBooting(false);
              }, 800),
            );
          } else {
            autostartAfterReady(emuRef.current, true, { autoloadWarp: false });
            applyIecUnit(emuRef.current, playIec, playAttachUnit);
            if (isIosPhone()) kickIosAfterEmuAction(emuRef.current, "hot-swap");
            beginPlayLock(playLockDuration(playModeRef.current), `Loading ${title}…`);
            scheduleCracktroNudge(title);
          }
          return;
        }
      }
      const blob = new Blob([toArrayBuffer(media)]);
      const url = URL.createObjectURL(blob);
      blobRef.current = url;
      await startWithUrl(url, bootName, {
        autostart: plan.autostartAfterReady,
        diskLoad: plan.kind === "floppy" || diskLoad,
        title,
        iec: plan.live.iec,
        iecUnit: plan.live.unit,
        userIec: plan.user.iec,
        userUnit: plan.user.unit,
      });
    },
    [s, persistNow, startWithUrl, beginPlayLock, syncJiffy, scheduleCracktroNudge],
  );
  playBufferRef.current = playBuffer;
  const playBundled = useCallback(
    async (title) => {
      try {
        s.setLibraryOpen(false);
        const res = await fetch(publicUrl(title.path));
        if (!res.ok) throw new Error("Could not load bundled software");
        const buf = await res.arrayBuffer();
        const name = title.path.split("/").pop() || title.name;
        await playBuffer(name, buf, { autostart: true, title: title.name });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Load failed");
      }
    },
    [playBuffer, s],
  );
  const playLocal = useCallback(
    async (item) => {
      s.setLibraryOpen(false);
      const file = await getFile(item.id);
      if (!file) {
        toast.error("That file is missing.");
        return;
      }
      await playBuffer(file.name, file.data, {
        autostart: true,
        title: item.name,
        libraryId: item.id,
        iecUnit: item.iecUnit,
      });
      await touchPlayed(item.id);
    },
    [playBuffer, s],
  );
  const insertDisk = useCallback(async (item) => {
    const file = await getFile(item.id);
    if (!file) {
      toast.error("Missing disk");
      return;
    }
    const raw = new Uint8Array(file.data);
    const kind = kindOf(file.name);
    const media = wrapForDiskSwap(kind, raw, file.name) ?? (isDiskKind(kind) ? raw : null);
    if (!media) {
      toast.error("Can't insert that as a disk");
      return;
    }
    if (!emuRef.current || !coreHasFs(emuRef.current)) {
      toast.error("Power on first, then insert the next disk.");
      return;
    }
    const unit = item.iecUnit ?? useEmu.getState().iecUnit;
    const iec = useEmu.getState().iecDrive;
    const ok = mountDiskOnUnit(emuRef.current, unit, media, bootFileName(file.name, kind), iec);
    if (!ok) {
      toast.error("Could not mount that disk");
      return;
    }
    await touchPlayed(item.id);
    const label = d64DiskName(media) ?? item.name.replace(/\.[a-z0-9]{2,4}$/i, "");
    toast.success(`Inserted ${label} on drive ${unit}`);
  }, []);
  const toggleWarp = useCallback(() => {
    const next = !useEmu.getState().warped;
    useEmu.getState().setWarped(next);
    setWarp(emuRef.current, next);
  }, []);
  const powerOn = useCallback(() => {
    const st = useEmu.getState();
    if (st.powered && (coreHasFs(emuRef.current) || bootKickRef.current)) {
      if (st.booting) dismissEjsPrompts(document.getElementById("grok64-player"), "boot");
      else resumePlayback();
      return;
    }
    bootKickRef.current = true;
    pokeAudioUnlock();
    const plan = planPlay({
      filename: "WORK DISK.D64",
      work: true,
      userIec: st.iecDrive,
      userUnit: st.iecUnit,
      liveIec: st.iecDrive,
      liveWorkDisk: null,
      autostart: false,
    });
    playModeRef.current = "basic";
    sessionIecRef.current = plan.live.iec;
    sessionUnitRef.current = plan.live.unit;
    cmdSwappedRef.current = false;
    setCmdSwapped(false);
    st.setBooting(true, plan.status, 6);
    st.powerOn();
    glog("power-on", { ua: navigator.userAgent.slice(0, 80), live: plan.live, user: plan.user });
    void startWithUrl(publicUrl("/software/blank.d64"), "WORK DISK.D64", {
      autostart: false,
      title: "BASIC",
      iec: plan.live.iec,
      iecUnit: plan.live.unit,
      userIec: plan.user.iec,
      userUnit: plan.user.unit,
    })
      .then(() => {
        void ensureWorkDisk()
          .then(async (disk) => {
            libIdRef.current = disk.id;
            st.setLibrary(await listLibrary());
          })
          .catch(() => undefined);
      })
      .catch((err) => {
        bootKickRef.current = false;
        glog("power-fail", { m: err instanceof Error ? err.message : String(err) });
        toast.error(err instanceof Error ? err.message : "Boot failed");
      });
  }, [startWithUrl, resumePlayback]);
  powerOnRef.current = powerOn;
  const recoverBoot = useCallback(() => {
    const st = useEmu.getState();
    if (
      !shouldRecoverBoot({
        playMode: playModeRef.current,
        playLock: playLockRef.current,
        inGameplay: inGameplayRef.current,
        powered: st.powered,
        hasFs: Boolean(emuRef.current && coreHasFs(emuRef.current)),
      })
    ) {
      if (st.powered && playModeRef.current !== "basic") {
        glog("boot-recover-skipped", { mode: playModeRef.current, lock: playLockRef.current });
      }
      return;
    }
    if (bootKickRef.current) return;
    glog("boot-recover", { booting: st.booting, running: st.running });
    const plan = planPlay({
      filename: "WORK DISK.D64",
      work: true,
      userIec: st.iecDrive,
      userUnit: st.iecUnit,
      liveIec: st.iecDrive,
      liveWorkDisk: null,
      autostart: false,
    });
    playModeRef.current = "basic";
    sessionIecRef.current = plan.live.iec;
    sessionUnitRef.current = plan.live.unit;
    st.setRunning(false);
    st.setBooting(true, "Starting Commodore 64…", 8);
    bootKickRef.current = true;
    void startWithUrl(publicUrl("/software/blank.d64"), "WORK DISK.D64", {
      autostart: false,
      title: "BASIC",
      iec: plan.live.iec,
      iecUnit: plan.live.unit,
      userIec: plan.user.iec,
      userUnit: plan.user.unit,
    }).catch((err) => {
      bootKickRef.current = false;
      glog("boot-recover-fail", { m: err instanceof Error ? err.message : String(err) });
      useEmu.setState({ powered: false, booting: false, running: false });
      toast.error("The C64 didn’t start. Tap power to try again.");
    });
  }, [startWithUrl]);
  useEffect(() => {
    const t = window.setTimeout(() => recoverBoot(), 80);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (s.powered) return;
    const el = splashRef.current;
    if (!el) return;
    const go = (ev) => {
      if (ev.type === "keydown") {
        const key = ev.key;
        if (key !== "Enter" && key !== " ") return;
        ev.preventDefault();
      }
      powerOnRef.current();
    };
    el.addEventListener("pointerdown", go, { capture: true });
    el.addEventListener("touchstart", go, { capture: true, passive: false });
    el.addEventListener("click", go, { capture: true });
    el.addEventListener("keydown", go);
    return () => {
      el.removeEventListener("pointerdown", go, true);
      el.removeEventListener("touchstart", go, true);
      el.removeEventListener("click", go, true);
      el.removeEventListener("keydown", go);
    };
  }, [s.powered]);
  useEffect(() => {
    if (!s.powered || !s.booting) return;
    const warn = window.setTimeout(() => {
      if (!useEmu.getState().booting) return;
      if (playLockRef.current || coreHasFs(emuRef.current)) return;
      useEmu.getState().setBooting(true, "Still loading… this can take a bit on iPhone", 16);
    }, 8000);
    const id = window.setTimeout(() => {
      if (!useEmu.getState().booting) return;
      if (playLockRef.current) return;
      if (coreHasFs(emuRef.current)) {
        useEmu.getState().setBooting(false);
        useEmu.getState().setRunning(true);
        return;
      }
      if (playModeRef.current !== "basic" || inGameplayRef.current) {
        glog("boot-stuck-skipped", { mode: playModeRef.current });
        useEmu.getState().setBooting(false);
        return;
      }
      dismissEjsPrompts(document.getElementById("grok64-player"), "boot");
      glog("boot-stuck");
      if (!recoverOnceRef.current) {
        recoverOnceRef.current = true;
        recoverBoot();
        return;
      }
      useEmu.setState({ powered: false, booting: false, running: false, bootProgress: 0 });
      toast.error("The C64 didn’t start. Tap power to try again.");
    }, isIosPhone() ? 45000 : 20000);
    return () => {
      window.clearTimeout(warn);
      window.clearTimeout(id);
    };
  }, [s.powered, s.booting, recoverBoot]);
  useEffect(() => {
    if (!s.powered || !isIosPhone()) return;
    if (isIosPaintSettled()) return;
    const playerEl = document.getElementById("grok64-player");
    if (!s.booting && !s.running) return;
    if (s.booting || (s.running && !isIosPaintSettled())) {
      presentIosCrt(emuRef.current, playerEl, s.booting ? "booting" : "running");
      startIosAutoPaint(() => {
        if (bootHoldRef.current || playLockRef.current) return;
        useEmu.getState().setBooting(false);
      });
    }
  }, [s.powered, s.booting, s.running, startIosAutoPaint]);
  useEffect(() => {
    if (!s.running) return;
    const kick = () => {
      fitEmu(document.getElementById("grok64-player"), emuRef.current);
    };
    const a = window.setTimeout(kick, 80);
    return () => {
      window.clearTimeout(a);
    };
  }, [s.running]);
  useEffect(() => {
    if (s.paused) void persistNow();
  }, [s.paused, persistNow]);
  useEffect(() => {
    if (!s.running) return;
    persistTimer.current = window.setInterval(() => void persistNow(), 2e4);
    const vis = () => {
      if (document.hidden) void persistNow();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      if (persistTimer.current) window.clearInterval(persistTimer.current);
      document.removeEventListener("visibilitychange", vis);
      void persistNow();
    };
  }, [s.running, persistNow]);
  useEffect(() => {
    return () => {
      destroyEmu(emuRef.current, document.getElementById("grok64-player"));
      releaseBlob();
    };
  }, []);
  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === "visible") {
        if (audioLocked(emuRef.current)) unlockAudio(emuRef.current);
        pokeAudioUnlock();
      } else {
        suspendAudio(emuRef.current);
      }
    };
    document.addEventListener("visibilitychange", vis);
    const unlock = () => {
      if (audioLocked(emuRef.current)) unlockAudio(emuRef.current);
    };
    window.addEventListener("g64-unlock", unlock);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("g64-unlock", unlock);
    };
  }, []);
  const onJump = useCallback((down: boolean) => {
    const st = useEmu.getState();
    if (playLockRef.current || st.booting || !st.running) {
      jumpHeldRef.current = false;
      return;
    }
    jumpHeldRef.current = down;
    emitJoyVector();
  }, [emitJoyVector]);
  useEffect(() => {
    stickPrecisionRef.current.precision = s.stickGate === "4way";
    resetStickPrecision(stickPrecisionRef.current);
  }, [s.stickGate]);
  useEffect(() => {
    stickPrecisionRef.current.periodMs = frameMsForStandard(resolved.standard);
  }, [resolved.standard]);
  const onVector = useCallback((x: number, y: number, centerHold?: boolean) => {
    unlockAudio(emuRef.current);
    if (playLockRef.current || useEmu.getState().booting) return;
    if (typeof centerHold === "boolean") stickCenterHoldRef.current = centerHold;
    setPaused(emuRef.current, false);
    try {
      emuRef.current && (emuRef.current.paused = false);
    } catch {}
    joyRef.current.x = x;
    joyRef.current.y = y;
    setStickViz({ x, y });
    emitJoyVector();
  }, [emitJoyVector]);
  const onFire = useCallback((down, clearStick = false) => {
    const st = useEmu.getState();
    unlockAudio(emuRef.current);
    if (playLockRef.current || st.booting || !st.running) {
      if (down) glog("fire-blocked", { booting: st.booting, lock: playLockRef.current, running: st.running, title: st.currentTitle });
      return;
    }
    glogFire(down, { title: st.currentTitle, hasGm: Boolean(emuRef.current?.gameManager) });
    joyRef.current.fire = down;
    if (down && clearStick) {
      joyRef.current.x = 0;
      joyRef.current.y = 0;
      setStickViz({ x: 0, y: 0 });
    }
    emitJoyVector(down);
  }, [emitJoyVector]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const emu = emuRef.current;
      if (!emu) return;
      /* Real SD2IEC/CMD — no KERNAL SoftIEC hooks. */
      const st = useEmu.getState();
      if (st.mouseMode && !playLockRef.current && !st.booting && st.running) {
        const v = mouseVelRef.current;
        const b = mouseBtnRef.current;
        setMouseAnalog(emu, v.x, v.y, b.left, b.right);
        mouseVelRef.current.x *= 0.72;
        mouseVelRef.current.y *= 0.72;
        if (Math.abs(mouseVelRef.current.x) < 0.01) mouseVelRef.current.x = 0;
        if (Math.abs(mouseVelRef.current.y) < 0.01) mouseVelRef.current.y = 0;
      } else if (st.mouseMode) {
        clearMouseAnalog(emu);
      } else {
        emitJoyVector();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [emitJoyVector]);
  const expansionOpts = useCallback(() => {
    const st = useEmu.getState();
    return buildViceExtras({
      reu: st.reuSize,
      iec: sessionIecRef.current,
      iecUnit: sessionUnitRef.current,
      mouse: st.mouseMode,
      joyPort: st.joyPort,
      scpu: st.machineId === "scpu",
      scpuSimm: st.scpuSimm,
      scpuTurbo: st.scpuTurbo,
      jiffy: st.jiffyDos,
    });
  }, []);
  const runHwAction = useCallback(async (action: string) => {
    const running = Boolean(emuRef.current && useEmu.getState().running);
    if (action === "cart-freeze") {
      if (!running) {
        toast.message("Power on first — cart freeze needs a freezer cart");
        return;
      }
      const ok = cartFreeze(emuRef.current);
      glog("cart-freeze", { ok });
      toast.message(ok ? "Cart freeze" : "Cart freeze not ready");
      return;
    }
    if (action === "cart-reset") {
      if (!running) {
        toast.message("Power on first — cart RESET");
        return;
      }
      const ok = cartReset(emuRef.current);
      glog("cart-reset", { ok });
      toast.message(ok ? "Cart RESET" : "Cart RESET not ready");
      return;
    }
    if (action === "scpu-reset") {
      if (!running) {
        toast.message("Power on first — SuperCPU RESET");
        return;
      }
      const ok = scpuReset(emuRef.current);
      glog("scpu-reset", { ok });
      toast.message(ok ? "SuperCPU RESET" : "SuperCPU RESET not ready");
      return;
    }
    if (action === "sd2iec-next" || action === "sd2iec-prev") {
      if (!running) {
        toast.message("Power on first — SD2IEC freeze swaps the next image");
        return;
      }
      const dir = action === "sd2iec-prev" ? -1 : 1;
      const parts = await listPartitions();
      const disks = parts.flatMap((p) =>
        p.files
          .filter((f) => /\.(d64|d71|d81|g64|g71)$/i.test(f.name))
          .map((f) => ({ name: f.name, data: new Uint8Array(f.data) })),
      );
      const result = sd2iecFreeze(emuRef.current, disks, dir, sessionUnitRef.current);
      glog("sd2iec-freeze", { ...result, dir });
      if (result.ok && result.count > 1) {
        toast.message(`SD2IEC disk ${result.index + 1}/${result.count}`);
      } else if (result.ok) {
        toast.message("SD2IEC freeze — only one image mounted");
      } else {
        toast.message("SD2IEC freeze — add disk images on the card");
      }
      return;
    }
    if (action === "sd2iec-swap89" || action === "sd2iec-unit8") {
      if (!useEmu.getState().powered) {
        toast.message("Power on first — SD2IEC SWAP 8/9");
        return;
      }
      const next =
        action === "sd2iec-unit8" ? 8 : sd2iecSwapUnit(sessionUnitRef.current);
      const result = sd2iecSwapDevice(emuRef.current, next);
      sessionUnitRef.current = result.unit;
      setSdUnit(result.unit);
      setIecDevice(result.unit);
      glog("sd2iec-swap89", result);
      toast.message(`SD2IEC device #${result.unit}`);
      return;
    }
    if (action === "cmd-swap" || action === "cmd-unswap") {
      const home = useEmu.getState().iecUnit;
      if (useEmu.getState().iecDrive !== "cmdhd") {
        toast.message("CMD HD off — tap CMD to attach the drive first");
        return;
      }
      if (!useEmu.getState().powered) {
        toast.message("Power on first — CMD SWAP exchanges with #8");
        return;
      }
      const nextSwapped = action === "cmd-unswap" ? false : !cmdSwappedRef.current;
      const result = cmdHdSwap(emuRef.current, home, nextSwapped);
      cmdSwappedRef.current = result.swapped;
      setCmdSwapped(result.swapped);
      sessionIecRef.current = "cmdhd";
      sessionUnitRef.current = result.cmd;
      glog("cmd-swap", result);
      toast.message(
        result.swapped
          ? `CMD SWAP — HD is now #${result.cmd}, floppy #${result.floppy}`
          : `CMD SWAP off — HD #${result.cmd}, 1541 #${result.floppy}`,
      );
    }
  }, []);
  hwActionRef.current = (id, press) => {
    const spec = hwButtonById(id);
    if (!spec) return;
    void runHwAction(actionForPress(spec, press));
  };
  const swapJoyPort = useCallback(() => {
    const st = useEmu.getState();
    const next = st.joyPort === 2 ? 1 : 2;
    st.setJoyPort(next);
    applyRuntimeOptions(emuRef.current, expansionOpts());
    plugJoysticks(emuRef.current, next);
    glog("port-swap", { next, mouse: st.mouseMode });
    toast.message(st.mouseMode ? `Mouse → Port ${next}` : `Joystick → Port ${next}`);
  }, [expansionOpts]);
  useEffect(() => {
    if (playModeRef.current === "disk") return;
    const plan = planPlay({
      filename: "WORK DISK.D64",
      work: true,
      userIec: s.iecDrive,
      userUnit: s.iecUnit,
      liveIec: s.iecDrive,
      liveWorkDisk: lastAppliedWorkDisk(),
      autostart: false,
    });
    sessionIecRef.current = plan.live.iec;
    sessionUnitRef.current = plan.live.unit;
    setSdUnit(plan.live.unit);
    cmdSwappedRef.current = false;
    setCmdSwapped(false);
  }, [s.iecDrive, s.iecUnit]);
  useEffect(() => {
    const emu = emuRef.current;
    if (playLockRef.current || playModeRef.current === "disk" || inGameplayRef.current) {
      applyRuntimeOptions(emu, {
        ...viceJoyOptions(s.joyPort),
        vice_ram_expansion_unit: s.reuSize,
      });
      if (s.mouseMode) plugJoysticks(emu, s.joyPort);
      return;
    }
    const extras = expansionOpts();
    extras.vice_ram_expansion_unit = s.reuSize;
    applyRuntimeOptions(emu, extras);
    void syncJiffy(emu, "none");
    if (s.mouseMode) plugJoysticks(emu, s.joyPort);
  }, [s.reuSize, s.iecDrive, s.iecUnit, s.mouseMode, s.joyPort, s.machineId, s.scpuSimm, s.scpuTurbo, expansionOpts, syncJiffy]);
  useEffect(() => {
    if (!emuRef.current || !useEmu.getState().running) return;
    if (playLockRef.current || playModeRef.current === "disk" || inGameplayRef.current) return;
    useEmu.getState().setBooting(true, s.jiffyDos ? "Applying JiffyDOS…" : "JiffyDOS off…", 60);
    void (async () => {
      const on = await syncJiffy(emuRef.current, "hard");
      useEmu.getState().setBooting(false);
      if (isIosPhone()) {
        const playerEl = document.getElementById("grok64-player");
        presentIosCrt(emuRef.current, playerEl, "jiffy");
        scheduleIosCrtPresents(emuRef.current, playerEl, "jiffy");
      }
      if (on) toast.message("JiffyDOS applied — real KERNAL + 1541 ROMs");
      else if (s.jiffyDos) toast.error("JiffyDOS ROMs did not land — stock KERNAL");
    })();
  }, [s.jiffyDos, syncJiffy]);
  useEffect(() => {
    setIecDevice(sessionUnitRef.current);
  }, [s.iecUnit]);
  useEffect(() => {
    const binds = s.binds;
    const setPadName = s.setPadName;
    let raf = 0;
    const prev = new Map();
    const dead = 0.35;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const pads = listRealGamepads();
      const pad = pads[0] ?? null;
      const named = useEmu.getState().padName;
      if (pad && named !== pad.id) setPadName(pad.id);
      else if (!pad && named) setPadName(null);
      if (!pad || !emuRef.current) return;
      if (playLockRef.current || useEmu.getState().booting) return;
      const menuJoy = isMenuJoyMode();
      const pressed = (action, on) => {
        const key = action;
        if (prev.get(key) === on) return;
        prev.set(key, on);
        const map = {
          up: RETRO_BTN.UP,
          down: RETRO_BTN.DOWN,
          left: RETRO_BTN.LEFT,
          right: RETRO_BTN.RIGHT,
          fire: RETRO_BTN.B,
          fire2: RETRO_BTN.A,
        };
        const dirAction = action === "up" || action === "down" || action === "left" || action === "right";
        if (map[action] != null && (!menuJoy || !dirAction)) joyInput(emuRef.current, map[action], on);
        if (action === "fire") {
          joyRef.current.fire = on;
          emitJoyVector(on);
        }
        if (action === "space") dispatchC64Key("Space", " ", on);
        if (action === "runstop") dispatchC64Key("Escape", "Escape", on);
        if (action === "commodore") dispatchC64Key("Tab", "Tab", on);
        if (action === "return") dispatchC64Key("Enter", "Enter", on);
      };
      for (const b of binds) {
        let on = b.padButtons.some((i) => pad.buttons[i]?.pressed);
        for (const ax of b.padAxes) {
          const v = pad.axes[ax.axis] ?? 0;
          if (ax.dir < 0 && v < -dead) on = true;
          if (ax.dir > 0 && v > dead) on = true;
        }
        pressed(b.action, on);
      }
      const up = prev.get("up");
      const down = prev.get("down");
      const left = prev.get("left");
      const right = prev.get("right");
      const x = (right ? 1 : 0) - (left ? 1 : 0);
      const y = (down ? 1 : 0) - (up ? 1 : 0);
      if (joyRef.current.x !== x || joyRef.current.y !== y) {
        joyRef.current.x = x;
        joyRef.current.y = y;
        setStickViz({ x, y });
      }
      emitJoyVector();
    };
    raf = requestAnimationFrame(tick);
    const connect = (e) => {
      const id = e.gamepad?.id;
      if (id && id !== "Grok64 Touch") s.setPadName(id);
    };
    const disconnect = () => {
      if (!hasRealGamepad()) {
        s.setPadName(null);
        joyRef.current.x = 0;
        joyRef.current.y = 0;
        setStickViz({ x: 0, y: 0 });
        emitJoyVector();
      }
    };
    window.addEventListener("gamepadconnected", connect);
    window.addEventListener("gamepaddisconnected", disconnect);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("gamepadconnected", connect);
      window.removeEventListener("gamepaddisconnected", disconnect);
    };
  }, [s.binds, s.setPadName, emitJoyVector, isMenuJoyMode]);
  useEffect(() => {
    const ARROW = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    const onArrow = (e) => {
      if (!s.running) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const dir = ARROW[e.code];
      if (!dir) return;
      if (!isMenuJoyMode()) return;
      e.preventDefault();
      e.stopPropagation();
      const on = e.type === "keydown";
      if (on && e.repeat) return;
      arrowJoyRef.current[dir] = on;
      emitJoyVector();
    };
    const onBlur = () => {
      arrowJoyRef.current = { up: false, down: false, left: false, right: false };
    };
    window.addEventListener("keydown", onArrow, true);
    window.addEventListener("keyup", onArrow, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onArrow, true);
      window.removeEventListener("keyup", onArrow, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [s.running, emitJoyVector, isMenuJoyMode]);
  useEffect(() => {
    const onKey = (e) => {
      if (!s.running) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!isJoyFireKey(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      const on = e.type === "keydown";
      if (on && e.repeat) return;
      joyRef.current.fire = on;
      emitJoyVector(on);
    };
    const onBlur = () => {
      if (!joyRef.current.fire) return;
      joyRef.current.fire = false;
      emitJoyVector(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [s.running, emitJoyVector]);
  useEffect(() => {
    setPaused(emuRef.current, s.paused);
  }, [s.paused]);
  useEffect(() => {
    setWarp(emuRef.current, s.warped);
  }, [s.warped]);
  const tapPower = useCallback((e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    glog("power-tap", { t: e?.type ?? "ui" });
    powerOnRef.current();
  }, []);
  const appAttrs = {
    className: "g64-app",
    "data-device": resolved.device,
    "data-os": snap.os,
    "data-orient": view.orient,
    "data-standard": resolved.standard,
    "data-core": resolved.coreMode,
    "data-media": playModeRef.current,
    "data-kb": s.powered && s.showKeyboard ? "true" : "false",
    "data-pad": s.padName ? "true" : "false",
    "data-mouse": s.mouseMode ? "true" : "false",
    "data-layout-edit": s.layoutEdit ? "true" : "false",
    "data-running": s.running ? "true" : "false",
    "data-booting": s.booting ? "true" : "false",
    style: { ["--app-h"]: `${view.height}px` },
    suppressHydrationWarning: true,
  };
  const padConnected = hasRealGamepad();
  const showStick = s.powered && s.showJoystick && !padConnected && !s.mouseMode;
  const showJoyChrome = s.powered;
  const showMousePad = s.powered && s.mouseMode && !padConnected;
  return (
    <div {...appAttrs}>
      {!s.powered ? (
        <div
          ref={splashRef}
          className="g64-splash"
          data-on={s.powered || s.booting ? "true" : "false"}
          data-booting={s.booting ? "true" : "false"}
          role="button"
          tabIndex={0}
          aria-label="Power on"
          onPointerDown={tapPower}
          onClick={tapPower}
        >
          <div className="g64-mark">
            GROK64<span>EMU</span>
          </div>
          <button
            type="button"
            className="g64-power"
            data-on={s.powered || s.booting ? "true" : "false"}
            aria-label="Power on"
            onPointerDown={tapPower}
            onClick={tapPower}
          >
            <Power className="size-8" />
            <span className="led" />
          </button>
          <p className="g64-detect">{detectLine(resolved)}</p>
          <p className="g64-splash-copy">
            {s.booting
              ? s.bootMsg || "Starting Commodore 64…"
              : s.powered
                ? "Still starting — tap again if the screen stays dark."
                : "Tap the power button. The C64 boots to READY with a blank work disk. Grab games from Software."}
          </p>
          <BuildId />
        </div>
      ) : null}
      <header className="g64-top" hidden={!s.powered}>
        <h1>Grok64</h1>
        <BuildId />
        <div className="g64-top-rail">
          <button type="button" className="g64-chip" onClick={() => s.setSettingsOpen(true)} title={detectLine(resolved)}>
            {resolved.chip}
          </button>
          {mapHasDrive(s.iecMap, "sd2iec") ? (
          <button
            type="button"
            className="g64-chip g64-chip-gate g64-chip-pin"
            data-on="true"
            title="SD2IEC card on — tap to turn off. Floppy Play still uses 1541 #8."
            onClick={() => {
              const unit = unitOfDrive(s.iecMap, "sd2iec") ?? 8;
              s.setIecSlot(unit, unit === 8 ? "1541" : "none");
              toast.message("SD2IEC off — 1541 on #8");
            }}
          >
            SD2IEC
          </button>
          ) : null}
          {mapHasDrive(s.iecMap, "cmdhd") ? (
          <button
            type="button"
            className="g64-chip g64-chip-gate g64-chip-pin"
            data-on="true"
            title={`CMD HD on #${unitOfDrive(s.iecMap, "cmdhd") ?? 9} — tap to turn off`}
            onClick={() => {
              const unit = unitOfDrive(s.iecMap, "cmdhd") ?? 9;
              s.setIecSlot(unit, "none");
              cmdSwappedRef.current = false;
              setCmdSwapped(false);
              toast.message("CMD HD off");
            }}
          >
            CMD
          </button>
          ) : null}
          <button
            type="button"
            className="g64-chip g64-chip-gate g64-chip-pin"
            data-on={s.mouseMode ? "true" : "false"}
            title={s.mouseMode ? "1351 mouse on — tap for joystick. Drag L/R in layout editor." : "1351 mouse + touchpad + L/R buttons"}
            onClick={() => {
              const next = !s.mouseMode;
              s.setMouseMode(next);
              toast.message(next ? `1351 mouse on port ${s.joyPort} — tap P1/P2 to swap` : "Joystick");
            }}
          >
            MOUSE
          </button>
          {visibleHwButtons({
            cart: cartLive,
            sd2iec: mapHasDrive(s.iecMap, "sd2iec"),
            cmdhd: mapHasDrive(s.iecMap, "cmdhd"),
            scpu: s.machineId === "scpu",
          }).map((spec) => (
            <HwHoldChip
              key={spec.id}
              id={spec.id}
              label={spec.label}
              title={hwButtonTitle(spec)}
              longMs={spec.longMs}
              on={
                spec.id === "sd-disk"
                  ? mapHasDrive(s.iecMap, "sd2iec")
                  : spec.id === "sd-swap"
                    ? sdUnit === 9
                    : spec.id === "cmd-swap"
                      ? cmdSwapped
                      : spec.id === "scpu-rst"
                        ? s.machineId === "scpu"
                        : spec.id === "cart-fz"
                          ? cartLive
                          : false
              }
              onShort={() => void runHwAction(spec.shortAction)}
              onLong={spec.longAction ? () => void runHwAction(spec.longAction) : undefined}
            />
          ))}
          <button
            type="button"
            className="g64-chip g64-chip-gate"
            data-on={s.stickGate === "4way" ? "true" : "false"}
            title={
              s.stickGate === "4way"
                ? "Slow 4-way D-pad — tap for 8-way"
                : "Tap for slow cardinals (Paradroid, Boulder Dash)"
            }
            onClick={() => {
              const next = s.stickGate === "4way" ? "8way" : "4way";
              s.setStickGate(next);
              resetStickPrecision(stickPrecisionRef.current);
              stickPrecisionRef.current.precision = next === "4way";
              toast.message(next === "4way" ? "Cardinals — tap to step, hold to crawl" : "8-way C64 stick");
            }}
          >
            CARDINALS
          </button>
          {s.jumpBtn ? (
          <button
            type="button"
            className="g64-chip g64-chip-gate"
            data-on="true"
            title="Jump button on — tap to hide"
            onClick={() => {
              s.setJumpBtn(false);
              jumpHeldRef.current = false;
              emitJoyVector();
              toast.message("Jump button off");
            }}
          >
            JUMP
          </button>
          ) : null}
          {s.machineId === "scpu" ? (
          <button
            type="button"
            className="g64-chip g64-chip-gate"
            data-on="true"
            title="SuperCPU on — tap for C64"
            onClick={() => {
              s.setMachine("c64-auto");
              toast.message("C64");
            }}
          >
            SCPU
          </button>
          ) : null}
          {padConnected ? (
            <button
              type="button"
              className="g64-chip"
              title={s.padName ?? "Controller"}
              onClick={() => s.setMapperOpen(true)}
            >
              <Gamepad2 className="size-3.5" />
              PAD
            </button>
          ) : null}
        </div>
        <div className="g64-top-icons">
        <button type="button" className="g64-iconbtn" data-on={s.libraryOpen} aria-label="Software" onClick={() => s.setLibraryOpen(true)}>
          <FolderOpen className="size-5" />
        </button>
        <button type="button" className="g64-iconbtn" data-on={diskOpen} aria-label="Insert disk" onClick={() => setDiskOpen(true)}>
          <Disc3 className="size-5" />
        </button>
        <button type="button" className="g64-iconbtn" data-on={s.showKeyboard} aria-label="Keyboard" onClick={() => s.setShowKeyboard(!s.showKeyboard)}>
          <KeyboardIcon className="size-5" />
        </button>
        <button
          type="button"
          className="g64-iconbtn extra"
          aria-label={s.paused ? "Resume" : "Pause"}
          onClick={() => {
            const next = !s.paused;
            s.setPaused(next);
            setPaused(emuRef.current, next);
          }}
        >
          {s.paused ? <Play className="size-5" /> : <Pause className="size-5" />}
        </button>
        <button
          type="button"
          className="g64-iconbtn extra g64-reset"
          aria-label="Reset"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.code === "Space" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onClick={() => resetReady()}
        >
          <RotateCcw className="size-5" />
        </button>
        <button type="button" className="g64-iconbtn extra" data-on={s.muted} aria-label={s.muted ? "Unmute" : "Mute"} onClick={() => s.setMuted(!s.muted)}>
          {s.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
        <button type="button" className="g64-iconbtn" aria-label="Settings" onClick={() => s.setSettingsOpen(true)}>
          <Settings className="size-5" />
        </button>
        <button type="button" className="g64-iconbtn extra" aria-label="About" onClick={() => s.setAboutOpen(true)}>
          <Info className="size-5" />
        </button>
        </div>
      </header>
      {s.powered && (s.debugLog || debugQueryOn()) ? (
        <div className="g64-log" aria-live="polite">
          {logLines.slice(-5).map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      ) : null}
      <div className="g64-stage">
        <div className="g64-bezel">
          <div
            className={s.running ? "g64-screen is-on" : "g64-screen"}
            onPointerDown={(e) => {
              unlockAudio(emuRef.current);
              if (iosResume) {
                resumePlayback();
                return;
              }
              if (playLockRef.current || !s.running) return;
              if (s.booting) {
                resumePlayback();
                return;
              }
              e.preventDefault();
              if (s.mouseMode) {
                mouseBtnRef.current.left = true;
                setMouseAnalog(emuRef.current, 0, 0, true, mouseBtnRef.current.right);
              } else {
                onFire(true, true);
              }
            }}
            onPointerUp={() => {
              if (playLockRef.current || !s.running || s.booting) return;
              if (s.mouseMode) {
                mouseBtnRef.current.left = false;
                setMouseAnalog(emuRef.current, mouseVelRef.current.x, mouseVelRef.current.y, false, mouseBtnRef.current.right);
                return;
              }
              if (!pendingKickRef.current) onFire(false);
            }}
            onPointerCancel={() => {
              if (playLockRef.current || !s.running || s.booting) return;
              if (s.mouseMode) {
                mouseBtnRef.current.left = false;
                setMouseAnalog(emuRef.current, mouseVelRef.current.x, mouseVelRef.current.y, false, mouseBtnRef.current.right);
                return;
              }
              if (!pendingKickRef.current) onFire(false);
            }}
          >
            <PlayerMount />
            {s.crtFilter && snap.os !== "ios" ? <div className="g64-scan" /> : null}
            {iosResume && !s.booting ? (
              <button
                type="button"
                className="g64-unlock"
                onPointerDown={() => resumePlayback()}
                onClick={() => resumePlayback()}
              >
                Tap screen to show READY
              </button>
            ) : null}
          </div>
          {s.booting ? (
            <div className="g64-boot" aria-live="polite" aria-busy="true">
              <div className="g64-boot-copy">{s.bootMsg || "Loading…"}</div>
              <div className="g64-boot-bar" aria-hidden="true">
                <i style={{ width: `${Math.max(8, Math.min(100, s.bootProgress || 12))}%` }} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <TouchControls
        onVector={onVector}
        stickHoldRef={stickCenterHoldRef}
        onFire={onFire}
        onJump={onJump}
        onMouseDelta={(dx, dy) => {
          unlockAudio(emuRef.current);
          if (playLockRef.current || useEmu.getState().booting) return;
          mouseVelRef.current.x = dx;
          mouseVelRef.current.y = dy;
        }}
        onMouseEnd={() => {
          mouseVelRef.current = { x: 0, y: 0 };
        }}
        onMouseBtn={(left, right) => {
          unlockAudio(emuRef.current);
          if (playLockRef.current || useEmu.getState().booting || !useEmu.getState().running) return;
          mouseBtnRef.current = { left, right };
        }}
        jumpEnabled={s.jumpBtn}
        joyPort={s.joyPort}
        onSwap={swapJoyPort}
        warped={s.warped}
        onWarp={toggleWarp}
        hidden={!showJoyChrome}
        padActive={padConnected}
        stickHidden={!showStick && !showMousePad}
        locked={!s.running || s.booting}
        vector={stickViz}
        gate={s.stickGate}
        frameMs={frameMsForStandard(resolved.standard)}
        mouseMode={s.mouseMode}
        padSide={s.padSide}
        layoutEdit={s.layoutEdit}
        controlLayout={s.controlLayout}
        onLayoutDrag={(id, left, bottom) => s.setControlPos(id, { left, bottom })}
      />
      {s.powered && s.showKeyboard ? <C64Keyboard /> : null}
      <LibrarySheet onPlayBundled={(t) => void playBundled(t)} onPlayLocal={(i) => void playLocal(i)} onInsert={(i) => void insertDisk(i)} />
      <DiskMountSheet
        open={diskOpen}
        onOpenChange={setDiskOpen}
        onPlay={(i) => void playLocal(i)}
        onInsert={(i) => void insertDisk(i)}
        onBrowse={() => s.setLibraryOpen(true)}
      />
      <SettingsSheet resolved={resolved} />
      <SnapshotsSheet
        canCapture={s.powered && s.running && !s.booting}
        onCapture={async (kind, id) => {
          const st = await captureState(emuRef.current);
          if (!st || st.byteLength < 16) {
            toast.error("Nothing to freeze yet");
            return;
          }
          await saveSnapshot(kind, id, st, s.currentTitle || (kind === "hardware" ? "Freeze" : "Memory"));
        }}
        onRestore={async (snap) => {
          applyRecipe(snap.recipe);
          s.setSnapsOpen(false);
          toast.message(`Restoring ${snap.recipe.machineId === "scpu" ? "SCPU" : "C64"} · ${snap.recipe.iecDrive.toUpperCase()}`);
          const payload = playPayloadRef.current;
          pendingSnapshotRef.current = snap;
          if (payload) {
            await playBuffer(payload.filename, payload.data, payload.opts);
          } else if (emuRef.current) {
            restoreState(emuRef.current, snap.data);
            pendingSnapshotRef.current = null;
          } else {
            toast.message("Load a title, then tap Load again");
          }
        }}
      />
    </div>
  );
}
