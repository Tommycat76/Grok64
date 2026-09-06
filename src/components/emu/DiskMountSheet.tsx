import { Disc3, FolderOpen, Play } from "lucide-react";
import { Drawer } from "vaul";
import { KIND_LABEL, isDiskKind } from "@/lib/emu/formats";
import { isWorkDisk, listLibrary, updateFileUnit } from "@/lib/emu/library";
import { useEmu } from "@/lib/emu/store";
import type { LibraryItem } from "@/lib/emu/types";
import { IecUnitSeg } from "@/components/emu/IecUnitSeg";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlay: (item: LibraryItem) => void;
  onInsert: (item: LibraryItem) => void;
  onBrowse: () => void;
}

export function DiskMountSheet({ open, onOpenChange, onPlay, onInsert, onBrowse }: Props) {
  const library = useEmu((s) => s.library);
  const running = useEmu((s) => s.running);
  const defaultUnit = useEmu((s) => s.iecUnit);
  const setLibrary = useEmu((s) => s.setLibrary);
  const disks = library.filter((i) => isDiskKind(i.kind) && !isWorkDisk(i.name));

  async function refreshLibrary() {
    setLibrary(await listLibrary());
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[900] bg-black/60" />
        <Drawer.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
          <div className="g64-handle" />
          <Drawer.Title asChild>
            <h2>Insert disk</h2>
          </Drawer.Title>
          <p className="lead">
            For two-disk titles, leave the game running. When it asks for the next floppy, insert it here — the machine does not reset.
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
                  <em className="g64-tag not-italic">{KIND_LABEL[item.kind]}</em>
                  <span>{(item.size / 1024).toFixed(0)} KB</span>
                  <IecUnitSeg
                    compact
                    value={item.iecUnit ?? defaultUnit}
                    onChange={(unit) => {
                      void updateFileUnit(item.id, unit).then(refreshLibrary);
                    }}
                  />
                  <div className="g64-card-tools col-start-2 row-start-1">
                    <button
                      type="button"
                      className="g64-btn g64-btn-primary"
                      onClick={() => {
                        onPlay(item);
                        onOpenChange(false);
                      }}
                    >
                      <Play className="size-4" />
                      Run
                    </button>
                    {running ? (
                      <button
                        type="button"
                        className="g64-btn"
                        onClick={() => {
                          onInsert(item);
                          onOpenChange(false);
                        }}
                      >
                        <Disc3 className="size-4" />
                        Insert
                      </button>
                    ) : null}
                  </div>
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
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
