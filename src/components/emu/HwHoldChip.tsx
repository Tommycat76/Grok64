import { useRef, useState } from "react";
import { HW_LONG_MS } from "@/lib/emu/hw-buttons";

/**
 * Momentary hardware button: short tap vs hold.
 * Fires on release so a long press is never also a short press.
 * Pointer-first for iPhone (no right-click / context menu).
 */
export function HwHoldChip({
  id,
  label,
  title,
  onShort,
  onLong,
  longMs = HW_LONG_MS,
  on = false,
  disabled = false,
}: {
  id: string;
  label: string;
  title: string;
  onShort: () => void;
  onLong?: () => void;
  longMs?: number;
  on?: boolean;
  disabled?: boolean;
}) {
  const held = useRef(false);
  const armedLong = useRef(false);
  const t0 = useRef(0);
  const timer = useRef(0);
  const [phase, setPhase] = useState<"idle" | "held" | "long">("idle");

  const clearTimer = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = 0;
  };

  const finish = () => {
    if (!held.current) return;
    held.current = false;
    clearTimer();
    const long = armedLong.current;
    armedLong.current = false;
    setPhase("idle");
    if (disabled) return;
    if (long && onLong) onLong();
    else onShort();
  };

  return (
    <button
      type="button"
      className="g64-chip g64-chip-gate g64-chip-pin g64-hw-btn"
      data-hw={id}
      data-on={on ? "true" : "false"}
      data-held={phase !== "idle" ? "true" : "false"}
      data-long={phase === "long" ? "true" : "false"}
      title={title}
      aria-label={title}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* capture optional */
        }
        held.current = true;
        armedLong.current = false;
        t0.current = performance.now();
        setPhase("held");
        if (onLong) {
          timer.current = window.setTimeout(() => {
            if (!held.current) return;
            armedLong.current = true;
            setPhase("long");
          }, longMs);
        }
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!disabled) onShort();
        }
      }}
    >
      {label}
    </button>
  );
}
