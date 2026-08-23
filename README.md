# Grok64

Phone- and tablet-first **Commodore 64 emulator** (EmulatorJS + VICE WASM, React, Zustand).

> **Important:** Most of `src/` here is **reconstructed** from the long Grok Build conversation because the original workspace was not attached when this repo was created. Treat it as a faithful design/backup scaffold, not a bit-for-bit copy of the unpublished tree. Replace with the real export when you recover Grok Build on a PC.

## Live app

**https://grok64.grok.me**

Currently crashes on load with `(0 , z.jsxDEV) is not a function` (dev JSX runtime in production bundle). See [docs/PUBLISH.md](docs/PUBLISH.md).

Sandbox preview (may expire):
`https://hds-q64aqd7pu1ev-6014-f9ie3.grok-code-wild.hades-www.grok-sandbox.com/`

## Repo layout

```
package.json, tsconfig.json
src/
  components/emu/Grok64App.tsx   # power, bootKickRef, playBuffer autoplug
  components/touch-controls.tsx  # stick + FIRE (tap zones + high contrast)
  lib/detect.ts                  # phone/tablet/desktop
  lib/store.ts                   # zustand settings
  lib/emu/host.ts                # single-pad joy vector
  lib/emu/region.ts              # Boulder Dash → Port 1
  lib/emu/archive.ts             # junk skip / prefer First Star
  lib/emu/catalog.ts             # rank/pin catalog hits
  styles.css                     # tablet dock + visible stick
scripts/region.test.mjs
docs/ARCHITECTURE.md, RECOVERY.md, PUBLISH.md
```

## Design rules (do not regress)

1. Authentic joystick: one assigned port; FIRE = that port only (no SPACE, no dual-port).
2. Auto joyport: Boulder Dash / Rockford → Port 1; else Port 2.
3. No reboot on FIRE or port swap (`bootKickRef`, playLock, hot-swap).
4. Tablet: stick under CRT, keyboard under stick (`data-device`, `data-kb`).
5. Catalog: skip Construction Kit / trainers; prefer First Star 1984 BD.

## Owner

Tommycat76 (Thomas Phaneuf)
