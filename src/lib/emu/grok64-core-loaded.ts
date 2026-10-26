/**
 * Fingerprint the VICE libretro glue JS that EmulatorJS actually evaluated (not manifest URL).
 */
import { GROK64_CORE_BUILD_ID, GROK64_CORE_GLUE_SHA12 } from "./grok64-core-build.generated";

export type Grok64LoadedCoreGlue = {
  glueBytes: number;
  glueSha12: string | null;
  glueHasDiskExports: boolean;
  recordedAt: number;
};

const WIN_KEY = "__GROK64_LOADED_CORE_GLUE__";

export async function sha256PrefixAsync(bytes: Uint8Array, hexLen = 12): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const buf = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    const arr = Array.from(new Uint8Array(buf));
    return arr
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, hexLen);
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, hexLen);
}

function toBytes(js: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof js === "string") return new TextEncoder().encode(js);
  if (js instanceof ArrayBuffer) return new Uint8Array(js);
  return js;
}

/** Scan the whole buffer — the 7z archive compresses this name, the extracted JS/WASM does not. */
export function bytesHaveGrok64DiskAttach(bytes: Uint8Array): boolean {
  return bufferContainsAscii(bytes, "grok64_disk_attach") || bufferContainsAscii(bytes, "_grok64_disk_attach");
}

function bufferContainsAscii(haystack: Uint8Array, needle: string): boolean {
  if (!haystack.length || !needle) return false;
  const n = new TextEncoder().encode(needle);
  const last = haystack.length - n.length;
  if (last < 0) return false;
  const first = n[0]!;
  for (let i = 0; i <= last; i++) {
    if (haystack[i] !== first) continue;
    let ok = true;
    for (let j = 1; j < n.length; j++) {
      if (haystack[i + j] !== n[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

export function recordGrok64CoreGlue(
  js: Uint8Array | ArrayBuffer | string,
  wasm?: Uint8Array | ArrayBuffer | string | null,
): void {
  if (typeof window === "undefined") return;
  const bytes = toBytes(js);
  const wasmBytes = wasm != null ? toBytes(wasm) : null;
  const glueHasDiskExports = bytesHaveGrok64DiskAttach(bytes) || Boolean(wasmBytes && bytesHaveGrok64DiskAttach(wasmBytes));
  const info: Grok64LoadedCoreGlue = {
    glueBytes: bytes.length,
    glueSha12: null,
    glueHasDiskExports,
    recordedAt: Date.now(),
  };
  (window as unknown as Record<string, unknown>)[WIN_KEY] = info;
  void sha256PrefixAsync(bytes).then((glueSha12) => {
    const w = window as unknown as Record<string, Grok64LoadedCoreGlue | undefined>;
    const cur = w[WIN_KEY];
    if (cur) cur.glueSha12 = glueSha12;
    try {
      window.dispatchEvent(new CustomEvent("grok64-core-glue-sha"));
    } catch {
      /* ignore */
    }
  });
}

export function loadedCoreGlueInfo(): Grok64LoadedCoreGlue | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as Record<string, unknown>)[WIN_KEY] as Grok64LoadedCoreGlue) ?? null;
}

/** What actually ran in the browser (glue fingerprint), not the manifest / URL. */
export function grok64CoreBuildIdLoaded(): string | null {
  const glue = loadedCoreGlueInfo();
  if (!glue) return null;
  if (!glue.glueHasDiskExports) return "stale-no-disk-exports";
  if (GROK64_CORE_GLUE_SHA12 && glue.glueSha12 === GROK64_CORE_GLUE_SHA12) {
    return GROK64_CORE_BUILD_ID || glue.glueSha12;
  }
  if (GROK64_CORE_GLUE_SHA12 && glue.glueSha12) return glue.glueSha12;
  return glue.glueHasDiskExports ? GROK64_CORE_BUILD_ID || null : glue.glueSha12;
}

export function grok64CoreBuildMatchesExpected(): boolean {
  const glue = loadedCoreGlueInfo();
  if (!glue?.glueHasDiskExports) return false;
  if (GROK64_CORE_GLUE_SHA12) {
    return glue.glueSha12 === GROK64_CORE_GLUE_SHA12;
  }
  return grok64CoreBuildIdLoaded() === GROK64_CORE_BUILD_ID;
}

export type Grok64CoreMismatchInput = {
  coreStarted?: boolean;
  diskExportsPresent?: boolean;
  glue?: Grok64LoadedCoreGlue | null;
  expectedBuildId?: string | null;
  expectedGlueSha12?: string | null;
};

export type Grok64CoreMismatch = {
  mismatch: boolean;
  reason: string | null;
  loadedBuildId: string | null;
  expectedBuildId: string;
  diskExportsPresent: boolean;
  glueHasDiskExports: boolean;
  glueRecorded: boolean;
  glueSha12: string | null;
  expectedGlueSha12: string;
};

/**
 * Compare the core that actually ran (glue fingerprint + WASM exports) with the
 * manifest. A dirty profile can keep a cached blob that never exposes
 * `grok64_disk_attach` — that is a mismatch even when glue was never recorded.
 */
export function runningCoreMismatch(input: Grok64CoreMismatchInput = {}): Grok64CoreMismatch {
  const coreStarted = input.coreStarted !== false;
  const glue = input.glue === undefined ? loadedCoreGlueInfo() : input.glue;
  const expectedBuildId = input.expectedBuildId ?? GROK64_CORE_BUILD_ID ?? "";
  const expectedGlueSha12 = input.expectedGlueSha12 ?? GROK64_CORE_GLUE_SHA12 ?? "";
  const diskExportsPresent = Boolean(input.diskExportsPresent);
  const glueRecorded = Boolean(glue && glue.glueBytes > 0);
  const glueHasDiskExports = Boolean(glue?.glueHasDiskExports);
  const glueSha12 = glue?.glueSha12 ?? null;

  let loadedBuildId: string | null = null;
  if (glueRecorded) {
    if (!glueHasDiskExports && !diskExportsPresent) loadedBuildId = "stale-no-disk-exports";
    else if (expectedGlueSha12 && glueSha12 === expectedGlueSha12) loadedBuildId = expectedBuildId || glueSha12;
    else loadedBuildId = glueSha12 ?? (glueHasDiskExports || diskExportsPresent ? expectedBuildId || null : null);
  }

  let reason: string | null = null;
  if (glueRecorded && !glueHasDiskExports && !diskExportsPresent) {
    reason = "glue-missing-disk-exports";
  } else if (glueSha12 && expectedGlueSha12 && glueSha12 !== expectedGlueSha12) {
    reason = "glue-sha-mismatch";
  } else if (coreStarted && !diskExportsPresent) {
    reason = "wasm-exports-missing";
  }

  if (diskExportsPresent && reason === "wasm-exports-missing") reason = null;
  if (diskExportsPresent && reason === "glue-missing-disk-exports") reason = null;
  // A glue sample that missed the export name is not a SHA identity for the running core.
  if (diskExportsPresent && !glueHasDiskExports && reason === "glue-sha-mismatch") reason = null;
  if (diskExportsPresent && reason == null && glueRecorded && glueHasDiskExports && glueSha12 && expectedGlueSha12 && glueSha12 !== expectedGlueSha12) {
    reason = "glue-sha-mismatch";
  }

  return {
    mismatch: reason != null,
    reason,
    loadedBuildId,
    expectedBuildId,
    diskExportsPresent,
    glueHasDiskExports,
    glueRecorded,
    glueSha12,
    expectedGlueSha12,
  };
}
