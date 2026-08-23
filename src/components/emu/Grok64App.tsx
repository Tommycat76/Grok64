/**
 * Main Grok64 shell — power, boot/recover, layout attrs.
 * Reconstructed from build session (bootKickRef race fix, tablet data attrs).
 * EmulatorJS mount is host-specific; this is the React control plane.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { detectDevice } from "../../lib/detect";
import { detectJoyPort } from "../../lib/emu/region";
import { plugJoysticks, setJoyPort, setGameManager } from "../../lib/emu/host";
import { useG64 } from "../../lib/store";
import { TouchControls } from "../touch-controls";

export function Grok64App() {
  const st = useG64();
  const bootKickRef = useRef(false);
  const emuRef = useRef<unknown>(null);
  const [device, setDevice] = useState(() => detectDevice());
  const [kbOpen, setKbOpen] = useState(false);

  useEffect(() => {
    const onResize = () => setDevice(detectDevice());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Expose debug API used by QA scripts
  useEffect(() => {
    (window as unknown as { __g64?: object }).__g64 = {
      joyPort: () => st.joyPort,
      title: () => st.title,
      fire: (down: boolean) => {
        const { pressFire } = require("../../lib/emu/host");
        pressFire(!!down);
      },
    };
  }, [st.joyPort, st.title]);

  const recoverBoot = useCallback(() => {
    // Skip if a user power cold-start is already in flight
    if (bootKickRef.current) return;
    if (st.powered && !emuRef.current) {
      // HMR / dead-core recovery path — optional auto cold start once
      console.debug("[g64] recoverBoot: powered but no core");
    }
  }, [st.powered]);

  useEffect(() => {
    recoverBoot();
  }, [recoverBoot]);

  const powerOn = useCallback(async () => {
    if (bootKickRef.current || st.booting) return;
    bootKickRef.current = true;
    st.setBooting(true);
    st.setPowered(true);
    try {
      // startWithUrl(blank.d64) + EmulatorJS startOnLoad — host integration
      console.debug("[g64] boot-begin");
      // await start emulator…
      st.setRunning(true);
    } catch (e) {
      console.error("[g64] boot failed", e);
      st.setPowered(false);
      st.setRunning(false);
    } finally {
      st.setBooting(false);
      // Keep kick flag briefly so recoverBoot cannot double-start
      setTimeout(() => {
        bootKickRef.current = false;
      }, 500);
    }
  }, [st]);

  const playBuffer = useCallback(
    async (title: string, _data: ArrayBuffer) => {
      const port = detectJoyPort(title);
      st.setJoyPort(port);
      setJoyPort(port);
      plugJoysticks(port);
      st.setTitle(title);
      // hot-swap writeBootFile / resetEmu gated by playLock during autostart
    },
    [st]
  );

  const appAttrs = {
    className: "g64-app",
    "data-device": device.kind,
    "data-kb": kbOpen ? "true" : "false",
    "data-powered": st.powered ? "true" : "false",
  } as const;

  if (!st.powered) {
    return (
      <div {...appAttrs}>
        <div className="g64-splash">
          <h1>GROK64 EMU</h1>
          <button
            type="button"
            className="g64-power"
            onPointerDown={(e) => {
              e.preventDefault();
              void powerOn();
            }}
            onClick={() => void powerOn()}
          >
            Power
          </button>
          <p className="g64-hint">Tap power for cold start</p>
        </div>
      </div>
    );
  }

  return (
    <div {...appAttrs}>
      <header className="g64-header">
        <span>Grok64</span>
        <span className="g64-badge">C64</span>
        <button type="button" onClick={() => setKbOpen((v) => !v)}>
          KB
        </button>
      </header>
      <div className="g64-stage">
        <div className="g64-screen" id="g64-player">
          {/* EmulatorJS canvas mounts here */}
          {st.booting && <div className="g64-boot">Cold start…</div>}
        </div>
      </div>
      {!st.booting && st.showJoystick && <TouchControls disabled={st.booting} />}
      {kbOpen && <div className="g64-kb">{/* virtual keyboard */}</div>}
    </div>
  );
}

export default Grok64App;
