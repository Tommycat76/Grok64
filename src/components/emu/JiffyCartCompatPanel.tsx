import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  JIFFY_FASTLOAD_CART_MATRIX,
  jiffyCartCompat,
  type FastLoadCartKind,
} from "@/lib/emu/jiffy-cart-compat";
import { useEmu } from "@/lib/emu/store";

function toggleJiffy(
  jiffyOn: boolean,
  cart: FastLoadCartKind | null,
  setJiffyDos: (on: boolean) => void,
) {
  const next = !jiffyOn;
  if (next && cart) {
    const compat = jiffyCartCompat(cart, true);
    if (compat.suppressJiffy) {
      toast.error(compat.summary);
      return;
    }
    if (compat.warnIfJiffyOn) {
      toast.message(compat.title, { description: compat.summary, duration: 10_000 });
    }
  }
  setJiffyDos(next);
}

export function JiffyCartCompatBanner() {
  const jiffyDos = useEmu((s) => s.jiffyDos);
  const cart = useEmu((s) => s.fastLoadCart);
  if (!cart || !jiffyDos) return null;
  const compat = jiffyCartCompat(cart, true);
  if (compat.level === "compatible") return null;
  const tone =
    compat.level === "incompatible"
      ? "border-amber-500/40 bg-amber-500/10"
      : compat.level === "caution"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-fg-muted/30 bg-fg-muted/5";
  return (
    <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${tone}`}>
      <strong className="block text-sm">{compat.title}</strong>
      <p className="mt-1 text-fg-muted">{compat.summary}</p>
      <p className="mt-1 text-fg-subtle">{compat.realHardware}</p>
    </div>
  );
}

export function JiffyDosToggleRow() {
  const s = useEmu();
  const cart = useEmu((st) => st.fastLoadCart);
  const blocked = cart ? jiffyCartCompat(cart, true).suppressJiffy : false;
  const [jiffyUi, setJiffyUi] = useState(s.jiffyDos);
  const [jiffyLive, setJiffyLive] = useState(false);
  useEffect(() => {
    setJiffyUi(s.jiffyDos);
  }, [s.jiffyDos]);
  useEffect(() => {
    const poll = () => {
      const live = (window as unknown as { __g64?: { jiffyLive?: () => boolean } }).__g64?.jiffyLive?.();
      setJiffyLive(!!live);
    };
    poll();
    const id = window.setInterval(poll, 400);
    return () => window.clearInterval(id);
  }, []);
  const switchOn = jiffyUi;
  const liveHint =
    jiffyLive !== jiffyUi
      ? jiffyUi
        ? " · applying ROMs…"
        : " · stock KERNAL until power cycle"
      : jiffyLive && jiffyUi
        ? " · live"
        : "";
  return (
    <>
      <JiffyCartCompatBanner />
      <div className="g64-row">
        <span>
          JiffyDOS (needs C64 + 1541 ROMs)
          <span className="ml-1 text-xs text-fg-subtle">
            {jiffyUi ? "on" : "off"}
            {liveHint}
          </span>
        </span>
        <button
          type="button"
          className="g64-switch"
          data-on={switchOn ? "true" : "false"}
          onClick={() => {
            toggleJiffy(jiffyUi, cart, (on) => {
              setJiffyUi(on);
              s.setJiffyDos(on);
            });
          }}
          role="switch"
          aria-checked={switchOn}
          aria-disabled={blocked && !s.jiffyDos}
          title={blocked ? "Incompatible with the loaded fast-load cart — use stock KERNAL" : undefined}
        >
          <i />
        </button>
      </div>
      <p className="mb-3 text-xs text-fg-subtle">
        Applies on next load. Libretro looks for JiffyDOS_C64.bin and JiffyDOS_1541-II.bin (versioned uploads are aliased).
        {blocked ? " Jiffy stays off while Super Snapshot is loaded." : null}
      </p>
    </>
  );
}

export function JiffyFastloadCartMatrix() {
  return (
    <details className="mb-3 text-xs text-fg-subtle">
      <summary className="cursor-pointer text-sm text-fg-muted">JiffyDOS vs fast-load carts (real hardware)</summary>
      <ul className="mt-2 space-y-3 pl-1">
        {JIFFY_FASTLOAD_CART_MATRIX.map((row) => (
          <li key={row.id}>
            <strong className="text-fg-muted">{row.label}</strong>
            <div>
              <span className="text-fg-subtle">Stock KERNAL: </span>
              {row.stockKernal}
            </div>
            <div>
              <span className="text-fg-subtle">With JiffyDOS: </span>
              {row.jiffyKernal}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
