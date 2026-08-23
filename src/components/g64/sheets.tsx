import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MACHINES, describeResolved, type ResolvedMachine } from "@/lib/g64/machines";
import { BIND_LABELS, useG64, type BindAction } from "@/lib/g64/store";

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="g64-switch"
      data-on={on ? "true" : "false"}
      onClick={onToggle}
      role="switch"
      aria-checked={on}
    >
      <i />
    </button>
  );
}

function BindMapper() {
  const binds = useG64((s) => s.binds);
  const setBind = useG64((s) => s.setBind);
  const [listen, setListen] = useState<BindAction | null>(null);

  useEffect(() => {
    if (!listen) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      setBind(listen, { keys: [e.code] });
      setListen(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const pad = (navigator.getGamepads?.() ?? []).find((g) => g);
      if (!pad) return;
      const idx = pad.buttons.findIndex((b) => b.pressed);
      if (idx >= 0) {
        setBind(listen, { padButtons: [idx] });
        setListen(null);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(raf);
    };
  }, [listen, setBind]);

  return (
    <div className="g64-list">
      {binds.map((bind) => {
        const active = listen === bind.action;
        return (
          <button
            key={bind.action}
            type="button"
            className="g64-card"
            onClick={() => setListen(active ? null : bind.action)}
          >
            <strong>{BIND_LABELS[bind.action]}</strong>
            <em className="g64-tag not-italic">{active ? "listening" : "tap"}</em>
            <span>
              {active
                ? "Press a key or pad button"
                : `${bind.keys.join(", ") || "—"} ${bind.padButtons.length ? `· pad ${bind.padButtons.join("/")}` : ""}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function SettingsSheets({ resolved }: { resolved: ResolvedMachine }) {
  const st = useG64();
  const machine = MACHINES.find((m) => m.id === st.machineId);
  const c64 = (machine?.family ?? "c64") === "c64";

  return (
    <>
      <Dialog.Root open={st.settingsOpen} onOpenChange={st.setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[900] bg-black/60" />
          <Dialog.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950] overflow-auto">
            <div className="g64-handle" />
            <Dialog.Title asChild>
              <h2>Machine</h2>
            </Dialog.Title>
            <p className="lead">
              Auto picks PAL or NTSC from the software — filename tags, SID flags, and known releases — so it runs as
              the coder intended. Fast core on phones and budget tablets. Video and core apply on the next load.
              Joystick port swaps immediately.
            </p>
            {resolved ? <p className="g64-detect-inline">{describeResolved(resolved)}</p> : null}
            <div className="g64-field">
              <label>Video</label>
              <div className="g64-seg">
                {(
                  [
                    ["auto", "Auto"],
                    ["ntsc", "NTSC 60"],
                    ["pal", "PAL 50"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    data-on={st.videoStandard === id}
                    onClick={() => st.setVideoStandard(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-fg-subtle">
                Auto reads the dump, not your location. Untagged titles boot PAL (VICE default). Force PAL 50 or NTSC 60
                when a release is tagged wrong.
              </p>
            </div>
            {c64 ? (
              <div className="g64-field">
                <label>CPU core</label>
                <div className="g64-seg">
                  {(
                    [
                      ["auto", "Auto"],
                      ["accurate", "Accurate"],
                      ["fast", "Fast"],
                    ] as const
                  ).map(([id, label]) => (
                    <button key={id} type="button" data-on={st.coreMode === id} onClick={() => st.setCoreMode(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="g64-field">
              <label>Model</label>
              <select value={st.machineId} onChange={(e) => st.setMachine(e.target.value)}>
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
              <p className="text-xs text-fg-subtle">{machine?.blurb}</p>
            </div>
            <div className="g64-field">
              <label>SID engine</label>
              <div className="g64-seg">
                {(["ReSID", "FastSID", "ReSID-fp"] as const).map((id) => (
                  <button key={id} type="button" data-on={st.sidEngine === id} onClick={() => st.setSidEngine(id)}>
                    {id}
                  </button>
                ))}
              </div>
            </div>
            <div className="g64-field">
              <label>SID chip</label>
              <div className="g64-seg">
                {(["6581", "8580", "default"] as const).map((id) => (
                  <button key={id} type="button" data-on={st.sidModel === id} onClick={() => st.setSidModel(id)}>
                    {id === "default" ? "From model" : id}
                  </button>
                ))}
              </div>
            </div>
            <div className="g64-field">
              <label>1541 drive</label>
              <div className="g64-seg">
                {(
                  [
                    ["auto", "Auto"],
                    ["true", "Accurate"],
                    ["fast", "Fast traps"],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" data-on={st.driveMode === id} onClick={() => st.setDriveMode(id)}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-fg-subtle">
                Disks always use a real 1541 so custom loaders (Ghostbusters, Ocean, Epyx) don't freeze. Fast traps stay
                on for BASIC on phones.
              </p>
            </div>
            <div className="g64-field">
              <label>Joystick port</label>
              <div className="g64-seg">
                <button type="button" data-on={st.joyPort === 2} onClick={() => st.setJoyPort(2)}>
                  Port 2
                </button>
                <button type="button" data-on={st.joyPort === 1} onClick={() => st.setJoyPort(1)}>
                  Port 1
                </button>
              </div>
              <p className="text-xs text-fg-subtle">
                Most titles read Port 2. Swap here, or tap P1/P2 next to FIRE, if the stick does nothing. WARP sits next
                to FIRE and in the top bar.
              </p>
            </div>
            <div className="g64-row">
              <span>Pause</span>
              <Switch on={st.paused} onToggle={() => st.setPaused(!st.paused)} />
            </div>
            <div className="g64-row">
              <span>Warp (fast forward)</span>
              <Switch on={st.warped} onToggle={() => st.setWarped(!st.warped)} />
            </div>
            <div className="g64-row">
              <span>Mute</span>
              <Switch on={st.muted} onToggle={() => st.setMuted(!st.muted)} />
            </div>
            <div className="g64-row">
              <span>CRT scanlines</span>
              <Switch on={st.crtFilter} onToggle={() => st.setCrtFilter(!st.crtFilter)} />
            </div>
            <div className="g64-row">
              <span>On-screen joystick</span>
              <Switch on={st.showJoystick} onToggle={() => st.setShowJoystick(!st.showJoystick)} />
            </div>
            <div className="g64-row">
              <span>Arrows as joystick</span>
              <Switch on={st.arrowsAreJoy} onToggle={() => st.setArrowsAreJoy(!st.arrowsAreJoy)} />
            </div>
            <div className="g64-field">
              <label>Volume</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={st.volume}
                onChange={(e) => st.setVolume(Number(e.target.value))}
              />
            </div>
            <button type="button" className="g64-btn mt-2 w-full" onClick={() => st.setMapperOpen(true)}>
              Map Bluetooth / gamepad
            </button>
            <button type="button" className="g64-btn mt-2 w-full" onClick={() => st.setAboutOpen(true)}>
              About VICE & credits
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={st.mapperOpen} onOpenChange={st.setMapperOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[900] bg-black/60" />
          <Dialog.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
            <div className="g64-handle" />
            <Dialog.Title asChild>
              <h2>Controls</h2>
            </Dialog.Title>
            <p className="lead">
              Pair a Bluetooth pad in iPhone Settings or Android Bluetooth, then press a button here. HID, MFi, Xbox,
              DualShock and most Android controllers show up in the Gamepad API. Web Bluetooth is not available in iOS
              Safari.
            </p>
            {st.padName ? (
              <p className="mb-3 text-sm text-phosphor">{st.padName}</p>
            ) : (
              <p className="mb-3 text-sm text-fg-muted">No pad yet — press any button on the controller.</p>
            )}
            <BindMapper />
            <button type="button" className="g64-btn mt-3 w-full" onClick={() => st.resetBinds()}>
              Reset mapping
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={st.aboutOpen} onOpenChange={st.setAboutOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[900] bg-black/60" />
          <Dialog.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
            <div className="g64-handle" />
            <Dialog.Title asChild>
              <h2>Grok64 Emu</h2>
            </Dialog.Title>
            <p className="lead">
              A phone-and-tablet shell around VICE. Cycle-accurate C64 via the libretro x64sc core, with a Fast x64
              fallback on iPhone and budget Android tablets. SID from reSID, 1541 true-drive, cartridges, and the rest of
              the VICE family wired for later.
            </p>
            <p className="mb-3 text-sm leading-6 text-fg-muted">
              Emulation: VICE (GPLv2+) · libretro vice cores · EmulatorJS WASM loader. SID: reSID (Dag Lem). Palette:
              Pepto PAL/NTSC. Catalog: Assembly64, HVSC, Internet Archive. Downloads are stored on this device.
            </p>
            <p className="text-sm leading-6 text-fg-muted">
              PAL vs NTSC follows the title, not your timezone. SuperCPU uses the xscpu64 core when the WASM build is
              present; otherwise it falls back to C64. C128 dual-screen (VIC-II + VDC) is available by selecting C128.
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
