import { useEffect, useState } from "react";
import { Drawer } from "vaul";
import { toast } from "sonner";
import { toArrayBuffer } from "@/lib/emu/archive";
import {
  deleteSnapshot,
  freezeSlot,
  getSnapshot,
  listSnapshots,
  putSnapshot,
  recipeSummary,
  type HardwareRecipe,
  type SnapshotRecord,
} from "@/lib/emu/snapshots";
import { useEmu } from "@/lib/emu/store";

function readRecipe(): HardwareRecipe {
  const s = useEmu.getState();
  return {
    machineId: s.machineId,
    videoStandard: s.videoStandard,
    coreMode: s.coreMode,
    driveMode: s.driveMode,
    reuSize: s.reuSize,
    iecDrive: s.iecDrive,
    iecUnit: s.iecUnit,
    mouseMode: s.mouseMode,
    scpuSimm: s.scpuSimm,
    scpuTurbo: s.scpuTurbo,
    joyPort: s.joyPort,
    jiffyDos: s.jiffyDos,
  };
}

function applyRecipe(recipe: HardwareRecipe) {
  const s = useEmu.getState();
  s.setMachine(recipe.machineId);
  s.setVideoStandard(recipe.videoStandard as typeof s.videoStandard);
  s.setCoreMode(recipe.coreMode as typeof s.coreMode);
  s.setDriveMode(recipe.driveMode as typeof s.driveMode);
  s.setReuSize(recipe.reuSize);
  s.setIecDrive(recipe.iecDrive);
  s.setIecUnit(recipe.iecUnit ?? 8);
  s.setMouseMode(recipe.mouseMode);
  s.setScpuSimm(recipe.scpuSimm);
  s.setScpuTurbo(recipe.scpuTurbo);
  s.setJoyPort(recipe.joyPort);
  s.setJiffyDos(recipe.jiffyDos);
}

interface Props {
  canCapture: boolean;
  onCapture: (kind: SnapshotRecord["kind"], id: string) => Promise<void>;
  onRestore: (snap: SnapshotRecord) => Promise<void>;
}

export function SnapshotsSheet({ canCapture, onCapture, onRestore }: Props) {
  const s = useEmu();
  const [rows, setRows] = useState<Omit<SnapshotRecord, "data">[]>([]);

  async function refresh() {
    setRows(await listSnapshots());
  }

  useEffect(() => {
    if (s.snapsOpen) void refresh();
  }, [s.snapsOpen]);

  return (
    <Drawer.Root open={s.snapsOpen} onOpenChange={s.setSnapsOpen}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[900] bg-black/60" />
        <Drawer.Content className="g64-sheet fixed right-0 bottom-0 left-0 z-[950]">
          <div className="g64-handle" />
          <Drawer.Title asChild>
            <h2>Snapshots</h2>
          </Drawer.Title>
          <p className="lead">
            Hardware freeze is a full VICE state plus the recipe (REU, Jiffy, IEC, mouse, SuperCPU). Memory slots are the same dump — loading either reapplies that hardware before the state.
          </p>
          <div className="g64-field">
            <label>Hardware freeze</label>
            <div className="g64-seg">
              {[1, 2, 3, 4].map((slot) => {
                const id = freezeSlot(slot);
                const saved = rows.find((r) => r.id === id);
                return (
                  <button
                    key={slot}
                    type="button"
                    data-on={saved ? "true" : "false"}
                    disabled={!canCapture && !saved}
                    onClick={async () => {
                      if (!canCapture) {
                        if (saved) {
                          const snap = await getSnapshot(id);
                          if (snap) await onRestore(snap);
                        }
                        return;
                      }
                      await onCapture("hardware", id);
                      await refresh();
                      toast.message(`Freeze ${slot} saved`);
                    }}
                  >
                    F{slot}
                    {saved ? " ●" : ""}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-fg-subtle">Tap a slot while playing to save. Tap again from this sheet after a reload to restore hardware + memory.</p>
          </div>
          <button
            type="button"
            className="g64-btn g64-btn-primary mb-3"
            disabled={!canCapture}
            onClick={async () => {
              await onCapture("memory", `mem-${Date.now()}`);
              await refresh();
              toast.message("Memory snapshot saved");
            }}
          >
            Save memory + hardware recipe
          </button>
          {rows.map((row) => (
            <div key={row.id} className="g64-filerow">
              <div>
                <strong>{row.title || (row.kind === "hardware" ? "Freeze" : "Memory")}</strong>
                <span>{`${new Date(row.savedAt).toLocaleString()} · ${recipeSummary(row.recipe)}`}</span>
              </div>
              <button
                type="button"
                className="g64-btn"
                onClick={async () => {
                  const snap = await getSnapshot(row.id);
                  if (snap) await onRestore(snap);
                }}
              >
                Load
              </button>
              <button type="button" className="g64-btn" onClick={() => void deleteSnapshot(row.id).then(refresh)}>
                Del
              </button>
            </div>
          ))}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export async function saveSnapshot(kind: SnapshotRecord["kind"], id: string, data: Uint8Array, title: string) {
  await putSnapshot({
    id,
    kind,
    title,
    savedAt: Date.now(),
    recipe: readRecipe(),
    data: toArrayBuffer(data),
  });
}

export { applyRecipe, readRecipe };
