# CMD HD / SD2IEC compatibility matrix (Grok64)

**Spec source (Tom):** [C64 OS SD2IEC User's Manual](https://www.c64os.com/post/sd2iecdocumentation) for sd2iec command channel, partitions, directories, and disk-image mount/unmount; CMD HD Section 9 (via that manual) for path/error-channel syntax; [Buyer's Guide](https://c64os.com/buyersguide/) for hardware/cart context. See `docs/HARDWARE_SPEC_REFERENCE.md`. No C64 OS software is committed in this repo.

This document compares Grok64’s storage emulation against those guides, the upstream [sd2iec](https://sd2iec.de) README, and JiffyDOS behavior. Status keys:

| Status | Meaning |
|--------|---------|
| **Implemented** | Matches real hardware for typical C64 OS / BASIC use |
| **Partial** | Works for common cases; edge cases differ |
| **Missing** | Not implemented |
| **Wrong** | Behavior diverges from hardware (bug) |

Last reviewed: Grok64 branch `cursor/cmd-sd2iec-ui-f650`.

## Architecture

| Layer | Grok64 behavior |
|-------|-----------------|
| **SD2IEC** | IndexedDB card / FAT `.img` import → Grok64 software IEC device (`attachSd2iecBus` + `tickSd2iec` in `sd2iec.ts`). VICE has **no** drive on that unit (`DriveNType=0`). See `docs/SD2IEC_IEC_BUS.md`. |
| **CMD HD** | VICE true drive + CMD HD DOS ROM (`dosCMDHD.bin`); `vice_work_disk=disabled`; SWAP button via `cmdHdSwap()` |
| **JiffyDOS** | User-supplied ROMs injected into VICE FS; `vice_jiffydos=enabled` when C64+1541 pair present |

## SD2IEC (firmware-oriented)

| Feature | Status | Notes |
|---------|--------|-------|
| Device numbers 8–11 | **Implemented** | Settings + SD 8/9 SWAP button |
| Command channel (15) | **Implemented** | OPEN 15,2 / GET# for status |
| Status messages `nn, text,00,00` | **Partial** | Common codes (00, 31, 74); not full sd2iec table |
| `I` / `UI` / `UJ` reset/init | **Implemented** | Returns OK |
| `CD:name` subdirectories | **Implemented** | Virtual dirs in partition metadata |
| `CD:_` / `CD<-` parent | **Implemented** | This PR |
| `CD//` root / `CD//n:` partition | **Partial** | Partition switch via `parsePath`; `CD//` root OK |
| `CPn` / `G-Pn` partition | **Implemented** | |
| `MD:name` / `RD:name` | **Implemented** | Virtual dir create/remove (this PR) |
| `S:name` scratch | **Partial** | Deletes matching files; not full scratch semantics |
| `N:` format partition | **Implemented** | Clears files + dirs on active partition |
| `XDn` / `X` / `X?` | **Partial** | Partition select + status string |
| `$` directory | **Implemented** | BASIC-linked listing in RAM hook |
| `$=P` partition catalog | **Implemented** | |
| `$=pattern` filtered listing | **Implemented** | Wildcards `*` `?` (this PR) |
| `.D64/.D71/.D81/.DNP` on card | **Partial** | `CD:IMAGE.D64` mounts in software; D64 PRG load/list OK; D81/DNP TBD |
| P00 wrapper | **Implemented** | Import/export |
| MBR multi-partition `.img` | **Implemented** | `exportSdImage` / `importSdImage` |
| Subdir file paths | **Implemented** | `path` field on SD files |
| Fast loaders / Jiffy on SD2IEC | **Partial** | Depends on VICE traps + Jiffy ROMs; not cycle-exact |
| Long filename / CBM paths | **Missing** | 8.3 PETSCII names only |
| `CD←` (PETSCII) | **Implemented** | `CD<-`, `CD:_`, and `CD←` / PETSCII back (per C64 OS SD2IEC manual) |
| `CD//` inside mounted image | **Implemented** | Root of mounted `.D64` without unmount; `CD←` at image root unmounts |

## CMD HD / FD (DOS 2.8x)

| Feature | Status | Notes |
|---------|--------|-------|
| CMD HD as IEC drive (type 4844) | **Implemented** | VICE `DriveNType=4844` + ROM |
| Native (DNP) partitions | **Partial** | Via user `.dnp` / `.dhd` images in library; not full native FS editor |
| Subdirectories | **Partial** | Handled by CMD DOS in VICE when image provides them |
| `CD//` `CD<-` partition/path | **Partial** | DOS-level; depends on mounted image |
| SWAP with unit 8 | **Implemented** | `cmdHdSwap` + UI chip |
| FD2000/4000 | **Missing** | Not modeled separately |
| Multiple CMD devices | **Partial** | One CMD HD slot in IEC map |

## JiffyDOS

| Feature | Status | Notes |
|---------|--------|-------|
| C64 KERNAL replacement | **Implemented** | User ROM upload |
| 1541/1571/1581 drive ROMs | **Implemented** | Optional slots |
| Enable at runtime | **Implemented** | `vice_jiffydos` + recycle rules in play session |
| Fast directory / load | **Partial** | VICE Jiffy integration; game-specific |

## Automated tests

| Command | What it covers |
|---------|----------------|
| `npm run test` | Unit tests including `scripts/sd2iec-cmd.test.mjs` |
| `npm run test:cmd-sd2iec` | Playwright Chromium + WebKit DOS/UI smoke |
| `node scripts/ui-layout-qa.mjs --before\|--after` | Device layout screenshots (no C64 OS screen) |

C64 OS v1.04 boot tests use `fixtures/c64os/` (gitignored). Set `GROK64_C64OS_FIXTURE` if needed.

## Known gaps (need hardware or Tom verification)

- Full sd2iec error code parity and `M-R`/`M-W` media commands
- DNP create/resize inside Grok64 UI (use external `.dnp` / CMD Tools)
- Cycle-accurate fast loader timing vs SD2IEC hardware
- CMD HD multiple partitions in one session without remount
