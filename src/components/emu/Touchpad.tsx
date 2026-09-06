import { useEffect, useRef } from "react";

interface Props {
  onDelta: (dx: number, dy: number) => void;
  onEnd?: () => void;
  locked?: boolean;
  layoutEdit?: boolean;
  onDrag?: (leftPct: number, bottomPct: number) => void;
}

function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* iOS WebView can reject capture */
  }
}

export function Touchpad({ onDelta, onEnd, locked, layoutEdit, onDrag }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const onDeltaRef = useRef(onDelta);
  onDeltaRef.current = onDelta;
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const pad = el.current;
    if (!pad) return;
    const active = new Map<number, { x: number; y: number }>();

    const move = (id: number, x: number, y: number) => {
      const prev = active.get(id);
      if (!prev) return;
      const dx = x - prev.x;
      const dy = y - prev.y;
      active.set(id, { x, y });
      if (lockedRef.current || layoutEdit) return;
      const r = pad.getBoundingClientRect();
      const scale = Math.max(r.width, r.height, 120);
      onDeltaRef.current(dx / scale, dy / scale);
    };

    const down = (id: number, x: number, y: number, target: EventTarget | null) => {
      if (layoutEdit) return;
      if (lockedRef.current) return;
      active.set(id, { x, y });
      last.current = { x, y };
      if (target instanceof Element) capture(pad, id);
    };

    const up = (id: number) => {
      active.delete(id);
      if (active.size === 0) {
        last.current = null;
        onEndRef.current?.();
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        down(t.identifier, t.clientX, t.clientY, e.target);
      }
      if (active.size) e.preventDefault();
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
      if (layoutEdit) return;
      e.preventDefault();
      down(e.pointerId, e.clientX, e.clientY, e.target);
      capture(pad, e.pointerId);
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
    pad.addEventListener("touchstart", onTouchStart, opts);
    pad.addEventListener("touchmove", onTouchMove, opts);
    pad.addEventListener("touchend", onTouchEnd, opts);
    pad.addEventListener("touchcancel", onTouchEnd, opts);
    pad.addEventListener("pointerdown", onPointerDown, opts);
    pad.addEventListener("pointermove", onPointerMove, opts);
    pad.addEventListener("pointerup", onPointerUp, opts);
    pad.addEventListener("pointercancel", onPointerUp, opts);
    return () => {
      active.clear();
      pad.removeEventListener("touchstart", onTouchStart);
      pad.removeEventListener("touchmove", onTouchMove);
      pad.removeEventListener("touchend", onTouchEnd);
      pad.removeEventListener("touchcancel", onTouchEnd);
      pad.removeEventListener("pointerdown", onPointerDown);
      pad.removeEventListener("pointermove", onPointerMove);
      pad.removeEventListener("pointerup", onPointerUp);
      pad.removeEventListener("pointercancel", onPointerUp);
    };
  }, [layoutEdit]);

  return (
    <div
      ref={el}
      className="g64-touchpad"
      data-edit={layoutEdit ? "true" : "false"}
      aria-label="Trackpad. Drag to move the 1351 mouse."
      role="application"
      onPointerDown={(e) => {
        if (!layoutEdit || !onDrag) return;
        e.preventDefault();
        const host = el.current?.offsetParent as HTMLElement | null;
        if (!host) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = host.getBoundingClientRect();
        const base = el.current!.getBoundingClientRect();
        const baseLeft = ((base.left + base.width / 2 - rect.left) / rect.width) * 100;
        const baseBottom = ((rect.bottom - base.bottom) / rect.height) * 100;
        const move = (ev: PointerEvent) => {
          const left = baseLeft + ((ev.clientX - startX) / rect.width) * 100;
          const bottom = baseBottom - ((ev.clientY - startY) / rect.height) * 100;
          onDrag(left, bottom);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    >
      <span className="g64-touchpad-grid" aria-hidden="true" />
      <span className="g64-touchpad-label">TRACKPAD</span>
    </div>
  );
}
