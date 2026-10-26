# GEOS 2.0 reference emulator comparison

**Purpose:** Baseline for Tom’s **emulator sign-off** before unparking `DRIVE_COMBO_MATRIX.md`. Compare **GEOS_2.0.d64** steps (`LOAD"$",8`, `LIST`, `deskTop`, Jiffy on/off) against desktop **VICE x64sc 3.9** (lineage), **BMC64**, and **Denise** where available.

**No-regression:** Flush + safe-profile work must **not** break any **Grok64-only** feature below (not only SD2IEC). After floppy isolate during flush, Grok64 **restores** the user IEC map via `viceRcSafeFloppyProfile` so **CMD HD/FD**, secondary units, and Settings layout stay live.

**Grok64 core:** `cfb3626633a0` (VICE **3.9.0** lineage; D64 error-info tables go to VICE untouched). Glue: `diskapi-v25-core-cfb3626633a0`.

**1541 baseline media:** a clean GEOS 2.0 boot disk, i.e. one without an error-info table: Tom's `GEOS_2.0.d64` cut to its first 174848 bytes, or `GEOS64_en.d64` (`geosBaselineD64()` in `scripts/geos-fixture-lib.mjs`). `GEOS_2.0.d64` itself marks its first directory block unreadable, so a 1541 cannot list it (next section).

---

## GEOS_2.0.d64's error-info table, checked in stock VICE (2026-10-25)

**Result:** with true drive emulation, stock desktop VICE 3.7.1 and 3.9 answer `LOAD"$",8` with `?FILE NOT FOUND` on a D64 whose error-info table marks track 18 sector 1 as a data checksum error, and the drive reports `23, READ ERROR,18,01`. That is what Grok64 does with Tom's `GEOS_2.0.d64`, so Grok64 is emulating the 1541 correctly and nothing in the emulator is changed for this image. With the table stripped, the same disk lists 16 files and boots to the GEOS deskTop in both VICE versions and in Grok64.

**Tom's image.** `GEOS_2.0.d64` is 175531 bytes: a 35-track D64 plus a 683-byte error-info table. Tom counted 347 sectors with code 05 (data checksum error, DOS error 23), 335 with 01 (OK) and one 04 (data block not found, DOS error 22). Track 18 starts `01 05 01 05 05 01 05`, so 18/1 (the first directory block), 18/3, 18/4 and 18/6 are flagged. VICE writes each 05 sector to the GCR track with a wrong data checksum, so the emulated 1541 DOS fails on 18/1 exactly as a real drive would. If the table were accurate, the original disk could not have been read on a real 1541 at all, which points to a bad dump rather than copy protection.

**Media used here.** Tom's exact file is not in the agent sandbox, so the runs use stand-ins built by `scripts/make-d64-error-table-standins.mjs` from `GEOS64_en.d64` (English GEOS 2.0 boot disk, 174848 bytes, sha1 `04274950a066…`):

| Stand-in | Error-info table |
|---|---|
| `tom-density` | Tom's figures: 347 × 05, 335 × 01, one 04; track 18 starts with his seven codes, the rest is a fixed fill that keeps his totals |
| `tom-t18` | only his seven track-18 codes (18/1, 18/3, 18/4, 18/6 = 05) |
| `t18s1-05` | only 18/1 = 05 |
| `all01` | every sector 01 |

Stripping the table from any of them gives back `GEOS64_en.d64`. The reference script takes any D64 path, so it runs Tom's exact file the same way: `node scripts/vice-desktop-reference.mjs /path/GEOS_2.0.d64`.

**Setup.** `scripts/vice-desktop-reference.mjs`: stock GTK `x64sc`, Ubuntu's VICE 3.7.1 package and VICE 3.9 built unmodified from the release tarball, `-default` with a fresh config, drive 8 a 1541 with `Drive8TrueEmulation=1` and `VirtualDevice8=0`, KERNAL 901227-03 and 1541 DOS 325302-01/901229-05. Every command is typed as X11 key presses into the VICE window, the C64 screen is read through VICE's remote monitor, and each step is screenshotted. A D64 with a table is also run as its first 174848 bytes.

