import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, FastForward, Move } from "lucide-react";
import type { JoyPort, PadSide } from "@/lib/emu/types";
import { layoutStyle, type ControlId, type ControlLayout } from "@/lib/emu/control-layout";
import { snapStick, STICK_OUTER_DEAD, STICK_TAP_HOLD_MS, STICK_TAP_MAX_MS } from "@/lib/emu/stick-precision.mjs";
import { Touchpad } from "@/components/emu/Touchpad";

export type StickGate = "4way" | "8way";

interface Props {
  onVector: (x: number, y: number, centerHold?: boolean) => void;
  stickHoldRef?: React.MutableRefObject<boolean>;
  onFire: (down: boolean) => void;
  onJump?: (down: boolean) => void;
  onMouseDelta?: (dx: number, dy: number) => void;
  onMouseEnd?: () => void;
  onMouseBtn?: (left: boolean, right: boolean) => void;
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
  mouseMode?: boolean;
  padSide?: PadSide;
  layoutEdit?: boolean;
  controlLayout?: ControlLayout;
  onLayoutDrag?: (id: ControlId, left: number, bottom: number) => void;
}

type PointerZones = {
  stick?: boolean;
  latchedFire?: boolean;
  latchedJump?: boolean;
  latchedMouseL?: boolean;
  latchedMouseR?: boolean;
  fire?: boolean;
  jump?: boolean;
  mouseL?: boolean;
  mouseR?: boolean;
};

function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* iOS WebView can reject capture */
  }
}

function hitRect(el: HTMLElement | null, x: number, y: number, pad = 0) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

function LayoutHandle({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="g64-layout-handle" aria-hidden="true">
      <Move className="size-3" />
    </span>
  );
}

