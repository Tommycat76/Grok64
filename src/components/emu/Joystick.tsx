import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, FastForward } from "lucide-react";
import type { JoyPort } from "@/lib/emu/types";
import { snapStick } from "@/lib/emu/stick-precision.mjs";

export type StickGate = "4way" | "8way";

interface Props {
  onVector: (x: number, y: number) => void;
  onFire: (down: boolean) => void;
  onJump?: (down: boolean) => void;
  joyPort: JoyPort;
  onSwap: () => void;
  warped?: boolean;
  onWarp?: () => void;
  hidden?: boolean;
  padActive?: boolean;
  stickHidden?: boolean;
  locked?: boolean;
  vector?: { x: number; y: number };
  gate?: StickGate;
  jumpEnabled?: boolean;
  frameMs?: number;
}

function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* iOS WebView can reject capture */
  }
}

export function TouchControls({
  onVector,
  onFire,
  onJump,
  joyPort,
  onSwap,
  warped,
  onWarp,
  hidden,
  padActive,
  stickHidden,
  locked,
  vector,
  gate = "8way",
  jumpEnabled = false,
  frameMs = 20,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const stickEl = useRef<HTMLDivElement>(null);
  const fireEl = useRef<HTMLDivElement>(null);
  const jumpEl = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [fireDown, setFireDown] = useState(false);
  const [jumpDown, setJumpDown] = useState(false);
  const stickPid = useRef<number | null>(null);
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;
  const onVectorRef = useRef(onVector);
  onVectorRef.current = onVector;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const gateRef = useRef(gate);
  gateRef.current = gate;
  const frameMsRef = useRef(frameMs);
  frameMsRef.current = frameMs;
  const lastDir = useRef({ x: 0, y: 0 });
  const sentDir = useRef({ x: 0, y: 0 });
  const tapHold = useRef<number | null>(null);
  const downAt = useRef(0);

  function emitVector(dx: number, dy: number) {
    const out = snapStick(dx, dy, sentDir.current, gateRef.current);
    if (out.x !== sentDir.current.x || out.y !== sentDir.current.y) {
      sentDir.current = out;
      onVectorRef.current(out.x, out.y);
    }
  }

  function setFromPoint(clientX: number, clientY: number) {
    const el = stickEl.current;
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
    lastDir.current = { x: dx, y: dy };
    setKnob({ x: dx, y: dy });
    emitVector(dx, dy);
  }

  function centerStick() {
    lastDir.current = { x: 0, y: 0 };
    sentDir.current = { x: 0, y: 0 };
    setKnob({ x: 0, y: 0 });
    onVectorRef.current(0, 0);
  }

  function zoneAt(target: EventTarget | null, x?: number, y?: number): "stick" | "fire" | "jump" | null {
    let el = target instanceof Element ? target : null;
    if (!el && x != null && y != null) el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (jumpEl.current?.contains(el) || el.closest(".g64-jump")) return "jump";
    if (fireEl.current?.contains(el) || el.closest(".g64-fire:not(.g64-jump)")) return "fire";
    if (stickEl.current?.contains(el) || el.closest(".g64-stick")) return "stick";
    return null;
  }

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const active = new Map<number, "stick" | "fire" | "jump">();
    let fireOn = false;
    let jumpOn = false;

    const syncButtons = () => {
      const zones = [...active.values()];
      const nextFire = zones.includes("fire");
      const nextJump = zones.includes("jump");
      if (nextFire !== fireOn) {
        fireOn = nextFire;
        setFireDown(nextFire);
        onFireRef.current(nextFire);
      }
      if (nextJump !== jumpOn) {
        jumpOn = nextJump;
        setJumpDown(nextJump);
        onJumpRef.current?.(nextJump);
      }
    };

    const down = (id: number, zone: "stick" | "fire" | "jump", x: number, y: number) => {
      if (lockedRef.current || active.has(id)) return;
      active.set(id, zone);
      if (zone === "stick") {
        if (tapHold.current) {
          window.clearTimeout(tapHold.current);
          tapHold.current = null;
        }
        stickPid.current = id;
        downAt.current = Date.now();
        setFromPoint(x, y);
      }
      syncButtons();
    };

    const move = (id: number, x: number, y: number) => {
      const zone = active.get(id);
      if (zone === "stick" && stickPid.current === id) setFromPoint(x, y);
    };

    const up = (id: number) => {
      const zone = active.get(id);
      if (!zone) return;
      active.delete(id);
      if (zone === "stick" && stickPid.current === id) {
        stickPid.current = null;
        const held = Date.now() - downAt.current;
        const dir = lastDir.current;
        const stillStick = [...active.values()].includes("stick");
        if (!stillStick) {
          if (held < 140 && (dir.x !== 0 || dir.y !== 0)) {
            tapHold.current = window.setTimeout(() => {
              tapHold.current = null;
              centerStick();
            }, 90);
          } else {
            centerStick();
          }
        }
      }
      syncButtons();
    };

    const onTouchStart = (e: TouchEvent) => {
      let hit = false;
      for (const t of Array.from(e.changedTouches)) {
        const z = zoneAt(e.target, t.clientX, t.clientY);
        if (z) {
          hit = true;
          down(t.identifier, z, t.clientX, t.clientY);
        }
      }
      if (hit) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      let hit = false;
      for (const t of Array.from(e.changedTouches)) {
        if (active.has(t.identifier)) {
          hit = true;
          move(t.identifier, t.clientX, t.clientY);
        }
      }
      if (hit) e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) up(t.identifier);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const z = zoneAt(e.target, e.clientX, e.clientY);
      if (!z) return;
      e.preventDefault();
      if (z === "stick") capture(host, e.pointerId);
      down(e.pointerId, z, e.clientX, e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !active.has(e.pointerId)) return;
      e.preventDefault();
      move(e.pointerId, e.clientX, e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      up(e.pointerId);
    };

    const opts: AddEventListenerOptions = { passive: false };
    host.addEventListener("touchstart", onTouchStart, opts);
    host.addEventListener("touchmove", onTouchMove, opts);
    host.addEventListener("touchend", onTouchEnd, opts);
    host.addEventListener("touchcancel", onTouchEnd, opts);
    host.addEventListener("pointerdown", onPointerDown, opts);
    host.addEventListener("pointermove", onPointerMove, opts);
    host.addEventListener("pointerup", onPointerUp, opts);
    host.addEventListener("pointercancel", onPointerUp, opts);
    return () => {
      active.clear();
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
    };
  }, [hidden, padActive, jumpEnabled]);

  if (hidden) return null;

  const tools = (
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
  );

  if (padActive || stickHidden) {
    return (
      <div ref={root} className="g64-controls" data-pad={padActive ? "true" : "false"}>
        {padActive ? <div className="g64-pad-note">Controller</div> : <div />}
        <div className="g64-fire-col">{tools}</div>
      </div>
    );
  }

  const kx = vector?.x ?? knob.x;
  const ky = vector?.y ?? knob.y;

  return (
    <div ref={root} className="g64-controls" data-jump={jumpEnabled ? "true" : "false"}>
      <div className="g64-stick-col">
        <div
          ref={stickEl}
          className="g64-stick"
          data-gate={gate}
          aria-label="Joystick. Tap a direction or drag."
        >
          <span className="g64-stick-tick" data-dir="n" />
          <span className="g64-stick-tick" data-dir="e" />
          <span className="g64-stick-tick" data-dir="s" />
          <span className="g64-stick-tick" data-dir="w" />
          {gate === "8way" ? (
            <>
              <span className="g64-stick-tick" data-dir="ne" />
              <span className="g64-stick-tick" data-dir="se" />
              <span className="g64-stick-tick" data-dir="sw" />
              <span className="g64-stick-tick" data-dir="nw" />
            </>
          ) : null}
          <div
            className="g64-knob"
            style={
              {
                "--kx": String(kx),
                "--ky": String(ky),
              } as React.CSSProperties
            }
          />
        </div>
      </div>
      <div className="g64-fire-col">
        {tools}
        <div className="g64-fire-row">
          <div
            ref={fireEl}
            className="g64-fire"
            data-down={fireDown ? "true" : "false"}
            data-locked={locked ? "true" : "false"}
            role="button"
            aria-label="Fire"
          >
            FIRE
          </div>
          {jumpEnabled ? (
            <div
              ref={jumpEl}
              className="g64-fire g64-jump"
              data-down={jumpDown ? "true" : "false"}
              data-locked={locked ? "true" : "false"}
              role="button"
              aria-label="Jump, stick up"
            >
              JUMP
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