| Image | VICE, true drive emulation | `LOAD"$",8` | `LIST` | Error channel | `LOAD"GEOS",8,1` |
|---|---|---|---|---|---|
| `tom-density` | 3.9 | `?FILE NOT FOUND  ERROR` after about 9 s | nothing | `23 READ ERROR 18 1` | `?FILE NOT FOUND  ERROR` after about 8 s |
| `tom-density` | 3.7.1, three runs | `?FILE NOT FOUND  ERROR` after about 9 s | nothing | `23 READ ERROR 18 1` | `?FILE NOT FOUND  ERROR` after about 8 s in two runs; in one run it stayed at `SEARCHING FOR GEOS` for the full 300 s |
| table stripped (first 174848 bytes) | 3.7.1 and 3.9 | `LOADING`, `READY.` | 16 files, `259 BLOCKS FREE.` | `0 OK 0 0` | GEOS starts itself; deskTop with 16 files, 101 Kbytes used, 64 Kbytes free |
| `tom-t18` | 3.7.1 and 3.9 | `?FILE NOT FOUND  ERROR` | nothing | `23 READ ERROR 18 1` | `?FILE NOT FOUND  ERROR` |
| `t18s1-05` | 3.7.1 and 3.9 | `?FILE NOT FOUND  ERROR` | nothing | `23 READ ERROR 18 1` | `?FILE NOT FOUND  ERROR` |
| `all01` | 3.7.1 and 3.9 | `LOADING`, `READY.` | 16 files, `259 BLOCKS FREE.` | `0 OK 0 0` | deskTop |

The error channel is read with `10 OPEN1,8,15` / `20 INPUT#1,A,B$,C,D` / `30 PRINTA;B$;C;D` / `40 CLOSE1`, so `23 READ ERROR 18 1` is the drive's `23, READ ERROR,18,01`. One flagged directory block is enough to hide the whole disk; a table by itself is not the problem (`all01` boots).

**Without true drive emulation** (diagnostic only, `VICE_REF_TDE=0`: VICE's virtual drive instead of the emulated 1541), both versions answer `LOAD"$",8` on `tom-density` and `t18s1-05` with `LOADING`, `READY.`, but `LIST` shows only the disk header and `259 BLOCKS FREE.` with no files, and the error channel says `0 OK 0 0`. The virtual drive reads the BAM, stops at the unreadable 18/1 (`vdrive_dir_find_next_slot` in `src/vdrive/vdrive-dir.c` returns on the read error) and does not report it. A setup without true drive emulation can therefore make this image look like it nearly works, but no file on it can be found.

**Grok64, same media, by hand** (build `042ef66`, core `cfb3626633a0`; `scripts/desktop-xdotool-geos-hand-boot.mjs`: real Chrome, reused profile, X11 key presses, Insert from the library):

| Image | JiffyDOS | `LOAD"$",8` / `LIST` | Error channel | `LOAD"GEOS",8,1` |
|---|---|---|---|---|
| `tom-density` | off | `?FILE NOT FOUND  ERROR`, nothing listed | `23 READ ERROR 18 1`; About's `dos1541` (read from the drive's RAM) shows `23,READ ERROR,18,01` | `?FILE NOT FOUND  ERROR` after 8.3 s |
| `GEOS64_en.d64` (clean) | off | 16 files, `259 BLOCKS FREE.`, the same entries as the image's directory | `0 OK 0 0` | GEOS starts itself; deskTop after 76 s |

In both runs Insert left `READY.` with nothing typed. JiffyDOS on was not run: this sandbox has no JiffyDOS ROMs, and the gate only counts a JiffyDOS run when JiffyDOS is live and its banner is on screen. Tom's retest of `b314120` (the core before this one) gave the same `FILE NOT FOUND` on his image with JiffyDOS on and off. JiffyDOS changes how bytes cross the serial bus, not how the 1541 reads a sector, so a flagged 18/1 is expected to fail the same way with it.

