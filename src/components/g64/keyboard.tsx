import { useCallback, useState } from "react";

export interface KeyDef {
  id: string;
  label: string;
  code: string;
  key: string;
  shift?: string;
  gfx?: string;
  width?: number;
  modifier?: "shift" | "cbm" | "ctrl" | "lock";
}

const KEYS: KeyDef[][] = [
  [
    { id: "arr", label: "←", code: "Backquote", key: "`" },
    { id: "1", label: "1", shift: "!", gfx: "┌", code: "Digit1", key: "1" },
    { id: "2", label: "2", shift: '"', gfx: "—", code: "Digit2", key: "2" },
    { id: "3", label: "3", shift: "#", gfx: "—", code: "Digit3", key: "3" },
    { id: "4", label: "4", shift: "$", gfx: "—", code: "Digit4", key: "4" },
    { id: "5", label: "5", shift: "%", gfx: "—", code: "Digit5", key: "5" },
    { id: "6", label: "6", shift: "&", gfx: "—", code: "Digit6", key: "6" },
    { id: "7", label: "7", shift: "'", gfx: "—", code: "Digit7", key: "7" },
    { id: "8", label: "8", shift: "(", gfx: "—", code: "Digit8", key: "8" },
    { id: "9", label: "9", shift: ")", gfx: "—", code: "Digit9", key: "9" },
    { id: "0", label: "0", shift: "0", code: "Digit0", key: "0" },
    { id: "plus", label: "+", code: "Minus", key: "+" },
    { id: "minus", label: "−", code: "Equal", key: "-" },
    { id: "pound", label: "£", code: "Backslash", key: "\\" },
    { id: "clr", label: "CLR", code: "Home", key: "Home", width: 1.3 },
    { id: "del", label: "DEL", code: "Backspace", key: "Backspace", width: 1.3 },
  ],
  [
    { id: "ctrl", label: "CTRL", code: "ControlLeft", key: "Control", width: 1.4, modifier: "ctrl" },
    { id: "q", label: "Q", gfx: "●", code: "KeyQ", key: "q" },
    { id: "w", label: "W", gfx: "○", code: "KeyW", key: "w" },
    { id: "e", label: "E", gfx: "━", code: "KeyE", key: "e" },
    { id: "r", label: "R", code: "KeyR", key: "r" },
    { id: "t", label: "T", code: "KeyT", key: "t" },
    { id: "y", label: "Y", code: "KeyY", key: "y" },
    { id: "u", label: "U", code: "KeyU", key: "u" },
    { id: "i", label: "I", code: "KeyI", key: "i" },
    { id: "o", label: "O", code: "KeyO", key: "o" },
    { id: "p", label: "P", code: "KeyP", key: "p" },
    { id: "at", label: "@", code: "BracketLeft", key: "@" },
    { id: "star", label: "*", code: "BracketRight", key: "*" },
    { id: "uparr", label: "↑", code: "Delete", key: "Delete" },
    { id: "restore", label: "RST", code: "PageUp", key: "PageUp", width: 1.3 },
  ],
  [
    { id: "run", label: "RUN", code: "Escape", key: "Escape", width: 1.5 },
    { id: "lock", label: "A LOCK", code: "CapsLock", key: "CapsLock", width: 1.3, modifier: "lock" },
    { id: "a", label: "A", gfx: "♠", code: "KeyA", key: "a" },
    { id: "s", label: "S", gfx: "♥", code: "KeyS", key: "s" },
    { id: "d", label: "D", code: "KeyD", key: "d" },
    { id: "f", label: "F", code: "KeyF", key: "f" },
    { id: "g", label: "G", code: "KeyG", key: "g" },
    { id: "h", label: "H", code: "KeyH", key: "h" },
    { id: "j", label: "J", code: "KeyJ", key: "j" },
    { id: "k", label: "K", code: "KeyK", key: "k" },
    { id: "l", label: "L", code: "KeyL", key: "l" },
    { id: "colon", label: ":", shift: "[", code: "Semicolon", key: ":" },
    { id: "semi", label: ";", shift: "]", code: "Quote", key: ";" },
    { id: "eq", label: "=", code: "IntlBackslash", key: "=" },
    { id: "return", label: "RETURN", code: "Enter", key: "Enter", width: 1.8 },
  ],
  [
    { id: "cbm", label: "C=", code: "Tab", key: "Tab", width: 1.4, modifier: "cbm" },
    { id: "lshift", label: "SHIFT", code: "ShiftLeft", key: "Shift", width: 1.6, modifier: "shift" },
    { id: "z", label: "Z", gfx: "♦", code: "KeyZ", key: "z" },
    { id: "x", label: "X", gfx: "♣", code: "KeyX", key: "x" },
    { id: "c", label: "C", code: "KeyC", key: "c" },
    { id: "v", label: "V", code: "KeyV", key: "v" },
    { id: "b", label: "B", code: "KeyB", key: "b" },
    { id: "n", label: "N", code: "KeyN", key: "n" },
    { id: "m", label: "M", code: "KeyM", key: "m" },
    { id: "comma", label: ",", shift: "<", code: "Comma", key: "," },
    { id: "dot", label: ".", shift: ">", code: "Period", key: "." },
    { id: "slash", label: "/", shift: "?", code: "Slash", key: "/" },
    { id: "rshift", label: "SHIFT", code: "ShiftRight", key: "Shift", width: 1.6, modifier: "shift" },
    { id: "crsrud", label: "↕", code: "ArrowDown", key: "ArrowDown" },
    { id: "crsrlr", label: "↔", code: "ArrowRight", key: "ArrowRight" },
  ],
  [
    { id: "space", label: "SPACE", code: "Space", key: " ", width: 8 },
    { id: "f1", label: "F1", code: "F1", key: "F1", width: 1.2 },
    { id: "f3", label: "F3", code: "F3", key: "F3", width: 1.2 },
    { id: "f5", label: "F5", code: "F5", key: "F5", width: 1.2 },
    { id: "f7", label: "F7", code: "F7", key: "F7", width: 1.2 },
  ],
];

