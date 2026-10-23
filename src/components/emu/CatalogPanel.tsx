import { useEffect, useRef, useState } from "react";
import { Disc3, Download, Loader2, Play, Search } from "lucide-react";
import { toast } from "sonner";
import {
  KIND_CHIPS,
  SOURCE_LABEL,
  listCatalogFiles,
  listCatalogFilesClient,
  searchCatalog,
  searchCatalogClient,
  downloadCatalogFile,
  downloadCatalogFileClient,
  type CatalogFile,
  type CatalogHit,
  type CatalogKind,
} from "@/lib/emu/catalog";
import { explodeArchive, pickBootFile, toArrayBuffer, b64ToU8 } from "@/lib/emu/archive";
import { listLibrary, putFile } from "@/lib/emu/library";
import { regionBadge } from "@/lib/emu/region";
import { useEmu } from "@/lib/emu/store";
import type { LibraryItem } from "@/lib/emu/types";

interface Props {
  onPlay: (item: LibraryItem, meta?: { catalogKey: string; title: string }) => void;
  onInsert?: (item: LibraryItem) => void;
}

async function fetchRemote(
  file: CatalogFile,
  signal?: AbortSignal,
): Promise<{ name: string; data: Uint8Array }> {
  const payload = {
    name: file.name,
    ...(file.url ? { url: file.url } : {}),
    ...(file.a64 ? { a64: file.a64 } : {}),
  };
  try {
    const res = await downloadCatalogFileClient(payload, { signal });
    return { name: res.name || file.name, data: b64ToU8(res.base64) };
  } catch {
    /* static Plex hosts have no serverFn — try legacy path when client fetch fails */
  }
  try {
    const res = await downloadCatalogFile({ data: payload });
    return { name: res.name || file.name, data: b64ToU8(res.base64) };
  } catch (err) {
    throw err instanceof Error ? err : new Error("Download failed");
  }
}