Screenshots: `docs/screenshots/geos-error-table/` (`vice-*` are stock VICE's C64 screen plus one full VICE window, `grok64-*` the hand gate). Full runs: `screenshots/vice-reference/`, `artifacts/vice-reference/*.json`, `screenshots/geos-hand-boot/`, `artifacts/geos-hand-boot/results.json` (local, not committed).

**Baseline.** The 1541 baseline uses a clean GEOS 2.0 image: `geosBaselineD64()` takes Tom's `GEOS_2.0.d64` from `private-c64/geos` (or `GROK64_GEOS_D64_PATH`), writes its first 174848 bytes to `fixtures/geos/derived/GEOS_2.0-stripped.d64` and uses that; without Tom's image it uses `GEOS64_en.d64`. The image with its table stays a separate check that expects `FILE NOT FOUND`:

```bash
GROK64_HAND_D64=private-c64/geos/GEOS_2.0.d64 GROK64_HAND_EXPECT=fnf node scripts/desktop-xdotool-geos-hand-boot.mjs
```

**Screenshot smoke (all Grok64-only surfaces):**  
`npm run test:desktop-grok64-feature-smoke` → `screenshots/grok64-feature-smoke/*.png` + `artifacts/grok64-feature-smoke/smoke.json`  
**Latest agent run:** all 12 feature rows **PASS** (see `smoke.json` `capturedAt`).

**GEOS + SD2IEC baseline:** `npm run test:desktop-geos-baseline-hands-on`  
**Dirty Insert gate:** `npm run test:desktop-geos-insert-user-dirty`  
**SD2IEC IEC gate:** `npm run test:desktop-sd2iec-iec`

---

## Reference emulators (GEOS drive row)

| Setting | VICE x64sc 3.9 (desktop) | VICE apt 3.7.1 (CI) | BMC64 3.3 | Denise | Grok64 WASM |
|--------|---------------------------|---------------------|-----------|--------|-------------|
| TDE | `Drive8TrueEmulation=1` | `Drive8TrueEmulation=1` | per-drive TDE | — | **on**, real serial |
| Virtual devices | `VirtualDevice8=0` | `VirtualDevice8=0` | `VirtualDevices=0` | — | `VirtualDevices=0` |
| GEOS on unit 8 | `-8 image.d64` | `-8 image.d64` | `file_system_attach_disk` | manual | Library Insert |
| Native run in agent | built from the 3.9 release tarball, `scripts/vice-desktop-reference.mjs` | Ubuntu package, same script | reference tree only | not in repo | primary |

---

## Grok64-only features (vs desktop VICE / Denise)

Desktop VICE does **not** ship these; they must stay working after flush / isolate / stale-drive fixes.

| Feature | What VICE desktop has | Grok64 behavior | By-hand smoke (screenshot) |
|--------|------------------------|-----------------|----------------------------|
| **Browser WASM core** | Native binary | `vice_x64sc-grok64-iec-wasm.data` + manifest bind | `01-wasm-core.png` |
| **Software library** | File menu | Import, catalog, **On this device** Play/Insert | `04-library-insert-flush.png` |
| **Insert vs Play policy** | user choice | Named LOAD / Insert READY; no `LOAD"*",8,1` poison on carts | insert gate + cart gate |
| **BMC64 flush + IEC reconcile** | detach/reattach | `bmc64FlushSessionDisk` → isolate during reconcile → **`viceRcSafeFloppyProfile` restore** | `04-library-insert-flush.png` (CMD unit 9 probe) |
| **Stale IDB vicerc** | `~/.vice` | MEMFS + `profilePersistDiff` in About | About gate / dirty proof |
| **`viceLoadDollarDiag`** | — | never null on FILE NOT FOUND | dirty proof JSON |
| **SD2IEC** | hardware | WASM IEC + card IDB; **no flush on SD2IEC unit** | `07-sd2iec.png` |
| **CMD HD / CMD FD** | real drives + ROM | Settings IEC map; HD on 9+; ROM upload | `08-cmd-hd.png` |
| **REU** | expansion port | 512K–16M; C64 OS / `.reu` auto 16M | `03-reu.png` |
| **JiffyDOS** | KERNAL ROM swap | uploaded pair; live 1541 ROM; hard reset path | `05-jiffy.png` |
| **Warp** | warp mode | UI + `setWarp` session flag | `06-warp.png` |
| **PAL / NTSC** | monitor | persisted `videoStandard` → VICE option | `02-pal-ntsc.png` |
| **Cartridge Play** | cart menu | library CRT; SS5 / AR6 gates | `09-cart-ss5-play.png` |
| **CART OUT** | remove cart | `hwPress('cart-out')` ≈ power-cycle class back to BASIC | `10-cart-out-basic.png` |
| **Cart Insert** | — | hot-swap CRT while running (UI) | cart-jiffy-ui-gate / manual |
| **NUVIE / REU video** | — | `playNuvie` + `.reu`/`.nuv` in library | `11-nuvie-hook.png` + `test:desktop-nuvie` |
| **Power chrome** | power switch | in-app power off/on without closing tab | `12-power-cycle.png` |
| **IEC units 8–11 map** | Drive settings | zustand `iecMap` + live attach | CMD + SD2IEC rows |
| **CMD swap / FD2000** | hardware buttons | `hw-buttons` (partial FD model) | `docs/CMD_SD2IEC_COMPATIBILITY.md` |
| **Freezer carts** | cart line | Freeze / Resume (AR, SS) | cart-jiffy-ui-gate |
| **Session restore hint** | — | last session banner + CART OUT hint | power-cycle row |
| **iOS mirror / touch** | — | mobile CRT + defer keyboard | browser-smoke mobile |
| **Grok PWA / preview** | — | Builder shell, `__g64` QA hooks | dev smoke only |

Run the full screenshot matrix:

```bash
npm run test:desktop-grok64-feature-smoke
```

---

## GEOS boot disk steps — outcomes

| Step | Stock VICE, clean image (baseline) | Stock VICE, table flags 18/1 | Grok64, clean image | Grok64, table flags 18/1 |
|------|------------------------------------|------------------------------|---------------------|--------------------------|
| Profile | fresh `-default` config | same | reused Chrome profile with Tom's stored settings | same |
| Power cycle + Insert | `-8 image.d64`, `READY.` | same | Power off/on, Library Insert on unit 8, `READY.` with nothing typed | same |
| `LOAD"$",8` / `LIST` | 16 files, `259 BLOCKS FREE.` | `?FILE NOT FOUND  ERROR`, nothing listed | 16 files, `259 BLOCKS FREE.` | `?FILE NOT FOUND  ERROR`, nothing listed |
| Error channel | `0 OK 0 0` | `23 READ ERROR 18 1` | `0 OK 0 0` | `23 READ ERROR 18 1` |
| `LOAD"GEOS",8,1` | GEOS starts itself, deskTop | `?FILE NOT FOUND  ERROR` | GEOS starts itself, deskTop | `?FILE NOT FOUND  ERROR` |
| JiffyDOS | not used (Commodore ROMs) | not used | off; on needs the user's JiffyDOS ROMs, which the sandbox does not have | off; Tom's retest of `b314120` gave the same with JiffyDOS on |

---

## Flush / safe-profile rules (no-regression)

| Condition | Behavior |
|-----------|----------|
| Settings unit is **SD2IEC** | Skip `bmc64Flush`, `ensureIecBusReconcile`, floppy isolate on that unit |
| **Floppy Insert** on unit 8 with CMD on 9 | **`finishFloppyInsertIec`** (one reconcile, no second detach/reattach); **`restoreUserDriveVicerc`** restores CMD map without `viceDriveTypeVars` churn (REU/SCPU/auto settings stay) |
| **WASM attach** | `grok64_disk_attach` no longer calls `iec_bus_reconcile` (prevents stack overflow); JS reconciles once |
| **REU / warp / Jiffy** | Not written by isolate vicerc; session opts re-applied on power-on |
| **Cart session** | Flush path is floppy-oriented; cart boot uses `prepareCore` + cart vicerc |

---

## Changelog

| Date | Notes |
|------|--------|
| 2026-10-24 | Full Grok64-only feature table + `test:desktop-grok64-feature-smoke`; post-flush IEC map restore; SD2IEC guards |
| 2026-10-25 | `GEOS_2.0.d64`'s error-info table checked in stock VICE 3.7.1 and 3.9 with true drive emulation: `FILE NOT FOUND` for `$` and `GEOS`, as in Grok64; baseline moves to the table-stripped image; `scripts/vice-desktop-reference.mjs`, `scripts/make-d64-error-table-standins.mjs` |
