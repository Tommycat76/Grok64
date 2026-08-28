import { createServerFn } from "@tanstack/react-start";
import { HVSC_STARTERS } from "./software";
import {
  CLASSICS,
  pinPlayable,
  type CatalogFile,
  type CatalogHit,
  type CatalogKind,
} from "./catalog";

const A64_HOSTS = ["https://hackerswithstyle.se", "https://assembly64.hackerswithstyle.se"];
const HVSC = "https://hvsc.de/download/C64Music/";
const IA_SEARCH = "https://archive.org/advancedsearch.php";
const MAX_BYTES = 8 * 1024 * 1024;

function toB64(buf: ArrayBuffer) {
  const u = new Uint8Array(buf);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u.length; i += chunk) {
    s += String.fromCharCode(...u.subarray(i, i + chunk));
  }
  return btoa(s);
}

function fileNameFromUrl(url: string, fallback: string) {
  try {
    const last = new URL(url).pathname.split("/").pop() || fallback;
    return decodeURIComponent(last);
  } catch {
    return fallback;
  }
}

async function fetchOk(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new Error("File is too large");
  return res;
}

function a64Headers() {
  return { "Client-Id": "Grok64", Accept: "application/json" };
}

function asHits(raw: unknown): CatalogHit[] {
  if (!Array.isArray(raw)) return [];
  const out: CatalogHit[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const title = String(r.name || r.title || r.group || "").trim();
    if (!title) continue;
    const id = String(r.id || r.itemId || r.entryId || r.contentId || title);
    const year = r.year ? String(r.year) : "";
    const cat = r.category ? String(r.category) : r.type ? String(r.type) : "";
    out.push({
      key: `a64:${id}`,
      title,
      subtitle: [cat, year].filter(Boolean).join(" · ") || "Assembly64",
      source: "a64",
      a64: { id, name: title },
    });
  }
  return out;
}

