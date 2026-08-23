/**
 * Emulator host helpers — single virtual pad, joyport mapping.
 * Authentic mode: player 0 only, FIRE = assigned port button only.
 * Reconstructed from Grok64 build session.
 */

export type JoyPort = 1 | 2;

/** Bit layout matches VICE/EmulatorJS joy vector (up down left right fire). */
export interface JoyVector {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
}

const idle: JoyVector = {
  up: false,
  down: false,
  left: false,
  right: false,
  fire: false,
};

let current: JoyVector = { ...idle };
let joyPort: JoyPort = 2;

/** Optional EmulatorJS GameManager ref set by the app. */
let gameManager: {
  simulateInput?: (player: number, index: number, value: number) => void;
  _simulate_input?: (player: number, index: number, value: number) => void;
} | null = null;

export function setGameManager(gm: typeof gameManager) {
  gameManager = gm;
}

export function setJoyPort(port: JoyPort) {
  joyPort = port;
}

export function getJoyPort(): JoyPort {
  return joyPort;
}

/**
 * Push stick + fire state for player 0 only.
 * Indices follow common libretro/EmulatorJS pad mapping:
 * 4=up 5=down 6=left 7=right 8=fire (adjust if host differs).
 */
export function setJoyVector(v: Partial<JoyVector>) {
  current = { ...current, ...v };
  const send = (index: number, pressed: boolean) => {
    const fn = gameManager?.simulateInput || gameManager?._simulate_input;
    if (!fn) return;
    try {
      fn.call(gameManager, 0, index, pressed ? 1 : 0);
    } catch {
      /* core not ready */
    }
  };
  send(4, current.up);
  send(5, current.down);
  send(6, current.left);
  send(7, current.right);
  send(8, current.fire);
}

export function joyInput(partial: Partial<JoyVector>) {
  setJoyVector(partial);
}

export function clearJoy() {
  current = { ...idle };
  setJoyVector(idle);
}

/** FIRE button for the assigned port only — no SPACE, no dual-port. */
export function pressFire(down: boolean) {
  setJoyVector({ fire: down });
}

export function getJoyVector(): JoyVector {
  return { ...current };
}

/**
 * Apply VICE joyport options when the core exposes them.
 * Port 1 vs 2 mapping is host-specific; store keeps the logical choice.
 */
export function plugJoysticks(port: JoyPort) {
  setJoyPort(port);
  // Core option keys vary by EmulatorJS build; app layer also sets viceJoyOptions.
}
