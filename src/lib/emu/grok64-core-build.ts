/**
 * Grok64 VICE core build identity — used to cache-bust EmulatorJS IndexedDB (keyed by URL).
 * Regenerate: `node scripts/write-grok64-core-manifest.mjs`
 */
import {
  GROK64_CORE_BUILD_ID as GENERATED_BUILD_ID,
  GROK64_CORE_SHA256 as GENERATED_SHA256,
  GROK64_CORE_BYTES as GENERATED_BYTES,
} from "./grok64-core-build.generated";

export {
  GROK64_CORE_SHA256,
  GROK64_CORE_BUILD_ID,
  GROK64_CORE_BYTES,
  GROK64_CORE_GLUE_SHA12,
} from "./grok64-core-build.generated";

const TEST_LS_KEY = "grok64.testCoreBuildId";

/** Build id appended as `?grok64core=` on the core .data URL (omit when `legacy` for QA seeding). */
export function grok64CoreBuildIdForUrl(): string | null {
  if (typeof window !== "undefined") {
    try {
      const override = window.localStorage.getItem(TEST_LS_KEY);
      if (override === "legacy") return null;
      if (override && /^[a-f0-9]{8,64}$/i.test(override)) return override.toLowerCase().slice(0, 12);
    } catch {
      /* ignore */
    }
  }
  return GENERATED_BUILD_ID || null;
}

export function grok64CoreManifestSummary() {
  return {
    buildId: GENERATED_BUILD_ID,
    sha256: GENERATED_SHA256,
    bytes: GENERATED_BYTES,
    urlBuildId: grok64CoreBuildIdForUrl(),
  };
}
