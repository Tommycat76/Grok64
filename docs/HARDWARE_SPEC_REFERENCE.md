# Hardware behavior spec (reference only)

Grok64 storage, CMD, and cartridge compatibility are implemented against **public hardware guides** published on [C64 OS](https://c64os.com/). We do **not** ship or commit C64 OS application software; these URLs are the behavioral spec for emulation and QA.

## Primary references (C64 OS)

| Topic | URL | Use in Grok64 |
|-------|-----|----------------|
| **SD2IEC / sd2iec firmware** | [SD2IEC User's Manual](https://www.c64os.com/post/sd2iecdocumentation) | Command channel (15), `CD` / `CP` / `MD` / `RD`, `$` and `$=P`, partition paths (`//`, `n:`), disk-image mount/unmount (`CD:IMAGE.D64`, `CD//`, `CD←`) |
| **SD2IEC filenames** | [Understanding SD2IEC Filenaming](https://c64os.com/post/sd2iecfilenames) | 8.3 PETSCII names, path limits |
| **Buyer's guide (hardware index)** | [Commodore 8-Bit Buyer's Guide](https://c64os.com/buyersguide/) | Cart / storage product families; compatibility notes in UI |
| **C64 OS filesystem (context)** | [User's Guide — Filesystem](https://c64os.com/c64os/usersguide/filesystem) | Which devices can be system drives (CMD HD, SD2IEC, RAMLink, etc.) — not a license to bundle C64 OS |

The SD2IEC manual states that **path syntax, error channel, and partition rules** follow CMD DOS Section 9. Grok64 treats that section as normative for CMD-style paths on SD2IEC; CMD HD behavior in-app uses VICE CMD DOS ROM + mounted images.

## CMD HD / FD / RAMLink (secondary)

| Topic | Typical source | Grok64 |
|-------|----------------|--------|
| CMD HD command reference (Section 9) | Linked from SD2IEC manual; e.g. [CMD HD User's Manual (PDF)](https://vintagecomputer.ca/files/CMD/CMD_Hard_Drive_Users_Manual.pdf) | `vice_driveN_type=4844`, `cmdHdSwap()`, native `.dnp` / library images |
| CMD FD | CMD FD-Series manual (same ecosystem) | Not modeled as separate FD2000 device yet |
| RAMLink | CMD RamLink manual | Not emulated; listed for doc parity only |

## Implementation map

- **SD2IEC firmware layer:** `src/lib/emu/sd2iec.ts`, `src/lib/emu/sd2iec-volume.ts`
- **WASM IEC bus:** `docs/SD2IEC_IEC_BUS.md`, `third_party/vice-grok64/`
- **CMD HD swap / IEC map:** `src/lib/emu/host.ts` (`cmdHdSwap`)
- **Jiffy vs freezer carts:** `src/lib/emu/jiffy-cart-compat.ts` (hardware pairing matrix in Settings)
- **Compatibility matrix (tests):** `docs/CMD_SD2IEC_COMPATIBILITY.md`

When behavior disagrees with the C64 OS SD2IEC manual, treat the manual as the bug report unless Tom specifies a Grok64-only exception.
