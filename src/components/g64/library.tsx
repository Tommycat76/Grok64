import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Cloud, Disc3, FolderOpen, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { CatalogPane } from "./catalog";
import { fetchUrl } from "@/lib/g64/catalog.server";
import { ACCEPT, KIND_LABEL, expandArchive, fromBase64, isDiskKind, toArrayBuffer } from "@/lib/g64/files";
import { deleteFile, isWorkDiskName, listLibrary, putFile } from "@/lib/g64/idb";
import { BUNDLED, type BundledTitle } from "@/lib/g64/software";
import { useG64, type LibraryItem } from "@/lib/g64/store";

export function SoftwareSheet({
  onPlayBundled,
  onPlayLocal,
  onInsert,
}: {
  onPlayBundled: (title: BundledTitle) => void;
  onPlayLocal: (item: LibraryItem) => void;
  onInsert?: (item: LibraryItem) => void;
}) {
  const open = useG64((s) => s.libraryOpen);
  const setOpen = useG64((s) => s.setLibraryOpen);
  const library = useG64((s) => s.library);
  const setLibrary = useG64((s) => s.setLibrary);
  const running = useG64((s) => s.running);
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"catalog" | "library">("catalog");

  async function refresh() {
    setLibrary(await listLibrary());
  }

  async function importFiles(list: FileList, source: string) {
    const files = Array.from(list);
    if (!files.length) return;
    setBusy(true);
    try {
      for (const file of files) {
        const data = new Uint8Array(await file.arrayBuffer());
        const expanded = expandArchive(file.name, data);
        for (const f of expanded) await putFile(f.name, toArrayBuffer(f.data), source);
      }
      await refresh();
      toast.success(files.length === 1 ? `Saved ${files[0]!.name}` : `Saved ${files.length} files`);
      setTab("library");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not import");
    } finally {
      setBusy(false);
    }
  }

  async function fetchLink() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetchUrl({ data: { url: trimmed } });
      const data = fromBase64(res.base64);
      const expanded = expandArchive(res.name, data);
      for (const f of expanded) await putFile(f.name, toArrayBuffer(f.data), "cloud");
      await refresh();
      setUrl("");
      toast.success(`Saved ${res.name}`);
      setTab("library");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[900] bg-black/60" />
        <Dialog.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
          <div className="g64-handle" />
          <Dialog.Title asChild>
            <h2>Software</h2>
          </Dialog.Title>
          <p className="lead">
            Search Assembly64 for games, carts, disks and SID — no links to paste. Tap Play and the file stays on this
            device so SAVE works.
          </p>
          <div className="g64-seg mb-3">
            <button type="button" data-on={tab === "catalog"} onClick={() => setTab("catalog")}>
              Catalog
            </button>
            <button type="button" data-on={tab === "library"} onClick={() => setTab("library")}>
              On this device{library.length ? ` · ${library.length}` : ""}
            </button>
          </div>
          {tab === "catalog" ? (
            <CatalogPane
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
                accept={ACCEPT}
                multiple
                onChange={(e) => {
                  if (e.target.files) void importFiles(e.target.files, "local");
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
                  <button
                    type="button"
                    className="g64-btn g64-btn-primary shrink-0"
                    disabled={busy}
                    onClick={() => void fetchLink()}
                  >
                    <Cloud className="size-4" />
                    Fetch
                  </button>
                </div>
              </div>
              <p className="mb-2 text-xs tracking-wide text-fg-subtle uppercase">Bundled tests</p>
              <div className="g64-list">
                {BUNDLED.map((title) => (
                  <button
                    key={title.id}
                    type="button"
                    className="g64-card"
                    onClick={() => {
                      setOpen(false);
                      onPlayBundled(title);
                    }}
                  >
                    <strong>{title.name}</strong>
                    <em className="g64-tag not-italic">{title.tag}</em>
                    <span>{title.blurb}</span>
                  </button>
                ))}
                {library.length > 0 ? (
                  <>
                    <p className="mt-2 text-xs tracking-wide text-fg-subtle uppercase">Saved on this device</p>
                    {library.map((item) => (
                      <div key={item.id} className="g64-card">
                        <button
                          type="button"
                          className="contents text-left"
                          onClick={() => {
                            setOpen(false);
                            onPlayLocal(item);
                          }}
                        >
                          <strong>{item.name}</strong>
                          <em className="g64-tag not-italic">{KIND_LABEL[item.kind as keyof typeof KIND_LABEL] ?? item.kind}</em>
                          <span>
                            {(item.size / 1024).toFixed(0)} KB ·{" "}
                            {item.source === "catalog" ? "Catalog" : item.source === "cloud" ? "Link" : "Imported"}
                          </span>
                        </button>
                        <div className="g64-card-tools">
                          {onInsert && running && isDiskKind(item.kind as never) && !isWorkDiskName(item.name) ? (
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
                              void deleteFile(item.id).then(refresh);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="px-1 text-sm text-fg-muted">
                    Nothing saved yet. Grab a title from Catalog — it stays here so you can play again and SAVE to disk.
                  </p>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function InsertSheet({
  open,
  onOpenChange,
  onInsert,
  onBrowse,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onInsert: (item: LibraryItem) => void;
  onBrowse: () => void;
}) {
  const disks = useG64((s) => s.library).filter((e) => isDiskKind(e.kind as never) && !isWorkDiskName(e.name));
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[900] bg-black/60" />
        <Dialog.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
          <div className="g64-handle" />
          <Dialog.Title asChild>
            <h2>Insert disk</h2>
          </Dialog.Title>
          <p className="lead">
            For two-disk titles, leave the game running. When it asks for the next floppy, insert it here — the machine
            does not reset.
          </p>
          {disks.length === 0 ? (
            <p className="px-1 text-sm text-fg-muted">
              No disk images on this device yet. Grab disk 1 and disk 2 from Software first.
            </p>
          ) : (
            <div className="g64-list">
              {disks.map((item) => (
                <div key={item.id} className="g64-card">
                  <strong>{item.name}</strong>
                  <em className="g64-tag not-italic">{KIND_LABEL[item.kind as keyof typeof KIND_LABEL] ?? item.kind}</em>
                  <span>{(item.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    className="g64-btn g64-btn-primary col-start-2 row-start-1"
                    onClick={() => {
                      onInsert(item);
                      onOpenChange(false);
                    }}
                  >
                    <Disc3 className="size-4" />
                    Insert
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="g64-actions mt-3">
            <button
              type="button"
              className="g64-btn"
              onClick={() => {
                onOpenChange(false);
                onBrowse();
              }}
            >
              <FolderOpen className="size-4" />
              Browse Software
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
