# SD2IEC card sources (Grok64)

The virtual SD2IEC is a **software IEC device** with the same command channel as hardware (`CD`, `MD`, `RD`, `$`, image mount, partition commands). The C64 cannot tell *which* backing store Grok64 uses — only that the firmware answers on the configured unit (8–11, or 12 for C64 OS paths).

See also: `docs/SD2IEC_IEC_BUS.md`, `docs/CMD_SD2IEC_COMPATIBILITY.md`.

## Two equivalent sources (Tom requirement)

| Source | UI | Backing | Writes |
|--------|-----|---------|--------|
| **A — FAT image** | **Mount .img** | MBR/FAT16 `.img` kept in memory; listings/loads use the parsed FAT (not copied into per-file IndexedDB) | Read-only in browser (image bytes are not rewritten) |
| **B — Host SD folder** | **Open SD folder** | Chromium **File System Access API** (`showDirectoryPicker`) on the folder exposed by the card reader | Optional — **Allow SD writes** toggle (default **off**); creates/overwrites files under the picked folder |
| **Legacy** | **Copy .img to browser** | Explodes the image into IndexedDB partitions (older path) | Add/Del/Format in Expansion panel |

**Not the same as VICE work disk:** SD2IEC never uses `vice_work_disk` or a packed D64 on the IEC unit. `remountSd2iecFromParts` only attaches the Grok64 IEC device (`DriveNType=0` on that unit). Native **1541 / 1581 / CMD HD** slots keep true drive emulation.

## Browser limits

- **No raw SD block access** — browsers cannot read/write physical sectors on the USB reader. Grok64 reads files through the FAT layer (image bytes or directory entries). A future **Windows Grok64 executable** can map the real card with block-level tools.
- **Safari / iOS** — `showDirectoryPicker` is unavailable. Use **Mount .img**, **Copy .img to browser**, or the desktop app when shipped. The Expansion panel shows a short explanation when the folder button is disabled.

## Safety

- Host-folder writes are gated by **Allow SD writes** (off by default).
- Mounting a new `.img` or folder replaces the in-memory virtual mount; IndexedDB data remains until you use **Copy .img** or **Format** on the legacy store.

## QA hooks (`window.__g64`)

For automated desktop tests (Playwright):

- `sd2iecCardMeta()` — `{ kind, label, writeEnabled, rawBlockAccess }`
- `mountSdFatImage(bytes, label?)` — source **A**
- `mountSdHostFolder(handle)` — source **B** (use OPFS or a real picker handle)
- `exportSdImage()` / `clearSd2iecMount()` / `setSd2iecWrites(on)`
- `sd2iecHostFolderSupport()` — `{ ok, reason }` for unsupported browsers

Run: `npm run test:desktop-sd2iec-card-sources`
