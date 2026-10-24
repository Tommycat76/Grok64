# Drive combination matrix (Grok64)

**Status: PARKED** — Full IEC matrix (`GROK64_DRIVE_COMBO_UNPARK=1`) stays off until Tom signs off **emulator baseline** (cart + Jiffy + library floppy Play/Insert on dirty profiles).

**Baseline track (2026-10-24):** **`faaf40949509`** core (attach without nested iec reconcile; JS never double-reconciles) — serial **REAL** route, BMC64-style **unit‑8 flush** (detach/reattach + reconcile + **`viceRcSafeFloppyProfile` restore** for CMD/secondary drives), runtime **floppy isolate** only during reconcile; **SD2IEC unit skipped**. About **`viceLoadDollarDiag`** + **`profilePersistDiff`**. Comparison + no-regression smokes: `docs/GEOS_REFERENCE_EMULATOR_COMPARISON.md`, `npm run test:desktop-grok64-feature-smoke`. Gates: `test:desktop-geos-insert-user-dirty`, `test:desktop-sd2iec-iec`. No merge/deploy without Tom.

**Last updated:** 2026-10-24 (spec + harness; **no matrix PASS/FAIL rows** until unpark)

---

## Purpose

Exercise **real IEC layouts** the way users configure them in **Settings → IEC drives**: every meaningful combination of drive types and **unit numbers 8–11**, then verify **loading** and **copying** files **between each pair** of active devices.

Also cover **fast paths** (JiffyDOS, freezer-cart fast loaders where applicable) vs **stock KERNAL**, and **warp** vs **normal** CPU speed — without per-title emulator patches (true VICE / Grok64 behavior only).

Results are **PASS / FAIL per row**, with **hands-on Chromium** click-through and screenshots (same bar as cart QA: scripted gates are supporting evidence, not a substitute).

---

## Prerequisites (gate before first row)

| Gate | Owner | Notes |
|------|--------|--------|
| Cart + Jiffy UI gate green | Cart fix PR | `npm run test:desktop-cart-jiffy-ui-gate` + manual screenshots |
| Jiffy + floppy directory (generic path) | Agent gate | `npm run test:desktop-jiffy-floppy-dir` — GEOS + boulder-dash, Jiffy on/off (`cf5c6e6` pairs 1541 ROM before work-disk refresh) |
| Tom hands-on Jiffy + REU Play | Tom | Same path as gate; sign-off before unpark |
| Library **Insert** + typed LOAD (not Run / `playBytes`) | Agent + Tom | `npm run test:desktop-geos-insert-user-dirty` (+ Jiffy alias gate); `attachDiskDiag().viceDriveBus` after Insert |
| Library row Play (legacy) | Agent | `npm run test:desktop-library-geos-floppy-ui` + `npm run test:desktop-dirty-profile-geos` |
| Floppy mount policy | Done | `docs/DISK_MOUNT_POLICY.md` — mount READY, named LOAD only |
| CMD Boot ROM 2.80 | QA | User-uploaded; matrix uses real CMD HD behavior |
| Jiffy ROM pair (+ 1571 ROM if 1571 rows) | QA | Settings upload; synthetic pair OK for automation only if Tom agrees |
| Fixtures | `fixtures/` | Paired `.d64`/`.d81`/`.d71` images with known PRG names for LOAD/COPY |

---

## Drive types in scope (IEC units)

| Slot type | VICE / Grok64 role | Notes |
|-----------|-------------------|--------|
| **1541** | Unit 8 default floppy | `.d64` mount; `LOAD"$",8` directory policy |
| **1571** | Dual-density floppy | `.d64` / `.d71` where supported |
| **1581** | 3½" DD | `.d81`; partition semantics |
| **CMD HD** | Hard disk (partitioned) | Real `dosCMDHD` ROM; prefer unit **9+** so unit 8 stays floppy-capable |
| **CMD FD** | FD2000/4000 family | **Partial** — see `docs/CMD_SD2IEC_COMPATIBILITY.md`; rows marked *model gap* until modeled |
| **SD2IEC** | Grok64 software IEC | IndexedDB/FAT card; not a VICE drive type |
| **REU** | RAM expansion | Not an IEC address — matrix dimension **REU off / 512K / 2M / 16M** alongside IEC map |

