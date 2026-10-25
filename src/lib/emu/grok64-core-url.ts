/**
 * Canonical Grok64 IEC core fetch URL (EmulatorJS IDB keys on full URL string).
 */
import { GROK64_CORE_GLUE_SHA12, grok64CoreBuildIdForUrl } from "./grok64-core-build";

/** sessionStorage: a heal reload is in flight — do not crash-restore the old session. */
export const GROK64_CORE_HEAL_PENDING_SS = "grok64.coreHealPending";
/** sessionStorage: how many core-heal reloads this tab has spent. */
export const GROK64_CORE_AUTO_RELOAD_SS = "grok64.coreCacheAutoReload";
/** sessionStorage: last heal exhausted after a real manifest-sized fetch. */
export const GROK64_CORE_STALE_STICKY_SS = "grok64.coreStaleSticky";
/** sessionStorage: Content-Length of the last VICE .data network response. */
export const GROK64_CORE_LAST_FETCH_SS = "grok64.coreLastFetchBytes";

export function grok64CoreHealQueryParam(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    if (sessionStorage.getItem(GROK64_CORE_HEAL_PENDING_SS) !== "1") return null;
    const n = sessionStorage.getItem(GROK64_CORE_AUTO_RELOAD_SS) || "1";
    return n;
  } catch {
    return null;
  }
}

export function appendGrok64CoreUrlCacheParams(url: string): string {
  let out = url;
  const buildId = grok64CoreBuildIdForUrl();
  if (buildId) {
    const sep = out.includes("?") ? "&" : "?";
    out = `${out}${sep}grok64core=${encodeURIComponent(buildId)}`;
  }
  if (GROK64_CORE_GLUE_SHA12) {
    const glueParam = `grok64glue=${encodeURIComponent(GROK64_CORE_GLUE_SHA12)}`;
    out = out.includes("?") ? `${out}&${glueParam}` : `${out}?${glueParam}`;
  }
  const heal = grok64CoreHealQueryParam();
  if (heal) {
    const healParam = `grok64heal=${encodeURIComponent(heal)}`;
    out = out.includes("?") ? `${out}&${healParam}` : `${out}?${healParam}`;
  }
  return out;
}

export function expectedGrok64GlueSha12FromUrl(url: string): string | null {
  try {
    return new URL(url, typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1").searchParams.get(
      "grok64glue",
    );
  } catch {
    const m = url.match(/[?&]grok64glue=([^&]+)/i);
    return m?.[1] ?? null;
  }
}
