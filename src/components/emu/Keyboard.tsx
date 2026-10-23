import { useCallback, useRef, useState } from "react";
import { PetsciiGlyph } from "@/components/emu/PetsciiGlyph";
import {
  C64_ROWS,
  TOUCH_ABC,
  TOUCH_SYM,
  dispatchC64Key,
  hasPetsciiLayer,
  type C64Key,
} from "@/lib/emu/keys";

const BY_ID = new Map<string, C64Key>();
for (const row of C64_ROWS) {
  for (const k of row) BY_ID.set(k.id, k);
}

function key(id: string): C64Key {
  return BY_ID.get(id)!;
}

/** Shifted punctuation on the keycap face (not PETSCII graphics). */
function shiftSecondaryLabel(k: C64Key): string | null {
  if (!k.shift || k.shiftPetscii != null) return null;
  if (k.shift.length > 3) return null;
  return k.shift;
}

function KeyBtn({
  k,
  className,
  held,
  shiftLayer,
  cbmLayer,
  onDown,
  onUp,
}: {
  k: C64Key;
  className?: string;
  held: boolean;
  shiftLayer: boolean;
  cbmLayer: boolean;
  onDown: (k: C64Key) => void;
  onUp: (k: C64Key) => void;
}) {
  const downAt = useRef(0);
  const petscii = hasPetsciiLayer(k);
  const secondary = shiftSecondaryLabel(k);
  const cornerPet = 10;
  const primary = k.label;

  return (
    <button
      type="button"
      className={className ? `g64-key ${className}` : "g64-key"}
      data-key-id={k.id}
      data-mod={held ? "true" : "false"}
      data-petscii={petscii ? "true" : "false"}
      aria-label={k.label}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        downAt.current = Date.now();
        onDown(k);
      }}
      onPointerUp={() => {
        const delay = Math.max(0, 70 - (Date.now() - downAt.current));
        window.setTimeout(() => onUp(k), delay);
      }}
      onPointerCancel={() => onUp(k)}
    >
      <span className="g64-key-cap">
        {secondary ? (
          <span className="g64-key-secondary" aria-hidden="true">{secondary}</span>
        ) : null}
        {k.shiftPetscii != null ? (
          <span
            className="g64-key-corner g64-key-corner--tr"
            data-active={shiftLayer ? "true" : "false"}
            aria-hidden="true"
          >
            <PetsciiGlyph petscii={k.shiftPetscii} size={cornerPet} />
          </span>
        ) : null}
        {k.cbmPetscii != null ? (
          <span
            className="g64-key-corner g64-key-corner--bl"
            data-active={cbmLayer ? "true" : "false"}
            aria-hidden="true"
          >
            <PetsciiGlyph petscii={k.cbmPetscii} size={cornerPet} />
          </span>
        ) : null}
        <span className="g64-key-primary">{primary}</span>
      </span>
    </button>
  );
}

