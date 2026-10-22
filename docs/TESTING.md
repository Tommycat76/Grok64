# Grok64 testing

**Priority:** desktop Chromium first (1280×800). Tablet layout and iOS CRT paths are lower priority unless explicitly noted.

## Unit tests

```bash
npm test
```

Includes `scripts/sd2iec-cmd.test.mjs` (SD2IEC DOS commands, `fake-indexeddb` in Node) and `scripts/sid-options.test.mjs` (multi-SID VICE option mapping).

## Desktop browser (primary)

Start the dev server (`sh startup.sh`), then:

```bash
npm run test:desktop-e2e
npm run test:desktop-matrix
```

Artifacts: `artifacts/desktop-e2e/results.json`, `artifacts/desktop-matrix/matrix.json`.

### Environment (optional, never commit ROMs or C64 OS trees)

| Variable | Purpose |
|----------|---------|
| `GROK64_BASE_URL` | Default `http://127.0.0.1:8080/` |
| `GROK64_JIFFY_DIR` | Folder with your JiffyDOS C64 + 1541 ROMs (tests inject via IndexedDB) |
| `GROK64_CART_DIR` | `.crt` freezer/fastload images (Epyx FastLoad, Action Replay, FC III, Super Snapshot v5, …) |
| `GROK64_C64OS_FIXTURE` | C64 OS v1.04 `part1-C64OS` tree (private) |
| `GROK64_STRESS_MINUTES` | Soak length for reset cycles in desktop e2e (default `2`; use `30`+ for long runs) |

### Desktop matrix (sampled)

`test:desktop-matrix` cold-boots a **sample** of NTSC/PAL × SID × drive × REU × SD2IEC × mouse — not the full Cartesian product. Extend `scripts/desktop-matrix.mjs` when adding new hardware paths.

### Goal checklist (manual + automated)

| # | Area | Desktop automation | Notes |
|---|------|-------------------|--------|
| 1 | Multi-SID | `sid-default-single`, `sid-stereo-runtime` | Default = single SID (extras off). 3rd SID uses `vice_sid_extra2` when core supports it. |
| 2 | JiffyDOS | `jiffydos-inject`, `stock-kernal-fallback` | Requires `GROK64_JIFFY_DIR`. UI: Settings → Expansion → upload ROMs. |
| 3 | Cartridges | `bundled-cart-freeze`, `fastload-carts` | Bundled `grok64.crt`; user carts via `GROK64_CART_DIR`. |
| 4 | GEOS | — | Needs GEOS disk + 1351 mouse manual pass; REU/drives covered in matrix. |
| 5 | Multi-disk demos | — | Use catalog + private disks; play-stay covered by `byte-hopper-no-splash-remount`. |
| 6 | SD2IEC/CMD | `sd2iec-dos`, `test:cmd-sd2iec` | `CD<-`, `$=P`, MD/RD in unit tests. C64 OS boot optional via fixture. |
| 7 | Combination matrix | `test:desktop-matrix` | Document results in `artifacts/desktop-matrix/matrix.json`. |
| 8 | Play past title | `byte-hopper-no-splash-remount` | Must not return to power splash mid-play. |

## CMD / SD2IEC browser smoke

```bash
npm run test:cmd-sd2iec
```

Headless Chromium (and WebKit when installed). PETSCII keyboard opens via `window.__g64.setShowKeyboard(true)` on desktop.

## UI layout screenshots

```bash
npm run test:ui-layout
```

Outputs under `docs/screenshots/{before,after}/` (no C64 OS screen content).

## iOS / tablet

Deferred unless regressions are reported. See `docs/IOS_CRT_KNOWN_FAILURES.md` — do not repeat locked failures on the CRT host path.
