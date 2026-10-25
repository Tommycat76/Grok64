import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { ExpansionPanel } from "@/components/emu/ExpansionPanel";
import { detectLine, MACHINES, type ResolvedMachine } from "@/lib/emu/machines";
import { ACTION_LABEL, useEmu } from "@/lib/emu/store";
import {
  deleteLibraryCartRows,
  getLastCartPlayDiagnostic,
  scanLibraryCartHealth,
  type LibraryCartHealthRow,
} from "@/lib/emu/cart-crt-diag";
import { listLibrary } from "@/lib/emu/library";
import { BuildId } from "@/components/emu/BuildId";
import { drive8LogLines, setDebugUi } from "@/lib/emu/debug";
import type {
  ActionId,
  CorePref,
  DriveMode,
  IecSlot,
  ReuSize,
  ScpuSimm,
  SidChipModel,
  SidEngine,
  SidExtraAddress,
  SidModel,
  VideoPref,
} from "@/lib/emu/types";

const SID_ADDR: SidExtraAddress[] = ["disabled", "0xd420", "0xd500", "0xde00", "0xdf00"];
const SID_ADDR_LABEL: Record<SidExtraAddress, string> = {
  disabled: "Off",
  "0xd420": "$D420",
  "0xd500": "$D500",
  "0xde00": "$DE00",
  "0xdf00": "$DF00",
};
import { IEC_UNITS } from "@/lib/emu/types";
import { IEC_SLOT_LABEL, REU_LABEL, SCPU_SIMM_LABEL } from "@/lib/emu/vice-extras";
import { VICE_LIBRETRO_SID_EXTRA2 } from "@/lib/emu/vice-sid-cap";

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="g64-switch" data-on={on ? "true" : "false"} onClick={onToggle} role="switch" aria-checked={on}>
      <i />
    </button>
  );
}

