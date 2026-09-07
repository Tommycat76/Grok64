import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { ExpansionPanel } from "@/components/emu/ExpansionPanel";
import { detectLine, MACHINES, type ResolvedMachine } from "@/lib/emu/machines";
import { ACTION_LABEL, useEmu } from "@/lib/emu/store";
import { setDebugUi } from "@/lib/emu/debug";
import type { ActionId, CorePref, DriveMode, IecSlot, ReuSize, ScpuSimm, SidEngine, SidModel, VideoPref } from "@/lib/emu/types";
import { IEC_UNITS } from "@/lib/emu/types";
import { IEC_SLOT_LABEL, REU_LABEL, SCPU_SIMM_LABEL } from "@/lib/emu/vice-extras";

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
                Auto reads the dump, not your location. Untagged titles boot PAL (VICE default). Force PAL 50 or NTSC 60 when a release is tagged wrong.
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
                <code>LOAD"$",9</code> to device 9. Floppy Play always uses a 1541 on #8 so games can{" "}
                <code>LOAD"*",8,1</code>. Device 8 cannot be empty.
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
              <label>SID chip</label>
              <div className="g64-seg">
                {(["6581", "8580", "default"] as SidModel[]).map((e) => (
                  <button key={e} type="button" data-on={s.sidModel === e} onClick={() => s.setSidModel(e)}>
                    {e === "default" ? "From model" : e}
                  </button>
                ))}
              </div>
            </div>

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
                Most titles read Port 2. Swap here, or tap P1/P2 next to FIRE, if the stick does nothing. WARP sits next to FIRE and in the top bar.
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
                Real VICE REU on the expansion port — not stubbed, including on iPhone. 16 MB is what C64 OS needs. .reu / nuvie / C64 OS names auto-enable 16 MB. Size applies on the next core start.
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
            <p className="mb-3 text-xs text-fg-subtle">
              Keyboard is the full C64 keyboard on computer, tablet, and phone. Right Ctrl is FIRE. Arrow keys are CRSR, never the stick. A plugged-in gamepad is used first; the on-screen stick only appears when no controller is connected.
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
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
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
