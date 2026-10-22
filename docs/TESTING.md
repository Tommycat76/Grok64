# Grok64 testing

**Priority:** desktop Chromium first (1280×800). Tablet layout and iOS CRT paths are lower priority unless explicitly noted.

## Unit tests

```bash
npm test
```

Includes SD2IEC DOS unit tests and `scripts/sid-options.test.mjs`.

## Desktop browser (primary)

Start the dev server (`sh startup.sh`), then:

```bash
npm run test:desktop-e2e
npm run test:desktop-matrix
npm run test:desktop-catalog
npm run test:desktop-catalog-play
npm run test:desktop-regression
npm run test:vice-sid-probe
```

Private media (optional, never commit ROMs / commercial disks):

```bash
GROK64_JIFFY_DIR=/path/to/jiffy npm run test:desktop-e2e
GROK64_CART_DIR=/path/to/crts npm run test:desktop-e2e
GROK64_GEOS_DIR=/path/to/geos npm run test:desktop-geos
GROK64_DEMO_DIR=/path/to/demo-disks npm run test:desktop-demo
GROK64_NUVIE_DIR=/path/to/nuvie npm run test:desktop-nuvie
# optional overrides (defaults: CSDb nuvieplayer + C64ReloadedMK2-Ad.reu)
GROK64_NUVIE_URL=https://example/player.prg GROK64_NUVIE_REU_URL=https://example/video.reu npm run test:desktop-nuvie
```

`test:desktop-nuvie` loads a `.prg` player plus matching `.reu` via `window.__g64.playNuvie` (zip pair for libretro REU-image pairing). Fixtures are cached under `public/__e2e_nuvie/` (gitignored).

Artifacts live under `artifacts/desktop-*/`.

Multi-SID: see `docs/VICE_MULTISID.md` (libretro documents **one** extra SID; third-SID UI is hidden).

---

## Regression checklist (every control / setting)

Automated by `npm run test:desktop-regression` unless noted **manual**.

### Top bar (powered on)

| Control | E2E id | Notes |
|---------|--------|--------|
| PAL/NTSC chip → Settings | `expansion-rom-upload-panel` (via Settings) | Opens Machine sheet |
| SD2IEC chip toggle | `sd2iec-disk-swap` (with SD card) | Turns SD2IEC off on #8 |
| CMD chip toggle | — | **manual** when CMD ROM uploaded |
| MOUSE chip | `joystick-port-swap` (with mouse) | 1351 mode |
| WARP / JUMP / SD FZ / CMD SWAP / CART FZ / SCPU RST | `cart-freeze-line`, hw chips | Shown when device/cart active |
| Software | `software-catalog` | Catalog + Library drawer |
| Insert disk | `disk-mount-sheet` | Disk mount drawer |
| More → Keyboard / Pause / Reset / Mute / Settings / About | `keyboard-toggle`, `pause-toggle`, `reset-ready`, `audio-mute`, Settings | Desktop duplicates phone rail |

### Quick dock (phone/tablet only)

| Control | Desktop |
|---------|---------|
| Disk, Keyboard, Joystick, Mouse, P1/P2, Pause, Warp, Snapshots, Reset, Fullscreen | **manual** on tablet; desktop uses top bar |

### Settings → Machine sheet

| Control | E2E / notes |
|---------|-------------|
| 1351 mouse + touchpad | `sessionFlags` via regression helpers |
| Touchpad side (L/R) | **manual** |
| Layout editor + reset layout | **manual** |
| C64 OS kit preset | **manual** |
| Video Auto / NTSC / PAL | `desktop-matrix` combos |
| CPU core Auto / Accurate / Fast | matrix / **manual** |
| Model (C64 Auto, PAL, NTSC, C64C, Fast, SCPU, C128, …) | **manual** per model |
| SuperCPU + SIMM + turbo | **manual** |
| IEC #8–#11 slots (Off, 1541, 1581, SD2IEC, CMD) | `sd2iec-disk-swap`, matrix `sd2iec-slot` |
| Jump button | **manual** |
| Freeze / snapshots → sheet | `save-state-freeze-f1` |
| SID engine / chip / 2nd SID | `test:vice-sid-probe`, `sid-default-single` |
| 1541 drive Auto / Accurate / Fast | **manual** |
| Joystick port 1 / 2 | `joystick-port-swap` |
| REU Off / 256K / 512K / 2MB / 16MB | `reu-none` … `reu-16384kB` | VICE has **no 128K** REU; smallest is **256K** |
| Expansion panel (ROM upload, Jiffy, SD card) | `expansion-rom-upload-panel` |
| Pause / Warp / Mute / CRT scanlines / Verbose logs | `pause-toggle`, `warp-toggle`, `audio-mute` |
| Volume slider | **manual** |
| Control mapper | **manual** |
| About | **manual** |

### Software drawer

| Tab / area | E2E |
|------------|-----|
| Catalog search + kind chips | `test:desktop-catalog` |
| Play / Insert / Download | `catalog-download-play`, `catalog-insert-mount` |
| Library / import / URL | **manual** |
| Bundled titles | `test:desktop-catalog-play`, bundled ids in regression |

### Snapshots sheet

| Control | E2E |
|---------|-----|
| Hardware freeze F1–F4 | `save-state-freeze-f1` |
| Save memory + recipe | **manual** (same capture path) |
| Load / Del per row | **manual** after save |

### Session / power

| Action | E2E |
|--------|-----|
| Power splash → READY | `power-boot`, `power-session-alive` |
| Reset to READY | `reset-ready` |
| Play without splash remount | `byte-hopper-no-splash-remount`, catalog-play |

### NUVIE REU video

| Check | E2E |
|-------|-----|
| 16 MB REU + `.nuv`/`.reu` play | `test:desktop-nuvie` |
| Frames change (not frozen) | `uniqueFrames >= 2` |
| No crash / hang | `alive` after soak |

---

## Goal matrix (original PR)

See `artifacts/desktop-matrix/matrix.json` and sections above for SD2IEC, Jiffy, carts, GEOS, demos.

## CMD / SD2IEC smoke

```bash
npm run test:cmd-sd2iec
```

## iOS / tablet

Deferred unless regressions are reported. See `docs/IOS_CRT_KNOWN_FAILURES.md`.
