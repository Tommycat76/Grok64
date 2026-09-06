import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useEmu } from "@/lib/emu/store";
import {
  ROM_SLOTS,
  addSdFile,
  cbmName,
  deleteRom,
  formatPartition,
  listRoms,
  loadSdCard,
  putRom,
  removeSdFile,
  hasJiffyPair,
  seedRomsFromHost,
  type RomSlotId,
  type SdPartition,
} from "@/lib/emu/hardware";
import { dosCommand, exportSdImage } from "@/lib/emu/sd2iec";
import { parseMbrDisk, fromP00 } from "@/lib/emu/fat16";

function kb(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function HardwarePanel() {
  const s = useEmu();
  const [roms, setRoms] = useState<Awaited<ReturnType<typeof listRoms>>>([]);
  const [parts, setParts] = useState<SdPartition[]>([]);
  const [folder, setFolder] = useState("os");
  const fileRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<RomSlotId | null>(null);
  const sdRef = useRef<HTMLInputElement>(null);
  const partRef = useRef(0);

  async function refresh() {
    await seedRomsFromHost();
    setRoms(await listRoms());
    setParts(await loadSdCard());
    if (await hasJiffyPair()) s.setJiffyDos(true);
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <>
      <div className="g64-field">
        <label>Your ROMs (on this device)</label>
        <p className="text-xs text-fg-subtle">
          Grok64 does not ship JiffyDOS or CMD HD. Upload images you own — CMD HDD Boot ROM 2.80 from go4retro, JiffyDOS C64 + 1541. They stay in this browser and are injected into VICE at boot.
        </p>
        {ROM_SLOTS.map((slot) => {
          const have = roms.find((r) => r.id === slot.id);
          return (
            <div key={slot.id} className="g64-filerow" style={{ marginTop: 8 }}>
              <div>
                <strong>{slot.label}</strong>
                <span>
                  {have ? `${have.name} \u00b7 ${kb(have.size)}` : slot.hint}
                </span>
              </div>
              <button
                type="button"
                className="g64-btn"
                onClick={() => {
                  slotRef.current = slot.id;
                  fileRef.current?.click();
                }}
              >
                {have ? "Replace" : "Upload"}
              </button>
              {have ? (
                <button
                  type="button"
                  className="g64-btn"
                  onClick={async () => {
                    await deleteRom(slot.id);
                    await refresh();
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>
          );
        })}
        <input
          ref={fileRef}
          type="file"
          accept=".bin,.rom,.256,.img"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            const slot = slotRef.current;
            e.target.value = "";
            if (!file || !slot) return;
            await putRom(slot, file.name, await file.arrayBuffer());
            if (slot === "jiffy-c64" || slot === "jiffy-1541") {
              if (await hasJiffyPair()) s.setJiffyDos(true);
            }
            if (slot === "cmdhd") s.setIecDrive("cmdhd");
            await refresh();
            toast.message(`${file.name} stored`);
          }}
        />
      </div>

      <div className="g64-row">
        <span>JiffyDOS (needs C64 + 1541 ROMs)</span>
        <button
          type="button"
          className="g64-switch"
          data-on={s.jiffyDos ? "true" : "false"}
          onClick={() => s.setJiffyDos(!s.jiffyDos)}
          role="switch"
          aria-checked={s.jiffyDos}
        >
          <i />
        </button>
      </div>
      <p className="mb-3 text-xs text-fg-subtle">Applies on next load. Libretro looks for those exact filenames in system/vice.</p>

      <div className="g64-field">
        <label>Virtual SD card</label>
        <p className="text-xs text-fg-subtle">
          Four FAT partitions (`//0:`–`//3:`). C64 OS Setup looks for `$=P`, then `CD:os`. Drop the C64 OS system files on partition 0 (folder `os`). After READY, device 8 is sd2iec: `LOAD"C64OS",8,1`. File Manager → device 8, driver SD2IEC.
        </p>
        <div className="g64-filerow">
          <span>Put new files in</span>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="os" />
        </div>
        {parts.map((p) => (
          <div key={p.id} style={{ marginTop: 10 }}>
            <div className="g64-filerow">
              <div>
                <strong>
                  //{p.id}: {p.label}
                </strong>
                <span>{p.files.length} file{p.files.length === 1 ? "" : "s"}</span>
              </div>
              <button
                type="button"
                className="g64-btn"
                onClick={() => {
                  partRef.current = p.id;
                  sdRef.current?.click();
                }}
              >
                Add
              </button>
              <button type="button" className="g64-btn" onClick={() => void formatPartition(p.id).then(refresh)}>
                Format
              </button>
            </div>
            {p.files.map((f) => (
              <div key={f.id} className="g64-filerow" style={{ paddingLeft: 12 }}>
                <div>
                  <strong>{[f.path, cbmName(f.name)].filter(Boolean).join("/")}</strong>
                  <span>
                    {f.name} \u00b7 {kb(f.size)}
                  </span>
                </div>
                <button type="button" className="g64-btn" onClick={() => void removeSdFile(p.id, f.id).then(refresh)}>
                  Del
                </button>
              </div>
            ))}
          </div>
        ))}
        <input
          ref={sdRef}
          type="file"
          multiple
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            const pid = partRef.current;
            for (const f of files) await addSdFile(pid, f.name, await f.arrayBuffer(), folder.trim());
            await refresh();
            if (files.length) {
              s.setIecDrive("sd2iec");
              toast.message(`Added to //${pid}:`);
            }
          }}
        />
        <div className="g64-filerow" style={{ marginTop: 10 }}>
          <input
            className="w-full"
            placeholder='CD://1:  or  LOAD"$",8'
            onKeyDown={async (e) => {
              if (e.key !== "Enter") return;
              const t = (e.target as HTMLInputElement).value;
              (e.target as HTMLInputElement).value = "";
              toast.message(await dosCommand(t));
            }}
          />
        </div>
        <div className="g64-filerow">
          <button
            type="button"
            className="g64-btn"
            onClick={async () => {
              const blob = await exportSdImage();
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "grok64-sd2iec.img";
              a.click();
              toast.message("FAT16 SD image — drop it on a real sd2iec");
            }}
          >
            Export .img
          </button>
          <button
            type="button"
            className="g64-btn"
            onClick={() => {
              const inp = document.createElement("input");
              inp.type = "file";
              inp.accept = ".img,.dsk,.bin";
              inp.onchange = async () => {
                const f = inp.files?.[0];
                if (!f) return;
                const parts = parseMbrDisk(new Uint8Array(await f.arrayBuffer()));
                for (let i = 0; i < parts.length && i < 4; i++) {
                  await formatPartition(i);
                  for (const file of parts[i]!.files) {
                    const p00 = fromP00(file.data);
                    const raw = p00?.data ?? file.data;
                    const copy = new Uint8Array(raw.byteLength);
                    copy.set(raw);
                    await addSdFile(i, p00?.name ?? file.name, copy.buffer);
                  }
                }
                s.setIecDrive("sd2iec");
                await refresh();
                toast.message("SD image imported");
              };
              inp.click();
            }}
          >
            Import .img
          </button>
        </div>
      </div>
    </>
  );
}
