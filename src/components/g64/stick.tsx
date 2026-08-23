import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, FastForward } from "lucide-react";
import type { JoyPort } from "@/lib/g64/types";

function capture(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* ignore */
  }
}

export function Stick({
  onVector,
  onFire,
  joyPort,
  onSwap,
  warped,
  onWarp,
  hidden,
  locked,
}: {
  onVector: (x: number, y: number) => void;
  onFire: (down: boolean) => void;
  joyPort: JoyPort;
  onSwap: () => void;
  warped: boolean;
  onWarp?: () => void;
  hidden: boolean;
  locked: boolean;
}) {
  const stickRef = useRef<HTMLDivElement>(null);
  const fireRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [fireDown, setFireDown] = useState(false);
  const pid = useRef<number | null>(null);
  const fireFn = useRef(onFire);
  fireFn.current = onFire;
  const lockRef = useRef(locked);
  lockRef.current = locked;

  useEffect(() => {
    const el = fireRef.current;
    if (!el) return;
    let last = 0;
    let to: number | null = null;
    const down = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (lockRef.current) return;
      const now = Date.now();
      if (now - last < 40) return;
      last = now;
      if (to) {
        window.clearTimeout(to);
        to = null;
      }
      setFireDown(true);
      fireFn.current(true);
    };
    const up = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (to) window.clearTimeout(to);
      to = window.setTimeout(() => {
        to = null;
        setFireDown(false);
        fireFn.current(false);
      }, 80);
    };
    const opts: AddEventListenerOptions = { passive: false };
    el.addEventListener("pointerdown", down, opts);
    el.addEventListener("touchstart", down, opts);
    el.addEventListener("pointerup", up, opts);
    el.addEventListener("touchend", up, opts);
    el.addEventListener("pointercancel", up, opts);
    el.addEventListener("touchcancel", up, opts);
    el.addEventListener("lostpointercapture", up, opts);
    return () => {
      if (to) window.clearTimeout(to);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("touchstart", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("touchend", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("touchcancel", up);
      el.removeEventListener("lostpointercapture", up);
    };
  }, [hidden]);

  if (hidden) return null;

  function move(clientX: number, clientY: number) {
    const el = stickRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    let x = (clientX - cx) / (box.width / 2);
    let y = (clientY - cy) / (box.height / 2);
    const mag = Math.hypot(x, y);
    if (mag > 1) {
      x /= mag;
      y /= mag;
    }
    setKnob({ x, y });
    onVector(x, y);
  }

  return (
    <div className="g64-controls">
      <div
        ref={stickRef}
        className="g64-stick"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          pid.current = e.pointerId;
          capture(e.currentTarget, e.pointerId);
          move(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (pid.current === e.pointerId) {
            e.preventDefault();
            move(e.clientX, e.clientY);
          }
        }}
        onPointerUp={(e) => {
          if (pid.current === e.pointerId) {
            pid.current = null;
            setKnob({ x: 0, y: 0 });
            onVector(0, 0);
          }
        }}
        onPointerCancel={() => {
          pid.current = null;
          setKnob({ x: 0, y: 0 });
          onVector(0, 0);
        }}
        aria-label="Joystick"
      >
        <div className="g64-knob" style={{ "--kx": String(knob.x), "--ky": String(knob.y) } as React.CSSProperties} />
      </div>
      <div className="g64-fire-col">
        <div className="g64-play-tools">
          <button
            type="button"
            className="g64-port"
            aria-label={`Joystick port ${joyPort}, tap to swap`}
            title={`Joystick port ${joyPort} — tap to swap`}
            onPointerDown={(e) => {
              e.preventDefault();
              onSwap();
            }}
          >
            <ArrowLeftRight className="size-3.5" />P{joyPort}
          </button>
          {onWarp ? (
            <button
              type="button"
              className="g64-port"
              data-on={warped ? "true" : "false"}
              aria-label={warped ? "Warp on, tap to disable" : "Warp off, tap to enable"}
              title="Warp"
              onPointerDown={(e) => {
                e.preventDefault();
                onWarp();
              }}
            >
              <FastForward className="size-3.5" />
              WARP
            </button>
          ) : null}
        </div>
        <div
          ref={fireRef}
          className="g64-fire"
          data-down={fireDown ? "true" : "false"}
          data-locked={locked ? "true" : "false"}
          role="button"
          aria-label="Fire"
        >
          FIRE
        </div>
      </div>
    </div>
  );
}
