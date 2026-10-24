import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ROM_ACCEPT, SD_IMAGE_ACCEPT } from "@/lib/emu/formats";
import { formatBytes, hasJiffyPair, listRoms, prefetchBundledRoms, putRom, removeRom, ROM_CATALOG } from "@/lib/emu/roms";
import {
  addSdFile,
  exportSdImage,
  formatPartition,
  importSdImage,
  listPartitions,
  mountDirectFatImage,
  mountHostSdFolder,
  petsciiName,
  removeSdFile,
  runSdCommand,
  type SdPartition,
} from "@/lib/emu/sd2iec";
import {
  getSd2iecCardSourceMeta,
  hostDirectoryPickerReason,
  supportsHostDirectoryPicker,
} from "@/lib/emu/sd2iec-card-source";
import { JiffyDosToggleRow, JiffyFastloadCartMatrix } from "@/components/emu/JiffyCartCompatPanel";
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
                <button
                  type="button"
                  className="g64-btn"
                  onClick={() =>
                    void removeRom(def.id).then(async () => {
                      if (def.id === "jiffy-c64" || def.id === "jiffy-1541") {
                        s.setJiffyDos(await hasJiffyPair());
                      }
                      refresh();
                    })
                  }
                >
                  Remove
                </button>
              ) : null}
            </div>
          );
        })}
        <input
          ref={romInput}
          type="file"
          accept={ROM_ACCEPT}
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

      <JiffyFastloadCartMatrix />
      <JiffyDosToggleRow />

      <div className="g64-field">
        <label>SD2IEC card</label>
        <p className="text-xs text-fg-subtle">
          Same firmware command set on the IEC bus for every source: <strong>Mount .img</strong> reads FAT16/MBR directly (not repacked into browser storage).{" "}
          <strong>Open SD folder</strong> uses Chromium&apos;s directory picker on a real card folder (writes go back only when SD writes are enabled). Safari/iOS cannot mount host folders — use .img or the future Windows app for raw block access.
        </p>
        <p className="text-xs text-fg-muted">
          Active: {getSd2iecCardSourceMeta().label} ({getSd2iecCardSourceMeta().kind})
        </p>
        <label className="flex items-center gap-2 text-sm" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={s.sd2iecWriteEnabled}
            onChange={(e) => s.setSd2iecWriteEnabled(e.target.checked)}
          />
          Allow SD writes (host folder only; off by default)
        </label>
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
              input.accept = SD_IMAGE_ACCEPT;
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                await mountDirectFatImage(new Uint8Array(await file.arrayBuffer()), file.name);
                s.setIecDrive("sd2iec");
                await refresh();
                toast.message("Mounted .img on SD2IEC (direct FAT)");
              };
              input.click();
            }}
          >
            Mount .img
          </button>
          <button
            type="button"
            className="g64-btn"
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = SD_IMAGE_ACCEPT;
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                await importSdImage(new Uint8Array(await file.arrayBuffer()));
                s.setIecDrive("sd2iec");
                await refresh();
                toast.message("Copied .img into browser card (IndexedDB)");
              };
              input.click();
            }}
          >
            Copy .img to browser
          </button>
          <button
            type="button"
            className="g64-btn"
            disabled={!supportsHostDirectoryPicker()}
            title={hostDirectoryPickerReason() ?? "Open a folder from your SD card reader"}
            onClick={async () => {
              const reason = hostDirectoryPickerReason();
              if (reason) {
                toast.message(reason);
                return;
              }
              try {
                const handle = await window.showDirectoryPicker({ mode: "readwrite" });
                await mountHostSdFolder(handle);
                s.setIecDrive("sd2iec");
                await refresh();
                toast.message(`SD folder: ${handle.name}`);
              } catch (e) {
                if (String(e).includes("AbortError")) return;
                toast.error(String(e));
              }
            }}
          >
            Open SD folder
          </button>
        </div>
        {hostDirectoryPickerReason() ? (
          <p className="text-xs text-fg-subtle" style={{ marginTop: 6 }}>{hostDirectoryPickerReason()}</p>
        ) : null}
      </div>
    </>
  );
}
