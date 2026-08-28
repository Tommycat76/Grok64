# Grok64

Phone- and tablet-first Commodore 64 emulator (EmulatorJS + VICE WASM).

## Live app

- Published slug: **https://grok64.grok.me**
- Grok Build project id: `01a0303f-68eb-73c3-bf55-0f667c8a2d6d`

## Local Grok Build TUI

This is the **full source** (not the earlier reconstructed stubs).

```bash
git clone https://github.com/Tommycat76/Grok64.git
cd Grok64
npm install
npm run dev
```

Dev server listens on `0.0.0.0:8080` via `npm run dev` (`scripts/with-app-env.mjs`).

## Stack

React 19, TanStack Start, Tailwind v4, Zustand, EmulatorJS + libretro VICE.

## Design rules

1. Authentic joystick: one assigned port; FIRE = that port only (no SPACE-on-FIRE).
2. Auto joyport: Boulder Dash / Rockford → Port 1; else Port 2.
3. No reboot on FIRE or port swap (`bootKickRef`, playLock, hot-swap).
4. Tablet: stick under CRT; keyboard under stick (`data-device`, `data-kb`).
5. Catalog: skip Construction Kit / trainers; prefer First Star 1984 BD.

## Status 2026-08-28

- Restored `Grok64App.tsx` to real JSX (fixes production `jsxDEV is not a function`).
- Stick: high-contrast + 8-way tap/drag snap.

Owner: Tommycat76 (Thomas Phaneuf)
