import { useRef, useState } from "react";
import { Drawer } from "vaul";
import { Cloud, Disc3, FolderOpen, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { CatalogPanel } from "./CatalogPanel";
import { BUNDLED } from "@/lib/emu/software";
import { ACCEPT_EXT, KIND_LABEL, isDiskKind } from "@/lib/emu/formats";
import { listLibrary, putFile, removeFile } from "@/lib/emu/library";
import { importFromUrl } from "@/lib/emu/import-url";
import { b64ToU8, explodeArchive, toArrayBuffer } from "@/lib/emu/archive";
import { useEmu } from "@/lib/emu/store";
import type { BundledTitle, LibraryItem } from "@/lib/emu/types";

interface Props {
  onPlayBundled: (title: BundledTitle) => void;
  onPlayLocal: (item: LibraryItem) => void;
  onInsert?: (item: LibraryItem) => void;
}

export function LibrarySheet({ onPlayBundled, onPlayLocal, onInsert }: Props) {
  const open = useEmu((s) => s.libraryOpen);
  const setOpen = useEmu((s) => s.setLibraryOpen);
  const library = useEmu((s) => s.library);
  const setLibrary = useEmu((s) => s.setLibrary);
  const running = useEmu((s) => s.running);
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"catalog" | "library">("catalog");

  async function refresh() {
    setLibrary(await listLibrary());
  }

  async function ingest(files: FileList | File[], source: "local" | "cloud") {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    try {
      for (const f of list) {
        const buf = new Uint8Array(await f.arrayBuffer());
        const parts = explodeArchive(f.name, buf);
        for (const part of parts) {
          await putFile(part.name, toArrayBuffer(part.data), source);
        }
      }
      await refresh();
      toast.success(list.length === 1 ? `Saved ${list[0]!.name}` : `Saved ${list.length} files`);
      setTab("library");
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
      const res = await importFromUrl({ data: { url: trimmed } });
      const bin = b64ToU8(res.base64);
      const parts = explodeArchive(res.name, bin);
      for (const part of parts) {
        await putFile(part.name, toArrayBuffer(part.data), "cloud");
      }
      await refresh();
      setUrl("");
      toast.success(`Saved ${res.name}`);
      setTab("library");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[900] bg-black/60" />
        <Drawer.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
          <div className="g64-handle" />
          <Drawer.Title asChild>
            <h2>Software</h2>
          </Drawer.Title>
          <p className="lead">Search Assembly64 for games, carts, disks and SID — no links to paste. Tap Play and the file stays on this device so SAVE works.</p>

          <div className="g64-seg mb-3">
            <button type="button" data-on={tab === "catalog"} onClick={() => setTab("catalog")}>
              Catalog
            </button>
            <button type="button" data-on={tab === "library"} onClick={() => setTab("library")}>
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
                          <em className="g64-tag not-italic">{KIND_LABEL[item.kind]}</em>
                          <span>
                            {(item.size / 1024).toFixed(0)} KB ·{" "}
                            {item.source === "catalog" ? "Catalog" : item.source === "cloud" ? "Link" : "Imported"}
                          </span>
                        </button>
                        <div className="g64-card-tools">
                          {onInsert && running && isDiskKind(item.kind) ? (
                            <button
                              type="button"
                              className="g64-btn"
                              aria-label={`Insert ${item.name}`}
                              onClick={() => onInsert(item)}
                            >
                              <Disc3 className="size-4" />
                              Insert
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
