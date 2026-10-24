# GEOS 2.0 reference emulator comparison

**Purpose:** Baseline for Tom’s **emulator sign-off** before unparking `DRIVE_COMBO_MATRIX.md`. Compare **GEOS_2.0.d64** steps (`LOAD"$",8`, `LIST`, `deskTop`, Jiffy on/off) against desktop **VICE x64sc 3.9** (lineage), **BMC64**, and **Denise** where available.

**No-regression:** Flush + safe-profile work must **not** break any **Grok64-only** feature below (not only SD2IEC). After floppy isolate during flush, Grok64 **restores** the user IEC map via `viceRcSafeFloppyProfile` so **CMD HD/FD**, secondary units, and Settings layout stay live.

**Grok64 core:** `518f732634af` (VICE **3.9.0** lineage). Glue: `diskapi-v18-profile-persist-atn`.

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
| TDE | `DriveTrueEmulation=1` | same family | per-drive TDE | — | **on**, real serial |
| Virtual devices | user defaults; use real 1541 for parity | package defaults | `VirtualDevices=0` | — | `VirtualDevices=0` |
| GEOS on unit 8 | attach `.d64` | not run in CI | `file_system_attach_disk` | manual | Insert + flush/reattach + reconcile |
| Native run in agent | not built (no 3.9 binary) | optional `apt install vice` | reference tree only | not in repo | primary |

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

## GEOS_2.0.d64 steps — outcomes

| Step | VICE 3.9 (expected) | Grok64 |
|------|---------------------|--------|
| Dirty profile (#8=1541, #9=CMD HD, REU, PAL) | user vicerc | seeded localStorage + IDB |
| Power cycle + Insert | attach D64 | flush/reattach + reconcile + **map restore** |
| `LOAD"$",8` / `LIST` | catalog | keyboard + feedBasic fallback; diag captured |
| `deskTop` | LOAD GEOS / RUN | `test:desktop-tde-dirty-hands-on` |
| Jiffy on/off | ROM pair | dirty Jiffy gate + feature smoke jiffy row |

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
