# Recovered source (2026-08-23)

The original Grok Build workspace was gone. GitHub previously held reconstructed stubs. This commit replaces them with functioning TypeScript recovered from the live production bundle at https://grok64.grok.me (`/assets/routes-CZHgHMH9.js`).

## What was wrong with the live build

`Bl()` (the app shell) was compiled with `jsxDEV` while the rest of the chunk used `jsx`. Production has no `jsxDEV`, so the splash crashed immediately: `(0 , z.jsxDEV) is not a function`. Recovered source uses the regular JSX runtime.

## What was recovered

- EmulatorJS host: CDN loader, fake “Grok64 Touch” pad, `vice_joyport`, restart guard, playLock, hot-swap `writeFile`, BASIC cold start
- SID wrap at `$C000`, D64 BAM/PRG wrap, work disk banner
- Region: PAL/NTSC + Boulder Dash → Port 1
- Catalog server functions: IA + HVSC + Assembly64 (`/leet/search/aql`, `/leet/search/entries`, `/leet/search/bin`)
- Keyboard, stick + FIRE, software sheet, machine settings, mapper, about
- Bundled software in `public/software/`

Server function bodies were hashed out of the client bundle and reconstructed from call sites plus the Assembly64 / IA / HVSC APIs.

## Still true

You do not need a PC to *keep* this backup — this GitHub repo is the backup.
