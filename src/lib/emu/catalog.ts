import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { kindOf } from "./formats";
import { isJunkRelease } from "./archive";

export type CatalogKind = "all" | "games" | "carts" | "disks" | "sid" | "demos";

export interface CatalogHit {
  key: string;
  title: string;
  subtitle: string;
  source: "a64" | "ia" | "hvsc";
  kindHint: string;
  year?: number;
  a64?: { itemId: string; category: number };
  ia?: { identifier: string };
  hvsc?: { path: string; url: string };
}

export interface CatalogFile {
  name: string;
  size: number;
  url?: string;
  a64?: { itemId: string; category: number; fileId: string };
}

export const KIND_CHIPS: { id: CatalogKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "games", label: "Games" },
  { id: "carts", label: "Carts" },
  { id: "disks", label: "Disks" },
  { id: "sid", label: "SID" },
  { id: "demos", label: "Demos" },
];

function hvsc(path: string) {
  return { path, url: `https://hvsc.de/download/C64Music/${path}` };
}

export const FEATURED_SIDS: CatalogHit[] = [
  { key: "hvsc-commando", title: "Commando", subtitle: "Rob Hubbard · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/H/Hubbard_Rob/Commando.sid") },
  { key: "hvsc-monty", title: "Monty on the Run", subtitle: "Rob Hubbard · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid") },
  { key: "hvsc-ik", title: "International Karate", subtitle: "Rob Hubbard · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/H/Hubbard_Rob/International_Karate.sid") },
  { key: "hvsc-sanxion", title: "Sanxion", subtitle: "Rob Hubbard · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/H/Hubbard_Rob/Sanxion.sid") },
  { key: "hvsc-delta", title: "Delta", subtitle: "Rob Hubbard · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/H/Hubbard_Rob/Delta.sid") },
  { key: "hvsc-wizball", title: "Wizball", subtitle: "Martin Galway · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/G/Galway_Martin/Wizball.sid") },
  { key: "hvsc-comic", title: "Comic Bakery", subtitle: "Martin Galway · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/G/Galway_Martin/Comic_Bakery.sid") },
  { key: "hvsc-ocean1", title: "Ocean Loader 1", subtitle: "Martin Galway · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/G/Galway_Martin/Ocean_Loader_1.sid") },
  { key: "hvsc-greenberet", title: "Green Beret", subtitle: "Martin Galway · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/G/Galway_Martin/Green_Beret.sid") },
  { key: "hvsc-parallax", title: "Parallax", subtitle: "Martin Galway · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/G/Galway_Martin/Parallax.sid") },
  { key: "hvsc-cybernoid", title: "Cybernoid", subtitle: "Jeroen Tel · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/T/Tel_Jeroen/Cybernoid.sid") },
  { key: "hvsc-cybernoid2", title: "Cybernoid II", subtitle: "Jeroen Tel · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/T/Tel_Jeroen/Cybernoid_II.sid") },
  { key: "hvsc-turbo", title: "Turbo Outrun", subtitle: "Jeroen Tel · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/T/Tel_Jeroen/Turbo_Outrun.sid") },
  { key: "hvsc-myth", title: "Myth", subtitle: "Jeroen Tel · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/T/Tel_Jeroen/Myth.sid") },
  { key: "hvsc-giana", title: "The Great Giana Sisters", subtitle: "Chris Hülsbeck · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid") },
  { key: "hvsc-rtype", title: "R-Type", subtitle: "Chris Hülsbeck · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/H/Huelsbeck_Chris/R-Type.sid") },
  { key: "hvsc-ghouls", title: "Ghouls 'n' Ghosts", subtitle: "Tim Follin · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/F/Follin_Tim/Ghouls_n_Ghosts.sid") },
  { key: "hvsc-bionic", title: "Bionic Commando", subtitle: "Tim Follin · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/F/Follin_Tim/Bionic_Commando.sid") },
  { key: "hvsc-ninja", title: "The Last Ninja", subtitle: "Ben Daglish · HVSC", source: "hvsc", kindHint: "sid", hvsc: hvsc("MUSICIANS/D/Daglish_Ben/Last_Ninja.sid") },
];

