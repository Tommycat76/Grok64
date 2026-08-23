/**
 * Virtual stick + FIRE. Drag = analog vector; tap zones = digital 8-way (requested).
 * Higher-contrast stick graphics for visibility on black UI.
 * Reconstructed from Grok64 build session + pending UX requests.
 */

import { useCallback, useRef, useState } from "react";
import { joyInput, pressFire } from "../lib/emu/host";

const DEAD = 0.18;
const TAP_PX = 12;

function dirFromDelta(dx: number, dy: number) {
  const mag = Math.hypot(dx, dy) || 1;
  const nx = dx / mag;
  const ny = dy / mag;
  return {
    up: ny < -DEAD,
    down: ny > DEAD,
    left: nx < -DEAD,
    right: nx > DEAD,
  };
}

export function TouchControls({ disabled }: { disabled?: boolean }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = baseRef.current?.getBoundingClientRect();
      if (!rect) return;
      origin.current = { x: e.clientX, y: e.clientY };
      moved.current = false;
      // Tap zone: direction from center of base to contact point
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      if (Math.hypot(dx, dy) > rect.width * 0.15) {
        joyInput(dirFromDelta(dx, dy));
      }
    },
    [disabled]
  );

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || !origin.current) return;
      const dx = e.clientX - origin.current.x;
      const dy = e.clientY - origin.current.y;
      if (Math.hypot(dx, dy) > TAP_PX) moved.current = true;
      const max = 36;
      const cl = (v: number) => Math.max(-max, Math.min(max, v));
      setKnob({ x: cl(dx), y: cl(dy) });
      joyInput(dirFromDelta(dx, dy));
    },
    [disabled]
  );

  const onUp = useCallback(() => {
    origin.current = null;
    setKnob({ x: 0, y: 0 });
    joyInput({ up: false, down: false, left: false, right: false });
  }, []);

  return (
    <div className="g64-controls" data-disabled={disabled ? "true" : "false"}>
      <div
        ref={baseRef}
        className="g64-stick"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div
          className="g64-stick-knob"
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>
      <button
        type="button"
        className="g64-fire"
        disabled={disabled}
        onPointerDown={(e) => {
          e.preventDefault();
          pressFire(true);
        }}
        onPointerUp={() => pressFire(false)}
        onPointerCancel={() => pressFire(false)}
        onPointerLeave={() => pressFire(false)}
      >
        FIRE
      </button>
    </div>
  );
}