export function TouchControls({
  onVector,
  onFire,
  onJump,
  onMouseDelta,
  onMouseEnd,
  onMouseBtn,
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
  mouseMode = false,
  padSide = "left",
  layoutEdit = false,
  controlLayout,
  onLayoutDrag,
  stickHoldRef,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const stickEl = useRef<HTMLDivElement>(null);
  const fireEl = useRef<HTMLDivElement>(null);
  const jumpEl = useRef<HTMLDivElement>(null);
  const mouseLEl = useRef<HTMLDivElement>(null);
  const mouseREl = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [fireDown, setFireDown] = useState(false);
  const [jumpDown, setJumpDown] = useState(false);
  const [mouseLDown, setMouseLDown] = useState(false);
  const [mouseRDown, setMouseRDown] = useState(false);
  const stickPid = useRef<number | null>(null);
  const onFireRef = useRef(onFire);
  onFireRef.current = onFire;
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;
  const onMouseBtnRef = useRef(onMouseBtn);
  onMouseBtnRef.current = onMouseBtn;
  const onVectorRef = useRef(onVector);
  onVectorRef.current = onVector;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const layoutEditRef = useRef(layoutEdit);
  layoutEditRef.current = layoutEdit;
  const gateRef = useRef(gate);
  gateRef.current = gate;
  const frameMsRef = useRef(frameMs);
  frameMsRef.current = frameMs;
  const jumpRef = useRef(jumpEnabled);
  jumpRef.current = jumpEnabled;
  const mouseRef = useRef(mouseMode);
  mouseRef.current = mouseMode;
  const lastDir = useRef({ x: 0, y: 0 });
  const sentDir = useRef({ x: 0, y: 0 });
  const tapHold = useRef<number | null>(null);
  const downAt = useRef(0);
  const stickFingerDown = useRef(false);
  const stickCenterDrag = useRef(false);

  const syncStickHold = () => {
    if (stickHoldRef) stickHoldRef.current = stickCenterDrag.current && stickFingerDown.current;
  };

  const layout = controlLayout;

  const startLayoutDrag = useCallback(
    (id: ControlId, e: React.PointerEvent) => {
      if (!layoutEdit || !onLayoutDrag) return;
      e.preventDefault();
      e.stopPropagation();
      const host = root.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const base = layout?.[id] ?? { left: 50, bottom: 0 };
      const move = (ev: PointerEvent) => {
        const left = base.left + ((ev.clientX - startX) / rect.width) * 100;
        const bottom = base.bottom - ((ev.clientY - startY) / rect.height) * 100;
        onLayoutDrag(id, left, bottom);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [layoutEdit, onLayoutDrag, layout],
  );

  function emitVector(dx: number, dy: number) {
    const out = snapStick(dx, dy, sentDir.current, gateRef.current);
    if (out.x !== sentDir.current.x || out.y !== sentDir.current.y) {
      sentDir.current = out;
      const centerHold = stickCenterDrag.current && stickFingerDown.current;
      syncStickHold();
      onVectorRef.current(out.x, out.y, centerHold);
    }
  }

  function stickMagnitude(clientX: number, clientY: number) {
    const el = stickEl.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = (clientX - cx) / (r.width / 2);
    const dy = (clientY - cy) / (r.height / 2);
    return Math.hypot(dx, dy);
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
    stickFingerDown.current = false;
    stickCenterDrag.current = false;
    syncStickHold();
    setKnob({ x: 0, y: 0 });
    onVectorRef.current(0, 0, false);
  }

  function buttonHits(x: number, y: number) {
    if (mouseRef.current) {
      return {
        fire: false,
        jump: false,
        mouseL: hitRect(mouseLEl.current, x, y, 6),
        mouseR: hitRect(mouseREl.current, x, y, 6),
      };
    }
    return {
      fire: hitRect(fireEl.current, x, y, 6),
      jump: jumpRef.current && hitRect(jumpEl.current, x, y, 6),
      mouseL: false,
      mouseR: false,
    };
  }

  function zonesAt(target: EventTarget | null, x: number, y: number): PointerZones | null {
    const hits = buttonHits(x, y);
    if (hits.fire || hits.jump || hits.mouseL || hits.mouseR) {
      return {
        latchedFire: hits.fire,
        latchedJump: hits.jump,
        latchedMouseL: hits.mouseL,
        latchedMouseR: hits.mouseR,
        fire: hits.fire,
        jump: hits.jump,
        mouseL: hits.mouseL,
        mouseR: hits.mouseR,
      };
    }
    if (mouseRef.current) return null;
    let el = target instanceof Element ? target : null;
    if (!el) el = document.elementFromPoint(x, y);
    if (stickEl.current?.contains(el) || el?.closest(".g64-stick")) return { stick: true };
    if (hitRect(stickEl.current, x, y, 4)) return { stick: true };
    return null;
  }

  useEffect(() => {
    const host = root.current;
    if (!host || mouseRef.current) return;
    const active = new Map<number, PointerZones>();
    let fireOn = false;
    let jumpOn = false;

    const applyButtonZones = (id: number, x: number, y: number) => {
      const z = active.get(id);
      if (!z || z.stick) return;
      const hits = buttonHits(x, y);
      z.fire = z.latchedFire ? true : hits.fire;
      z.jump = z.latchedJump ? true : hits.jump;
      active.set(id, z);
    };

    const syncButtons = () => {
      let nextFire = false;
      let nextJump = false;
      for (const z of active.values()) {
        if (z.fire) nextFire = true;
        if (z.jump) nextJump = true;
      }
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

    const down = (id: number, zones: PointerZones, x: number, y: number) => {
      if (lockedRef.current || layoutEditRef.current || active.has(id)) return;
      active.set(id, zones);
      if (zones.stick) {
        if (tapHold.current) {
          window.clearTimeout(tapHold.current);
          tapHold.current = null;
        }
        stickPid.current = id;
        downAt.current = Date.now();
        stickFingerDown.current = true;
        stickCenterDrag.current = stickMagnitude(x, y) < STICK_OUTER_DEAD;
        syncStickHold();
        setFromPoint(x, y);
      }
      syncButtons();
    };

    const move = (id: number, x: number, y: number) => {
      const zones = active.get(id);
      if (!zones) return;
      if (zones.stick && stickPid.current === id) {
        setFromPoint(x, y);
        return;
      }
      if (zones.latchedFire || zones.latchedJump || zones.fire || zones.jump) {
        applyButtonZones(id, x, y);
        syncButtons();
      }
    };

    const up = (id: number) => {
      const zones = active.get(id);
      if (!zones) return;
      active.delete(id);
      if (zones.stick && stickPid.current === id) {
        stickPid.current = null;
        stickFingerDown.current = false;
        syncStickHold();
        const held = Date.now() - downAt.current;
        const dir = lastDir.current;
        const stillStick = [...active.values()].some((z) => z.stick);
        if (!stillStick) {
          if (held < STICK_TAP_MAX_MS && (dir.x !== 0 || dir.y !== 0)) {
            tapHold.current = window.setTimeout(() => {
              tapHold.current = null;
              centerStick();
            }, STICK_TAP_HOLD_MS);
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
        const z = zonesAt(e.target, t.clientX, t.clientY);
        if (z) {
          hit = true;
          down(t.identifier, z, t.clientX, t.clientY);
        }
      }
      if (hit) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      let hit = false;
      for (const t of Array.from(e.touches)) {
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
      const z = zonesAt(e.target, e.clientX, e.clientY);
      if (!z) return;
      e.preventDefault();
      if (z.stick || z.latchedFire || z.latchedJump) capture(host, e.pointerId);
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
  }, [hidden, padActive, jumpEnabled, mouseMode]);

  useEffect(() => {
    const host = root.current;
    if (!host || !mouseRef.current) return;
    const active = new Map<number, PointerZones>();
    let leftOn = false;
    let rightOn = false;

    const syncMouse = () => {
      let nextL = false;
      let nextR = false;
      for (const z of active.values()) {
        if (z.mouseL) nextL = true;
        if (z.mouseR) nextR = true;
      }
      if (nextL !== leftOn) {
        leftOn = nextL;
        setMouseLDown(nextL);
      }
      if (nextR !== rightOn) {
        rightOn = nextR;
        setMouseRDown(nextR);
      }
      onMouseBtnRef.current?.(leftOn, rightOn);
    };

    const down = (id: number, zones: PointerZones) => {
      if (lockedRef.current || layoutEditRef.current || active.has(id)) return;
      active.set(id, zones);
      syncMouse();
    };
    const move = (id: number, x: number, y: number) => {
      const z = active.get(id);
      if (!z || z.stick) return;
      const hits = buttonHits(x, y);
      z.mouseL = z.latchedMouseL ? true : hits.mouseL;
      z.mouseR = z.latchedMouseR ? true : hits.mouseR;
      active.set(id, z);
      syncMouse();
    };
    const up = (id: number) => {
      active.delete(id);
      syncMouse();
    };

    const onTouchStart = (e: TouchEvent) => {
      let hit = false;
      for (const t of Array.from(e.changedTouches)) {
        const z = zonesAt(e.target, t.clientX, t.clientY);
        if (z && (z.mouseL || z.mouseR)) {
          hit = true;
          down(t.identifier, z);
        }
      }
      if (hit) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      let hit = false;
      for (const t of Array.from(e.touches)) {
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
      const z = zonesAt(e.target, e.clientX, e.clientY);
      if (!z || (!z.mouseL && !z.mouseR)) return;
      e.preventDefault();
      if (z.latchedMouseL || z.latchedMouseR) capture(host, e.pointerId);
      down(e.pointerId, z);
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
  }, [hidden, padActive, mouseMode]);

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

  if (padActive || (stickHidden && !mouseMode)) {
    return (
      <div ref={root} className="g64-controls" data-pad={padActive ? "true" : "false"}>
        {padActive ? <div className="g64-pad-note">Controller</div> : <div />}
        <div className="g64-fire-col">{tools}</div>
      </div>
    );
  }

  const useLayout = Boolean(layout);
  const pos = (id: ControlId) => (useLayout && layout ? layoutStyle(layout[id]) : undefined);

  if (mouseMode) {
    return (
      <div
        ref={root}
        className="g64-controls g64-controls-mouse"
        data-pad-side={padSide}
        data-layout-edit={layoutEdit ? "true" : "false"}
      >
        {layoutEdit ? <div className="g64-layout-banner">Drag controls to reposition</div> : null}
        <div className="g64-touchpad-wrap" style={pos("touchpad")} onPointerDown={(e) => startLayoutDrag("touchpad", e)}>
          <LayoutHandle show={layoutEdit} />
          <Touchpad
            onDelta={(dx, dy) => onMouseDelta?.(dx * 2.4, dy * 2.4)}
            onEnd={onMouseEnd}
            locked={locked}
            layoutEdit={layoutEdit}
            onDrag={(l, b) => onLayoutDrag?.("touchpad", l, b)}
          />
        </div>
        <div className="g64-mouse-col" style={pos("mouseL")}>
          <div className="g64-play-tools">{tools}</div>
          <div className="g64-mouse-row">
            <div
              ref={mouseLEl}
              className="g64-fire g64-mouse-btn"
              data-down={mouseLDown ? "true" : "false"}
              data-locked={locked ? "true" : "false"}
              role="button"
              aria-label="Left mouse button"
              onPointerDown={(e) => startLayoutDrag("mouseL", e)}
            >
              <LayoutHandle show={layoutEdit} />
              LMB
            </div>
            <div
              ref={mouseREl}
              className="g64-fire g64-mouse-btn"
              data-down={mouseRDown ? "true" : "false"}
              data-locked={locked ? "true" : "false"}
              role="button"
              aria-label="Right mouse button"
              onPointerDown={(e) => startLayoutDrag("mouseR", e)}
            >
              <LayoutHandle show={layoutEdit} />
              RMB
            </div>
          </div>
        </div>
      </div>
    );
  }

  const kx = vector?.x ?? knob.x;
  const ky = vector?.y ?? knob.y;

  return (
    <div
      ref={root}
      className="g64-controls"
      data-jump={jumpEnabled ? "true" : "false"}
      data-layout-edit={layoutEdit ? "true" : "false"}
    >
      {layoutEdit ? <div className="g64-layout-banner">Drag controls to reposition</div> : null}
      <div className="g64-stick-col" style={pos("stick")} onPointerDown={(e) => startLayoutDrag("stick", e)}>
        <LayoutHandle show={layoutEdit} />
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
      <div className="g64-fire-col" style={pos("fire")}>
        {tools}
        <div className="g64-fire-row">
          <div
            ref={fireEl}
            className="g64-fire"
            data-down={fireDown ? "true" : "false"}
            data-locked={locked ? "true" : "false"}
            role="button"
            aria-label="Fire"
            onPointerDown={(e) => startLayoutDrag("fire", e)}
          >
            <LayoutHandle show={layoutEdit} />
            FIRE
          </div>
        </div>
      </div>
      {jumpEnabled ? (
        <div className="g64-jump-wrap" style={pos("jump")} onPointerDown={(e) => startLayoutDrag("jump", e)}>
          <LayoutHandle show={layoutEdit} />
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
        </div>
      ) : null}
    </div>
  );
}
