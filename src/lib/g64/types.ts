export type JoyPort = 1 | 2;

export const PAD = {
  B: 0,
  Y: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  A: 8,
  X: 9,
  L: 10,
  R: 11,
} as const;

declare global {
  interface Window {
    EmulatorJS?: new (sel: string, cfg: unknown) => EjsInstance;
    EJS_GameManager?: { prototype: { getRetroArchCfg?: () => string; __g64pad?: boolean } };
    nipplejs?: unknown;
    __ejs?: EjsInstance;
    __g64?: unknown;
    __g64log?: string[];
    AudioContext: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  }
}

export interface EjsInstance {
  gameManager?: {
    simulateInput?: (player: number, index: number, value: number) => void;
    functions?: {
      simulateInput?: (player: number, index: number, value: number) => void;
      restart?: () => void;
    };
    setVariable?: (k: string, v: string) => void;
    setKeyboardEnabled?: (v: boolean) => void;
    toggleMainLoop?: (v: number) => void;
    toggleFastForward?: (v: boolean) => void;
    restart?: () => void;
    getCoreOptions?: () => unknown;
    screenshot?: () => Promise<Uint8Array>;
    getState?: () => Promise<Uint8Array>;
    FS?: EjsFs;
    __g64guard?: boolean;
  };
  Module?: {
    canvas?: HTMLCanvasElement;
    AL?: { currentCtx?: { sources?: { gain?: { context?: AudioContext } }[] } };
    _simulate_input?: (p: number, i: number, v: number) => void;
    cwrap?: unknown;
    pauseMainLoop?: () => void;
    abort?: () => void;
    FS?: EjsFs;
    __g64abort?: boolean;
  };
  fileName?: string;
  paused?: boolean;
  gamepadSelection?: string[];
  controls?: Record<number, Record<number, { value?: string; value2?: string }>>;
  elements?: { parent?: HTMLElement };
  on: (ev: string, fn: (...args: unknown[]) => void) => void;
}

export interface EjsFs {
  readdir?: (p: string) => string[];
  readFile?: (p: string, opts?: { encoding?: string }) => Uint8Array | string;
  writeFile?: (p: string, data: Uint8Array) => void;
  unlink?: (p: string) => void;
  stat?: (p: string) => { mode: number };
  isDir?: (mode: number) => boolean;
  syncfs?: (populate: boolean, cb: () => void) => void;
}
