# Cart boot vs Grok64 floppy autostart

Grok64 must keep two different mechanisms separate.

## 1. Grok64 / VICE floppy autostart (wrapper — must not run with a CRT)

When the user **Plays a disk image**, Grok64 arms VICE `vice_autostart` so the core types **`LOAD"*",8,1`** after reset. That path expects a **1541/1581** on unit 8 and a mounted `.d64`/`.d81`.

**While a cartridge is the active media**, the wrapper must **not** arm that autostart or leave `vice_work_disk` in a state that triggers it. Cart boots are CRT resets in VICE, not `LOAD"*"` from BASIC.

Symptoms of a wrapper bug (regression):

- Stock **COMMODORE 64 BASIC V2** banner (no cart menu)
- **`LOAD"*",8,1`** visible on the CRT
- **`SEARCHING FOR *`** / **`?FILE NOT FOUND`**
- Cartridge freezer UI never appears

QA gates use `grok64FloppyAutostartPoison()` in `scripts/desktop-qa-lib.mjs` to detect **this** pattern only.

## CART OUT (hardware)

On a real C64, **pulling a cartridge while the machine is powered on crashes the system**. Grok64 **CART OUT** must not simulate a hot-unplug (`cartEject` on the live core). It performs a **full software power-cycle**: destroy the WASM core and cold-boot **WORK DISK** to bare **READY** (then Jiffy is re-applied per Settings if enabled).

## 2. Cartridge-native auto-boot (hardware — leave VICE alone)

Some carts implement their **own** disk boot logic. That is **not** Grok64 autostart and must **not** be suppressed.

### Super Snapshot v5 — BOOTSECTOR SUPPORT (manual §11)

- Bootsector maker writes a **special command** to **track 1, sector 0** (not the C128 `$` boot block).
- Auto-boot runs when invoked: **F7** from the opening menu, **`BOOT`** from BASIC, or the **60-second idle timer** after power-up.
- **DELETE** / **F1** at power-up: exit to BASIC with Turbo features but **do not** run auto-boot.
- Normal **opening menu** after cart reset is the expected Play path; the user is not asking for F7/BOOT/timer unless they press those keys.
- With a disk in the drive and **no** installed boot sector: the manual describes checking the sector and only running a program **if present** — there is no documented `LOAD"*",8,1` KERNAL sequence for an empty/non-boot disk. IEC activity (read track 1 sector 0) is **valid**; do not treat it as a Grok64 failure.
- With **no disk**: older 1541s may **head-knock**; with a disk inserted, auto-boot should not cause head knock (manual note).

Other freezer/fast-load carts may perform their own IEC loads; only flag failures when the **wrapper** has clearly typed **`LOAD"*",8,1`**.

## Implementation notes

- `isCartMediaBoot()` / `settleAfterStart`: cart path disables wrapper autostart and `vice_work_disk` autoload; **true drive** stays on so carts can talk to unit 8.
- Do not add “anti-Searching” hacks that block cart firmware from using the drive.
- GEOS / Wheels **`LOAD"*",8,1`** remains the **disk Play** path only (`docs/GEOS-WHEELS.md`).

## Hands-on CRT diagnostics (IndexedDB / attach)

When **Play** lands on stock BASIC but QA passes elsewhere, compare **data** (library bytes) vs **flow** (power-first cart boot).

| Surface | What you get |
|---------|----------------|
| **Settings → About → Last cartridge Play** | JSON for the last cart Play: `payloadBytes`, `idbStoredSize`, `headerHex64`, `crtSignature`, `hwTypeId` / `hwTypeLabel`, `attachCode`, `cartMountedOnCore`, `bootFileAfter`, `wasmBuild`, `routesBundle`, `viceCoreKind` |
| **Browser console** | `[grok64] lastCartPlay` on each update |
| **`__g64.lastCartPlay()`** | Same object in DevTools |
| **Play gate** | Invalid CRT header, &lt;4096 bytes, or library `size` ≠ loaded bytes → **error toast**, boot aborted |
| **Import gate** | Same CRT rules when saving to **On this device** (re-import if an old row was truncated) |

**`attachCode`:** `-1` = boot file write failed; `0` = CRT not visible as mounted boot/media; `>0` = CRT hardware type byte from the header (e.g. `2` = Super Snapshot v5) when attach succeeded.

If the header validates and `cartMountedOnCore` is true but the freezer menu never appears, paste the full JSON — likely KERNAL/core execution, not a truncated IndexedDB row.
