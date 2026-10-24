// @ts-nocheck — large loosely-typed emulator shell; runtime is covered by Playwright QA.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Disc3, FolderOpen, Gamepad2, Info, Keyboard as KeyboardIcon, MoreHorizontal, Pause, Play, Power, RotateCcw, Settings, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { C64Keyboard } from "@/components/emu/Keyboard";
import { QuickDock } from "@/components/emu/QuickDock";
import { TouchControls } from "@/components/emu/Joystick";
import { LibrarySheet } from "@/components/emu/LibrarySheet";
import { DiskMountSheet } from "@/components/emu/DiskMountSheet";
import { SettingsSheet } from "@/components/emu/SettingsSheet";
import { applyRecipe, saveSnapshot, SnapshotsSheet } from "@/components/emu/SnapshotsSheet";
import { freezeSlot, listSnapshots } from "@/lib/emu/snapshots";
import {
  copyBuffer,
  getFile,
  listLibrary,
  putSaveState,
  deleteSaveState,
  touchPlayed,
  updateFileData,
  ensureWorkDisk,
  isWorkDisk,
  removeFile,
  putFile,
} from "@/lib/emu/library";
import { useEmu } from "@/lib/emu/store";
import {
  applyRuntimeOptions,
  applyJiffyDos,
  autostartAfterReady,
  cartBootReset,
  bootEmulator,
  bootGeosFloppy,
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
  grok64CoreStatus,
  hardReset,
  hasRealGamepad,
  joyInput,
  listRealGamepads,
  mountDiskOnUnit,
  applyIecUnit,
  attachAutostartDisk,
  attachCartridgeInPlace,
  cartEject,
  cartFreeze,
  stabilizeFreezerScreen,
  cancelSuperSnapshotVicFix,
  scheduleSuperSnapshotVicFix,
  isSuperSnapshotCartHint,
  ss5TurboBasicWithoutMenu,
  cartMountedOnCore,
  cartReset,
  repaintAfterCartFreeze,
  writeCompanionMedia,
  cmdHdSwap,
  flushEmuFs,
  lastAppliedJiffy,
  lastAppliedWorkDisk,
  runtimeViceOpts,
  swapBootDisk,
  viceWorkD64ByteLength,
  writeBootFile,
  sd2iecFreeze,
  sd2iecSwapDevice,
  scpuReset,
  plugJoysticks,
  prepareCore,
  probeCore,
  readMountedMedia,
  readMountedMediaForUi,
  applyReal1541Timing,
  recycleCore,
  refreshViceWorkDisk,
  remountSd2iecFromParts,
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
  injectViceRc,
  bumpCrtPaint,
  tryGeosDiskAutostart,
} from "@/lib/emu/host";
import { presentFloppyMountReady } from "@/lib/emu/disk-mount-ready";
import { hasCmdRom, hasJiffyPair, prefetchBundledRoms } from "@/lib/emu/roms";
import {
  addSdFile,
  exportSdImage,
  formatPartition,
  listPartitions,
  mountDirectFatImage,
  mountHostSdFolder,
  partitionsForMount,
  debugWasmIec,
  iecOpenDollarChannel,
  kernalIecTrapActive,
  resetSd2iecSession,
  runSdCommand,
  setIecDevice,
  setSd2iecJiffyFast,
  attachSd2iecBus,
  setSd2iecWasmIecOnly,
} from "@/lib/emu/sd2iec";
import {
  clearSd2iecCardMount,
  getSd2iecCardSourceMeta,
  hostDirectoryPickerReason,
  supportsHostDirectoryPicker,
} from "@/lib/emu/sd2iec-card-source";
import {
  grok64KeyboardDrain,
  grok64KeyboardReleaseAll,
  grok64RetroKeyboardAvailable,
  grok64RetroKeyboardFromDom,
  setGrok64KeyboardPaintHook,
} from "@/lib/emu/grok64-keyboard";
import { attachGrok64Sd2iec, tickGrok64Iec, wireGrok64ViceHost } from "@/lib/emu/grok64-vice-bridge";
import { readC64Byte, readC64Bytes, writeC64Byte, writeC64Bytes } from "@/lib/emu/c64-memory";
import { buildViceExtras, C64OS_REU, wantsLargeReu, wantsSuperCpu, workDiskFor } from "@/lib/emu/vice-extras";
import {
  geosBootSucceeded,
  geosBootStuckAtBasic,
  geosBootLoadCandidates,
  geosBootLoadLine,
  geosBootLooksLaunched,
  geosFamilyDesktopOk,
  geosFamilyLoadMs,
  geosFamilyPlayLockMs,
  isGeosFamilyDiskName,
  isWheelsDiskName,
  reuForGeosFamilyDisk,
} from "@/lib/emu/geos-boot";
import { HwHoldChip } from "@/components/emu/HwHoldChip";
import {
  beginColdSession,
  canvasLooksReady,
  clearLivePlay,
  clearPlayMarker,
  clearSession,
  iosInPlaceMediaKind,
  iosMustKeepLiveCore,
  iosPlayKeepsLiveCrt,
  inPlaceAutostartTarget,
  isColdBasicStart,
  isCartMediaBoot,
  liveCoreReadyToAttach,
  livePlayTitle,
  mapHasDrive,
  markLivePlay,
  markSessionPlay,
  markSessionReady,
  planPlay,
  CART_PLAY_UNLOCK_VICE_OPTS,
  viceGeosFloppyOptions,
  readPlayMarker,
  savePlayMarker,
  sessionCanAttach,
  sessionPhase,
  shouldDropToSplash,
  shouldRecoverBoot,
  shouldRefuseStartRecycle,
  shouldDismissPictureHold,
  shouldSkipPlayPersist,
  shouldWaitForLiveCore,
  unitOfDrive,
  userAttachFromMap,
  viceDriveTypeVars,
  viceMapFromIecMap,
  viceRcForDrives,
} from "@/lib/emu/play-session";
import {
  actionForPress,
  hwButtonById,
  hwButtonTitle,
  sd2iecSwapUnit,
  visibleHwButtons,
  type HwPress,
} from "@/lib/emu/hw-buttons";
import { detectLine, resolveMachine, sidOptions, videoStandardOptions } from "@/lib/emu/machines";
import { BUNDLED } from "@/lib/emu/software";
import { putRom, removeRom } from "@/lib/emu/roms";
import { snapshotDevice, readViewport, applyViewport, detectDevice, isIos, isIosPhone, isTouchMobile } from "@/lib/emu/detect";
import { applyTabletContainFit, tabletBezelAvail, tabletGlassFillsBezel } from "@/lib/emu/tablet-fit";
import { detectJoyPort, detectSoftwareStandard } from "@/lib/emu/region";
import { RETRO_BTN } from "@/lib/emu/types";
import { feedBasicLine, readPrintTi } from "@/lib/emu/c64-keyboard";
import { removeSessionCart, setSessionCart, setSessionDisk } from "@/lib/emu/session-media";
import { focusGrok64Player } from "@/lib/emu/focus-player";
import {
  dispatchC64Key,
  isJoyFireKey,
  muteC64Space,
  onBeforeC64Space,
  setC64HardwareKeySink,
  typeC64,
} from "@/lib/emu/keys";
import {
  detectFastLoadCart,
  detectFastLoadCartFromPayload,
  jiffyAllowedDuringCartBoot,
  jiffyCartCompat,
  resolveJiffyWant,
} from "@/lib/emu/jiffy-cart-compat";
import {
  bootFileName,
  resolvePlayBootName,
  driveForPlay,
  d64DiskName,
  isBasicPrg,
  isCartridgePayload,
  isDiskKind,
  isWorkDiskImage,
  isLikelyBlankD64Payload,
  kindOf,
  needsTypedBoot,
} from "@/lib/emu/formats";
import { wrapForDiskSwap, prepareAutostartDisk, screenInvitesCracktroInput } from "@/lib/emu/d64";
import { isSid, psidToPrg } from "@/lib/emu/psid";
import { explodeArchive, pickBootFile, toArrayBuffer } from "@/lib/emu/archive";
import { BuildId } from "@/components/emu/BuildId";
import { debugQueryOn, glog, glogFire, setDebugUi, subscribeLog } from "@/lib/emu/debug";
import { readBuildId } from "@/lib/emu/build-id";
import {
  cartAttachResultCode,
  getLastCartPlayDiagnostic,
  publishCartAttachDiag,
  recordLastCartPlayDiagnostic,
  validateCartForPlay,
  validateCrtImport,
  scanLibraryCartHealth,
} from "@/lib/emu/cart-crt-diag";
import { createMenuJoyGate, menuJoyStep, resetMenuJoyGate } from "@/lib/emu/menu-joy.mjs";
import { applyStickPrecision, createStickPrecision, resetStickPrecision } from "@/lib/emu/stick-precision.mjs";
import { publicUrl } from "@/lib/public-url";
import { readScreenText } from "@/lib/emu/screen-text";
import { applyEmuVolume, gestureUnlockAudio, pokeAudioUnlock } from "@/lib/emu/audio-unlock";
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
import { isIosPresentPainted, iosPresentInfo } from "@/lib/emu/ios-present";

function frameMsForStandard(standard: string) {
  return standard === "ntsc" ? 1000 / 60 : 20;
}

function playLockDuration(mode: string, _title?: string | null): number {
  if (isTouchMobile()) return mode === "disk" ? 4500 : mode === "cart" ? 900 : 1400;
  if (mode === "cart") return 1400;
  /* True 1541 timing — one window for all floppies, not per-game title lists. */
  if (mode === "disk") return 48_000;
  return 3500;
}

function autoloadWarpForPlay(mode: string, filename?: string | null): boolean | undefined {
  if (mode === "disk" || mode === "cart") return false;
  if (filename && /\.(crt|bin)$/i.test(filename)) return false;
  return undefined;
}

function gameplayReadyDelay(lockMs: number): number {
  if (isTouchMobile()) return lockMs + 300;
  return Math.max(lockMs + 4000, 20_000);
}

function playerCanvasReady(root?: HTMLElement | null) {
  const el = root ?? (typeof document !== "undefined" ? document.getElementById("grok64-player") : null);
  const canvas = el?.querySelector("canvas:not(.g64-ios-present)") as HTMLCanvasElement | null;
  return canvasLooksReady(canvas);
}

const PlayerMount = memo(function PlayerMount() {
  return (
    <div
      id="grok64-player"
      tabIndex={0}
      onPointerDown={() => focusGrok64Player()}
    />
  );
});

