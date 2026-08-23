/**
 * Catalog search ranking — prefer clean originals, pin Boulder Dash First Star.
 * Reconstructed from Grok64 build session.
 */

import { isJunkRelease, rankBootCandidate } from "./archive";

export interface CatalogHit {
  title: string;
  id?: string;
  source?: "ia" | "assembly64" | string;
  url?: string;
  year?: string;
}

const BD_PIN = /boulder\s*dash.*first\s*star|Boulder_Dash_1984_First_Star/i;

export function isPreferredClassic(title: string): boolean {
  return BD_PIN.test(title) || /first\s*star.*boulder/i.test(title);
}

export function rankCatalogHits(hits: CatalogHit[]): CatalogHit[] {
  return [...hits].sort((a, b) => {
    const sa = scoreHit(a);
    const sb = scoreHit(b);
    return sb - sa;
  });
}

function scoreHit(h: CatalogHit): number {
  let s = rankBootCandidate(h.title || h.id || "");
  if (isPreferredClassic(h.title || "") || isPreferredClassic(h.id || "")) s += 50;
  if (h.source === "ia") s += 3;
  if (isJunkRelease(h.title || h.id || "")) s -= 100;
  return s;
}

/** Pin known-good Boulder Dash IA identifier first when present. */
export function pinPlayable(hits: CatalogHit[]): CatalogHit[] {
  const pinId = /Boulder_Dash_1984_First_Star/i;
  const pinned = hits.filter((h) => pinId.test(h.id || "") || pinId.test(h.title || ""));
  const rest = hits.filter((h) => !pinned.includes(h));
  return [...rankCatalogHits(pinned), ...rankCatalogHits(rest)];
}

export function pickNamed(hits: CatalogHit[], nameRe: RegExp): CatalogHit | null {
  const ranked = rankCatalogHits(hits.filter((h) => nameRe.test(h.title || "")));
  return ranked[0] || null;
}
