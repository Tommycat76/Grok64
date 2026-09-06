import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatBytes, hasJiffyPair, listRoms, prefetchBundledRoms, putRom, removeRom, ROM_CATALOG } from "@/lib/emu/roms";
import {
  addSdFile,
  exportSdImage,
  formatPartition,
  importSdImage,
  listPartitions,
  petsciiName,
  removeSdFile,
  runSdCommand,
  type SdPartition,
} from "@/lib/emu/sd2iec";
import { useEmu } from "@/lib/emu/store";

export function ExpansionPanel() {
  const s = useEmu();
  const [roms, setRoms] = useState<Awaited<ReturnType<typeof listRoms>>>([]);
  const [parts, setParts] = useState<SdPartition[]>([]);
  const [uploadPath, setUploadPath] = useState("os");
  const romInput = useRef<HTMLInputElement>(null);
  const romTarget = useRef<string | null>(null);
  const partInput = useRef<HTMLInputElement>(null);
  const activePart = useRef(0);

  async function refresh() {
    await prefetchBundledRoms();
    setRoms(await listRoms());
    setParts(await listPartitions());
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
        {ROM_CATALOG.map((def) => {
          const stored = roms.find((r) => r.id === def.id);
          return (
            <div key={def.id} className="g64-filerow" style={{ marginTop: 8 }}>
              <div>
                <strong>{def.label}</strong>
                <span>{stored ? `${stored.name} · ${formatBytes(stored.size)}` : def.hint}</span>
              </div>
              <button
                type="button"
                className="g64-btn"
                onClick={() => {
                  romTarget.current = def.id;
                  romInput.current?.click();
                }}
              >
                {stored ? "Replace" : "Upload"}
              </button>
              {stored ? (
                <button type="button" className="g64-btn" onClick={() => void removeRom(def.id).then(refresh)}>
                  Remove
                </button>
              ) : null}
            </div>
          );
        })}
        <input
          ref={romInput}
          type="file"
          accept=".bin,.rom,.256,.img"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            const id = romTarget.current;
            e.target.value = "";
            if (!file || !id) return;
            await putRom(id, file.name, await file.arrayBuffer());
            if ((id === "jiffy-c64" || id === "jiffy-1541") && (await hasJiffyPair())) s.setJiffyDos(true);
            if (id === "cmdhd") s.setIecDrive("cmdhd");
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
          <input value={uploadPath} onChange={(e) => setUploadPath(e.target.value)} placeholder="os" />
        </div>
        {parts.map((part) => (
          <div key={part.id} style={{ marginTop: 10 }}>
            <div className="g64-filerow">
              <div>
                <strong>{`//${part.id}: ${part.label}`}</strong>
                <span>{`${part.files.length} file${part.files.length === 1 ? "" : "s"}`}</span>
              </div>
              <button
                type="button"
                className="g64-btn"
                onClick={() => {
                  activePart.current = part.id;
                  partInput.current?.click();
                }}
              >
                Add
              </button>
              <button type="button" className="g64-btn" onClick={() => void formatPartition(part.id).then(refresh)}>
                Format
              </button>
            </div>
            {part.files.map((file) => (
              <div key={file.id} className="g64-filerow" style={{ paddingLeft: 12 }}>
                <div>
                  <strong>{[file.path, petsciiName(file.name)].filter(Boolean).join("/")}</strong>
                  <span>{`${file.name} · ${formatBytes(file.size)}`}</span>
                </div>
                <button type="button" className="g64-btn" onClick={() => void removeSdFile(part.id, file.id).then(refresh)}>
                  Del
                </button>
              </div>
            ))}
          </div>
        ))}
        <input
          ref={partInput}
          type="file"
          multiple
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            const partId = activePart.current;
            for (const file of files) {
              await addSdFile(partId, file.name, await file.arrayBuffer(), uploadPath.trim());
            }
            await refresh();
            if (files.length) {
              s.setIecDrive("sd2iec");
              toast.message(`Added to //${partId}:`);
            }
          }}
        />
        <div className="g64-filerow" style={{ marginTop: 10 }}>
          <input
            className="w-full"
            placeholder="CD://1:  or  LOAD&quot;$&quot;,8"
            onKeyDown={async (e) => {
              if (e.key !== "Enter") return;
              const input = e.currentTarget;
              const cmd = input.value;
              input.value = "";
              toast.message(await runSdCommand(cmd));
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
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".img,.dsk,.bin";
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                await importSdImage(new Uint8Array(await file.arrayBuffer()));
                s.setIecDrive("sd2iec");
                await refresh();
                toast.message("SD image imported");
              };
              input.click();
            }}
          >
            Import .img
          </button>
        </div>
      </div>
    </>
  );
}