const BY_ID = new Map<string, KeyDef>();
for (const row of KEYS) for (const k of row) BY_ID.set(k.id, k);

const KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  CapsLock: 20,
  F1: 112,
  F3: 114,
  F5: 116,
  F7: 118,
};

function keyCodeOf(code: string, key: string) {
  if (KEY_CODES[code] != null) return KEY_CODES[code];
  return key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
}

export function dispatchC64Key(code: string, key: string, up: boolean, extra: { shift?: boolean } = {}) {
  const keyCode = keyCodeOf(code, key);
  const init: KeyboardEventInit = {
    key,
    code,
    keyCode,
    which: keyCode,
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey: !!extra.shift,
  } as KeyboardEventInit;
  const type = up ? "keyup" : "keydown";
  const ev = () => new KeyboardEvent(type, init);
  const target =
    document.querySelector<HTMLElement>("#grok64-player [tabindex]") ??
    document.getElementById("grok64-player");
  try {
    target?.focus?.();
  } catch {
    /* ignore */
  }
  target?.dispatchEvent(ev());
  (
    document.querySelector("#canvas") ?? document.querySelector("#grok64-player canvas")
  )?.dispatchEvent(ev());
  window.dispatchEvent(ev());
  document.dispatchEvent(ev());
}

const LETTERS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];
const SYMBOLS = [
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
  k: KeyDef;
  className?: string;
  held: boolean;
  glyph: string;
  onDown: (k: KeyDef) => void;
  onUp: (k: KeyDef) => void;
}) {
  return (
    <button
      type="button"
      className={className ? `g64-key ${className}` : "g64-key"}
      data-mod={held ? "true" : "false"}
      aria-label={k.label}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
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
  const [num, setNum] = useState(false);
  const [downId, setDownId] = useState<string | null>(null);

  const onUp = useCallback(
    (k: KeyDef) => {
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
      dispatchC64Key(k.code, k.key, true);
    },
    [shift, cbm, ctrl],
  );

  const onDown = useCallback((k: KeyDef) => {
    setDownId(k.id);
    if (!k.modifier) dispatchC64Key(k.code, k.key, false);
  }, []);

  const held = (k: KeyDef) =>
    (k.modifier === "shift" && shift) ||
    (k.modifier === "cbm" && cbm) ||
    (k.modifier === "ctrl" && ctrl) ||
    downId === k.id;
  const glyph = (k: KeyDef) => (cbm && k.gfx ? k.gfx : shift && k.shift ? k.shift : k.label);
  const rows = num ? SYMBOLS : LETTERS;
  const lshift = BY_ID.get("lshift")!;
  const cbmKey = BY_ID.get("cbm")!;
  const ctrlKey = BY_ID.get("ctrl")!;
  const run = BY_ID.get("run")!;
  const ret = BY_ID.get("return")!;
  const del = BY_ID.get("del")!;
  const space = BY_ID.get("space")!;
  const cursors: KeyDef[] = [
    { id: "up", label: "↑", code: "ArrowUp", key: "ArrowUp" },
    { id: "down", label: "↓", code: "ArrowDown", key: "ArrowDown" },
    { id: "left", label: "←", code: "ArrowLeft", key: "ArrowLeft" },
    { id: "right", label: "→", code: "ArrowRight", key: "ArrowRight" },
  ];

  return (
    <div
      className="g64-kb"
      aria-label="Commodore 64 keyboard"
      onPointerDown={() => window.dispatchEvent(new Event("g64-unlock"))}
    >
      {rows.map((row, i) => (
        <div key={i} className="g64-kb-row" data-pad={row.length < 10 ? "true" : undefined}>
          {i === 2 && !num ? (
            <KeyBtn k={lshift} className="mod" held={held(lshift)} glyph="SHIFT" onDown={onDown} onUp={onUp} />
          ) : null}
          {row.map((id) => {
            const k = BY_ID.get(id)!;
            return <KeyBtn key={k.id} k={k} held={held(k)} glyph={glyph(k)} onDown={onDown} onUp={onUp} />;
          })}
          {i === 2 && !num ? (
            <KeyBtn k={del} className="mod" held={held(del)} glyph="DEL" onDown={onDown} onUp={onUp} />
          ) : null}
        </div>
      ))}
      {num ? (
        <div className="g64-kb-row g64-kb-cursors">
          {cursors.map((k) => (
            <KeyBtn key={k.id} k={k} className="mod" held={held(k)} glyph={k.label} onDown={onDown} onUp={onUp} />
          ))}
        </div>
      ) : null}
      <div className="g64-kb-row g64-kb-bar">
        <button
          type="button"
          className="g64-key mod"
          data-mod={num ? "true" : "false"}
          onPointerDown={(e) => {
            e.preventDefault();
            setNum((v) => !v);
          }}
        >
          {num ? "ABC" : "123"}
        </button>
        <KeyBtn k={cbmKey} className="mod" held={held(cbmKey)} glyph="C=" onDown={onDown} onUp={onUp} />
        <KeyBtn k={ctrlKey} className="mod" held={held(ctrlKey)} glyph="CTRL" onDown={onDown} onUp={onUp} />
        <KeyBtn k={space} className="space" held={held(space)} glyph="SPACE" onDown={onDown} onUp={onUp} />
        <KeyBtn k={run} className="mod" held={held(run)} glyph="RUN" onDown={onDown} onUp={onUp} />
        <KeyBtn k={ret} className="wide" held={held(ret)} glyph="RETURN" onDown={onDown} onUp={onUp} />
      </div>
    </div>
  );
}