async function searchA64(query: string): Promise<CatalogHit[]> {
  const q = encodeURIComponent(query || "boulder dash");
  for (const host of A64_HOSTS) {
    try {
      const res = await fetch(`${host}/leet/search/aql/0/24?query=${q}`, {
        headers: a64Headers(),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      const rows = Array.isArray(json)
        ? json
        : json && typeof json === "object"
          ? ((json as { items?: unknown; result?: unknown; content?: unknown }).items ??
            (json as { result?: unknown }).result ??
            (json as { content?: unknown }).content ??
            [])
          : [];
      const hits = asHits(rows);
      if (hits.length) return hits;
    } catch {
      /* try next host */
    }
  }
  return [];
}

async function listA64(id: string): Promise<CatalogFile[]> {
  for (const host of A64_HOSTS) {
    try {
      const res = await fetch(`${host}/leet/search/entries?id=${encodeURIComponent(id)}`, {
        headers: a64Headers(),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      const rows = Array.isArray(json)
        ? json
        : json && typeof json === "object"
          ? ((json as { files?: unknown; entries?: unknown; items?: unknown }).files ??
            (json as { entries?: unknown }).entries ??
            (json as { items?: unknown }).items ??
            [])
          : [];
      if (!Array.isArray(rows)) continue;
      const files: CatalogFile[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const name = String(r.name || r.fileName || r.filename || "").trim();
        if (!name) continue;
        const fid = String(r.id || r.itemId || id);
        files.push({
          name,
          size: typeof r.size === "number" ? r.size : undefined,
          a64: { id: fid, name },
          url: `${host}/leet/search/bin?id=${encodeURIComponent(fid)}`,
        });
      }
      if (files.length) return files;
    } catch {
      /* try next */
    }
  }
  return [];
}

function iaQuery(kind: CatalogKind, query: string) {
  const q = query.trim();
  if (kind === "sid") {
    return q
      ? `mediatype:audio AND (format:SID OR collection:hvsc OR collection:sidtune) AND ${q}`
      : `collection:hvsc`;
  }
  const base = "mediatype:software AND (collection:softwarelibrary_c64 OR collection:c64)";
  if (kind === "carts") return `${base} AND (format:CRT OR title:crt OR filename:crt) ${q}`.trim();
  if (kind === "disks") return `${base} AND (format:"C64 Disk Image" OR filename:d64) ${q}`.trim();
  if (kind === "demos") return `(collection:c64_demos OR (collection:softwarelibrary_c64 AND subject:demo)) ${q}`.trim();
  if (!q) {
    const titles = CLASSICS.map((t) => `title:"${t}"`).join(" OR ");
    return `${base} AND (${titles})`;
  }
  return `${base} AND (${q})`;
}

async function searchIa(kind: CatalogKind, query: string): Promise<CatalogHit[]> {
  const params = new URLSearchParams({
    q: iaQuery(kind, query),
    "fl[]": "identifier",
    output: "json",
    rows: "24",
  });
  params.append("fl[]", "title");
  params.append("fl[]", "year");
  params.append("fl[]", "creator");
  const res = await fetchOk(`${IA_SEARCH}?${params.toString()}`);
  const json = (await res.json()) as {
    response?: { docs?: { identifier: string; title?: string; year?: string; creator?: string }[] };
  };
  const docs = json.response?.docs ?? [];
  return docs.map((d) => ({
    key: `ia:${d.identifier}`,
    title: d.title || d.identifier,
    subtitle: [d.year, d.creator].filter(Boolean).join(" · ") || d.identifier,
    source: "ia" as const,
    identifier: d.identifier,
    url: `https://archive.org/download/${d.identifier}`,
  }));
}

function hvscHits(query: string): CatalogHit[] {
  const q = query.trim().toLowerCase();
  const paths = HVSC_STARTERS.filter((p) => !q || p.toLowerCase().includes(q.replace(/\s+/g, "_")) || p.toLowerCase().replace(/_/g, " ").includes(q));
  const list = paths.length ? paths : q ? [] : HVSC_STARTERS;
  return list.map((path) => {
    const name = path.split("/").pop() || path;
    return {
      key: `hvsc:${path}`,
      title: name.replace(/_/g, " ").replace(/\.sid$/i, ""),
      subtitle: path.replace(/\/[^/]+$/, "").replace(/\//g, " · "),
      source: "hvsc" as const,
      url: HVSC + path,
    };
  });
}

async function iaFiles(identifier: string): Promise<CatalogFile[]> {
  const res = await fetchOk(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  const json = (await res.json()) as { files?: { name: string; size?: string; format?: string }[] };
  const files = (json.files ?? []).filter((f) =>
    /\.(prg|p00|d64|d71|d81|g64|g71|t64|tap|crt|bin|sid|zip)$/i.test(f.name),
  );
  return files.map((f) => ({
    name: f.name,
    size: f.size ? Number(f.size) : undefined,
    url: `https://archive.org/download/${identifier}/${encodeURIComponent(f.name)}`,
  }));
}

export const searchCatalog = createServerFn({ method: "POST" })
  .validator((d: { query: string; kind: CatalogKind }) => d)
  .handler(async ({ data }) => {
    const query = (data.query || "").trim();
    const kind = data.kind || "games";
    const wantSid = kind === "sid" || kind === "all";
    const wantSoft = kind !== "sid";
    let a64 = false;
    const hits: CatalogHit[] = [];
    const jobs: Promise<void>[] = [];
    if (wantSoft) {
      jobs.push(
        (async () => {
          try {
            const rows = await searchA64(query || "boulder dash");
            if (rows.length) {
              a64 = true;
              hits.push(...rows);
            }
          } catch {
            /* Assembly64 is optional */
          }
        })(),
      );
      jobs.push(
        (async () => {
          try {
            hits.push(...(await searchIa(kind, query)));
          } catch {
            /* IA optional per-query */
          }
        })(),
      );
    }
    if (wantSid) hits.push(...hvscHits(kind === "sid" ? query : query));
    await Promise.all(jobs);
    const uniq = new Map<string, CatalogHit>();
    for (const h of pinPlayable(hits)) {
      if (!uniq.has(h.key)) uniq.set(h.key, h);
    }
    return { hits: [...uniq.values()].slice(0, 40), a64 };
  });

export const listRelease = createServerFn({ method: "POST" })
  .validator((d: CatalogHit) => d)
  .handler(async ({ data }): Promise<CatalogFile[]> => {
    if (data.source === "hvsc" && data.url) {
      return [{ name: fileNameFromUrl(data.url, `${data.title}.sid`), url: data.url }];
    }
    if (data.source === "a64" && data.a64?.id) {
      const files = await listA64(data.a64.id);
      if (files.length) return files;
    }
    if (data.identifier) return iaFiles(data.identifier);
    if (data.url) return [{ name: fileNameFromUrl(data.url, data.title), url: data.url }];
    return [];
  });

export const downloadCatalog = createServerFn({ method: "POST" })
  .validator((d: { name: string; url?: string; a64?: { id: string; name?: string } }) => d)
  .handler(async ({ data }) => {
    let url = data.url;
    if (!url && data.a64?.id) {
      url = `https://hackerswithstyle.se/leet/search/bin?id=${encodeURIComponent(data.a64.id)}`;
    }
    if (!url) throw new Error("Nothing to download");
    const res = await fetchOk(url, data.a64 ? { headers: a64Headers() } : undefined);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 16) throw new Error("Download was empty");
    if (buf.byteLength > MAX_BYTES) throw new Error("File is too large");
    const name = fileNameFromUrl(url, data.name);
    return { name, base64: toB64(buf) };
  });

export const fetchUrl = createServerFn({ method: "POST" })
  .validator((d: { url: string }) => d)
  .handler(async ({ data }) => {
    const url = data.url.trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Need an http(s) link");
    const res = await fetchOk(url);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 16) throw new Error("Download was empty");
    if (buf.byteLength > MAX_BYTES) throw new Error("File is too large");
    return { name: fileNameFromUrl(url, "download.bin"), base64: toB64(buf) };
  });