let fitTimers: number[] = [];
let crashRecoverStarted = false;
function scheduleFit(force = false) {
  for (const id of fitTimers) window.clearTimeout(id);
  const run = () => {
    applyTabletContainFit();
    const el = document.getElementById("grok64-player");
    const emu = (window as unknown as { __ejs?: Parameters<typeof fitEmu>[1] }).__ejs ?? null;
    const tabletForce = force || detectDevice() === "tablet";
    fitEmu(el, emu, tabletForce);
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
  /** IndexedDB row that may receive floppy autosave — never CRT/PRG library ids. */
  const persistLibIdRef = useRef(null);
  const persistTimer = useRef(null);
  const playBufferRef = useRef(async () => {});
  const playLocalRef = useRef(async (_item) => {});
  const bootHoldRef = useRef(false);
  const bootKickRef = useRef(false);
  const recoverOnceRef = useRef(false);
  const powerOnRef = useRef(() => {});
  const splashRef = useRef(null);
  const loadGenRef = useRef(0);
  const playModeRef = useRef("basic");
  const basicRunAfterLoadRef = useRef(false);
  const diskRunAfterLoadRef = useRef(false);
  const persistGateRef = useRef(true);
  const inGameplayRef = useRef(false);
  const cracktroOnceRef = useRef("");
  const bootTimersRef = useRef([]);
  const pendingKickRef = useRef(false);
  const bootPathRef = useRef(null);
  const workDiskBytesRef = useRef(null);
  const playLockRef = useRef(false);
  const playLockGen = useRef(0);
  const pendingSnapshotRef = useRef(null);
  const pendingCompanionRef = useRef<{ name: string; data: Uint8Array }[]>([]);
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
  const [pictureHold, setPictureHold] = useState(false);
  const pictureHoldTimer = useRef(0);
  const [diskOpen, setDiskOpen] = useState(false);
  const [railMoreOpen, setRailMoreOpen] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [cartLive, setCartLive] = useState(false);
  const cartLiveRef = useRef(false);
  const resetReadyRef = useRef(() => {});
  const startWithUrlRef = useRef(async () => {});
  const powerOffRef = useRef(() => {});
  const swapJoyPortRef = useRef(() => {});
  const toggleWarpRef = useRef(() => {});
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
    const timers = scheduleFit(true);
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [s.showKeyboard, view.orient, cartLive]);
  useEffect(() => {
    if (!s.showKeyboard || !s.running) return;
    const t = window.setTimeout(() => {
      scheduleFit(true);
      bumpCrtPaint(emuRef.current);
    }, 60);
    return () => window.clearTimeout(t);
  }, [s.showKeyboard, s.running]);
  useEffect(() => {
    const onFit = () => scheduleFit(true);
    window.addEventListener("g64-fit", onFit);
    return () => window.removeEventListener("g64-fit", onFit);
  }, []);
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
    void import("@/lib/emu/sd2iec-card-source").then((m) =>
      m.setSd2iecWriteEnabled(useEmu.getState().sd2iecWriteEnabled),
    );
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
      fastLoadCart: () => useEmu.getState().fastLoadCart,
      cartLive: () => cartLiveRef.current,
      title: () => useEmu.getState().currentTitle,
      bootPath: () => bootPathRef.current,
      hasFs: () => coreHasFs(emuRef.current),
      fileName: () => emuRef.current?.fileName ?? null,
      power: () => powerOnRef.current(),
      powered: () => useEmu.getState().powered,
      running: () => useEmu.getState().running,
      booting: () => useEmu.getState().booting,
      playLock: () => playLockRef.current,
      bootHold: () => bootHoldRef.current,
      session: () => sessionPhase(),
      bootFile: () => bootFileOf(emuRef.current),
      paintSettled: () => isIosPaintSettled(),
      paintPath: () => iosCrtPath(),
      mirrorPainted: () => isIosMirrorPainted(),
      mirrorActive: () => isIosMirrorActive(),
      buildId: () => readBuildId(),
      lastCartPlay: () => getLastCartPlayDiagnostic(),
      scanLibraryCarts: () => scanLibraryCartHealth(),
      grok64Core: () => grok64CoreStatus(emuRef.current),
      crt: () => {
        const root = document.getElementById("grok64-player");
        const c = root?.querySelector("canvas:not(.g64-ios-present)") as HTMLCanvasElement | null;
        const present = document.querySelector("canvas.g64-ios-present") as HTMLCanvasElement | null;
        const cs = c ? getComputedStyle(c) : null;
        const ns = present ? getComputedStyle(present) : null;
        const gl = c && c.__g64gl;
        return {
          path: iosCrtPath(),
          settled: isIosPaintSettled(),
          overlay: Boolean(root?.querySelector(".g64-ios-mirror")),
          present: Boolean(present),
          presentOn: false,
          presentPainted: isIosPresentPainted(),
          presentBuf: present ? { w: present.width, h: present.height } : null,
          presentLoop: iosPresentInfo(),
          live: root?.classList.contains("g64-ios-crt-live") ?? false,
          w: c?.width ?? 0,
          h: c?.height ?? 0,
          cw: c?.clientWidth ?? 0,
          ch: c?.clientHeight ?? 0,
          cssW: cs?.width ?? null,
          cssH: cs?.height ?? null,
          presentCssW: ns?.width ?? null,
          presentCssH: ns?.height ?? null,
          xf: cs?.transform ?? null,
          dbw: gl?.drawingBufferWidth ?? null,
          dbh: gl?.drawingBufferHeight ?? null,
          hidden: c ? cs.visibility === "hidden" || cs.opacity === "0" : true,
        };
      },
      media: () =>
        readMountedMediaForUi(emuRef.current, useEmu.getState().insertedDiskName).map((m) => ({
          name: m.name,
          size: m.data.byteLength,
          disk: d64DiskName(m.data),
        })),
      setWarp: (on) => {
        useEmu.getState().setWarped(!!on);
        setWarp(emuRef.current, !!on);
      },
      prepareReal1541Timing: () => {
        const unit = useEmu.getState().iecUnit;
        applyReal1541Timing(emuRef.current, unit);
        useEmu.getState().setWarped(false);
        setWarp(emuRef.current, false);
        return true;
      },
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
      cartEject: () => cartEject(emuRef.current, workDiskBytesRef.current),
      grok64CoreStatus: () => grok64CoreStatus(emuRef.current),
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
      setIecSlot: (unit, slot) => {
        useEmu.getState().setIecSlot(unit, slot);
        const emu = emuRef.current;
        if (!emu || !useEmu.getState().running) return;
        const iecMap = useEmu.getState().iecMap;
        applyRuntimeOptions(emu, viceDriveTypeVars(iecMap));
        injectViceRc(emu, viceRcForDrives(iecMap, false));
        if (slot === "sd2iec") {
          wireGrok64ViceHost(emu);
          attachGrok64Sd2iec(emu, unit);
          applyIecUnit(emu, "sd2iec", unit);
          void partitionsForMount().then((parts) => remountSd2iecFromParts(emu, unit, parts));
        } else if (slot === "1541" || slot === "1581") {
          applyIecUnit(emu, slot, unit);
          applyRuntimeOptions(emu, {
            [`vice_drive${unit}_type`]: slot === "1581" ? "1581" : "1541",
          });
        }
      },
      typeC64: (text, opts) => typeC64(text, opts),
      typeBasic: async (text, opts) => {
        await typeC64(text, { delayMs: opts?.delayMs ?? 55 });
        dispatchC64Key("Enter", "Enter", true);
        dispatchC64Key("Enter", "Enter", false);
      },
      iecMap: () => useEmu.getState().iecMap,
      resetReady: () => resetReadyRef.current?.(),
      powerOff: () => powerOffRef.current?.(),
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
      runtimeViceOpts: () => runtimeViceOpts(),
      openSoftware: () => useEmu.getState().setLibraryOpen(true),
      closeSoftware: () => useEmu.getState().setLibraryOpen(false),
      libraryCount: async () => (await listLibrary()).length,
      listLibraryItems: () => listLibrary(),
      librarySnapshot: async () => {
        const items = await listLibrary();
        const snap = [];
        for (const item of items) {
          if (isWorkDisk(item.name)) continue;
          const file = await getFile(item.id);
          if (!file) continue;
          const u8 = new Uint8Array(file.data);
          snap.push({
            id: item.id,
            name: item.name,
            size: file.size,
            byteLength: u8.byteLength,
            kind: item.kind,
            headHex16: [...u8.subarray(0, 16)]
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(" "),
          });
        }
        return snap;
      },
      playLibraryByName: async (name) => {
        const items = await listLibrary();
        const item = items.find((i) => i.name === name);
        if (!item) throw new Error(`On this device has no file named “${name}”.`);
        await playLocalRef.current(item);
      },
      importLibraryBytes: async (name, bytes) => {
        const u8 =
          bytes instanceof Uint8Array
            ? bytes
            : bytes instanceof ArrayBuffer
              ? new Uint8Array(bytes)
              : new Uint8Array(bytes);
        const reject = validateCrtImport(u8, name);
        if (reject) throw new Error(reject);
        const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
        const item = await putFile(name, buf, "local");
        useEmu.getState().setLibrary(await listLibrary());
        return { id: item.id, name: item.name };
      },
      fireTap: () => {
        joyRef.current.fire = true;
        emitJoyRef.current(true);
        setTimeout(() => {
          joyRef.current.fire = false;
          emitJoyRef.current(false);
        }, 100);
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
      screenText: () => readScreenText(emuRef.current),
      workD64Bytes: () => viceWorkD64ByteLength(emuRef.current),
      kbdDrain: () => grok64KeyboardDrain(),
      readC64Byte: (addr) => readC64Byte(emuRef.current, addr),
      writeC64Byte: (addr, v) => writeC64Byte(emuRef.current, addr, v),
      readC64Bytes: (addr, len) => {
        const u = readC64Bytes(emuRef.current, addr, len);
        return u ? Array.from(u) : null;
      },
      writeC64Bytes: (addr, arr) => writeC64Bytes(emuRef.current, addr, new Uint8Array(arr)),
      setSd2iecUnit: (unit) => setIecDevice(unit),
      kernalIecTrapActive: () => kernalIecTrapActive(emuRef.current),
      debugWasmIec: (dev, sec) => debugWasmIec(dev, sec),
      iecOpenDollarChannel: (unit = 8) => iecOpenDollarChannel(emuRef.current, unit as 8 | 9 | 10 | 11 | 12),
      feedBasic: (line) => feedBasicLine(emuRef.current, line),
      printTi: async () => readPrintTi(emuRef.current, () => readScreenText(emuRef.current)),
      geosMountAndDir: async (name, bytes) => {
        let buf: ArrayBuffer;
        if (bytes instanceof ArrayBuffer) buf = bytes;
        else if (bytes instanceof Uint8Array) {
          buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        } else buf = new Uint8Array(bytes as ArrayLike<number>).buffer;
        const stGeos = useEmu.getState();
        const reu = reuForGeosFamilyDisk(name, stGeos.reuSize);
        if (reu !== stGeos.reuSize) {
          stGeos.setReuSize(reu);
          applyRuntimeOptions(emuRef.current, { vice_ram_expansion_unit: reu });
        }
        stGeos.setIecSlot(8, "1541");
        sessionIecRef.current = "1541";
        sessionUnitRef.current = 8;
        const geosMap = { ...stGeos.iecMap, 8: "1541" as const };
        disarmAutostart(emuRef.current, "disk");
        const mountOk = await bootGeosFloppy(
          emuRef.current,
          new Uint8Array(buf),
          name,
          8,
          geosMap,
        );
        const workBytes = viceWorkD64ByteLength(emuRef.current);
        const opts = runtimeViceOpts();
        await flushEmuFs(emuRef.current, 2000);
        bumpCrtPaint(emuRef.current);
        const dir = readScreenText(emuRef.current);
        return { mountOk, workBytes, opts, dir };
      },
      bootGeos: async (name, bytes) => {
        let buf: ArrayBuffer;
        if (bytes instanceof ArrayBuffer) buf = bytes;
        else if (bytes instanceof Uint8Array) {
          buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        } else buf = new Uint8Array(bytes as ArrayLike<number>).buffer;
        const stGeos = useEmu.getState();
        const reu = reuForGeosFamilyDisk(name, stGeos.reuSize);
        if (reu !== stGeos.reuSize) {
          stGeos.setReuSize(reu);
          applyRuntimeOptions(emuRef.current, { vice_ram_expansion_unit: reu });
        }
        stGeos.setIecSlot(8, "1541");
        stGeos.setMouseMode(true);
        sessionIecRef.current = "1541";
        sessionUnitRef.current = 8;
        const geosMap = { ...stGeos.iecMap, 8: "1541" as const };
        setMouseAnalog(emuRef.current, true);
        disarmAutostart(emuRef.current, "disk");
        const ok = await bootGeosFloppy(emuRef.current, new Uint8Array(buf), name, 8, geosMap);
        if (!ok) return false;
        setSessionDisk(name, new Uint8Array(buf), 8);
        await flushEmuFs(emuRef.current, 3000);
        applyRuntimeOptions(emuRef.current, viceGeosFloppyOptions(8));
        setPaused(emuRef.current, false);
        if (await tryGeosDiskAutostart(emuRef.current, 8)) {
          await feedBasicLine(emuRef.current, "RUN", { runcmd: true });
          const autoEnd = Date.now() + 120_000;
          while (Date.now() < autoEnd) {
            const screen = readScreenText(emuRef.current);
            if (/FILE NOT FOUND|DEVICE NOT PRESENT|I\/O ERROR/i.test(screen)) break;
            if (geosBootSucceeded(screen, name) || geosBootLooksLaunched(screen)) {
              bumpCrtPaint(emuRef.current);
              return true;
            }
            const pix = await (async () => {
              const el = document.getElementById("grok64-player");
              const c = shotDisplayCanvas(el);
              const ctx = c?.getContext?.("2d");
              if (!c || !ctx) return 0;
              const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
              let geosDesk = 0;
              for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                if (g > 85 && b > 85 && r > 85 && r < 210) geosDesk += 1;
              }
              return geosDesk / (width * height);
            })();
            if (pix >= 0.1) {
              bumpCrtPaint(emuRef.current);
              return true;
            }
            bumpCrtPaint(emuRef.current);
            fitEmu(document.getElementById("grok64-player"), emuRef.current);
            await new Promise((r) => window.setTimeout(r, 800));
          }
        }
        const loadCandidates = geosBootLoadCandidates(name);
        for (const loadLine of loadCandidates) {
          if (!(await feedBasicLine(emuRef.current, loadLine))) continue;
          const loadEnd = Date.now() + geosFamilyLoadMs(name);
          let loadFailed = false;
          while (Date.now() < loadEnd) {
            const mid = readScreenText(emuRef.current);
            if (/FILE NOT FOUND|DEVICE NOT PRESENT|I\/O ERROR/i.test(mid)) {
              loadFailed = true;
              break;
            }
            if (/LOADING/i.test(mid)) {
              await new Promise((r) => window.setTimeout(r, 1200));
              continue;
            }
            if (/\bREADY\b/i.test(mid) && /LOADING|GEOS|\*"/i.test(mid)) break;
            await new Promise((r) => window.setTimeout(r, 500));
          }
          if (loadFailed) {
            await feedBasicLine(emuRef.current, "NEW", { runcmd: true });
            await new Promise((r) => window.setTimeout(r, 400));
            continue;
          }
          applyRuntimeOptions(emuRef.current, viceGeosFloppyOptions(8));
          await flushEmuFs(emuRef.current, 800);
          setPaused(emuRef.current, false);
          try {
            emuRef.current.paused = false;
            emuRef.current.gameManager?.toggleMainLoop(1);
          } catch {
            /* optional */
          }
          await feedBasicLine(emuRef.current, "RUN", { runcmd: true });
          const runEnd = Date.now() + 120_000;
          while (Date.now() < runEnd) {
            const screen = readScreenText(emuRef.current);
            if (/FILE NOT FOUND|DEVICE NOT PRESENT|I\/O ERROR/i.test(screen)) break;
            if (geosBootSucceeded(screen, name) || geosBootLooksLaunched(screen)) {
              bumpCrtPaint(emuRef.current);
              return true;
            }
            bumpCrtPaint(emuRef.current);
            fitEmu(document.getElementById("grok64-player"), emuRef.current);
            await new Promise((r) => window.setTimeout(r, 800));
          }
          const screen = readScreenText(emuRef.current);
          if (geosBootSucceeded(screen, name) || geosBootLooksLaunched(screen)) {
            bumpCrtPaint(emuRef.current);
            return true;
          }
          await feedBasicLine(emuRef.current, "NEW", { runcmd: true });
          await new Promise((r) => window.setTimeout(r, 400));
        }
        return false;
      },
      geosDesktopPixels: async () => {
        const el = document.getElementById("grok64-player");
        const c = shotDisplayCanvas(el);
        if (!c || c.width < 8) return { ok: false };
        const ctx = c.getContext("2d");
        if (!ctx) return { ok: false };
        const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
        let geosDesk = 0;
        const pixels = width * height;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (g > 85 && b > 85 && r > 85 && r < 210) geosDesk += 1;
        }
        return { ok: true, geosDesk: geosDesk / pixels, w: width, h: height };
      },
      settings: () => {
        const st = useEmu.getState();
        return {
          sidEngine: st.sidEngine,
          sidModel: st.sidModel,
          sid2Address: st.sid2Address,
          sid2Model: st.sid2Model,
          sid3Address: st.sid3Address,
          sid3Model: st.sid3Model,
          jiffyDos: st.jiffyDos,
          reuSize: st.reuSize,
          iecMap: st.iecMap,
          joyPort: st.joyPort,
          mouseMode: st.mouseMode,
        };
      },
      setShowKeyboard: (on) => useEmu.getState().setShowKeyboard(!!on),
      setSettingsOpen: (on) => useEmu.getState().setSettingsOpen(!!on),
      setJiffyDos: (on) => useEmu.getState().setJiffyDos(!!on),
      setSidAddresses: (patch) => {
        const st = useEmu.getState();
        if (patch.sid2 !== undefined) st.setSid2Address(patch.sid2);
        if (patch.sid2Model !== undefined) st.setSid2Model(patch.sid2Model);
        if (patch.sid3 !== undefined) st.setSid3Address(patch.sid3);
        if (patch.sid3Model !== undefined) st.setSid3Model(patch.sid3Model);
        const cur = useEmu.getState();
        applyRuntimeOptions(
          emuRef.current,
          sidOptions({
            engine: cur.sidEngine,
            model: cur.sidModel,
            sid2: cur.sid2Address,
            sid2Model: cur.sid2Model,
            sid3: cur.sid3Address,
            sid3Model: cur.sid3Model,
          }),
        );
      },
      putRomBytes: async (id, name, bytes) => {
        let buf: ArrayBuffer;
        if (bytes instanceof ArrayBuffer) buf = bytes;
        else if (Array.isArray(bytes)) buf = new Uint8Array(bytes).buffer;
        else if (bytes instanceof Uint8Array) {
          buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        } else {
          buf = new Uint8Array(bytes as ArrayLike<number>).buffer;
        }
        await putRom(id, name, buf);
      },
      removeRomSlot: (id) => removeRom(id),
      applySidLayout: () => {
        const st = useEmu.getState();
        applyRuntimeOptions(emuRef.current, sidOptions({
          engine: st.sidEngine,
          model: st.sidModel,
          sid2: st.sid2Address,
          sid2Model: st.sid2Model,
          sid3: st.sid3Address,
          sid3Model: st.sid3Model,
        }));
      },
      playBundled: async (id) => {
        const item = BUNDLED.find((b) => b.id === id);
        if (!item) throw new Error(`Unknown bundled id: ${id}`);
        const res = await fetch(item.path);
        const buf = await res.arrayBuffer();
        await playBufferRef.current(item.name, buf, { autostart: true, title: item.name });
        return item.id;
      },
      playBytes: async (name, bytes, opts?: { autostart?: boolean }) => {
        let buf: ArrayBuffer;
        if (bytes instanceof ArrayBuffer) buf = bytes;
        else if (Array.isArray(bytes)) buf = new Uint8Array(bytes).buffer;
        else if (bytes instanceof Uint8Array) {
          buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        } else {
          buf = new Uint8Array(bytes as ArrayLike<number>).buffer;
        }
        const autostart = opts?.autostart !== false;
        await playBufferRef.current(name, buf, { autostart, title: name });
        return true;
      },
      /** Nuvie: zip `base.prg` + `base.reu` so libretro VICE pairs the REU image. */
      playNuvie: async (prgBytes, reuBytes, base = "nuvie-play") => {
        const { zipSync } = await import("fflate");
        const prg = prgBytes instanceof Uint8Array ? prgBytes : new Uint8Array(prgBytes);
        const reu = reuBytes instanceof Uint8Array ? reuBytes : new Uint8Array(reuBytes);
        const boot = `${base}.prg`;
        const zip = zipSync({ [boot]: prg, [`${base}.reu`]: reu });
        useEmu.getState().setReuSize(C64OS_REU);
        if (emuRef.current) {
          applyRuntimeOptions(emuRef.current, { vice_ram_expansion_unit: C64OS_REU });
          if (useEmu.getState().running) {
            hardReset(emuRef.current);
            await new Promise((r) => window.setTimeout(r, 2500));
          }
        }
        await playBufferRef.current(`${base}.zip`, toArrayBuffer(zip), {
          autostart: true,
          title: boot,
          bootName: boot,
        });
        return true;
      },
      setReuSize: (size) => {
        useEmu.getState().setReuSize(size);
        applyRuntimeOptions(emuRef.current, { vice_ram_expansion_unit: size });
      },
      setJoyPort: (port) => {
        useEmu.getState().setJoyPort(port === 1 ? 1 : 2);
        plugJoysticks(emuRef.current, port === 1 ? 1 : 2);
        applyRuntimeOptions(emuRef.current, viceJoyOptions(port === 1 ? 1 : 2));
      },
      swapJoy: () => swapJoyPortRef.current?.(),
      toggleWarp: () => toggleWarpRef.current?.(),
      setMuted: (on) => {
        useEmu.getState().setMuted(!!on);
        applyEmuVolume(emuRef.current, !!on, useEmu.getState().volume);
      },
      setPaused: (on) => {
        useEmu.getState().setPaused(!!on);
        setPaused(emuRef.current, !!on);
      },
      openSnaps: () => useEmu.getState().setSnapsOpen(true),
      saveFreezeSlot: async (slot) => {
        const id = freezeSlot(slot);
        const st = await captureState(emuRef.current);
        if (!st || st.byteLength < 16) return false;
        await saveSnapshot("hardware", id, st, useEmu.getState().currentTitle || "Freeze");
        return true;
      },
      snapshotCount: async () => (await listSnapshots()).length,
      sessionFlags: () => {
        const st = useEmu.getState();
        return {
          warped: st.warped,
          muted: st.muted,
          paused: st.paused,
          joyPort: st.joyPort,
          reuSize: st.reuSize,
          showKeyboard: st.showKeyboard,
          mouseMode: st.mouseMode,
          cart: cartLiveRef.current,
        };
      },
      runDos: (cmd) => runSdCommand(cmd),
      resetDos: () => resetSd2iecSession(),
      sd2iecCardMeta: () => getSd2iecCardSourceMeta(),
      sd2iecHostFolderSupport: () => ({
        ok: supportsHostDirectoryPicker(),
        reason: hostDirectoryPickerReason(),
      }),
      setSd2iecWrites: (on) => useEmu.getState().setSd2iecWriteEnabled(!!on),
      clearSd2iecMount: () => clearSd2iecCardMount(),
      exportSdImage: () => exportSdImage(),
      mountSdFatImage: async (bytes, label) => {
        const data =
          bytes instanceof Uint8Array
            ? bytes
            : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : (bytes as ArrayLike<number>));
        await mountDirectFatImage(data, label);
        const emu = emuRef.current;
        const st = useEmu.getState();
        if (emu && st.running && mapHasDrive(st.iecMap, "sd2iec")) {
          const unit = Number(Object.entries(st.iecMap).find(([, v]) => v === "sd2iec")?.[0] ?? 8) as
            | 8
            | 9
            | 10
            | 11;
          wireGrok64ViceHost(emu);
          attachGrok64Sd2iec(emu, unit);
          applyIecUnit(emu, "sd2iec", unit);
          const parts = await partitionsForMount();
          remountSd2iecFromParts(emu, unit, parts);
          attachSd2iecBus(emu, unit);
        }
        return getSd2iecCardSourceMeta();
      },
      mountSdHostFolder: async (handle: FileSystemDirectoryHandle) => {
        await mountHostSdFolder(handle);
        const emu = emuRef.current;
        const st = useEmu.getState();
        if (emu && st.running && mapHasDrive(st.iecMap, "sd2iec")) {
          const unit = Number(Object.entries(st.iecMap).find(([, v]) => v === "sd2iec")?.[0] ?? 8) as
            | 8
            | 9
            | 10
            | 11;
          wireGrok64ViceHost(emu);
          attachGrok64Sd2iec(emu, unit);
          applyIecUnit(emu, "sd2iec", unit);
          const parts = await partitionsForMount();
          remountSd2iecFromParts(emu, unit, parts);
          attachSd2iecBus(emu, unit);
        }
        return getSd2iecCardSourceMeta();
      },
      seedSd: async (files) => {
        clearSd2iecCardMount();
        await formatPartition(0);
        for (const f of files) {
          const buf = f.data instanceof ArrayBuffer ? f.data : f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
          await addSdFile(0, f.name, buf, f.path ?? "");
        }
        const emu = emuRef.current;
        const st = useEmu.getState();
        if (emu && st.running && mapHasDrive(st.iecMap, "sd2iec")) {
          const unit = Number(Object.entries(st.iecMap).find(([, v]) => v === "sd2iec")?.[0] ?? 8) as 8 | 9 | 10 | 11;
          wireGrok64ViceHost(emu);
          remountSd2iecFromParts(emu, unit);
          const mod = emu.Module as { _grok64_sd2iec_attach?: unknown } | undefined;
          if (typeof mod?._grok64_sd2iec_attach !== "function") setSd2iecWasmIecOnly(false);
          attachSd2iecBus(emu, unit);
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
      const canvas = root.querySelector("canvas:not(.g64-ios-present)") as HTMLCanvasElement | null;
      const cold = sessionPhase() === "cold" || bootHoldRef.current;
      if (canvas && canvas.clientWidth > 16 && !bootHoldRef.current && !playLockRef.current && emuRef.current) {
        useEmu.getState().setRunning(true);
      }
      if (
        sessionPhase() === "cold" &&
        !bootHoldRef.current &&
        emuRef.current &&
        coreHasFs(emuRef.current) &&
        playerCanvasReady(root)
      ) {
        markSessionReady();
      }
      if (canvas && (canvas.width < 64 || canvas.height < 64)) {
        fitEmu(root, emuRef.current);
      }
      if (detectDevice() === "tablet") {
        applyTabletContainFit();
        if (emuRef.current) fitEmu(root, emuRef.current, true);
      }
      if (
        shouldDismissPictureHold({
          hold: true,
          booting: useEmu.getState().booting,
          running: useEmu.getState().running,
          paintSettled: isIosPaintSettled() && playerCanvasReady(root),
        })
      ) {
        setPictureHold(false);
        if (pictureHoldTimer.current) window.clearTimeout(pictureHoldTimer.current);
      }
      // Cold BASIC must keep presenting even if an early presentIosCrt marked
      // paintSettled on a 0-size canvas — that was black-until-folder-tap.
      if (
        isIosPhone() &&
        emuRef.current &&
        (useEmu.getState().running || useEmu.getState().booting || cold)
      ) {
        if (cold || !isIosPaintSettled() || !playerCanvasReady(root)) {
          presentIosCrt(emuRef.current, root, useEmu.getState().booting || cold ? "booting" : "running");
        }
      }
      if (isIosPhone() && emuRef.current && useEmu.getState().running && !useEmu.getState().muted) {
        if (audioLocked(emuRef.current)) unlockAudio(emuRef.current);
        applyEmuVolume(emuRef.current, false, useEmu.getState().volume);
      }
      if (!pendingKickRef.current) setAwaitingStart(false);
    }, 350);
    return () => window.clearInterval(id);
  }, [s.powered]);
  const persistNow = useCallback(async () => {
    if (!persistGateRef.current) return;
    if (
      shouldSkipPlayPersist({
        iosPhone: isIosPhone(),
        ios: isIos(),
        playMode: playModeRef.current,
        inGameplay: inGameplayRef.current,
        title: useEmu.getState().currentTitle,
        livePlay: Boolean(livePlayTitle()),
      })
    ) {
      return;
    }
    const id = persistLibIdRef.current;
    const emu = emuRef.current;
    if (!id || !emu) return;
    const file = await getFile(id);
    if (!file) return;
    const rowKind = kindOf(file.name);
    // Never autosave MEMFS floppy/work-disk bytes into CRT/PRG/SID library rows (#68 data-loss).
    if (!isDiskKind(rowKind)) return;
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
      const diskBytes = disk.data instanceof Uint8Array ? disk.data : new Uint8Array(disk.data);
      const dataIsWork = isWorkDiskImage(diskBytes);
      if (workItem) {
        if (!dataIsWork) return;
      } else {
        if (dataIsWork || isLikelyBlankD64Payload(diskBytes)) return;
      }
      await updateFileData(id, toArrayBuffer(diskBytes));
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
  const scheduleCracktroNudge = useCallback((sessionKey: string) => {
    if (cracktroOnceRef.current === sessionKey) return;
    cracktroOnceRef.current = sessionKey || "";
    // After Autostart is disarmed — Space is a C64 key only (#32 / #41).
    // Once per play-unlock; only if the CRT text asks for Space/fire (any title).
    bootTimersRef.current.push(
      window.setTimeout(() => {
        const screen = readScreenText(emuRef.current);
        if (!screenInvitesCracktroInput(screen)) return;
        glog("cracktro-nudge", { sessionKey, disarmed: true, head: screen.slice(0, 48) });
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
      }, 400),
    );
  }, []);
  const endPlayLock = useCallback(() => {
    playLockGen.current += 1;
    playLockRef.current = false;
    bootHoldRef.current = false;
    muteC64Space(false);
    clearBootTimers();
    useEmu.getState().setBooting(false);
  }, []);
  const beginPlayLock = useCallback(
    (ms, msg) => {
      playLockGen.current += 1;
      const gen = playLockGen.current;
      const lockMs = isTouchMobile()
        ? playLockDuration(playModeRef.current, useEmu.getState().currentTitle)
        : ms;
      playLockRef.current = true;
      bootHoldRef.current = false;
      persistGateRef.current = false;
      inGameplayRef.current = false;
      muteC64Space(true);
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
          disarmAutostart(
            emuRef.current,
            playModeRef.current === "cart" || cartLiveRef.current ? "cart" : undefined,
          );
          if (playModeRef.current === "cart" || cartLiveRef.current) {
            const ssCart = useEmu.getState().fastLoadCart;
            if (isSuperSnapshotCartHint(ssCart)) {
              scheduleSuperSnapshotVicFix(emuRef.current, ssCart);
            }
            bumpCrtPaint(emuRef.current);
          }
          muteC64Space(false);
          s.setBooting(false);
          s.setRunning(true);
          plugJoysticks(emuRef.current, useEmu.getState().joyPort);
          inGameplayRef.current = true;
          clearMenuJoyInput();
          const unlockedTitle = useEmu.getState().currentTitle;
          markSessionPlay(unlockedTitle);
          glog("play-unlock", { title: unlockedTitle, disarmed: true });
          persistGateRef.current = true;
          const vol = useEmu.getState();
          applyEmuVolume(emuRef.current, vol.muted, vol.volume);
          gestureUnlockAudio(emuRef.current);
          scheduleCracktroNudge(unlockedTitle);
          const wantRun =
            basicRunAfterLoadRef.current ||
            (diskRunAfterLoadRef.current && (playModeRef.current === "disk" || playModeRef.current === "auto"));
          basicRunAfterLoadRef.current = false;
          diskRunAfterLoadRef.current = false;
          if (wantRun && playModeRef.current !== "cart") {
            const screen = readScreenText(emuRef.current);
            const trimmed = screen.trim();
            const atBasicReady = /^READY\.?$/m.test(trimmed) || /\bREADY\b/.test(screen);
            const needsRun =
              atBasicReady &&
              !/NOT FOUND|SYNTAX ERROR|FILE NOT OPEN/i.test(screen) &&
              screen.trim().length < 120 &&
              !screenInvitesCracktroInput(screen);
            if (!needsRun) {
              glog("play-skip-run", { head: screen.slice(0, 60) });
            } else {
              const runGen = playLockGen.current;
              window.setTimeout(() => {
                if (playLockGen.current !== runGen) return;
                void typeC64("RUN", { delayMs: 55, cancelled: () => playLockGen.current !== runGen }).then(() => {
                  if (playLockGen.current !== runGen) return;
                  dispatchC64Key("Enter", "Enter", true);
                  window.setTimeout(() => dispatchC64Key("Enter", "Enter", false), 90);
                });
              }, 700);
            }
          }
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
    [s, clearMenuJoyInput, startIosAutoPaint, scheduleCracktroNudge],
  );
  const syncJiffy = useCallback(
    async (emu: typeof emuRef.current, reset: "hard" | "soft" | "none" = "none") => {
      if (!emu) return false;
      const st = useEmu.getState();
      const on = await applyJiffyDos(emu, resolveJiffyWant(st.jiffyDos, st.fastLoadCart));
      if (reset === "hard") hardReset(emu);
      else if (reset === "soft") resetEmu(emu);
      return on;
    },
    [],
  );
  const ejectCartToBasic = useCallback(async () => {
    const emu = emuRef.current;
    const st = useEmu.getState();
    if (!st.powered) {
      toast.message("Power on first — CART OUT");
      return;
    }
    playLockGen.current += 1;
    clearBootTimers();
    cancelSuperSnapshotVicFix();
    glog("cart-out-recycle", { title: st.currentTitle, boot: bootFileOf(emu) });
    playModeRef.current = "basic";
    softwareStdRef.current = null;
    setSoftwareStd(null);
    clearLivePlay();
    clearPlayMarker();
    st.setSessionRestoreHint(null);
    cracktroOnceRef.current = "";
    cartLiveRef.current = false;
    setCartLive(false);
    st.setFastLoadCart(null);
    removeSessionCart();
    persistLibIdRef.current = null;
    persistGateRef.current = false;
    pendingKickRef.current = false;
    playLockRef.current = false;
    bootHoldRef.current = false;
    muteC64Space(false);
    basicRunAfterLoadRef.current = false;
    diskRunAfterLoadRef.current = false;
    setAwaitingStart(false);
    inGameplayRef.current = false;
    bootKickRef.current = true;
    st.setCurrentTitle("BASIC");
    st.setBooting(true, "Ejecting cartridge…", 20);
    st.setInsertedDiskName(null);
    const plan = planPlay({
      filename: "WORK DISK.D64",
      work: true,
      userIec: st.iecDrive,
      userUnit: st.iecUnit,
      liveIec: sessionIecRef.current,
      liveWorkDisk: lastAppliedWorkDisk(),
      autostart: false,
    });
    sessionIecRef.current = plan.live.iec;
    sessionUnitRef.current = plan.live.unit;
    const wantJiffy = resolveJiffyWant(st.jiffyDos, null);
    try {
      // Real hardware: pulling a cart while powered crashes the C64 — never cartEject / hot-unplug.
      // Software power-cycle: tear down WASM and cold-boot WORK DISK (same net effect as power off→on).
      glog("cart-out-power-cycle", { boot: bootFileOf(emu) });
      const el = document.getElementById("grok64-player");
      stopIosPaintWatchdog();
      stopIosCrt();
      resetIosPaintState();
      releaseBlob();
      destroyEmu(emuRef.current, el);
      emuRef.current = null;
      clearUnitMounts();
      cmdSwappedRef.current = false;
      setCmdSwapped(false);
      bootKickRef.current = true;
      inGameplayRef.current = false;
      playModeRef.current = "basic";
      sessionIecRef.current = plan.live.iec;
      sessionUnitRef.current = plan.live.unit;
      st.powerOn();
      st.setBooting(true, "Power cycle — cartridge out…", 12);
      await startWithUrlRef.current(publicUrl("/software/blank.d64"), "WORK DISK.D64", {
        autostart: false,
        title: "BASIC",
        iec: plan.live.iec,
        iecUnit: plan.live.unit,
        userIec: plan.user.iec,
        userUnit: plan.user.unit,
        // After a freezer cart (especially post-Reset), cold-boot stock KERNAL first, then Jiffy.
        coldBasicAfterCart: wantJiffy,
      });
      const playerEl = document.getElementById("grok64-player");
      const t0 = Date.now();
      let readyPaint = false;
      while (Date.now() - t0 < 45_000) {
        const live = emuRef.current;
        if (!live) break;
        const txt = readScreenText(live);
        const compact = txt.replace(/\s+/g, "");
        const ready =
          /\bREADY\.?\b/i.test(txt) &&
          /BASIC|JIFFY|COMMODORE 64/i.test(txt) &&
          !/TURBO|SNAPSHOT|REPLAY|ACTION/i.test(txt) &&
          !/LOAD"[*$]/i.test(txt) &&
          compact.length < 280;
        fitEmu(playerEl, live);
        bumpCrtPaint(live);
        scheduleFit(true);
        if (ready && !useEmu.getState().booting) {
          readyPaint = true;
          break;
        }
        await new Promise((r) => window.setTimeout(r, 150));
      }
      if (!readyPaint) glog("cart-out-ready-timeout", { boot: bootFileOf(emuRef.current) });
      markSessionReady();
      beginColdSession();
      if (useEmu.getState().booting) st.setBooting(false);
      persistGateRef.current = true;
      inGameplayRef.current = true;
      toast.message(
        wantJiffy ? "Cartridge out — power cycled · JiffyDOS READY" : "Cartridge out — power cycled · BASIC READY",
      );
    } catch (err) {
      glog("cart-out-fail", { m: err instanceof Error ? err.message : String(err) });
      st.setBooting(false);
      toast.error(err instanceof Error ? err.message : "Could not eject cartridge");
    }
  }, []);

  const resetReady = useCallback(() => {
    const emu = emuRef.current;
    const st = useEmu.getState();
    const hadCart =
      cartLiveRef.current ||
      playModeRef.current === "cart" ||
      Boolean(st.fastLoadCart) ||
      cartMountedOnCore(emu);
    playLockGen.current += 1;
    clearBootTimers();
    glog("user-reset-ready", {
      prev: playModeRef.current,
      title: st.currentTitle,
      hadCart,
      boot: bootFileOf(emu),
    });
    persistGateRef.current = false;
    pendingKickRef.current = false;
    playLockRef.current = false;
    bootHoldRef.current = false;
    muteC64Space(false);
    basicRunAfterLoadRef.current = false;
    diskRunAfterLoadRef.current = false;
    setAwaitingStart(false);
    st.setBooting(false);
    focusGrok64Player();
    if (hadCart && emu && st.powered) {
      playModeRef.current = "cart";
      cartLiveRef.current = true;
      setCartLive(true);
      disarmAutostart(emu, "cart");
      applyRuntimeOptions(emu, {
        ...CART_PLAY_UNLOCK_VICE_OPTS,
        vice_drive_true_emulation: "enabled",
        vice_virtual_device_traps: "disabled",
        vice_work_disk: "disabled",
      });
      const ssCart = st.fastLoadCart;
      void (async () => {
        await applyJiffyDos(emu, jiffyAllowedDuringCartBoot(st.jiffyDos, ssCart));
        cartBootReset(emu);
        await flushEmuFs(emu, isIosPhone() ? 800 : 400);
        scheduleSuperSnapshotVicFix(emu, ssCart);
        if (ssCart) stabilizeFreezerScreen(emu, ssCart);
        bumpCrtPaint(emu);
      })();
      markSessionPlay(st.currentTitle);
      inGameplayRef.current = true;
      persistGateRef.current = true;
      toast.message("Reset — cartridge restarted");
      return;
    }
    playModeRef.current = "basic";
    clearLivePlay();
    clearPlayMarker();
    cracktroOnceRef.current = "";
    cartLiveRef.current = false;
    setCartLive(false);
    st.setFastLoadCart(null);
    st.setCurrentTitle("BASIC");
    if (emu) {
      disarmAutostart(emu, "disk");
      hardReset(emu);
      applyRuntimeOptions(emu, {
        vice_autostart: "disabled",
        vice_autostart_warp: "disabled",
        vice_autoloadwarp: "disabled",
      });
    }
    markSessionReady();
    inGameplayRef.current = true;
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
    pokeAudioUnlock();
    gestureUnlockAudio(emuRef.current);
    unlockAudio(emuRef.current);
    setPictureHold(false);
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
      if (sessionPhase() === "cold" && !playerCanvasReady(playerEl)) return;
      useEmu.getState().setBooting(false);
      glog("ios-frame-ok", { tag });
    });
  }, [startIosAutoPaint]);
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
          attachGrok64Sd2iec(emu, spec.live.unit);
          setSd2iecJiffyFast(st.jiffyDos);
        }
      } catch {
        /* optional card */
      }
      const st = useEmu.getState();
      const bootFile = bootFileOf(emu);
      const cartBoot = isCartMediaBoot({
        playMode: playModeRef.current,
        bootFile,
        bootName: spec.bootName,
        title: spec.bootName ?? spec.title,
      });
      const jiffyForCart = resolveJiffyWant(st.jiffyDos, st.fastLoadCart);
      const crtBootName =
        cartBoot && emu
          ? (bootFile || spec.bootName || spec.title || "").replace(/^\//, "")
          : null;
      const swStd = softwareStdRef.current;
      if (swStd) {
        applyRuntimeOptions(
          emu,
          videoStandardOptions(
            {
              machineId: st.machineId,
              videoStandard: st.videoStandard,
              coreMode: st.coreMode,
              driveMode: st.driveMode,
            },
            swStd,
          ),
        );
      }
      const coldBasicAfterCart = Boolean(spec.coldBasicAfterCart);
      const prep = await prepareCore(emu, {
        live: spec.live,
        user: spec.user,
        jiffyWant: coldBasicAfterCart ? false : jiffyForCart,
        sdParts: parts,
        driveMap: st.iecMap,
        skipJiffy: cartBoot || coldBasicAfterCart,
      });
      if (loadGenRef.current !== gen) return;
      if (crtBootName && emu && !/\.(crt|bin)$/i.test(bootFileOf(emu) || "")) {
        emu.fileName = crtBootName;
        glog("cart-boot-restore", { file: emu.fileName });
      }
      if (cartBoot && emu) {
        applyRuntimeOptions(emu, { vice_jiffydos: jiffyForCart ? "enabled" : "disabled" });
      }
      glog("core-ready", { ...prep, live: spec.live, user: spec.user, reu: st.reuSize, jiffyForCart, cartBoot });
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
      const cartBootSettle =
        spec.playKind === "cart" ||
        isCartMediaBoot({
          playMode: playModeRef.current,
          bootFile: bootFileOf(emu),
          bootName: spec.bootName,
          title: spec.bootName ?? spec.title,
        });
      if (spec.autostartAfterReady || cartBootSettle) markSessionPlay(spec.title);
      applyEmuVolume(emu, useEmu.getState().muted, useEmu.getState().volume);
      gestureUnlockAudio(emu);
      pendingKickRef.current = false;
      setAwaitingStart(false);
      spec.onStarted?.(emu);
      if (pendingCompanionRef.current.length) {
        writeCompanionMedia(emu, pendingCompanionRef.current);
        pendingCompanionRef.current = [];
      }
      if (cartBootSettle) {
        bootHoldRef.current = false;
        s.setRunning(true);
        setBusy(`Loading ${spec.title}…`, 78);
        if (isIosPhone()) await new Promise((r) => setTimeout(r, 140));
        if (loadGenRef.current !== gen) return;
        const crt = (bootFileOf(emu) || crtBootName || spec.bootName || spec.title || "").replace(
          /^\//,
          "",
        );
        if (crt && emu && /\.(crt|bin)$/i.test(crt)) emu.fileName = crt;
        disarmAutostart(emu, "cart");
        applyRuntimeOptions(emu, {
          ...CART_PLAY_UNLOCK_VICE_OPTS,
          vice_work_disk: "disabled",
          vice_drive_true_emulation: "enabled",
          vice_virtual_device_traps: "disabled",
        });
        const ssCart = useEmu.getState().fastLoadCart;
        await applyJiffyDos(emu, jiffyAllowedDuringCartBoot(st.jiffyDos, ssCart));
        disarmAutostart(emu, "cart");
        applyRuntimeOptions(emu, {
          ...CART_PLAY_UNLOCK_VICE_OPTS,
          vice_work_disk: "disabled",
          vice_drive_true_emulation: "enabled",
          vice_virtual_device_traps: "disabled",
        });
        cartBootReset(emu);
        await flushEmuFs(emu, isIosPhone() ? 800 : 400);
        if (isSuperSnapshotCartHint(ssCart) && ss5TurboBasicWithoutMenu(emu)) {
          glog("cart-ss5-turbo-basic-recover", { phase: "settle" });
          disarmAutostart(emu, "cart");
          cartBootReset(emu);
          await flushEmuFs(emu, isIosPhone() ? 800 : 400);
        }
        scheduleSuperSnapshotVicFix(emu, ssCart);
        if (ssCart) stabilizeFreezerScreen(emu, ssCart);
        dismissEjsPrompts(document.getElementById("grok64-player"));
        bumpCrtPaint(emu);
        window.setTimeout(() => bumpCrtPaint(emu), 400);
        window.setTimeout(() => bumpCrtPaint(emu), 1200);
        scheduleFit(true);
        applyIecUnit(emu, spec.live.iec, spec.live.unit);
        if (isIosPhone()) kickIosAfterEmuAction(emu, "settle", gen);
        const mounted = cartMountedOnCore(emu);
        if (spec.playKind === "cart" || cartBootSettle) {
          const boot = (bootFileOf(emu) || spec.bootName || spec.title || "").replace(/^\//, "");
          const prev = getLastCartPlayDiagnostic();
          recordLastCartPlayDiagnostic({
            fileName: boot || prev?.fileName || spec.title,
            writeBootOk: prev?.writeBootOk ?? true,
            attachCode: cartAttachResultCode(prev?.writeBootOk ?? true, mounted, prev?.hwTypeId ?? null),
            bootFileAfter: bootFileOf(emu),
            cartMountedOnCore: mounted,
            playMode: playModeRef.current,
            fastLoadCart: useEmu.getState().fastLoadCart,
            viceCoreKind: grok64CoreStatus(emu).kind,
          });
        }
        if (mounted) {
          cartLiveRef.current = true;
          setCartLive(true);
        } else if (spec.playKind === "cart" || cartBootSettle) {
          toast.error(
            "Cartridge did not stay mounted after reset. Open About → Last cartridge Play for header bytes and attach code.",
            { duration: 14_000 },
          );
        }
        beginPlayLock(playLockDuration(playModeRef.current, spec.title), `Loading ${spec.title}…`);
      } else if (spec.autostartAfterReady) {
        bootHoldRef.current = false;
        s.setRunning(true);
        setBusy(`Loading ${spec.title}…`, 78);
        if (isIosPhone()) await new Promise((r) => setTimeout(r, 140));
        if (loadGenRef.current !== gen) return;
        autostartAfterReady(emu, true, {
          autoloadWarp: autoloadWarpForPlay(playModeRef.current, spec.title),
        });
        applyIecUnit(emu, spec.live.iec, spec.live.unit);
        if (isIosPhone()) kickIosAfterEmuAction(emu, "settle", gen);
        beginPlayLock(playLockDuration(playModeRef.current, spec.title), `Loading ${spec.title}…`);
      } else {
        if (prep.jiffy) setBusy("Applying JiffyDOS…", 72);
        hardReset(emu);
        if (coldBasicAfterCart && st.jiffyDos) {
          setBusy("Applying JiffyDOS…", 72);
          await applyJiffyDos(emu, true);
          hardReset(emu);
          bumpCrtPaint(emu);
        }
        applyIecUnit(emu, spec.live.iec, spec.live.unit);
        s.setRunning(true);
        // Drive cold BASIC to an observably sized + presented READY.
        // #62's 80ms "settle" storm dispatched ~50 window resizes in 4s and
        // still needed a folder tap on CriOS: rewriting canvas 100%→100% is
        // a no-op that never invalidates a stale 0-box, while the folder
        // sheet's body scroll-lock forced a full relayout. Drive with
        // resize-free presents + sync layout reads + a periodic invisible
        // invalidation nudge (player min-height toggle), with an occasional
        // gesture-path present (canvas focus — the tap-to-show-READY path),
        // until the canvas is observably sized or the budget runs out.
        // Bounded: at cap the boot proceeds exactly as before.
        {
          const playerEl = document.getElementById("grok64-player");
          const screen = playerEl?.closest?.(".g64-screen") as HTMLElement | null;
          const t0 = Date.now();
          const budget = isIosPhone() ? 12000 : 4000;
          let nudge = false;
          let gesturedAt = 0;
          while (Date.now() - t0 < budget) {
            if (loadGenRef.current !== gen) return;
            void playerEl?.offsetWidth;
            if (screen) void screen.offsetWidth;
            fitEmu(playerEl, emu);
            bumpCrtPaint(emu);
            const now = Date.now();
            if (isIosPhone()) {
              if (now - gesturedAt > 2000) {
                gesturedAt = now;
                presentIosCrt(emu, playerEl, { tag: "cold-gesture", fromUserGesture: true });
              } else {
                presentIosCrt(emu, playerEl, "booting");
              }
              nudge = !nudge;
              if (playerEl) playerEl.style.minHeight = nudge ? "0px" : "";
            }
            if (playerCanvasReady(playerEl) && useEmu.getState().running && coreHasFs(emu)) break;
            await new Promise((r) => setTimeout(r, 150));
          }
          if (playerEl) playerEl.style.minHeight = "";
          glog("cold-drive", {
            ms: Date.now() - t0,
            canvas: playerCanvasReady(playerEl),
            running: useEmu.getState().running,
            ios: isIosPhone(),
          });
        }
        if (spec.diskMountReady) {
          setBusy("Disk on unit 8 · READY…", 68);
          await presentFloppyMountReady(emu, spec.live);
          if (loadGenRef.current !== gen) return;
          markSessionPlay(spec.title);
          s.setRunning(true);
        }
        bootHoldRef.current = false;
        markSessionReady();
        setPictureHold(false);
        if (pictureHoldTimer.current) window.clearTimeout(pictureHoldTimer.current);
        if (isIosPhone()) kickIosAfterEmuAction(emu, "ready", gen);
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
    [s, beginPlayLock, kickIosAfterEmuAction, clearMenuJoyInput],
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
      // Refuse BEFORE touching loadGen / timers / gameplay refs: a refused
      // mid-play start must not abort the live session's generation or clear
      // its boot timers on the way out (#62 Paradroid remount class).
      if (
        emuRef.current &&
        shouldRefuseStartRecycle({
          iosPhone: isIosPhone(),
          powered: useEmu.getState().powered,
          playMode: playModeRef.current,
          inGameplay: inGameplayRef.current,
          title: opts.title ?? useEmu.getState().currentTitle,
          livePlay: Boolean(livePlayTitle()),
          coldBasic: isColdBasicStart({ autostart: opts.autostart, title: opts.title }),
        })
      ) {
        glog("start-recycle-refused", { mode: playModeRef.current, title: opts.title ?? gameName });
        persistGateRef.current = true;
        throw new Error("Stay on the live CRT — Play must not remount the splash.");
      }
      cancelSuperSnapshotVicFix();
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
      if (isIosPhone()) {
        // EJS sizes its canvas from this box at construct. A 0-box here
        // (URL bar / dvh settling on CriOS) sticks until something forces
        // layout — the folder sheet did (#62 black-until-folder). Wait for a
        // real box before constructing VICE; bounded, never bricks boot.
        const screen = el.closest?.(".g64-screen") as HTMLElement | null;
        for (let i = 0; i < 30; i++) {
          void el.offsetWidth;
          if (screen) void screen.offsetWidth;
          const w = el.clientWidth;
          const sw = screen?.clientWidth ?? w;
          if (w >= 100 && sw >= 100) break;
          await new Promise((r) => requestAnimationFrame(r));
        }
        glog("boot-layout", {
          pw: el.clientWidth,
          ph: el.clientHeight,
          sw: screen?.clientWidth ?? 0,
          sh: screen?.clientHeight ?? 0,
        });
      } else if (detectDevice() === "tablet") {
        // Wait for the 384:272 glass to contain-fit the bezel. #64 treated
        // sw>=280 as done — that is still a postage stamp on Onn.
        const screen = el.closest?.(".g64-screen") as HTMLElement | null;
        const bezel = el.closest?.(".g64-bezel") as HTMLElement | null;
        for (let i = 0; i < 30; i++) {
          applyTabletContainFit();
          void el.offsetWidth;
          if (screen) void screen.offsetWidth;
          const sw = screen?.clientWidth ?? el.clientWidth;
          const sh = screen?.clientHeight ?? el.clientHeight;
          const avail = bezel ? tabletBezelAvail(bezel) : { w: 0, h: 0 };
          if (tabletGlassFillsBezel(sw, sh, avail.w, avail.h)) break;
          await new Promise((r) => requestAnimationFrame(r));
        }
        glog("boot-layout-tablet", {
          pw: el.clientWidth,
          ph: el.clientHeight,
          sw: screen?.clientWidth ?? 0,
          sh: screen?.clientHeight ?? 0,
          bw: bezel?.clientWidth ?? 0,
          bh: bezel?.clientHeight ?? 0,
        });
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
      const cartStart = playModeRef.current === "cart" || /\.(crt|bin)$/i.test(gameName);
      if (cartStart) {
        const jf = resolveJiffyWant(st.jiffyDos, st.fastLoadCart);
        res.options = {
          ...res.options,
          vice_jiffydos: jf ? "enabled" : "disabled",
        };
      }
      const playDrive = driveForPlay(res.drive, {
        typedDisk: (opts.diskLoad || playModeRef.current === "disk") && !cartStart,
      });
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
        // Refuse-check already ran at entry (before loadGen). Reaching here
        // means recycle is allowed: cold BASIC over a dead core, or a
        // desktop media switch. Never mid-play on iOS (#13).
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
      let settleResolve: () => void = () => {};
      let settleReject: (reason?: unknown) => void = () => {};
      const settleDone = new Promise<void>((res, rej) => {
        settleResolve = res;
        settleReject = rej;
      });
      try {
        const emu = await bootEmulator(el, {
          gameUrl,
          gameName,
          core,
          machineOptions: res.options,
          sidEngine: st.sidEngine,
          sidModel: st.sidModel,
          sid2: st.sid2Address,
          sid2Model: st.sid2Model,
          sid3: st.sid3Address,
          sid3Model: st.sid3Model,
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
            if (loadGenRef.current !== gen) {
              settleResolve();
              return;
            }
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
              bootName: gameName,
              playKind: opts.playKind ?? null,
              autostartAfterReady:
                opts.autostart !== false &&
                playModeRef.current !== "basic" &&
                !opts.diskLoad &&
                opts.playKind !== "cart",
              diskMountReady: Boolean(opts.diskLoad),
              coldBasicAfterCart: Boolean(opts.coldBasicAfterCart),
              live: {
                iec: opts.iec ?? sessionIecRef.current ?? useEmu.getState().iecDrive,
                unit: opts.iecUnit ?? sessionUnitRef.current ?? useEmu.getState().iecUnit,
              },
              user: {
                iec: opts.userIec ?? useEmu.getState().iecDrive,
                unit: opts.userUnit ?? useEmu.getState().iecUnit,
              },
              onStarted: opts.onStarted,
            })
              .then(() => settleResolve())
              .catch((err) => settleReject(err));
          },
          onError: (msg) => {
            settleReject(new Error(msg));
            if (loadGenRef.current === gen) persistGateRef.current = true;
            bootKickRef.current = false;
            s.setBooting(false);
            glog("ejs-error", { m: msg });
            toast.error(msg);
          },
        });
        emuRef.current = emu;
        await settleDone;
      } catch (err) {
        settleReject(err);
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
  startWithUrlRef.current = startWithUrl;
  const playBuffer = useCallback(
    async (filename, data, opts = {}) => {
      await persistNow();
      let mediaName = filename;
      playPayloadRef.current = { filename: mediaName, data, opts };
      const playUnit = opts.iecUnit ?? useEmu.getState().iecUnit;
      setIecDevice(playUnit);
      let payload = data;
      let bootNameOverride = opts.bootName ?? null;
      const raw = new Uint8Array(data);
      const work = isWorkDisk(mediaName) || opts.title === "BASIC" || opts.title === "BASIC READY";
      if (!work && isWorkDiskImage(raw)) {
        if (opts.libraryId) {
          await removeFile(opts.libraryId);
          s.setLibrary(await listLibrary());
        }
        toast.error("That copy is empty. Grab the game again from Catalog.");
        return;
      }
      const detected = work ? null : detectSoftwareStandard({ names: [mediaName, opts.title], data: raw });
      softwareStdRef.current = detected;
      setSoftwareStd(detected);
      if (kindOf(filename) === "sid" || isSid(raw)) {
        try {
          const prg = psidToPrg(raw);
          payload = toArrayBuffer(prg);
          bootNameOverride = bootFileName(filename.replace(/\.sid$/i, "") + ".prg", "prg");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not play SID");
          return;
        }
      }
      if (/\.(reu|nuv)$/i.test(mediaName)) {
        try {
          const base = mediaName.replace(/\.(reu|nuv)$/i, "") || "nuvie-play";
          const playerUrl = publicUrl("/system/vice/nuvieplayer1.0.prg");
          let playerBuf: ArrayBuffer | null = null;
          try {
            const res = await fetch(playerUrl);
            if (res.ok) playerBuf = await res.arrayBuffer();
          } catch {
            /* optional bundled player */
          }
          if (!playerBuf || playerBuf.byteLength < 64) {
            const res = await fetch(
              "http://csdb.dk/getinternalfile.php/110242/nuvieplayer1.0.prg",
            );
            if (!res.ok) throw new Error("NUVIE player missing");
            playerBuf = await res.arrayBuffer();
          }
          useEmu.getState().setReuSize(C64OS_REU);
          if (emuRef.current) {
            applyRuntimeOptions(emuRef.current, { vice_ram_expansion_unit: C64OS_REU });
            if (useEmu.getState().running) {
              hardReset(emuRef.current);
            }
          }
          const { zipSync } = await import("fflate");
          const boot = `${base}.prg`;
          const zip = zipSync({
            [boot]: new Uint8Array(playerBuf),
            [`${base}.reu`]: raw,
          });
          payload = toArrayBuffer(zip);
          bootNameOverride = boot;
          mediaName = `${base}.zip`;
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not open REU / NUVIE");
          return;
        }
      }
      pendingCompanionRef.current = [];
      if (kindOf(filename) === "zip") {
        const parts = explodeArchive(filename, new Uint8Array(payload));
        const bootPick = opts.bootName
          ? parts.find((p) => p.name.toLowerCase() === opts.bootName!.toLowerCase()) ??
            pickBootFile(parts, opts.title)
          : pickBootFile(parts, opts.title);
        if (!bootPick) {
          toast.error("No playable file in that archive.");
          return;
        }
        pendingCompanionRef.current = parts
          .filter((p) => p.name !== bootPick.name)
          .map((p) => ({ name: p.name, data: p.data }));
        payload = toArrayBuffer(bootPick.data);
        mediaName = bootPick.name;
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
      const payloadView = new Uint8Array(safe);
      const bootName = resolvePlayBootName(mediaName, payloadView, bootNameOverride);
      const origKind = kindOf(bootName);
      basicRunAfterLoadRef.current =
        !work && opts.autostart !== false && (origKind === "prg" || origKind === "p00") && isBasicPrg(payloadView);
      const diskLoad = !work && needsTypedBoot(origKind);
      const user = userAttachFromMap(useEmu.getState().iecMap);
      const userIec = user.iec;
      const userUnit = user.unit;
      const liveIec = sessionIecRef.current;
      const liveWork = lastAppliedWorkDisk();
      const jiffyWantSetting = useEmu.getState().jiffyDos;
      const jiffyLive = lastAppliedJiffy();
      const forceCart = isCartridgePayload(payloadView, bootName);
      const plan = planPlay({
        filename: bootName,
        work,
        payload: payloadView,
        userIec,
        userUnit,
        liveIec,
        liveWorkDisk: liveWork,
        autostart: opts.autostart !== false,
        iosPhone: isIosPhone(),
        jiffyWant: jiffyWantSetting,
        jiffyLive,
      });
      persistLibIdRef.current =
        opts.libraryId && !work && plan.kind === "floppy" && isDiskKind(kindOf(bootName))
          ? opts.libraryId
          : null;
      if (!work && (plan.kind === "cart" || forceCart)) {
        const cartValidation = validateCartForPlay(
          payloadView,
          bootName,
          opts.libraryStoredSize ?? null,
        );
        publishCartAttachDiag({
          fileName: bootName,
          libraryId: opts.libraryId ?? null,
          idbStoredSize: opts.libraryStoredSize ?? null,
          payload: payloadView,
          validation: cartValidation,
          viceCoreKind: grok64CoreStatus(emuRef.current).kind,
          playMode: playModeRef.current,
        });
        if (!cartValidation.ok) {
          toast.error(cartValidation.userMessage, { duration: 12_000 });
          s.setBooting(false);
          return;
        }
      }
      const bootBeforeCartPlay = bootFileOf(emuRef.current) || "";
      const cartNeedsWasmRecycle =
        (forceCart || plan.kind === "cart") &&
        (playModeRef.current === "basic" ||
          /WORK DISK|BLANK\.D64/i.test(bootBeforeCartPlay) ||
          /\.d64$/i.test(bootBeforeCartPlay));
      if (forceCart || plan.kind === "cart") playModeRef.current = "cart";
      const playTitle = opts.title ?? filename;
      const hadCartBefore = cartLiveRef.current;
      const keepCartAcrossDiskEarly = hadCartBefore && plan.kind === "floppy" && !work;
      let sessionFastCart = useEmu.getState().fastLoadCart;
      if (plan.kind === "cart") {
        sessionFastCart = detectFastLoadCartFromPayload(payloadView, bootName, playTitle);
        useEmu.getState().setFastLoadCart(sessionFastCart);
        if (sessionFastCart && jiffyWantSetting) {
          const compat = jiffyCartCompat(sessionFastCart, true);
          if (compat.suppressJiffy) {
            toast.message(compat.summary, { duration: 9000 });
          } else if (compat.warnIfJiffyOn) {
            toast.message(compat.title, { description: compat.summary, duration: 9000 });
          }
        }
      } else if (!keepCartAcrossDiskEarly) {
        sessionFastCart = null;
        useEmu.getState().setFastLoadCart(null);
      }
      const jiffyWant = resolveJiffyWant(jiffyWantSetting, sessionFastCart);
      // Freezer/fast-load carts (e.g. Super Snapshot) handle LOAD/RUN — extra RUN → READY (#QA).
      diskRunAfterLoadRef.current =
        !work && plan.autostartAfterReady && plan.kind === "floppy" && !sessionFastCart;
      const attach = plan.attach;
      // Hard lock: CriOS never logs `hot-swap` (Tom #35 / #37 → DNP).
      // After READY, recycle is in-place on the live canvas (#18/#30).
      // WASM destroyEmu after READY is known-failure #13.
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
        iec: plan.live.iec,
        unit: plan.live.unit,
        userIec,
        userUnit,
        fromIec: liveIec,
        fromWork: liveWork,
        canHotSwap,
        recycle: plan.recycle,
        jiffyWant,
        jiffyLive,
        ios: isIosPhone(),
        keepLiveCrt: iosPlayKeepsLiveCrt({
          iosPhone: isIosPhone(),
          hasLiveFs: Boolean(emuRef.current && coreHasFs(emuRef.current)),
          kind: plan.kind,
        }),
        mustKeep: iosMustKeepLiveCore({
          iosPhone: isIosPhone(),
          ios: isIos(),
          powered: useEmu.getState().powered,
          hasEmu: Boolean(emuRef.current),
          kind: plan.kind,
        }),
      });
      if (work) workDiskBytesRef.current = new Uint8Array(safe);
      if (!work && opts.libraryId) {
        await deleteSaveState(opts.libraryId);
      }
      const waitLive = shouldWaitForLiveCore({
        iosPhone: isIosPhone(),
        ios: isIos(),
        powered: useEmu.getState().powered,
        kind: plan.kind,
        work,
      });
      if (waitLive || (emuRef.current && !coreHasFs(emuRef.current))) {
        s.setBooting(true, "Waiting for VICE…");
        const t0 = Date.now();
        const budget = waitLive ? (isIosPhone() ? 45000 : 16000) : 8000;
        while (Date.now() - t0 < budget) {
          const fs = Boolean(emuRef.current && coreHasFs(emuRef.current));
          const bootFile = bootFileOf(emuRef.current);
          const canvasReady = !isIosPhone() || playerCanvasReady();
          // One session gate: READY/play + mounted #8 name. Do not attach
          // (or Autostart-reset) during cold bootHold or on a nameless disk.
          if (
            sessionCanAttach({
              hasFs: fs,
              bootHold: bootHoldRef.current,
              running: useEmu.getState().running,
              bootFile,
              canvasReady,
              iosPhone: isIosPhone(),
            })
          ) {
            break;
          }
          await new Promise((r) => setTimeout(r, 80));
        }
        glog("play-wait-core", {
          emu: Boolean(emuRef.current),
          fs: Boolean(emuRef.current && coreHasFs(emuRef.current)),
          hold: bootHoldRef.current,
          running: useEmu.getState().running,
          bootFile: bootFileOf(emuRef.current),
          canvas: playerCanvasReady(),
          phase: sessionPhase(),
          ms: Date.now() - t0,
          waitLive,
        });
      }
      if (
        waitLive &&
        !sessionCanAttach({
          hasFs: Boolean(emuRef.current && coreHasFs(emuRef.current)),
          bootHold: bootHoldRef.current,
          running: useEmu.getState().running,
          bootFile: bootFileOf(emuRef.current),
          canvasReady: !isIosPhone() || playerCanvasReady(),
          iosPhone: isIosPhone(),
        })
      ) {
        glog("play-wait-timeout", {
          emu: Boolean(emuRef.current),
          fs: Boolean(emuRef.current && coreHasFs(emuRef.current)),
          hold: bootHoldRef.current,
          running: useEmu.getState().running,
          bootFile: bootFileOf(emuRef.current),
          phase: sessionPhase(),
        });
        useEmu.getState().setBooting(false);
        toast.error("Play stayed on the live CRT — C64 is still starting.");
        return;
      }
      playModeRef.current =
        plan.kind === "floppy"
          ? "disk"
          : plan.kind === "basic"
            ? "basic"
            : plan.kind === "cart"
              ? "cart"
              : "auto";
      if (plan.kind === "cart") {
        setSessionCart(bootName, new Uint8Array(safe));
      }
      const hadCart = cartLiveRef.current;
      if (plan.kind === "cart" || forceCart) {
        cartLiveRef.current = false;
        setCartLive(false);
      } else {
        cartLiveRef.current = hadCart && plan.kind === "floppy";
        setCartLive(cartLiveRef.current);
      }
      const keepCartAcrossDisk = hadCart && plan.kind === "floppy" && !work;
      sessionIecRef.current = plan.live.iec;
      sessionUnitRef.current = plan.live.unit;
      setPictureHold(false);
      const title = opts.title ?? filename;
      if (!work) markSessionPlay(title);
      // Mid-play reload recovery: remember the last successfully attached
      // title + how to rehydrate it. Saved ONLY on attach success (below) —
      // never here at tap time, never for BASIC/work.
      const notePlayMarker = () => {
        if (work) {
          clearPlayMarker();
          return;
        }
        savePlayMarker({
          title,
          filename,
          libraryId: opts.libraryId ?? null,
          bundlePath: opts.bundlePath ?? null,
          iecUnit: playUnit,
        });
      };
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
      const mustKeep = iosMustKeepLiveCore({
        iosPhone: isIosPhone(),
        ios: isIos(),
        powered: useEmu.getState().powered,
        hasEmu: Boolean(emuRef.current),
        kind: plan.kind,
      });
      const live = Boolean(emuRef.current && coreHasFs(emuRef.current));
      const keepLiveCrt = iosPlayKeepsLiveCrt({
        iosPhone: isIosPhone(),
        hasLiveFs: live,
        kind: plan.kind,
      });
      const floppyKeep = mustKeep && plan.kind === "floppy";
      let media = payloadView;
      if (plan.kind === "floppy" && origKind === "d64" && !forceCart) {
        media = prepareAutostartDisk(media, bootName, title);
      }
      const wrapped = wrapForDiskSwap(origKind, media, bootName);
      const diskBytes = wrapped ?? (isDiskKind(origKind) ? media : null);
      if ((((live && (canHotSwap || keepLiveCrt)) || floppyKeep) && emuRef.current && diskBytes && plan.kind === "floppy" && !forceCart)) {
        const payloadDisk = diskBytes;
        const playIec = attach?.iec ?? plan.live.iec;
        const playAttachUnit = attach?.unit ?? plan.live.unit;
        s.setBooting(true, plan.status, 35);
        // Overwrite the mounted unit-8 image only. A new filename leaves
        // the blank work disk attached → FILE NOT FOUND (#60/#61).
        const mounted = inPlaceAutostartTarget(bootFileOf(emuRef.current), bootName);
        const wrote = mounted
          ? attach
            ? attachAutostartDisk(
                emuRef.current,
                payloadDisk,
                filename || bootName || mounted,
                playIec,
                playAttachUnit,
              )
            : swapBootDisk(emuRef.current, payloadDisk, mounted)
          : false;
        if (wrote) {
          emuRef.current.fileName = mounted;
          if (plan.kind === "floppy" && !work) {
            useEmu.getState().setInsertedDiskName(filename);
          }
          if (canHotSwap) {
            glog("hot-swap", {
              filename,
              title,
              kind: origKind,
              iec: sessionIecRef.current,
              unit: sessionUnitRef.current,
              workDisk: workDiskFor(sessionIecRef.current, sessionUnitRef.current),
            });
          } else {
            glog("play-recycle-inplace", {
              filename,
              title,
              kind: origKind,
              iec: sessionIecRef.current,
              unit: sessionUnitRef.current,
              workDisk: workDiskFor(sessionIecRef.current, sessionUnitRef.current),
              keepLiveCrt: true,
            });
          }
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
          if (pendingCompanionRef.current.length) {
            writeCompanionMedia(emuRef.current, pendingCompanionRef.current);
            pendingCompanionRef.current = [];
          }
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
            vice_reset: keepCartAcrossDisk ? "autostart" : "hard",
            vice_ram_expansion_unit: stNow.reuSize,
            ...(plan.trueDrive || attach
              ? {
                  ...(attach
                    ? { vice_work_disk: workDiskFor(playIec, playAttachUnit) }
                    : {}),
                  vice_drive_true_emulation: "enabled",
                  vice_virtual_device_traps: "disabled",
                }
              : {}),
            ...viceJoyOptions(useEmu.getState().joyPort),
          });
          if (attach) applyIecUnit(emuRef.current, playIec, playAttachUnit);
          const flushed = await flushEmuFs(emuRef.current, isIosPhone() ? 2000 : 800);
          if (attach && plan.kind === "floppy") {
            await refreshViceWorkDisk(emuRef.current, playAttachUnit);
          }
          glog("play-mount", { flushed, workDisk: lastAppliedWorkDisk(), ios: isIosPhone() });
          await prepareCore(emuRef.current, {
            live: plan.live,
            user: plan.user,
            jiffyWant: resolveJiffyWant(stNow.jiffyDos, stNow.fastLoadCart),
            skipJiffy: true,
            driveMap: stNow.iecMap,
          });
          await applyJiffyDos(emuRef.current, resolveJiffyWant(stNow.jiffyDos, stNow.fastLoadCart));
          if (plan.kind === "floppy" && !work) {
            useEmu.getState().setInsertedDiskName(filename);
          }
          applyIecUnit(emuRef.current, playIec, playAttachUnit);
          plugJoysticks(emuRef.current, useEmu.getState().joyPort);
          // #13: never reset paint / wipe the live canvas on in-place Play.
          if (isIosPhone() && !keepLiveCrt && !mustKeep) resetIosPaintState();
          s.setCurrentTitle(title);
          if (!work) markSessionPlay(title);
          notePlayMarker();
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
          } else if (plan.kind === "floppy") {
            disarmAutostart(emuRef.current, "disk");
            await presentFloppyMountReady(emuRef.current, plan.live);
            applyIecUnit(emuRef.current, playIec, playAttachUnit);
            if (isIosPhone()) kickIosAfterEmuAction(emuRef.current, keepLiveCrt || floppyKeep ? "play-recycle" : "hot-swap");
            beginPlayLock(playLockDuration(playModeRef.current, title), `Mounted ${title}…`);
          } else {
            autostartAfterReady(emuRef.current, true, {
              autoloadWarp: autoloadWarpForPlay(playModeRef.current, bootName),
            });
            applyIecUnit(emuRef.current, playIec, playAttachUnit);
            if (isIosPhone()) kickIosAfterEmuAction(emuRef.current, keepLiveCrt || floppyKeep ? "play-recycle" : "hot-swap");
            beginPlayLock(playLockDuration(playModeRef.current, title), `Loading ${title}…`);
          }
          return;
        }
        if (keepLiveCrt || floppyKeep) {
          glog("play-inplace-failed", { filename, title, kind: origKind, mustKeep });
          useEmu.getState().setBooting(false);
          toast.error("Could not mount that disk on the live 1541.");
          return;
        }
      }
      if (floppyKeep) {
        glog("play-inplace-no-fs", { filename, title, kind: origKind });
        useEmu.getState().setBooting(false);
        toast.error("Play stayed on the live CRT — disk did not attach.");
        return;
      }
      if (mustKeep && live && iosInPlaceMediaKind(plan.kind) && emuRef.current) {
        s.setBooting(true, plan.status, 35);
        const wrote = writeBootFile(emuRef.current, media, bootName);
        if (wrote) {
          emuRef.current.fileName = bootName.replace(/^\//, "");
          glog("play-recycle-inplace", {
            filename,
            title,
            kind: origKind,
            media: plan.kind,
            keepLiveCrt: true,
          });
          persistGateRef.current = false;
          inGameplayRef.current = false;
          pendingKickRef.current = false;
          setAwaitingStart(false);
          clearBootTimers();
          s.setCurrentTitle(title);
          markSessionPlay(title);
          notePlayMarker();
          s.setRunning(true);
          if (plan.kind === "floppy") {
            disarmAutostart(emuRef.current, "disk");
            await presentFloppyMountReady(emuRef.current, plan.live);
            beginPlayLock(playLockDuration(playModeRef.current, title), `Mounted ${title}…`);
          } else {
            autostartAfterReady(emuRef.current, true, {
              autoloadWarp: autoloadWarpForPlay(playModeRef.current, bootName),
            });
            beginPlayLock(playLockDuration(playModeRef.current, title), `Loading ${title}…`);
          }
          if (isIosPhone()) kickIosAfterEmuAction(emuRef.current, "play-recycle");
          scheduleFit(true);
          return;
        }
        glog("play-inplace-failed", { filename, title, kind: origKind, mustKeep, media: plan.kind });
        useEmu.getState().setBooting(false);
        toast.error("Play stayed on the live CRT — cartridge did not attach.");
        return;
      }
      if (mustKeep && iosInPlaceMediaKind(plan.kind)) {
        glog("play-inplace-no-fs", { filename, title, kind: origKind, media: plan.kind });
        useEmu.getState().setBooting(false);
        toast.error("Play stayed on the live CRT — cartridge did not attach.");
        return;
      }
      if (
        (plan.kind === "cart" || forceCart) &&
        isIosPhone() &&
        emuRef.current &&
        coreHasFs(emuRef.current) &&
        cartMountedOnCore(emuRef.current) &&
        !cartNeedsWasmRecycle
      ) {
        s.setBooting(true, plan.status, 35);
        const fastCart = detectFastLoadCartFromPayload(payloadView, bootName, playTitle);
        useEmu.getState().setFastLoadCart(fastCart);
        const attached = await attachCartridgeInPlace(
          emuRef.current,
          new Uint8Array(safe),
          bootName,
          { jiffyDos: jiffyWantSetting, fastCart },
        );
        publishCartAttachDiag({
          fileName: bootName,
          libraryId: opts.libraryId ?? null,
          idbStoredSize: opts.libraryStoredSize ?? null,
          payload: payloadView,
          writeBootOk: attached.writeBoot,
          mounted: attached.mounted,
          bootFileAfter: bootFileOf(emuRef.current),
          playMode: "cart",
          fastLoadCart: fastCart,
          viceCoreKind: grok64CoreStatus(emuRef.current).kind,
        });
        if (attached.ok) {
          playModeRef.current = "cart";
          cartLiveRef.current = true;
          setCartLive(true);
          scheduleSuperSnapshotVicFix(emuRef.current, fastCart);
          persistGateRef.current = true;
          inGameplayRef.current = true;
          pendingKickRef.current = false;
          setAwaitingStart(false);
          clearBootTimers();
          s.setCurrentTitle(title);
          markSessionPlay(title);
          notePlayMarker();
          s.setRunning(true);
          s.setBooting(false);
          dismissEjsPrompts(document.getElementById("grok64-player"));
          bumpCrtPaint(emuRef.current);
          beginPlayLock(playLockDuration("cart", title), `Loading ${title}…`);
          glog("cart-inplace", { bootName, fastCart });
          return;
        }
        glog("cart-inplace-fail-recycle", { bootName });
      }
      if (
        cartNeedsWasmRecycle &&
        (plan.kind === "cart" || forceCart) &&
        emuRef.current &&
        coreHasFs(emuRef.current) &&
        isIosPhone()
      ) {
        s.setBooting(true, plan.status, 35);
        const fastCart = detectFastLoadCartFromPayload(payloadView, bootName, playTitle);
        useEmu.getState().setFastLoadCart(fastCart);
        const emu = emuRef.current;
        const cartBytes = new Uint8Array(safe);
        if (writeBootFile(emu, cartBytes, bootName)) {
          emu.fileName = bootName.replace(/^\//, "");
          setSessionCart(bootName, cartBytes);
          playModeRef.current = "cart";
          cartLiveRef.current = true;
          setCartLive(true);
          disarmAutostart(emu, "cart");
          applyRuntimeOptions(emu, {
            ...CART_PLAY_UNLOCK_VICE_OPTS,
            vice_work_disk: "disabled",
            vice_drive_true_emulation: "enabled",
            vice_virtual_device_traps: "disabled",
          });
          const jiffyOnCart = jiffyAllowedDuringCartBoot(jiffyWantSetting, fastCart);
          await applyJiffyDos(emu, jiffyOnCart);
          await flushEmuFs(emu, isIosPhone() ? 800 : 400);
          cartBootReset(emu);
          await flushEmuFs(emu, isIosPhone() ? 800 : 400);
          scheduleSuperSnapshotVicFix(emu, fastCart);
          if (fastCart) stabilizeFreezerScreen(emu, fastCart);
          persistGateRef.current = true;
          inGameplayRef.current = true;
          pendingKickRef.current = false;
          setAwaitingStart(false);
          clearBootTimers();
          s.setCurrentTitle(title);
          markSessionPlay(title);
          notePlayMarker();
          s.setRunning(true);
          s.setBooting(false);
          dismissEjsPrompts(document.getElementById("grok64-player"));
          bumpCrtPaint(emu);
          beginPlayLock(playLockDuration("cart", title), `Loading ${title}…`);
          publishCartAttachDiag({
            fileName: bootName,
            libraryId: opts.libraryId ?? null,
            idbStoredSize: opts.libraryStoredSize ?? null,
            payload: payloadView,
            writeBootOk: true,
            mounted: cartMountedOnCore(emu),
            bootFileAfter: bootFileOf(emu),
            playMode: "cart",
            fastLoadCart,
            viceCoreKind: grok64CoreStatus(emu).kind,
          });
          glog("cart-warm-boot", { bootName, fastCart, jiffyOnCart });
          return;
        }
        publishCartAttachDiag({
          fileName: bootName,
          libraryId: opts.libraryId ?? null,
          idbStoredSize: opts.libraryStoredSize ?? null,
          payload: payloadView,
          writeBootOk: false,
          mounted: false,
          bootFileAfter: bootFileOf(emuRef.current),
          playMode: "cart",
          fastLoadCart,
          viceCoreKind: grok64CoreStatus(emuRef.current).kind,
        });
        glog("cart-warm-boot-fail", { bootName });
      }
      const stayLive =
        waitLive ||
        mustKeep ||
        (isIos() && useEmu.getState().powered && !work && sessionPhase() !== "off");
      if (stayLive) {
        glog("play-start-refused", {
          filename,
          title,
          kind: origKind,
          waitLive,
          mustKeep,
          live,
          phase: sessionPhase(),
        });
        useEmu.getState().setBooting(false);
        toast.error("Play stayed on the live CRT — did not remount the splash.");
        return;
      }
      if ((plan.kind === "cart" || forceCart) && emuRef.current) {
        const el = document.getElementById("grok64-player");
        const onCore = cartMountedOnCore(emuRef.current);
        const bootNow = bootFileOf(emuRef.current) || "";
        const normBoot = (n: string) => n.replace(/^\//, "").toLowerCase();
        const switchingCart =
          onCore &&
          bootNow &&
          normBoot(bootName) !== normBoot(bootNow) &&
          /\.(crt|bin)$/i.test(bootNow);
        if (
          cartNeedsWasmRecycle ||
          !onCore ||
          /WORK DISK/i.test(bootNow) ||
          switchingCart ||
          (!isIosPhone() && onCore)
        ) {
          glog("cart-play-wasm-recycle", {
            bootName,
            boot: bootNow,
            onCore,
            cartNeedsWasmRecycle,
            switchingCart,
          });
          destroyEmu(emuRef.current, el);
          emuRef.current = null;
          clearUnitMounts();
        }
      }
      const blob = new Blob([toArrayBuffer(media)]);
      const url = URL.createObjectURL(blob);
      blobRef.current = url;
      await startWithUrl(url, bootName, {
        autostart: plan.autostartAfterReady,
        playKind: plan.kind,
        diskLoad: diskLoad && !forceCart && plan.kind !== "cart",
        title,
        iec: plan.live.iec,
        iecUnit: plan.live.unit,
        userIec: plan.user.iec,
        userUnit: plan.user.unit,
      });
      if (plan.kind === "cart" || forceCart) {
        const mounted = Boolean(emuRef.current && cartMountedOnCore(emuRef.current));
        publishCartAttachDiag({
          fileName: bootName,
          libraryId: opts.libraryId ?? null,
          idbStoredSize: opts.libraryStoredSize ?? null,
          payload: payloadView,
          writeBootOk: true,
          mounted,
          bootFileAfter: bootFileOf(emuRef.current),
          playMode: playModeRef.current,
          fastLoadCart: useEmu.getState().fastLoadCart,
          viceCoreKind: grok64CoreStatus(emuRef.current).kind,
        });
        if (!mounted) {
          toast.error(
            "Cartridge did not attach in VICE (CRT may be corrupt or the wrong build). Open About → Last cart Play for header bytes and attach code.",
            { duration: 14_000 },
          );
        } else {
          cartLiveRef.current = true;
          setCartLive(true);
          const ssCart = useEmu.getState().fastLoadCart;
          if (isSuperSnapshotCartHint(ssCart) && emuRef.current) {
            const emuSnap = emuRef.current;
            window.setTimeout(() => {
              const live = emuRef.current;
              if (!live || live !== emuSnap) return;
              if (!ss5TurboBasicWithoutMenu(live)) return;
              glog("cart-ss5-turbo-recover-post-play", {});
              disarmAutostart(live, "cart");
              cartBootReset(live);
              void flushEmuFs(live, 600).then(() => {
                scheduleSuperSnapshotVicFix(live, ssCart);
                stabilizeFreezerScreen(live, ssCart);
                bumpCrtPaint(live);
              });
            }, 3200);
          }
        }
      }
      notePlayMarker();
    },
    [s, persistNow, startWithUrl, beginPlayLock, syncJiffy],
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
        await playBuffer(name, buf, { autostart: true, title: title.name, bundlePath: title.path });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Load failed");
      }
    },
    [playBuffer, s],
  );
  const playLocal = useCallback(
    async (item, meta?: { catalogKey?: string; title?: string }) => {
      s.setLibraryOpen(false);
      const file = await getFile(item.id);
      if (!file) {
        toast.error("That file is missing.");
        return;
      }
      if (
        meta?.catalogKey &&
        file.catalogKey &&
        file.catalogKey !== meta.catalogKey
      ) {
        toast.error("That file doesn't match the catalog title you picked. Search again and tap Play.");
        return;
      }
      const localKind = kindOf(file.name);
      const mountOnlyDisk =
        isDiskKind(localKind) || isGeosFamilyDiskName(file.name) || needsTypedBoot(localKind);
      await playBuffer(file.name, file.data, {
        autostart: !mountOnlyDisk,
        title: meta?.title ?? item.catalogTitle ?? item.name,
        libraryId: item.id,
        libraryStoredSize: file.size,
        iecUnit: item.iecUnit,
      });
      await touchPlayed(item.id);
    },
    [playBuffer, s, endPlayLock],
  );
  playLocalRef.current = playLocal;
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
    const boot = bootFileName(file.name, kind);
    const mounted = bootFileOf(emuRef.current);
    const ok = mounted
      ? attachAutostartDisk(emuRef.current, media, mounted, iec, unit)
      : mountDiskOnUnit(emuRef.current, unit, media, boot, iec);
    if (!ok) {
      toast.error("Could not mount that disk");
      return;
    }
    bootPathRef.current = mounted ?? boot;
    if (mounted) emuRef.current.fileName = mounted.replace(/^\//, "");
    const FS = emuRef.current?.Module?.FS ?? emuRef.current?.gameManager?.FS;
    for (const stale of ["blank.d64", "/blank.d64", "BLANK.D64"]) {
      try {
        FS?.unlink?.(stale);
      } catch {
        /* missing */
      }
    }
    applyRuntimeOptions(emuRef.current, {
      vice_drive_true_emulation: "enabled",
      vice_virtual_device_traps: "disabled",
    });
    await flushEmuFs(emuRef.current, 600);
    await touchPlayed(item.id);
    const label = d64DiskName(media) ?? item.name.replace(/\.[a-z0-9]{2,4}$/i, "");
    setSessionDisk(item.name, media, unit);
    useEmu.getState().setInsertedDiskName(item.name);
    focusGrok64Player();
    toast.success(`Inserted ${label} on drive ${unit}`);
  }, []);
  const toggleWarp = useCallback(() => {
    const next = !useEmu.getState().warped;
    useEmu.getState().setWarped(next);
    setWarp(emuRef.current, next);
  }, []);
  toggleWarpRef.current = toggleWarp;
  const powerOn = useCallback(() => {
    const st = useEmu.getState();
    if (st.powered && (coreHasFs(emuRef.current) || bootKickRef.current)) {
      if (st.booting) dismissEjsPrompts(document.getElementById("grok64-player"), "boot");
      else resumePlayback();
      return;
    }
    bootKickRef.current = true;
    inGameplayRef.current = false;
    playLockRef.current = false;
    cartLiveRef.current = false;
    setCartLive(false);
    useEmu.getState().setFastLoadCart(null);
    beginColdSession();
    useEmu.getState().setInsertedDiskName(null);
    cracktroOnceRef.current = "";
    pokeAudioUnlock();
    gestureUnlockAudio(emuRef.current);
    if (isIosPhone()) {
      setPictureHold(true);
      if (pictureHoldTimer.current) window.clearTimeout(pictureHoldTimer.current);
      pictureHoldTimer.current = window.setTimeout(() => setPictureHold(false), 16000);
    }
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
            persistLibIdRef.current = disk.id;
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
  const powerOff = useCallback(() => {
    const st = useEmu.getState();
    if (!st.powered && !st.booting) return;
    glog("power-off");
    playLockRef.current = false;
    bootHoldRef.current = false;
    bootKickRef.current = false;
    clearLivePlay();
    clearPlayMarker();
    clearSession();
    beginColdSession();
    playModeRef.current = "basic";
    cartLiveRef.current = false;
    setCartLive(false);
    st.setFastLoadCart(null);
    persistLibIdRef.current = null;
    muteC64Space(false);
    const el = document.getElementById("grok64-player");
    destroyEmu(emuRef.current, el);
    emuRef.current = null;
    clearUnitMounts();
    releaseBlob();
    st.powerOff();
    st.setSessionRestoreHint(null);
    setPictureHold(false);
    if (pictureHoldTimer.current) window.clearTimeout(pictureHoldTimer.current);
    toast.message("Powered off");
  }, []);
  powerOnRef.current = powerOn;
  powerOffRef.current = powerOff;
  const recoverBoot = useCallback(() => {
    const st = useEmu.getState();
    if (
      !shouldRecoverBoot({
        playMode: playModeRef.current,
        playLock: playLockRef.current,
        inGameplay: inGameplayRef.current,
        powered: st.powered,
        hasFs: Boolean(emuRef.current && coreHasFs(emuRef.current)),
        title: st.currentTitle,
        livePlay: Boolean(livePlayTitle()),
      })
    ) {
      if (st.powered && (playModeRef.current !== "basic" || livePlayTitle() || inGameplayRef.current)) {
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
    beginColdSession();
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
      if (
        !shouldDropToSplash({
          playMode: playModeRef.current,
          playLock: playLockRef.current,
          inGameplay: inGameplayRef.current,
          powered: useEmu.getState().powered,
          hasFs: Boolean(emuRef.current && coreHasFs(emuRef.current)),
          title: useEmu.getState().currentTitle,
          livePlay: Boolean(livePlayTitle()),
        })
      ) {
        glog("boot-recover-fail-kept", { mode: playModeRef.current });
        return;
      }
      clearSession();
      useEmu.setState({ powered: false, booting: false, running: false });
      toast.error("The C64 didn’t start. Tap power to try again.");
    });
  }, [startWithUrl]);
  useEffect(() => {
    const t = window.setTimeout(() => recoverBoot(), 80);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    // Mid-play reload (CriOS tab OOM/crash, SW update): powered resets to
    // the splash while sessionStorage survives. Restore the live session
    // instead of stranding Tom on the power button. One-shot per load; the
    // 80ms recoverBoot above refuses while live-play is set, so this effect
    // owns the reboot. If rehydrate fails the splash stays, honest.
    if (crashRecoverStarted) return;
    if (useEmu.getState().powered) return;
    const live = livePlayTitle();
    const marker = readPlayMarker();
    if (!live || !marker) return;
    if (!marker.libraryId && !marker.bundlePath) {
      clearPlayMarker();
      return;
    }
    crashRecoverStarted = true;
    void (async () => {
      try {
        let payload: { name: string; data: ArrayBuffer } | null = null;
        if (marker.libraryId) {
          const file = await getFile(marker.libraryId);
          if (file) payload = { name: file.name, data: file.data };
        }
        if (!payload && marker.bundlePath) {
          const res = await fetch(publicUrl(marker.bundlePath));
          if (res.ok) {
            payload = {
              name: marker.bundlePath.split("/").pop() || marker.filename,
              data: await res.arrayBuffer(),
            };
          }
        }
        if (!payload) {
          clearPlayMarker();
          clearSession();
          return;
        }
        glog("crash-recover", { title: marker.title, filename: marker.filename });
        powerOnRef.current();
        const recoverView = new Uint8Array(payload.data);
        const recoverKind = kindOf(payload.name);
        const recoverCart = isCartridgePayload(recoverView, payload.name);
        const recoverMountOnly =
          isDiskKind(recoverKind) || needsTypedBoot(recoverKind) || isGeosFamilyDiskName(payload.name);
        await playBufferRef.current(payload.name, payload.data, {
          autostart: !(recoverMountOnly || recoverCart),
          title: marker.title,
          libraryId: marker.libraryId ?? undefined,
          bundlePath: marker.bundlePath ?? undefined,
          iecUnit: marker.iecUnit ?? undefined,
        });
        // Attach success re-saves the marker (powerOn cleared it). If the
        // attach failed, say so honestly instead of claiming a restore.
        if (readPlayMarker()) {
          useEmu.getState().setSessionRestoreHint(marker.title);
          toast.message(`Restored ${marker.title} — tap for sound`);
        } else {
          clearLivePlay();
          markSessionReady();
          toast.error(`Could not restore ${marker.title} — tap Software to replay.`);
        }
      } catch {
        clearPlayMarker();
      }
    })();
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
      if (playModeRef.current !== "basic" || inGameplayRef.current || livePlayTitle()) {
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
      if (
        !shouldDropToSplash({
          playMode: playModeRef.current,
          playLock: playLockRef.current,
          inGameplay: inGameplayRef.current,
          powered: useEmu.getState().powered,
          hasFs: Boolean(emuRef.current && coreHasFs(emuRef.current)),
          title: useEmu.getState().currentTitle,
          livePlay: Boolean(livePlayTitle()),
        })
      ) {
        useEmu.getState().setBooting(false);
        if (coreHasFs(emuRef.current) || useEmu.getState().running) {
          useEmu.getState().setRunning(true);
        }
        glog("boot-stuck-kept", { mode: playModeRef.current });
        return;
      }
      clearSession();
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
    const cold = sessionPhase() === "cold" || bootHoldRef.current;
    if (isIosPaintSettled() && playerCanvasReady() && !cold) return;
    const playerEl = document.getElementById("grok64-player");
    if (!s.booting && !s.running && !cold) return;
    if (s.booting || cold || (s.running && (!isIosPaintSettled() || !playerCanvasReady()))) {
      presentIosCrt(emuRef.current, playerEl, s.booting || cold ? "booting" : "running");
      startIosAutoPaint(() => {
        if (bootHoldRef.current || playLockRef.current) return;
        if (sessionPhase() === "cold" && !playerCanvasReady()) return;
        useEmu.getState().setBooting(false);
      });
    }
  }, [s.powered, s.booting, s.running, startIosAutoPaint]);
  useEffect(() => {
    if (!s.running) return;
    const kick = () => {
      applyTabletContainFit();
      const el = document.getElementById("grok64-player");
      fitEmu(el, emuRef.current, detectDevice() === "tablet");
    };
    const a = window.setTimeout(kick, 80);
    const b = window.setTimeout(kick, 400);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [s.running, cartLive]);
  useEffect(() => {
    setGrok64KeyboardPaintHook((emu) => bumpCrtPaint(emu ?? emuRef.current));
    setC64HardwareKeySink((code, key, down, mods) =>
      grok64RetroKeyboardFromDom(emuRef.current, code, key, down, mods),
    );
    return () => {
      setGrok64KeyboardPaintHook(null);
      setC64HardwareKeySink(null);
    };
  }, []);
  useEffect(() => {
    if (!s.running) return;
    const onHostKey = (e: KeyboardEvent) => {
      if (!useEmu.getState().running) return;
      const freezerFn = /^F[1-8]$/.test(e.code) && (cartLiveRef.current || useEmu.getState().fastLoadCart);
      if (playLockRef.current && !freezerFn) return;
      if (!grok64RetroKeyboardAvailable(emuRef.current)) return;
      const target = e.target;
      if (target instanceof Element && target.closest(".g64-kb, .g64-sheet")) return;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      if (isJoyFireKey(e.code)) return;
      const down = e.type === "keydown";
      if (down && e.repeat) return;
      const handled = grok64RetroKeyboardFromDom(emuRef.current, e.code, e.key, down, {
        shift: e.shiftKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
      });
      if (!handled) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onBlur = () => grok64KeyboardReleaseAll(emuRef.current);
    window.addEventListener("keydown", onHostKey, true);
    window.addEventListener("keyup", onHostKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onHostKey, true);
      window.removeEventListener("keyup", onHostKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [s.running]);
  useEffect(() => {
    if (
      !shouldDismissPictureHold({
        hold: pictureHold,
        booting: s.booting,
        running: s.running,
        paintSettled: isIosPaintSettled() && (!isIosPhone() || playerCanvasReady()),
      })
    ) {
      return;
    }
    setPictureHold(false);
    if (pictureHoldTimer.current) window.clearTimeout(pictureHoldTimer.current);
  }, [pictureHold, s.booting, s.running]);
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
      muteC64Space(false);
      if (pictureHoldTimer.current) window.clearTimeout(pictureHoldTimer.current);
      destroyEmu(emuRef.current, document.getElementById("grok64-player"));
      releaseBlob();
    };
  }, []);
  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === "visible") {
        if (audioLocked(emuRef.current)) unlockAudio(emuRef.current);
        pokeAudioUnlock();
        gestureUnlockAudio(emuRef.current);
        applyEmuVolume(emuRef.current, useEmu.getState().muted, useEmu.getState().volume);
      } else if (!(isIosPhone() && (inGameplayRef.current || livePlayTitle() || playModeRef.current !== "basic"))) {
        // CriOS: a brief hide (control center) + suspend leaves AL stuck —
        // resume() after visible is not a user gesture.
        suspendAudio(emuRef.current);
      }
    };
    document.addEventListener("visibilitychange", vis);
    const unlock = () => {
      if (audioLocked(emuRef.current)) unlockAudio(emuRef.current);
      gestureUnlockAudio(emuRef.current);
      applyEmuVolume(emuRef.current, useEmu.getState().muted, useEmu.getState().volume);
    };
    window.addEventListener("g64-unlock", unlock);
    const gesture = () => {
      pokeAudioUnlock();
      gestureUnlockAudio(emuRef.current);
      applyEmuVolume(emuRef.current, useEmu.getState().muted, useEmu.getState().volume);
    };
    window.addEventListener("pointerdown", gesture, { capture: true });
    window.addEventListener("touchstart", gesture, { capture: true, passive: true });
    window.addEventListener("keydown", gesture, { capture: true });
    const onKeyFit = (ev: KeyboardEvent) => {
      if (ev.code === "F5" || ev.key === "F5") scheduleFit(true);
    };
    window.addEventListener("keydown", onKeyFit);
    onBeforeC64Space(() => disarmAutostart(emuRef.current));
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("g64-unlock", unlock);
      window.removeEventListener("pointerdown", gesture, true);
      window.removeEventListener("touchstart", gesture, true);
      window.removeEventListener("keydown", gesture, true);
      window.removeEventListener("keydown", onKeyFit);
      onBeforeC64Space(null);
    };
  }, []);
  useEffect(() => {
    applyEmuVolume(emuRef.current, s.muted, s.volume);
    if (!s.muted) {
      pokeAudioUnlock();
      unlockAudio(emuRef.current);
      gestureUnlockAudio(emuRef.current);
    }
  }, [s.muted, s.volume]);
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
    gestureUnlockAudio(emuRef.current);
    applyEmuVolume(emuRef.current, useEmu.getState().muted, useEmu.getState().volume);
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
    gestureUnlockAudio(emuRef.current);
    applyEmuVolume(emuRef.current, st.muted, st.volume);
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
      const st = useEmu.getState();
      if (mapHasDrive(st.iecMap, "sd2iec") && st.running && !playLockRef.current) {
        void tickGrok64Iec(emu);
      }
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
      repaintAfterCartFreeze(emuRef.current);
      stabilizeFreezerScreen(emuRef.current, useEmu.getState().fastLoadCart);
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
    if (action === "cart-eject") {
      await ejectCartToBasic();
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
      const disks = parts.flatMap((p) => {
        const d64ish = p.files.filter((f) => /\.(d64|d71|d81|g64|g71)$/i.test(f.name));
        if (d64ish.length) {
          return d64ish.map((f) => ({ name: f.name, data: new Uint8Array(f.data) }));
        }
        if (p.files.length) {
          return [];
        }
        return [];
      });
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
  swapJoyPortRef.current = swapJoyPort;
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
    const emu = emuRef.current;
    if (!emu || !s.running || playLockRef.current) return;
    if (!mapHasDrive(s.iecMap, "sd2iec")) return;
    const unit = Number(Object.entries(s.iecMap).find(([, v]) => v === "sd2iec")?.[0] ?? 8) as 8 | 9 | 10 | 11;
    void (async () => {
      const parts = await partitionsForMount();
      const ok = remountSd2iecFromParts(emu, unit, parts);
      if (ok) {
        glog("sd2iec-live-remount", {
          unit,
          files: parts.reduce((n, p) => n + p.files.length, 0),
        });
      }
    })();
  }, [s.iecMap, s.running]);
  useEffect(() => {
    const emu = emuRef.current;
    if (!emu || !s.running || playLockRef.current) return;
    if (!mapHasDrive(s.iecMap, "sd2iec")) return;
    const unit = Number(Object.entries(s.iecMap).find(([, v]) => v === "sd2iec")?.[0] ?? 8) as 8 | 9 | 10 | 11;
    const onCard = () => {
      void partitionsForMount().then((parts) => {
        remountSd2iecFromParts(emu, unit, parts);
        attachSd2iecBus(emu, unit);
      });
    };
    window.addEventListener("g64-sd2iec-card", onCard);
    return () => window.removeEventListener("g64-sd2iec-card", onCard);
  }, [s.iecMap, s.running]);
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
  useEffect(() => {
    if (s.libraryOpen || s.settingsOpen || s.aboutOpen || diskOpen) setRailMoreOpen(false);
  }, [s.libraryOpen, s.settingsOpen, s.aboutOpen, diskOpen]);

  useEffect(() => {
    const anyOverlay =
      s.libraryOpen || s.settingsOpen || s.aboutOpen || diskOpen || s.mapperOpen || s.snapsOpen;
    if (!anyOverlay && s.powered) {
      const id = window.requestAnimationFrame(() => focusGrok64Player());
      return () => window.cancelAnimationFrame(id);
    }
    return undefined;
  }, [s.libraryOpen, s.settingsOpen, s.aboutOpen, diskOpen, s.mapperOpen, s.snapsOpen, s.powered]);
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
    "data-hold": pictureHold ? "true" : "false",
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
      {s.powered && s.sessionRestoreHint ? (
        <div className="g64-restore-banner" role="status">
          Resumed your last session — <strong>{s.sessionRestoreHint}</strong>. Use <strong>CART OUT</strong> to eject; Reset restarts the cartridge.
        </div>
      ) : null}
      <header className="g64-top" hidden={!s.powered}>
        <div className="g64-top-brand">
          <h1>Grok64</h1>
          <BuildId />
        </div>
        <div className="g64-top-rail">
          {resolved.device === "phone" ? (
          <>
          <button type="button" className="g64-iconbtn g64-rail-act g64-rail-kb" data-on={s.showKeyboard} aria-label="Keyboard" title="Keyboard" onClick={() => s.setShowKeyboard(!s.showKeyboard)}>
            <KeyboardIcon className="size-5" />
          </button>
          <button
            type="button"
            className="g64-iconbtn g64-rail-act g64-rail-pause"
            aria-label={s.paused ? "Resume" : "Pause"}
            title={s.paused ? "Resume" : "Pause"}
            onClick={() => {
              const next = !s.paused;
              s.setPaused(next);
              setPaused(emuRef.current, next);
            }}
          >
            {s.paused ? <Play className="size-5" /> : <Pause className="size-5" />}
          </button>
          <button type="button" className="g64-iconbtn g64-rail-act g64-rail-mute" data-on={s.muted} aria-label={s.muted ? "Unmute" : "Mute"} title={s.muted ? "Unmute" : "Mute"} onClick={() => s.setMuted(!s.muted)}>
            {s.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          </>
          ) : null}
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
                        : spec.id === "cart-fz" || spec.id === "cart-out"
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
        <div className="g64-top-pin">
        <button
          type="button"
          className="g64-iconbtn g64-power-toggle g64-power-pin"
          aria-label="Power off"
          title="Power off"
          onClick={() => powerOff()}
        >
          <Power className="size-5 g64-iconbtn-icon" aria-hidden="true" />
          <span className="g64-iconbtn-label">Power</span>
        </button>
        <button type="button" className="g64-iconbtn g64-software" data-on={s.libraryOpen} aria-label="Software" title="Software" onClick={() => s.setLibraryOpen(true)}>
          <FolderOpen className="size-5 g64-iconbtn-icon" aria-hidden="true" />
          <span className="g64-iconbtn-label">Software</span>
        </button>
        <button type="button" className="g64-iconbtn g64-disk" data-on={diskOpen} aria-label="Insert disk" title="Load disk" onClick={() => setDiskOpen(true)}>
          <Disc3 className="size-5 g64-iconbtn-icon" aria-hidden="true" />
          <span className="g64-iconbtn-label">Load disk</span>
        </button>
        {railMoreOpen ? (
          <button
            type="button"
            className="g64-rail-more-dismiss"
            aria-label="Close menu"
            onClick={() => setRailMoreOpen(false)}
          />
        ) : null}
        <div className="g64-top-overflow" data-open={railMoreOpen ? "true" : "false"}>
        <button
          type="button"
          className="g64-iconbtn g64-rail-more"
          aria-label="More"
          aria-expanded={railMoreOpen}
          aria-haspopup="true"
          data-on={railMoreOpen ? "true" : "false"}
          onClick={() => setRailMoreOpen((open) => !open)}
        >
          <MoreHorizontal className="size-5" />
        </button>
        <div className="g64-top-icons">
        <button type="button" className="g64-iconbtn g64-rail-dup" data-on={s.showKeyboard} aria-label="Keyboard" onClick={() => { setRailMoreOpen(false); s.setShowKeyboard(!s.showKeyboard); }}>
          <KeyboardIcon className="size-5 g64-iconbtn-icon" aria-hidden="true" />
          <span className="g64-iconbtn-label">Keyboard</span>
        </button>
        <button
          type="button"
          className="g64-iconbtn extra g64-rail-dup"
          aria-label={s.paused ? "Resume" : "Pause"}
          onClick={() => {
            setRailMoreOpen(false);
            const next = !s.paused;
            s.setPaused(next);
            setPaused(emuRef.current, next);
          }}
        >
          {s.paused ? <Play className="size-5 g64-iconbtn-icon" aria-hidden="true" /> : <Pause className="size-5 g64-iconbtn-icon" aria-hidden="true" />}
          <span className="g64-iconbtn-label">{s.paused ? "Resume" : "Pause"}</span>
        </button>
        <button
          type="button"
          className="g64-iconbtn extra g64-power-toggle"
          aria-label="Power off"
          title="Power off"
          onClick={() => {
            setRailMoreOpen(false);
            powerOff();
          }}
        >
          <Power className="size-5 g64-iconbtn-icon" aria-hidden="true" />
          <span className="g64-iconbtn-label">Power</span>
        </button>
        <button
          type="button"
          className="g64-iconbtn extra g64-reset"
          aria-label="Reset"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.code === "Space" || e.key === " " || e.code === "Enter") {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onKeyUp={(e) => {
            if (e.code === "Space" || e.key === " " || e.code === "Enter") {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onClick={() => {
            setRailMoreOpen(false);
            resetReady();
          }}
        >
          <RotateCcw className="size-5 g64-iconbtn-icon" aria-hidden="true" />
          <span className="g64-iconbtn-label">Reset</span>
        </button>
        <button type="button" className="g64-iconbtn extra g64-rail-dup" data-on={s.muted} aria-label={s.muted ? "Unmute" : "Mute"} onClick={() => { setRailMoreOpen(false); s.setMuted(!s.muted); }}>
          {s.muted ? <VolumeX className="size-5 g64-iconbtn-icon" aria-hidden="true" /> : <Volume2 className="size-5 g64-iconbtn-icon" aria-hidden="true" />}
          <span className="g64-iconbtn-label">{s.muted ? "Unmute" : "Mute"}</span>
        </button>
        <button type="button" className="g64-iconbtn" aria-label="Settings" onClick={() => { setRailMoreOpen(false); s.setSettingsOpen(true); }}>
          <Settings className="size-5 g64-iconbtn-icon" aria-hidden="true" />
          <span className="g64-iconbtn-label">Settings</span>
        </button>
        <button type="button" className="g64-iconbtn extra" aria-label="About" onClick={() => { setRailMoreOpen(false); s.setAboutOpen(true); }}>
          <Info className="size-5 g64-iconbtn-icon" aria-hidden="true" />
          <span className="g64-iconbtn-label">About</span>
        </button>
        </div>
        </div>
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
            className={s.running || s.powered ? "g64-screen is-on" : "g64-screen"}
            onPointerDown={(e) => {
              focusGrok64Player();
              pokeAudioUnlock();
              gestureUnlockAudio(emuRef.current);
              unlockAudio(emuRef.current);
              setPictureHold(false);
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
            {s.booting || pictureHold ? (
            <div className="g64-boot" data-hold={pictureHold && !s.booting ? "true" : "false"} aria-live="polite" aria-busy="true">
              <div className="g64-boot-copy">
                {s.booting
                  ? s.bootMsg || "Loading…"
                  : "Please hold — picture is coming…"}
              </div>
              <div className="g64-boot-bar" aria-hidden="true">
                <i style={{ width: `${Math.max(8, Math.min(100, s.booting ? s.bootProgress || 12 : 55))}%` }} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {s.powered && (resolved.device === "phone" || resolved.device === "tablet") ? (
        <QuickDock
          paused={s.paused}
          onDisk={() => setDiskOpen(true)}
          onReset={() => resetReady()}
          onSnapshot={() => s.setSnapsOpen(true)}
          onPauseToggle={() => {
            const next = !s.paused;
            s.setPaused(next);
            setPaused(emuRef.current, next);
          }}
          onWarp={toggleWarp}
          onSwapJoy={swapJoyPort}
        />
      ) : null}
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
        onPlay={(i, meta) => void playLocal(i, meta)}
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
