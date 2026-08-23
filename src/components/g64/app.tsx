import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Disc3,
  FolderOpen,
  Info,
  Keyboard,
  Pause,
  Play,
  Power,
  RotateCcw,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { C64Keyboard, dispatchC64Key } from "./keyboard";
import { InsertSheet, SoftwareSheet } from "./library";
import { SettingsSheets } from "./sheets";
import { Stick } from "./stick";
import { detectDevice, type DeviceSnap } from "@/lib/g64/detect";
import { asDiskImage } from "@/lib/g64/disk";
import { diskBanner, isDiskKind, isWorkDisk, kindOf, safeName, toArrayBuffer } from "@/lib/g64/files";
import {
  clickEjsOverlay,
  createEjs,
  currentFileName,
  destroyEmu,
  ensureCanvasSize,
  hasFs,
  hardReset,
  kickAutostart,
  listMedia,
  loadEmulatorJs,
  plugJoysticks,
  recycleEmu,
  restartEmu,
  resumeAudio,
  setJoyVector,
  setPaused,
  setVariables,
  setWarped,
  simulateButton,
  snapshotState,
  viceJoyOptions,
  wipeSaves,
  writeBootFile,
  audioSuspended,
} from "@/lib/g64/host";
import {
  ensureWorkDisk,
  getFile,
  isWorkDiskName,
  listLibrary,
  putState,
  touchPlayed,
  updateFileData,
  deleteFile,
} from "@/lib/g64/idb";
import { g64log, subscribeLog } from "@/lib/g64/log";
import { describeResolved, effectiveDrive, resolveMachine } from "@/lib/g64/machines";
import { detectJoyPort, detectSoftwareStandard } from "@/lib/g64/region";
import { isSid, wrapSid } from "@/lib/g64/sid";
import type { BundledTitle } from "@/lib/g64/software";
import { useG64, type LibraryItem } from "@/lib/g64/store";
import { PAD, type EjsInstance, type JoyPort } from "@/lib/g64/types";

const Player = memo(function Player() {
  return <div id="grok64-player" />;
});

type PlayMode = "basic" | "disk" | "auto";

