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

function KeyBtn({
  k,
  className,
  held,
  glyph,
  glyphPetscii,
  onDown,
  onUp,
}: {
  k: C64Key;
  className?: string;
  held: boolean;
  glyph: string;
  glyphPetscii?: number;
  onDown: (k: C64Key) => void;
  onUp: (k: C64Key) => void;
}) {
  const downAt = useRef(0);
  const petscii = hasPetsciiLayer(k);
  return (
    <button
      type="button"
      className={className ? `g64-key ${className}` : "g64-key"}
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
      {petscii ? (
        <span className="g64-key-petscii" aria-hidden="true">
          <em data-side="cbm">{k.cbmPetscii != null ? <PetsciiGlyph petscii={k.cbmPetscii} size={14} /> : null}</em>
          <em data-side="sh">
            {k.shiftPetscii != null ? <PetsciiGlyph petscii={k.shiftPetscii} size={14} /> : (k.shift ?? "")}
          </em>
        </span>
      ) : null}
      {glyphPetscii != null ? (
        <span className="g64-key-main g64-key-main-pet">
          <PetsciiGlyph petscii={glyphPetscii} size={18} />
        </span>
      ) : (
        <span className="g64-key-main">{glyph}</span>
      )}
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

  const face = (k: C64Key): { glyph: string; glyphPetscii?: number } => {
    if (cbm && k.cbmPetscii != null) return { glyph: k.label, glyphPetscii: k.cbmPetscii };
    if (shift && k.shiftPetscii != null) return { glyph: k.shift ?? k.label, glyphPetscii: k.shiftPetscii };
    if (shift && k.shift) return { glyph: k.shift };
    return { glyph: k.label };
  };

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
      onPointerDown={() => {
        window.dispatchEvent(new Event("g64-unlock"));
      }}
    >
      {rows.map((row, i) => (
        <div className="g64-kb-row" key={i} data-pad={row.length < 10 && i < 3 ? "true" : undefined}>
          {i === 2 && !sym ? (
            <KeyBtn k={shiftKey} className="mod" held={held(shiftKey)} glyph="SHIFT" onDown={down} onUp={up} />
          ) : null}
          {row.map((id) => {
            const k = key(id);
            const { glyph, glyphPetscii } = face(k);
            return (
              <KeyBtn
                key={k.id}
                k={k}
                held={held(k)}
                glyph={glyph}
                glyphPetscii={glyphPetscii}
                onDown={down}
                onUp={up}
              />
            );
          })}
          {i === 2 && !sym ? (
            <KeyBtn k={delKey} className="mod" held={held(delKey)} glyph="DEL" onDown={down} onUp={up} />
          ) : null}
        </div>
      ))}

      <div className="g64-kb-row g64-kb-cursors">
        <KeyBtn k={leftKey} className="mod" held={held(leftKey)} glyph="←" onDown={down} onUp={up} />
        <KeyBtn k={upKey} className="mod" held={held(upKey)} glyph="↑" onDown={down} onUp={up} />
        <KeyBtn k={downKey} className="mod" held={held(downKey)} glyph="↓" onDown={down} onUp={up} />
        <KeyBtn k={rightKey} className="mod" held={held(rightKey)} glyph="→" onDown={down} onUp={up} />
      </div>

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
          {sym ? "ABC" : "123"}
        </button>
        <KeyBtn k={cbmKey} className="mod" held={held(cbmKey)} glyph="C=" onDown={down} onUp={up} />
        {!sym ? (
          <KeyBtn k={ctrlKey} className="mod" held={held(ctrlKey)} glyph="CTRL" onDown={down} onUp={up} />
        ) : (
          <KeyBtn k={lockKey} className="mod" held={held(lockKey)} glyph="LOCK" onDown={down} onUp={up} />
        )}
        <KeyBtn k={spaceKey} className="space" held={held(spaceKey)} glyph="SPACE" onDown={down} onUp={up} />
        <KeyBtn k={runKey} className="mod" held={held(runKey)} glyph="RUN" onDown={down} onUp={up} />
        <KeyBtn k={retKey} className="wide" held={held(retKey)} glyph="RETURN" onDown={down} onUp={up} />
      </div>
    </div>
  );
}
