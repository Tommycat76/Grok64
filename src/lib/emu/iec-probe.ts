/** C64-side IEC status channel (OPEN 15) — not the vdrive diagnostic buffer. */
import type { Grok64Emu } from "./grok64-vice-bridge";
import { feedBasicLine } from "./c64-keyboard";
import { readScreenText } from "./screen-text";

function lastNonEmptyLine(screen: string): string {
  const lines = screen.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/** Read drive error channel via BASIC (true IEC path when TDE is active). */
export async function probeIecDriveErrorChannel(
  emu: Grok64Emu | null,
  unit = 8,
  { settleMs = 6000 } = {},
): Promise<{ ok: boolean; text: string; isVirtual: boolean; isCbmDos: boolean }> {
  if (!emu) return { ok: false, text: "", isVirtual: false, isCbmDos: false };
  const u = unit;
  const script = [
    `OPEN 15,${u},15`,
    `PRINT#15,"UI"`,
    `INPUT#15,A$`,
    `CLOSE 15`,
    `PRINT A$`,
  ];
  for (const line of script) {
    const runcmd = line.startsWith("PRINT A$");
    const ok = await feedBasicLine(emu, line, { runcmd });
    if (!ok) return { ok: false, text: readScreenText(emu), isVirtual: false, isCbmDos: false };
    if (line.startsWith("INPUT#")) await new Promise((r) => window.setTimeout(r, 1200));
    if (runcmd) await new Promise((r) => window.setTimeout(r, settleMs));
  }
  const screen = readScreenText(emu);
  const cbmLine = screen
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /CBM\s+DOS/i.test(l) || /VIRTUAL\s+DRIVE/i.test(l));
  const text = cbmLine ?? lastNonEmptyLine(screen);
  const isVirtual = /VIRTUAL\s+DRIVE/i.test(text);
  const isCbmDos = /CBM\s+DOS/i.test(text);
  return { ok: text.length > 0, text, isVirtual, isCbmDos };
}
