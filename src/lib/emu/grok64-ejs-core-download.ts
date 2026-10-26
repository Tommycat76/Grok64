/**
 * EmulatorJS `downloadFile` arity differs by release. Grok64 must pin every
 * vice_*.data fetch to the local IEC blob without smashing stable `opts`
 * (that is what sent Power to the CDN and a CORS-preflight Cache-Control).
 *
 * stable (4):  (path, progressCB, notWithPath, opts)
 * latest (8):  (path, type, progress, notWithPath, opts, forceExtract, dontCache, dontExtract)
 */

export type EjsDownloadOpts = { responseType?: string; method?: string };

export function ejsDownloadFileArity(downloadFile: unknown): 4 | 8 {
  const n = Number((downloadFile as { length?: number } | null | undefined)?.length ?? 4);
  return Number.isFinite(n) && n >= 6 ? 8 : 4;
}

export function ejsCoreDownloadLeaf(path: string): string {
  return String(path).split("?")[0].split("/").pop() ?? "";
}

function asDownloadOpts(value: unknown): { responseType: string; method: string } {
  if (value && typeof value === "object") {
    const o = value as EjsDownloadOpts;
    return {
      responseType: o.responseType || "arraybuffer",
      method: o.method || "GET",
    };
  }
  return { responseType: "arraybuffer", method: "GET" };
}

/**
 * Force `args` onto `canonical` with notWithPath on the correct index.
 * Never writes `true` over stable `opts` (args[3] on the 4-arg API).
 */
export function applyGrok64LocalCoreDownloadArgs(
  args: unknown[],
  arity: 4 | 8,
  canonical: string,
): unknown[] {
  const next = args.slice();
  next[0] = canonical;
  if (arity >= 8) {
    next[3] = true;
    next[4] = asDownloadOpts(next[4]);
    next[6] = true;
  } else {
    next[2] = true;
    next[3] = asDownloadOpts(next[3]);
  }
  return next;
}

export function requestHasForbiddenCoreCacheHeader(headers: Record<string, string> | undefined | null): boolean {
  if (!headers) return false;
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const k = key.toLowerCase();
    if (k === "cache-control" || k === "pragma") return true;
  }
  return false;
}