export function C64Keyboard() {
  const [shift, setShift] = useState(false);
  const [cbm, setCbm] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const [lock, setLock] = useState(false);
  const [sym, setSym] = useState(false);
  const [downId, setDownId] = useState<string | null>(null);

  const up = useCallback(
    (k: C64Key) => {
      setDownId(null);
      if (k.modifier === "shift") {
        const next = !shift;
        setShift(next);
        dispatchC64Key(k.code, k.key, next);
        return;
      }
      if (k.modifier === "cbm") {
        const next = !cbm;
        setCbm(next);
        dispatchC64Key(k.code, k.key, next);
        return;
      }
      if (k.modifier === "ctrl") {
        const next = !ctrl;
        setCtrl(next);
        dispatchC64Key(k.code, k.key, next);
        return;
      }
      if (k.modifier === "lock") {
        const next = !lock;
        setLock(next);
        dispatchC64Key(k.code, k.key, next);
        return;
      }
      dispatchC64Key(k.code, k.key, false, { shift: shift || !!k.forceShift });
      if (k.forceShift && !shift) dispatchC64Key("ShiftLeft", "Shift", false);
    },
    [shift, cbm, ctrl, lock],
  );

  const down = useCallback(
    (k: C64Key) => {
      setDownId(k.id);
      if (k.modifier) return;
      if (k.forceShift && !shift) dispatchC64Key("ShiftLeft", "Shift", true);
      dispatchC64Key(k.code, k.key, true, { shift: shift || !!k.forceShift });
      if (k.code === "F5" || k.id === "f5") {
        try {
          window.dispatchEvent(new Event("g64-fit"));
        } catch {
          /* ignore */
        }
      }
    },
    [shift],
  );

  const held = (k: C64Key) =>
    (k.modifier === "shift" && shift) ||
    (k.modifier === "cbm" && cbm) ||
    (k.modifier === "ctrl" && ctrl) ||
    (k.modifier === "lock" && lock) ||
    downId === k.id;

  const rows = sym ? TOUCH_SYM : TOUCH_ABC;
  const shiftKey = key("lshift");
  const cbmKey = key("cbm");
  const ctrlKey = key("ctrl");
  const runKey = key("run");
  const lockKey = key("lock");
  const retKey = key("return");
  const delKey = key("del");
  const spaceKey = key("space");
  const upKey: C64Key = { id: "up", label: "↑", code: "ArrowUp", key: "ArrowUp" };
  const downKey: C64Key = { id: "down", label: "↓", code: "ArrowDown", key: "ArrowDown" };
  const leftKey: C64Key = { id: "left", label: "←", code: "ArrowLeft", key: "ArrowLeft" };
  const rightKey: C64Key = { id: "right", label: "→", code: "ArrowRight", key: "ArrowRight" };

  return (
    <div
      className="g64-kb"
      aria-label="Commodore 64 keyboard"
      data-layer={sym ? "sym" : "abc"}
      data-shift={shift ? "true" : "false"}
      data-cbm={cbm ? "true" : "false"}
      onPointerDown={() => {
        window.dispatchEvent(new Event("g64-unlock"));
      }}
    >
      {rows.map((row, i) => (
        <div className="g64-kb-row" key={i} data-pad={row.length < 10 && i < 3 ? "true" : undefined}>
          {i === 2 && !sym ? (
            <KeyBtn
              k={shiftKey}
              className="mod"
              held={held(shiftKey)}
              shiftLayer={shift}
              cbmLayer={cbm}
              onDown={down}
              onUp={up}
            />
          ) : null}
          {row.map((id) => {
            const k = key(id);
            return (
              <KeyBtn
                key={k.id}
                k={k}
                held={held(k)}
                shiftLayer={shift}
                cbmLayer={cbm}
                onDown={down}
                onUp={up}
              />
            );
          })}
          {i === 2 && !sym ? (
            <KeyBtn k={delKey} className="mod" held={held(delKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
          ) : null}
        </div>
      ))}

      <div className="g64-kb-row g64-kb-cursors">
        <KeyBtn k={leftKey} className="mod" held={held(leftKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
        <KeyBtn k={upKey} className="mod" held={held(upKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
        <KeyBtn k={downKey} className="mod" held={held(downKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
        <KeyBtn k={rightKey} className="mod" held={held(rightKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
      </div>

      {!sym ? (
        <div className="g64-kb-row g64-kb-fn">
          {["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"].map((id) => {
            const k = key(id);
            return (
              <KeyBtn
                key={k.id}
                k={k}
                className="fn"
                held={held(k)}
                shiftLayer={shift}
                cbmLayer={cbm}
                onDown={down}
                onUp={up}
              />
            );
          })}
        </div>
      ) : null}

      <div className="g64-kb-row g64-kb-bar">
        <button
          type="button"
          className="g64-key mod"
          data-mod={sym ? "true" : "false"}
          onPointerDown={(e) => {
            e.preventDefault();
            setSym((v) => !v);
          }}
        >
          <span className="g64-key-cap">
            <span className="g64-key-primary">{sym ? "ABC" : "123"}</span>
          </span>
        </button>
        <KeyBtn k={cbmKey} className="mod" held={held(cbmKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
        {!sym ? (
          <KeyBtn k={ctrlKey} className="mod" held={held(ctrlKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
        ) : (
          <KeyBtn k={lockKey} className="mod" held={held(lockKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
        )}
        <KeyBtn k={spaceKey} className="space" held={held(spaceKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
        <KeyBtn k={runKey} className="mod" held={held(runKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
        <KeyBtn k={retKey} className="wide" held={held(retKey)} shiftLayer={shift} cbmLayer={cbm} onDown={down} onUp={up} />
      </div>
    </div>
  );
}
