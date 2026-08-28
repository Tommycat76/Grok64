import { useCallback, useState } from "react";
import { C64_ROWS, dispatchC64Key, type C64Key } from "@/lib/emu/keys";

const BY_ID = new Map<string, C64Key>();
for (const row of C64_ROWS) {
  for (const k of row) BY_ID.set(k.id, k);
}

function key(id: string): C64Key {
  return BY_ID.get(id)!;
}

const ALPHA: string[][] = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

const SYM: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["arr", "plus", "minus", "pound", "at", "star", "colon", "semi", "eq", "uparr"],
  ["f1", "f3", "f5", "f7", "clr", "restore"],
];

function KeyBtn({
  k,
  className,
  held,
  glyph,
  onDown,
  onUp,
}: {
  k: C64Key;
  className?: string;
  held: boolean;
  glyph: string;
  onDown: (k: C64Key) => void;
  onUp: (k: C64Key) => void;
}) {
  return (
    <button
      type="button"
      className={className ? `g64-key ${className}` : "g64-key"}
      data-mod={held ? "true" : "false"}
      aria-label={k.label}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        onDown(k);
      }}
      onPointerUp={() => onUp(k)}
      onPointerCancel={() => onUp(k)}
    >
      {glyph}
    </button>
  );
}

export function C64Keyboard() {
  const [shift, setShift] = useState(false);
  const [cbm, setCbm] = useState(false);
  const [ctrl, setCtrl] = useState(false);
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
      dispatchC64Key(k.code, k.key, false);
    },
    [shift, cbm, ctrl],
  );

  const down = useCallback((k: C64Key) => {
    setDownId(k.id);
    if (k.modifier) return;
    dispatchC64Key(k.code, k.key, true);
  }, []);

  const held = (k: C64Key) =>
    (k.modifier === "shift" && shift) ||
    (k.modifier === "cbm" && cbm) ||
    (k.modifier === "ctrl" && ctrl) ||
    downId === k.id;

  const glyph = (k: C64Key) => {
    if (cbm && k.gfx) return k.gfx;
    if (shift && k.shift) return k.shift;
    return k.label;
  };

  const rows = sym ? SYM : ALPHA;
  const shiftKey = key("lshift");
  const cbmKey = key("cbm");
  const ctrlKey = key("ctrl");
  const runKey = key("run");
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
      onPointerDown={() => {
        window.dispatchEvent(new Event("g64-unlock"));
      }}
    >
      {rows.map((row, i) => (
        <div className="g64-kb-row" key={i} data-pad={row.length < 10 ? "true" : undefined}>
          {i === 2 && !sym ? (
            <KeyBtn k={shiftKey} className="mod" held={held(shiftKey)} glyph="SHIFT" onDown={down} onUp={up} />
          ) : null}
          {row.map((id) => {
            const k = key(id);
            return (
              <KeyBtn
                key={k.id}
                k={k}
                held={held(k)}
                glyph={glyph(k)}
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

      {sym ? (
        <div className="g64-kb-row g64-kb-cursors">
          <KeyBtn k={leftKey} className="mod" held={held(leftKey)} glyph="←" onDown={down} onUp={up} />
          <KeyBtn k={upKey} className="mod" held={held(upKey)} glyph="↑" onDown={down} onUp={up} />
          <KeyBtn k={downKey} className="mod" held={held(downKey)} glyph="↓" onDown={down} onUp={up} />
          <KeyBtn k={rightKey} className="mod" held={held(rightKey)} glyph="→" onDown={down} onUp={up} />
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
          {sym ? "ABC" : "123"}
        </button>
        <KeyBtn k={cbmKey} className="mod" held={held(cbmKey)} glyph="C=" onDown={down} onUp={up} />
        <KeyBtn k={ctrlKey} className="mod" held={held(ctrlKey)} glyph="CTRL" onDown={down} onUp={up} />
        <KeyBtn k={spaceKey} className="space" held={held(spaceKey)} glyph="SPACE" onDown={down} onUp={up} />
        <KeyBtn k={runKey} className="mod" held={held(runKey)} glyph="RUN" onDown={down} onUp={up} />
        <KeyBtn k={retKey} className="wide" held={held(retKey)} glyph="RETURN" onDown={down} onUp={up} />
      </div>
    </div>
  );
}
