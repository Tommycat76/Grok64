// @ts-nocheck — large loosely-typed emulator shell; runtime is covered by Playwright QA.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Disc3, FolderOpen, Gamepad2, Info, Keyboard as KeyboardIcon, Pause, Play, Power, RotateCcw, Settings, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { C64Keyboard } from "@/components/emu/Keyboard";
import { TouchControls } from "@/components/emu/Joystick";
import { LibrarySheet } from "@/components/emu/LibrarySheet";
import { DiskMountSheet } from "@/components/emu/DiskMountSheet";
import { SettingsSheet } from "@/components/emu/SettingsSheet";
import { copyBuffer, getFile, listLibrary, putSaveState, deleteSaveState, touchPlayed, updateFileData, ensureWorkDisk, isWorkDisk, removeFile } from "@/lib/emu/library";
import { useEmu } from "@/lib/emu/store";
import { applyRuntimeOptions, audioLocked, autostartReset, bootEmulator, bootFileOf, captureState, clearRetroSaves, coreHasFs, destroyEmu, dismissEjsPrompts, ensureRuntime, fitEmu, hardReset, hasRealGamepad, joyInput, listRealGamepads, plugJoysticks, readMountedMedia, recycleCore, resetEmu, setJoyVector, setPaused, setWarp, unlockAudio, viceJoyOptions, writeBootFile } from "@/lib/emu/host";
import { detectLine, resolveMachine } from "@/lib/emu/machines";
import { snapshotDevice, readViewport, applyViewport } from "@/lib/emu/detect";
import { detectJoyPort, detectSoftwareStandard } from "@/lib/emu/region";
import { RETRO_BTN } from "@/lib/emu/types";
import { dispatchC64Key, isJoyFireKey } from "@/lib/emu/keys";
import { bootFileName, driveForPlay, d64DiskName, isDiskKind, isWorkDiskImage, kindOf, needsTypedBoot } from "@/lib/emu/formats";
import { wrapForDiskSwap } from "@/lib/emu/d64";
import { isSid, psidToPrg } from "@/lib/emu/psid";
import { toArrayBuffer } from "@/lib/emu/archive";
import { glog, glogFire, subscribeLog } from "@/lib/emu/debug";

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
  const fireArmedAt = useRef(0);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [awaitingStart, setAwaitingStart] = useState(false);
  const [diskOpen, setDiskOpen] = useState(false);
  const [logLines, setLogLines] = useState([]);
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
  useEffect(() => {
    let busy = false;
    const last = { width: 0, height: 0, orient: "" };
    const update = () => {
      if (busy) return;
      busy = true;
      try {
        const next = snapshotDevice();
        setSnap(next);
        snapRef.current = next;
        const vp = applyViewport(readViewport());
        const changed = last.width !== vp.width || last.height !== vp.height || last.orient !== vp.orient;
        last.width = vp.width;
        last.height = vp.height;
        last.orient = vp.orient;
        if (changed) setView(vp);
        scheduleFit();
      } finally {
        busy = false;
      }
    };
    update();
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener?.("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    const so = screen.orientation;
    so?.addEventListener?.("change", update);
    return () => {
      mq.removeEventListener?.("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      so?.removeEventListener?.("change", update);
    };
  }, []);
  useEffect(() => {
    const timers = scheduleFit();
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [s.showKeyboard, view.orient]);
  useEffect(() => {
    void ensureRuntime().catch(() => undefined);
  }, []);
  useEffect(() => {
    void listLibrary().then(s.setLibrary);
  }, [s.setLibrary]);
  useEffect(() => {
    const w = window;
    w.__g64 = {
      playMode: () => playModeRef.current,
      title: () => useEmu.getState().currentTitle,
      bootPath: () => bootPathRef.current,
      hasFs: () => coreHasFs(emuRef.current),
      fileName: () => emuRef.current?.fileName ?? null,
      power: () => powerOnRef.current(),
      powered: () => useEmu.getState().powered,
      running: () => useEmu.getState().running,
      booting: () => useEmu.getState().booting,
      playLock: () => playLockRef.current,
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
        setJoyVector(emuRef.current, joyRef.current.x, joyRef.current.y, down);
      },
      stick: (x, y) => {
        joyRef.current.x = x;
        joyRef.current.y = y;
        setStickViz({ x, y });
        setJoyVector(emuRef.current, x, y, joyRef.current.fire);
      },
      load: async (path, name) => {
        const res = await fetch(path);
        const buf = await res.arrayBuffer();
        await playBufferRef.current(name, buf, { autostart: true, title: name });
        return true;
      },
      pad: () => useEmu.getState().padName,
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
          const c = document.querySelector("#grok64-player canvas");
          if (!c || c.width < 8) return null;
          const url = c.toDataURL("image/png");
          const b64 = url.split(",")[1] || "";
          return { b64, w: c.width, h: c.height, bytes: b64.length };
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
  useEffect(() => subscribeLog(setLogLines), []);
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
        useEmu.getState().setBooting(false);
        useEmu.getState().setRunning(true);
      }
      if (canvas && (canvas.width < 64 || canvas.height < 64)) {
        fitEmu(root, emuRef.current);
      }
      const locked = audioLocked(emuRef.current);
      setNeedsUnlock(locked && !useEmu.getState().booting && useEmu.getState().running);
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
  const beginPlayLock = useCallback(
    (ms, msg) => {
      playLockGen.current += 1;
      const gen = playLockGen.current;
      playLockRef.current = true;
      bootHoldRef.current = true;
      persistGateRef.current = false;
      inGameplayRef.current = false;
      joyRef.current.fire = false;
      joyRef.current.x = 0;
      joyRef.current.y = 0;
      setJoyVector(emuRef.current, 0, 0, false);
      s.setBooting(true, msg);
      s.setRunning(true);
      glog("play-lock", { ms, msg, gen });
      bootTimersRef.current.push(
        window.setTimeout(() => {
          if (playLockGen.current !== gen) return;
          playLockRef.current = false;
          bootHoldRef.current = false;
          fireArmedAt.current = Date.now() + 400;
          setWarp(emuRef.current, false);
          applyRuntimeOptions(emuRef.current, {
            vice_autostart_warp: "disabled",
            vice_autoloadwarp: "disabled",
          });
          s.setBooting(false);
          s.setRunning(true);
          plugJoysticks(emuRef.current, useEmu.getState().joyPort);
          glog("play-unlock", { title: useEmu.getState().currentTitle });
          persistGateRef.current = true;
        }, ms),
      );
      bootTimersRef.current.push(
        window.setTimeout(() => {
          if (playLockGen.current !== gen) return;
          inGameplayRef.current = true;
        }, Math.max(ms + 4e3, 2e4)),
      );
    },
    [s],
  );
  const kickAutostart = useCallback(() => {
    glog("kickAutostart", { mode: playModeRef.current, title: useEmu.getState().currentTitle });
    pendingKickRef.current = false;
    setAwaitingStart(false);
    setNeedsUnlock(false);
    persistGateRef.current = false;
    inGameplayRef.current = false;
    unlockAudio(emuRef.current);
    setPaused(emuRef.current, false);
    setWarp(emuRef.current, false);
    useEmu.getState().setWarped(false);
    clearRetroSaves(emuRef.current);
    autostartReset(emuRef.current, playModeRef.current === "disk");
    beginPlayLock(playModeRef.current === "disk" ? 12e3 : 4e3, "Restarting…");
  }, [beginPlayLock]);
  const resumePlayback = useCallback(() => {
    unlockAudio(emuRef.current);
    dismissEjsPrompts(document.getElementById("grok64-player"), "play");
    setNeedsUnlock(false);
    s.setPaused(false);
    setPaused(emuRef.current, false);
    pendingKickRef.current = false;
    setAwaitingStart(false);
    glog("resumePlayback");
  }, [s]);
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
      const playDrive = driveForPlay(res.drive, { typedDisk: !!opts.diskLoad });
      const hz = res.standard === "ntsc" ? "NTSC 60" : "PAL 50";
      s.setBooting(true, opts.autostart === false ? `Cold start · ${hz}…` : `Loading ${opts.title ?? gameName} · ${hz}…`);
      setNeedsUnlock(false);
      glog("boot-begin", {
        game: gameName,
        core: res.core,
        autostart: opts.autostart !== false,
        pw: el.clientWidth,
        ph: el.clientHeight,
        sw: el.parentElement?.clientWidth ?? 0,
        sh: el.parentElement?.clientHeight ?? 0,
      });
      if (emuRef.current) {
        await recycleCore(emuRef.current, el);
        emuRef.current = null;
      } else {
        destroyEmu(null, el);
      }
      bootHoldRef.current = opts.autostart === false;
      try {
        const emu = await bootEmulator(el, {
          gameUrl,
          gameName,
          core: res.core,
          machineOptions: res.options,
          sidEngine: st.sidEngine,
          sidModel: st.sidModel,
          driveMode: playDrive,
          joyPort: st.joyPort,
          volume: st.muted ? 0 : st.volume,
          autostart: opts.autostart !== false,
          onStart: () => {
            if (loadGenRef.current !== gen) return;
            bootPathRef.current = bootFileOf(emu) || gameName;
            if (opts.autostart === false) {
              applyRuntimeOptions(emu, {
                vice_autostart: "disabled",
                vice_autostart_warp: "disabled",
                vice_autoloadwarp: "disabled",
                ...(opts.diskLoad
                  ? {
                      vice_drive_true_emulation: "enabled",
                      vice_virtual_device_traps: "disabled",
                    }
                  : {}),
              });
            }
            const finish = () => {
              if (loadGenRef.current !== gen) return;
              bootHoldRef.current = false;
              s.setBooting(false);
              s.setRunning(true);
              s.setCurrentTitle(opts.title ?? gameName);
              try {
                plugJoysticks(emu, st.joyPort);
                glog("joy-bound", { slot: emu.gamepadSelection?.[0] ?? null });
              } catch {}
              opts.onStarted?.(emu);
              glog("core-start", {
                title: opts.title ?? gameName,
                diskLoad: !!opts.diskLoad,
                autostart: opts.autostart !== false,
              });
              unlockAudio(emu);
              setPaused(emu, false);
              try {
                emu.paused = false;
                emu.gameManager?.toggleMainLoop(1);
              } catch {}
              fitEmu(document.getElementById("grok64-player"), emu);
              bootTimersRef.current.push(window.setTimeout(() => fitEmu(document.getElementById("grok64-player"), emu), 250));
              if (audioLocked(emu)) {
                pendingKickRef.current = false;
                setAwaitingStart(false);
                setNeedsUnlock(true);
              } else {
                pendingKickRef.current = false;
                setAwaitingStart(false);
                if (opts.autostart !== false && playModeRef.current !== "basic") {
                  const lockMs = playModeRef.current === "disk" ? 12e3 : 3500;
                  beginPlayLock(lockMs, `Loading ${opts.title ?? gameName}…`);
                } else {
                  bootTimersRef.current.push(
                    window.setTimeout(() => {
                      if (loadGenRef.current === gen) {
                        persistGateRef.current = true;
                        inGameplayRef.current = true;
                      }
                    }, 2e3),
                  );
                }
              }
            };
            if (opts.autostart === false) {
              const wait = () => {
                if (loadGenRef.current !== gen) return;
                if (!emu.gameManager?.setVariable) {
                  bootTimersRef.current.push(window.setTimeout(wait, 200));
                  return;
                }
                applyRuntimeOptions(emu, {
                  vice_autostart: "disabled",
                  vice_autostart_warp: "disabled",
                  vice_autoloadwarp: "disabled",
                  ...(opts.diskLoad
                    ? {
                        vice_drive_true_emulation: "enabled",
                        vice_virtual_device_traps: "disabled",
                      }
                    : {}),
                });
                bootTimersRef.current.push(window.setTimeout(finish, opts.diskLoad ? 400 : 1400));
              };
              bootTimersRef.current.push(window.setTimeout(wait, 200));
              return;
            }
            finish();
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
    [s, beginPlayLock],
  );
  const playBuffer = useCallback(
    async (filename, data, opts = {}) => {
      await persistNow();
      libIdRef.current = opts.libraryId ?? null;
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
      playModeRef.current = work ? "basic" : needsTypedBoot(origKind) ? "disk" : "auto";
      glog("play", { filename, kind: origKind, diskLoad, work, bytes: safe.byteLength });
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
      const media = new Uint8Array(safe);
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
      const wrapped = wrapForDiskSwap(origKind, media, bootName);
      if (live && emuRef.current && (wrapped || origKind === "d64")) {
        const payloadDisk = wrapped ?? media;
        const wrote = writeBootFile(emuRef.current, payloadDisk, bootFileOf(emuRef.current));
        if (wrote) {
          glog("hot-swap", { filename, title, kind: origKind });
          persistGateRef.current = false;
          inGameplayRef.current = false;
          pendingKickRef.current = false;
          setAwaitingStart(false);
          clearBootTimers();
          clearRetroSaves(emuRef.current);
          applyRuntimeOptions(emuRef.current, {
            vice_autostart: work ? "disabled" : "enabled",
            vice_autostart_warp: work ? "disabled" : "enabled",
            vice_autoloadwarp: work ? "disabled" : "enabled",
            vice_reset: work ? "hard" : "autostart",
            ...viceJoyOptions(useEmu.getState().joyPort),
          });
          if (work) hardReset(emuRef.current);
          else resetEmu(emuRef.current);
          plugJoysticks(emuRef.current, useEmu.getState().joyPort);
          s.setCurrentTitle(title);
          s.setRunning(true);
          if (work) {
            playLockRef.current = false;
            bootHoldRef.current = false;
            s.setBooting(false);
            bootTimersRef.current.push(
              window.setTimeout(() => {
                persistGateRef.current = true;
                inGameplayRef.current = true;
              }, 2e3),
            );
          } else {
            beginPlayLock(playModeRef.current === "disk" ? 12e3 : 3500, `Loading ${title}…`);
          }
          return;
        }
      }
      const blob = new Blob([safe]);
      const url = URL.createObjectURL(blob);
      blobRef.current = url;
      await startWithUrl(url, bootName, {
        autostart: work ? false : opts.autostart !== false,
        diskLoad,
        title,
      });
    },
    [s, persistNow, startWithUrl, beginPlayLock],
  );
  playBufferRef.current = playBuffer;
  const playBundled = useCallback(
    async (title) => {
      try {
        s.setLibraryOpen(false);
        const res = await fetch(title.path);
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
      await playBuffer(file.name, file.data, { autostart: true, title: item.name, libraryId: item.id });
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
    const ok = writeBootFile(emuRef.current, media, bootFileOf(emuRef.current));
    if (!ok) {
      toast.error("Could not mount that disk");
      return;
    }
    await touchPlayed(item.id);
    const label = d64DiskName(media) ?? item.name.replace(/\.[a-z0-9]{2,4}$/i, "");
    toast.success(`Inserted ${label}`);
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
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx({ latencyHint: "interactive" });
      if (ctx.state === "suspended") void ctx.resume();
    } catch {}
    st.setBooting(true, "Cold start…");
    st.powerOn();
    glog("power-on", { ua: navigator.userAgent.slice(0, 80) });
    void startWithUrl("/software/blank.d64", "WORK DISK.D64", {
      autostart: false,
      title: "BASIC",
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
    if (!st.powered) return;
    if (emuRef.current && coreHasFs(emuRef.current)) return;
    if (bootKickRef.current) return;
    glog("boot-recover", { booting: st.booting, running: st.running });
    st.setRunning(false);
    st.setBooting(true, "Starting Commodore 64…");
    bootKickRef.current = true;
    void startWithUrl("/software/blank.d64", "WORK DISK.D64", {
      autostart: false,
      title: "BASIC",
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
    const id = window.setTimeout(() => {
      if (!useEmu.getState().booting) return;
      if (playLockRef.current) return;
      if (coreHasFs(emuRef.current)) {
        useEmu.getState().setBooting(false);
        useEmu.getState().setRunning(true);
        return;
      }
      dismissEjsPrompts(document.getElementById("grok64-player"), "boot");
      glog("boot-stuck");
      if (!recoverOnceRef.current) {
        recoverOnceRef.current = true;
        recoverBoot();
        return;
      }
      useEmu.setState({ powered: false, booting: false, running: false });
      toast.error("The C64 didn’t start. Tap power to try again.");
    }, 14000);
    return () => window.clearTimeout(id);
  }, [s.powered, s.booting, recoverBoot]);
  useEffect(() => {
    if (!s.running) return;
    recoverOnceRef.current = false;
    const kick = () => {
      fitEmu(document.getElementById("grok64-player"), emuRef.current);
      window.dispatchEvent(new Event("resize"));
    };
    const a = window.setTimeout(kick, 50);
    const b = window.setTimeout(kick, 400);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
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
        unlockAudio(emuRef.current);
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          const dummy = new Ctx();
          if (dummy.state === "suspended") void dummy.resume();
        } catch {}
      }
    };
    document.addEventListener("visibilitychange", vis);
    const unlock = () => unlockAudio(emuRef.current);
    window.addEventListener("g64-unlock", unlock);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("g64-unlock", unlock);
    };
  }, []);
  const onVector = useCallback((x, y) => {
    if (playLockRef.current || useEmu.getState().booting) return;
    unlockAudio(emuRef.current);
    setPaused(emuRef.current, false);
    try {
      emuRef.current && (emuRef.current.paused = false);
    } catch {}
    joyRef.current.x = x;
    joyRef.current.y = y;
    setStickViz({ x, y });
    setJoyVector(emuRef.current, x, y, joyRef.current.fire);
  }, []);
  const onFire = useCallback((down, clearStick = false) => {
    const st = useEmu.getState();
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
    setJoyVector(emuRef.current, joyRef.current.x, joyRef.current.y, down);
  }, []);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const j = joyRef.current;
      if (!emuRef.current) return;
      if (playLockRef.current || useEmu.getState().booting) {
        if (j.x !== 0 || j.y !== 0 || j.fire) {
          j.x = 0;
          j.y = 0;
          j.fire = false;
          setJoyVector(emuRef.current, 0, 0, false);
        }
        return;
      }
      if (j.x !== 0 || j.y !== 0 || j.fire) {
        setJoyVector(emuRef.current, j.x, j.y, j.fire);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const swapJoyPort = useCallback(() => {
    const next = s.joyPort === 2 ? 1 : 2;
    s.setJoyPort(next);
    applyRuntimeOptions(emuRef.current, viceJoyOptions(next));
    plugJoysticks(emuRef.current, next);
    glog("port-swap", { next });
    toast.message(`Joystick → Port ${next}`);
  }, [s]);
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
        if (map[action] != null) joyInput(emuRef.current, map[action], on);
        if (action === "fire") {
          joyRef.current.fire = on;
          setJoyVector(emuRef.current, joyRef.current.x, joyRef.current.y, on);
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
        setJoyVector(emuRef.current, x, y, joyRef.current.fire);
      }
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
        setJoyVector(emuRef.current, 0, 0, joyRef.current.fire);
      }
    };
    window.addEventListener("gamepadconnected", connect);
    window.addEventListener("gamepaddisconnected", disconnect);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("gamepadconnected", connect);
      window.removeEventListener("gamepaddisconnected", disconnect);
    };
  }, [s.binds, s.setPadName]);
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
      setJoyVector(emuRef.current, joyRef.current.x, joyRef.current.y, on);
    };
    const onBlur = () => {
      if (!joyRef.current.fire) return;
      joyRef.current.fire = false;
      setJoyVector(emuRef.current, joyRef.current.x, joyRef.current.y, false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [s.running]);
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
    "data-running": s.running ? "true" : "false",
    "data-booting": s.booting ? "true" : "false",
    style: { ["--app-h"]: `${view.height}px` },
    suppressHydrationWarning: true,
  };
  const padConnected = Boolean(s.padName);
  const showStick = s.powered && !s.booting && s.showJoystick && !padConnected;
  const showJoyChrome = s.powered && !s.booting;
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
        </div>
      ) : null}
      <header className="g64-top" hidden={!s.powered}>
        <h1>Grok64</h1>
        <button type="button" className="g64-chip" onClick={() => s.setSettingsOpen(true)} title={detectLine(resolved)}>
          {resolved.chip}
        </button>
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
          className="g64-iconbtn extra"
          aria-label="Reset"
          onClick={() => {
            const mode = playModeRef.current;
            if (mode === "basic") {
              hardReset(emuRef.current);
              return;
            }
            if (mode === "disk") {
              glog("user-reset-disk");
              persistGateRef.current = false;
              pendingKickRef.current = false;
              setAwaitingStart(false);
              kickAutostart();
              return;
            }
            resetEmu(emuRef.current);
          }}
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
      </header>
      <div className="g64-log" aria-live="polite" hidden={!s.powered}>
        {logLines.slice(-5).map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <div className="g64-stage">
        <div className="g64-bezel">
          <div
            className={s.running ? "g64-screen is-on" : "g64-screen"}
            onPointerDown={(e) => {
              if (playLockRef.current || s.booting || !s.running) {
                if (!playLockRef.current && (s.booting || !s.running)) resumePlayback();
                return;
              }
              e.preventDefault();
              if (needsUnlock) resumePlayback();
              onFire(true, true);
            }}
            onPointerUp={() => {
              if (playLockRef.current || !s.running || s.booting) return;
              if (!pendingKickRef.current) onFire(false);
            }}
            onPointerCancel={() => {
              if (playLockRef.current || !s.running || s.booting) return;
              if (!pendingKickRef.current) onFire(false);
            }}
          >
            <PlayerMount />
            {s.crtFilter ? <div className="g64-scan" /> : null}
            {s.booting ? (
              <button
                type="button"
                className="g64-boot"
                onPointerDown={() => {
                  dismissEjsPrompts(document.getElementById("grok64-player"), "boot");
                  resumePlayback();
                }}
              >
                {s.bootMsg || "**** GROK64 EMU ****"}
              </button>
            ) : null}
            {(awaitingStart || needsUnlock) && !s.booting ? (
              <button type="button" className="g64-unlock" onPointerDown={() => resumePlayback()} onClick={() => resumePlayback()}>
                {awaitingStart
                  ? `Tap to start${s.currentTitle && s.currentTitle !== "BASIC" ? ` ${s.currentTitle.replace(/\.[a-z0-9]{2,4}$/i, "")}` : ""}`
                  : "Tap to play"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <TouchControls
        onVector={onVector}
        onFire={onFire}
        joyPort={s.joyPort}
        onSwap={swapJoyPort}
        warped={s.warped}
        onWarp={toggleWarp}
        hidden={!showJoyChrome}
        padActive={padConnected}
        stickHidden={!showStick}
        locked={s.booting || !s.running}
        vector={stickViz}
      />
      {s.powered && s.showKeyboard ? <C64Keyboard /> : null}
      <LibrarySheet onPlayBundled={(t) => void playBundled(t)} onPlayLocal={(i) => void playLocal(i)} onInsert={(i) => void insertDisk(i)} />
      <DiskMountSheet open={diskOpen} onOpenChange={setDiskOpen} onInsert={(i) => void insertDisk(i)} onBrowse={() => s.setLibraryOpen(true)} />
      <SettingsSheet resolved={resolved} />
    </div>
  );
}
