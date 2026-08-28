# Grok64

Phone- and tablet-first **Commodore 64 emulator** — EmulatorJS + VICE WASM, React 19, Zustand, IndexedDB library.

Live app: **https://grok64.grok.me**

This tree is the **recovered functioning source** (August 2026). The previous GitHub copy was a reconstructed stub. Source was recovered from the live production bundle and rewritten as TypeScript so it runs again (the published build crashed with `jsxDEV is not a function` because a production chunk still called the dev JSX runtime).

## What it is

- Cold start to BASIC READY with a writable **WORK DISK.D64**
- Catalog: Assembly64 (when the network allows), HVSC, Internet Archive
- Downloads stay on this device (IndexedDB) so disks can SAVE
- Autoplug joystick: Boulder Dash / Rockford → Port 1, otherwise Port 2
- FIRE maps to the assigned port only (no dual-port, no SPACE-as-fire)
- Hot-swap disks without a full reboot; playLock during autostart
- PAL/NTSC from filename tags, SID flags, and known titles
- Fast VICE core on phones and budget tablets (Onn, iPhone)

## Design rules (do not regress)

1. Authentic joystick: one assigned port; FIRE = that port only.
2. Auto joyport: Boulder Dash / Rockford → Port 1; else Port 2.
3. No reboot on FIRE or port swap (`playLock`, hot-swap, `bootKick`).
4. Tablet: stick under CRT, keyboard under stick (`data-device`, `data-kb`).
5. Catalog: skip Construction Kit / trainers; prefer First Star 1984 BD.

## Layout

```
src/components/g64/   App shell, catalog, keyboard, stick, sheets
src/lib/g64/          EmulatorJS host, SID wrap, D64, catalog server fns
src/routes/           TanStack Start routes
public/software/      Bundled tests (blank disk, Hopper, diagnostics, cart, tape)
```

Auth and a shared database are **off**. Library and settings live in IndexedDB / localStorage (`grok64-settings` v3).

## Run

This is a Grok Build / TanStack Start app (React 19, Vite, Tailwind v4). Open it in Grok Build, or:

```
npm install
npm run dev
```

Dev server: `http://0.0.0.0:8080`. Production: `npm run build` then `npm run check:jsx` (must not contain `jsxDEV`).

EmulatorJS WASM is loaded from `https://cdn.emulatorjs.org/stable/data/`.

## Credits

VICE (GPLv2+) · libretro vice cores · EmulatorJS · reSID (Dag Lem) · Pepto PAL/NTSC · Assembly64 · HVSC · Internet Archive.

## Owner

Tommycat76 (Thomas Phaneuf)
