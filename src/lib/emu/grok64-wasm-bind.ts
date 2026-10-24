/**
 * Bind Grok64 WASM exports once per Module using the original Emscripten cwrap/ccall.
 * Never replace Module.ccall/cwrap — stacked cwrap() calls recurse through ccall (Tom 171b7a9).
 */

export type Grok64WasmModule = {
  cwrap?: (name: string, ret: string | null, args: string[]) => (...a: unknown[]) => unknown;
  ccall?: (...args: unknown[]) => unknown;
};

const boundDisk = new WeakSet<object>();
const boundWasm = new WeakSet<object>();

function capturePristineCcall(mod: Grok64WasmModule | null | undefined): void {
  if (!mod) return;
  const bag = mod as Grok64WasmModule & {
    __grok64PristineCwrap?: Grok64WasmModule["cwrap"];
    __grok64PristineCcall?: Grok64WasmModule["ccall"];
  };
  if (!bag.__grok64PristineCwrap && typeof mod.cwrap === "function") {
    bag.__grok64PristineCwrap = mod.cwrap;
  }
  if (!bag.__grok64PristineCcall && typeof mod.ccall === "function") {
    bag.__grok64PristineCcall = mod.ccall;
  }
}

export function grok64PristineCwrap(mod: Grok64WasmModule | null | undefined): Grok64WasmModule["cwrap"] | null {
  capturePristineCcall(mod);
  const bag = mod as Grok64WasmModule & { __grok64PristineCwrap?: Grok64WasmModule["cwrap"] };
  return bag.__grok64PristineCwrap ?? null;
}

export function grok64PristineCcall(mod: Grok64WasmModule | null | undefined): Grok64WasmModule["ccall"] | null {
  capturePristineCcall(mod);
  const bag = mod as Grok64WasmModule & { __grok64PristineCcall?: Grok64WasmModule["ccall"] };
  return bag.__grok64PristineCcall ?? null;
}

export function isGrok64DiskExportsBound(mod: object): boolean {
  return boundDisk.has(mod);
}

export function markGrok64DiskExportsBound(mod: object): void {
  boundDisk.add(mod);
}

export function isGrok64WasmExportsBound(mod: object): boolean {
  return boundWasm.has(mod);
}

export function markGrok64WasmExportsBound(mod: object): void {
  boundWasm.add(mod);
}
