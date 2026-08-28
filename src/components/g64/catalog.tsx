import { useEffect, useRef, useState } from "react";
import { Disc3, Download, LoaderCircle, Play, Search } from "lucide-react";
import { toast } from "sonner";
import { CATALOG_KINDS, SOURCE_LABEL, type CatalogFile, type CatalogHit, type CatalogKind } from "@/lib/g64/catalog";
import { downloadCatalog, listRelease, searchCatalog } from "@/lib/g64/catalogFns";
import { expandArchive, fromBase64, pickBootFile, toArrayBuffer } from "@/lib/g64/files";
import { listLibrary, putFile } from "@/lib/g64/idb";
import type { LibraryItem } from "@/lib/g64/store";
import { useG64 } from "@/lib/g64/store";

export function CatalogPane({
  onPlay,
  onInsert,
}: {
  onPlay: (item: LibraryItem) => void;
  onInsert?: (item: LibraryItem) => void;
}) {
  const setLibrary = useG64((s) => s.setLibrary);
  const running = useG64((s) => s.running);
  const [kind, setKind] = useState<CatalogKind>("games");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [a64, setA64] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, CatalogFile[]>>({});
  const debounce = useRef<number | null>(null);
  const started = useRef(false);

  async function search(q: string, k: CatalogKind) {
    setBusy(true);
    try {
      const res = await searchCatalog({ data: { query: q, kind: k } });
      setHits(res.hits);
      setA64(res.a64);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void search("", "games");
  }, []);

  function onQuery(q: string, k: CatalogKind) {
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void search(q, k), 380);
  }

  async function refresh() {
    setLibrary(await listLibrary());
  }

  async function saveAndAct(file: CatalogFile, action: "play" | "insert" | "save") {
    const dl = await downloadCatalog({
      data: {
        name: file.name,
        ...(file.url ? { url: file.url } : {}),
        ...(file.a64 ? { a64: file.a64 } : {}),
      },
    });
    const buf = fromBase64(dl.base64);
    const expanded = expandArchive(dl.name || file.name, buf);
    const boot = pickBootFile(expanded) ?? expanded[0];
    if (!boot) throw new Error("No C64 file in that download.");
    let saved: LibraryItem | null = null;
    for (const f of expanded) {
      const item = await putFile(f.name, toArrayBuffer(f.data), "catalog");
      if (!saved || f.name === boot.name) saved = item;
    }
    await refresh();
    toast.success(
      expanded.length > 1 ? `Saved ${expanded.length} files on this device` : `Saved ${boot.name} on this device`,
    );
    if (action === "play" && saved) onPlay(saved);
    if (action === "insert" && saved) onInsert?.(saved);
    return saved;
  }

  async function onHit(hit: CatalogHit, action: "play" | "insert" | "save") {
    setLoadingKey(hit.key);
    try {
      let list = files[hit.key];
      if (!list) {
        list = await listRelease({ data: hit });
        setFiles((prev) => ({ ...prev, [hit.key]: list! }));
      }
      if (list.length > 1 && action !== "play") {
        setOpenKey(hit.key);
        return;
      }
      const boot = pickBootFile(list);
      if (!boot) throw new Error("No disk, cart or SID in that release.");
      if (list.length > 1) setOpenKey(hit.key);
      await saveAndAct(boot, action);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setLoadingKey(null);
    }
  }

  async function onFile(hit: CatalogHit, file: CatalogFile, action: "play" | "insert" | "save") {
    setLoadingKey(`${hit.key}:${file.name}`);
    try {
      await saveAndAct(file, action);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <div className="g64-catalog">
      <form
        className="g64-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query, kind);
        }}
      >
        <Search className="g64-search-icon" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onQuery(e.target.value, kind);
          }}
          placeholder="Boulder Dash, Last Ninja, Hubbard…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        <button type="submit" className="g64-btn g64-btn-primary shrink-0" disabled={busy}>
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : "Go"}
        </button>
      </form>
      <div className="g64-chips" role="tablist" aria-label="Catalog type">
        {CATALOG_KINDS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={kind === c.id}
            data-on={kind === c.id}
            onClick={() => {
              setKind(c.id);
              void search(query, c.id);
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
      <div className="g64-list">
        {hits.length === 0 && !busy ? (
          <p className="px-1 text-sm text-fg-muted">
            No matches. Try Boulder Dash, a composer, or import a file on the Library tab.
          </p>
        ) : null}
        {hits.map((hit) => {
          const open = openKey === hit.key;
          const list = files[hit.key] ?? [];
          const loading = loadingKey === hit.key;
          return (
            <div key={hit.key} className="g64-card g64-hit">
              <button type="button" className="g64-hit-main" onClick={() => void onHit(hit, "play")}>
                <strong>{hit.title}</strong>
                <em className="g64-tag not-italic">{SOURCE_LABEL[hit.source]}</em>
                <span>{hit.subtitle}</span>
              </button>
              <div className="g64-hit-actions">
                <button
                  type="button"
                  className="g64-iconbtn"
                  aria-label={`Play ${hit.title}`}
                  disabled={!!loadingKey}
                  onClick={() => void onHit(hit, "play")}
                >
                  {loading ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
                </button>
                {onInsert && running ? (
                  <button
                    type="button"
                    className="g64-iconbtn"
                    aria-label={`Insert ${hit.title}`}
                    disabled={!!loadingKey}
                    onClick={() => void onHit(hit, "insert")}
                  >
                    <Disc3 className="size-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="g64-iconbtn"
                  aria-label={`Save ${hit.title}`}
                  disabled={!!loadingKey}
                  onClick={() => void onHit(hit, "save")}
                >
                  <Download className="size-4" />
                </button>
              </div>
              {open && list.length > 1 ? (
                <div className="g64-filelist">
                  {list.map((file) => (
                    <div key={file.name} className="g64-filerow">
                      <span>
                        {file.name}
                        {file.size ? ` · ${(file.size / 1024).toFixed(0)} KB` : ""}
                      </span>
                      <button
                        type="button"
                        className="g64-btn"
                        disabled={!!loadingKey}
                        onClick={() => void onFile(hit, file, "play")}
                      >
                        Play
                      </button>
                      {onInsert && running ? (
                        <button
                          type="button"
                          className="g64-btn"
                          disabled={!!loadingKey}
                          onClick={() => void onFile(hit, file, "insert")}
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