const GAME_CLASSICS = [
  "Boulder Dash",
  "Impossible Mission",
  "Paradroid",
  "Uridium",
  "The Last Ninja",
  "International Karate",
  "Wizball",
  "Turrican",
  "The Great Giana Sisters",
  "Commando",
  "Elite",
  "Ghostbusters",
  "Summer Games",
  "Creatures",
  "Mayhem in Monsterland",
  "M.U.L.E.",
  "Archon",
  "California Games",
];

const CART_CLASSICS = [
  "The Last Ninja",
  "Turrican",
  "Super Snapshot",
  "Action Replay",
  "Epyx Fast Load",
  "Winter Games",
  "Summer Games",
  "International Karate",
  "Boulder Dash",
  "Impossible Mission",
];

const A64 = "https://hackerswithstyle.se/leet";
const A64_IDS = ["assembly64", "ultimate", "Spiffy"];
const MAX_FILE = 6 * 1024 * 1024;
const C64_FILE = /\.(prg|p00|d64|d71|d81|g64|g71|t64|tap|crt|bin|sid|zip)$/i;
const TIMEOUT = 15000;

let a64Client: string | null = null;

function sanitizeQuery(raw: string) {
  return raw.replace(/["()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function aqlFor(query: string, kind: CatalogKind): string {
  const q = sanitizeQuery(query);
  const name = q ? `(name:"${q}")` : "";
  const type: Record<CatalogKind, string> = {
    all: "",
    games: "(category:games)",
    carts: "(type:crt)",
    disks: "(type:d64)",
    sid: "(type:sid)",
    demos: "(category:demos)",
  };
  const extra = type[kind];
  if (name && extra) return `${name} & ${extra}`;
  return name || extra || "(category:games)";
}

interface A64Item {
  name?: string;
  id?: string;
  category?: number;
  group?: string;
  year?: number;
  handle?: string;
}

function kindHintFor(kind: CatalogKind, name: string, category?: number): string {
  if (kind === "sid" || /\.sid$/i.test(name)) return "sid";
  if (kind === "carts" || category === 10 || /\.crt$/i.test(name)) return "crt";
  if (kind === "demos") return "prg";
  return "d64";
}

async function a64Fetch(path: string, accept = "application/json"): Promise<Response> {
  const ids = a64Client ? [a64Client, ...A64_IDS.filter((id) => id !== a64Client)] : A64_IDS;
  let last: Response | null = null;
  for (const id of ids) {
    const res = await fetch(`${A64}${path}`, {
      headers: { "client-id": id, Accept: accept, "User-Agent": "Grok64Emu/1.0" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 464) {
      last = res;
      continue;
    }
    if (res.ok) a64Client = id;
    return res;
  }
  return last ?? new Response(JSON.stringify({ error: "Assembly64 unavailable" }), { status: 464 });
}

function mapA64(rows: A64Item[], kind: CatalogKind): CatalogHit[] {
  return rows
    .filter((r) => r.id && r.name)
    .map((r) => {
      const cat = r.category ?? 0;
      const bits = [r.group, r.handle, r.year ? String(r.year) : "", "Assembly64"].filter(Boolean);
      return {
        key: `a64-${cat}-${r.id}`,
        title: r.name!,
        subtitle: bits.join(" · "),
        source: "a64" as const,
        kindHint: kindHintFor(kind, r.name!, cat),
        year: r.year && r.year > 1970 ? r.year : undefined,
        a64: { itemId: String(r.id), category: cat },
      };
    });
}

async function searchAssembly64(query: string, kind: CatalogKind, offset = 0, count = 24): Promise<CatalogHit[]> {
  const aql = aqlFor(query, kind);
  const url = `/search/aql/${offset}/${count}?query=${encodeURIComponent(aql)}`;
  const res = await a64Fetch(url);
  if (!res.ok) throw new Error(`Assembly64 search failed (${res.status})`);
  const rows = (await res.json()) as A64Item[];
  if (!Array.isArray(rows)) return [];
  return mapA64(rows, kind);
}

function pickNamed(rows: CatalogHit[], names: string[]): CatalogHit[] {
  const hits: CatalogHit[] = [];
  const used = new Set<string>();
  for (const name of names) {
    const nl = name.toLowerCase();
    const ranked = rows
      .filter((r) => !used.has(r.key))
      .map((r) => {
        const n = r.title.toLowerCase();
        let score = 99;
        if (n === nl) score = 0;
        else if (n.startsWith(nl)) score = 1;
        else if (n.includes(nl)) score = 2 + n.length / 100;
        else return null;
        if (/preview/i.test(n)) score += 8;
        if (isJunkRelease(n) && !isJunkRelease(nl)) score += 25;
        if (/first[\s._-]*star|original|\((?:usa|us)\)|1984/.test(n)) score -= 1;
        return { r, score };
      })
      .filter((x): x is { r: CatalogHit; score: number } => Boolean(x))
      .sort((a, b) => a.score - b.score);
    const best = ranked[0]?.r;
    if (best) {
      used.add(best.key);
      hits.push(best);
    }
  }
  return hits;
}

async function searchClassics(kind: CatalogKind): Promise<CatalogHit[]> {
  const names = kind === "carts" ? CART_CLASSICS : GAME_CLASSICS;
  const extra =
    kind === "carts" ? "(type:crt)" : kind === "disks" ? "(type:d64)" : "(category:games)";
  const mappedKind: CatalogKind = kind === "all" ? "games" : kind;
  const lists = await Promise.all(
    names.map(async (name) => {
      const aql = `(name:"${name}") & ${extra}`;
      try {
        const url = `/search/aql/0/16?query=${encodeURIComponent(aql)}`;
        const res = await a64Fetch(url);
        if (!res.ok) return [] as CatalogHit[];
        const rows = (await res.json()) as A64Item[];
        if (!Array.isArray(rows)) return [];
        return pickNamed(mapA64(rows, mappedKind), [name]);
      } catch {
        return [] as CatalogHit[];
      }
    }),
  );
  return lists.flat();
}

async function listAssembly64Files(itemId: string, category: number): Promise<CatalogFile[]> {
  const res = await a64Fetch(`/search/entries/${encodeURIComponent(itemId)}/${category}`);
  if (!res.ok) throw new Error(`Could not list Assembly64 files (${res.status})`);
  const body = (await res.json()) as { contentEntry?: { path?: string; id?: number; size?: number }[] };
  const entries = body.contentEntry ?? [];
  const files = entries
    .filter((e) => e.path && C64_FILE.test(e.path) && (e.size ?? 0) <= MAX_FILE)
    .map((e) => ({
      name: (e.path ?? "file").split("/").pop() ?? "file",
      size: e.size ?? 0,
      a64: { itemId, category, fileId: String(e.id ?? "") },
    }));
  if (files.length) return files;
  return [
    {
      name: `${itemId}.zip`,
      size: 0,
      a64: { itemId, category, fileId: "__zip__" },
    },
  ];
}

function iaQuery(query: string, kind: CatalogKind): string {
  const q = sanitizeQuery(query);
  const title = q ? `AND title:(${q})` : "";
  if (kind === "sid") return `mediatype:software AND format:SID ${title}`.trim();
  if (kind === "carts") {
    return `collection:softwarelibrary_c64 AND mediatype:software ${title || "AND (title:cart OR title:cartridge OR title:crt)"}`;
  }
  if (kind === "demos") {
    return `collection:softwarelibrary_c64 AND mediatype:software ${title || "AND title:demo"}`;
  }
  return `collection:softwarelibrary_c64 AND mediatype:software ${title}`.trim();
}

async function searchInternetArchiveRaw(query: string, kind: CatalogKind, offset = 0): Promise<CatalogHit[]> {
  if (kind === "sid") return [];
  const params = new URLSearchParams();
  params.set("q", iaQuery(query, kind));
  for (const fl of ["identifier", "title", "downloads", "year"]) params.append("fl[]", fl);
  params.append("sort[]", "downloads desc");
  params.set("rows", "20");
  params.set("start", String(offset));
  params.set("output", "json");
  const res = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, {
    headers: { Accept: "application/json", "User-Agent": "Grok64Emu/1.0" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Archive search failed (${res.status})`);
  const json = (await res.json()) as {
    response?: { docs?: { identifier?: string; title?: string; downloads?: number; year?: string | number }[] };
  };
  const docs = json.response?.docs ?? [];
  return docs
    .filter((d) => d.identifier && d.title)
    .map((d) => {
      const ident = d.identifier!;
      return {
        key: `ia-${ident}`,
        title: String(d.title).replace(/\s+\(\d{4}.*$/, ""),
        subtitle: [d.year, "Internet Archive"].filter(Boolean).join(" · "),
        source: "ia" as const,
        kindHint: kind === "carts" ? "crt" : "d64",
        year: typeof d.year === "number" ? d.year : Number(d.year) || undefined,
        ia: { identifier: ident },
      } satisfies CatalogHit;
    });
}

async function listInternetArchiveRaw(identifier: string): Promise<CatalogFile[]> {
  const id = identifier.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!id) throw new Error("Bad archive id.");
  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json", "User-Agent": "Grok64Emu/1.0" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Archive listing failed (${res.status})`);
  const json = (await res.json()) as { files?: { name?: string; size?: string | number }[] };
  return (json.files ?? [])
    .filter((f) => f.name && C64_FILE.test(f.name))
    .map((f) => {
      const size = Number(f.size ?? 0);
      return {
        name: (f.name ?? "file").split("/").pop() ?? "file",
        size,
        url: `https://archive.org/download/${encodeURIComponent(id)}/${f.name!.split("/").map(encodeURIComponent).join("/")}`,
      } satisfies CatalogFile;
    })
    .filter((f) => f.size <= MAX_FILE && kindOf(f.name) !== "unknown");
}

function mergeHits(parts: CatalogHit[][]): CatalogHit[] {
  const seen = new Set<string>();
  const hits: CatalogHit[] = [];
  for (const list of parts) {
    for (const hit of list) {
      const k = `${hit.kindHint}:${hit.title.toLowerCase()}`;
      if (seen.has(hit.key) || seen.has(k)) continue;
      seen.add(hit.key);
      seen.add(k);
      hits.push(hit);
    }
  }
  return hits;
}

const PINNED_PLAYABLE: CatalogHit[] = [
  {
    key: "ia-Boulder_Dash_1984_First_Star_cr_Nova",
    title: "Boulder Dash",
    subtitle: "1984 · First Star Software · Internet Archive",
    source: "ia",
    kindHint: "d64",
    year: 1984,
    ia: { identifier: "Boulder_Dash_1984_First_Star_cr_Nova" },
  },
];

function pinPlayable(query: string, kind: CatalogKind, hits: CatalogHit[]): CatalogHit[] {
  if (kind === "sid") return hits;
  const q = query.trim().toLowerCase();
  const wantBd = !q || /boulder\s*dash/.test(q);
  if (!wantBd) return hits;
  return mergeHits([PINNED_PLAYABLE, hits]);
}

function rankCatalogHits(query: string, hits: CatalogHit[]): CatalogHit[] {
  const q = query.trim().toLowerCase();
  return [...hits].sort((a, b) => {
    const score = (hit: CatalogHit) => {
      const n = hit.title.toLowerCase();
      let s = 50;
      if (hit.key === "ia-Boulder_Dash_1984_First_Star_cr_Nova") s -= 20;
      if (q) {
        if (n === q) s -= 10;
        else if (n.startsWith(q)) s -= 5;
        else if (n.includes(q)) s -= 2;
      }
      if (isJunkRelease(hit.title) && (!q || !isJunkRelease(q))) s += 30;
      if (/first[\s._-]*star|1984|\((?:usa|us)\)/.test(`${hit.title} ${hit.subtitle}`)) s -= 3;
      return s;
    };
    return score(a) - score(b);
  });
}

function filterSids(query: string): CatalogHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return FEATURED_SIDS;
  return FEATURED_SIDS.filter((s) => `${s.title} ${s.subtitle}`.toLowerCase().includes(q));
}

const KindEnum = z.enum(["all", "games", "carts", "disks", "sid", "demos"]);

export const searchCatalog = createServerFn({ method: "POST" })
  .validator(
    z.object({
      query: z.string().max(120),
      kind: KindEnum,
      offset: z.number().int().min(0).max(400).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const q = data.query.trim();
    const kind = data.kind;
    const jobs: Promise<CatalogHit[]>[] = [];
    let a64ok = false;

    if (kind === "sid" || kind === "all") {
      jobs.push(Promise.resolve(kind === "sid" || !q ? filterSids(q) : filterSids(q).slice(0, 4)));
    }

    if (!q && (kind === "games" || kind === "carts" || kind === "disks" || kind === "all")) {
      jobs.push(
        searchClassics(kind === "all" ? "games" : kind)
          .then((rows) => {
            a64ok = true;
            return rows;
          })
          .catch(() => [] as CatalogHit[]),
      );
    } else {
      jobs.push(
        searchAssembly64(q, kind)
          .then((rows) => {
            a64ok = true;
            return rows;
          })
          .catch(() => [] as CatalogHit[]),
      );
    }

    if (kind !== "sid") {
      jobs.push(searchInternetArchiveRaw(q, kind, data.offset ?? 0).catch(() => [] as CatalogHit[]));
    }

    const parts = await Promise.all(jobs);
    const hits = rankCatalogHits(q, pinPlayable(q, kind, mergeHits(parts)));
    return { hits, a64: a64ok };
  });

const HitSchema = z.object({
  key: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  source: z.enum(["a64", "ia", "hvsc"]),
  kindHint: z.string().optional(),
  year: z.number().optional(),
  a64: z.object({ itemId: z.string(), category: z.number() }).optional(),
  ia: z.object({ identifier: z.string() }).optional(),
  hvsc: z.object({ path: z.string(), url: z.string() }).optional(),
});

export const listCatalogFiles = createServerFn({ method: "POST" })
  .validator(HitSchema)
  .handler(async ({ data }) => {
    if (data.hvsc) {
      const name = data.hvsc.path.split("/").pop() ?? "tune.sid";
      return [{ name, size: 0, url: data.hvsc.url }] satisfies CatalogFile[];
    }
    if (data.ia) return listInternetArchiveRaw(data.ia.identifier);
    if (data.a64) return listAssembly64Files(data.a64.itemId, data.a64.category);
    return [] as CatalogFile[];
  });

export const downloadCatalogFile = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().min(1).max(240),
      url: z.string().optional(),
      a64: z
        .object({
          itemId: z.string().min(1).max(80),
          category: z.number().int().min(0).max(99),
          fileId: z.string().min(1).max(80),
        })
        .optional(),
    }),
  )
  .handler(async ({ data }) => {
    let buf: Uint8Array;
    let name = data.name;
    if (data.a64) {
      const { itemId, category, fileId } = data.a64;
      const path =
        fileId === "__zip__"
          ? `/search/zip/${encodeURIComponent(itemId)}/${category}`
          : `/search/bin/${encodeURIComponent(itemId)}/${category}/${encodeURIComponent(fileId)}`;
      const res = await a64Fetch(path, "application/octet-stream");
      if (!res.ok) throw new Error(`Assembly64 download failed (${res.status})`);
      buf = new Uint8Array(await res.arrayBuffer());
    } else if (data.url && /^https?:\/\//i.test(data.url)) {
      const target = new URL(data.url);
      if (/^(localhost|127\.|10\.|192\.168\.|0\.|169\.254\.)/i.test(target.hostname)) {
        throw new Error("That address cannot be fetched.");
      }
      const res = await fetch(target.toString(), {
        headers: { Accept: "application/octet-stream,*/*", "User-Agent": "Grok64Emu/1.0" },
        signal: AbortSignal.timeout(TIMEOUT),
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      buf = new Uint8Array(await res.arrayBuffer());
      const cd = res.headers.get("content-disposition")?.match(/filename\*?=(?:UTF-8'')?["']?([^";]+)["']?/i);
      if (cd?.[1]) name = decodeURIComponent(cd[1]);
    } else {
      throw new Error("No download for that file.");
    }
    if (buf.byteLength > MAX_FILE) throw new Error("File is larger than 6 MB.");
    if (buf.byteLength < 16) throw new Error("File was empty.");
    const magic = String.fromCharCode(buf[0] ?? 0, buf[1] ?? 0, buf[2] ?? 0, buf[3] ?? 0);
    if (magic.startsWith("<!do") || magic.startsWith("<htm") || magic.startsWith("{")) {
      throw new Error("Got a web page instead of a C64 file.");
    }
    return { name, base64: Buffer.from(buf).toString("base64"), size: buf.byteLength };
  });

export const SOURCE_LABEL: Record<CatalogHit["source"], string> = {
  a64: "Assembly64",
  ia: "Archive",
  hvsc: "HVSC",
};