export function SettingsSheet({ resolved }: { resolved?: ResolvedMachine }) {
  const s = useEmu();
  const mac = MACHINES.find((m) => m.id === s.machineId);
  const c64Family = (mac?.family ?? "c64") === "c64";

  useEffect(() => {
    if (!s.settingsOpen && !s.aboutOpen && !s.mapperOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        if (s.aboutOpen) s.setAboutOpen(false);
        if (s.settingsOpen) s.setSettingsOpen(false);
        if (s.mapperOpen) s.setMapperOpen(false);
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [s.settingsOpen, s.aboutOpen, s.mapperOpen, s.setAboutOpen, s.setSettingsOpen, s.setMapperOpen]);

  return (
    <>
      <Drawer.Root open={s.settingsOpen} onOpenChange={s.setSettingsOpen} handleOnly>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[900] bg-black/60" />
          <Drawer.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
            <div className="g64-handle" />
            <div className="g64-sheet-head">
              <Drawer.Title asChild>
                <h2>Machine</h2>
              </Drawer.Title>
              <p className="lead">
                Auto picks PAL or NTSC from the software — filename tags, SID flags, and known releases — so it runs as the coder intended. Fast core on phones and budget tablets. Video and core apply on the next load. Joystick port swaps immediately.
              </p>
              {resolved ? <p className="g64-detect-inline">{detectLine(resolved)}</p> : null}
            </div>
            <div className="g64-sheet-body">
            <div className="g64-row">
              <span>1351 mouse + touchpad</span>
              <Switch on={s.mouseMode} onToggle={() => s.setMouseMode(!s.mouseMode)} />
            </div>
            <p className="mb-3 text-xs text-fg-subtle">
              1351 sits on the selected port; the other port stays a joystick. GEOS boots with its
              JOYSTICK driver on Port 1 — tap P1, then WASD or the on-screen stick. After CONFIGURE
              → COMM 1351, put the mouse on that port and use the screen, trackpad, or L/R buttons.
            </p>
            {s.mouseMode ? (
              <div className="g64-field">
                <label>Touchpad side</label>
                <div className="g64-seg">
                  <button type="button" data-on={s.padSide === "left"} onClick={() => s.setPadSide("left")}>
                    Pad left
                  </button>
                  <button type="button" data-on={s.padSide === "right"} onClick={() => s.setPadSide("right")}>
                    Pad right
                  </button>
                </div>
              </div>
            ) : null}

            <div className="g64-row">
              <span>Layout editor</span>
              <Switch on={s.layoutEdit} onToggle={() => s.setLayoutEdit(!s.layoutEdit)} />
            </div>
            {s.layoutEdit ? (
              <p className="mb-3 text-xs text-fg-subtle">
                Drag the stick, fire, jump, trackpad, or mouse buttons to reposition them. Phone and tablet share the same layout.
              </p>
            ) : null}
            <button
              type="button"
              className="g64-btn mb-3 w-full"
              onClick={() => {
                s.resetControlLayout();
                toast.message("Control layout reset");
              }}
            >
              Reset control layout
            </button>

            <button
              type="button"
              className="g64-btn g64-btn-primary mb-3"
              onClick={() => {
                s.setReuSize("16384kB");
                s.setMouseMode(true);
                s.setJoyPort(1);
                s.setDriveMode("true");
                s.setJiffyDos(true);
                s.setIecSlot(8, "1541");
                s.setIecSlot(9, "cmdhd");
                toast.message("C64 OS kit — 16 MB REU, 1541 on #8, CMD HD on #9. Hardware buttons appear when those devices are on.");
              }}
            >
              C64 OS kit
            </button>

            <div className="g64-field">
              <label>Video</label>
              <div className="g64-seg">
                {([
                  ["auto", "Auto"],
                  ["ntsc", "NTSC 60"],
                  ["pal", "PAL 50"],
                ] as [VideoPref, string][]).map(([id, label]) => (
                  <button key={id} type="button" data-on={s.videoStandard === id} onClick={() => s.setVideoStandard(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-fg-subtle">
                Auto reads filename tags ([NTSC], (PAL), and the same in parentheses), SID flags, and the dump — including cartridges. Untagged titles boot PAL (VICE default). Force PAL 50 or NTSC 60 here when a release is tagged wrong.
              </p>
            </div>

            {c64Family ? (
              <div className="g64-field">
                <label>CPU core</label>
                <div className="g64-seg">
                  {([
                    ["auto", "Auto"],
                    ["accurate", "Accurate"],
                    ["fast", "Fast"],
                  ] as [CorePref, string][]).map(([id, label]) => (
                    <button key={id} type="button" data-on={s.coreMode === id} onClick={() => s.setCoreMode(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="g64-field">
              <label>Model</label>
              <select value={s.machineId} onChange={(e) => s.setMachine(e.target.value as typeof s.machineId)}>
                {MACHINES.filter((m) => m.focus).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <optgroup label="Other VICE machines">
                  {MACHINES.filter((m) => !m.focus).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              <p className="text-xs text-fg-subtle">{mac?.blurb}</p>
            </div>

            <div className="g64-field">
              <label>SuperCPU</label>
              <div className="g64-row" style={{ marginBottom: 8 }}>
                <span>CMD SuperCPU (65816)</span>
                <Switch on={s.machineId === "scpu"} onToggle={() => s.setMachine(s.machineId === "scpu" ? "c64-auto" : "scpu")} />
              </div>
              <div className="g64-seg">
                {(["0", "1", "2", "4", "8", "16"] as ScpuSimm[]).map((id) => (
                  <button key={id} type="button" data-on={s.scpuSimm === id} onClick={() => s.setScpuSimm(id)}>
                    {SCPU_SIMM_LABEL[id]}
                  </button>
                ))}
              </div>
              <div className="g64-row" style={{ marginTop: 8 }}>
                <span>20 MHz turbo</span>
                <Switch on={s.scpuTurbo} onToggle={() => s.setScpuTurbo(!s.scpuTurbo)} />
              </div>
              <p className="text-xs text-fg-subtle">
                SuperCPU is a different VICE core (xscpu64): 20 MHz 65816 + onboard SIMM, separate from the REU. EmulatorJS stable/latest often does not ship that WASM — if it's missing, Grok64 stays on C64 and these settings wait for the core. Applies on next load.
              </p>
            </div>

            <div className="g64-field">
              <label>IEC drives</label>
              <p className="mb-2 text-xs text-fg-subtle">
                One number is one drive on the serial bus. <code>LOAD"$",8</code> talks to device 8,{" "}
                <code>LOAD"$",9</code> to device 9. Floppy Play mounts the image on #8 and stops at bare{" "}
                <code>READY</code> — Grok64 never auto-types <code>LOAD</code> on mount (no{" "}
                <code>LOAD"$"</code> or <code>LOAD"*"</code>). Device 8 cannot be empty.
              </p>
              {IEC_UNITS.map((unit) => (
                <div key={unit} className="g64-iec-row">
                  <span>#{unit}</span>
                  <div className="g64-seg" role="group" aria-label={`Device ${unit}`}>
                    {(["none", "1541", "1581", "sd2iec", "cmdhd"] as IecSlot[]).map((id) => (
                      <button
                        key={id}
                        type="button"
                        data-on={(s.iecMap?.[unit] ?? (unit === 8 ? "1541" : "none")) === id}
                        onClick={() => s.setIecSlot(unit, id)}
                      >
                        {IEC_SLOT_LABEL[id]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="mt-2 text-xs text-fg-subtle">
                Example: #8 = 1541, #9 = another 1541, #10 = 1581. SD2IEC and CMD HD each appear once — freeze / SWAP buttons show on the top bar only while that device is on. CMD HD still wants your Boot ROM 2.80.
              </p>
            </div>

            <div className="g64-field">
              <label>On-screen extras</label>
              <div className="g64-row" style={{ marginBottom: 8 }}>
                <span>Jump button (stick up)</span>
                <Switch on={s.jumpBtn} onToggle={() => s.setJumpBtn(!s.jumpBtn)} />
              </div>
              <button
                type="button"
                className="g64-btn mb-2 w-full"
                onClick={() => {
                  s.setSettingsOpen(false);
                  s.setSnapsOpen(true);
                }}
              >
                Freeze / snapshots
              </button>
              <p className="text-xs text-fg-subtle">
                Jump, freeze, SD disk-change, and CMD SWAP stay out of the top bar until you turn those features on here.
              </p>
            </div>

            <div className="g64-field">
              <label>SID engine</label>
              <div className="g64-seg">
                {(["ReSID", "FastSID", "ReSID-fp"] as SidEngine[]).map((e) => (
                  <button key={e} type="button" data-on={s.sidEngine === e} onClick={() => s.setSidEngine(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="g64-field">
              <label>SID chip (primary)</label>
              <div className="g64-seg">
                {(["6581", "8580", "default"] as SidModel[]).map((e) => (
                  <button key={e} type="button" data-on={s.sidModel === e} onClick={() => s.setSidModel(e)}>
                    {e === "default" ? "From model" : e}
                  </button>
                ))}
              </div>
            </div>

            <div className="g64-field">
              <label>2nd SID (stereo)</label>
              <div className="g64-seg" style={{ flexWrap: "wrap" }}>
                {SID_ADDR.map((e) => (
                  <button key={e} type="button" data-on={s.sid2Address === e} onClick={() => s.setSid2Address(e)}>
                    {SID_ADDR_LABEL[e]}
                  </button>
                ))}
              </div>
              {s.sid2Address !== "disabled" ? (
                <div className="g64-seg" style={{ marginTop: 8 }}>
                  {(["default", "6581", "8580"] as SidChipModel[]).map((e) => (
                    <button key={e} type="button" data-on={s.sid2Model === e} onClick={() => s.setSid2Model(e)}>
                      {e === "default" ? "Same as primary" : e}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-fg-subtle">Off by default (stock single SID). Address + chip apply on the next core start.</p>
            </div>

            {VICE_LIBRETRO_SID_EXTRA2 ? (
              <div className="g64-field">
                <label>3rd SID</label>
                <div className="g64-seg" style={{ flexWrap: "wrap" }}>
                  {SID_ADDR.map((e) => (
                    <button key={e} type="button" data-on={s.sid3Address === e} onClick={() => s.setSid3Address(e)}>
                      {SID_ADDR_LABEL[e]}
                    </button>
                  ))}
                </div>
                {s.sid3Address !== "disabled" ? (
                  <div className="g64-seg" style={{ marginTop: 8 }}>
                    {(["default", "6581", "8580"] as SidChipModel[]).map((e) => (
                      <button key={e} type="button" data-on={s.sid3Model === e} onClick={() => s.setSid3Model(e)}>
                        {e === "default" ? "Same as primary" : e}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-fg-subtle">
                This VICE core supports one extra SID via <code>vice_sid_extra</code> only (libretro). A third chip is not available in EmulatorJS.
              </p>
            )}

            <div className="g64-field">
              <label>1541 drive</label>
              <div className="g64-seg">
                {([
                  ["auto", "Auto"],
                  ["true", "Accurate"],
                  ["fast", "Fast traps"],
                ] as [DriveMode, string][]).map(([id, label]) => (
                  <button key={id} type="button" data-on={s.driveMode === id} onClick={() => s.setDriveMode(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-fg-subtle">
                Disks always use a real 1541 so custom loaders (Ghostbusters, Ocean, Epyx) don't freeze. Fast traps stay on for BASIC on phones.
              </p>
            </div>

            <div className="g64-field">
              <label>Joystick port</label>
              <div className="g64-seg">
                <button type="button" data-on={s.joyPort === 2} onClick={() => s.setJoyPort(2)}>
                  Port 2
                </button>
                <button type="button" data-on={s.joyPort === 1} onClick={() => s.setJoyPort(1)}>
                  Port 1
                </button>
              </div>
              <p className="text-xs text-fg-subtle">
                Most games read Port 2. GEOS JOYSTICK and COMM 1351 read Port 1. Swap here, or tap P1/P2 next to FIRE. WARP sits next to FIRE and in the top bar.
              </p>
            </div>

            <div className="g64-field">
              <label>REU (RAM expansion)</label>
              <div className="g64-seg">
                {(["none", "256kB", "512kB", "2048kB", "16384kB"] as ReuSize[]).map((id) => (
                  <button key={id} type="button" data-on={s.reuSize === id} onClick={() => s.setReuSize(id)}>
                    {REU_LABEL[id]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-fg-subtle">
                Real VICE REU on the expansion port — not stubbed, including on iPhone. 16 MB is what C64 OS needs. Play a program next to a .reu (or a C64 Ultimate RunMeFirst.cfg) to preload that image. Play or Insert a non-Nuvie .reu dump to load it like VICE’s REU image file. Nuvie / .nuv still uses the Nuvie player. Size applies on the next core start.
              </p>
            </div>

            <ExpansionPanel />

            <div className="g64-row">
              <span>Pause</span>
              <Switch
                on={s.paused}
                onToggle={() => {
                  const next = !s.paused;
                  s.setPaused(next);
                }}
              />
            </div>
            <div className="g64-row">
              <span>Warp (fast forward)</span>
              <Switch on={s.warped} onToggle={() => s.setWarped(!s.warped)} />
            </div>
            <div className="g64-row">
              <span>Mute</span>
              <Switch on={s.muted} onToggle={() => s.setMuted(!s.muted)} />
            </div>
            <div className="g64-row">
              <span>CRT scanlines</span>
              <Switch on={s.crtFilter} onToggle={() => s.setCrtFilter(!s.crtFilter)} />
            </div>
            <div className="g64-row">
              <span>Verbose logs</span>
              <Switch
                on={s.debugLog}
                onToggle={() => {
                  const next = !s.debugLog;
                  s.setDebugLog(next);
                  setDebugUi(next);
                }}
              />
            </div>
            <p className="mb-3 text-xs text-fg-subtle">
              Off by default. Add <code>?debug=1</code> to the URL or flip this to show the
              scrolling emulator log. Production CRT stays clear either way.
            </p>
            <div className="g64-row">
              <span>On-screen joystick</span>
              <Switch on={s.showJoystick} onToggle={() => s.setShowJoystick(!s.showJoystick)} />
            </div>
            <div className="g64-row">
              <span>WASD joystick</span>
              <Switch on={s.wasdIsJoy} onToggle={() => s.setWasdIsJoy(!s.wasdIsJoy)} />
            </div>
            <div className="g64-row">
              <span>Arrow keys move the stick</span>
              <Switch on={s.arrowsAreJoy} onToggle={() => s.setArrowsAreJoy(!s.arrowsAreJoy)} />
            </div>
            <p className="mb-3 text-xs text-fg-subtle">
              Keyboard is the full C64 keyboard on computer, tablet, and phone. Right Ctrl is FIRE.
              WASD (and arrows, if you turn that on) move the digital stick — needed for GEOS
              JOYSTICK and other joystick-only software. A plugged-in gamepad is used first; the
              on-screen stick stays up with the 1351 so both ports can be used.
            </p>
            {s.padName ? (
              <p className="mb-3 text-sm text-phosphor">Using controller: {s.padName}</p>
            ) : null}
            <div className="g64-field">
              <label>Volume</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={s.volume}
                onChange={(e) => s.setVolume(Number(e.target.value))}
              />
            </div>

            <button type="button" className="g64-btn mt-2 w-full" onClick={() => s.setMapperOpen(true)}>
              Map Bluetooth / gamepad
            </button>
            <button type="button" className="g64-btn mt-2 w-full" onClick={() => s.setAboutOpen(true)}>
              About VICE & credits
            </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <Drawer.Root open={s.mapperOpen} onOpenChange={s.setMapperOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[900] bg-black/60" />
          <Drawer.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
            <div className="g64-handle" />
            <Drawer.Title asChild>
              <h2>Controls</h2>
            </Drawer.Title>
            <p className="lead">
              Pair a Bluetooth pad in iPhone Settings or Android Bluetooth, then press a button here. HID, MFi, Xbox, DualShock and most Android controllers show up in the Gamepad API. Web Bluetooth is not available in iOS Safari. Stick directions only come from a pad or the on-screen joystick — never from keys.
            </p>
            {s.padName ? (
              <p className="mb-3 text-sm text-phosphor">{s.padName}</p>
            ) : (
              <p className="mb-3 text-sm text-fg-muted">No pad yet — press any button on the controller.</p>
            )}
            <MapperList />
            <button type="button" className="g64-btn mt-3 w-full" onClick={() => s.resetBinds()}>
              Reset mapping
            </button>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <Drawer.Root open={s.aboutOpen} onOpenChange={s.setAboutOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[900] bg-black/60" />
          <Drawer.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
            <div className="g64-handle" />
            <Drawer.Title asChild>
              <h2>Grok64 Emu</h2>
            </Drawer.Title>
            <p className="lead">
              A phone-and-tablet shell around VICE. Cycle-accurate C64 via the libretro x64sc core, with a Fast x64 fallback on iPhone and budget Android tablets. SID from reSID, 1541 true-drive, cartridges, and the rest of the VICE family wired for later.
            </p>
            <p className="mb-3 text-sm leading-6 text-fg-muted">
              Emulation: VICE (GPLv2+) · libretro vice cores · EmulatorJS WASM loader. SID: reSID (Dag Lem). Palette: Pepto PAL/NTSC. Catalog: Assembly64, HVSC, Internet Archive. Downloads are stored on this device.
            </p>
            <p className="text-sm leading-6 text-fg-muted">
              PAL vs NTSC follows the title, not your timezone. SuperCPU uses the xscpu64 core when the WASM build is present; otherwise it falls back to C64. JiffyDOS and CMD HD Boot ROM 2.80 are yours to upload — Grok64 never bundles them. C128 dual-screen (VIC-II + VDC) is available by selecting C128.
            </p>
            <p className="mt-4 text-sm text-fg-muted">
              Build <BuildId className="font-mono text-fg" /> — hard reload if this does not match the release you expect.
            </p>
            <Drive8DiagPanel />
            <LastCartPlayDiagPanel />
            <LibraryCartScanPanel />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

function LibraryCartScanPanel() {
  const setLibrary = useEmu((s) => s.setLibrary);
  const [rows, setRows] = useState<LibraryCartHealthRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function runScan() {
    setBusy(true);
    try {
      const r = await scanLibraryCartHealth();
      setRows(r);
      if (typeof console !== "undefined") console.info("[grok64] libraryCartScan", r);
      const bad = r.filter((x) => !x.ok);
      if (bad.length) {
        toast.error(`${bad.length} library cartridge(s) look corrupt — delete and re-import.`, { duration: 12_000 });
      } else if (r.length) {
        toast.message(`All ${r.length} library cartridge(s) passed CRT header checks.`);
      } else {
        toast.message("No cartridge rows in On this device.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy(false);
    }
  }
  async function deleteBadRows(target?: LibraryCartHealthRow[]) {
    const bad = (target ?? rows ?? []).filter((r) => !r.ok);
    if (!bad.length) {
      toast.message("No corrupt cartridge rows to delete.");
      return;
    }
    setBusy(true);
    try {
      await deleteLibraryCartRows(bad.map((r) => r.id));
      setLibrary(await listLibrary());
      const remaining = (rows ?? []).filter((r) => r.ok);
      setRows(remaining.length ? remaining : null);
      toast.message(`Deleted ${bad.length} corrupt cartridge row(s). Re-import your .crt files.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }
  const badRows = rows?.filter((r) => !r.ok) ?? [];
  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-bg/40 p-3">
      <h3 className="mb-2 text-sm font-medium text-fg">Library cartridge scan</h3>
      <p className="mb-2 text-xs leading-5 text-fg-muted">
        Checks every <strong>On this device</strong> row that looks like a CRT (including old saves without a{" "}
        <code className="text-fg">.crt</code> extension). Also logged as{" "}
        <code className="text-fg">[grok64] libraryCartScan</code> or <code className="text-fg">__g64.scanLibraryCarts()</code>.
      </p>
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-border bg-bg px-3 py-1.5 text-xs font-medium text-fg"
          disabled={busy}
          onClick={() => void runScan()}
        >
          {busy ? "Scanning…" : "Scan library CRTs"}
        </button>
        {badRows.length > 0 ? (
          <button
            type="button"
            className="rounded-md border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-fg"
            disabled={busy}
            onClick={() => void deleteBadRows()}
          >
            Delete {badRows.length} corrupt row{badRows.length === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>
      {rows && badRows.length > 0 ? (
        <ul className="mb-2 space-y-1 text-xs text-fg-muted">
          {badRows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 px-2 py-1">
              <span className="min-w-0 break-all">
                <strong className="text-fg">{r.name}</strong>
                {r.issue ? ` · ${r.issue}` : ""} · {r.payloadBytes} bytes
              </span>
              <button
                type="button"
                className="shrink-0 text-red-400 underline"
                disabled={busy}
                onClick={() => void deleteBadRows([r])}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {rows && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-fg-muted">
          {JSON.stringify(rows, null, 2)}
        </pre>
      )}
    </div>
  );
}

function Drive8DiagPanel() {
  const aboutOpen = useEmu((s) => s.aboutOpen);
  const [text, setText] = useState("");
  useEffect(() => {
    if (!aboutOpen) return;
    const g0 = (window as unknown as { __g64?: Record<string, unknown> }).__g64;
    (g0?.kbdReleaseAll as (() => void) | undefined)?.();
    const tick = async () => {
      const g = (window as unknown as { __g64?: Record<string, unknown> }).__g64;
      if (!g) {
        setText("Power on the C64 first, then reopen About.");
        return;
      }
      const attachDiskDiag = g.attachDiskDiag as
        | ((opts?: { light?: boolean }) => Promise<Record<string, unknown>>)
        | undefined;
      const diag = attachDiskDiag ? await attachDiskDiag({ light: true }) : null;
      const block = {
        at: new Date().toISOString(),
        diag,
        playMode: (g.playMode as (() => string) | undefined)?.(),
        cartLive: (g.cartLive as (() => boolean) | undefined)?.(),
        booting: (g.booting as (() => boolean) | undefined)?.(),
        jiffyLive: (g.jiffyLive as (() => boolean) | undefined)?.(),
        workDisk: (g.workDisk as (() => string) | undefined)?.(),
        bootFile: (g.bootFile as (() => string) | undefined)?.(),
        logs: drive8LogLines(20),
      };
      setText(JSON.stringify(block, null, 2));
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => window.clearInterval(id);
  }, [aboutOpen]);
  const exportsMissing =
    text.includes('"diskExportsPresent": false') || text.includes('"viceDiskExports": false');
  const coreMismatch =
    text.includes('"coreBuildMatches": false') ||
    text.includes('"loadedGlueHasDiskExports": false') ||
    text.includes('"coreBuildIdLoaded": "stale-no-disk-exports"');

  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-bg/40 p-3">
      <h3 className="mb-2 text-sm font-medium text-fg">Drive 8 diagnostics</h3>
      {exportsMissing || coreMismatch ? (
        <p className="mb-2 rounded-md border border-amber-500/60 bg-amber-500/15 px-2 py-2 text-xs font-medium leading-5 text-amber-100">
          Stale or stock VICE core — disk WASM exports are missing or the loaded glue does not match the committed build.
          Grok64 may purge only stale EmulatorJS core rows and reload once; your Software library uses a separate database — check{" "}
          <code className="text-fg">libraryIdb</code> in the JSON. Compare{" "}
          <code className="text-fg">coreBuildIdExpected</code> vs <code className="text-fg">coreBuildIdLoaded</code> in
          the JSON below. Send this block if it persists after one reload.
        </p>
      ) : null}
      <p className="mb-2 text-xs leading-5 text-fg-muted">
        Live attach state for IEC unit 8 (refreshes every 2s). Check{" "}
        <code className="text-fg">coreBuildIdExpected</code>, <code className="text-fg">coreBuildIdLoaded</code>,{" "}
        <code className="text-fg">diskExportsPresent</code>, <code className="text-fg">viceLastReattach.rc</code> (0 =
        ok; negative = WASM errno, see <code className="text-fg">rcLabel</code>), and{" "}
        <code className="text-fg">iecWasmDriveState</code>,{" "}
        <code className="text-fg">viceDriveLive.wasmTdeImageBytes</code> (1541 GCR image on the IEC bus),{" "}
        <code className="text-fg">wasmGcrLoaded</code>, <code className="text-fg">wasmVdriveImageSame</code>, and{" "}
        <code className="text-fg">viceDriveBus</code> (drive CPU clock advancing,{" "}
        <code className="text-fg">wasmFilesystemDevice</code>=0,{" "}
        <code className="text-fg">serialDeviceLabel</code> not <code className="text-fg">virt</code>,{" "}
        <code className="text-fg">viceLoadDollarDiag</code> (captured every About refresh and auto on FILE NOT FOUND; BASIC $0200, KERNAL $C3, vdrive error 62, track-18 BAM, IEC lines;{" "}
        <code className="text-fg">errorInfo</code> shows a D64 error table as stored: code counts, the track 18 codes, and the flagged sectors;{" "}
        <code className="text-fg">dos1541</code> reads the true drive&apos;s RAM: its error channel, the name it received, and the disk ID).{" "}
        <code className="text-fg">wasmIecBusAtn</code> false at idle READY (ATN released);{" "}
        <code className="text-fg">profilePersistDiff</code> diffs localStorage / vicerc / WASM drive resources vs a fresh profile. WASM only — copy and send
        this block. Logs: last 20 floppy-attach / play-mount lines.
      </p>
      <button
        type="button"
        className="g64-btn mb-2 w-full"
        disabled={!text}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(
            () => toast.message("Drive 8 diagnostics copied"),
            () => toast.error("Could not copy — select the text below"),
          );
        }}
      >
        Copy diagnostics
      </button>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-fg-muted">
        {text || "Loading…"}
      </pre>
    </div>
  );
}

function LastCartPlayDiagPanel() {
  const [diag, setDiag] = useState(() => getLastCartPlayDiagnostic());
  useEffect(() => {
    const sync = () => setDiag(getLastCartPlayDiagnostic());
    sync();
    const t = window.setInterval(sync, 1500);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", sync);
    };
  }, []);
  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-bg/40 p-3">
      <h3 className="mb-2 text-sm font-medium text-fg">Last cartridge Play</h3>
      <p className="mb-2 text-xs leading-5 text-fg-muted">
        Shown after each cart Play — also logged as <code className="text-fg">[grok64] lastCartPlay</code> in the
        browser console. attachCode: -1 write failed, 0 not mounted, &gt;0 CRT hw type id when known.
      </p>
      {diag ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-fg-muted">
          {JSON.stringify(diag, null, 2)}
        </pre>
      ) : (
        <p className="text-xs text-fg-muted">No cartridge Play recorded yet this session.</p>
      )}
    </div>
  );
}

function MapperList() {
  const binds = useEmu((s) => s.binds);
  const setBind = useEmu((s) => s.setBind);
  const [listen, setListen] = useState<ActionId | null>(null);

  useEffect(() => {
    if (!listen) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (listen === "up" || listen === "down" || listen === "left" || listen === "right") {
        setListen(null);
        return;
      }
      if (listen === "fire") {
        setBind("fire", { keys: ["ControlRight"] });
        setListen(null);
        return;
      }
      setBind(listen, { keys: [e.code] });
      setListen(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    let raf = 0;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      const pads = navigator.getGamepads?.() ?? [];
      const pad = pads.find((p) => p && p.id !== "Grok64 Touch");
      if (!pad) return;
      const idx = pad.buttons.findIndex((b) => b.pressed);
      if (idx >= 0) {
        setBind(listen, { padButtons: [idx] });
        setListen(null);
      }
    };
    raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      cancelAnimationFrame(raf);
    };
  }, [listen, setBind]);

  return (
    <div className="g64-list">
      {(Object.keys(ACTION_LABEL) as ActionId[]).map((action) => {
        const b = binds.find((x) => x.action === action);
        const waiting = listen === action;
        return (
          <button
            key={action}
            type="button"
            className="g64-card"
            onClick={() => setListen(waiting ? null : action)}
          >
            <strong>{ACTION_LABEL[action]}</strong>
            <em className="g64-tag not-italic">{waiting ? "listening" : "tap"}</em>
            <span>
              {waiting
                ? "Press a key or pad button"
                : `${b?.keys.join(", ") || "—"} ${b?.padButtons.length ? `· pad ${b.padButtons.join("/")}` : ""}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
