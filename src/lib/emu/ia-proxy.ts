/** Optional Internet Archive download proxy (Plex/nginx same-origin or external). */
export function iaProxyBase(): string | null {
  const raw = (import.meta.env.VITE_IA_PROXY_BASE as string | undefined)?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

/** Build a download URL — proxied when VITE_IA_PROXY_BASE is set. */
export function iaDownloadUrl(identifier: string, filePath: string): string {
  const id = identifier.replace(/[^a-zA-Z0-9._-]/g, "");
  const file = filePath
    .split("/")
    .filter(Boolean)
    .map((p) => encodeURIComponent(p))
    .join("/");
  const base = iaProxyBase();
  if (base) return `${base}/${encodeURIComponent(id)}/${file}`;
  return `https://archive.org/download/${encodeURIComponent(id)}/${file}`;
}

/** Rewrite archive.org download URLs through the proxy when configured (server-side). */
export function maybeProxyArchiveUrl(url: string): string {
  const base = (process.env.IA_PROXY_BASE || process.env.VITE_IA_PROXY_BASE || "").trim().replace(/\/$/, "");
  if (!base) return url;
  const m = url.match(/^https?:\/\/archive\.org\/download\/([^/]+)\/(.+)$/i);
  if (!m) return url;
  const file = m[2]
    .split("/")
    .map((p) => encodeURIComponent(decodeURIComponent(p)))
    .join("/");
  return `${base}/${encodeURIComponent(m[1])}/${file}`;
}
