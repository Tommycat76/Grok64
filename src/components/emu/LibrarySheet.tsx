import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import { Cloud, Disc3, FolderOpen, Play, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { CatalogPanel } from "./CatalogPanel";
import { BUNDLED } from "@/lib/emu/software";
import { ACCEPT_EXT, displayKindOf, isDiskKind, kindLabelFor } from "@/lib/emu/formats";
import { isReuImageName } from "@/lib/emu/reu-image";
import { validateCrtImport } from "@/lib/emu/cart-crt-diag";
import { isWorkDisk, listLibrary, putFile, removeFile, updateFileUnit } from "@/lib/emu/library";
import { importFromUrlResolved } from "@/lib/emu/import-url";
import { b64ToU8, explodeArchive, pickBootFile, toArrayBuffer } from "@/lib/emu/archive";
import { floppyInsertUnit } from "@/lib/emu/play-session";
import { useEmu } from "@/lib/emu/store";
import type { BundledTitle, LibraryItem } from "@/lib/emu/types";
import { IecUnitSeg } from "@/components/emu/IecUnitSeg";

interface Props {
  onPlayBundled: (title: BundledTitle) => void;
  onPlayLocal: (item: LibraryItem) => void;
  onInsert?: (item: LibraryItem) => void;
}

export function LibrarySheet({ onPlayBundled, onPlayLocal, onInsert }: Props) {
  const open = useEmu((s) => s.libraryOpen);
  const setOpen = useEmu((s) => s.setLibraryOpen);
  const library = useEmu((s) => s.library) ?? [];
  const setLibrary = useEmu((s) => s.setLibrary);
  const running = useEmu((s) => s.running);
  const iecMap = useEmu((s) => s.iecMap);
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const tab = useEmu((st) => st.libraryTab);
  const setTab = useEmu((st) => st.setLibraryTab);

  useEffect(() => {
    if (!open) return;
    void refresh().catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      setOpen(false);
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  async function refresh() {
    setLibrary(await listLibrary());
  }

  function runSaved(items: LibraryItem[]) {
    const pool = items.filter((i) => !isWorkDisk(i.name));
    const geos =
      pool.find((i) => /wheels/i.test(i.name) && /\.d64$/i.test(i.name)) ??
      pool.find((i) => /geos/i.test(i.name) && /\.d64$/i.test(i.name));
    const boot = geos ?? pickBootFile(pool);
    if (!boot) return false;
    setOpen(false);
    onPlayLocal(boot);
    return true;
  }

  async function ingest(files: FileList | File[], source: "local" | "cloud") {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    try {
      const saved: LibraryItem[] = [];
      for (const f of list) {
        const buf = new Uint8Array(await f.arrayBuffer());
        const parts = explodeArchive(f.name, buf);
        for (const part of parts) {
          const reject = validateCrtImport(part.data, part.name);
          if (reject) {
            toast.error(reject, { duration: 12_000 });
            continue;
          }
          saved.push(await putFile(part.name, toArrayBuffer(part.data), source));
        }
      }
      await refresh();
      toast.success(list.length === 1 ? `Saved ${list[0]!.name}` : `Saved ${list.length} files`);
      if (saved.length === 1 && !runSaved(saved)) setTab("library");
      else setTab("library");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not import");
    } finally {
      setBusy(false);
    }
  }

  async function fromUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await importFromUrlResolved(trimmed);
      const bin = b64ToU8(res.base64);
      const parts = explodeArchive(res.name, bin);
      const saved: LibraryItem[] = [];
      for (const part of parts) {
        const reject = validateCrtImport(part.data, part.name);
        if (reject) {
          toast.error(reject, { duration: 12_000 });
          continue;
        }
        saved.push(await putFile(part.name, toArrayBuffer(part.data), "cloud"));
      }
      await refresh();
      setUrl("");
      toast.success(`Saved ${res.name}`);
      if (saved.length === 1 && !runSaved(saved)) setTab("library");
      else setTab("library");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-[900] bg-black/60"
          onClick={() => setOpen(false)}
        />
        <Drawer.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
          <div className="g64-handle" />
          <Drawer.Title asChild>
            <h2>Software</h2>
          </Drawer.Title>
          <p className="lead">Search Assembly64 for games, carts, disks and SID — no links to paste. Tap Play and the file stays on this device so SAVE works.</p>

          <div className="g64-seg mb-3">
            <button
              type="button"
              data-on={tab === "catalog"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTab("catalog");
              }}
            >
              Catalog
            </button>
            <button
              type="button"
              data-on={tab === "library"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTab("library");
              }}
            >
              On this device{library.length ? ` · ${library.length}` : ""}
            </button>
          </div>

          {tab === "catalog" ? (
            <CatalogPanel
              onPlay={(item) => {
                setOpen(false);
                onPlayLocal(item);
              }}
              onInsert={
                onInsert
                  ? (item) => {
                      setOpen(false);
                      onInsert(item);
                    }
                  : undefined
              }
            />
          ) : (
            <>
              <div className="g64-actions">
                <button type="button" className="g64-btn g64-btn-primary" onClick={() => fileRef.current?.click()}>
                  <FolderOpen className="size-4" />
                  Files / Drive
                </button>
                <button type="button" className="g64-btn" onClick={() => fileRef.current?.click()}>
                  <Upload className="size-4" />
                  Import
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                accept={ACCEPT_EXT}
                multiple
                onChange={(e) => {
                  if (e.target.files) void ingest(e.target.files, "local");
                  e.target.value = "";
                }}
              />

              <div className="g64-field">
                <label htmlFor="cloud-url">Direct link</label>
                <div className="flex gap-2">
                  <input
                    id="cloud-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…/game.d64"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button type="button" className="g64-btn g64-btn-primary shrink-0" disabled={busy} onClick={() => void fromUrl()}>
                    <Cloud className="size-4" />
                    Fetch
                  </button>
                </div>
              </div>

              <p className="mb-2 text-xs tracking-wide text-fg-subtle uppercase">Bundled tests</p>
              <div className="g64-list">
                {BUNDLED.map((t) => (
                  <button key={t.id} type="button" className="g64-card" onClick={() => {
                    setOpen(false);
                    onPlayBundled(t);
                  }}>
                    <strong>{t.name}</strong>
                    <em className="g64-tag not-italic">{t.tag}</em>
                    <span>{t.blurb}</span>
                  </button>
                ))}
                {library.length > 0 ? (
                  <>
                    <p className="mt-2 text-xs tracking-wide text-fg-subtle uppercase">Saved on this device</p>
                    {library.map((item) => (
                      <div key={item.id} className="g64-card">
                        <button type="button" className="contents text-left" onClick={() => {
                          setOpen(false);
                          onPlayLocal(item);
                        }}>
                          <strong>{item.name}</strong>
                          <em className="g64-tag not-italic">{isReuImageName(item.name) ? "REU image" : kindLabelFor(item.name, item.kind)}</em>
                          <span>
                            {(item.size / 1024).toFixed(0)} KB ·{" "}
                            {item.source === "catalog" ? "Catalog" : item.source === "cloud" ? "Link" : "Imported"}
                          </span>
                        </button>
                        <div className="g64-card-tools">
                          {isDiskKind(displayKindOf(item.name, item.kind)) ? (
                            <IecUnitSeg
                              compact
                              value={item.iecUnit ?? floppyInsertUnit(iecMap, displayKindOf(item.name, item.kind))}
                              onChange={(unit) => {
                                void updateFileUnit(item.id, unit).then(refresh);
                              }}
                            />
                          ) : null}
                          <button
                            type="button"
                            className="g64-iconbtn"
                            aria-label={isDiskKind(displayKindOf(item.name, item.kind)) ? `Run ${item.name}` : `Play ${item.name}`}
                            onClick={() => {
                              setOpen(false);
                              onPlayLocal(item);
                            }}
                          >
                            <Play className="size-4" />
                          </button>
                          {onInsert && running && (isDiskKind(displayKindOf(item.name, item.kind)) || isReuImageName(item.name)) ? (
                            <button
                              type="button"
                              className="g64-iconbtn"
                              aria-label={`Insert ${item.name}`}
                              onClick={() => onInsert(item)}
                            >
                              <Disc3 className="size-4" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="g64-iconbtn"
                            aria-label={`Remove ${item.name}`}
                            onClick={() => {
                              void removeFile(item.id).then(refresh);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="px-1 text-sm text-fg-muted">Nothing saved yet. Grab a title from Catalog — it stays here so you can play again and SAVE to disk.</p>
                )}
              </div>
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
