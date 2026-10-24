# Grok64 emulator compatibility audit

**Principle (Tom):** Grok64 is a true VICE-backed C64 emulator targeting ~99.9% compatibility — not per-title patches. Fixes belong in the wrapper (mount, autostart, IEC bus, cart attach, input) using VICE resources the way hardware does.

**Measures:** VICE/libretro regression tests where wired, `npm run test:desktop-xdotool-cart-matrix` (CRT × stock/Jiffy KERNAL), existing play-session / SD2IEC / keyboard xdotool suites.

_Last updated: 2026-10-23_

## Changes this pass (generic over per-title)

| Area | Was | Now |
|------|-----|-----|
| Super Snapshot disk load | `feedBasicLine('LOAD"*",8,1')` only for SS4/SS5 filenames | Removed — floppy Play uses `autostartAfterReady()` + true drive like all disks |
| Action Replay boot | Forced Jiffy off on `prepareCore` / `applyJiffyDos` when `fastLoadCart === "action-replay"` | `resolveJiffyWant()` only (hardware suppress/warn matrix) |
| Play-lock timer | Longer lock for `paradroid|turrican|boulder|commando|geos|wheels` titles | Single **48s** desktop disk window for all true-1541 loads |
| Post-load `RUN` | Skipped RUN when screen matched game name list | Skip when screen already long, shows errors, or **generic** cracktro prompt (`screenInvitesCracktroInput`) |
| Cracktro Space nudge | Only for Paradroid / Commando / Turrican titles | Fires when **screen text** asks for space/fire (any program) |
| `detectFastLoadCart` | Used for emulation branches | Documented **UI/Jiffy matrix only**; attach is VICE CRT type |

## Remaining special cases (justified)

| Location | Behavior | Why it stays |
|----------|----------|--------------|
| `detectFastLoadCart` + `jiffy-cart-compat.ts` | Filename/heuristic cart **family** for JiffyDOS pairing UI | No `grok64_cartridge_get_id()` export in WASM yet — UI must explain hardware conflicts before attach |
| `diskRunAfterLoadRef` + `!sessionFastCart` | No extra KERNAL `RUN` after floppy autostart when a fast-load cart session is active | Generic: freezer/turbo carts hook LOAD; duplicate RUN → READY (VICE autostart still runs) |
| `prepareAutostartDisk` / `isCracktroName` | Reorder directory so `LOAD"*"` hits game PRG not cracktro | **Disk image** structure, not game title — uses directory names + fuzzy title match |
| `archive.ts` scoring | Penalize `intro`/`cracktro` in **filenames** inside zips | Archive picker heuristic, not runtime emulation |
| `geos-boot.ts` | `GEOS` / `Wheels` by **disk filename** | OS family boot path (1541-II, REU, mouse) — same as identifying a GEOS system disk on hardware |
| `vice-extras.ts` `wantsLargeReu` | Nuvie / `.reu` / C64 OS name patterns | REU size for REU/Nuvie/C64 OS class software, not individual games |
| `region.ts` title lists | NTSC/PAL hints for **catalog** metadata | Does not change VICE core behavior at play time |
| `ios-paint` / CriOS paths | Platform presentation | Host UI, not CPU emulation |
| `CART_PLAY_UNLOCK_VICE_OPTS` vs `PLAY_UNLOCK_VICE_OPTS` | Cart play disarms autostart without `vice_reset=hard` | Matches freezer-cart “stay in menu” hardware behavior via VICE options |
| `play-session.ts` GEOS/CMD/SD2IEC IEC rules | Device 8 vs 9 layout | Documented C64 OS + VICE drive model |

## Follow-ups (toward 99.9%)

1. **Export `grok64_cartridge_get_id()`** from libretro (`cartridge_get_id(0)`) and drive Jiffy UI + matrix “detect” column from VICE, not filename regex.
2. **Wire VICE debug cart / test harness** blobs into CI (`cartridge` regression programs from VICE tree).
3. **Cart matrix** — keep expanding `scripts/cart-compat-catalog.mjs` + IA fixtures; missing CRTs (Retro Replay, Expert, Simons' BASIC, Magic Desk, Ocean, Dela, Zaxxon, GMod2) need separate public images.
4. **Replace play-lock fixed timers** with “until IEC idle / screen left READY” where libretro exposes safe hooks.

## Compatibility artifacts

| Artifact | Command |
|----------|---------|
| Cart matrix (xdotool) | `npm run test:desktop-xdotool-cart-matrix` → `docs/CART_COMPAT_MATRIX.md` |
| Downloader, CMD HD, demos, freeze/autostart | `npm run test:desktop-xdotool-extended` → `docs/REAL_UI_QA_REPORT.md` |
| Play / IEC state machine | `node scripts/play-session.test.mjs` |
| Jiffy × cart pairing | `node scripts/jiffy-cart-compat.test.mjs` |
| Desktop keyboard + AR6 | `npm run test:desktop-xdotool-keyboard` |

See `docs/CART_COMPAT_MATRIX.md` for the latest per-CRT pass/fail table (stock vs Jiffy KERNAL).
