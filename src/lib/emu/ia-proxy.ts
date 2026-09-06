const ARCHIVE = "https://archive.org";

/**
 * Plex static host co-locates `serve-static-ia.mjs` at `/api/ia` on the same origin.
 * Override with VITE_IA_PROXY_BASE (client build) or IA_PROXY_BASE (server).
 */
export function iaProxyPrefix(): string | null {
  if (typeof window !== "undefined") {
    const override = (import.meta.env.VITE_IA_PROXY_BASE as string | undefined)?.trim();
    if (override) return override.replace(/\/$/, "");
    return "/api/ia";
  }
  const srv = (process.env.IA_PROXY_BASE || process.env.VITE_IA_PROXY_BASE || "").trim();
  return srv ? srv.replace(/\/$/, "") : null;
}

function isArchiveHost(host: string): boolean {
  return host === "archive.org" || host.endsWith(".archive.org");
}

/** Rewrite an archive.org URL through the Plex proxy (`/api/ia/...` or `?url=`). */
export function proxyArchiveUrl(url: string): string {
  const base = iaProxyPrefix();
  if (!base) return url;
  if (url.startsWith(base)) return url;
  if (url.startsWith("/api/ia")) return url;

  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : ARCHIVE);
    if (!isArchiveHost(u.hostname)) {
      return `${base}?url=${encodeURIComponent(url)}`;
    }
    const path = u.pathname;
    const qs = u.search;
    if (
      path.startsWith("/download/") ||
      path.startsWith("/metadata/") ||
      path.startsWith("/advancedsearch.php")
    ) {
      return `${base}${path}${qs}`;
    }
    return `${base}?url=${encodeURIComponent(u.href)}`;
  } catch {
    return `${base}?url=${encodeURIComponent(url)}`;
  }
}

export function iaSearchUrl(searchParams: string): string {
  return proxyArchiveUrl(`${ARCHIVE}/advancedsearch.php?${searchParams}`);
}

export function iaMetadataUrl(identifier: string): string {
  const id = identifier.replace(/[^a-zA-Z0-9._-]/g, "");
  const base = iaProxyPrefix();
  if (base) return `${base}/metadata/${encodeURIComponent(id)}`;
  return `${ARCHIVE}/metadata/${encodeURIComponent(id)}`;
}

export function iaDownloadUrl(identifier: string, filePath: string): string {
  const id = identifier.replace(/[^a-zA-Z0-9._-]/g, "");
  const file = filePath
    .split("/")
    .filter(Boolean)
    .map((p) => encodeURIComponent(p))
    .join("/");
  const base = iaProxyPrefix();
  if (base) return `${base}/download/${encodeURIComponent(id)}/${file}`;
  return `${ARCHIVE}/download/${encodeURIComponent(id)}/${file}`;
}

/** Server-side fetch URL for downloadCatalogFile (absolute proxy when IA_PROXY_BASE set). */
export function maybeProxyArchiveUrl(url: string): string {
  return proxyArchiveUrl(url);
}

/** True when URL is already routed through the same-origin IA proxy. */
export function isProxiedIaUrl(url: string): boolean {
  return /^(\.\/)?\/api\/ia(\/|\?|$)/.test(url) || (iaProxyPrefix() != null && url.startsWith(iaProxyPrefix()!));
}

/** Client fetch URL for a catalog file (handles https archive URLs and /api/ia paths). */
export function iaClientFetchUrl(url: string): string {
  if (isProxiedIaUrl(url)) return url;
  if (/^https?:\/\//i.test(url)) return proxyArchiveUrl(url);
  return url;
}