**None** on a unit = drive absent (valid permutation).

---

## Unit order (8 / 9 / 10 / 11)

Tom wants **every unit order**: for each **injective assignment** of distinct drive types to a subset of `{8,9,10,11}` (and `none` on remaining units), run the **pair tests** below.

**Enumeration strategy (when unparked):**

1. **Canonical permutations** — generate all permutations of the active drive set across four slots (treat `none` as filler). Document the count per drive-count (e.g. 4 distinct drives → 4! = 24 maps).
2. **Smoke subset first** — before full factorial:  
   - Map A: `#8=1541, #9=1541, #10=1581, #11=CMD HD`  
   - Map B: `#8=SD2IEC, #9=1541, …`  
   - Map C: CMD HD on 8 vs 9 (regression class from play-session)  
3. **Full matrix** — expand to all permutations once smoke is green.

**Harness (unpark slice):** `desktop-drive-combo-matrix.mjs` uses Software **Insert** (not `playBytes`), power cycle before insert, `iecBusReconcile`, and fails rows when `serialDeviceLabel` is `virt` or core `buildId` ≠ manifest. First smoke row (SM-01) still tracks typed `LOAD"$",8` / named LOAD quality separately from IEC routing.

Store each map as a row group key, e.g. `8:1541|9:1571|10:1581|11:cmdhd`.

---

## Operations per drive pair (A → B)

For every **ordered pair** of distinct active units `(A, B)` in the current map:

| Op ID | User-visible steps | PASS criteria |
|-------|-------------------|---------------|
| **LOAD** | Mount source image on A; from BASIC or DOS, `LOAD"<file>",<A>` (named file — never `*`) | File runs or lands in memory; no `FILE NOT FOUND` / `DEVICE NOT PRESENT` |
| **COPY** | `OPEN`/`COPY` or CMD/SD2IEC equivalent to copy a small test file A→B and B→A | Byte-identical or directory listing shows new file on target |
| **DIR** | `LOAD"$",<unit>` (or device-native directory) | Listing readable on CRT; matches fixture manifest |

SD2IEC ↔ 1541 and CMD HD ↔ floppy pairs are **high priority** (C64 OS–class layouts).

---

## Speed / turbo dimensions (cross product)

Each **(map × pair × op)** row is run under:

| Dimension | Values |
|-----------|--------|
| **KERNAL / loader** | Stock; JiffyDOS ON; cart fast loader ON (Epyx/SS5/AR where row says *cart*) — cart rows only when cart fix is proven |
| **Warp** | Normal speed; warp ON (Settings / hardware warp) |

Minimum when time-boxed: **stock+normal**, **Jiffy+normal**, **stock+warp**, **Jiffy+warp** for each pair; add cart turbo column when cart matrix is green.

---

## SuperCPU and RAMdisk (separate milestone — also PARKED)

| Feature | Status | Matrix impact |
|---------|--------|----------------|
| **SuperCPU** (`vice_xscpu64`) | UI + reset hooks exist; WASM often missing | Add section **S** when Tom approves core availability: same IEC maps under SuperCPU 20 MHz turbo on/off |
| **RAMdisk / RAMLink-style** | Documented as not modeled (`docs/HARDWARE_SPEC_REFERENCE.md`, `REAL_UI_QA_REPORT.md`) | Add section **R** only after implementation — CMD-style RAM partition COPY/load |

Do **not** block IEC matrix on S/R; link rows as `SKIP (not modeled)` until then.

---

## Evidence (required per row when executed)

