import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import { detectLine, MACHINES, type ResolvedMachine } from "@/lib/emu/machines";
import { ACTION_LABEL, useEmu } from "@/lib/emu/store";
import type { ActionId, CorePref, DriveMode, SidEngine, SidModel, VideoPref } from "@/lib/emu/types";

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
      <Drawer.Root open={s.settingsOpen} onOpenChange={s.setSettingsOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[900] bg-black/60" />
          <Drawer.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950] overflow-auto">
            <div className="g64-handle" />
            <Drawer.Title asChild>
              <h2>Machine</h2>
            </Drawer.Title>
            <p className="lead">
              Auto picks PAL or NTSC from the software — filename tags, SID flags, and known releases — so it runs as the coder intended. Fast core on phones and budget tablets. Video and core apply on the next load. Joystick port swaps immediately.
            </p>
            {resolved ? <p className="g64-detect-inline">{detectLine(resolved)}</p> : null}

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
              PAL vs NTSC follows the title, not your timezone. SuperCPU uses the xscpu64 core when the WASM build is present; otherwise it falls back to C64. C128 dual-screen (VIC-II + VDC) is available by selecting C128.
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
