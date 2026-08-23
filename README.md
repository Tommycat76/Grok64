# Grok64

Phone- and tablet-first **Commodore 64 emulator** built with EmulatorJS (VICE WASM), React, and Zustand.

> **Status (2026-08-23):** Original Grok Build workspace is not currently attached to the agent session. This repo is a **backup** of architecture, design decisions, QA history, and reconstructed modules so nothing is lost. When the live source is recovered (or re-exported), replace the reconstructed files with the real tree.

## Live app

If you have the published URL, add it here:

```
Published app: (paste URL)
```

## Stack

- **UI:** React 19 + TanStack Start + Tailwind v4
- **State:** Zustand (settings partialized; joyPort default 2)
- **Persistence:** IndexedDB
- **Emulator:** EmulatorJS 4.2.3 + libretro VICE (`vice_x64` / `x64sc`)
- **Input:** Single virtual joystick on player 0, authentic single-port behavior (CIA Port 2 default `$DC00`, fire bit 4)
- **Catalog:** Assembly64 + Internet Archive search; ranked picks for classics (Boulder Dash First Star preferred)

## Core design rules (do not regress)

1. **Authentic joystick only**  
   One assigned port. FIRE = that port’s button only. No SPACE-on-FIRE, no dual-port fire, no extra A/Y face buttons.

2. **Joyport auto-detect**  
   Boulder Dash / Rockford family → Port 1. Most others → Port 2. Applied in `playBuffer` before hot-swap.

3. **No reboot on FIRE / port swap**  
   Hot-swap path + `playLock` during disk autostart (8–12s). `bootKickRef` guards against double-boot races with `recoverBoot`.

4. **Tablet layout**  
   `data-device="tablet"` + `data-kb`. Stick docks under CRT; keyboard under stick (flow layout, no absolute overlay on phone-style stacking).

5. **Catalog hygiene**  
   `pickBootFile` / `rankCatalogHits` skip Construction Kit, trainers, A Wally, etc. Prefer First Star 1984 Boulder Dash IA d64.

## Key modules (original paths)

| Path | Role |
|------|------|
| `src/components/emu/Grok64App.tsx` | Power-on, boot/recover, playBuffer, autoplug, `__g64` debug |
| `src/lib/emu/host.ts` | `joyInput` / `setJoyVector`, single pad, `simulateInput` |
| `src/lib/emu/region.ts` | `detectJoyPort`, software hints |
| `src/lib/emu/catalog.ts` | Search, pin/rank, junk penalty |
| `src/lib/emu/archive.ts` | `pickBootFile`, SKIP/PREFER, explode archives |
| `src/components/touch-controls.tsx` / Joystick | Virtual stick + FIRE |
| `src/styles.css` | Tablet dock, kb overlay rules, min-heights |
| `src/lib/detect.ts` | phone / tablet / desktop snapshot |
| `public/software/ports.prg` | CIA port color diagnostic (P2 green, P1 yellow) |
| `public/software/byte-hopper.prg` | Fire/port QA |

## Known issues at last session

- Power button / recoverBoot race (partially fixed with `bootKickRef`)
- Stick barely visible on black UI → needs higher contrast
- Requested: **tap zones** on stick base (digital 8-way) in addition to drag
- Preview sometimes stuck on “reviving workspace” / “Click to resume Emulator”

## QA scripts (Playwright)

- `scripts/fire-port-assign.mjs` — hopper green P2, ports yellow P1, no reboot
- `scripts/tablet-bd.mjs` — tablet layout, no kb/stick overlap, BD autoplug P1
- `scripts/bd-play.mjs` — catalog First Star hit, load, fire without reboot
- `scripts/region.test.mjs` — pickBootFile + detectJoyPort unit checks

## How to restore full source later

1. On a PC, open Grok → Projects / Apps → **Grok64** → Continue building / Open workspace.
2. Export or copy the full tree into this repo (replace reconstructed files).
3. Or download any “Export source” zip from the builder and push it here.

## License / credits

- VICE / EmulatorJS: their respective licenses
- Grok64 app code: owner Tommycat76 (Thomas Phaneuf)

---

*Backed up from the long Grok64 build conversation so the project survives workspace disconnects.*
