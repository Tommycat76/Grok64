# SD2IEC IEC bus (Grok64 software device)

## Feasibility in this core

| Approach | Status |
|----------|--------|
| VICE / libretro native SD2IEC | **Not available** — no SD2IEC drive type in `vice-libretro`. |
| VICE `N_fs` work disk as “the card” | **Not used for SD2IEC** — that is a host directory FS device, not sd2iec firmware (CD/CP/`$=P`, image mount). |
| CMD HD / IDE from a FAT `.img` | **CMD HD only** — real `DriveNType=4844` + `dosCMDHD.bin`; not a substitute for SD2IEC. |
| **Grok64 IEC software device** | **Implemented** — intercepts KERNAL IEC entry points when the C64 talks to the configured unit (8–11). |

The shipped WASM (`vice_x64sc` via EmulatorJS) does **not** export hooks to snoop or inject at the serial IEC line inside the drive CPU. Reaching the bus *inside* VICE would require rebuilding `vice-libretro` with a custom libretro callback (or a new `DriveNType`).

## What we built

1. **Card backing** — IndexedDB partitions (`sd2iec.ts`), import/export of MBR + FAT16 `.img` (`parseSdImage` / `exportSdImage`), folder paths on files (`path` + virtual `dirs`).
2. **Firmware command set** — `runSdCommand` / command channel 15: `CD`, `CP`, `MD`, `RD`, `S:`, `N:`, `X`, `$`, `$=P`, wildcards, etc. (see `docs/CMD_SD2IEC_COMPATIBILITY.md`).
3. **IEC attachment** — `installSd2iecHooks` patches KERNAL vectors (`READ`, `OPEN`, `CLOSE`, `TALK`, …) for `deviceUnit`; `tickSd2iec` services the handshake mailbox each frame when SD2IEC is on the IEC map.
4. **CD into disk images** — `CD:FOO.D64` mounts the image in software; `$` / `LOAD` read PRGs from the D64 (`readD64Prg`). D81/DNP: partial / planned (D81 stays a normal 1581 disk feature elsewhere).
5. **VICE wiring** — SD2IEC unit uses `vice_driveN_type=None`, `vice_work_disk=disabled`, true drive emulation on; no packed D64/D81 “fake card” on the SD2IEC path.

## WASM rebuild plan (only if KERNAL intercept is insufficient)

1. Fork `libretro/vice-libretro` at the version pinned by EmulatorJS.
2. Add a libretro option `vice_driveN_sd2iec` or a new drive type id that registers a **vdrive** whose IEC state machine calls into exported WASM imports (`sd2iec_iec_tick`, `sd2iec_open`, …).
3. Expose those imports to JS (Emscripten `MODULARIZE` + `ccall`) and forward to `sd2iec.ts` command/file layer.
4. Ship a custom core blob in `public/system/vice/` and select it when IEC map slot is `sd2iec`.
5. Regression: `npm run test:cmd-sd2iec`, C64 OS fixture (`GROK64_C64OS_FIXTURE`), Jiffy fast-load spot checks.

## Grok64 VICE rebuild (Tom-approved)

| Item | Status |
|------|--------|
| Build tree + `grok64_library.js` Emscripten imports | `third_party/vice-grok64/` |
| `build.sh` → `public/system/vice/emulatorjs/data/cores/` | Run when `emcc` is available |
| JS host (`grok64-vice-bridge.ts`) | Wired — auto-detects `_grok64_sd2iec_*` exports |
| Stock CDN core fallback | `attachGrok64Sd2iec` + `tickGrok64Iec` (KERNAL IEC layer) |
| C64 RAM from JS | `c64-memory.ts` + `__g64.readC64Byte` / `writeC64Byte` |
| Unit **12** + `1//:c64os` paths | `setSd2iecUnit(12)` + `parsePath` / `CD` |

**Built blob (test branch):** `public/system/vice/emulatorjs/data/cores/vice_x64sc-wasm.data` (~1.2 MB, Emscripten **3.1.74**, EmulatorJS RetroArch link).

Enable in dev/preview:

`VITE_GROK64_VICE_DATAPATH=/system/vice/emulatorjs/data` (set in `.grok/app-env.json` on this branch).

Rebuild: `third_party/vice-grok64/build-grok64-core.sh` (requires `.emsdk` + `node_modules/7zip-bin`).

Until the WASM blob is present, behavior matches the JS IEC device (same firmware / card backing).
