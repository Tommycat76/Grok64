import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, FastForward } from "lucide-react";
import type { JoyPort } from "@/lib/emu/types";

interface Props {
  onVector: (x: number, y: number) => void;
  onFire: (down: boolean) => void;
  joyPort: JoyPort;
  onSwap: () => void;
  warped?: boolean;
  onWarp?: () => void;
  hidden?: boolean;
  locked?: boolean;
}

function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* iOS WebView can reject capture */
  }
}

/** Snap analog stick to 8-way digital for C64 accuracy. */
function snap8(dx: number, dy: number): { x: number; y: number } {
  const m = Math.hypot(dx, dy);
  if (m < 0.28) return { x: 0, y: 0 };
  const a = Math.atan2(dy, dx);
  const sector = Math.round((a / Math.PI) * 4);
  switch (sector) {
    case 0:
      return { x: 1, y: 0 };
    case 1:
      return { x: 1, y: 1 };
    case 2:
      return { x: 0, y: 1 };
    case 3:
      return { x: -1, y: 1 };
    case 4:
    case -4:
      return { x: -1, y: 0 };
    case -3:
      return { x: -1, y: -1 };
    case -2:
      return { x: 0, y: -1 };
    case -1:
      return { x: 1, y: -1 };
    default:
      return { x: 0, y: 0 };
  }
}

export function TouchControls({
  onVector,
  onFire,
  joyPort,
  onSwap,
  warped,
  onWarp,
  hidden,
  locked,
}: Props) {
  const base = useRef<HTMLDivElement>(null);
  const fireEl = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [fire, setFire] = useState(false);
  const pid = useRef<number | null>(null);
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    const el = fireEl.current;
    if (!el) return;
    let lastPress = 0;
    let holdTimer: number | null = null;
    const press = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (lockedRef.current) return;
      const now = Date.now();
      if (now - lastPress < 40) return;
      lastPress = now;
      if (holdTimer) {
        window.clearTimeout(holdTimer);
        holdTimer = null;
      }
      setFire(true);
      onFireRef.current(true);
    };
    const release = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (holdTimer) window.clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        setFire(false);
        onFireRef.current(false);
      }, 80);
    };
    const opts: AddEventListenerOptions = { passive: false };
    el.addEventListener("pointerdown", press, opts);
    el.addEventListener("touchstart", press, opts);
    el.addEventListener("pointerup", release, opts);
    el.addEventListener("touchend", release, opts);
    el.addEventListener("pointercancel", release, opts);
    el.addEventListener("touchcancel", release, opts);
    el.addEventListener("lostpointercapture", release, opts);
    return () => {
      if (holdTimer) window.clearTimeout(holdTimer);
      el.removeEventListener("pointerdown", press);
      el.removeEventListener("touchstart", press);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("touchend", release);
      el.removeEventListener("pointercancel", release);
      el.removeEventListener("touchcancel", release);
      el.removeEventListener("lostpointercapture", release);
    };
  }, [hidden]);

  if (hidden) return null;

  function setFromPoint(clientX: number, clientY: number) {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (clientX - cx) / (r.width / 2);
    let dy = (clientY - cy) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    const snapped = snap8(dx, dy);
    setKnob(snapped);
    onVector(snapped.x, snapped.y);
  }

  function stickDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    pid.current = e.pointerId;
    capture(e.currentTarget, e.pointerId);
    setFromPoint(e.clientX, e.clientY);
  }

  return (
    <div className="g64-controls">
      <div
        ref={base}
        className="g64-stick"
        onPointerDown={stickDown}
        onPointerMove={(e) => {
          if (pid.current !== e.pointerId) return;
          e.preventDefault();
          setFromPoint(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (pid.current !== e.pointerId) return;
          pid.current = null;
          setKnob({ x: 0, y: 0 });
          onVector(0, 0);
        }}
        onPointerCancel={() => {
          pid.current = null;
          setKnob({ x: 0, y: 0 });
          onVector(0, 0);
        }}
        aria-label="Joystick"
      >
        <div
          className="g64-knob"
          style={
            {
              "--kx": String(knob.x),
              "--ky": String(knob.y),
            } as React.CSSProperties
          }
        />
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
            <ArrowLeftRight className="size-3.5" />
            P{joyPort}
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
          ref={fireEl}
          className="g64-fire"
          data-down={fire ? "true" : "false"}
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
