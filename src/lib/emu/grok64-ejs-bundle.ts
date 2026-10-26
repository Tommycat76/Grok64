import { GROK64_CORE_BUILD_ID } from "./grok64-core-build";

function grok64ViceCoreRoot(): string | null {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_GROK64_VICE_DATAPATH) {
    return String(import.meta.env.VITE_GROK64_VICE_DATAPATH).replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    const w = window as unknown as { __GROK64_VICE_DATA?: string };
    if (w.__GROK64_VICE_DATA) return w.__GROK64_VICE_DATA.replace(/\/$/, "");
  }
  return null;
}

export type Grok64EjsBundleFile = { bytes: number; sha256: string };

export type Grok64EjsBundle = {
  channel: string;
  version: string;
  coreBuildId: string;
  generatedAt?: string;
  files: Record<string, Grok64EjsBundleFile>;
};

let cached: Grok64EjsBundle | null = null;

export function grok64EjsBundle(): Grok64EjsBundle | null {
  if (cached) return cached;
  if (typeof window === "undefined") return null;
  const root = grok64ViceCoreRoot();
  if (!root) return null;
  const w = window as unknown as { __GROK64_EJS_BUNDLE__?: Grok64EjsBundle };
  if (w.__GROK64_EJS_BUNDLE__) {
    cached = w.__GROK64_EJS_BUNDLE__;
    return cached;
  }
  return null;
}

export function setGrok64EjsBundle(bundle: Grok64EjsBundle | null): void {
  cached = bundle;
  if (typeof window !== "undefined") {
    (window as unknown as { __GROK64_EJS_BUNDLE__?: Grok64EjsBundle | null }).__GROK64_EJS_BUNDLE__ =
      bundle ?? undefined;
  }
}

/** Same-origin EmulatorJS `data/` tree (never cdn.emulatorjs.org when configured). */
export function grok64EmulatorJsDataUrl(): string | null {
  const root = grok64ViceCoreRoot();
  if (!root || typeof window === "undefined" || !window.location?.origin) return null;
  const base = root.startsWith("/") ? root : `/${root}`;
  return `${window.location.origin}${base}/`;
}

export function grok64EjsCacheQuery(): string {
  const bid = GROK64_CORE_BUILD_ID || grok64EjsBundle()?.coreBuildId;
  return bid ? `?grok64ejs=${encodeURIComponent(bid)}` : "";
}

export function grok64EjsScriptUrl(rel: string): string | null {
  const base = grok64EmulatorJsDataUrl();
  if (!base) return null;
  const path = rel.replace(/^\//, "");
  return `${base}${path}${grok64EjsCacheQuery()}`;
}

export type Grok64EjsLoaderDiag = {
  dataPath: string | null;
  bundleVersion: string | null;
  bundleCoreBuildId: string | null;
  scriptSources: string[];
  emulatorJsUrl: string | null;
  coreBlobUrl: string | null;
};