1. Screenshot: Settings IEC map for that row (`screenshots/drive-matrix/<map-id>-settings.png`).
2. Screenshot: CRT after LOAD or COPY (`…-load.png` / `…-copy.png`).
3. Optional: `window.__g64?.screenText?.()` snippet in report JSON.
4. Console: no uncaught errors.

Artifact root: `screenshots/drive-matrix/` and `artifacts/desktop-drive-combo-matrix/`. Harness: `npm run test:desktop-drive-combo-matrix` (exits 0 while **PARKED**; set `GROK64_DRIVE_COMBO_UNPARK=1` when Tom unparks). Catalog: `scripts/drive-combo-catalog.mjs`.

---

## Results table (PASS / FAIL per row)

> **PARKED:** all cells `—` until QA run. Replace with PASS / FAIL / SKIP (reason).

### Smoke maps (first rows when unparked)

| Row | IEC map (8·9·10·11) | Pair | Op | KERNAL | Warp | REU | Result | Screenshot | Notes |
|-----|---------------------|------|-----|--------|------|-----|--------|------------|-------|
| SM-01 | 1541·1541·1581·cmdhd | 8→9 | LOAD | stock | off | off | — | | |
| SM-02 | 1541·1541·1581·cmdhd | 8→9 | COPY | stock | off | off | — | | |
| SM-03 | 1541·1541·1581·cmdhd | 8→11 | LOAD | Jiffy | off | off | — | | |
| SM-04 | sd2iec·1541·none·none | 8→9 | COPY | Jiffy | off | off | — | | |
| SM-05 | 1541·1571·1581·none | 8→10 | LOAD | stock | on | 2M | — | | |

### Full permutation expansion

| Row | IEC map | Pair | Op | KERNAL | Warp | REU | Result | Screenshot | Notes |
|-----|---------|------|-----|--------|------|-----|--------|------------|-------|
| *TBD* | *generated* | *A→B* | LOAD/COPY/DIR | *combo* | on/off | *size* | — | | |

### SuperCPU (section S — PARKED)

| Row | IEC map | SuperCPU | Pair | Op | Result | Notes |
|-----|---------|----------|------|-----|--------|-------|
| S-01 | *TBD* | 20 MHz turbo off | 8→9 | LOAD | — | Needs xscpu64 WASM |

### RAMdisk / RAMLink (section R — PARKED)

| Row | Feature | Result | Notes |
|-----|---------|--------|-------|
| R-01 | RAMLink partition COPY | — | Not modeled |

---

## Automation (future)

When unparked, add something like:

```bash
npm run test:desktop-drive-combo-matrix
```

Implementation notes:

- Reuse `scripts/desktop-qa-lib.mjs` (power on, Settings IEC chips, `patchLocalStorage`).
- Drive map iterator: generate permutations from a catalog in `scripts/drive-combo-catalog.mjs`.
- Shared LOAD/DIR helpers: `scripts/drive-combo-qa-lib.mjs` (mount on `pairFrom`, `LOAD"$"`, LIST, first PRG named LOAD for **LOAD** rows).
- Never type `LOAD"*",8,1` in harness (Tom); use directory-derived PRG names or fixture manifest.
- Long-running: shard by map id in CI; full factorial is a release/manual milestone.

---

## Related docs

- `docs/DISK_MOUNT_POLICY.md` — floppy READY / no `*`
- `docs/CMD_SD2IEC_COMPATIBILITY.md` — CMD FD / RAMLink gaps
- `docs/CART_COMPAT_MATRIX.md` — cart fast loaders (turbo column)
- `docs/TESTING.md` — manual vs gate inventory

---

## Sign-off

| Role | Condition | Date |
|------|-----------|------|
| Tom | Emulator baseline proven; unpark matrix | |
| QA | Smoke maps SM-01…SM-05 green + screenshots | |
| QA | Full permutation + S/R sections | |
