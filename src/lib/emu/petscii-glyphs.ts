/**
 * Published C64 uppercase/graphics 8×8 patterns (screen codes $00–$7F).
 * Used to paint real PETSCII on touch keycaps — not host Unicode symbols.
 * Source: Commodore 64 character set as documented in the Programmer's Reference Guide.
 */
const CHARGEN_HEX =
  "3c666e6e60623c00183c667e666666007c66667c66667c003c66606060663c00" +
  "786c6666666c78007e60607860607e007e606078606060003c66606e66663c00" +
  "6666667e666666003c18181818183c001e0c0c0c0c6c3800666c7870786c6600" +
  "6060606060607e0063777f6b6363630066767e7e6e6666003c66666666663c00" +
  "7c66667c606060003c666666663c0e007c66667c786c66003c66603c06663c00" +
  "7e181818181818006666666666663c0066666666663c18006363636b7f776300" +
  "66663c183c6666006666663c181818007e060c1830607e003c30303030303c00" +
  "0c12307c3062fc003c0c0c0c0c0c3c0000183c7e181818180010307f7f301000" +
  "0000000000000000181818180000180066666600000000006666ff66ff666600" +
  "183e603c067c180062660c18306646003c663c3867663f00060c180000000000" +
  "0c18303030180c0030180c0c0c18300000663cff3c6600000018187e18180000" +
  "00000000001818300000007e0000000000000000001818000003060c18306000" +
  "3c666e7666663c001818381818187e003c66060c30607e003c66061c06663c00" +
  "060e1e667f0606007e607c0606663c003c66607c66663c007e660c1818181800" +
  "3c66663c66663c003c66663e06663c0000001800001800000000180000181830" +
  "0e18306030180e0000007e007e00000070180c060c1870003c66060c18001800" +
  "000000ffff000000081c3e7f7f1c3e001818181818181818000000ffff000000" +
  "0000ffff0000000000ffff000000000000000000ffff00003030303030303030" +
  "0c0c0c0c0c0c0c0c000000e0f038181818181c0f07000000181838f0e0000000" +
  "c0c0c0c0c0c0ffffc0e070381c0e070303070e1c3870e0c0ffffc0c0c0c0c0c0" +
  "ffff030303030303003c7e7e7e7e3c000000000000ffff00367f7f7f3e1c0800" +
  "6060606060606060000000070f1c1818c3e77e3c3c7ee7c3003c7e66667e3c00" +
  "1818666618183c000606060606060606081c3e7f3e1c0800181818ffff181818" +
  "c0c03030c0c0303018181818181818180000033e76363600ff7f3f1f0f070301" +
  "0000000000000000f0f0f0f0f0f0f0f000000000ffffffffff00000000000000" +
  "00000000000000ffc0c0c0c0c0c0c0c0cccc3333cccc33330303030303030303" +
  "00000000cccc3333fffefcf8f0e0c08003030303030303031818181f1f181818" +
  "000000000f0f0f0f1818181f1f000000000000f8f8181818000000000000ffff" +
  "0000001f1f181818181818ffff000000000000ffff181818181818f8f8181818" +
  "c0c0c0c0c0c0c0c0e0e0e0e0e0e0e0e00707070707070707ffff000000000000" +
  "ffffff00000000000000000000ffffff030303030303ffff00000000f0f0f0f0" +
  "0f0f0f0f00000000181818f8f8000000f0f0f0f000000000f0f0f0f00f0f0f0f";

const CHARGEN = new Uint8Array(CHARGEN_HEX.length / 2);
for (let i = 0; i < CHARGEN.length; i++) {
  CHARGEN[i] = parseInt(CHARGEN_HEX.slice(i * 2, i * 2 + 2), 16);
}

/** PETSCII byte → VIC-II screen code (uppercase/graphics set). */
export function petsciiToScreen(petscii: number): number {
  const p = petscii & 0xff;
  if (p <= 0x1f) return 0x20;
  if (p <= 0x3f) return p;
  if (p <= 0x5f) return p - 0x40;
  if (p <= 0x7f) return p - 0x20;
  if (p <= 0x9f) return 0x20;
  if (p <= 0xbf) return p - 0x40;
  if (p <= 0xdf) return p - 0x80;
  return p - 0x80;
}

export function glyphBytes(screen: number): Uint8Array {
  const i = (screen & 0x7f) * 8;
  return CHARGEN.subarray(i, i + 8);
}

const PATH_CACHE = new Map<number, string>();

/** SVG path for an 8×8 C64 glyph (1 unit per pixel). */
export function glyphPath(screen: number): string {
  const key = screen & 0x7f;
  const hit = PATH_CACHE.get(key);
  if (hit != null) return hit;
  const bytes = glyphBytes(key);
  let d = "";
  for (let y = 0; y < 8; y++) {
    const row = bytes[y] ?? 0;
    for (let x = 0; x < 8; x++) {
      if (row & (0x80 >> x)) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  PATH_CACHE.set(key, d);
  return d;
}

export function glyphHasPixels(screen: number): boolean {
  const bytes = glyphBytes(screen);
  for (let i = 0; i < 8; i++) if (bytes[i]) return true;
  return false;
}
