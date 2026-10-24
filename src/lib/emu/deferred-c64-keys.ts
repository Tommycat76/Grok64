import { grok64RetroKeyboardFromDom } from "./grok64-keyboard";
import type { EjsInstance } from "./host";

type DeferredStroke = {
  code: string;
  key: string;
  down: boolean;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
};

const queue: DeferredStroke[] = [];
let deferActive = false;

export function setC64KeyboardDefer(active: boolean) {
  deferActive = active;
  if (!active) return;
}

export function c64KeyboardShouldDefer(): boolean {
  return deferActive;
}

export function enqueueC64KeyboardStroke(
  code: string,
  key: string,
  down: boolean,
  mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {},
) {
  queue.push({
    code,
    key,
    down,
    shift: !!mods.shift,
    ctrl: !!mods.ctrl,
    alt: !!mods.alt,
  });
}

export function flushDeferredC64Keyboard(emu: EjsInstance | null) {
  deferActive = false;
  if (!emu || !queue.length) {
    queue.length = 0;
    return;
  }
  const pending = queue.splice(0, queue.length);
  for (const s of pending) {
    grok64RetroKeyboardFromDom(emu, s.code, s.key, s.down, {
      shift: s.shift,
      ctrl: s.ctrl,
      alt: s.alt,
    });
  }
}

export function clearDeferredC64Keyboard() {
  queue.length = 0;
  deferActive = false;
}