export function Grok64App() {
  const st = useG64();
  const emu = useRef<EjsInstance | null>(null);
  const objectUrl = useRef<string | null>(null);
  const stick = useRef({ x: 0, y: 0, fire: false });
  const libraryId = useRef<string | null>(null);
  const persistTimer = useRef<number | null>(null);
  const playRef = useRef<(name: string, data: ArrayBuffer, opts?: PlayOpts) => Promise<void>>(async () => {});
  const ignoreStart = useRef(false);
  const powering = useRef(false);
  const recovered = useRef(false);
  const powerFn = useRef<() => void>(() => {});
  const splashRef = useRef<HTMLDivElement | null>(null);
  const bootGen = useRef(0);
  const playMode = useRef<PlayMode>("basic");
  const persistOk = useRef(true);
  const persistReady = useRef(false);
  const persistTimers = useRef<number[]>([]);
  const needTap = useRef(false);
  const bootPath = useRef<string | null>(null);
  const workBytes = useRef<Uint8Array | null>(null);
  const playLock = useRef(false);
  const lockGen = useRef(0);
  const fireUnlockAt = useRef(0);
  const [audioLocked, setAudioLocked] = useState(false);
  const [needStart, setNeedStart] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [softStandard, setSoftStandard] = useState<"pal" | "ntsc" | null>(null);
  const softRef = useRef<"pal" | "ntsc" | null>(null);
  const [device, setDevice] = useState<DeviceSnap>({
    device: "phone",
    preferFast: true,
    os: "other",
    label: "Device",
    memoryGb: null,
    cores: null,
    onn: false,
  });
  const deviceRef = useRef(device);
  deviceRef.current = device;

  const resolved = useMemo(
    () =>
      resolveMachine(
        {
          machineId: st.machineId,
          videoStandard: st.videoStandard,
          coreMode: st.coreMode,
          driveMode: st.driveMode,
        },
        device,
        softStandard,
      ),
    [st.machineId, st.videoStandard, st.coreMode, st.driveMode, device, softStandard],
  );
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  useEffect(() => {
    const onResize = () => {
      const snap = detectDevice();
      setDevice(snap);
      deviceRef.current = snap;
    };
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  useEffect(() => {
    loadEmulatorJs().catch(() => undefined);
  }, []);

  useEffect(() => {
    listLibrary().then(st.setLibrary);
  }, [st.setLibrary]);

  useEffect(() => {
    const w = window as Window;
    w.__g64 = {
      playMode: () => playMode.current,
      title: () => useG64.getState().currentTitle,
      bootPath: () => bootPath.current,
      hasFs: () => hasFs(emu.current),
      fileName: () => emu.current?.fileName ?? null,
      power: () => powerFn.current(),
      powered: () => useG64.getState().powered,
      running: () => useG64.getState().running,
      booting: () => useG64.getState().booting,
      playLock: () => playLock.current,
      media: () =>
        listMedia(emu.current).map((f) => ({
          name: f.name,
          size: f.data.byteLength,
          disk: diskBanner(f.data),
        })),
      fire: (down: boolean) => {
        if (playLock.current || useG64.getState().booting) return;
        stick.current.fire = down;
        if (down) {
          stick.current.x = 0;
          stick.current.y = 0;
        }
        setJoyVector(emu.current, stick.current.x, stick.current.y, down);
      },
      stick: (x: number, y: number) => {
        stick.current.x = x;
        stick.current.y = y;
        setJoyVector(emu.current, x, y, stick.current.fire);
      },
      joyPort: () => useG64.getState().joyPort,
      plug: () => plugJoysticks(emu.current, useG64.getState().joyPort),
    };
    return () => {
      delete w.__g64;
    };
  }, []);

  useEffect(() => subscribeLog(setLogLines), []);

  useEffect(() => {
    const ignore = /setImmediates|Wake Lock|NotAllowedError/i;
    const onError = (e: ErrorEvent) => {
      if (ignore.test(e.message || "")) {
        e.preventDefault();
        return;
      }
      g64log("window.error", { m: e.message, src: e.filename });
    };
    const onRej = (e: PromiseRejectionEvent) => {
      const m = String(e.reason ?? "");
      if (ignore.test(m)) {
        e.preventDefault();
        return;
      }
      g64log("unhandled", { m });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRej);
    g64log("app-ready", { ua: navigator.userAgent.slice(0, 80) });
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  useEffect(() => {
    if (!st.powered) return;
    const id = window.setInterval(() => {
      const root = document.getElementById("grok64-player");
      if (!root) return;
      clickEjsOverlay(root, useG64.getState().booting ? "boot" : "play");
      const canvas = root.querySelector("canvas");
      if (canvas && canvas.clientWidth > 16 && !ignoreStart.current && !playLock.current && emu.current) {
        useG64.getState().setBooting(false);
        useG64.getState().setRunning(true);
      }
      if (canvas && (canvas.width < 64 || canvas.height < 64)) ensureCanvasSize(root, emu.current);
      const locked = audioSuspended(emu.current);
      setAudioLocked(locked && !useG64.getState().booting && useG64.getState().running);
      if (!needTap.current) setNeedStart(false);
    }, 350);
    return () => window.clearInterval(id);
  }, [st.powered]);

  const persistDisk = useCallback(async () => {
    if (!persistOk.current) return;
    const id = libraryId.current;
    const inst = emu.current;
    if (!id || !inst) return;
    const file = await getFile(id);
    if (!file) return;
    const title = useG64.getState().currentTitle;
    const work = isWorkDisk(file.data);
    if (title === "BASIC" && !work) return;
    if (work && title && title !== "BASIC") return;
    try {
      if (title !== "BASIC" && persistReady.current) {
        const snap = await snapshotState(inst);
        if (snap && snap.byteLength > 16) await putState(id, toArrayBuffer(snap), title ?? file.name);
      }
      const media = listMedia(inst);
      const disk = media.find((f) => /\.(d64|d71|d81|g64|g71)$/i.test(f.name)) ?? media[0];
      if (!disk || disk.data.byteLength < 64) return;
      if (work !== isWorkDisk(disk.data)) return;
      await updateFileData(id, toArrayBuffer(disk.data));
    } catch {
      /* ignore */
    }
  }, []);

  const lockPlay = useCallback(
    (ms: number, msg: string) => {
      lockGen.current += 1;
      const gen = lockGen.current;
      playLock.current = true;
      ignoreStart.current = true;
      persistOk.current = false;
      persistReady.current = false;
      stick.current.fire = false;
      stick.current.x = 0;
      stick.current.y = 0;
      setJoyVector(emu.current, 0, 0, false);
      st.setBooting(true, msg);
      st.setRunning(true);
      g64log("play-lock", { ms, msg, gen });
      persistTimers.current.push(
        window.setTimeout(() => {
          if (lockGen.current !== gen) return;
          playLock.current = false;
          ignoreStart.current = false;
          fireUnlockAt.current = Date.now() + 400;
          setWarped(emu.current, false);
          setVariables(emu.current, {
            vice_autostart_warp: "disabled",
            vice_autoloadwarp: "disabled",
          });
          st.setBooting(false);
          st.setRunning(true);
          plugJoysticks(emu.current, useG64.getState().joyPort);
          g64log("play-unlock", { title: useG64.getState().currentTitle });
          persistOk.current = true;
        }, ms),
      );
      persistTimers.current.push(
        window.setTimeout(
          () => {
            if (lockGen.current === gen) persistReady.current = true;
          },
          Math.max(ms + 4000, 20000),
        ),
      );
    },
    [st],
  );

  const resetTitle = useCallback(() => {
    g64log("kickAutostart", { mode: playMode.current, title: useG64.getState().currentTitle });
    needTap.current = false;
    setNeedStart(false);
    setAudioLocked(false);
    persistOk.current = false;
    persistReady.current = false;
    resumeAudio(emu.current);
    setPaused(emu.current, false);
    setWarped(emu.current, false);
    useG64.getState().setWarped(false);
    wipeSaves(emu.current);
    kickAutostart(emu.current, playMode.current === "disk");
    lockPlay(playMode.current === "disk" ? 12000 : 4000, "Restarting…");
  }, [lockPlay]);

  const resumePlayback = useCallback(() => {
    resumeAudio(emu.current);
    clickEjsOverlay(document.getElementById("grok64-player"), "play");
    setAudioLocked(false);
    st.setPaused(false);
    setPaused(emu.current, false);
    needTap.current = false;
    setNeedStart(false);
    g64log("resumePlayback");
  }, [st]);

  const clearTimers = () => {
    for (const t of persistTimers.current) window.clearTimeout(t);
    persistTimers.current = [];
  };

  const dropUrl = () => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
  };

  interface PlayOpts {
    autostart?: boolean;
    title?: string;
    libraryId?: string;
    diskLoad?: boolean;
  }

  const bootUrl = useCallback(
    async (url: string, filename: string, opts: PlayOpts & { diskLoad?: boolean; onStarted?: (inst: EjsInstance) => void } = {}) => {
      bootGen.current += 1;
      const gen = bootGen.current;
      persistOk.current = false;
      persistReady.current = false;
      clearTimers();
      let mount: HTMLElement | null = null;
      for (let i = 0; i < 40; i++) {
        mount = document.getElementById("grok64-player");
        if (mount) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!mount) {
        persistOk.current = true;
        throw new Error("Display not ready");
      }
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (mount.clientWidth < 32 || mount.clientHeight < 32) {
        const parent = mount.parentElement;
        if (parent) {
          parent.style.minHeight = "220px";
          parent.style.minWidth = "280px";
        }
        for (let i = 0; i < 16; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          if (mount.clientWidth >= 32 && mount.clientHeight >= 32) break;
        }
      }
      const snap = useG64.getState();
      const machine = resolveMachine(
        {
          machineId: snap.machineId,
          videoStandard: snap.videoStandard,
          coreMode: snap.coreMode,
          driveMode: snap.driveMode,
        },
        deviceRef.current,
        softRef.current,
      );
      resolvedRef.current = machine;
      needTap.current = false;
      setNeedStart(false);
      const drive = effectiveDrive(machine.drive, { typedDisk: !!opts.diskLoad });
      const std = machine.standard === "ntsc" ? "NTSC 60" : "PAL 50";
      st.setBooting(true, opts.autostart === false ? `Cold start · ${std}…` : `Loading ${opts.title ?? filename} · ${std}…`);
      setAudioLocked(false);
      g64log("boot-begin", {
        game: filename,
        core: machine.core,
        autostart: opts.autostart !== false,
        pw: mount.clientWidth,
        ph: mount.clientHeight,
      });
      if (emu.current) {
        await recycleEmu(emu.current, mount);
        emu.current = null;
      } else {
        destroyEmu(null, mount);
      }
      ignoreStart.current = opts.autostart === false;
      try {
        const inst = await createEjs(mount, {
          gameUrl: url,
          gameName: filename,
          core: machine.core,
          machineOptions: machine.options,
          sidEngine: snap.sidEngine,
          sidModel: snap.sidModel,
          driveMode: drive,
          joyPort: snap.joyPort,
          volume: snap.muted ? 0 : snap.volume,
          autostart: opts.autostart !== false,
          onStart: () => {
            if (bootGen.current !== gen) return;
            bootPath.current = currentFileName(inst) || filename;
            if (opts.autostart === false) {
              setVariables(inst, {
                vice_autostart: "disabled",
                vice_autostart_warp: "disabled",
                vice_autoloadwarp: "disabled",
                ...(opts.diskLoad
                  ? { vice_drive_true_emulation: "enabled", vice_virtual_device_traps: "disabled" }
                  : {}),
              });
            }
            const finish = () => {
              if (bootGen.current !== gen) return;
              ignoreStart.current = false;
              st.setBooting(false);
              st.setRunning(true);
              st.setCurrentTitle(opts.title ?? filename);
              try {
                plugJoysticks(inst, snap.joyPort);
                g64log("joy-bound", { slot: inst.gamepadSelection?.[0] ?? null });
              } catch {
                /* ignore */
              }
              opts.onStarted?.(inst);
              g64log("core-start", {
                title: opts.title ?? filename,
                diskLoad: !!opts.diskLoad,
                autostart: opts.autostart !== false,
              });
              resumeAudio(inst);
              setPaused(inst, false);
              try {
                inst.paused = false;
                inst.gameManager?.toggleMainLoop?.(1);
              } catch {
                /* ignore */
              }
              ensureCanvasSize(document.getElementById("grok64-player"), inst);
              persistTimers.current.push(
                window.setTimeout(() => ensureCanvasSize(document.getElementById("grok64-player"), inst), 250),
              );
              if (audioSuspended(inst)) {
                needTap.current = false;
                setNeedStart(false);
                setAudioLocked(true);
              } else if (((needTap.current = false), setNeedStart(false), opts.autostart !== false && playMode.current !== "basic")) {
                lockPlay(playMode.current === "disk" ? 12000 : 3500, `Loading ${opts.title ?? filename}…`);
              } else {
                persistTimers.current.push(
                  window.setTimeout(() => {
                    if (bootGen.current === gen) {
                      persistOk.current = true;
                      persistReady.current = true;
                    }
                  }, 2000),
                );
              }
            };
            if (opts.autostart === false) {
              const wait = () => {
                if (bootGen.current !== gen) return;
                if (!inst.gameManager?.setVariable) {
                  persistTimers.current.push(window.setTimeout(wait, 200));
                  return;
                }
                setVariables(inst, {
                  vice_autostart: "disabled",
                  vice_autostart_warp: "disabled",
                  vice_autoloadwarp: "disabled",
                  ...(opts.diskLoad
                    ? { vice_drive_true_emulation: "enabled", vice_virtual_device_traps: "disabled" }
                    : {}),
                });
                persistTimers.current.push(window.setTimeout(finish, opts.diskLoad ? 400 : 1400));
              };
              persistTimers.current.push(window.setTimeout(wait, 200));
              return;
            }
            finish();
          },
          onError: (msg) => {
            if (bootGen.current === gen) persistOk.current = true;
            powering.current = false;
            st.setBooting(false);
            g64log("ejs-error", { m: msg });
            toast.error(msg);
          },
        });
        emu.current = inst;
      } catch (err) {
        persistOk.current = true;
        powering.current = false;
        g64log("boot-throw", { m: err instanceof Error ? err.message : String(err) });
        if (machine.fallbackCore && machine.core !== machine.fallbackCore) {
          toast.message(`${machine.label} WASM missing — using C64`);
          st.setMachine("c64-auto");
        }
        st.setBooting(false, "");
        toast.error(err instanceof Error ? err.message : "Emulator failed to start");
        throw err;
      }
    },
    [st, lockPlay],
  );

  const playBuffer = useCallback(
    async (filename: string, data: ArrayBuffer, opts: PlayOpts = {}) => {
      await persistDisk();
      libraryId.current = opts.libraryId ?? null;
      let payload: ArrayBuffer = data;
      let name = safeName(filename, kindOf(filename));
      let bytes = new Uint8Array(data);
      const work = isWorkDiskName(filename) || opts.title === "BASIC" || opts.title === "BASIC READY";
      if (!work && isWorkDisk(bytes)) {
        if (opts.libraryId) {
          await deleteFile(opts.libraryId);
          st.setLibrary(await listLibrary());
        }
        toast.error("That copy is empty. Grab the game again from Catalog.");
        return;
      }
      const detected = work ? null : detectSoftwareStandard({ names: [filename, opts.title], data: bytes });
      softRef.current = detected;
      setSoftStandard(detected);
      if (kindOf(filename) === "sid" || isSid(bytes)) {
        try {
          payload = toArrayBuffer(wrapSid(bytes));
          name = safeName(filename.replace(/\.sid$/i, "") + ".prg", "prg");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not play SID");
          return;
        }
      }
      dropUrl();
      let buf: ArrayBuffer;
      try {
        buf = payload instanceof ArrayBuffer ? payload : toArrayBuffer(new Uint8Array(payload));
      } catch {
        toast.error("That file could not be read. Save it again from Catalog.");
        return;
      }
      if (buf.byteLength < 2) {
        toast.error("That file is empty.");
        return;
      }
      const kind = kindOf(name);
      const diskLoad = !work && isDiskKind(kind) && opts.autostart === false;
      playMode.current = work ? "basic" : isDiskKind(kind) ? "disk" : "auto";
      g64log("play", { filename, kind, diskLoad, work, bytes: buf.byteLength });
      if (work) workBytes.current = new Uint8Array(buf);
      if (!work && opts.libraryId) await touchPlayed(opts.libraryId);
      if (emu.current && !hasFs(emu.current)) {
        st.setBooting(true, "Waiting for VICE…");
        const start = Date.now();
        while (Date.now() - start < 8000 && !hasFs(emu.current)) {
          await new Promise((r) => setTimeout(r, 80));
        }
      }
      const raw = new Uint8Array(buf);
      const title = opts.title ?? filename;
      const port: JoyPort = detectJoyPort({ names: [filename, title] });
      if (useG64.getState().joyPort !== port) {
        useG64.getState().setJoyPort(port);
        g64log("joy-autoplug", { port, filename, title });
        toast.message(`Joystick → Port ${port}`);
      }
      if (emu.current) {
        setVariables(emu.current, viceJoyOptions(port));
        plugJoysticks(emu.current, port);
      }
      const canSwap = !!(emu.current && hasFs(emu.current));
      const disk = asDiskImage(kind, raw, name);
      if (canSwap && emu.current && (disk || kind === "d64")) {
        const image = disk ?? raw;
        if (writeBootFile(emu.current, image, currentFileName(emu.current))) {
          g64log("hot-swap", { filename, title, kind });
          persistOk.current = false;
          persistReady.current = false;
          needTap.current = false;
          setNeedStart(false);
          clearTimers();
          wipeSaves(emu.current);
          setVariables(emu.current, {
            vice_autostart: work ? "disabled" : "enabled",
            vice_autostart_warp: work ? "disabled" : "enabled",
            vice_autoloadwarp: work ? "disabled" : "enabled",
            vice_reset: work ? "hard" : "autostart",
            ...viceJoyOptions(useG64.getState().joyPort),
          });
          if (work) hardReset(emu.current);
          else restartEmu(emu.current);
          plugJoysticks(emu.current, useG64.getState().joyPort);
          st.setCurrentTitle(title);
          st.setRunning(true);
          if (work) {
            playLock.current = false;
            ignoreStart.current = false;
            st.setBooting(false);
            persistTimers.current.push(
              window.setTimeout(() => {
                persistOk.current = true;
                persistReady.current = true;
              }, 2000),
            );
          } else {
            lockPlay(playMode.current === "disk" ? 12000 : 3500, `Loading ${title}…`);
          }
          return;
        }
      }
      const blob = new Blob([buf]);
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      await bootUrl(url, name, {
        autostart: !work && opts.autostart !== false,
        diskLoad,
        title,
      });
    },
    [st, persistDisk, bootUrl, lockPlay],
  );

  playRef.current = playBuffer;

  const playBundled = useCallback(
    async (title: BundledTitle) => {
      try {
        st.setLibraryOpen(false);
        const res = await fetch(title.path);
        if (!res.ok) throw new Error("Could not load bundled software");
        const buf = await res.arrayBuffer();
        const name = title.path.split("/").pop() || title.name;
        await playBuffer(name, buf, { autostart: true, title: title.name });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Load failed");
      }
    },
    [playBuffer, st],
  );

  const playLocal = useCallback(
    async (item: LibraryItem) => {
      st.setLibraryOpen(false);
      const file = await getFile(item.id);
      if (!file) {
        toast.error("That file is missing.");
        return;
      }
      await playBuffer(file.name, file.data, { autostart: true, title: item.name, libraryId: item.id });
      await touchPlayed(item.id);
    },
    [playBuffer, st],
  );

  const insertDisk = useCallback(async (item: LibraryItem) => {
    const file = await getFile(item.id);
    if (!file) {
      toast.error("Missing disk");
      return;
    }
    const bytes = new Uint8Array(file.data);
    const kind = kindOf(file.name);
    const disk = asDiskImage(kind, bytes, file.name) ?? (isDiskKind(kind) ? bytes : null);
    if (!disk) {
      toast.error("Can't insert that as a disk");
      return;
    }
    if (!emu.current || !hasFs(emu.current)) {
      toast.error("Power on first, then insert the next disk.");
      return;
    }
    if (!writeBootFile(emu.current, disk, currentFileName(emu.current))) {
      toast.error("Could not mount that disk");
      return;
    }
    await touchPlayed(item.id);
    const banner = diskBanner(disk) ?? item.name.replace(/\.[a-z0-9]{2,4}$/i, "");
    toast.success(`Inserted ${banner}`);
  }, []);

  const toggleWarp = useCallback(() => {
    const next = !useG64.getState().warped;
    useG64.getState().setWarped(next);
    setWarped(emu.current, next);
  }, []);

  powerFn.current = useCallback(() => {
    const snap = useG64.getState();
    if (snap.powered && (hasFs(emu.current) || powering.current)) {
      if (snap.booting) clickEjsOverlay(document.getElementById("grok64-player"), "boot");
      else resumePlayback();
      return;
    }
    powering.current = true;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctor({ latencyHint: "interactive" });
      if (ctx.state === "suspended") void ctx.resume();
    } catch {
      /* ignore */
    }
    snap.setBooting(true, "Cold start…");
    snap.powerOn();
    g64log("power-on", { ua: navigator.userAgent.slice(0, 80) });
    bootUrl("/software/blank.d64", "WORK DISK.D64", { autostart: false, title: "BASIC" })
      .then(() => {
        ensureWorkDisk()
          .then(async (item) => {
            libraryId.current = item.id;
            snap.setLibrary(await listLibrary());
          })
          .catch(() => undefined);
      })
      .catch((e) => {
        powering.current = false;
        g64log("power-fail", { m: e instanceof Error ? e.message : String(e) });
        toast.error(e instanceof Error ? e.message : "Boot failed");
      });
  }, [bootUrl, resumePlayback]);

  const recoverBoot = useCallback(() => {
    const snap = useG64.getState();
    if (!snap.powered) return;
    if (emu.current && hasFs(emu.current)) return;
    if (powering.current) return;
    g64log("boot-recover", { booting: snap.booting, running: snap.running });
    snap.setRunning(false);
    snap.setBooting(true, "Starting Commodore 64…");
    powering.current = true;
    bootUrl("/software/blank.d64", "WORK DISK.D64", { autostart: false, title: "BASIC" }).catch((e) => {
      powering.current = false;
      g64log("boot-recover-fail", { m: e instanceof Error ? e.message : String(e) });
      useG64.setState({ powered: false, booting: false, running: false });
      toast.error("The C64 didn’t start. Tap power to try again.");
    });
  }, [bootUrl]);

  useEffect(() => {
    const id = window.setTimeout(() => recoverBoot(), 80);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (st.powered) return;
    const el = splashRef.current;
    if (!el) return;
    const on = (e: Event) => {
      if (e.type === "keydown") {
        const key = (e as KeyboardEvent).key;
        if (key !== "Enter" && key !== " ") return;
        e.preventDefault();
      }
      powerFn.current();
    };
    el.addEventListener("pointerdown", on, { capture: true });
    el.addEventListener("touchstart", on, { capture: true, passive: false });
    el.addEventListener("click", on, { capture: true });
    el.addEventListener("keydown", on);
    return () => {
      el.removeEventListener("pointerdown", on, true);
      el.removeEventListener("touchstart", on, true);
      el.removeEventListener("click", on, true);
      el.removeEventListener("keydown", on);
    };
  }, [st.powered]);

  useEffect(() => {
    if (!st.powered || !st.booting) return;
    const id = window.setTimeout(() => {
      if (useG64.getState().booting && !playLock.current) {
        if (hasFs(emu.current)) {
          useG64.getState().setBooting(false);
          useG64.getState().setRunning(true);
          return;
        }
        clickEjsOverlay(document.getElementById("grok64-player"), "boot");
        g64log("boot-stuck");
        if (!recovered.current) {
          recovered.current = true;
          recoverBoot();
          return;
        }
        useG64.setState({ powered: false, booting: false, running: false });
        toast.error("The C64 didn’t start. Tap power to try again.");
      }
    }, 14000);
    return () => window.clearTimeout(id);
  }, [st.powered, st.booting, recoverBoot]);

  useEffect(() => {
    if (!st.running) return;
    recovered.current = false;
    const resize = () => {
      ensureCanvasSize(document.getElementById("grok64-player"), emu.current);
      window.dispatchEvent(new Event("resize"));
    };
    const a = window.setTimeout(resize, 50);
    const b = window.setTimeout(resize, 400);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [st.running]);

  useEffect(() => {
    if (st.paused) void persistDisk();
  }, [st.paused, persistDisk]);

  useEffect(() => {
    if (!st.running) return;
    persistTimer.current = window.setInterval(() => void persistDisk(), 20000);
    const vis = () => {
      if (document.hidden) void persistDisk();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      if (persistTimer.current) window.clearInterval(persistTimer.current);
      document.removeEventListener("visibilitychange", vis);
      void persistDisk();
    };
  }, [st.running, persistDisk]);

  useEffect(
    () => () => {
      destroyEmu(emu.current, document.getElementById("grok64-player"));
      dropUrl();
    },
    [],
  );

  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === "visible") {
        resumeAudio(emu.current);
        try {
          const Ctor = window.AudioContext || window.webkitAudioContext;
          const ctx = new Ctor();
          if (ctx.state === "suspended") void ctx.resume();
        } catch {
          /* ignore */
        }
      }
    };
    document.addEventListener("visibilitychange", vis);
    const unlock = () => resumeAudio(emu.current);
    window.addEventListener("g64-unlock", unlock);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("g64-unlock", unlock);
    };
  }, []);

  const onVector = useCallback((x: number, y: number) => {
    if (playLock.current || useG64.getState().booting) return;
    resumeAudio(emu.current);
    setPaused(emu.current, false);
    try {
      if (emu.current) emu.current.paused = false;
    } catch {
      /* ignore */
    }
    stick.current.x = x;
    stick.current.y = y;
    setJoyVector(emu.current, x, y, stick.current.fire);
  }, []);

  const onFire = useCallback((down: boolean) => {
    const snap = useG64.getState();
    if (playLock.current || snap.booting || !snap.running) {
      if (down) {
        g64log("fire-blocked", {
          booting: snap.booting,
          lock: playLock.current,
          running: snap.running,
          title: snap.currentTitle,
        });
      }
      return;
    }
    stick.current.fire = down;
    if (down) {
      stick.current.x = 0;
      stick.current.y = 0;
    }
    setJoyVector(emu.current, stick.current.x, stick.current.y, down);
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = stick.current;
      if (!emu.current) return;
      if (playLock.current || useG64.getState().booting) {
        if (v.x !== 0 || v.y !== 0 || v.fire) {
          v.x = 0;
          v.y = 0;
          v.fire = false;
          setJoyVector(emu.current, 0, 0, false);
        }
        return;
      }
      if (v.x !== 0 || v.y !== 0 || v.fire) setJoyVector(emu.current, v.x, v.y, v.fire);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const swapPort = useCallback(() => {
    const next: JoyPort = st.joyPort === 2 ? 1 : 2;
    st.setJoyPort(next);
    setVariables(emu.current, viceJoyOptions(next));
    plugJoysticks(emu.current, next);
    g64log("port-swap", { next });
    toast.message(`Joystick → Port ${next}`);
  }, [st]);

  useEffect(() => {
    const binds = st.binds;
    const setPadName = st.setPadName;
    let raf = 0;
    const last = new Map<string, boolean>();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const pad = (navigator.getGamepads?.() ?? []).find((g) => g && g.id !== "Grok64 Touch");
      if (pad) setPadName(pad.id);
      if (!pad || !emu.current) return;
      const send = (action: string, down: boolean) => {
        if (last.get(action) === down) return;
        last.set(action, down);
        const map: Record<string, number> = {
          up: PAD.UP,
          down: PAD.DOWN,
          left: PAD.LEFT,
          right: PAD.RIGHT,
          fire: PAD.B,
          fire2: PAD.A,
        };
        if (map[action] != null) simulateButton(emu.current, map[action], down);
        if (action === "fire") {
          stick.current.fire = down;
          setJoyVector(emu.current, stick.current.x, stick.current.y, down);
        }
        if (action === "space") dispatchC64Key("Space", " ", !down);
        if (action === "runstop") dispatchC64Key("Escape", "Escape", !down);
        if (action === "commodore") dispatchC64Key("Tab", "Tab", !down);
        if (action === "return") dispatchC64Key("Enter", "Enter", !down);
      };
      for (const bind of binds) {
        let down = bind.padButtons.some((i) => pad.buttons[i]?.pressed);
        for (const ax of bind.padAxes) {
          const v = pad.axes[ax.axis] ?? 0;
          if (ax.dir < 0 && v < -0.35) down = true;
          if (ax.dir > 0 && v > 0.35) down = true;
        }
        send(bind.action, down);
      }
    };
    raf = requestAnimationFrame(tick);
    const on = (e: GamepadEvent) => {
      const id = e.gamepad?.id;
      if (id) st.setPadName(id);
    };
    const off = () => st.setPadName(null);
    window.addEventListener("gamepadconnected", on);
    window.addEventListener("gamepaddisconnected", off);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("gamepadconnected", on);
      window.removeEventListener("gamepaddisconnected", off);
    };
  }, [st.binds, st.setPadName]);

  useEffect(() => {
    const held = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      if (!st.running) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !st.arrowsAreJoy) return;
      const bind = st.binds.find((b) => b.keys.includes(e.code));
      if (bind && ["up", "down", "left", "right", "fire", "fire2"].includes(bind.action)) {
        e.preventDefault();
        const map: Record<string, number> = {
          up: PAD.UP,
          down: PAD.DOWN,
          left: PAD.LEFT,
          right: PAD.RIGHT,
          fire: PAD.B,
          fire2: PAD.A,
        };
        const down = e.type === "keydown";
        if (down && held.has(e.code)) return;
        if (down) held.add(e.code);
        else held.delete(e.code);
        if (map[bind.action] != null) simulateButton(emu.current, map[bind.action], down);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", () => held.clear());
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [st.arrowsAreJoy, st.binds, st.running]);

  useEffect(() => {
    setPaused(emu.current, st.paused);
  }, [st.paused]);

  useEffect(() => {
    setWarped(emu.current, st.warped);
  }, [st.warped]);

  const onPower = useCallback((e?: { preventDefault?: () => void; type?: string }) => {
    e?.preventDefault?.();
    g64log("power-tap", { t: e?.type ?? "ui" });
    powerFn.current();
  }, []);

  const attrs = {
    className: "g64-app",
    "data-device": resolved.device,
    "data-os": device.os,
    "data-standard": resolved.standard,
    "data-core": resolved.coreMode,
    "data-media": playMode.current,
    "data-kb": st.powered && st.showKeyboard ? "true" : "false",
    "data-running": st.running ? "true" : "false",
    "data-booting": st.booting ? "true" : "false",
  } as const;

  return (
    <div {...attrs}>
      {st.powered ? null : (
        <div
          ref={splashRef}
          className="g64-splash"
          data-on={st.powered || st.booting ? "true" : "false"}
          data-booting={st.booting ? "true" : "false"}
          role="button"
          tabIndex={0}
          aria-label="Power on"
          onPointerDown={onPower}
          onClick={onPower}
        >
          <div className="g64-mark">
            GROK64
            <span>EMU</span>
          </div>
          <button
            type="button"
            className="g64-power"
            data-on={st.powered || st.booting ? "true" : "false"}
            aria-label="Power on"
            onPointerDown={onPower}
            onClick={onPower}
          >
            <Power className="size-8" />
            <span className="led" />
          </button>
          <p className="g64-detect">{describeResolved(resolved)}</p>
          <p className="g64-splash-copy">
            {st.booting
              ? st.bootMsg || "Starting Commodore 64…"
              : st.powered
                ? "Still starting — tap again if the screen stays dark."
                : "Tap the power button. The C64 boots to READY with a blank work disk. Grab games from Software."}
          </p>
        </div>
      )}
      <header className="g64-top" hidden={!st.powered}>
        <h1>Grok64</h1>
        <button type="button" className="g64-chip" onClick={() => st.setSettingsOpen(true)} title={describeResolved(resolved)}>
          {resolved.chip}
        </button>
        <button
          type="button"
          className="g64-iconbtn"
          data-on={st.libraryOpen}
          aria-label="Software"
          onClick={() => st.setLibraryOpen(true)}
        >
          <FolderOpen className="size-5" />
        </button>
        <button type="button" className="g64-iconbtn" data-on={insertOpen} aria-label="Insert disk" onClick={() => setInsertOpen(true)}>
          <Disc3 className="size-5" />
        </button>
        <button
          type="button"
          className="g64-iconbtn"
          data-on={st.showKeyboard}
          aria-label="Keyboard"
          onClick={() => st.setShowKeyboard(!st.showKeyboard)}
        >
          <Keyboard className="size-5" />
        </button>
        <button
          type="button"
          className="g64-iconbtn extra"
          aria-label={st.paused ? "Resume" : "Pause"}
          onClick={() => {
            const next = !st.paused;
            st.setPaused(next);
            setPaused(emu.current, next);
          }}
        >
          {st.paused ? <Play className="size-5" /> : <Pause className="size-5" />}
        </button>
        <button
          type="button"
          className="g64-iconbtn extra"
          aria-label="Reset"
          onClick={() => {
            const mode = playMode.current;
            if (mode === "basic") {
              hardReset(emu.current);
              return;
            }
            if (mode === "disk") {
              g64log("user-reset-disk");
              persistOk.current = false;
              needTap.current = false;
              setNeedStart(false);
              resetTitle();
              return;
            }
            restartEmu(emu.current);
          }}
        >
          <RotateCcw className="size-5" />
        </button>
        <button
          type="button"
          className="g64-iconbtn extra"
          data-on={st.muted}
          aria-label={st.muted ? "Unmute" : "Mute"}
          onClick={() => st.setMuted(!st.muted)}
        >
          {st.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
        <button type="button" className="g64-iconbtn" aria-label="Settings" onClick={() => st.setSettingsOpen(true)}>
          <Settings className="size-5" />
        </button>
        <button type="button" className="g64-iconbtn extra" aria-label="About" onClick={() => st.setAboutOpen(true)}>
          <Info className="size-5" />
        </button>
      </header>
      <div className="g64-log" aria-live="polite" hidden={!st.powered}>
        {logLines.slice(-5).map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      <div className="g64-stage">
        <div className="g64-bezel">
          <div
            className={st.running ? "g64-screen is-on" : "g64-screen"}
            onPointerDown={(e) => {
              if (playLock.current || st.booting || !st.running) {
                if (!playLock.current && (st.booting || !st.running)) resumePlayback();
                return;
              }
              e.preventDefault();
              if (audioLocked) resumePlayback();
              onFire(true);
            }}
            onPointerUp={() => {
              if (playLock.current || !st.running || st.booting || needTap.current) return;
              onFire(false);
            }}
            onPointerCancel={() => {
              if (playLock.current || !st.running || st.booting || needTap.current) return;
              onFire(false);
            }}
          >
            <Player />
            {st.crtFilter ? <div className="g64-scan" /> : null}
            {st.booting ? (
              <button
                type="button"
                className="g64-boot"
                onPointerDown={() => {
                  clickEjsOverlay(document.getElementById("grok64-player"), "boot");
                  resumePlayback();
                }}
              >
                {st.bootMsg || "**** GROK64 EMU ****"}
              </button>
            ) : null}
            {(needStart || audioLocked) && !st.booting ? (
              <button type="button" className="g64-unlock" onPointerDown={() => resumePlayback()} onClick={() => resumePlayback()}>
                {needStart
                  ? `Tap to start${st.currentTitle && st.currentTitle !== "BASIC" ? ` ${st.currentTitle.replace(/\.[a-z0-9]{2,4}$/i, "")}` : ""}`
                  : "Tap to play"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <Stick
        onVector={onVector}
        onFire={onFire}
        joyPort={st.joyPort}
        onSwap={swapPort}
        warped={st.warped}
        onWarp={toggleWarp}
        hidden={!st.powered || !st.showJoystick || st.booting}
        locked={st.booting || !st.running}
      />
      {st.powered && st.showKeyboard ? <C64Keyboard /> : null}
      <SoftwareSheet onPlayBundled={(t) => void playBundled(t)} onPlayLocal={(t) => void playLocal(t)} onInsert={(t) => void insertDisk(t)} />
      <InsertSheet
        open={insertOpen}
        onOpenChange={setInsertOpen}
        onInsert={(t) => void insertDisk(t)}
        onBrowse={() => st.setLibraryOpen(true)}
      />
      <SettingsSheets resolved={resolved} />
    </div>
  );
}
