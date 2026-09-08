# Static hosting (Plex, nginx, S3, etc.)

`npm run build` writes a self-contained site to **`dist/`**:

- `index.html` — SPA shell (TanStack Start prerender)
- `assets/*` — hashed JS/CSS (`base: ./` so paths work on any origin)
- `software/*` — bundled disks (including `boulder-dash.d64` fetched at build time)
- `favicon.svg`, `og.jpg`, `__grok/*`

## Serve

Point your static host at **`dist/`** with SPA fallback to `index.html` for unknown paths.

Examples:

```bash
# Python (quick check)
cd dist && python3 -m http.server 8080

# nginx
root /var/www/grok64/dist;
location / { try_files $uri $uri/ /index.html; }
```

## Plex (https://grok64.tomsprojects.cc)

Repo clone on the Windows host: `C:\Users\tom\apps\Grok64`. After **main** is updated:

```
cd C:\Users\tom\apps\Grok64
git pull --ff-only origin main
npx vite build
node scripts/flatten-dist.mjs dist
# restart serve-static-ia.mjs on :8091
# verify the new routes-*.js hash on https://grok64.tomsprojects.cc/
# confirm the on-screen build id matches the git short SHA
```

**Read `docs/IOS_CRT_LOCKED_GOOD.md` first**, then `docs/IOS_CRT_KNOWN_FAILURES.md`.

Do not claim an iPhone CRT PASS from this box. Tom’s real CriOS is the only PASS.
**Chromium-on-Plex still is not CriOS PASS.** #46/#47 went green while Tom’s
phone went black. **#48** (`main@6c10228`, #7) and **#49** (`main@9c35eb7`, #8)
were honestly red: CSS 100% + clientWidth lie/unlock, paint `count:0` solid
black. That family is dead. `#50` (`main@5a43c67`, #9) painted on Plex
(`~853k`) but Tom’s CriOS was a postage stamp — **Plex paint-count ≠ Tom
geometry**. `#51` (`main@7d09f7a` / `routes-2Aufi9H1.js`, #10) zoomed the
non-GL host (`zoom:3` on Plex) — Tom got a bigger picture still flush
**top-right** with a purple **L left+bottom**. **Plex `zoom:3` ≠ Tom
geometry**. `#52` (`main@156a07f` / `routes-D2Yf0JqE.js`, #11) centered
the zoom slot — Tom got a **thin purple strip along the BOTTOM**. `#53`
(`main@3dc22be` / `routes-BD6gfM9s.js`, #12) restored that `ee0b445`
**layout** on top of the #42 384-lock paint stack — Tom’s CriOS was
**solid black**. `#54` (`main@3f80fc8` / `routes-DlWAL8fJ.js`) painted
READY on Tom’s phone, then Play Paradroid/BD went **black CRT → splash
remount** (`#13`) because unit-8 Play WASM-recycled the live canvas.
Current ship **keeps that #14/#18/#39 host wiring** and restores the
**#18/#30 in-place Play path** (same GL canvas, real 1541 #8). No
zoom/slot. Zero PASS without Tom.

### CRT fill gate (required after deploy)

Cursor-sandbox WebKit is **not** a ship gate. After the static server is serving the new build, run this from the repo on **PLEXnTORRENT_HP**:

```
node scripts/crt-fill-gate.mjs
node scripts/crt-fill-gate.mjs https://grok64.tomsprojects.cc/
node scripts/crt-fill-gate.mjs http://127.0.0.1:8091/
```

It launches Playwright Chromium at an iPhone viewport (390×844, touch, CriOS UA), powers on, then:

1. Hides on-screen chrome, crops `.g64-screen`, and measures the **painted** pixel bbox **and coverage** of the **live WebGL** canvas. Solid black / `count:0` **fail**. Tom #44 top-right and GL-origin bottom-left stamps still fail, even when wrapper rects report fill 1.00. **Plex paint-count ≠ Tom geometry** (#50 / #9).
2. Requires `.g64-screen` to be the **384:272 CRT glass** (not a tall absolute-inset bezel) and the live GL / `#grok64-player` CSS to **fill that glass** (untransformed, no CSS `zoom` / `.g64-ios-slot`). Fail a 384×272 stamp in a tall screen (#50), a tall-bezel CSS 100% (#48/#49), and leftover zoom/slot (#51/#52).
3. Fails if the boot overlay is a full-bezel black sheet, or if power → first READY frame takes longer than 18s (flags the ~39s iPhone blank). Plex Chromium may not reproduce iPhone WASM time.
4. **Session hold** (~8s after first READY): still powered (no splash remount), `__g64` still mounted, no full page reload / tab crash, **no 2D present canvas covering GL**, VICE backing is native-sized (not a tall CSS×DPR buffer), CRT still painted (not #46–#53 solid black / postage stamp / L-border / bottom strip).

Screenshots land in `screenshots/crt-fill-gate-*.png` (including `*-bezel.png` and `*-hold-bezel.png` crops).

Needs Playwright's Chromium once: `npx playwright install chromium`. If Chromium is already installed, set `G64_CHROME` to that executable.

A green gate is a **painted-layout + hold check**, **not** a real CriOS PASS.
**Tom’s phone is the only PASS.** Chromium-on-Plex can still pass while CriOS
goes black (#47). Optional later: BrowserStack real CriOS. Tom hard-refresh
remains the CRT picture sign-off. Never print PASS from the gate.


## EmulatorJS

VICE WASM cores load from `https://cdn.emulatorjs.org/stable/data/` (no bundling required). Power-on fetches `./software/blank.d64` relative to the app base.

## Catalog & Internet Archive

**grok.me / Vercel:** use `npm run build:vercel` so TanStack Start server functions stay wired (Nitro). Catalog search and Archive.org downloads go through the server-side fetch path restored from main — this bypasses IA CDN CORS in the browser.

**Pure static hosts (Plex, nginx, S3):** `npm run build` flattens to a client-only `dist/`. Power-on, bundled `./software/*`, and the on-device library work. Plex co-hosts an Internet Archive proxy at **`/api/ia`** (`serve-static-ia.mjs` on the Plex server — do not relocate):

- `GET /api/ia?url=${encodeURIComponent(archiveUrl)}`
- `/api/ia/download/...`, `/api/ia/metadata/...`, `/api/ia/advancedsearch.php?...`

The client defaults to same-origin `/api/ia` for IA search, metadata, and downloads (catalog falls back to client-side fetch when serverFn is unavailable). Override with **`VITE_IA_PROXY_BASE`** at build time if the proxy lives elsewhere. Server deploys can set **`IA_PROXY_BASE`** for `downloadCatalogFile`.

Assembly64 and HVSC metadata/search work in-browser (CORS allowed). IA **download** CDN nodes block browser CORS — server-side fetch is required (the restored `createServerFn` path).

## Vercel / grok.me

Use `npm run build:vercel` (sets `GROK_VERCEL_BUILD=1`) to include the Nitro server bundle for legacy deploys.
