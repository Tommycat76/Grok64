/**
 * Joyport + software region hints (reconstructed from build session).
 * Original used PORT1_TITLES for Boulder Dash / Rockford family.
 */

export type JoyPort = 1 | 2;

const PORT1_TITLES = [
  /boulder\s*dash/i,
  /rockford/i,
  /boulder\s*dash.*construction/i, // still prefer port 1 if somehow loaded
];

export function detectJoyPort(haystack: string): JoyPort {
  const s = haystack || "";
  for (const re of PORT1_TITLES) {
    if (re.test(s)) return 1;
  }
  return 2;
}

export function detectSoftwareStandard(haystack: string): "ntsc" | "pal" | "unknown" {
  if (/pal/i.test(haystack)) return "pal";
  if (/ntsc/i.test(haystack)) return "ntsc";
  return "unknown";
}