export function CatalogPanel({ onPlay, onInsert }: Props) {
  const setLibrary = useEmu((s) => s.setLibrary);
  const running = useEmu((s) => s.running);
  const [kind, setKind] = useState<CatalogKind>("games");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [a64, setA64] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, CatalogFile[]>>({});
  const boot = useRef(false);
  const downloadAbort = useRef<AbortController | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const searchGen = useRef(0);
  const libraryOpen = useEmu((s) => s.libraryOpen);

  useEffect(() => {
    if (!libraryOpen) {
      downloadAbort.current?.abort();
      downloadAbort.current = null;
    }
  }, [libraryOpen]);

  async function runSearch(q: string, k: CatalogKind) {
    const gen = ++searchGen.current;
    searchAbort.current?.abort();
    searchAbort.current = new AbortController();
    setSearching(true);
    setHits([]);
    setOpenKey(null);
    try {
      let res;
      try {
        res = await searchCatalog({ data: { query: q, kind: k } });
      } catch {
        res = await searchCatalogClient({ query: q, kind: k }, { signal: searchAbort.current.signal });
      }
      if (gen !== searchGen.current) return;
      setHits(res.hits);
      setA64(res.a64);
    } catch (err) {
      if (gen !== searchGen.current) return;
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Search failed");
      setHits([]);
    } finally {
      if (gen === searchGen.current) setSearching(false);
    }
  }

  useEffect(() => {
    if (!boot.current) {
      boot.current = true;
      void runSearch("", "games");
    }
  }, []);

  const scheduleRef = useRef<number | null>(null);
  function schedule(q: string, k: CatalogKind) {
    if (scheduleRef.current) window.clearTimeout(scheduleRef.current);
    setHits([]);
    setSearching(true);
    scheduleRef.current = window.setTimeout(() => void runSearch(q, k), 380);
  }

  async function refresh() {
    setLibrary(await listLibrary());
  }

  async function ingest(
    file: CatalogFile,
    mode: "play" | "save" | "insert",
    catalogKey: string,
    catalogTitle: string,
  ) {
    downloadAbort.current?.abort();
    downloadAbort.current = new AbortController();
    const signal = downloadAbort.current.signal;
    const got = await fetchRemote(file, signal);
    const parts = explodeArchive(got.name, got.data);
    const chosen = pickBootFile(parts, catalogTitle || file.name) ?? parts[0];
    if (!chosen) throw new Error("No C64 file in that download.");
    let first: LibraryItem | null = null;
    for (const part of parts) {
      const item = await putFile(part.name, toArrayBuffer(part.data), "catalog", {
        catalogKey,
        catalogTitle,
      });
      if (!first || part.name === chosen.name) first = item;
    }
    await refresh();
    toast.success(parts.length > 1 ? `Saved ${parts.length} files on this device` : `Saved ${chosen.name} on this device`);
    if (mode === "play" && first) onPlay(first, { catalogKey, title: catalogTitle });
    if (mode === "insert" && first) onInsert?.(first);
    return first;
  }

  async function grabHit(hit: CatalogHit, mode: "play" | "save" | "insert") {
    const token = hit.key;
    setBusyKey(hit.key);
    try {
      let list = files[hit.key];
      if (!list) {
        try {
          list = await listCatalogFiles({ data: hit });
        } catch {
          list = await listCatalogFilesClient(hit);
        }
        setFiles((m) => ({ ...m, [hit.key]: list! }));
      }
      if (list.length > 1 && mode !== "play") {
        setOpenKey(hit.key);
        return;
      }
      const bootFile = pickBootFile(list, hit.title);
      if (!bootFile) throw new Error("No disk, cart or SID in that release.");
      if (list.length > 1) setOpenKey(hit.key);
      await ingest(bootFile, mode, token, hit.title);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusyKey(null);
    }
  }

  async function grabFile(hit: CatalogHit, file: CatalogFile, mode: "play" | "save" | "insert") {
    setBusyKey(`${hit.key}:${file.name}`);
    try {
      await ingest(file, mode, hit.key, hit.title);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="g64-catalog">
      <form
        className="g64-search"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(query, kind);
        }}
      >
        <Search className="g64-search-icon" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            schedule(e.target.value, kind);
          }}
          placeholder="Boulder Dash, Last Ninja, Hubbard…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        <button type="submit" className="g64-btn g64-btn-primary shrink-0" disabled={searching}>
          {searching ? <Loader2 className="size-4 animate-spin" /> : "Go"}
        </button>
      </form>

      <div className="g64-chips" role="tablist" aria-label="Catalog type">
        {KIND_CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={kind === c.id}
            data-on={kind === c.id}
            onClick={() => {
              setKind(c.id);
              setHits([]);
              void runSearch(query, c.id);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <p className="g64-catalog-note">
        {a64
          ? "Assembly64, HVSC and the Internet Archive. Tap Play — the file stays on this device so disks can SAVE."
          : "Searching HVSC and the Internet Archive. Assembly64 joins when the network allows."}
      </p>

      {searching && hits.length === 0 ? (
        <p className="px-1 text-sm text-fg-muted">Searching…</p>
      ) : null}

      <div className="g64-list">
        {hits.length === 0 && !searching ? (
          <p className="px-1 text-sm text-fg-muted">No matches. Try Boulder Dash, a composer, or import a file on the Library tab.</p>
        ) : null}
        {hits.map((hit) => {
          const open = openKey === hit.key;
          const list = files[hit.key] ?? [];
          const busy = busyKey === hit.key;
          const region = regionBadge(hit.title);
          return (
            <div key={hit.key} className="g64-card g64-hit">
              <button type="button" className="g64-hit-main" onClick={() => void grabHit(hit, "play")}>
                <strong>{hit.title}</strong>
                <em className="g64-tag not-italic">{SOURCE_LABEL[hit.source]}</em>
                {region ? <em className="g64-tag g64-tag-region not-italic">{region}</em> : null}
                <span>{hit.subtitle}</span>
              </button>
              <div className="g64-hit-actions">
                <button
                  type="button"
                  className="g64-iconbtn"
                  aria-label={`Play ${hit.title}`}
                  disabled={Boolean(busyKey)}
                  onClick={() => void grabHit(hit, "play")}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                </button>
                {onInsert && running ? (
                  <button
                    type="button"
                    className="g64-iconbtn"
                    aria-label={`Insert ${hit.title}`}
                    disabled={Boolean(busyKey)}
                    onClick={() => void grabHit(hit, "insert")}
                  >
                    <Disc3 className="size-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="g64-iconbtn"
                  aria-label={`Save ${hit.title}`}
                  disabled={Boolean(busyKey)}
                  onClick={() => void grabHit(hit, "save")}
                >
                  <Download className="size-4" />
                </button>
              </div>
              {open && list.length > 1 ? (
                <div className="g64-filelist">
                  {list.map((f) => (
                    <div key={f.name} className="g64-filerow">
                      <span>
                        {f.name}
                        {f.size ? ` · ${(f.size / 1024).toFixed(0)} KB` : ""}
                      </span>
                      <button
                        type="button"
                        className="g64-btn"
                        disabled={Boolean(busyKey)}
                        onClick={() => void grabFile(hit, f, "play")}
                      >
                        Play
                      </button>
                      {onInsert && running ? (
                        <button
                          type="button"
                          className="g64-btn"
                          disabled={Boolean(busyKey)}
                          onClick={() => void grabFile(hit, f, "insert")}
                        >
                          Insert
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
