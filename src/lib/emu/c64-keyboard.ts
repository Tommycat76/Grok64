/** Inject BASIC lines via VICE kbdbuf (or C64 KERNAL queue at $0277 / $C6). */

import { readC64Byte, writeC64Byte, type RamEmu } from "./c64-memory";
import { grok64PristineCwrap, type Grok64WasmModule } from "./grok64-wasm-bind";
import { dispatchC64Key, typeC64 } from "./keys";

const KBD_BUF = 0x0277;
const KBD_CNT = 0x00c6;
const KBD_MAX = 10;

type KbdEmu = RamEmu & {
  Module?: {
    _grok64_kbdbuf_feed?: (text: string) => number;
    _grok64_kbdbuf_feed_runcmd?: (text: string) => number;
    _grok64_kbdbuf_flush?: () => void;
    cwrap?: (name: string, ret: string | null, args: string[]) => (...a: unknown[]) => unknown;
  };
};

function asciiToPetsciiByte(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 97 && c <= 122) return c - 32;
  return c & 0xff;
}

function sleep(ms: number) {
  return new Promise<void>((r) => {
    window.setTimeout(r, ms);
  });
}

function bindKbdExports(emu: KbdEmu | null): KbdEmu["Module"] | null {
  const mod = emu?.Module;
  const wrap = grok64PristineCwrap(mod as Grok64WasmModule);
  if (!mod || !wrap) return mod ?? null;
  try {
    if (!mod._grok64_kbdbuf_feed_runcmd) {
      mod._grok64_kbdbuf_feed_runcmd = wrap("grok64_kbdbuf_feed_runcmd", "number", ["string"]) as (
        t: string,
      ) => number;
    }
    if (!mod._grok64_kbdbuf_flush) {
      mod._grok64_kbdbuf_flush = wrap("grok64_kbdbuf_flush", null, []) as () => void;
    }
    if (!mod._grok64_kbdbuf_feed) {
      mod._grok64_kbdbuf_feed = wrap("grok64_kbdbuf_feed", "number", ["string"]) as (t: string) => number;
    }
  } catch {
    /* stock core */
  }
  return mod;
}

async function pumpKbdbuf(emu: KbdEmu | null, ms = 6000): Promise<void> {
  const mod = bindKbdExports(emu);
  if (!mod?._grok64_kbdbuf_flush) return;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    mod._grok64_kbdbuf_flush!();
    await sleep(16);
  }
}

async function kbdbufFeed(emu: KbdEmu | null, text: string, runcmd = false): Promise<boolean> {
  const mod = bindKbdExports(emu);
  if (!mod) return false;
  const fn = runcmd ? mod._grok64_kbdbuf_feed_runcmd : mod._grok64_kbdbuf_feed;
  if (typeof fn !== "function") return false;
  const rc = fn(text);
  if (rc !== 0) return false;
  await pumpKbdbuf(emu, runcmd ? 4000 : 8000);
  return true;
}

/** Queue one PETSCII byte into the KERNAL keyboard buffer (max 10 pending). */
async function queuePetsciiByte(emu: RamEmu | null, pet: number): Promise<boolean> {
  for (let i = 0; i < 400; i++) {
    const n = readC64Byte(emu, KBD_CNT) ?? 0;
    if (n < KBD_MAX) {
      writeC64Byte(emu, KBD_BUF + n, pet & 0xff);
      writeC64Byte(emu, KBD_CNT, n + 1);
      return true;
    }
    await sleep(12);
  }
  return false;
}

async function waitKernalQueueDrain(emu: RamEmu | null, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const n = readC64Byte(emu, KBD_CNT) ?? 0;
    if (n === 0) return;
    await sleep(25);
  }
}

async function feedViaCanvasKeys(line: string): Promise<boolean> {
  try {
    await typeC64(line, { delayMs: 45 });
    dispatchC64Key("Enter", "Enter", true);
    await sleep(30);
    dispatchC64Key("Enter", "Enter", false);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type a BASIC line as the user would (ends with RETURN).
 * Prefer VICE `kbdbuf_feed_string`; fall back to $0277/$C6 via `_grok64_c64_write`, then canvas keys.
 */
export async function feedBasicLine(
  emu: RamEmu | null,
  line: string,
  opts?: { cr?: boolean; runcmd?: boolean },
): Promise<boolean> {
  if (!emu) return false;
  const tail = opts?.cr === false ? "" : "\r";
  const text = `${line}${tail}`;
  const runcmd = opts?.runcmd ?? /^RUN\b/i.test(line.trim());
  if (await kbdbufFeed(emu as KbdEmu, text, runcmd)) {
    await waitKernalQueueDrain(emu, 12_000);
    return true;
  }
  for (const ch of text) {
    const ok = await queuePetsciiByte(emu, asciiToPetsciiByte(ch));
    if (!ok) break;
    await sleep(10);
  }
  await waitKernalQueueDrain(emu, 12_000);
  const n = readC64Byte(emu, KBD_CNT) ?? 0;
  if (n === 0) return true;
  return feedViaCanvasKeys(line);
}

/** Read C64 jiffies from PRINT TI (for load-timing QA). */
export async function readPrintTi(
  emu: RamEmu | null,
  screenText: () => string,
): Promise<number | null> {
  if (!emu) return null;
  const ok = await feedBasicLine(emu, "PRINT TI", { runcmd: true });
  if (!ok) return null;
  for (const ms of [1200, 2200]) {
    await sleep(ms);
    const text = screenText();
    const m =
      text.match(/TI\s*=\s*(\d+)/i) ??
      text.match(/(?:^|\s)(\d{4,})(?:\s|$)/m) ??
      text.match(/\b(\d{5,})\b/);
    if (m) return Number.parseInt(m[1], 10);
  }
  return null;
}
