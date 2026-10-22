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

Until that rebuild lands, the KERNAL intercept path is the supported production approach and matches “software on the IEC bus” from the C64’s point of view (LOAD/CLOSE/OPEN to device 8).
