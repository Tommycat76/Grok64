export const CATALOG_KINDS = [
  { id: "all", label: "All" },
  { id: "games", label: "Games" },
  { id: "carts", label: "Carts" },
  { id: "disks", label: "Disks" },
  { id: "sid", label: "SID" },
  { id: "demos", label: "Demos" },
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number]["id"];

export const SOURCE_LABEL = { a64: "Assembly64", ia: "Archive", hvsc: "HVSC" } as const;
export type CatalogSource = keyof typeof SOURCE_LABEL;

export interface CatalogHit {
  key: string;
  title: string;
  subtitle: string;
  source: CatalogSource;
  url?: string;
  identifier?: string;
  a64?: { id: string; name?: string };
}

export interface CatalogFile {
  name: string;
  size?: number;
  url?: string;
  a64?: { id: string; name?: string };
}

const BD_PIN = /boulder\s*dash.*first\s*star|Boulder_Dash_1984_First_Star/i;
const JUNK =
  /preview|readme|\.nfo$|docs?$|side\s*b|disk\s*(2|3|b)\b|construction|\bkit\b|trainer|awally|a[\s._-]*wally|editor|designer|cheat|\+\d{1,2}\b/i;
const PREFER = /first[\s._-]*star|original|\((?:usa|us)\)/i;

export function isJunkRelease(name: string) {
  return JUNK.test(name);
}

export function pinPlayable(hits: CatalogHit[]) {
  const pinned = hits.filter((h) => BD_PIN.test(h.identifier || "") || BD_PIN.test(h.title));
  const rest = hits.filter((h) => !pinned.includes(h));
  const rank = (h: CatalogHit) => {
    let s = 0;
    if (isJunkRelease(h.title) || isJunkRelease(h.identifier || "")) s -= 100;
    if (PREFER.test(h.title) || PREFER.test(h.identifier || "")) s += 20;
    if (h.source === "ia") s += 3;
    if (BD_PIN.test(h.title) || BD_PIN.test(h.identifier || "")) s += 50;
    return s;
  };
  const sort = (list: CatalogHit[]) => [...list].sort((a, b) => rank(b) - rank(a));
  return [...sort(pinned), ...sort(rest)];
}

export const CLASSICS = [
  "Boulder Dash",
  "Last Ninja",
  "Impossible Mission",
  "International Karate",
  "Ghostbusters",
  "Summer Games",
  "Wizball",
  "Paradroid",
  "Turrican",
  "Uridium",
  "Commando",
  "Monty on the Run",
  "Great Giana Sisters",
  "Archon",
  "M.U.L.E.",
  "Lode Runner",
];
