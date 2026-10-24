/**
 * Canonical Grok64 IEC core fetch URL (EmulatorJS IDB keys on full URL string).
 */
import { GROK64_CORE_GLUE_SHA12, grok64CoreBuildIdForUrl } from "./grok64-core-build";

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
